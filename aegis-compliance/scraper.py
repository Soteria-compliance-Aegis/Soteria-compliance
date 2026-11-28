"""Fetch and clean public policy text before any of it reaches Groq.

Given a root domain, Aegis probes up to three high-value page groups — privacy,
security/trust, and AI/product terms — and tags each document so the auditor
knows which page type a sentence came from. That tagging is what stops an
employment regulation from being graded against a consumer privacy notice.

Only readable text is kept: navigation, footers, scripts, styles and other
boilerplate are stripped. A long page is then reduced to the 10,000-character
budget by keeping the passages that mention AI, automated decisions, profiling,
training data, retention, opt-out and human oversight first, so a disclosure
buried at the bottom of a 90,000-character policy still reaches the auditor.
The cap itself is unchanged, which keeps prompt + response inside the
free-tier 8,000 TPM budget with seven regulation rubrics.
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
# Sized against the free tier: the audit prompt carries this text once and, in
# the same 8,000 TPM minute, the screening pass and a five-part remediation block
# for every open finding. Raising it truncates the model's remediation output.
DEFAULT_MAX_CHARS = 10_000
# Readable text is extracted from the whole page, then reduced to the budget by
# clause selection. This ceiling only stops a pathological page from being held
# in memory as a multi-megabyte string; it is not what the model sees.
MAX_SOURCE_CHARS = 400_000
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

# Terms that mark the passages a buyer's reviewer will actually grade. Used
# only to choose what survives the character cap, never to grade a document.
SIGNAL_TERMS: tuple[str, ...] = (
    "automated decision-making",
    "automated decision",
    "admt",
    "artificial intelligence",
    "machine learning",
    "model training",
    "training data",
    "train",
    "profiling",
    "profile",
    "retention",
    "retain",
    "opt-out",
    "opt out",
    "human review",
    "human oversight",
    "human intervention",
    "meaningful human",
    "consent",
    "personal data",
    "personal information",
    "disclosure",
    "disclose",
    "bias",
    "discriminate",
    "discriminatory",
    "grievance",
    "data protection",
    "dpdp",
    "sensitive",
    "third party",
    "third-party",
    "algorithm",
    "audit",
    "ai",
)
_TERM_SUFFIX = r"(?:s|es|d|ed|ing)?"
SIGNAL_RE = re.compile(
    r"(?<![a-z0-9])(" + "|".join(re.escape(term) + _TERM_SUFFIX for term in SIGNAL_TERMS) + r")(?![a-z0-9])",
    re.IGNORECASE,
)

# Passages are ~450 characters so a selected clause carries its antecedent.
PASSAGE_CHARS = 450
OMISSION_MARKER = "[… omitted text …]"

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
class ClauseSelection:
    """The text that survived the cap and why the selection looks the way it does.

    ``prioritized`` is True only when a high-signal passage was kept from beyond
    the point where plain head truncation would have stopped, which is the
    signal the audit UI shows the reviewer.
    """

    text: str
    original_chars: int
    kept_chars: int
    prioritized: bool
    signal_hits: int

    def public(self) -> dict[str, object]:
        """Small JSON-friendly view for the API and the audit UI."""
        return {
            "originalChars": self.original_chars,
            "keptChars": self.kept_chars,
            "prioritized": self.prioritized,
            "signalHits": self.signal_hits,
        }


@dataclass(frozen=True)
class Page:
    """The combined document plus every section that went into it."""

    url: str
    text: str
    sections: tuple[Section, ...] = ()
    clause: ClauseSelection | None = None

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


def _signal_score(text: str) -> int:
    """How many distinct high-signal terms a passage mentions."""
    return len({match.lower() for match in SIGNAL_RE.findall(text)})


def _split_sentences(text: str):
    """Yield sentence-sized pieces, hard-splitting an unpunctuated run."""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        sentence = sentence.strip()
        while len(sentence) > PASSAGE_CHARS:
            cut = sentence.rfind(" ", 0, PASSAGE_CHARS)
            cut = cut if cut > 0 else PASSAGE_CHARS
            yield sentence[:cut].strip()
            sentence = sentence[cut:].strip()
        if sentence:
            yield sentence


def _passages(text: str) -> list[tuple[str, int, bool]]:
    """Return ``(passage, signal score, is_source_tag)`` in reading order."""
    passages: list[tuple[str, int, bool]] = []
    for block in text.split("\n\n"):
        header = ""
        body = block
        if block.startswith("=== SOURCE:") and "\n" in block:
            header, body = block.split("\n", 1)
        if header.strip():
            # The page tag must survive: it is how the auditor attributes a
            # sentence to the privacy policy rather than the homepage.
            passages.append((header.strip(), 0, True))

        chunk: list[str] = []
        size = 0
        for sentence in _split_sentences(body):
            if chunk and size + len(sentence) > PASSAGE_CHARS:
                joined = " ".join(chunk)
                passages.append((joined, _signal_score(joined), False))
                chunk, size = [], 0
            chunk.append(sentence)
            size += len(sentence) + 1
        if chunk:
            joined = " ".join(chunk)
            passages.append((joined, _signal_score(joined), False))
    return passages


def select_clauses(text: str, max_chars: int = DEFAULT_MAX_CHARS) -> ClauseSelection:
    """Reduce ``text`` to ``max_chars``, keeping high-signal clauses first.

    Passages that mention AI, automated decisions, profiling, training data,
    retention, opt-out, consent or human oversight are chosen before generic
    marketing copy, so a disclosure at the bottom of a long policy is not lost
    to head truncation. Selected passages are returned in reading order with an
    omission marker where text was skipped, and the total never exceeds the cap.
    """
    original = len(text)
    hits_total = len(SIGNAL_RE.findall(text))
    if original <= max_chars:
        kept = text.strip()
        return ClauseSelection(kept, original, len(kept), False, hits_total)

    passages = _passages(text)
    chosen: list[int] = []
    used = 0

    def take(index: int) -> bool:
        nonlocal used
        cost = len(passages[index][0]) + len(OMISSION_MARKER) + 2
        if used + cost > max_chars:
            return False
        chosen.append(index)
        used += cost
        return True

    # 1. Every page tag and its opening, so each source is represented.
    for index, (_body, _score, tagged) in enumerate(passages):
        if tagged:
            take(index)

    # 2. Highest-signal passages, wherever they sit in the document.
    ranked = sorted(
        (index for index, (_body, score, tagged) in enumerate(passages) if score and not tagged),
        key=lambda index: (-passages[index][1], index),
    )
    for index in ranked:
        take(index)

    # 3. Whatever budget is left goes back to ordinary copy in reading order.
    for index, (_body, score, tagged) in enumerate(passages):
        if not score and not tagged:
            take(index)

    # Plain head truncation would have stopped here; anything high-signal past
    # this point is exactly what prioritisation rescued.
    head_limit = 0
    head_used = 0
    for index, (body, _score, _tagged) in enumerate(passages):
        head_used += len(body) + 2
        if head_used > max_chars:
            break
        head_limit = index
    prioritized = any(passages[index][1] > 0 and index > head_limit for index in chosen)

    chosen.sort()
    parts: list[str] = []
    previous: int | None = None
    for index in chosen:
        if previous is not None and index > previous + 1:
            parts.append(OMISSION_MARKER)
        parts.append(passages[index][0])
        previous = index

    kept_text = truncate("\n".join(parts), max_chars)
    return ClauseSelection(
        kept_text,
        original,
        len(kept_text),
        prioritized,
        len(SIGNAL_RE.findall(kept_text)),
    )


def format_sections(sections: Sequence[Section], max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """Join sections into one tagged document the auditor can attribute."""
    return format_sections_report(sections, max_chars=max_chars)[0]


def format_sections_report(
    sections: Sequence[Section], max_chars: int = DEFAULT_MAX_CHARS
) -> tuple[str, ClauseSelection]:
    """Join sections and report what survived the cap, and whether it was chosen."""
    blocks = []
    for section in sections:
        kind = SECTION_LABELS.get(section.kind, section.kind)
        blocks.append(f"=== SOURCE: {kind} — {section.url} ===\n{section.text}")
    selection = select_clauses("\n\n".join(blocks), max_chars=max_chars)
    return selection.text, selection


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
    """Download ``url`` and return its cleaned text, prioritised under the cap."""
    response = _get(url, timeout=timeout)

    content_type = response.headers.get("Content-Type", "")
    if content_type and "html" not in content_type and "text" not in content_type:
        raise ValueError(f"Unsupported content type for {url}: {content_type!r}")

    if "html" in content_type.lower():
        source = clean_html(response.text, max_chars=MAX_SOURCE_CHARS)
    else:
        source = _WHITESPACE_RE.sub(" ", response.text)
    return select_clauses(source, max_chars=max_chars).text


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
            text, clause = format_sections_report(sections, max_chars=max_chars)
            return Page(url=sections[0].url, text=text, sections=tuple(sections), clause=clause)

    text = fetch_page(target, timeout=timeout, max_chars=SECTION_MAX_CHARS)
    if not text:
        raise ValueError(f"No readable text found at {target}")
    section = Section(kind_for_path(parsed.path), target, text)
    document_text, clause = format_sections_report([section], max_chars=max_chars)
    return Page(url=target, text=document_text, sections=(section,), clause=clause)
