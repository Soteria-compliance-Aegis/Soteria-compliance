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

import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

import auditor
import reporter
from rules import NA_STATUS, OPEN_STATUSES, REGULATIONS
from scraper import DEFAULT_MAX_CHARS, Section, format_sections, kind_for_path, truncate

load_dotenv()

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
DB_PATH = Path(os.getenv("AEGIS_DB") or ROOT / "data" / "aegis.db")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MIN_DOCUMENT_CHARS = 100
FILE_TYPES = {".pdf": "pdf", ".docx": "docx", ".txt": "txt", ".md": "md"}

_SCHEMA = """
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
    findings TEXT
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
        _conn.commit()
    return _conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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


def _detail(row: sqlite3.Row) -> dict[str, Any]:
    payload = _summary(row)
    findings = _findings(row)
    payload["findings"] = findings
    payload["source"] = row["source"]
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


def _document_text(name: str, text: str) -> str:
    """Tag the upload the way the scraper tags a page, so scope reading works."""
    section = Section(kind_for_path(name), name, truncate(text, DEFAULT_MAX_CHARS))
    return format_sections([section], max_chars=DEFAULT_MAX_CHARS)


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
        "model": auditor.MODEL,
        "screeningModel": auditor.MODEL_FAST,
        "keyConfigured": bool(os.getenv("GROQ_API_KEY")),
        "maxChars": DEFAULT_MAX_CHARS,
        "maxUploadBytes": MAX_UPLOAD_BYTES,
        # Audits share one sliding window, so this is the whole process's spend.
        "tokenBudget": auditor.shared_budget().snapshot(),
        "regulations": [{"id": key, "name": REGULATIONS[key]["name"], "focus": REGULATIONS[key]["focus"]} for key in REGULATIONS],
    }


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
    document_text = _document_text(name, text)
    document_id = uuid.uuid4().hex[:12]
    source = f"{name} (upload)"
    with _lock:
        _db().execute(
            "INSERT INTO documents (id, name, file_type, size_bytes, chars, created_at, status, source, text)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    stem = Path(row["name"]).stem
    return PlainTextResponse(
        body,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{stem}-{kind}.md"'},
    )


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
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args(argv)
    if not os.getenv("GROQ_API_KEY"):
        print("[server] GROQ_API_KEY is missing; uploads will fail until it is in .env")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
