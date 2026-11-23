"""Public footprint mini-audit: homepage claims vs the privacy policy.

This module is prompt + normalisation only. It never calls Groq; ``auditor``
does that so every audit keeps sharing the one 8,000 TPM budget. The rubrics
themselves stay in ``rules.py`` and are read from there, never duplicated.
"""

from __future__ import annotations

from typing import Any

from rules import REGULATIONS

MISSING_FROM_POLICY = "Missing completely from Privacy Policy"

# The free tier's 8,000 TPM is shared with the screening pass; these caps keep
# the prompt plus the brief's output comfortably inside one window.
HOMEPAGE_MAX_CHARS = 5_000
PRIVACY_MAX_CHARS = 8_000
BRIEF_MAX_OUTPUT_TOKENS = 1_600

NOTE = (
    "This public footprint check is an operational readiness assessment, "
    "not formal legal advice."
)


BRIEF_SYSTEM_PROMPT = """You are a technical AI governance auditor producing a
"Public Footprint Mini-Audit" for a US startup. You compare what a company
claims on its public homepage and product copy against what its privacy policy
actually discloses. You are not a lawyer and you never give legal advice.

You receive the company name/URL, the homepage/product copy, the privacy policy
text, and the REGULATORY RUBRICS to check against.

HARD RULES — follow all of them on every run:
1. Return only the THREE highest-confidence gaps. Never pad the report with
   low-value filler. Fewer than three is correct when the evidence is thin.
2. Every gap must be grounded in the supplied text:
   - homepage_claim must be copied character-for-character from the homepage copy.
   - privacy_policy_quote must be copied character-for-character from the
     privacy policy. If the policy is silent on this point, write exactly
     "Missing completely from Privacy Policy" and nothing else.
   - Never invent, paraphrase, merge, or tidy a quote. If you cannot quote the
     homepage claim verbatim, drop that gap entirely.
3. Never assume this startup meets the California CCPA/CPRA thresholds
   ($26.625M+ annual revenue, 100k+ consumers, or 50%+ of revenue from selling
   personal data). Frame California ADMT/CCPA (effective January 1, 2027) and
   Colorado SB 26-189 (effective January 1, 2027) as UPCOMING deadlines and
   enterprise buyer vendor-review blockers, never as present violations unless
   the supplied text states the threshold is met.
4. Write in plain executive business language. Zero legal jargon, no statutory
   recitals, no hedging that sounds like legal advice. Every gap is written for
   a founder or a buyer's security reviewer.
5. A missing disclosure is a gap, not a violation. Only call something a risk,
   never a breach or a violation, unless the text itself makes a prohibited
   claim.

Return ONLY a JSON object shaped exactly like this, with 1 to 3 gaps ordered
highest confidence and deal impact first:
{
  "snapshot": "2-3 sentences on the single most important mismatch, in business terms",
  "gaps": [
    {
      "title": "short gap title, e.g. Undisclosed third-party AI processing",
      "homepage_claim": "verbatim quote from the homepage copy",
      "privacy_policy_quote": "verbatim quote from the privacy policy, or Missing completely from Privacy Policy",
      "risk": "1-2 sentences naming the rule, any 2027 deadline, and the business impact",
      "fix": "one concrete sentence a founder can action this week"
    }
  ]
}
"""


def _rubric_reference() -> str:
    """Compact checklist built from the project's own rubrics."""
    blocks = []
    for regulation_id, meta in REGULATIONS.items():
        checks = "\n".join(f"  - {check}" for check in meta["checks"])
        blocks.append(
            f"[{regulation_id}] {meta['name']}\n"
            f"FOCUS: {meta['focus']}\n"
            f"CHECKS:\n{checks}"
        )
    return "\n\n".join(blocks)


def build_brief_prompt(
    company: str,
    url: str,
    homepage_copy: str,
    privacy_policy: str,
) -> list[dict]:
    """One chat prompt comparing the two public documents."""
    user_prompt = f"""COMPANY: {company}
URL: {url or "not provided"}

REGULATORY RUBRICS:
{_rubric_reference()}

HOMEPAGE / PRODUCT COPY:
\"\"\"
{homepage_copy[:HOMEPAGE_MAX_CHARS]}
\"\"\"

PRIVACY POLICY:
\"\"\"
{privacy_policy[:PRIVACY_MAX_CHARS]}
\"\"\"

Run the Public Footprint Mini-Audit now and return the JSON object.
"""
    return [
        {"role": "system", "content": BRIEF_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


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
    return " ".join(text.translate(_QUOTE_TRANSLATION).split()).casefold()


def _clean(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) >= 2 and text[0] in "\"'" and text[-1] == text[0]:
        text = text[1:-1].strip()
    if text.lower() in ("", "n/a", "none", "null", "-", "not found"):
        return ""
    return text


def _is_verbatim(quote: str, source: str) -> bool:
    """True when the quote really appears in the text it claims to come from."""
    needle = _collapse(quote)
    if not needle:
        return False
    haystack = _collapse(source)
    if needle in haystack:
        return True
    # Tolerate a model clipping a long passage to its opening sentence.
    head = needle[:120].strip(" .,;:'\"")
    return bool(head) and head in haystack


def _is_missing(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("missing") or lowered in (
        "not mentioned",
        "no mention",
        "absent",
        "missing completely from privacy policy",
    )


def normalize_brief(
    parsed: dict[str, Any],
    *,
    company: str,
    url: str,
    homepage_copy: str,
    privacy_policy: str,
) -> dict[str, Any]:
    """Enforce the guardrails on whatever the model returned.

    Quotes that cannot be found in the source are dropped; a dropped homepage
    claim removes the gap, because an unquotable claim is not evidence. An
    unquotable or silent policy point becomes the exact missing marker.
    """
    gaps: list[dict[str, str]] = []
    raw_gaps = parsed.get("gaps") if isinstance(parsed, dict) else None

    for item in raw_gaps if isinstance(raw_gaps, list) else []:
        if not isinstance(item, dict):
            continue
        title = _clean(item.get("title"))
        claim = _clean(item.get("homepage_claim"))
        if not title or not claim or not _is_verbatim(claim, homepage_copy):
            continue

        policy_quote = _clean(item.get("privacy_policy_quote"))
        if policy_quote and not _is_missing(policy_quote):
            if not _is_verbatim(policy_quote, privacy_policy):
                policy_quote = ""
        if not policy_quote or _is_missing(policy_quote):
            policy_quote = MISSING_FROM_POLICY

        risk = _clean(item.get("risk")) or (
            "Enterprise buyers will raise this in vendor security review; "
            "close the gap before the 2027 AI rules take effect."
        )
        fix = _clean(item.get("fix")) or (
            "Update the privacy policy so the public claim and the disclosure match."
        )

        gaps.append(
            {
                "title": title,
                "homepage_claim": claim,
                "privacy_policy_quote": policy_quote,
                "risk": risk,
                "fix": fix,
            }
        )
        if len(gaps) == 3:
            break

    snapshot = _clean(parsed.get("snapshot")) if isinstance(parsed, dict) else ""
    if not snapshot:
        snapshot = (
            f"We compared {company}'s public product claims with its privacy "
            f"disclosures and found {len(gaps)} high-confidence gap(s) a buyer "
            "would spot in vendor review."
            if gaps
            else f"We found no high-confidence mismatch between {company}'s public "
            "claims and its privacy disclosures in the text supplied."
        )

    return {
        "company": company,
        "url": url,
        "snapshot": snapshot,
        "gaps": gaps,
        "note": NOTE,
    }
