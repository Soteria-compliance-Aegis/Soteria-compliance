"""Operational draft generator: turn findings into fix-ready documents.

Three artefacts, all deliberately operational rather than legal:

- ``disclosure_notice``: a pre-use / ADMT and bot disclosure notice matched to
  the product's described workflow;
- ``vendor_checklist``: questions and checks for third-party model and API
  vendors (retention, training opt-out, DPAs, subprocessors, security);
- ``buyer_faq``: draft answers to the governance questions enterprise buyers
  ask in security review.

Every draft is labelled an operational template that needs counsel review, and
is required to carry bracketed placeholders rather than inventing facts about
the company. Nothing here is legal advice, and the prompt forbids presenting it
as such.
"""

from __future__ import annotations

import json
import re
from typing import Any

from auditor import _chat, _extract_json, estimate_tokens, shared_budget

ARTIFACT_MAX_OUTPUT_TOKENS = 1_900
EVIDENCE_MAX_CHARS = 5_000

SUFFIX = "(Operational Template — Review with Legal Counsel)"

NOTE = (
    "Operational draft for internal review only. It is not legal advice, has not been "
    "reviewed by counsel, and must be adapted to the company's actual data flows."
)

KINDS: dict[str, dict[str, Any]] = {
    "disclosure_notice": {
        "title": "Draft Pre-Use & AI Disclosure Notice",
        "purpose": (
            "A notice the product can show before an AI-assisted flow, covering AI identity, "
            "purpose, data touched, human review and contact route."
        ),
        "sections": (
            "What this system is and that it is AI; when and where it is used; the purpose of the "
            "automated processing; categories of data it reads; whether it makes or supports a "
            "decision about a person; the human review and appeal route; opt-out or contact route; "
            "retention summary; effective date and review cadence"
        ),
    },
    "vendor_checklist": {
        "title": "Vendor & Model-Training Verification Checklist",
        "purpose": (
            "The questions to send every LLM/API vendor before signing, so training, retention, "
            "security and subprocessor answers are on record."
        ),
        "sections": (
            "data sent to the vendor and where it is processed; retention windows and deletion; "
            "training use and opt-out status per API tier; DPA and subprocessor list; model-change "
            "and deprecation notice; security attestations and incident notification; evaluation, "
            "red-team and bias-testing evidence; data residency and encryption"
        ),
    },
    "buyer_faq": {
        "title": "Enterprise Buyer AI Governance FAQ",
        "purpose": (
            "Draft answers to the data-isolation, human-oversight and testing questions that come up "
            "in B2B security review."
        ),
        "sections": (
            "what data leaves the customer environment; whether customer data trains models; "
            "tenant isolation and access control; human oversight and escalation; how the system is "
            "tested (red-team cadence, bias testing); incident response and notification; AI "
            "disclosures in the product; evidence buyers can request"
        ),
    },
}

KIND_IDS: tuple[str, ...] = tuple(KINDS)

ARTIFACT_SYSTEM_PROMPT = """You write operational compliance drafts for a US B2B
software company. You are not a lawyer, you do not give legal advice, and you must
never present a draft as legal advice or as a guarantee of compliance.

You receive the artifact type, the company, the product, and evidence gathered from
prior audits (public-claim vs privacy-policy gaps, red-team probe failures, policy
audit findings) plus optional notes.

HARD RULES:
1. Write a practical, copy-ready Markdown draft for the requested artifact type.
2. Cover every required section for that type, in a sensible order.
3. Never invent facts about the company. Where a fact is unknown (names, emails,
   retention periods, vendor names, dates, certifications), use a clearly bracketed
   placeholder such as [COMPANY LEGAL NAME], [RETENTION PERIOD], [SECURITY CONTACT].
4. Tie the draft to the supplied evidence: if a probe failed or a gap was found,
   the draft must close that specific hole.
5. Plain business English. No statutory recitals, no legal conclusions, no claims
   that the company "is compliant".
6. Keep the parts of the draft that address automated decisions factual: describe
   human review and opt-out routes as things to operate, not legal conclusions.
7. California CCPA/ADMT and Colorado SB 26-189 are January 1, 2027 deadlines: refer
   to them as upcoming dates for readiness, never as current violations.

Return ONLY this JSON object:
{
  "title": "the artifact title",
  "markdown": "the complete draft in Markdown, starting with a level-2 heading",
  "placeholders": ["[COMPANY LEGAL NAME]", "[RETENTION PERIOD]"]
}
"""


def _kind(kind: str) -> dict[str, Any]:
    try:
        return KINDS[kind]
    except KeyError:
        raise KeyError(f"Unknown artifact kind {kind!r}. Choose one of: {', '.join(KIND_IDS)}") from None


def build_artifact_prompt(
    kind: str,
    company: str,
    product: str,
    *,
    evidence: str = "",
    notes: str = "",
) -> list[dict]:
    meta = _kind(kind)
    user_prompt = f"""ARTIFACT TYPE: {kind} — {meta['title']}
PURPOSE: {meta['purpose']}
REQUIRED SECTIONS: {meta['sections']}

COMPANY: {company}
PRODUCT / WORKFLOW: {product or "not described; use bracketed placeholders"}

EVIDENCE FROM PRIOR AUDITS:
\"\"\"
{evidence[:EVIDENCE_MAX_CHARS] or "No prior audit evidence was supplied. Write a general but product-specific draft and mark unknowns with placeholders."}
\"\"\"

ADDITIONAL NOTES FROM THE TEAM:
\"\"\"
{notes[:1_500] or "none"}
\"\"\"

Write the draft now and return the JSON object.
"""
    return [
        {"role": "system", "content": ARTIFACT_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


_PLACEHOLDER_RE = re.compile(r"\[[A-Z0-9][A-Z0-9 &/._:'’-]{2,60}\]")
_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


def extract_placeholders(markdown: str) -> list[str]:
    seen: list[str] = []
    for match in _PLACEHOLDER_RE.findall(markdown):
        if match not in seen:
            seen.append(match)
    return seen[:40]


def normalize_artifact(parsed: dict[str, Any], *, kind: str, company: str) -> dict[str, Any]:
    """Enforce the operational-draft framing and strip code fences."""
    meta = _kind(kind)
    markdown = ""
    if isinstance(parsed, dict):
        markdown = str(parsed.get("markdown") or parsed.get("body") or "").strip()
    markdown = _FENCE_RE.sub("", markdown).strip()
    if len(markdown) < 200:
        raise ValueError(
            "The model did not return a usable draft. Try again, or add a sentence of product context."
        )

    title = str(parsed.get("title") or "").strip() if isinstance(parsed, dict) else ""
    if not title:
        title = f"{meta['title']} — {company}"
    if "Review with Legal Counsel" not in title:
        title = f"{title.rstrip()} {SUFFIX}"
    title = title[:200]

    if "not legal advice" not in markdown.casefold():
        markdown = (
            f"{markdown}\n\n---\n\n**Status:** {NOTE}\n"
        )

    placeholders = extract_placeholders(markdown)
    if not placeholders:
        placeholders = ["[COMPANY LEGAL NAME]"]

    return {
        "kind": kind,
        "kindTitle": meta["title"],
        "title": title,
        "markdown": markdown,
        "placeholders": placeholders,
        "note": NOTE,
    }


def generate_artifact(
    kind: str,
    company: str,
    product: str = "",
    *,
    evidence: str = "",
    notes: str = "",
    model: str | None = None,
    budget=None,
) -> dict[str, Any]:
    """Generate one operational draft through the shared Groq budget."""
    messages = build_artifact_prompt(kind, company, product, evidence=evidence, notes=notes)
    budget = budget or shared_budget()
    budget.acquire(
        sum(estimate_tokens(message["content"]) for message in messages)
        + ARTIFACT_MAX_OUTPUT_TOKENS
    )

    kwargs = {"max_output_tokens": ARTIFACT_MAX_OUTPUT_TOKENS}
    if model:
        kwargs["model"] = model
    raw = _chat(messages, **kwargs)
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"[artifacts] unparseable response: {exc}")
        parsed = {}

    return normalize_artifact(parsed if isinstance(parsed, dict) else {}, kind=kind, company=company)


def evidence_from_findings(
    *,
    diff: dict[str, Any] | None = None,
    redteam: dict[str, Any] | None = None,
    brief: dict[str, Any] | None = None,
) -> str:
    """Flatten stored audit payloads into the compact evidence block for a draft."""
    lines: list[str] = []

    if diff:
        lines.append(f"PUBLIC CLAIM vs POLICY DIFF — {diff.get('company', '')}")
        lines.append(str(diff.get("summary") or ""))
        for gap in diff.get("gaps", [])[:6]:
            frameworks = ", ".join(item.get("name", "") for item in gap.get("frameworks", []))
            lines.append(
                f"- [{gap.get('severity')}] {gap.get('title')}: claim \"{gap.get('claim_quote')}\" / "
                f"policy \"{gap.get('policy_quote')}\" (frameworks: {frameworks or 'n/a'})"
            )

    if redteam:
        lines.append(f"RED-TEAM RUN ({redteam.get('mode', '')}) — {redteam.get('company', '')}")
        for result in redteam.get("results", []):
            if result.get("status") == "Pass":
                continue
            lines.append(
                f"- [{result.get('status')}] {result.get('probeId')} ({result.get('category')}): "
                f"risk: {result.get('risk')} | fix: {result.get('fix')}"
            )

    if brief:
        lines.append(f"PUBLIC FOOTPRINT MINI-AUDIT — {brief.get('company', '')}")
        lines.append(str(brief.get("snapshot") or ""))
        for gap in brief.get("gaps", [])[:3]:
            lines.append(
                f"- {gap.get('title')}: claim \"{gap.get('homepage_claim')}\" / "
                f"policy \"{gap.get('privacy_policy_quote')}\""
            )

    return "\n".join(line for line in lines if line).strip()
