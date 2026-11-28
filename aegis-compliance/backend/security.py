"""Passwords, sessions, cookies and login throttling (stdlib only)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request, Response

from . import db

log = logging.getLogger("soteria")

COOKIE_NAME = "soteria_session"
SESSION_DAYS = 14
MIN_PASSWORD_LENGTH = 10

LOGIN_MAX_FAILURES = 8
LOGIN_WINDOW_SECONDS = 15 * 60

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N, _SCRYPT_R, _SCRYPT_P,
        base64.b64encode(salt).decode(), base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest_b64)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=base64.b64decode(salt_b64),
            n=int(n), r=int(r), p=int(p), dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


# A real hash to verify against when the email is unknown, so timing does not
# reveal which addresses have accounts.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    user = db.fetchone("SELECT * FROM users WHERE email = ?", (email.strip().lower(),))
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return None
    return user if verify_password(password, user["password_hash"]) else None


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def create_session(user_id: int) -> str:
    """Store the sha256 of a fresh random token and return the raw token."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (_token_hash(token), user_id, _iso(now), _iso(now + timedelta(days=SESSION_DAYS))),
    )
    db.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(now),))
    return token


def user_for_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return db.fetchone(
        "SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id"
        " WHERE s.token_hash = ? AND s.expires_at > ?",
        (_token_hash(token), db.now_iso()),
    )


def destroy_session(token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def _truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def trust_proxy() -> bool:
    return _truthy("SOTERIA_TRUST_PROXY")


def _is_secure(request: Request) -> bool:
    if _truthy("SOTERIA_COOKIE_SECURE") or request.url.scheme == "https":
        return True
    if trust_proxy():
        return request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower() == "https"
    return False


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token, max_age=SESSION_DAYS * 86400, httponly=True,
        samesite="lax", secure=_is_secure(request), path="/",
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=_is_secure(request)
    )


# --------------------------------------------------------------------------- #
# Client identity and throttling
# --------------------------------------------------------------------------- #


def client_ip(request: Request) -> str:
    """Socket peer, or the first X-Forwarded-For hop when SOTERIA_TRUST_PROXY=1."""
    if trust_proxy():
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def ip_hash(ip: str) -> str:
    """Salted hash so raw IPs are never stored; the salt lives server-side."""
    salt = os.getenv("SOTERIA_IP_SALT") or db.meta_get_or_create(
        "ip_salt", lambda: secrets.token_hex(16)
    )
    return hashlib.sha256(f"{salt}:{ip}".encode("utf-8")).hexdigest()[:32]


def login_bucket(request: Request) -> str:
    return "login:" + ip_hash(client_ip(request))


def login_retry_after(request: Request) -> int | None:
    """Seconds until the caller may retry, or None when not throttled.

    Throttling is best effort: if the rate table is unavailable the check
    fails open rather than locking everyone out.
    """
    try:
        bucket = login_bucket(request)
        if db.rate_count(bucket, LOGIN_WINDOW_SECONDS) < LOGIN_MAX_FAILURES:
            return None
        first = db.oldest_hit(bucket, LOGIN_WINDOW_SECONDS)
        import time

        return max(1, LOGIN_WINDOW_SECONDS - (int(time.time()) - (first or 0)))
    except Exception:  # noqa: BLE001
        log.exception("login throttle check failed; allowing attempt")
        return None


def login_failed(request: Request) -> None:
    try:
        db.rate_hit(login_bucket(request))
    except Exception:  # noqa: BLE001
        log.exception("could not record failed login")


def login_succeeded(request: Request) -> None:
    try:
        db.rate_clear(login_bucket(request))
    except Exception:  # noqa: BLE001
        log.exception("could not clear login throttle")


# --------------------------------------------------------------------------- #
# Admin bootstrap
# --------------------------------------------------------------------------- #


def _upsert_admin(email: str, name: str, password: str) -> None:
    email = email.strip().lower()
    existing = db.fetchone("SELECT * FROM users WHERE email = ?", (email,))
    if existing is None:
        db.insert(
            "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (email, name, hash_password(password), db.now_iso()),
        )
        log.info("Created admin account %s", email)
        return
    # Keep env as the source of truth so rotating the password is a redeploy.
    if not verify_password(password, existing["password_hash"]):
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), existing["id"]))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (existing["id"],))
        log.info("Updated password for admin account %s", email)
    if existing["name"] != name:
        db.execute("UPDATE users SET name = ? WHERE id = ?", (name, existing["id"]))


def bootstrap_admins() -> None:
    """Create/update admins from ADMIN1_* / ADMIN2_* env. Never logs passwords."""
    configured = 0
    for prefix in ("ADMIN1", "ADMIN2"):
        email = (os.getenv(f"{prefix}_EMAIL") or "").strip()
        password = os.getenv(f"{prefix}_PASSWORD") or ""
        name = (os.getenv(f"{prefix}_NAME") or "").strip() or (email.split("@")[0] if email else "")
        if not email and not password:
            continue
        if not EMAIL_RE.match(email):
            log.warning("%s_EMAIL is missing or not a valid email; skipping that admin", prefix)
            continue
        if len(password) < MIN_PASSWORD_LENGTH:
            log.warning("%s_PASSWORD must be at least %d characters; skipping that admin", prefix, MIN_PASSWORD_LENGTH)
            continue
        _upsert_admin(email, name, password)
        configured += 1

    if configured:
        return
    count = db.fetchone("SELECT COUNT(*) AS n FROM users")
    if count and int(count["n"]) > 0:
        return
    log.warning(
        "No admin accounts exist and ADMIN1_EMAIL/ADMIN1_PASSWORD are not set: nobody can sign in. "
        "Set ADMIN1_* (and ADMIN2_*) or, for local development only, SOTERIA_DEV=1."
    )
    if _truthy("SOTERIA_DEV"):
        password = secrets.token_urlsafe(12)
        _upsert_admin("dev@soteria.local", "Dev Admin", password)
        # Printed once to the console on purpose; it is never written to a log.
        print(f"[soteria] SOTERIA_DEV: created dev@soteria.local with password {password} (shown once)", flush=True)
