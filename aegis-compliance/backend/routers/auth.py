"""POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import security
from ..deps import current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


def _public(user: dict[str, Any]) -> dict[str, Any]:
    return {"id": user["id"], "email": user["email"], "name": user["name"]}


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response) -> Any:
    retry = security.login_retry_after(request)
    if retry is not None:
        return JSONResponse(
            {"detail": "Too many failed sign-in attempts. Try again later."},
            status_code=429,
            headers={"Retry-After": str(retry)},
        )
    user = security.authenticate(payload.email, payload.password)
    if user is None:
        security.login_failed(request)
        return JSONResponse({"detail": "Invalid email or password"}, status_code=401)
    security.login_succeeded(request)
    token = security.create_session(int(user["id"]))
    security.set_session_cookie(response, request, token)
    return {"user": _public(user)}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    security.destroy_session(request.cookies.get(security.COOKIE_NAME))
    security.clear_session_cookie(response, request)
    return {"ok": True}


@router.get("/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": _public(user)}
