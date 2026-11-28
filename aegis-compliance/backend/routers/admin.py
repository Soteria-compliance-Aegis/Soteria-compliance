"""Authenticated admin API: leads, prospects, team, activity, overview.

Every route requires a session. Responses use snake_case keys. Every mutation
writes an ``activity`` row naming the acting user.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from .. import db, engine_stats, security
from ..deps import current_user

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(current_user)])

LeadStatus = Literal["new", "contacted", "qualified", "won", "lost"]
ProspectStage = Literal["research", "contacted", "replied", "scorecard_sent", "call", "audit_sold", "lost"]
LEAD_STATUSES: tuple[str, ...] = ("new", "contacted", "qualified", "won", "lost")
PROSPECT_STAGES: tuple[str, ...] = (
    "research", "contacted", "replied", "scorecard_sent", "call", "audit_sold", "lost",
)
MAX_IMPORT_ROWS = 200


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _log(user: dict[str, Any], action: str, subject: str, detail: str = "") -> None:
    db.execute(
        "INSERT INTO activity (at, user_id, action, subject, detail) VALUES (?, ?, ?, ?, ?)",
        (db.now_iso(), user["id"], action, subject[:200], detail[:500]),
    )


def _like(term: str) -> str:
    escaped = term.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _lead_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "name": row["name"],
        "email": row["email"],
        "company": row["company"],
        "role": row["role"],
        "interest": row["interest"],
        "message": row["message"],
        "status": row["status"],
        "assignee": row["assignee"],
        "source": row["source"],
        "consent": bool(row["consent"]),
    }


def _get_lead(lead_id: int) -> dict[str, Any]:
    row = db.fetchone("SELECT * FROM leads WHERE id = ?", (lead_id,))
    if row is None:
        raise HTTPException(404, "No such lead.")
    return row


def _prospect_out(row: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "created_at", "updated_at", "company", "url", "privacy_url", "segment",
            "stage", "contact_name", "contact_email", "notes")
    return {key: row[key] for key in keys}


def _get_prospect(prospect_id: int) -> dict[str, Any]:
    row = db.fetchone("SELECT * FROM prospects WHERE id = ?", (prospect_id,))
    if row is None:
        raise HTTPException(404, "No such prospect.")
    return row


def _activity_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "at": row["at"],
        "who": row["who"] or "Website",
        "action": row["action"],
        "subject": row["subject"],
        "detail": row["detail"],
    }


def _recent_activity(limit: int) -> list[dict[str, Any]]:
    rows = db.fetchall(
        "SELECT a.id, a.at, a.action, a.subject, a.detail, u.name AS who"
        " FROM activity a LEFT JOIN users u ON u.id = a.user_id"
        " ORDER BY a.at DESC, a.id DESC LIMIT ?",
        (limit,),
    )
    return [_activity_out(row) for row in rows]


def _normalise_url(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if "://" not in value:
        value = "https://" + value
    if not value.lower().startswith(("http://", "https://")):
        raise ValueError("must be an http(s) URL")
    return value


def _check_email(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if not security.EMAIL_RE.match(value):
        raise ValueError("must be a valid email address")
    return value.lower()


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #


class LeadPatch(BaseModel):
    status: LeadStatus | None = None
    assignee: str | None = Field(default=None, max_length=254)  # a team member's email; null/"" unassigns


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ProspectIn(BaseModel):
    company: str = Field(min_length=1, max_length=160)
    url: str | None = Field(default=None, max_length=500)
    privacy_url: str | None = Field(default=None, max_length=500)
    segment: str | None = Field(default=None, max_length=80)
    stage: ProspectStage = "research"
    contact_name: str | None = Field(default=None, max_length=120)
    contact_email: str | None = Field(default=None, max_length=254)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("company")
    @classmethod
    def _company(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("url", "privacy_url")
    @classmethod
    def _urls(cls, value: str | None) -> str | None:
        return _normalise_url(value)

    @field_validator("contact_email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        return _check_email(value)

    @field_validator("segment", "contact_name", "notes")
    @classmethod
    def _trim(cls, value: str | None) -> str | None:
        value = value.strip() if value else None
        return value or None


class ProspectPatch(BaseModel):
    company: str | None = Field(default=None, min_length=1, max_length=160)
    url: str | None = Field(default=None, max_length=500)
    privacy_url: str | None = Field(default=None, max_length=500)
    segment: str | None = Field(default=None, max_length=80)
    stage: ProspectStage | None = None
    contact_name: str | None = Field(default=None, max_length=120)
    contact_email: str | None = Field(default=None, max_length=254)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("url", "privacy_url")
    @classmethod
    def _urls(cls, value: str | None) -> str | None:
        return _normalise_url(value)

    @field_validator("contact_email")
    @classmethod
    def _email(cls, value: str | None) -> str | None:
        return _check_email(value)


class ProspectImport(BaseModel):
    rows: list[ProspectIn] = Field(max_length=MAX_IMPORT_ROWS)


# --------------------------------------------------------------------------- #
# Overview
# --------------------------------------------------------------------------- #


def _week_start(day: datetime) -> datetime:
    return (day - timedelta(days=day.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def _group_counts(table: str, column: str, keys: tuple[str, ...]) -> dict[str, int]:
    counts = {key: 0 for key in keys}
    for row in db.fetchall(f"SELECT {column} AS k, COUNT(*) AS n FROM {table} GROUP BY {column}"):
        if row["k"] in counts:
            counts[row["k"]] = int(row["n"])
    return counts


@router.get("/overview")
def overview() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    first_week = _week_start(now) - timedelta(weeks=7)
    weeks = [first_week + timedelta(weeks=i) for i in range(8)]
    buckets = {week.strftime("%Y-%m-%d"): 0 for week in weeks}
    for row in db.fetchall(
        "SELECT created_at FROM leads WHERE created_at >= ?", (first_week.strftime("%Y-%m-%dT%H:%M:%SZ"),)
    ):
        try:
            created = datetime.strptime(row["created_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        key = _week_start(created).strftime("%Y-%m-%d")
        if key in buckets:
            buckets[key] += 1

    by_status = _group_counts("leads", "status", LEAD_STATUSES)
    by_stage = _group_counts("prospects", "stage", PROSPECT_STAGES)
    seven_days_ago = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    leads_7d = db.fetchone("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ?", (seven_days_ago,))
    engine = engine_stats.collect()

    return {
        "kpis": {
            "leads_total": sum(by_status.values()),
            "leads_new": by_status["new"],
            "leads_7d": int(leads_7d["n"]) if leads_7d else 0,
            "prospects": sum(by_stage.values()),
            "audits": engine["audits"],
            "open_gaps": engine["open_gaps"],
            "high_gaps": engine["high_gaps"],
            "monitored": engine["monitored"],
            "drifted": engine["drifted"],
        },
        "leads_by_week": [{"week": week, "count": count} for week, count in buckets.items()],
        "leads_by_status": by_status,
        "pipeline_by_stage": by_stage,
        "findings_by_status": engine["findings_by_status"],
        "recent_activity": [
            {k: item[k] for k in ("at", "who", "action", "subject", "detail")}
            for item in _recent_activity(15)
        ],
    }


# --------------------------------------------------------------------------- #
# Leads
# --------------------------------------------------------------------------- #


@router.get("/leads")
def list_leads(
    status: LeadStatus | None = None,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    where, params = [], []  # type: list[str], list[Any]
    if status:
        where.append("status = ?")
        params.append(status)
    if q and q.strip():
        like = _like(q.strip())
        where.append(
            "(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(email) LIKE ? ESCAPE '\\'"
            " OR LOWER(company) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(message, '')) LIKE ? ESCAPE '\\')"
        )
        params.extend([like] * 4)
    clause = f" WHERE {' AND '.join(where)}" if where else ""
    total = db.fetchone(f"SELECT COUNT(*) AS n FROM leads{clause}", params)
    rows = db.fetchall(
        f"SELECT * FROM leads{clause} ORDER BY created_at DESC, id DESC LIMIT ?", [*params, limit]
    )
    return {"leads": [_lead_out(row) for row in rows], "total": int(total["n"]) if total else 0}


def _notes(lead_id: int) -> list[dict[str, Any]]:
    rows = db.fetchall(
        "SELECT n.id, n.lead_id, n.user_id, n.body, n.created_at, u.name AS author"
        " FROM lead_notes n LEFT JOIN users u ON u.id = n.user_id"
        " WHERE n.lead_id = ? ORDER BY n.created_at ASC, n.id ASC",
        (lead_id,),
    )
    return [{k: row[k] for k in ("id", "lead_id", "user_id", "author", "body", "created_at")} for row in rows]


@router.get("/leads/{lead_id}")
def get_lead(lead_id: int) -> dict[str, Any]:
    return {**_lead_out(_get_lead(lead_id)), "notes": _notes(lead_id)}


@router.patch("/leads/{lead_id}")
def patch_lead(lead_id: int, payload: LeadPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    lead = _get_lead(lead_id)
    sets, params, changes = [], [], []  # type: list[str], list[Any], list[str]
    if "status" in payload.model_fields_set:
        if payload.status is None:
            raise HTTPException(422, "status cannot be null")
        sets.append("status = ?")
        params.append(payload.status)
        changes.append(f"status {lead['status']} -> {payload.status}")
    if "assignee" in payload.model_fields_set:
        assignee = (payload.assignee or "").strip().lower() or None
        if assignee and db.fetchone("SELECT id FROM users WHERE email = ?", (assignee,)) is None:
            raise HTTPException(422, "assignee must be the email of a team member")
        sets.append("assignee = ?")
        params.append(assignee)
        changes.append(f"assignee -> {assignee or 'unassigned'}")
    if sets:
        db.execute(f"UPDATE leads SET {', '.join(sets)} WHERE id = ?", [*params, lead_id])
        _log(user, "lead.updated", f"{lead['name']} ({lead['company']})", "; ".join(changes))
    return _lead_out(_get_lead(lead_id))


@router.post("/leads/{lead_id}/notes", status_code=201)
def add_note(lead_id: int, payload: NoteIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    lead = _get_lead(lead_id)
    now = db.now_iso()
    note_id = db.insert(
        "INSERT INTO lead_notes (lead_id, user_id, body, created_at) VALUES (?, ?, ?, ?)",
        (lead_id, user["id"], payload.body, now),
    )
    _log(user, "lead.note", f"{lead['name']} ({lead['company']})", payload.body[:120])
    return {"id": note_id, "lead_id": lead_id, "user_id": user["id"], "author": user["name"],
            "body": payload.body, "created_at": now}


@router.delete("/leads/{lead_id}", status_code=204)
def delete_lead(lead_id: int, user: dict[str, Any] = Depends(current_user)) -> Response:
    lead = _get_lead(lead_id)
    db.execute("DELETE FROM lead_notes WHERE lead_id = ?", (lead_id,))
    db.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
    _log(user, "lead.deleted", f"{lead['name']} ({lead['company']})")
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# Prospects
# --------------------------------------------------------------------------- #

_PROSPECT_COLUMNS = ("company", "url", "privacy_url", "segment", "stage", "contact_name", "contact_email", "notes")


@router.get("/prospects")
def list_prospects(
    stage: ProspectStage | None = None,
    segment: str | None = Query(default=None, max_length=80),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=500, ge=1, le=1000),
) -> dict[str, Any]:
    where, params = [], []  # type: list[str], list[Any]
    if stage:
        where.append("stage = ?")
        params.append(stage)
    if segment and segment.strip():
        where.append("LOWER(segment) = ?")
        params.append(segment.strip().lower())
    if q and q.strip():
        like = _like(q.strip())
        where.append(
            "(LOWER(company) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(url, '')) LIKE ? ESCAPE '\\'"
            " OR LOWER(COALESCE(contact_name, '')) LIKE ? ESCAPE '\\'"
            " OR LOWER(COALESCE(contact_email, '')) LIKE ? ESCAPE '\\'"
            " OR LOWER(COALESCE(notes, '')) LIKE ? ESCAPE '\\')"
        )
        params.extend([like] * 5)
    clause = f" WHERE {' AND '.join(where)}" if where else ""
    total = db.fetchone(f"SELECT COUNT(*) AS n FROM prospects{clause}", params)
    rows = db.fetchall(
        f"SELECT * FROM prospects{clause} ORDER BY updated_at DESC, id DESC LIMIT ?", [*params, limit]
    )
    return {"prospects": [_prospect_out(row) for row in rows], "total": int(total["n"]) if total else 0}


def _dedupe_key(company: str, url: str | None) -> tuple[str, str]:
    return company.strip().lower(), (url or "").strip().lower().rstrip("/")


@router.post("/prospects", status_code=201)
def create_prospect(payload: ProspectIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    now = db.now_iso()
    values = [getattr(payload, column) for column in _PROSPECT_COLUMNS]
    prospect_id = db.insert(
        f"INSERT INTO prospects (created_at, updated_at, {', '.join(_PROSPECT_COLUMNS)})"
        f" VALUES (?, ?, {', '.join('?' for _ in _PROSPECT_COLUMNS)})",
        [now, now, *values],
    )
    _log(user, "prospect.created", payload.company, f"stage: {payload.stage}")
    return _prospect_out(_get_prospect(prospect_id))


@router.post("/prospects/import")
def import_prospects(payload: ProspectImport, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    seen = {_dedupe_key(r["company"], r["url"]) for r in db.fetchall("SELECT company, url FROM prospects")}
    now = db.now_iso()
    fresh: list[list[Any]] = []
    skipped = 0
    for row in payload.rows:
        key = _dedupe_key(row.company, row.url)
        if key in seen:
            skipped += 1
            continue
        seen.add(key)
        fresh.append([now, now, *(getattr(row, column) for column in _PROSPECT_COLUMNS)])
    db.executemany(
        f"INSERT INTO prospects (created_at, updated_at, {', '.join(_PROSPECT_COLUMNS)})"
        f" VALUES (?, ?, {', '.join('?' for _ in _PROSPECT_COLUMNS)})",
        fresh,
    )
    _log(user, "prospect.imported", f"{len(fresh)} prospects", f"{skipped} duplicates skipped")
    return {"created": len(fresh), "skipped": skipped}


@router.patch("/prospects/{prospect_id}")
def patch_prospect(prospect_id: int, payload: ProspectPatch, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    prospect = _get_prospect(prospect_id)
    sets, params, changed = [], [], []  # type: list[str], list[Any], list[str]
    for column in _PROSPECT_COLUMNS:
        if column not in payload.model_fields_set:
            continue
        value = getattr(payload, column)
        if column in ("company", "stage") and value is None:
            raise HTTPException(422, f"{column} cannot be null")
        if isinstance(value, str) and column not in ("url", "privacy_url", "contact_email"):
            value = value.strip() or None
            if column == "company" and value is None:
                raise HTTPException(422, "company must not be blank")
        sets.append(f"{column} = ?")
        params.append(value)
        changed.append(f"stage {prospect['stage']} -> {value}" if column == "stage" else column)
    if sets:
        db.execute(
            f"UPDATE prospects SET {', '.join(sets)}, updated_at = ? WHERE id = ?",
            [*params, db.now_iso(), prospect_id],
        )
        _log(user, "prospect.updated", prospect["company"], "; ".join(changed))
    return _prospect_out(_get_prospect(prospect_id))


@router.delete("/prospects/{prospect_id}", status_code=204)
def delete_prospect(prospect_id: int, user: dict[str, Any] = Depends(current_user)) -> Response:
    prospect = _get_prospect(prospect_id)
    db.execute("DELETE FROM prospects WHERE id = ?", (prospect_id,))
    _log(user, "prospect.deleted", prospect["company"])
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# Team and activity
# --------------------------------------------------------------------------- #


@router.get("/team")
def team() -> dict[str, Any]:
    rows = db.fetchall("SELECT id, name, email FROM users ORDER BY id")
    return {"team": [{"id": r["id"], "name": r["name"], "email": r["email"]} for r in rows]}


@router.get("/activity")
def activity(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    return {"activity": _recent_activity(limit)}
