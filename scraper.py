"""Fetch and clean public policy text before any of it reaches Groq.

Given a root domain, Aegis probes up to three high-value page groups — privacy,
security/trust, and AI/product terms — and tags each document so the auditor
knows which page type a sentence came from. That tagging is what stops an
employment regulation from being graded against a consumer privacy notice.

Only readable text is kept: navigation, footers, scripts, styles and other
boilerplate are stripped, then the combined document is truncated at a word
boundary under 12,000 characters (~3,000 tokens) so prompt + response stays
inside the free-tier 8,000 TPM budget with seven regulation rubrics.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence
from urllib.parse import urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

DEFAULT_TIMEOUT = 10
# Combined document cap. Three pages plus their "=== SOURCE" tags must still fit
# the 8,000 TPM budget together with the seven-rubric prompt, the screening pass
# and the response; the tests in tests/test_offline.py enforce the arithmetic.
DEFAULT_MAX_CHARS = 12_000
USER_AGENT = "AegisComplianceBot/0.1 (+AI compliance gap analysis prototype)"

# Root-domain URLs probe these groups first; the first hit in a group wins.
# Three groups maximum, so a scan reads a privacy notice, a security/trust page
# and an AI or product-terms page at most — never the whole site.
SUBPAGE_TARGETS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("privacy", ("/privacy", "/privacy-policy")),
    (
        "security",
        ("/security", "/trust", "/security-and-privacy", "/trust-center"),
    ),
    (
        "ai",
        (
            "/ai",
            "/ai-policy",
            "/responsible-ai",
            "/ai-transparency",
            "/product-terms",
            "/terms-of-service",
            "/terms",
        ),
    ),
)
MAX_SECTIONS = len(SUBPAGE_TARGETS)

# Per-page cap, so three pages (3 × 3,900) still fit the 12,000-character
# document budget together with the "=== SOURCE: ... ===" tags.
SECTION_MAX_CHARS = 3_900
MIN_POLICY_CHARS = 300

SECTION_LABELS: dict[str, str] = {
    "privacy": "privacy policy / privacy notice",
    "security": "security / trust page",
    "ai": "AI disclosure / product terms page",
    "document": "audited page",
}

# Tags that almost never contain substantive policy text.
BOILERPLATE_TAGS = (
    "nav",
    "header",
    "footer",
    "aside",
    "script",
    "style",
    "noscript",
    "svg",
    "form",
    "iframe",
    "button",
)

_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class Section:
    """One fetched page, tagged with the kind of page it is."""

    kind: str
    url: str
    text: str


@dataclass(frozen=True)
class Page:
    """The combined document plus every section that went into it."""

    url: str
    text: str
    sections: tuple[Section, ...] = ()

    def label(self) -> str:
        """Human-readable source list, e.g. ``privacy policy + trust page``."""
        if not self.sections:
            return self.url
        kinds = [SECTION_LABELS.get(s.kind, s.kind) for s in self.sections]
        return " + ".join(dict.fromkeys(kinds)) if len(kinds) > 1 else kinds[0]


def truncate(text: str, max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """Cut ``text`` to ``max_chars`` without splitting a word."""
    if len(text) <= max_chars:
        return text.strip()
    cut = text.rfind(" ", 0, max_chars)
    return text[: cut if cut > 0 else max_chars].strip()


def clean_html(html: str, max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """Return readable text from an HTML document, capped at ``max_chars``."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(BOILERPLATE_TAGS):
        tag.decompose()

    # Cookie banners and nav menus are often plain divs; drop obvious ones.
    for element in soup.find_all(attrs={"role": ["navigation", "banner", "contentinfo"]}):
        element.decompose()

    return truncate(_WHITESPACE_RE.sub(" ", soup.get_text(separator=" ")), max_chars)


def format_sections(sections: Sequence[Section], max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """Join sections into one tagged document the auditor can attribute."""
    blocks = []
    for section in sections:
        kind = SECTION_LABELS.get(section.kind, section.kind)
        blocks.append(f"=== SOURCE: {kind} — {section.url} ===\n{section.text}")
    return truncate("\n\n".join(blocks), max_chars)


def kind_for_path(path: str) -> str:
    """Infer a page kind from an explicit URL path."""
    lowered = (path or "/").lower().rstrip("/") or "/"
    for kind, candidates in SUBPAGE_TARGETS:
        for candidate in candidates:
            if lowered == candidate or lowered.startswith(f"{candidate}/"):
                return kind
    if any(word in lowered for word in ("privacy", "gdpr", "data-protection")):
        return "privacy"
    if any(word in lowered for word in ("security", "trust", "compliance")):
        return "security"
    if any(word in lowered for word in ("/ai", "terms", "product", "model")):
        return "ai"
    return "document"


def _get(url: str, timeout: int = DEFAULT_TIMEOUT) -> requests.Response:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
    response.raise_for_status()
    return response


def fetch_page(url: str, timeout: int = DEFAULT_TIMEOUT, max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """Download ``url`` and return its cleaned, truncated text."""
    response = _get(url, timeout=timeout)

    content_type = response.headers.get("Content-Type", "")
    if content_type and "html" not in content_type and "text" not in content_type:
        raise ValueError(f"Unsupported content type for {url}: {content_type!r}")

    if "html" in content_type.lower():
        return clean_html(response.text, max_chars=max_chars)
    return truncate(_WHITESPACE_RE.sub(" ", response.text), max_chars)


def _try_fetch(url: str, timeout: int = DEFAULT_TIMEOUT, max_chars: int = DEFAULT_MAX_CHARS) -> str | None:
    """Fetch and clean, returning ``None`` instead of raising for probes."""
    try:
        return fetch_page(url, timeout=timeout, max_chars=max_chars)
    except (requests.RequestException, ValueError):
        return None


def _discover_sections(parsed, timeout: int) -> list[Section]:
    """Probe the three page groups on a root domain and keep one page each."""
    sections: list[Section] = []
    seen_openings: set[str] = set()

    for kind, paths in SUBPAGE_TARGETS[:MAX_SECTIONS]:
        for path in paths:
            candidate = urlunparse(parsed._replace(path=path, query="", fragment=""))
            text = _try_fetch(candidate, timeout=timeout, max_chars=SECTION_MAX_CHARS)
            if not text or len(text) < MIN_POLICY_CHARS:
                continue
            # Sites often serve one policy at several paths; keep the first.
            opening = text[:200].lower()
            if opening in seen_openings:
                break
            seen_openings.add(opening)
            sections.append(Section(kind, candidate, text))
            break
    return sections


def scrape(url: str, timeout: int = DEFAULT_TIMEOUT, max_chars: int = DEFAULT_MAX_CHARS) -> Page:
    """Resolve ``url`` to one or more policy pages and return tagged text.

    For a root-domain URL (``https://acme.com``, ``https://acme.com/``) the
    privacy, security/trust and AI/product-terms paths are probed, and every
    group that answers with a substantive page is included. If none answers,
    the root page itself is fetched. An explicit path is fetched as given.
    """
    target = url if url.startswith(("http://", "https://")) else f"https://{url}"
    parsed = urlparse(target)

    if parsed.path in ("", "/"):
        sections = _discover_sections(parsed, timeout)
        if sections:
            return Page(
                url=sections[0].url,
                text=format_sections(sections, max_chars=max_chars),
                sections=tuple(sections),
            )

    text = fetch_page(target, timeout=timeout, max_chars=SECTION_MAX_CHARS)
    if not text:
        raise ValueError(f"No readable text found at {target}")
    section = Section(kind_for_path(parsed.path), target, text)
    return Page(
        url=target,
        text=format_sections([section], max_chars=max_chars),
        sections=(section,),
    )
