"""Continuous external monitoring: zero-token drift checks, conditional audits.

A monitored target is one public URL — a homepage, privacy policy, terms page,
pricing page or AI product page — that a client wants re-checked daily. The
cheap path is deliberately free: fetch the page, clean it, hash the normalized
text, and stop. Only when the hash moves does the module spend tokens on the
existing five-part remediation audit.

State lives in the same SQLite file as the rest of Aegis, in two tables:

- ``monitored_targets`` — what to watch, how often, where to alert, and the
  last observed hash/status.
- ``monitoring_snapshots`` — one immutable row per check, so the timeline is
  always auditable even after a target is paused.

``check_target_drift`` takes an optional ``audit`` callable so the server can
persist the resulting audit as a normal audited document while tests can run
the whole pipeline with no Groq key. The default callable just grades the text.
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

import auditor
import fetcher
from rules import OPEN_STATUSES

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("AEGIS_DB") or ROOT / "data" / "aegis.db")

ALERT_TIMEOUT = 5.0
DEFAULT_HISTORY_LIMIT = 50
MAX_HISTORY_LIMIT = 500
CHECK_FREQUENCIES: tuple[str, ...] = ("daily",)
STATUS_CLEAN = "clean"
STATUS_DRIFT = "drift_detected"
STATUS_ERROR = "error"

# What label keywords imply for the per-page character cap in ``fetcher``.
_KIND_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("privacy", "notice", "dpa"), "privacy"),
    (
        ("terms", "ai", "product", "pricing", "trust", "security", "policy"),
        "product",
    ),
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS monitored_targets (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    url TEXT NOT NULL,
    label TEXT NOT NULL,
    check_frequency TEXT NOT NULL DEFAULT 'daily',
    alert_webhook_url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_checked_at TEXT,
    last_hash TEXT,
    last_status TEXT
);

CREATE TABLE IF NOT EXISTS monitoring_snapshots (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL REFERENCES monitored_targets(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    drift_detected INTEGER NOT NULL,
    diff_summary TEXT,
    audit_doc_id TEXT,
    open_gaps_count INTEGER NOT NULL DEFAULT 0,
    high_gaps_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_monitoring_snapshots_target
    ON monitoring_snapshots (target_id, checked_at DESC);
"""

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

# ``(text, source) -> (findings, audit_document_id | None)``
AuditFn = Callable[[str, str], tuple[list[dict[str, Any]], str | None]]

_WHITESPACE_RE = re.compile(r"\s+")


def _db() -> sqlite3.Connection:
    """One connection for monitoring, guarded by ``_lock``."""
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
        _conn.executescript(_SCHEMA)
        _conn.commit()
    return _conn


def configure_db(path: str | Path) -> None:
    """Point monitoring at another database (tests, or a second workspace)."""
    global DB_PATH, _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
        DB_PATH = Path(path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Hashing and the zero-token diff
# --------------------------------------------------------------------------- #


def normalize_text(text: str) -> str:
    """Collapse whitespace so a re-flowed page does not look like drift."""
    return _WHITESPACE_RE.sub(" ", text or "").strip()


def content_hash(text: str) -> str:
    """SHA-256 of the normalized text; the only thing a clean check stores."""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def diff_summary(previous_hash: str | None, current_hash: str, chars: int) -> str:
    """A hash-level change note. Costs no tokens and never stores page text."""
    if not previous_hash:
        return f"First check: baseline content captured ({chars:,} characters)."
    return (
        f"Content changed since the last check: "
        f"{previous_hash[:8]} -> {current_hash[:8]} ({chars:,} characters fetched)."
    )


# --------------------------------------------------------------------------- #
# Targets
# --------------------------------------------------------------------------- #


def kind_for_label(label: str) -> str:
    """Pick the fetcher page kind (and its character cap) from the label."""
    lowered = (label or "").lower()
    for hints, kind in _KIND_HINTS:
        if any(hint in lowered for hint in hints):
            return kind
    return "homepage"


def _fetch_target_text(url: str, label: str) -> str:
    """Fetch and clean one monitored page, inside the shared fetch guardrails."""
    snapshot = fetcher.fetch_page(kind_for_label(label), url)
    return snapshot.text


def _target_row(target_id: str) -> sqlite3.Row:
    with _lock:
        row = _db().execute("SELECT * FROM monitored_targets WHERE id = ?", (target_id,)).fetchone()
    if row is None:
        raise KeyError(target_id)
    return row


def _latest_snapshot(target_id: str) -> dict[str, Any] | None:
    with _lock:
        row = _db().execute(
            "SELECT * FROM monitoring_snapshots WHERE target_id = ?"
            " ORDER BY checked_at DESC, rowid DESC LIMIT 1",
            (target_id,),
        ).fetchone()
    return _snapshot_public(row) if row is not None else None


def _snapshot_public(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "targetId": row["target_id"],
        "checkedAt": row["checked_at"],
        "contentHash": row["content_hash"],
        "driftDetected": bool(row["drift_detected"]),
        "diffSummary": row["diff_summary"],
        "auditDocId": row["audit_doc_id"],
        "openGapsCount": row["open_gaps_count"],
        "highGapsCount": row["high_gaps_count"],
    }


def _target_public(row: sqlite3.Row, latest: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "clientName": row["client_name"],
        "url": row["url"],
        "label": row["label"],
        "checkFrequency": row["check_frequency"],
        "alertWebhookUrl": row["alert_webhook_url"],
        "active": bool(row["active"]),
        "createdAt": row["created_at"],
        "lastCheckedAt": row["last_checked_at"],
        "lastStatus": row["last_status"],
        "hasBaseline": bool(row["last_hash"]),
        "latestSnapshot": latest if latest is not None else (
            _latest_snapshot(row["id"]) if row["last_checked_at"] else None
        ),
    }


def get_target(target_id: str) -> dict[str, Any]:
    """One target with its latest snapshot, or ``KeyError``."""
    return _target_public(_target_row(target_id))


def create_target(
    *,
    client_name: str,
    url: str,
    label: str = "Website",
    check_frequency: str = "daily",
    alert_webhook_url: str = "",
    active: bool = True,
) -> dict[str, Any]:
    """Register a public URL to monitor. Validation of the URL is the caller's."""
    name = (client_name or "").strip()
    if not name:
        raise ValueError("Enter the client or company name.")
    target_url = (url or "").strip()
    if not target_url:
        raise ValueError("Enter the URL to monitor.")
    frequency = (check_frequency or "daily").strip().lower()
    if frequency not in CHECK_FREQUENCIES:
        raise ValueError(f"check_frequency must be one of: {', '.join(CHECK_FREQUENCIES)}.")
    target_id = uuid.uuid4().hex[:12]
    with _lock:
        db = _db()
        db.execute(
            "INSERT INTO monitored_targets (id, client_name, url, label, check_frequency,"
            " alert_webhook_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                target_id,
                name,
                target_url,
                (label or "Website").strip() or "Website",
                frequency,
                (alert_webhook_url or "").strip() or None,
                1 if active else 0,
                _now(),
            ),
        )
        db.commit()
    return get_target(target_id)


def list_targets(*, active_only: bool = False) -> list[dict[str, Any]]:
    """Every monitored target, newest snapshot attached."""
    query = "SELECT * FROM monitored_targets"
    if active_only:
        query += " WHERE active = 1"
    query += " ORDER BY active DESC, client_name COLLATE NOCASE"
    with _lock:
        rows = _db().execute(query).fetchall()
    return [_target_public(row) for row in rows]


def delete_target(target_id: str, *, purge: bool = False) -> dict[str, Any]:
    """Pause a target (default) or delete it and its snapshot history."""
    _target_row(target_id)  # 404 before touching anything
    with _lock:
        db = _db()
        if purge:
            db.execute("DELETE FROM monitored_targets WHERE id = ?", (target_id,))
        else:
            db.execute("UPDATE monitored_targets SET active = 0 WHERE id = ?", (target_id,))
        db.commit()
    if purge:
        return {"id": target_id, "purged": True, "active": False}
    return {**get_target(target_id), "purged": False}


def history(limit: int = DEFAULT_HISTORY_LIMIT, target_id: str | None = None) -> list[dict[str, Any]]:
    """Recent snapshots across targets, newest first, for the timeline log."""
    bounded = max(1, min(int(limit or DEFAULT_HISTORY_LIMIT), MAX_HISTORY_LIMIT))
    query = (
        "SELECT s.*, t.client_name, t.url, t.label FROM monitoring_snapshots s"
        " JOIN monitored_targets t ON t.id = s.target_id"
    )
    params: list[Any] = []
    if target_id:
        query += " WHERE s.target_id = ?"
        params.append(target_id)
    query += " ORDER BY s.checked_at DESC, s.rowid DESC LIMIT ?"
    params.append(bounded)
    with _lock:
        rows = _db().execute(query, params).fetchall()
    items = []
    for row in rows:
        item = _snapshot_public(row)
        item.update(
            {
                "clientName": row["client_name"],
                "url": row["url"],
                "label": row["label"],
            }
        )
        items.append(item)
    return items


# --------------------------------------------------------------------------- #
# Gap counting and alerts
# --------------------------------------------------------------------------- #


def _gap_counts(findings: list[dict[str, Any]]) -> tuple[int, int]:
    """Open gaps and the High ones among them."""
    open_gaps = [item for item in findings if item.get("status") in OPEN_STATUSES]
    return len(open_gaps), sum(1 for item in open_gaps if item.get("severity") == "High")


def _top_finding(findings: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Worst open finding: Fail before Warning, then by severity."""
    severity_rank = {"High": 0, "Medium": 1, "Low": 2}
    open_findings = [item for item in findings if item.get("status") in OPEN_STATUSES]
    if not open_findings:
        return None
    return min(
        open_findings,
        key=lambda item: (
            severity_rank.get(str(item.get("severity")), 3),
            0 if item.get("status") == "Fail" else 1,
        ),
    )


def _redline_snippet(findings: list[dict[str, Any]]) -> str:
    """The top finding's copy redline, falling back to its problem statement."""
    finding = _top_finding(findings)
    if finding is None:
        return ""
    plan = finding.get("remediation_plan") or {}
    fix = plan.get("exactFix") or {}
    snippet = fix.get("copyRedline") or plan.get("problem") or finding.get("remediation_note") or ""
    return normalize_text(str(snippet))[:280]


def _post_alert(webhook: str, payload: dict[str, Any]) -> None:
    """Best-effort webhook POST; a dead endpoint never fails a sweep."""
    try:
        requests.post(webhook, json=payload, timeout=ALERT_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - alerting is fire-and-forget
        print(f"[monitoring] alert webhook failed: {type(exc).__name__}: {exc}")


def _notify(webhook: str | None, payload: dict[str, Any]) -> None:
    if not webhook:
        return
    # A daemon thread keeps the sweep response off the webhook's latency.
    threading.Thread(target=_post_alert, args=(webhook, payload), daemon=True).start()


def _alert_payload(target: sqlite3.Row, drift: dict[str, Any], findings: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "event": "aegis.drift_detected",
        "client_name": target["client_name"],
        "url": target["url"],
        "label": target["label"],
        "checked_at": drift["checkedAt"],
        "open_gaps_count": drift["openGapsCount"],
        "high_gaps_count": drift["highGapsCount"],
        "top_redline": _redline_snippet(findings),
        "audit_doc_id": drift["auditDocId"],
    }


# --------------------------------------------------------------------------- #
# The sweep
# --------------------------------------------------------------------------- #


def _default_audit(text: str, source: str) -> tuple[list[dict[str, Any]], str | None]:
    return auditor.audit_document(text, source=source), None


def _save_snapshot(
    *,
    target_id: str,
    checked_at: str,
    digest: str,
    drift_detected: bool,
    summary: str | None,
    audit_doc_id: str | None,
    open_gaps: int,
    high_gaps: int,
) -> str:
    snapshot_id = uuid.uuid4().hex[:12]
    with _lock:
        db = _db()
        db.execute(
            "INSERT INTO monitoring_snapshots (id, target_id, checked_at, content_hash,"
            " drift_detected, diff_summary, audit_doc_id, open_gaps_count, high_gaps_count)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                snapshot_id,
                target_id,
                checked_at,
                digest,
                1 if drift_detected else 0,
                summary,
                audit_doc_id,
                open_gaps,
                high_gaps,
            ),
        )
        db.commit()
    return snapshot_id


def _mark(target_id: str, *, checked_at: str, status: str, digest: str | None = None) -> None:
    assignments = ["last_checked_at = ?", "last_status = ?"]
    values: list[Any] = [checked_at, status]
    if digest is not None:
        assignments.append("last_hash = ?")
        values.append(digest)
    values.append(target_id)
    with _lock:
        db = _db()
        db.execute(f"UPDATE monitored_targets SET {', '.join(assignments)} WHERE id = ?", values)
        db.commit()


def check_target_drift(
    target_id: str,
    *,
    audit: AuditFn | None = None,
    notify: bool = True,
) -> dict[str, Any]:
    """Check one target, auditing only when its content actually changed.

    An unchanged hash costs no tokens: the check logs a clean snapshot and
    returns. A changed or first-seen page runs the five-part remediation audit,
    logs a drifted snapshot with its gap counts, and fires the webhook if one is
    configured.
    """
    target = _target_row(target_id)
    checked_at = _now()

    try:
        text = _fetch_target_text(target["url"], target["label"])
    except fetcher.FetchError as exc:
        _mark(target_id, checked_at=checked_at, status=STATUS_ERROR)
        return _result(target, checked_at, STATUS_ERROR, drift=False, error=exc.message)
    except Exception as exc:  # noqa: BLE001 - one bad page must not stop a nightly sweep
        _mark(target_id, checked_at=checked_at, status=STATUS_ERROR)
        return _result(target, checked_at, STATUS_ERROR, drift=False, error=f"{type(exc).__name__}: {exc}")

    digest = content_hash(text)
    previous_hash = target["last_hash"]

    if previous_hash and previous_hash == digest:
        # Zero-token path. Keep the last known gap counts so the timeline does
        # not read as "no gaps" just because the page has not moved.
        previous = _latest_snapshot(target_id)
        open_gaps = previous["openGapsCount"] if previous else 0
        high_gaps = previous["highGapsCount"] if previous else 0
        _save_snapshot(
            target_id=target_id,
            checked_at=checked_at,
            digest=digest,
            drift_detected=False,
            summary=None,
            audit_doc_id=None,
            open_gaps=open_gaps,
            high_gaps=high_gaps,
        )
        _mark(target_id, checked_at=checked_at, status=STATUS_CLEAN)
        return _result(
            target,
            checked_at,
            STATUS_CLEAN,
            drift=False,
            open_gaps=open_gaps,
            high_gaps=high_gaps,
            content_hash=digest,
        )

    try:
        findings, audit_doc_id = (audit or _default_audit)(
            text, f"{target['label']} — {target['url']}"
        )
    except Exception as exc:  # noqa: BLE001 - the failure belongs in the row
        _mark(target_id, checked_at=checked_at, status=STATUS_ERROR)
        return _result(target, checked_at, STATUS_ERROR, drift=False, error=f"{type(exc).__name__}: {exc}")

    open_gaps, high_gaps = _gap_counts(findings)
    summary = diff_summary(previous_hash, digest, len(text))
    _save_snapshot(
        target_id=target_id,
        checked_at=checked_at,
        digest=digest,
        drift_detected=True,
        summary=summary,
        audit_doc_id=audit_doc_id,
        open_gaps=open_gaps,
        high_gaps=high_gaps,
    )
    _mark(target_id, checked_at=checked_at, status=STATUS_DRIFT, digest=digest)

    result = _result(
        target,
        checked_at,
        STATUS_DRIFT,
        drift=True,
        open_gaps=open_gaps,
        high_gaps=high_gaps,
        content_hash=digest,
        audit_doc_id=audit_doc_id,
        summary=summary,
        llm_calls=1,
        text=text,
    )
    if notify and target["alert_webhook_url"]:
        _notify(target["alert_webhook_url"], _alert_payload(target, result, findings))
    return result


def _result(
    target: sqlite3.Row,
    checked_at: str,
    status: str,
    *,
    drift: bool,
    open_gaps: int = 0,
    high_gaps: int = 0,
    content_hash: str | None = None,
    audit_doc_id: str | None = None,
    summary: str | None = None,
    llm_calls: int = 0,
    text: str = "",
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "targetId": target["id"],
        "clientName": target["client_name"],
        "url": target["url"],
        "label": target["label"],
        "checkedAt": checked_at,
        "status": status,
        "driftDetected": drift,
        "contentHash": content_hash,
        "diffSummary": summary,
        "auditDocId": audit_doc_id,
        "openGapsCount": open_gaps,
        "highGapsCount": high_gaps,
        "llmCalls": llm_calls,
        # Estimated, not measured: the shared TokenBudget is what actually
        # throttles the call. A clean check reports the honest 0.
        "tokensUsed": (
            auditor.estimate_tokens(text) + auditor.DEFAULT_MAX_OUTPUT_TOKENS if llm_calls else 0
        ),
        "error": error,
    }


def sweep_all(*, audit: AuditFn | None = None, notify: bool = True) -> dict[str, Any]:
    """Check every active target in turn and return a nightly digest.

    Targets run sequentially, so each audit's reservation lands in the shared
    ``TokenBudget`` window and a large nightly batch paces itself instead of
    firing every audit at once.
    """
    targets = list_targets(active_only=True)
    results: list[dict[str, Any]] = []
    for target in targets:
        try:
            results.append(check_target_drift(target["id"], audit=audit, notify=notify))
        except Exception as exc:  # noqa: BLE001 - one target must not sink the digest
            results.append(
                {
                    "targetId": target["id"],
                    "clientName": target["clientName"],
                    "url": target["url"],
                    "label": target["label"],
                    "status": STATUS_ERROR,
                    "driftDetected": False,
                    "openGapsCount": 0,
                    "highGapsCount": 0,
                    "llmCalls": 0,
                    "tokensUsed": 0,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )

    clean = sum(1 for item in results if item["status"] == STATUS_CLEAN)
    drifted = sum(1 for item in results if item["status"] == STATUS_DRIFT)
    errored = sum(1 for item in results if item["status"] == STATUS_ERROR)
    # Every row carries its target's current gap state, including clean rows,
    # so the digest totals are the whole monitored estate, not just today's drift.
    open_gaps = sum(item["openGapsCount"] for item in results)
    high_gaps = sum(item["highGapsCount"] for item in results)
    tokens = sum(item["tokensUsed"] for item in results)

    parts = [
        f"{len(results)} target{'s' if len(results) != 1 else ''}",
        f"{drifted} drifted",
        f"{clean} clean",
    ]
    if errored:
        parts.append(f"{errored} error{'s' if errored != 1 else ''}")
    if drifted:
        parts.append(f"{open_gaps} open gaps ({high_gaps} high)")

    return {
        "sweptAt": _now(),
        "targetsChecked": len(results),
        "clean": clean,
        "drifted": drifted,
        "errored": errored,
        "openGaps": open_gaps,
        "highGaps": high_gaps,
        "tokensUsed": tokens,
        "results": results,
        "summary": "Aegis nightly sweep: " + " · ".join(parts) + ".",
    }
