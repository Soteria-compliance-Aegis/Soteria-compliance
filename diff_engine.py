"""Claim-vs-policy diff: public promises against what the policy discloses.

``rules.py`` stays the single source of truth for the rubrics. This module adds
the severity ladder the footprint audit needs (Critical/High/Medium), the US
framework catalogue with its effective dates, and the normalisation that makes
the output trustworthy:

- every claim quote must appear character-for-character in the claim text, or
  the gap is dropped — an unquotable claim is not evidence;
- every policy quote must appear in the policy text, otherwise it becomes the
  exact marker ``Missing completely from Privacy Policy``;
- the model may only map findings onto known framework ids;
- California CCPA/ADMT and Colorado SB 26-189 are framed as January 1, 2027
  deadlines a buyer will ask about, never as present violations, and no revenue
  or consumer threshold is assumed.
"""

from __future__ import annotations

import json
from typing import Any

from auditor import _chat, _extract_json, estimate_tokens, shared_budget
from brief import MISSING_FROM_POLICY
from rules import REGULATIONS

CLAIMS_MAX_CHARS = 6_000
POLICY_MAX_CHARS = 9_000
DIFF_MAX_OUTPUT_TOKENS = 1_700
MAX_GAPS = 6

SEVERITIES = ("Critical", "High", "Medium")
SEVERITY_ORDER = {"Critical": 0, "High": 1, "Medium": 2}

NOTE = (
    "Operational readiness assessment, not formal legal advice. Upcoming 2027 obligations "
    "are framed as buyer vendor-review blockers and deadlines, not as present violations."
)

# Framework details live here because rules.py describes what to check, while
# this table describes when a buyer will ask about it. Colorado is not a rubric
# in rules.py yet, so it is catalogue-only until it is promoted there.
FRAMEWORKS: dict[str, dict[str, str]] = {
    "ftc_section5": {
        "name": "FTC Act Section 5 (AI-washing / deception)",
        "deadline": "Enforced today",
        "status": "In force",
        "why": "Absolute accuracy, safety or compliance claims must be substantiated.",
        "aliases": "ftc, section 5, ai-washing, ai washing, deception",
    },
    "ccpa_admt": {
        "name": "California CCPA / ADMT rules",
        "deadline": "January 1, 2027",
        "status": "Upcoming deadline",
        "why": "Pre-use notice, opt-out and human review for automated decisions about people.",
        "aliases": "ccpa, cpra, admt, california admt",
    },
    "colorado_sb26189": {
        "name": "Colorado SB 26-189 (AI Act amendments)",
        "deadline": "January 1, 2027",
        "status": "Upcoming deadline",
        "why": "Risk-management, disclosure and impact-assessment duties for high-risk AI.",
        "aliases": "colorado, sb 26-189, sb26189, colorado ai act",
    },
    "texas_traiga": {
        "name": "Texas TRAIGA",
        "deadline": "January 1, 2026",
        "status": "In force",
        "why": "Reasonable care through bias and security testing aligned to NIST AI RMF.",
        "aliases": "traiga, texas traiga, texas responsible ai",
    },
    "nyc_ll144": {
        "name": "NYC Local Law 144 (AEDTs)",
        "deadline": "In force since July 2023",
        "status": "In force",
        "why": "Annual independent bias audit summary for hiring and promotion tools.",
        "aliases": "ll144, ll 144, local law 144, aedt, bias audit",
    },
}

FRAMEWORK_IDS: tuple[str, ...] = tuple(FRAMEWORKS)


def framework_catalog() -> list[dict[str, str]]:
    """Small JSON-friendly view for the workspace and health endpoint."""
    return [
        {
            "id": framework_id,
            "name": meta["name"],
            "deadline": meta["deadline"],
            "status": meta["status"],
            "why": meta["why"],
        }
        for framework_id, meta in FRAMEWORKS.items()
    ]


def _framework_reference() -> str:
    rules = []
    for regulation_id, meta in REGULATIONS.items():
        rules.append(f"[{regulation_id}] {meta['name']} — {meta['focus']}")
    deadlines = "\n".join(
        f"- {framework_id}: {meta['name']} ({meta['status']}, {meta['deadline']})"
        for framework_id, meta in FRAMEWORKS.items()
    )
    return "RUBRICS (from rules.py):\n" + "\n".join(rules) + "\n\nFRAMEWORK IDS:\n" + deadlines


DIFF_SYSTEM_PROMPT = """You are a technical AI governance auditor comparing what a
US startup PROMISES publicly with what its PRIVACY POLICY actually discloses. You
are not a lawyer and you never give legal advice.

You receive the company, the public claim text (homepage, pricing, product and
trust pages), the privacy policy text, and the rubric/framework catalogue.

HARD RULES — apply every one:
1. Report only substantive, high-confidence mismatches. Never pad with style,
   tone, or missing boilerplate. Zero gaps is a valid answer.
2. Quotes are evidence:
   - claim_quote must be copied CHARACTER-FOR-CHARACTER from the public claims.
   - policy_quote must be copied CHARACTER-FOR-CHARACTER from the policy. If the
     policy is silent on that point, write exactly
     "Missing completely from Privacy Policy" and nothing else.
   - Never paraphrase, merge sentences, fix typos, or invent text.
3. Severity:
   - Critical: the public claim itself is deceptive or absolute (for example
     "100% accurate", "fully HIPAA compliant", "unbiased hiring decisions") and
     nothing in the policy supports it.
   - High: a material capability, data-use, retention, or automated-decision
     practice is disclosed publicly but contradicted or undisclosed in policy.
   - Medium: the policy is vague, partial, or silent on a claim a buyer's
     security reviewer will ask about.
4. Map each gap to one or more framework ids from the catalogue. Never invent an
   id. Use ftc_section5 for unsubstantiated claims, ccpa_admt and
   colorado_sb26189 for automated decisions and notice gaps, texas_traiga for
   missing testing/security evidence, nyc_ll144 only when hiring or candidate
   screening is actually described.
5. Never assume the company meets any statutory threshold (revenue, consumer
   count, data-sale share). California CCPA/ADMT and Colorado SB 26-189 take
   effect January 1, 2027: describe them as UPCOMING deadlines and enterprise
   vendor-review blockers, never as present violations.
6. Plain executive language for a founder and a buyer's security reviewer. No
   statutory recitals, no legal conclusions, no advice to sue or not comply.
7. remediation must be one concrete operational change, not "consult a lawyer".

Return ONLY this JSON object:
{
  "summary": "2-3 sentences naming the most consequential mismatch and why it matters commercially",
  "gaps": [
    {
      "title": "short gap title",
      "severity": "Critical" | "High" | "Medium",
      "claim_quote": "verbatim public claim",
      "policy_quote": "verbatim policy sentence, or Missing completely from Privacy Policy",
      "frameworks": ["ftc_section5"],
      "why_it_matters": "1-2 sentences on the buyer or regulatory consequence",
      "remediation": "one concrete change this week"
    }
  ]
}
"""


def build_diff_prompt(
    company: str,
    url: str,
    claims: str,
    policy: str,
    *,
    claims_source: str = "",
    policy_source: str = "",
) -> list[dict]:
    user_prompt = f"""COMPANY: {company}
URL: {url or "not provided"}
CLAIM SOURCE: {claims_source or "pasted text"}
POLICY SOURCE: {policy_source or "pasted text"}

CATALOGUE:
{_framework_reference()}

PUBLIC CLAIMS:
\"\"\"
{claims[:CLAIMS_MAX_CHARS]}
\"\"\"

PRIVACY POLICY:
\"\"\"
{policy[:POLICY_MAX_CHARS]}
\"\"\"

Return the JSON object now.
"""
    return [
        {"role": "system", "content": DIFF_SYSTEM_PROMPT},
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


def is_verbatim(quote: str, source: str) -> bool:
    """True when the quote really appears in the text it claims to come from."""
    needle = _collapse(quote)
    if not needle:
        return False
    haystack = _collapse(source)
    if needle in haystack:
        return True
    # Tolerate the model clipping a long passage to its opening.
    head = needle[:120].strip(" .,;:'\"")
    return bool(head) and head in haystack


def _is_missing(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("missing") or lowered in ("not mentioned", "no mention", "absent")


def _match_framework(value: Any) -> str | None:
    wanted = _collapse(str(value or ""))
    if not wanted:
        return None
    for framework_id, meta in FRAMEWORKS.items():
        if wanted in (framework_id.lower(), _collapse(meta["name"])):
            return framework_id
    for framework_id, meta in FRAMEWORKS.items():
        if framework_id.lower() in wanted or _collapse(meta["name"]) in wanted:
            return framework_id
    for framework_id, meta in FRAMEWORKS.items():
        for alias in meta["aliases"].split(","):
            alias = _collapse(alias)
            if alias and alias in wanted:
                return framework_id
    return None


def map_frameworks(values: Any) -> list[dict[str, str]]:
    """Keep only known framework ids, in catalogue order, with their deadlines."""
    found: list[str] = []
    for value in values if isinstance(values, list) else []:
        framework_id = _match_framework(value)
        if framework_id and framework_id not in found:
            found.append(framework_id)
    return [
        {
            "id": framework_id,
            "name": FRAMEWORKS[framework_id]["name"],
            "deadline": FRAMEWORKS[framework_id]["deadline"],
            "status": FRAMEWORKS[framework_id]["status"],
        }
        for framework_id in FRAMEWORK_IDS
        if framework_id in found
    ]


def _severity(value: Any) -> str:
    raw = _collapse(str(value or ""))
    if raw.startswith("crit") or raw in ("severe", "urgent"):
        return "Critical"
    if raw.startswith("high"):
        return "High"
    return "Medium"


def normalize_diff(
    parsed: dict[str, Any],
    *,
    company: str,
    url: str,
    claims: str,
    policy: str,
    claims_source: str = "",
    policy_source: str = "",
) -> dict[str, Any]:
    """Apply the evidence and framing guardrails to the model's JSON."""
    gaps: list[dict[str, Any]] = []
    raw_gaps = parsed.get("gaps") if isinstance(parsed, dict) else None

    for index, item in enumerate(raw_gaps if isinstance(raw_gaps, list) else []):
        if not isinstance(item, dict):
            continue
        title = _clean(item.get("title"))
        claim = _clean(item.get("claim_quote"))
        if not title or not claim or not is_verbatim(claim, claims):
            continue

        policy_quote = _clean(item.get("policy_quote"))
        if policy_quote and not _is_missing(policy_quote) and not is_verbatim(policy_quote, policy):
            policy_quote = ""
        if not policy_quote or _is_missing(policy_quote):
            policy_quote = MISSING_FROM_POLICY

        frameworks = map_frameworks(item.get("frameworks"))
        if not frameworks:
            frameworks = map_frameworks(["ftc_section5"])

        gaps.append(
            {
                "id": f"gap_{index + 1}",
                "title": title,
                "severity": _severity(item.get("severity")),
                "claim_quote": claim,
                "claim_source": claims_source or url or "public claims",
                "policy_quote": policy_quote,
                "policy_source": policy_source or "privacy policy",
                "frameworks": frameworks,
                "why_it_matters": _clean(item.get("why_it_matters"))
                or (
                    "A buyer's security or procurement reviewer will ask for evidence "
                    "behind this claim before signing."
                ),
                "remediation": _clean(item.get("remediation"))
                or "Align the public claim and the privacy disclosure, then re-run this audit.",
            }
        )

    gaps.sort(key=lambda gap: SEVERITY_ORDER.get(gap["severity"], 3))
    gaps = gaps[:MAX_GAPS]

    summary = _clean(parsed.get("summary")) if isinstance(parsed, dict) else ""
    if not summary:
        if gaps:
            summary = (
                f"{company} makes public AI claims that its privacy policy does not fully "
                f"support. We found {len(gaps)} high-confidence mismatch(es) a buyer would "
                "raise in vendor review."
            )
        else:
            summary = (
                f"No high-confidence mismatch between {company}'s public claims and its "
                "privacy disclosures was found in the supplied text."
            )

    counts = {
        "critical": sum(1 for gap in gaps if gap["severity"] == "Critical"),
        "high": sum(1 for gap in gaps if gap["severity"] == "High"),
        "medium": sum(1 for gap in gaps if gap["severity"] == "Medium"),
    }

    return {
        "company": company,
        "url": url,
        "claimsSource": claims_source or url or "pasted text",
        "policySource": policy_source or "pasted text",
        "summary": summary,
        "gaps": gaps,
        "counts": counts,
        "coverage": {
            "claimsChars": len(claims),
            "policyChars": len(policy),
            "frameworks": framework_catalog(),
        },
        "note": NOTE,
    }


def generate_diff(
    company: str,
    url: str,
    claims: str,
    policy: str,
    *,
    claims_source: str = "",
    policy_source: str = "",
    model: str | None = None,
    budget=None,
) -> dict[str, Any]:
    """Run the diff through the shared Groq budget and normalise the result."""
    messages = build_diff_prompt(
        company, url, claims, policy, claims_source=claims_source, policy_source=policy_source
    )
    budget = budget or shared_budget()
    budget.acquire(
        sum(estimate_tokens(message["content"]) for message in messages)
        + DIFF_MAX_OUTPUT_TOKENS
    )

    kwargs = {"max_output_tokens": DIFF_MAX_OUTPUT_TOKENS}
    if model:
        kwargs["model"] = model
    raw = _chat(messages, **kwargs)
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[diff_engine] unparseable response: {exc}")
        parsed = {}

    return normalize_diff(
        parsed if isinstance(parsed, dict) else {},
        company=company,
        url=url,
        claims=claims,
        policy=policy,
        claims_source=claims_source,
        policy_source=policy_source,
    )
