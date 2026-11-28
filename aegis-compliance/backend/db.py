"""Tiny DB layer for the Soteria tables (SQLite by default, Postgres optional).

Only the new tables live here (users, sessions, leads, ...). The legacy audit
engine keeps its own SQLite connection in ``server.py``.

SQL is written with ``?`` placeholders and translated for Postgres. Timestamps
are stored as ISO-8601 UTC text in both dialects so they sort and compare as
plain strings; booleans are stored as 0/1 integers.

Postgres is selected when ``DATABASE_URL`` starts with ``postgres`` and needs
``psycopg[binary]`` (imported lazily). Connections there are opened per call,
which suits serverless functions.
"""

from __future__ import annotations

import os
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

ROOT = Path(__file__).resolve().parent.parent

Row = dict[str, Any]

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
_conn_path: Path | None = None
_initialised = False


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #


def database_url() -> str | None:
    url = (os.getenv("DATABASE_URL") or "").strip()
    return url if url.lower().startswith("postgres") else None


def is_postgres() -> bool:
    return database_url() is not None


def sqlite_path() -> Path:
    """The SQLite file shared with the audit engine (``AEGIS_DB``)."""
    configured = os.getenv("AEGIS_DB")
    if configured:
        return Path(configured)
    if os.getenv("VERCEL"):
        return Path("/tmp/soteria.db")
    return ROOT / "data" / "aegis.db"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #

_TABLES = """
CREATE TABLE IF NOT EXISTS users (
    id {pk},
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
    id {pk},
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL,
    role TEXT,
    interest TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    assignee TEXT,
    source TEXT,
    ip_hash TEXT,
    consent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lead_notes (
    id {pk},
    lead_id INTEGER NOT NULL,
    user_id INTEGER,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prospects (
    id {pk},
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    company TEXT NOT NULL,
    url TEXT,
    privacy_url TEXT,
    segment TEXT,
    stage TEXT NOT NULL DEFAULT 'research',
    contact_name TEXT,
    contact_email TEXT,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS activity (
    id {pk},
    at TEXT NOT NULL,
    user_id INTEGER,
    action TEXT NOT NULL,
    subject TEXT,
    detail TEXT
);
CREATE TABLE IF NOT EXISTS rate_events (
    id {pk},
    bucket TEXT NOT NULL,
    at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes (lead_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_activity_at ON activity (at)",
    "CREATE INDEX IF NOT EXISTS idx_rate_bucket ON rate_events (bucket, at)",
)


def _statements() -> list[str]:
    pk = "BIGSERIAL PRIMARY KEY" if is_postgres() else "INTEGER PRIMARY KEY AUTOINCREMENT"
    script = _TABLES.format(pk=pk)
    return [part.strip() for part in script.split(";") if part.strip()] + list(_INDEXES)


def init() -> None:
    """Create the tables if missing. Idempotent and safe to call concurrently."""
    global _initialised
    with _lock:
        for statement in _statements():
            execute(statement)
        _initialised = True


def reset() -> None:
    """Close the cached connection and forget init state (tests, path changes)."""
    global _conn, _conn_path, _initialised
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn, _conn_path, _initialised = None, None, False


# --------------------------------------------------------------------------- #
# Execution
# --------------------------------------------------------------------------- #


def _translate(sql: str) -> str:
    return sql.replace("?", "%s")


def _sqlite() -> sqlite3.Connection:
    global _conn, _conn_path
    path = sqlite_path()
    if _conn is None or _conn_path != path:
        if _conn is not None:
            _conn.close()
        path.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(path, check_same_thread=False, timeout=10)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn_path = path
    return _conn


def _pg_connect() -> Any:
    try:
        import psycopg  # type: ignore[import-not-found]
        from psycopg.rows import dict_row  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise RuntimeError(
            "DATABASE_URL points at Postgres but psycopg is not installed. "
            "Install it with: pip install 'psycopg[binary]'"
        ) from exc
    return psycopg.connect(database_url(), row_factory=dict_row, autocommit=False)


def _run(sql: str, params: Sequence[Any], mode: str, many: bool = False) -> Any:
    """Run one statement. ``mode`` is all | one | count | id."""
    params = list(params) if not many else params
    if is_postgres():
        if mode == "id":
            sql = f"{sql} RETURNING id"
        with _pg_connect() as conn:
            with conn.cursor() as cur:
                if many:
                    cur.executemany(_translate(sql), params)
                else:
                    cur.execute(_translate(sql), params)
                result: Any
                if mode == "all":
                    result = [dict(r) for r in cur.fetchall()]
                elif mode == "one":
                    fetched = cur.fetchone()
                    result = dict(fetched) if fetched else None
                elif mode == "id":
                    result = cur.fetchone()["id"]
                else:
                    result = cur.rowcount
            conn.commit()
            return result
    with _lock:
        conn = _sqlite()
        try:
            cur = conn.executemany(sql, params) if many else conn.execute(sql, params)
            if mode == "all":
                result = [dict(r) for r in cur.fetchall()]
            elif mode == "one":
                fetched = cur.fetchone()
                result = dict(fetched) if fetched else None
            elif mode == "id":
                result = cur.lastrowid
            else:
                result = cur.rowcount
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise


def fetchall(sql: str, params: Sequence[Any] = ()) -> list[Row]:
    return _run(sql, params, "all")


def fetchone(sql: str, params: Sequence[Any] = ()) -> Row | None:
    return _run(sql, params, "one")


def execute(sql: str, params: Sequence[Any] = ()) -> int:
    """Run a write; returns the affected row count."""
    return _run(sql, params, "count")


def insert(sql: str, params: Sequence[Any] = ()) -> int:
    """Run an INSERT into a table with an ``id`` key and return the new id."""
    return _run(sql, params, "id")


def executemany(sql: str, rows: Sequence[Sequence[Any]]) -> None:
    """One statement over many parameter sets in a single transaction."""
    if rows:
        _run(sql, rows, "count", many=True)


# --------------------------------------------------------------------------- #
# Rate limiting (best effort, stored in the DB so it survives across instances
# when Postgres is used; per-instance on SQLite, which is fine for local use)
# --------------------------------------------------------------------------- #


def rate_count(bucket: str, window_seconds: int) -> int:
    row = fetchone(
        "SELECT COUNT(*) AS n FROM rate_events WHERE bucket = ? AND at > ?",
        (bucket, int(time.time()) - window_seconds),
    )
    return int(row["n"]) if row else 0


def rate_hit(bucket: str) -> None:
    insert("INSERT INTO rate_events (bucket, at) VALUES (?, ?)", (bucket, int(time.time())))
    # Opportunistic cleanup keeps the table small without a scheduler.
    if secrets.randbelow(50) == 0:
        execute("DELETE FROM rate_events WHERE at < ?", (int(time.time()) - 86400,))


def rate_clear(bucket: str) -> None:
    execute("DELETE FROM rate_events WHERE bucket = ?", (bucket,))


def oldest_hit(bucket: str, window_seconds: int) -> int | None:
    row = fetchone(
        "SELECT MIN(at) AS first FROM rate_events WHERE bucket = ? AND at > ?",
        (bucket, int(time.time()) - window_seconds),
    )
    return int(row["first"]) if row and row["first"] is not None else None


# --------------------------------------------------------------------------- #
# Key/value metadata (stable server-side secrets such as the IP-hash salt)
# --------------------------------------------------------------------------- #


def meta_get_or_create(key: str, factory: Any) -> str:
    row = fetchone("SELECT value FROM meta WHERE key = ?", (key,))
    if row:
        return str(row["value"])
    try:
        execute("INSERT INTO meta (key, value) VALUES (?, ?)", (key, factory()))
    except Exception:  # noqa: BLE001 - another instance won the race
        pass
    row = fetchone("SELECT value FROM meta WHERE key = ?", (key,))
    return str(row["value"]) if row else str(factory())
