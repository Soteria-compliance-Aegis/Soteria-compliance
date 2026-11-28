"""Unauthenticated endpoints: lead capture and client config."""

from __future__ import annotations

import logging
import os
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from .. import db, notify, security

log = logging.getLogger("soteria")

router = APIRouter(prefix="/api/public", tags=["public"])

LEAD_LIMIT = 5
LEAD_WINDOW_SECONDS = 3600


class LeadIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    company: str = Field(min_length=1, max_length=160)
    role: str | None = Field(default=None, max_length=120)
    interest: Literal["scorecard", "audit", "retainer", "other"]
    message: str | None = Field(default=None, max_length=4000)
    website: str | None = Field(default=None, max_length=500)  # honeypot, must stay empty
    consent: bool

    @field_validator("name", "company", "role", "message", "email", mode="before")
    @classmethod
    def _strip(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("name", "company")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        if not security.EMAIL_RE.match(value):
            raise ValueError("must be a valid email address")
        return value.lower()

    @field_validator("consent")
    @classmethod
    def _consent(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("consent is required")
        return value


@router.post("/leads", status_code=201)
def create_lead(payload: LeadIn, request: Request, background: BackgroundTasks) -> Any:
    if payload.website and payload.website.strip():
        return {"ok": True}  # honeypot tripped: look successful, store nothing

    hashed = security.ip_hash(security.client_ip(request))
    bucket = f"lead:{hashed}"
    try:
        if db.rate_count(bucket, LEAD_WINDOW_SECONDS) >= LEAD_LIMIT:
            return JSONResponse(
                {"detail": "Too many submissions. Please try again later."},
                status_code=429,
                headers={"Retry-After": str(LEAD_WINDOW_SECONDS)},
            )
        db.rate_hit(bucket)
    except Exception:  # noqa: BLE001 - best effort; never block a real lead on the limiter
        log.exception("lead rate limit unavailable")

    lead = {
        "name": payload.name,
        "email": payload.email,
        "company": payload.company,
        "role": payload.role or None,
        "interest": payload.interest,
        "message": payload.message or None,
    }
    lead_id = db.insert(
        "INSERT INTO leads (created_at, name, email, company, role, interest, message,"
        " status, source, ip_hash, consent) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, 1)",
        (db.now_iso(), lead["name"], lead["email"], lead["company"], lead["role"],
         lead["interest"], lead["message"], "website", hashed),
    )
    db.execute(
        "INSERT INTO activity (at, user_id, action, subject, detail) VALUES (?, NULL, ?, ?, ?)",
        (db.now_iso(), "lead.created", f"{lead['name']} ({lead['company']})", f"interest: {lead['interest']}"),
    )
    log.info("New lead #%s", lead_id)
    background.add_task(notify.notify_lead, lead)
    return {"ok": True}


@router.get("/config")
def public_config() -> dict[str, Any]:
    return {
        "posthogKey": os.getenv("POSTHOG_KEY") or None,
        "posthogHost": os.getenv("POSTHOG_HOST") or "https://us.i.posthog.com",
    }
