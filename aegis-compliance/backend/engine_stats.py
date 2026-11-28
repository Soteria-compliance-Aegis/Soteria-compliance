"""Read-only counts from the legacy engine tables (always SQLite).

The engine owns ``documents`` and ``monitored_targets``; this module only
reads them, lazily, through a short-lived read-only connection. A missing file
or table yields zeros instead of an error.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from . import db

FINDING_STATUSES = ("Fail", "Warning", "Pass", "N/A (Out of Scope)")
DRIFT_STATUS = "drift_detected"


def _empty() -> dict[str, Any]:
    return {
        "audits": 0,
        "open_gaps": 0,
        "high_gaps": 0,
        "monitored": 0,
        "drifted": 0,
        "findings_by_status": {status: 0 for status in FINDING_STATUSES},
    }


def collect() -> dict[str, Any]:
    stats = _empty()
    path = db.sqlite_path()
    if not path.is_file():
        return stats
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return stats
    try:
        try:
            rows = conn.execute("SELECT findings FROM documents WHERE findings IS NOT NULL").fetchall()
        except sqlite3.Error:
            rows = []
        stats["audits"] = len(rows)
        for (raw,) in rows:
            try:
                findings = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            for finding in findings if isinstance(findings, list) else []:
                if not isinstance(finding, dict):
                    continue
                status = finding.get("status")
                if status not in stats["findings_by_status"]:
                    continue
                stats["findings_by_status"][status] += 1
                if status in ("Fail", "Warning"):
                    stats["open_gaps"] += 1
                    if finding.get("severity") == "High":
                        stats["high_gaps"] += 1
        try:
            stats["monitored"] = conn.execute(
                "SELECT COUNT(*) FROM monitored_targets WHERE active = 1"
            ).fetchone()[0]
            stats["drifted"] = conn.execute(
                "SELECT COUNT(*) FROM monitored_targets WHERE active = 1 AND last_status = ?",
                (DRIFT_STATUS,),
            ).fetchone()[0]
        except sqlite3.Error:
            pass
    finally:
        conn.close()
    return stats
