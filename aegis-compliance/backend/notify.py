"""Slack / Discord lead notifications. Failures are logged, never raised."""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

log = logging.getLogger("soteria")

TIMEOUT_SECONDS = 5
MESSAGE_PREVIEW_CHARS = 200
_ZWSP = "​"


def _plain(text: str) -> str:
    """Neutralise mass mentions (@everyone, @here) and collapse whitespace."""
    flat = " ".join(str(text).split())
    return flat.replace("@everyone", f"@{_ZWSP}everyone").replace("@here", f"@{_ZWSP}here")


def _slack_escape(text: str) -> str:
    """Slack treats <!channel>, <@U123> and <url|label> as markup; escape all of it."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _discord_escape(text: str) -> str:
    return text.replace("<@", f"<{_ZWSP}@").replace("<#", f"<{_ZWSP}#")


def build_summary(lead: dict[str, Any]) -> str:
    """Plain-text summary shared by both channels (not yet channel-escaped)."""
    role = f" ({_plain(lead['role'])})" if lead.get("role") else ""
    lines = [
        f"New Soteria lead: {_plain(lead['name'])}{role} at {_plain(lead['company'])}",
        f"Interest: {_plain(lead['interest'])} | Email: {_plain(lead['email'])}",
    ]
    message = _plain(lead.get("message") or "")
    if message:
        clipped = message[:MESSAGE_PREVIEW_CHARS] + ("..." if len(message) > MESSAGE_PREVIEW_CHARS else "")
        lines.append(f"Message: {clipped}")
    return "\n".join(lines)


def _post_json(url: str, payload: dict[str, Any]) -> None:
    if not url.lower().startswith(("https://", "http://")):
        raise ValueError("webhook URL must be http(s)")
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "soteria-backend"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310 - operator-set URL
        response.read(1024)


def notify_lead(lead: dict[str, Any]) -> None:
    """Post the lead to every configured webhook (run as a background task)."""
    summary = build_summary(lead)
    targets = (
        ("slack", os.getenv("SLACK_WEBHOOK_URL"), {"text": _slack_escape(summary)}),
        (
            "discord",
            os.getenv("DISCORD_WEBHOOK_URL"),
            {"content": _discord_escape(summary)[:1900], "allowed_mentions": {"parse": []}},
        ),
    )
    for name, url, payload in targets:
        if not (url or "").strip():
            continue
        try:
            _post_json(url.strip(), payload)
        except Exception as exc:  # noqa: BLE001 - notifications are best effort
            # Log the type only: exception text can embed the webhook URL (a secret).
            log.warning("%s notification failed (%s)", name, type(exc).__name__)
