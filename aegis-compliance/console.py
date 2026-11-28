"""Registries behind the dev console.

Adding a tool: append one entry to ``TOOLS`` with a unique id, the next index,
a one-line purpose, a launch href and the table its records live in. The console
renders the list and the server counts that table, so nothing else changes.

The model catalogue is the short list of Groq chat models the bench offers,
with the free-plan ceiling from Groq's rate-limit table. The engine keeps its
own 8,000 TPM budget whichever model is routed, so a model with a lower
ceiling is flagged in the console instead of being hidden.
"""

from __future__ import annotations

import re
from typing import Any

MODEL_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "id": "openai/gpt-oss-120b",
        "label": "GPT-OSS 120B",
        "tier": "production",
        "tpm": 8_000,
        "context": 131_072,
        "note": "Shipped deep default. Grading, remediation copy and red-team verdicts.",
    },
    {
        "id": "openai/gpt-oss-20b",
        "label": "GPT-OSS 20B",
        "tier": "production",
        "tpm": 8_000,
        "context": 131_072,
        "note": "Shipped fast default. Page screening and shorter drafts.",
    },
    {
        "id": "qwen/qwen3.8-27b",
        "label": "Qwen3.8 27B",
        "tier": "preview",
        "tpm": 8_000,
        "context": 131_072,
        "note": "Preview chat model on the same 8,000 TPM free ceiling.",
    },
    {
        "id": "openai/gpt-oss-safeguard-20b",
        "label": "GPT-OSS Safeguard 20B",
        "tier": "preview",
        "tpm": 2_000,
        "context": 131_072,
        "note": "Safety classifier. Free ceiling is 2,000 TPM, under this engine's budget.",
    },
)

TOOLS: tuple[dict[str, str], ...] = (
    {
        "id": "policy_audit",
        "index": "01",
        "title": "Policy audit",
        "purpose": "Upload a PDF, DOCX or TXT and grade it against seven rubrics.",
        "href": "/#upload",
        "action": "Upload",
        "table": "documents",
    },
    {
        "id": "brief",
        "index": "02",
        "title": "Mini-audit brief",
        "purpose": "Compare homepage copy with the privacy policy on one page.",
        "href": "/#brief",
        "action": "Open form",
        "table": "briefs",
    },
    {
        "id": "footprint",
        "index": "03",
        "title": "Footprint audit",
        "purpose": "Fetch public pages and diff each claim against the policy.",
        "href": "/audit",
        "action": "Run",
        "table": "diffs",
    },
    {
        "id": "redteam",
        "index": "04",
        "title": "Red-team lab",
        "purpose": "Eight bounded probes, live endpoint or written spec.",
        "href": "/redteam",
        "action": "Run",
        "table": "redteam_runs",
    },
    {
        "id": "artifacts",
        "index": "05",
        "title": "Fix artifacts",
        "purpose": "Draft the notice, vendor checklist and buyer FAQ from evidence.",
        "href": "/artifacts",
        "action": "Draft",
        "table": "artifacts",
    },
)

TABLE_NAMES = frozenset(tool["table"] for tool in TOOLS)

# Groq ids are namespaced (openai/gpt-oss-120b) or bare (llama-3.3-70b-versatile).
_MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$")


def model_catalog() -> list[dict[str, Any]]:
    """A copy of the catalogue, so a caller cannot mutate the registry."""
    return [dict(entry) for entry in MODEL_CATALOG]


def validate_model_id(value: Any) -> str:
    """Return a trimmed Groq model id or raise ``ValueError``."""
    model = str(value or "").strip()
    if not _MODEL_ID.fullmatch(model):
        raise ValueError(
            "Use a Groq model id such as openai/gpt-oss-120b: letters, digits, "
            "dot, slash, dash or underscore."
        )
    return model
