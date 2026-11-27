"""Aegis dashboard server: upload a policy, audit it, browse the results.

Serves the React workspace out of ``dist`` and a small JSON API over the same
audit engine the CLI uses. An uploaded PDF, DOCX or TXT is cleaned, truncated
to the free-tier document cap, and graded against every rubric in ``rules.py``.

State lives in a local SQLite file (``data/aegis.db``). Policy text never
leaves the machine except in the Groq call the auditor already makes.

    python server.py            # http://127.0.0.1:8000  (needs `npm run build`)
    python server.py --port 8100
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

import artifacts
import auditor
import console
import diff_engine
import fetcher
import monitoring
import redteam
import reporter
from rules import NA_STATUS, OPEN_STATUSES, REGULATIONS
from scraper import DEFAULT_MAX_CHARS, Section, format_sections_report, kind_for_path

load_dotenv()

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
DB_PATH = Path(os.getenv("AEGIS_DB") or ROOT / "data" / "aegis.db")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MIN_DOCUMENT_CHARS = 100
FILE_TYPES = {".pdf": "pdf", ".docx": "docx", ".txt": "txt", ".md": "md"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS briefs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS url_snapshots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    final_url TEXT NOT NULL,
    title TEXT NOT NULL,
    status INTEGER NOT NULL,
    chars INTEGER NOT NULL,
    truncated INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diffs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redteam_runs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    mode TEXT NOT NULL,
    target TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redteam_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    probe_id TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    observed TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    company TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    chars INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    audited_at TEXT,
    status TEXT NOT NULL,
    error TEXT,
    source TEXT NOT NULL,
    text TEXT NOT NULL,
    clause_report TEXT,
    findings TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _db() -> sqlite3.Connection:
    """One connection for the process, guarded by ``_lock``."""
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(_SCHEMA)
        # Databases created before clause selection existed gain the column
        # here; old rows keep NULL and the UI simply omits the indicator.
        columns = {row[1] for row in _conn.execute("PRAGMA table_info(documents)")}
        if "clause_report" not in columns:
            _conn.execute("ALTER TABLE documents ADD COLUMN clause_report TEXT")
        _conn.commit()
    return _conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


_INVALID_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_stem(name: str) -> str:
    """Reduce an uploaded filename to an ASCII, header-safe download stem.

    A quote, newline or non-Latin-1 character in the original name would
    otherwise corrupt or split the Content-Disposition header.
    """
    stem = _INVALID_FILENAME_CHARS.sub("-", Path(name).stem).strip("-._")
    return (stem or "report")[:80]


def _row(document_id: str) -> sqlite3.Row | None:
    with _lock:
        return _db().execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()


def _rows() -> list[sqlite3.Row]:
    with _lock:
        return list(_db().execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall())


def _update(document_id: str, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    with _lock:
        _db().execute(
            f"UPDATE documents SET {assignments} WHERE id = ?",
            (*fields.values(), document_id),
        )
        _db().commit()


def _findings(row: sqlite3.Row) -> list[dict[str, str]]:
    if not row["findings"]:
        return []
    try:
        parsed = json.loads(row["findings"])
    except json.JSONDecodeError:
        return []
    return reporter.parse_findings(parsed)


def _counts(findings: list[dict[str, str]]) -> dict[str, int]:
    def count(status: str) -> int:
        return sum(1 for finding in findings if finding["status"] == status)

    fails = count("Fail")
    warnings = count("Warning")
    return {
        "fail": fails,
        "warning": warnings,
        "pass": count("Pass"),
        "na": count(NA_STATUS),
        "open": fails + warnings,
        "graded": sum(1 for finding in findings if finding["status"] in OPEN_STATUSES or finding["status"] == "Pass"),
    }


def _summary(row: sqlite3.Row) -> dict[str, Any]:
    findings = _findings(row)
    return {
        "id": row["id"],
        "name": row["name"],
        "fileType": row["file_type"],
        "sizeBytes": row["size_bytes"],
        "chars": row["chars"],
        "createdAt": row["created_at"],
        "auditedAt": row["audited_at"],
        "status": row["status"],
        "error": row["error"],
        "counts": _counts(findings),
        "regulations": [
            {
                "id": finding.get("regulation_id", ""),
                "name": finding["regulation"],
                "status": finding["status"],
                "severity": finding["severity"],
            }
            for finding in findings
        ],
    }


def _clause_report(row: sqlite3.Row) -> dict[str, Any] | None:
    """What the character cap kept for this document, when it was recorded."""
    raw = row["clause_report"] if "clause_report" in row.keys() else None
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _detail(row: sqlite3.Row) -> dict[str, Any]:
    payload = _summary(row)
    findings = _findings(row)
    payload["findings"] = findings
    payload["source"] = row["source"]
    payload["clauseReport"] = _clause_report(row)
    if findings:
        payload["reports"] = {
            "full": reporter.render_full_report(findings, row["source"]),
            "teaser": reporter.render_teaser_report(findings, row["source"]),
        }
    return payload


# --------------------------------------------------------------------------- #
# Text extraction
# --------------------------------------------------------------------------- #


def _pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - install issue, surfaced in the UI
        raise HTTPException(500, "pypdf is not installed; run pip install -r requirements.txt") from exc
    try:
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:  # noqa: BLE001 - corrupted PDFs are user input
        raise HTTPException(422, f"Could not read this PDF ({type(exc).__name__}). Is it encrypted or damaged?") from exc


def _docx_text(data: bytes) -> str:
    try:
        from docx import Document
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(500, "python-docx is not installed; run pip install -r requirements.txt") from exc
    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Could not read this DOCX ({type(exc).__name__}). Is it a Word document?") from exc

    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(parts)


def _plain_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_text(name: str, data: bytes) -> str:
    """Return readable text from an uploaded policy, or raise a 4xx."""
    suffix = Path(name).suffix.lower()
    file_type = FILE_TYPES.get(suffix)
    if file_type is None:
        raise HTTPException(415, f"Unsupported file type {suffix or '(none)'}. Upload a PDF, DOCX or TXT file.")

    if file_type == "pdf":
        raw = _pdf_text(data)
    elif file_type == "docx":
        raw = _docx_text(data)
    else:
        raw = _plain_text(data)

    text = re.sub(r"\s+", " ", raw).strip()
    if len(text) < MIN_DOCUMENT_CHARS:
        raise HTTPException(
            422,
            "This file has almost no readable text. Scanned or image-only PDFs need OCR before they can be audited.",
        )
    return text


def _document_text(name: str, text: str) -> tuple[str, dict[str, Any]]:
    """Tag the upload the way the scraper tags a page, so scope reading works.

    Returns the text the auditor receives plus what the 10,000-character cap
    kept, so the audit UI can show whether high-signal clauses were prioritised.
    """
    section = Section(kind_for_path(name), name, text)
    document_text, selection = format_sections_report([section], max_chars=DEFAULT_MAX_CHARS)
    return document_text, selection.public()


# --------------------------------------------------------------------------- #
# Auditing
# --------------------------------------------------------------------------- #


def _run_audit(document_id: str, document_text: str, source: str) -> None:
    """Grade one document; never raises into the background task."""
    _update(document_id, status="auditing", error=None)
    try:
        findings = auditor.audit_document(document_text, source=source)
    except Exception as exc:  # noqa: BLE001 - the failure belongs in the row
        _update(document_id, status="error", error=f"{type(exc).__name__}: {exc}")
        return
    _update(
        document_id,
        status="ready",
        findings=json.dumps(findings),
        audited_at=_now(),
        error=None,
    )


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #

app = FastAPI(title="Aegis", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": auditor.active_models()["deep"],
        "screeningModel": auditor.active_models()["fast"],
        "keyConfigured": bool(os.getenv("GROQ_API_KEY")),
        "maxChars": DEFAULT_MAX_CHARS,
        "maxUploadBytes": MAX_UPLOAD_BYTES,
        # Audits share one sliding window, so this is the whole process's spend.
        "tokenBudget": auditor.shared_budget().snapshot(),
        "regulations": [{"id": key, "name": REGULATIONS[key]["name"], "focus": REGULATIONS[key]["focus"]} for key in REGULATIONS],
        "frameworks": diff_engine.framework_catalog(),
        "redteamProbes": redteam.probe_catalog(),
        "artifactKinds": [
            {"id": key, "title": meta["title"], "purpose": meta["purpose"]}
            for key, meta in artifacts.KINDS.items()
        ],
        "fetchLimits": {
            "maxBytes": fetcher.MAX_BYTES,
            "maxChars": fetcher.KIND_MAX_CHARS,
            "timeoutSeconds": fetcher.DEFAULT_TIMEOUT,
            "maxProbeResponseBytes": redteam.MAX_RESPONSE_BYTES,
        },
    }


# --------------------------------------------------------------------------- #
# Dev console: model routing and the tool bench
# --------------------------------------------------------------------------- #


def _model_settings() -> dict[str, str]:
    """The models this process routes to, falling back to shipped defaults."""
    defaults = {"deep": auditor.MODEL, "fast": auditor.MODEL_FAST}
    with _lock:
        rows = _db().execute("SELECT key, value FROM settings WHERE key LIKE 'model.%'").fetchall()
    saved = {row["key"].split(".", 1)[1]: row["value"] for row in rows}
    return {role: saved.get(role) or model for role, model in defaults.items()}


def _save_models(deep: str, fast: str) -> None:
    now = _now()
    with _lock:
        for role, model in (("deep", deep), ("fast", fast)):
            _db().execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (f"model.{role}", model, now),
            )
        _db().commit()


def _restore_models() -> None:
    """Reapply the previous session's choice before anything can run."""
    try:
        saved = _model_settings()
    except sqlite3.Error as exc:  # a locked or unreadable file must not stop the API
        print(f"[server] could not read the saved model choice: {exc}")
        return
    auditor.configure_models(deep=saved["deep"], fast=saved["fast"])


def _table_stats(table: str) -> dict[str, Any]:
    if table not in console.TABLE_NAMES:
        raise ValueError(f"Unknown console table {table!r}")
    with _lock:
        row = _db().execute(f"SELECT COUNT(*) AS records, MAX(created_at) AS latest FROM {table}").fetchone()
    return {"count": row["records"], "latest": row["latest"]}


def _activity(limit: int = 12) -> list[dict[str, Any]]:
    """Every stored run, newest first, in the shape the ledger renders."""

    def stored(raw: str | None) -> dict[str, Any]:
        try:
            parsed = json.loads(raw or "")
        except (json.JSONDecodeError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}

    items: list[dict[str, Any]] = []
    with _lock:
        db = _db()
        for row in db.execute("SELECT id, name, status, created_at FROM documents").fetchall():
            items.append(
                {
                    "id": row["id"],
                    "kind": "Policy audit",
                    "title": row["name"],
                    "detail": row["status"],
                    "createdAt": row["created_at"],
                    "href": f"/documents/{row['id']}",
                }
            )
        for row in db.execute("SELECT id, company, created_at, payload FROM briefs").fetchall():
            gaps = stored(row["payload"]).get("gaps") or []
            items.append(
                {
                    "id": row["id"],
                    "kind": "Mini-audit",
                    "title": row["company"],
                    "detail": f"{len(gaps)} gaps",
                    "createdAt": row["created_at"],
                    "href": f"/brief/{row['id']}",
                }
            )
        for row in db.execute("SELECT id, company, created_at, payload FROM diffs").fetchall():
            counts = stored(row["payload"]).get("counts") or {}
            items.append(
                {
                    "id": row["id"],
                    "kind": "Footprint audit",
                    "title": row["company"],
                    "detail": f"{counts.get('critical', 0)} critical, {counts.get('high', 0)} high",
                    "createdAt": row["created_at"],
                    "href": f"/diff/{row['id']}",
                }
            )
        for row in db.execute("SELECT id, company, mode, created_at, payload FROM redteam_runs").fetchall():
            counts = stored(row["payload"]).get("counts") or {}
            items.append(
                {
                    "id": row["id"],
                    "kind": "Red team",
                    "title": row["company"],
                    "detail": f"{row['mode']}, {counts.get('fail', 0)} of {counts.get('total', 0)} failed",
                    "createdAt": row["created_at"],
                    "href": f"/redteam/{row['id']}",
                }
            )
        for row in db.execute("SELECT id, company, kind, created_at, payload FROM artifacts").fetchall():
            items.append(
                {
                    "id": row["id"],
                    "kind": "Fix artifact",
                    "title": row["company"],
                    "detail": stored(row["payload"]).get("title") or row["kind"],
                    "createdAt": row["created_at"],
                    "href": f"/artifacts/{row['id']}",
                }
            )
    items.sort(key=lambda item: str(item["createdAt"] or ""), reverse=True)
    return items[:limit]


def _console_payload() -> dict[str, Any]:
    models = _model_settings()
    return {
        "models": {
            "deep": models["deep"],
            "fast": models["fast"],
            "defaults": {"deep": auditor.MODEL, "fast": auditor.MODEL_FAST},
            "budgetTpm": auditor.TPM_LIMIT,
            "catalog": console.model_catalog(),
        },
        "budget": auditor.shared_budget().snapshot(),
        "keyConfigured": bool(os.getenv("GROQ_API_KEY")),
        "tools": [{**tool, "records": _table_stats(tool["table"])} for tool in console.TOOLS],
        "activity": _activity(),
        "limits": {
            "maxChars": DEFAULT_MAX_CHARS,
            "maxUploadBytes": MAX_UPLOAD_BYTES,
            "redteamProbes": len(redteam.PROBES),
            "rubrics": len(REGULATIONS),
            "artifactKinds": len(artifacts.KINDS),
            "fetchTimeoutSeconds": int(fetcher.DEFAULT_TIMEOUT),
        },
        "checkedAt": _now(),
    }


_restore_models()


@app.get("/api/console")
def console_overview() -> dict[str, Any]:
    return _console_payload()


@app.put("/api/console/models")
def update_models(payload: dict[str, Any]) -> dict[str, Any]:
    """Switch the model every later engine call routes to, and remember it."""
    current = _model_settings()
    try:
        # A missing channel keeps its current model; an empty one is a client bug.
        deep = console.validate_model_id(payload.get("deep", current["deep"]))
        fast = console.validate_model_id(payload.get("fast", current["fast"]))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _save_models(deep, fast)
    auditor.configure_models(deep=deep, fast=fast)
    return _console_payload()


@app.get("/api/documents")
def list_documents() -> dict[str, Any]:
    return {"documents": [_summary(row) for row in _rows()]}


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    rows = _rows()
    summaries = [_summary(row) for row in rows]
    open_total = sum(item["counts"]["open"] for item in summaries)
    high = sum(
        1
        for item in summaries
        for finding in item["regulations"]
        if finding["status"] in OPEN_STATUSES and finding["severity"] == "High"
    )
    audited = [item["auditedAt"] for item in summaries if item["auditedAt"]]
    return {
        "documents": len(summaries),
        "open": open_total,
        "high": high,
        "na": sum(item["counts"]["na"] for item in summaries),
        "audited": sum(1 for item in summaries if item["status"] == "ready"),
        "lastAuditedAt": max(audited) if audited else None,
    }


@app.post("/api/documents", status_code=201)
async def upload_document(background: BackgroundTasks, file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    name = Path(file.filename or "policy.txt").name
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Files must be 10 MB or smaller.")

    text = extract_text(name, data)
    document_text, clause_report = _document_text(name, text)
    document_id = uuid.uuid4().hex[:12]
    source = f"{name} (upload)"
    with _lock:
        _db().execute(
            "INSERT INTO documents (id, name, file_type, size_bytes, chars, created_at, status, source, text, clause_report)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                document_id,
                name,
                FILE_TYPES[Path(name).suffix.lower()],
                len(data),
                len(text),
                _now(),
                "queued",
                source,
                document_text,
                json.dumps(clause_report),
            ),
        )
        _db().commit()

    background.add_task(_run_audit, document_id, document_text, source)
    row = _row(document_id)
    assert row is not None
    return _summary(row)


@app.get("/api/documents/{document_id}")
def get_document(document_id: str) -> dict[str, Any]:
    row = _row(document_id)
    if row is None:
        raise HTTPException(404, "No such document.")
    return _detail(row)


@app.post("/api/documents/{document_id}/audit", status_code=202)
def reaudit(document_id: str, background: BackgroundTasks) -> dict[str, Any]:
    row = _row(document_id)
    if row is None:
        raise HTTPException(404, "No such document.")
    if row["status"] == "auditing":
        raise HTTPException(409, "This document is already being audited.")
    _update(document_id, status="queued", error=None)
    background.add_task(_run_audit, document_id, row["text"], row["source"])
    fresh = _row(document_id)
    assert fresh is not None
    return _summary(fresh)


@app.post("/api/brief", status_code=201)
def create_brief(payload: dict[str, Any]) -> dict[str, Any]:
    """Compare homepage copy with the privacy policy into a 1-page brief."""
    company = str(payload.get("company") or "").strip()
    url = str(payload.get("url") or "").strip()
    homepage = str(payload.get("homepage") or "").strip()
    privacy = str(payload.get("privacy") or "").strip()

    if not company:
        raise HTTPException(400, "Enter the company name (and URL if you have it).")
    if len(homepage) < 40:
        raise HTTPException(400, "Paste at least a few sentences of homepage or product copy.")
    if len(privacy) < 40:
        raise HTTPException(400, "Paste at least a few sentences of the privacy policy.")

    try:
        brief = auditor.generate_brief(company, url, homepage, privacy)
    except Exception as exc:  # noqa: BLE001 - the UI shows one clean message
        raise HTTPException(502, f"The mini-audit failed: {type(exc).__name__}: {exc}") from exc

    brief_id = uuid.uuid4().hex[:12]
    created_at = _now()
    brief["id"] = brief_id
    brief["createdAt"] = created_at
    with _lock:
        _db().execute(
            "INSERT INTO briefs (id, company, url, created_at, payload) VALUES (?, ?, ?, ?, ?)",
            (brief_id, company, url, created_at, json.dumps(brief)),
        )
        _db().commit()
    return brief


@app.get("/api/briefs/{brief_id}")
def get_brief(brief_id: str) -> dict[str, Any]:
    with _lock:
        row = _db().execute("SELECT payload FROM briefs WHERE id = ?", (brief_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such mini-audit.")
    payload = json.loads(row["payload"])
    payload["id"] = brief_id
    return payload


# --------------------------------------------------------------------------- #
# Footprint audit: live sources + claim-vs-policy diff
# --------------------------------------------------------------------------- #


def _snapshot(snapshot_id: str, kind: str) -> sqlite3.Row | None:
    if not snapshot_id:
        return None
    with _lock:
        row = _db().execute("SELECT * FROM url_snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"The saved {kind} snapshot no longer exists. Fetch or paste it again.")
    return row


def _stored_payload(table: str, row_id: str) -> dict[str, Any] | None:
    """Load a stored JSON payload from a known table name."""
    if not row_id:
        return None
    if table not in ("diffs", "redteam_runs", "artifacts", "briefs"):
        raise ValueError(f"Unsupported table {table!r}")
    with _lock:
        row = _db().execute(f"SELECT payload FROM {table} WHERE id = ?", (row_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"No such {table[:-1].replace('_', ' ')}.")
    try:
        return json.loads(row["payload"])
    except json.JSONDecodeError:
        return None


@app.post("/api/fetch")
def fetch_sources(payload: dict[str, Any]) -> dict[str, Any]:
    """Fetch up to three public pages and return cleaned text for the audit.

    A blocked or empty page is reported per source rather than failing the
    request, because the workspace falls back to manual paste for that one box.
    """
    raw_urls = payload.get("urls") if isinstance(payload.get("urls"), dict) else payload
    targets = {kind: str(raw_urls.get(kind) or "").strip() for kind in fetcher.PAGE_KINDS}
    if not any(targets.values()):
        raise HTTPException(400, "Enter at least one URL to fetch.")

    snapshots, errors = fetcher.fetch_many(targets)
    saved: list[dict[str, Any]] = []
    for snapshot in snapshots:
        snapshot_id = uuid.uuid4().hex[:12]
        with _lock:
            _db().execute(
                "INSERT INTO url_snapshots (id, kind, url, final_url, title, status, chars, truncated, created_at, text)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    snapshot_id,
                    snapshot.kind,
                    snapshot.url,
                    snapshot.final_url,
                    snapshot.title,
                    snapshot.status,
                    snapshot.chars,
                    1 if snapshot.truncated else 0,
                    snapshot.fetched_at,
                    snapshot.text,
                ),
            )
            _db().commit()
        item = {"id": snapshot_id, **snapshot.public()}
        saved.append(item)

    return {
        "snapshots": saved,
        "errors": errors,
        "limits": {
            "maxBytes": fetcher.MAX_BYTES,
            "maxChars": fetcher.KIND_MAX_CHARS,
            "timeoutSeconds": fetcher.DEFAULT_TIMEOUT,
        },
    }


@app.post("/api/diffs", status_code=201)
def create_diff(payload: dict[str, Any]) -> dict[str, Any]:
    """Compare public claims with the privacy policy into a severity-rated diff."""
    company = str(payload.get("company") or "").strip()
    url = str(payload.get("url") or "").strip()
    claims = str(payload.get("claims") or "").strip()
    policy = str(payload.get("policy") or "").strip()
    claims_source = str(payload.get("claimsSource") or "").strip()
    policy_source = str(payload.get("policySource") or "").strip()

    claims_row = _snapshot(str(payload.get("claimsSnapshotId") or ""), "claims")
    if claims_row is not None:
        claims = claims or claims_row["text"]
        claims_source = claims_source or claims_row["final_url"]
    policy_row = _snapshot(str(payload.get("policySnapshotId") or ""), "policy")
    if policy_row is not None:
        policy = policy or policy_row["text"]
        policy_source = policy_source or policy_row["final_url"]

    if not company:
        raise HTTPException(400, "Enter the company name.")
    if len(claims) < 40:
        raise HTTPException(400, "Add at least a few sentences of homepage, product or pricing copy.")
    if len(policy) < 40:
        raise HTTPException(400, "Add at least a few sentences of the privacy policy.")

    try:
        result = diff_engine.generate_diff(
            company,
            url,
            claims,
            policy,
            claims_source=claims_source,
            policy_source=policy_source,
        )
    except Exception as exc:  # noqa: BLE001 - one clean message for the UI
        raise HTTPException(502, f"The footprint audit failed: {type(exc).__name__}: {exc}") from exc

    diff_id = uuid.uuid4().hex[:12]
    result["id"] = diff_id
    result["createdAt"] = _now()
    with _lock:
        _db().execute(
            "INSERT INTO diffs (id, company, created_at, payload) VALUES (?, ?, ?, ?)",
            (diff_id, company, result["createdAt"], json.dumps(result)),
        )
        _db().commit()
    return result


@app.get("/api/diffs")
def list_diffs() -> dict[str, Any]:
    with _lock:
        rows = _db().execute("SELECT id, company, created_at, payload FROM diffs ORDER BY created_at DESC").fetchall()
    items = []
    for row in rows:
        try:
            stored = json.loads(row["payload"])
        except json.JSONDecodeError:
            continue
        items.append(
            {
                "id": row["id"],
                "company": row["company"],
                "createdAt": row["created_at"],
                "summary": stored.get("summary", ""),
                "counts": stored.get("counts", {"critical": 0, "high": 0, "medium": 0}),
            }
        )
    return {"diffs": items}


@app.get("/api/diffs/{diff_id}")
def get_diff(diff_id: str) -> dict[str, Any]:
    stored = _stored_payload("diffs", diff_id)
    if stored is None:
        raise HTTPException(404, "No such footprint audit.")
    stored["id"] = diff_id
    return stored


# --------------------------------------------------------------------------- #
# Red-team lab
# --------------------------------------------------------------------------- #


def _redteam_summary(row: sqlite3.Row) -> dict[str, Any]:
    try:
        stored = json.loads(row["payload"])
    except json.JSONDecodeError:
        stored = {}
    return {
        "id": row["id"],
        "company": row["company"],
        "mode": row["mode"],
        "target": row["target"],
        "createdAt": row["created_at"],
        "product": stored.get("product", ""),
        "counts": stored.get("counts", {"pass": 0, "fail": 0, "inconclusive": 0, "total": 0}),
    }


@app.post("/api/redteam", status_code=201)
def create_redteam_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Run the bounded probe suite against a live endpoint or a product spec."""
    company = str(payload.get("company") or "").strip()
    product = str(payload.get("product") or "").strip()
    mode = str(payload.get("mode") or "simulated").strip().lower()
    if not company:
        raise HTTPException(400, "Enter the company or product owner name.")

    raw_probes = payload.get("probes")
    probe_ids = [str(item) for item in raw_probes] if isinstance(raw_probes, list) else None

    try:
        run = redteam.run_redteam(
            company,
            product,
            mode=mode,
            endpoint=str(payload.get("endpoint") or "").strip(),
            headers=payload.get("headers") or "",
            model=str(payload.get("model") or "").strip(),
            spec=str(payload.get("spec") or "").strip(),
            probe_ids=probe_ids,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except redteam.TargetError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"The red-team run failed: {type(exc).__name__}: {exc}") from exc

    run_id = uuid.uuid4().hex[:12]
    created_at = _now()
    run["id"] = run_id
    run["createdAt"] = created_at

    with _lock:
        _db().execute(
            "INSERT INTO redteam_runs (id, company, mode, target, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
            (run_id, company, mode, run["target"], created_at, json.dumps(run)),
        )
        for result in run["results"]:
            _db().execute(
                "INSERT INTO redteam_results (run_id, probe_id, category, status, observed, payload)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    run_id,
                    result["probeId"],
                    result["category"],
                    result["status"],
                    result["observed"],
                    json.dumps(result),
                ),
            )
        _db().commit()
    return run


@app.get("/api/redteam")
def list_redteam_runs() -> dict[str, Any]:
    with _lock:
        rows = _db().execute(
            "SELECT id, company, mode, target, created_at, payload FROM redteam_runs ORDER BY created_at DESC"
        ).fetchall()
    return {"runs": [_redteam_summary(row) for row in rows]}


@app.get("/api/redteam/{run_id}")
def get_redteam_run(run_id: str) -> dict[str, Any]:
    stored = _stored_payload("redteam_runs", run_id)
    if stored is None:
        raise HTTPException(404, "No such red-team run.")
    stored["id"] = run_id
    with _lock:
        rows = _db().execute(
            "SELECT payload FROM redteam_results WHERE run_id = ? ORDER BY id", (run_id,)
        ).fetchall()
    # The per-result table is the transcript of record; fall back to the payload
    # only if a row was written before the results were persisted.
    transcripts = []
    for row in rows:
        try:
            transcripts.append(json.loads(row["payload"]))
        except json.JSONDecodeError:
            continue
    if transcripts:
        stored["results"] = transcripts
    return stored


# --------------------------------------------------------------------------- #
# Fix artifacts
# --------------------------------------------------------------------------- #


def _artifact_summary(row: sqlite3.Row) -> dict[str, Any]:
    try:
        stored = json.loads(row["payload"])
    except json.JSONDecodeError:
        stored = {}
    return {
        "id": row["id"],
        "kind": row["kind"],
        "company": row["company"],
        "createdAt": row["created_at"],
        "title": stored.get("title", ""),
        "placeholders": stored.get("placeholders", []),
    }


@app.post("/api/artifacts", status_code=201)
def create_artifact(payload: dict[str, Any]) -> dict[str, Any]:
    """Generate an operational draft from stored audit evidence."""
    kind = str(payload.get("kind") or "").strip()
    company = str(payload.get("company") or "").strip()
    product = str(payload.get("product") or "").strip()
    if not company:
        raise HTTPException(400, "Enter the company name.")
    if kind not in artifacts.KINDS:
        raise HTTPException(400, f"Choose one of: {', '.join(artifacts.KIND_IDS)}.")

    diff_id = str(payload.get("diffId") or "").strip()
    run_id = str(payload.get("redteamRunId") or "").strip()
    brief_id = str(payload.get("briefId") or "").strip()
    diff = _stored_payload("diffs", diff_id)
    run = _stored_payload("redteam_runs", run_id)
    brief = _stored_payload("briefs", brief_id)

    evidence = artifacts.evidence_from_findings(diff=diff, redteam=run, brief=brief)
    if not evidence and not product:
        raise HTTPException(
            400,
            "Link a footprint audit or red-team run, or describe the product so the draft has context.",
        )

    try:
        artifact = artifacts.generate_artifact(
            kind,
            company,
            product,
            evidence=evidence,
            notes=str(payload.get("notes") or "").strip(),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"The draft could not be generated: {type(exc).__name__}: {exc}") from exc

    artifact_id = uuid.uuid4().hex[:12]
    sources = [
        name
        for name, value in (("footprint", diff_id), ("red-team", run_id), ("mini-audit", brief_id))
        if value
    ]
    artifact["id"] = artifact_id
    artifact["company"] = company
    artifact["product"] = product
    artifact["sources"] = sources
    artifact["createdAt"] = _now()
    with _lock:
        _db().execute(
            "INSERT INTO artifacts (id, kind, company, created_at, payload) VALUES (?, ?, ?, ?, ?)",
            (artifact_id, kind, company, artifact["createdAt"], json.dumps(artifact)),
        )
        _db().commit()
    return artifact


@app.get("/api/artifacts")
def list_artifacts() -> dict[str, Any]:
    with _lock:
        rows = _db().execute("SELECT id, kind, company, created_at, payload FROM artifacts ORDER BY created_at DESC").fetchall()
    return {"artifacts": [_artifact_summary(row) for row in rows]}


@app.get("/api/artifacts/{artifact_id}")
def get_artifact(artifact_id: str) -> dict[str, Any]:
    stored = _stored_payload("artifacts", artifact_id)
    if stored is None:
        raise HTTPException(404, "No such artifact.")
    stored["id"] = artifact_id
    return stored


@app.delete("/api/documents/{document_id}", status_code=204)
def delete_document(document_id: str) -> None:
    if _row(document_id) is None:
        raise HTTPException(404, "No such document.")
    with _lock:
        _db().execute("DELETE FROM documents WHERE id = ?", (document_id,))
        _db().commit()


@app.get("/api/documents/{document_id}/report", response_class=PlainTextResponse)
def download_report(document_id: str, kind: str = "full") -> PlainTextResponse:
    row = _row(document_id)
    if row is None:
        raise HTTPException(404, "No such document.")
    findings = _findings(row)
    if not findings:
        raise HTTPException(409, "Audit the document before downloading a report.")
    if kind not in ("full", "teaser"):
        raise HTTPException(400, "kind must be 'full' or 'teaser'.")
    body = (
        reporter.render_full_report(findings, row["source"])
        if kind == "full"
        else reporter.render_teaser_report(findings, row["source"])
    )
    stem = _safe_stem(row["name"])
    return PlainTextResponse(
        body,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{stem}-{kind}.md"'},
    )


# --------------------------------------------------------------------------- #
# Continuous external monitoring
# --------------------------------------------------------------------------- #


def _audit_monitored_page(text: str, source: str) -> tuple[list[dict[str, Any]], str]:
    """Grade a drifted page and keep it as a normal audited document.

    The saved row is what ``monitoring_snapshots.audit_doc_id`` points at, so a
    drift alert opens the same five-part remediation view as an upload.
    """
    findings = auditor.audit_document(text, source=source)
    document_id = uuid.uuid4().hex[:12]
    with _lock:
        _db().execute(
            "INSERT INTO documents (id, name, file_type, size_bytes, chars, created_at,"
            " audited_at, status, source, text, findings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                document_id,
                source[:120],
                "url",
                len(text.encode("utf-8")),
                len(text),
                _now(),
                _now(),
                "ready",
                source,
                text,
                json.dumps(findings),
            ),
        )
        _db().commit()
    return findings, document_id


@app.get("/api/monitoring/targets")
def list_monitoring_targets() -> dict[str, Any]:
    targets = monitoring.list_targets()
    return {
        "targets": targets,
        "counts": {
            "total": len(targets),
            "active": sum(1 for item in targets if item["active"]),
            "drifted": sum(1 for item in targets if item["lastStatus"] == monitoring.STATUS_DRIFT),
            "errors": sum(1 for item in targets if item["lastStatus"] == monitoring.STATUS_ERROR),
        },
    }


@app.post("/api/monitoring/targets", status_code=201)
def create_monitoring_target(payload: dict[str, Any]) -> dict[str, Any]:
    """Add a public URL (homepage, policy, terms, pricing, AI page) to watch."""
    try:
        url = fetcher.validate_public_url(str(payload.get("url") or ""))
    except fetcher.FetchError as exc:
        raise HTTPException(400, exc.message) from exc

    webhook = str(payload.get("alertWebhookUrl") or payload.get("alert_webhook_url") or "").strip()
    if webhook and urlparse(webhook).scheme.lower() not in ("http", "https"):
        raise HTTPException(400, "The alert webhook must be an http:// or https:// URL.")

    try:
        return monitoring.create_target(
            client_name=str(payload.get("clientName") or payload.get("client_name") or ""),
            url=url,
            label=str(payload.get("label") or "Website"),
            check_frequency=str(payload.get("checkFrequency") or payload.get("check_frequency") or "daily"),
            alert_webhook_url=webhook,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/monitoring/targets/{target_id}")
def delete_monitoring_target(target_id: str, purge: bool = False) -> dict[str, Any]:
    """Pause a target by default; ``?purge=true`` removes it and its history."""
    try:
        return monitoring.delete_target(target_id, purge=purge)
    except KeyError as exc:
        raise HTTPException(404, "No such monitored target.") from exc


@app.post("/api/monitoring/targets/{target_id}/sweep")
def sweep_monitoring_target(target_id: str) -> dict[str, Any]:
    """Immediate drift check, with a full audit only when the content moved."""
    try:
        return monitoring.check_target_drift(target_id, audit=_audit_monitored_page)
    except KeyError as exc:
        raise HTTPException(404, "No such monitored target.") from exc


# In-memory job store for asynchronous sweeps requested via ?async=true.
_sweep_jobs: dict[str, dict[str, Any]] = {}
_sweep_jobs_lock = threading.Lock()


def _execute_sweep_job(job_id: str) -> None:
    """Run a full sweep in the background and store its digest."""
    try:
        digest = monitoring.sweep_all(audit=_audit_monitored_page)
        with _sweep_jobs_lock:
            _sweep_jobs[job_id] = {
                "status": "completed",
                "digest": digest,
                "error": None,
                "completedAt": _now(),
            }
    except Exception as exc:  # noqa: BLE001 - a failed sweep is reported, not raised
        with _sweep_jobs_lock:
            _sweep_jobs[job_id] = {
                "status": "failed",
                "digest": None,
                "error": f"{type(exc).__name__}: {exc}",
                "completedAt": _now(),
            }


def sweep_all_monitoring_targets(
    async_mode: bool = False,
    background: BackgroundTasks = None,  # type: ignore[assignment]
) -> Any:
    """Nightly n8n entry point: every active target, one digest back.

    By default the sweep runs synchronously and returns the full digest. Pass
    ``?async=true`` to queue it as a background task and get a job id back
    immediately (useful for callers with a short HTTP timeout, such as n8n
    inside Docker); poll ``GET /api/monitoring/sweep-all/{job_id}`` for the
    result.
    """
    if not async_mode:
        return monitoring.sweep_all(audit=_audit_monitored_page)

    job_id = uuid.uuid4().hex[:12]
    with _sweep_jobs_lock:
        _sweep_jobs[job_id] = {
            "status": "running",
            "digest": None,
            "error": None,
            "createdAt": _now(),
        }
    if background is not None:
        background.add_task(_execute_sweep_job, job_id)
    else:
        threading.Thread(target=_execute_sweep_job, args=(job_id,), daemon=True).start()
    return JSONResponse(
        status_code=202,
        content={"jobId": job_id, "status": "accepted"},
    )


@app.post("/api/monitoring/sweep-all")
def _sweep_all_route(
    background: BackgroundTasks = None,  # type: ignore[assignment]
    async_mode: bool = Query(False, alias="async"),
) -> Any:
    """HTTP entry point; delegates to ``sweep_all_monitoring_targets``."""
    return sweep_all_monitoring_targets(
        async_mode=bool(async_mode), background=background
    )


@app.get("/api/monitoring/sweep-all/{job_id}")
def get_sweep_job(job_id: str) -> dict[str, Any]:
    """Poll an asynchronous sweep started with ``?async=true``."""
    with _sweep_jobs_lock:
        job = _sweep_jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "No such sweep job.")
    return {"jobId": job_id, **job}


@app.get("/api/monitoring/history")
def monitoring_history(limit: int = 50, target_id: str | None = None) -> dict[str, Any]:
    snapshots = monitoring.history(limit=limit, target_id=target_id)
    return {"snapshots": snapshots, "count": len(snapshots)}


# --------------------------------------------------------------------------- #
# Static workspace
# --------------------------------------------------------------------------- #

if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def workspace(path: str):
    """Serve the built SPA, falling back to index.html for client routes."""
    if path.startswith("api/"):
        raise HTTPException(404, "Unknown API route.")
    candidate = (DIST / path).resolve()
    if path and candidate.is_file() and DIST.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = DIST / "index.html"
    if index.is_file():
        return FileResponse(index)
    return JSONResponse(
        {"detail": "The workspace has not been built yet. Run `npm install && npm run build`, then reload."},
        status_code=503,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aegis compliance workspace")
    # Deliberately not read from PORT: shells and tooling often set it for
    # unrelated reasons, and the docs (and the Vite proxy) expect 8000.
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args(argv)
    if not os.getenv("GROQ_API_KEY"):
        print("[server] GROQ_API_KEY is missing; uploads will fail until it is in .env")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
