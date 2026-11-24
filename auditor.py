"""One Groq call that grades a document against every regulation.

Keeps a sliding per-minute token budget and backs off exponentially on rate
limits so the free tier's 8,000 TPM ceiling is never deliberately crossed.
"""

from __future__ import annotations

import json
import os
import random
import threading
import time
from collections import deque
from typing import Any

from dotenv import load_dotenv
from groq import APIConnectionError, APIStatusError, APITimeoutError, Groq, RateLimitError

from brief import BRIEF_MAX_OUTPUT_TOKENS, build_brief_prompt, normalize_brief
from rules import NA_STATUS, REGULATIONS, REGULATION_IDS, Status, build_prompt

MODEL = "openai/gpt-oss-120b"
MODEL_FAST = "openai/gpt-oss-20b"

# Free tier guardrail: stay strictly under 8,000 tokens per minute.
TPM_LIMIT = 8_000
# Seven findings with verbatim quotes need room, and gpt-oss reasoning counts too.
# Sized so the scraper's full document cap still fits 8,000 TPM together with
# the screening pass; see tests/test_offline.py for the enforced arithmetic.
DEFAULT_MAX_OUTPUT_TOKENS = 1_300
# The screening pass only needs a short excerpt and a one-word label, so it adds
# roughly 650 tokens to a scan and still leaves the deep audit inside 8,000 TPM.
SCREEN_MAX_CHARS = 1_200
DEFAULT_CLASSIFY_OUTPUT_TOKENS = 60
MAX_RETRIES = 5

SEVERITIES = ("High", "Medium", "Low")

# The model writes N/A in a few different shapes; all of them mean one thing.
_NA_EXACT = {
    "n/a",
    "na",
    "n.a.",
    "not applicable",
    "not_applicable",
    "notapplicable",
    "n/a (out of scope)",
    "out of scope",
}


def estimate_tokens(text: str) -> int:
    """Cheap heuristic (~4 chars/token); good enough for budget accounting."""
    return max(1, len(text) // 4)


class TokenBudget:
    """Sliding 60-second window that blocks before exceeding ``tpm`` tokens.

    The same instance is safe to share across threads, which is what lets two
    concurrent dashboard uploads queue behind one 8,000 TPM ceiling instead of
    each spending the full allowance. ``audit_document`` and ``classify_page``
    use the process-wide budget from ``shared_budget()`` unless another is
    passed in explicitly.
    """

    def __init__(self, tpm: int = TPM_LIMIT, window_seconds: float = 60.0) -> None:
        self.tpm = tpm
        self.window_seconds = window_seconds
        self._events: deque[tuple[float, int]] = deque()
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        while self._events and now - self._events[0][0] > self.window_seconds:
            self._events.popleft()

    def _used(self) -> int:
        return sum(tokens for _, tokens in self._events)

    def used(self) -> int:
        """Tokens currently reserved inside the window (for status readouts)."""
        with self._lock:
            self._prune(time.monotonic())
            return self._used()

    def snapshot(self) -> dict[str, float]:
        """Small JSON-friendly view of the budget for the dashboard."""
        with self._lock:
            now = time.monotonic()
            self._prune(now)
            used = self._used()
            resets_in = (
                max(self.window_seconds - (now - self._events[0][0]), 0.0)
                if self._events
                else 0.0
            )
        return {
            "tpm": self.tpm,
            "used": used,
            "remaining": max(self.tpm - used, 0),
            "windowSeconds": self.window_seconds,
            "resetsInSeconds": round(resets_in, 1),
        }

    def acquire(self, tokens: int) -> None:
        """Block until ``tokens`` more fit inside the current window.

        The check-and-record step holds the lock, so two threads can never both
        see room for the same remaining allowance.
        """
        if tokens > self.tpm:
            raise ValueError(
                f"Request of {tokens} tokens exceeds the {self.tpm} TPM budget; use a smaller document"
            )

        while True:
            with self._lock:
                now = time.monotonic()
                self._prune(now)
                if self._used() + tokens <= self.tpm:
                    self._events.append((now, tokens))
                    return
                oldest_at = self._events[0][0]
                delay = self.window_seconds - (now - oldest_at) + 0.25
            # Sleep outside the lock so other waiters can re-check and the
            # thread that is already spending never blocks on this one.
            time.sleep(max(delay, 0.25))


_SHARED_BUDGET: TokenBudget | None = None
_SHARED_LOCK = threading.Lock()


def shared_budget() -> TokenBudget:
    """Return the one token budget the whole process draws on.

    Dashboard audits run in worker threads, so a per-call budget let two
    concurrent uploads each spend the free tier's full 8,000 TPM. Every audit
    path defaults to this instance instead.
    """
    global _SHARED_BUDGET
    if _SHARED_BUDGET is None:
        with _SHARED_LOCK:
            if _SHARED_BUDGET is None:
                _SHARED_BUDGET = TokenBudget()
    return _SHARED_BUDGET


def _client() -> Groq:
    load_dotenv()  # pick up GROQ_API_KEY from a local .env on first use
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set. Copy it into .env before running audits.")
    return Groq(api_key=api_key)


def _retry_after(exc: Exception) -> float | None:
    """Read Groq's ``retry-after`` header when present."""
    headers = getattr(getattr(exc, "response", None), "headers", None) or {}
    try:
        return float(headers.get("retry-after"))
    except (TypeError, ValueError):
        return None


def _extract_json(raw: str) -> dict[str, Any]:
    """Parse the model output, tolerating stray prose or code fences."""
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        raise ValueError(f"Model did not return JSON: {raw[:200]!r}")
    return json.loads(raw[start : end + 1])


def _chat(
    messages: list[dict],
    *,
    model: str = MODEL,
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
    reasoning_effort: str | None = "low",
) -> str:
    """Call Groq and return the assistant text.

    Retries rate limits (HTTP 429), server errors (5xx) and connection drops
    with exponential backoff. ``max_completion_tokens`` is used because
    ``max_tokens`` is deprecated on Groq; gpt-oss also spends part of that
    budget on reasoning, so reasoning is dialled down.
    """
    client = _client()
    params: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_completion_tokens": max_output_tokens,
        "temperature": 0.0,  # deterministic judgements for compliance output
        "response_format": {"type": "json_object"},
    }
    if reasoning_effort and model.startswith("openai/gpt-oss"):
        params["reasoning_effort"] = reasoning_effort

    for attempt in range(MAX_RETRIES):
        last_attempt = attempt == MAX_RETRIES - 1
        try:
            response = client.chat.completions.create(**params)
        except (RateLimitError, APIConnectionError, APITimeoutError, APIStatusError) as exc:
            retryable = isinstance(exc, (RateLimitError, APIConnectionError, APITimeoutError))
            status = getattr(exc, "status_code", None)
            retryable = retryable or (status is not None and status >= 500)
            if last_attempt or not retryable:
                raise

            delay = _retry_after(exc) or (2**attempt + random.random())
            print(f"[auditor] {type(exc).__name__}: retrying in {delay:.1f}s")
            time.sleep(delay)
            continue

        choice = response.choices[0]
        text = (choice.message.content or "").strip()
        if not text:
            # An empty completion is usually a transient reasoning-budget blip,
            # so retry before failing the whole audit.
            if last_attempt:
                raise RuntimeError(
                    f"{model} returned no text (finish_reason={choice.finish_reason!r}); "
                    "lower reasoning_effort or raise max_output_tokens"
                )
            delay = 2**attempt + random.random()
            print(f"[auditor] empty completion: retrying in {delay:.1f}s")
            time.sleep(delay)
            continue
        if choice.finish_reason == "length":
            print(
                f"[auditor] response hit max_completion_tokens={max_output_tokens}; "
                "some findings may be truncated"
            )
        return text
    raise RuntimeError("unreachable: retry loop exhausted")


def _normalize_status(value: Any) -> Status:
    raw = str(value or "").strip()
    lowered = raw.lower()
    if lowered in _NA_EXACT or "out of scope" in lowered or lowered.startswith("n/a"):
        return NA_STATUS
    status = raw.capitalize()
    return status if status in ("Pass", "Warning", "Fail") else "Warning"


def _normalize_severity(value: Any, status: Status) -> str:
    if status == NA_STATUS:
        return "None"
    severity = str(value).strip().capitalize()
    if severity in SEVERITIES:
        return severity
    # Fall back to what the status implies rather than dropping the signal.
    return {"Fail": "High", "Warning": "Medium", "Pass": "Low"}[status]


def _clean_quote(value: Any) -> str:
    """Drop literal empty markers ("", 'none', '-') the model may emit."""
    quote = str(value or "").strip()
    if len(quote) >= 2 and quote[0] in "\"'" and quote[-1] == quote[0]:
        quote = quote[1:-1].strip()
    return "" if quote.lower() in ("", "n/a", "none", "null", "not found", "-") else quote


def _match_regulation(value: Any) -> str | None:
    """Map whatever the model called a regulation onto a rubric id."""
    wanted = str(value).strip().lower()
    if not wanted:
        return None
    for regulation_id in REGULATION_IDS:
        if wanted in (regulation_id.lower(), REGULATIONS[regulation_id]["name"].lower()):
            return regulation_id
    for regulation_id in REGULATION_IDS:
        name = REGULATIONS[regulation_id]["name"].lower()
        if regulation_id.lower() in wanted or name in wanted:
            return regulation_id
    # Models often shorten a rubric to "DPDP Act" or "Section 5"; matching an
    # alias keeps that finding instead of degrading it to a manual-review gap.
    for regulation_id in REGULATION_IDS:
        for alias in REGULATIONS[regulation_id].get("aliases", ()):
            if alias in wanted:
                return regulation_id
    return None


def normalize_findings(items: Any) -> list[dict[str, str]]:
    """Return exactly one normalized finding per regulation, in rubric order.

    Missing or unrecognized entries become manual-review warnings so the report
    always covers the full scope.
    """
    by_id: dict[str, dict[str, str]] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        regulation_id = _match_regulation(item.get("regulation"))
        if regulation_id is None or regulation_id in by_id:
            continue
        status = _normalize_status(item.get("status", "Warning"))
        out_of_scope = status == NA_STATUS
        by_id[regulation_id] = {
            "regulation": REGULATIONS[regulation_id]["name"],
            "regulation_id": regulation_id,
            "status": status,
            "severity": _normalize_severity(item.get("severity"), status),
            # An out-of-scope item must never ship a quote: it is a statement
            # about applicability, not evidence of a problem.
            "evidence_quote": "" if out_of_scope else _clean_quote(item.get("evidence_quote")),
            "remediation_note": str(item.get("remediation_note") or "").strip()
            or (
                "Confirm whether this regulation applies to the company's activities."
                if out_of_scope
                else "Review manually; the model returned no remediation for this regulation."
            ),
        }

    findings = []
    for regulation_id in REGULATION_IDS:
        findings.append(
            by_id.get(regulation_id)
            or {
                "regulation": REGULATIONS[regulation_id]["name"],
                "regulation_id": regulation_id,
                "status": "Warning",
                "severity": "Medium",
                "evidence_quote": "",
                "remediation_note": "The model returned no finding for this regulation; review manually.",
            }
        )
    return findings


_QUOTE_TRANSLATION = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u00a0": " ",
    }
)


def _collapse(text: str) -> str:
    """Normalise for quote matching only; the quote itself stays verbatim."""
    return " ".join(text.translate(_QUOTE_TRANSLATION).split()).casefold()


def quote_in_document(quote: str, document_text: str) -> bool:
    """True when ``quote`` really appears in the text that was sent."""
    needle = _collapse(quote).strip()
    # A trailing ellipsis only says the model stopped copying; the words it
    # did show still have to match, so drop the marker and verify the rest.
    for ellipsis in ("\u2026", "..."):
        if needle.endswith(ellipsis):
            needle = needle[: -len(ellipsis)].strip()
            break
    if not needle:
        return False
    haystack = _collapse(document_text)
    if needle in haystack:
        return True
    # Tolerate a quote the model clipped with an ellipsis, then its opening.
    stripped = needle.strip(" .")
    if stripped and stripped in haystack:
        return True
    # The model may clip a long passage to its opening. Accept that only when
    # the closing words also appear after it, so a real opening cannot be
    # welded onto invented text and shipped as evidence.
    head = needle[:120].strip(" .,;:'\"")
    if not head:
        return False
    start = haystack.find(head)
    if start == -1:
        return False
    tail = needle[-80:].strip(" .,;:'\"")
    return not tail or tail in haystack[start + len(head) :]


def _apply_evidence_rules(findings: list[dict[str, str]], document_text: str) -> list[dict[str, str]]:
    """Enforce that a Fail points at real problematic text in the document.

    A quote that cannot be found was either paraphrased or invented, so it is
    dropped rather than shown as evidence. A Fail left without a quote is a
    disclosure gap, so it becomes a Warning: absence is not a violation.
    """
    for finding in findings:
        if finding["status"] == NA_STATUS:
            finding["severity"] = "None"
            finding["evidence_quote"] = ""
            continue

        quote = finding["evidence_quote"]
        if quote and not quote_in_document(quote, document_text):
            finding["evidence_quote"] = ""
            quote = ""

        if finding["status"] == "Fail" and not quote:
            finding["status"] = "Warning"
            finding["severity"] = "Medium"
            if "disclosure gap" not in finding["remediation_note"]:
                finding["remediation_note"] += (
                    " No problematic wording was found in the document, so this is"
                    " graded as a disclosure gap rather than a violation."
                )
    return findings


def audit_document(
    document_text: str,
    *,
    source: str = "document",
    model: str = MODEL,
    budget: TokenBudget | None = None,
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
) -> list[dict[str, str]]:
    """Grade one document against every regulation in a single Groq call."""
    messages = build_prompt(document_text, source=source)

    budget = budget or shared_budget()
    budget.acquire(sum(estimate_tokens(message["content"]) for message in messages) + max_output_tokens)

    raw = _chat(messages, model=model, max_output_tokens=max_output_tokens)
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[auditor] unparseable response for {source}: {exc}")
        parsed = {}

    findings = normalize_findings(parsed.get("findings") if isinstance(parsed, dict) else None)
    return _apply_evidence_rules(findings, document_text)


def generate_brief(
    company: str,
    url: str,
    homepage_copy: str,
    privacy_policy: str,
    *,
    model: str = MODEL,
    budget: TokenBudget | None = None,
) -> dict[str, Any]:
    """Compare homepage claims and the privacy policy into a 1-page brief."""
    messages = build_brief_prompt(company, url, homepage_copy, privacy_policy)

    budget = budget or shared_budget()
    budget.acquire(
        sum(estimate_tokens(message["content"]) for message in messages)
        + BRIEF_MAX_OUTPUT_TOKENS
    )

    raw = _chat(messages, model=model, max_output_tokens=BRIEF_MAX_OUTPUT_TOKENS)
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[auditor] unparseable brief response: {exc}")
        parsed = {}
    return normalize_brief(
        parsed if isinstance(parsed, dict) else {},
        company=company,
        url=url,
        homepage_copy=homepage_copy,
        privacy_policy=privacy_policy,
    )


PAGE_LABELS: dict[str, str] = {
    "privacy_policy": "a privacy policy or privacy notice",
    "terms_of_service": "terms of service / terms of use / acceptable use",
    "ai_disclosure": "an AI, model, or responsible-AI disclosure page",
    "careers_or_hiring": "a careers, jobs, or hiring page",
    "other": "anything else: marketing, blog, docs, support, product or landing page",
}

# Labels that are worth a deep audit.
POLICY_LABELS = frozenset(PAGE_LABELS) - {"other"}

_LABEL_MENU = "\n".join(f'- "{key}": {text}' for key, text in PAGE_LABELS.items())

CLASSIFY_PROMPT = (
    "Label the web page excerpt supplied by the user.\n\n"
    'Return ONLY a JSON object of the form {"label": "<label>"} where <label> is\n'
    "exactly one of these keys:\n"
    f"{_LABEL_MENU}\n\n"
    "Judge what the page *is*, not whether it mentions AI. Use \"other\" only when the\n"
    "page is clearly not a policy, legal, AI-disclosure, or hiring page.\n"
)


def _normalize_label(value: Any) -> str:
    label = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    return label if label in PAGE_LABELS else ""


def classify_page(
    document_text: str,
    *,
    model: str = MODEL_FAST,
    budget: TokenBudget | None = None,
) -> str:
    """Screen a page with the fast model and return one of ``PAGE_LABELS``.

    Raises if the model answers unusably, so the caller can fail open and still
    run the deep audit instead of silently skipping a real policy page.
    """
    messages = [
        {"role": "system", "content": CLASSIFY_PROMPT},
        {"role": "user", "content": f"EXCERPT:\n{document_text[:SCREEN_MAX_CHARS]}"},
    ]

    budget = budget or shared_budget()
    budget.acquire(
        sum(estimate_tokens(message["content"]) for message in messages)
        + DEFAULT_CLASSIFY_OUTPUT_TOKENS
    )

    raw = _chat(messages, model=model, max_output_tokens=DEFAULT_CLASSIFY_OUTPUT_TOKENS)
    label = _normalize_label(_extract_json(raw).get("label"))
    if not label:
        raise ValueError(f"Unrecognised page label: {raw[:120]!r}")
    return label
