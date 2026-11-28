"""Soteria backend: authenticated admin API and public lead capture.

This package sits beside the audit engine and never touches it. ``install``
wires the middleware and routers into the FastAPI app; ``ensure_ready``
creates the new tables and the admin accounts (idempotent, safe to call per
request on serverless hosts where startup hooks may not run).
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI

from . import db, security

log = logging.getLogger("soteria")

_ready = False
_ready_lock = threading.Lock()


def auth_enabled() -> bool:
    """Engine-route enforcement; ``SOTERIA_AUTH=off`` is a local-dev escape hatch."""
    return os.getenv("SOTERIA_AUTH", "on").strip().lower() not in ("off", "0", "false", "no")


def ensure_ready() -> None:
    """Create tables and bootstrap admins once per process. Raises on DB failure."""
    global _ready
    if _ready:
        return
    with _ready_lock:
        if _ready:
            return
        if not auth_enabled():
            log.warning(
                "SOTERIA_AUTH=off: the audit engine API (/api/documents, /api/redteam, ...) "
                "is UNAUTHENTICATED. Use this for local development only."
            )
        db.init()
        security.bootstrap_admins()
        _ready = True


def reset_for_tests() -> None:
    global _ready
    _ready = False


@asynccontextmanager
async def lifespan(_app: Any) -> AsyncIterator[None]:
    try:
        ensure_ready()
    except Exception:  # noqa: BLE001 - report loudly, then retry lazily per request
        log.exception("Soteria backend failed to initialise; will retry on the next request")
    yield


def install(app: FastAPI) -> None:
    """Add the auth middleware and routers. Call before any catch-all route."""
    from .middleware import AuthMiddleware
    from .routers import admin, auth, public

    app.add_middleware(AuthMiddleware)
    app.include_router(auth.router)
    app.include_router(public.router)
    app.include_router(admin.router)
