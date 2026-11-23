"""Bounded fetching and cleaning of public pages for the footprint audit.

Every URL a user supplies is untrusted input, so each request is bounded:

- only ``http``/``https`` is accepted, and URLs carrying credentials are refused;
- loopback, private, link-local and otherwise non-global hosts are blocked, and
  the check runs again for every redirect hop (up to three);
- redirects are followed manually so the target can be re-validated;
- bodies are streamed under a hard byte cap and connect/read timeouts apply;
- a blocked, empty or non-text page becomes a structured ``FetchError`` so the
  workspace can fall back to manual paste instead of losing the whole audit.

Reusing ``scraper.clean_html`` keeps one boilerplate-stripping implementation
for both the CLI scraper and the live URL path.
"""

from __future__ import annotations

import ipaddress
import socket
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from scraper import clean_html, truncate

CONNECT_TIMEOUT = 5.0
DEFAULT_TIMEOUT = 10.0
MAX_TIMEOUT = 20.0
MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
MIN_CHARS = 120

PAGE_KINDS: tuple[str, ...] = ("homepage", "product", "privacy")

KIND_LABELS: dict[str, str] = {
    "homepage": "homepage",
    "product": "product / pricing / trust page",
    "privacy": "privacy policy",
}

# Each kind has its own cap so the diff prompt stays inside the shared budget.
KIND_MAX_CHARS: dict[str, int] = {
    "homepage": 8_000,
    "product": 6_000,
    "privacy": 12_000,
}

BLOCKED_HOST_SUFFIXES = (
    ".local",
    ".localhost",
    ".internal",
    ".intranet",
    ".home.arpa",
    ".lan",
)

HEADERS = {
    "User-Agent": "AegisComplianceBot/0.1 (+operational AI governance readiness check)",
    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
}

_WHITESPACE_RE = re.compile(r"\s+")


class FetchError(Exception):
    """A fetch that could not produce usable text, with a stable error code."""

    def __init__(self, message: str, code: str = "fetch_failed") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class Snapshot:
    """One fetched page: cleaned readable text plus where it came from."""

    kind: str
    url: str
    final_url: str
    title: str
    text: str
    status: int
    chars: int
    truncated: bool
    fetched_at: str

    def public(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "kindLabel": KIND_LABELS.get(self.kind, self.kind),
            "url": self.url,
            "finalUrl": self.final_url,
            "title": self.title,
            "text": self.text,
            "status": self.status,
            "chars": self.chars,
            "truncated": self.truncated,
            "fetchedAt": self.fetched_at,
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _looks_local(hostname: str) -> bool:
    host = hostname.strip(".").lower()
    return host in ("localhost", "localhost.localdomain") or host.endswith(BLOCKED_HOST_SUFFIXES)


def _addresses(hostname: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise FetchError(f"Could not resolve {hostname}. Check the URL or paste the text instead.", "dns_error") from exc
    addresses = []
    for info in infos:
        raw = str(info[4][0]).split("%", 1)[0]
        try:
            addresses.append(ipaddress.ip_address(raw))
        except ValueError:
            continue
    return addresses


def assert_public_host(hostname: str) -> None:
    """Raise unless ``hostname`` resolves only to globally routable addresses."""
    if not hostname:
        raise FetchError("That URL has no hostname.", "invalid_url")
    if _looks_local(hostname):
        raise FetchError(f"{hostname} is a local address; Aegis only fetches public pages.", "blocked_host")
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None:
        if not literal.is_global:
            raise FetchError(f"{hostname} is a private or reserved address; Aegis only fetches public pages.", "blocked_host")
        return
    addresses = _addresses(hostname)
    if not addresses:
        raise FetchError(f"Could not resolve {hostname}.", "dns_error")
    for address in addresses:
        if not address.is_global:
            raise FetchError(
                f"{hostname} resolves to a private or reserved address; Aegis only fetches public pages.",
                "blocked_host",
            )


def validate_public_url(raw: str) -> str:
    """Normalise a user-supplied URL and prove it points at a public host."""
    value = (raw or "").strip()
    if not value:
        raise FetchError("Enter a URL or paste the text instead.", "invalid_url")
    if "://" not in value:
        value = f"https://{value}"

    parsed = urlparse(value)
    if parsed.scheme.lower() not in ("http", "https"):
        raise FetchError("Only http:// and https:// URLs can be fetched.", "invalid_scheme")
    if parsed.username or parsed.password:
        raise FetchError("URLs with embedded credentials are not accepted.", "invalid_url")
    hostname = parsed.hostname or ""
    assert_public_host(hostname)
    return parsed._replace(scheme=parsed.scheme.lower()).geturl()


def _decode(body: bytes, encoding: str | None) -> str:
    charset = (encoding or "utf-8").strip() or "utf-8"
    try:
        return body.decode(charset, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def _title(html: str) -> str:
    try:
        title = BeautifulSoup(html, "html.parser").title
    except Exception:  # noqa: BLE001 - a broken head is not worth failing a fetch
        return ""
    return _WHITESPACE_RE.sub(" ", title.get_text(" ")).strip()[:160] if title else ""


def _read_capped(response: requests.Response) -> tuple[bytes, bool]:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > MAX_BYTES:
            remaining = MAX_BYTES - (total - len(chunk))
            if remaining > 0:
                chunks.append(chunk[:remaining])
            return b"".join(chunks), True
        chunks.append(chunk)
    return b"".join(chunks), False


def fetch_page(
    kind: str,
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    max_chars: int | None = None,
) -> Snapshot:
    """Fetch, clean and cap one public page. Raises ``FetchError`` on failure."""
    if kind not in PAGE_KINDS:
        raise ValueError(f"Unknown page kind {kind!r}; expected one of {PAGE_KINDS}")
    limit = max_chars or KIND_MAX_CHARS[kind]
    timeout = max(1.0, min(float(timeout), MAX_TIMEOUT))

    current = validate_public_url(url)
    session = requests.Session()
    response: requests.Response | None = None
    try:
        for _hop in range(MAX_REDIRECTS + 1):
            # Re-check every hop: a public host must not bounce us inward.
            validate_public_url(current)
            try:
                response = session.get(
                    current,
                    headers=HEADERS,
                    timeout=(CONNECT_TIMEOUT, timeout),
                    allow_redirects=False,
                    stream=True,
                )
            except requests.Timeout as exc:
                raise FetchError(f"{urlparse(current).hostname} did not answer in time. Paste the text instead.", "timeout") from exc
            except requests.RequestException as exc:
                raise FetchError(
                    f"Could not reach {urlparse(current).hostname} ({type(exc).__name__}). Paste the text instead.",
                    "network_error",
                ) from exc

            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                response.close()
                if not location:
                    raise FetchError("That page redirected without a target.", "bad_redirect")
                current = urljoin(current, location)
                continue
            break
        else:
            raise FetchError("That URL redirected too many times.", "too_many_redirects")

        assert response is not None
        try:
            with response:
                if response.status_code >= 400:
                    raise FetchError(
                        f"{urlparse(current).hostname} answered HTTP {response.status_code}. Paste the text instead.",
                        "http_error",
                    )

                content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                allowed = ("text/html", "application/xhtml+xml", "text/plain")
                if content_type and content_type not in allowed:
                    raise FetchError(
                        f"That URL returned {content_type}, not a readable page. Paste the text instead.",
                        "unsupported_content",
                    )

                body, byte_capped = _read_capped(response)
                html = _decode(body, response.encoding)

                is_html = content_type in ("text/html", "application/xhtml+xml") or (
                    not content_type and html.lstrip().startswith("<")
                )
                if is_html:
                    text = clean_html(html, max_chars=limit)
                    title = _title(html)
                else:
                    text = truncate(_WHITESPACE_RE.sub(" ", html), limit)
                    title = ""
        except requests.RequestException as exc:
            raise FetchError(
                "The page stopped before it finished downloading. Paste the text instead.",
                "network_error",
            ) from exc

        text = truncate(text, limit)
        if len(text) < MIN_CHARS:
            raise FetchError(
                "That page had almost no readable text (it may be JavaScript-rendered or behind a bot wall). Paste the text instead.",
                "empty_page",
            )

        return Snapshot(
            kind=kind,
            url=url.strip(),
            final_url=current,
            title=title,
            text=text,
            status=response.status_code,
            chars=len(text),
            truncated=byte_capped or len(text) >= limit,
            fetched_at=_now(),
        )
    finally:
        session.close()


def fetch_many(
    targets: dict[str, str],
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> tuple[list[Snapshot], list[dict[str, str]]]:
    """Fetch the supplied sources, returning snapshots and per-source errors.

    One blocked site never fails the whole call: the caller can show the
    errors and let the user paste that document manually.
    """
    snapshots: list[Snapshot] = []
    errors: list[dict[str, str]] = []
    for kind in PAGE_KINDS:
        url = (targets.get(kind) or "").strip()
        if not url:
            continue
        try:
            snapshots.append(fetch_page(kind, url, timeout=timeout))
        except FetchError as exc:
            errors.append(
                {
                    "kind": kind,
                    "kindLabel": KIND_LABELS[kind],
                    "url": url,
                    "code": exc.code,
                    "error": exc.message,
                }
            )
    return snapshots, errors
