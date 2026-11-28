"""Session enforcement for ``/api/*``."""

from __future__ import annotations

import logging

from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import auth_enabled, ensure_ready, security

log = logging.getLogger("soteria")

PUBLIC_PREFIXES = ("/api/auth/", "/api/public/")


def _unauthorized() -> JSONResponse:
    return JSONResponse({"detail": "Not signed in"}, status_code=401)


class AuthMiddleware(BaseHTTPMiddleware):
    """Require a valid session on every /api route except the public ones.

    Static files and SPA routes (everything outside /api) stay public. With
    ``SOTERIA_AUTH=off`` only the legacy engine routes are opened up; the
    admin API (/api/admin/*) always requires a session.
    """

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        path = request.url.path
        if not path.startswith("/api") or request.method == "OPTIONS":
            return await call_next(request)

        try:
            await run_in_threadpool(ensure_ready)
        except Exception:  # noqa: BLE001
            log.exception("Soteria backend is not ready")
            return JSONResponse({"detail": "Backend database unavailable"}, status_code=503)

        if path.startswith(PUBLIC_PREFIXES):
            return await call_next(request)

        token = request.cookies.get(security.COOKIE_NAME)
        user = await run_in_threadpool(security.user_for_token, token)
        if user is not None:
            request.state.user = user
            return await call_next(request)

        if path == "/api/health" and request.method in ("GET", "HEAD"):
            return JSONResponse({"ok": True})
        if not auth_enabled() and not path.startswith("/api/admin"):
            return await call_next(request)
        return _unauthorized()
