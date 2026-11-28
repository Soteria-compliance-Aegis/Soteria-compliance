"""Shared FastAPI dependencies and small helpers for the routers."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request

from . import security


def current_user(request: Request) -> dict[str, Any]:
    """The signed-in user (set by the middleware); 401 otherwise."""
    user = getattr(request.state, "user", None)
    if user is None:
        user = security.user_for_token(request.cookies.get(security.COOKIE_NAME))
    if user is None:
        raise HTTPException(401, "Not signed in")
    return user
