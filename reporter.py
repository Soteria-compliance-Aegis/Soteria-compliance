"""Markdown reports: the paid full report and a gated teaser.

Statuses are kept in separate blocks so nothing reads as an alarm when it is
not one: open gaps (Fail/Warning), clean passes, and out-of-scope items that
were never graded against the company. The teaser shows at most the two most
severe open findings with their verified evidence and locks the rest behind a
count, so the full report stays the conversion hook.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from rules import NA_STATUS, OPEN_STATUSES

CONTACT_LINE = (
    "For the complete list and full technical remediation report, "
    "contact founder@aegis-compliance.ai"
)
FULL_REPORT_NAME = "full_report.md"
TEASER_REPORT_NAME = "teaser_report.md"
TEASER_MAX_FINDINGS = 2

STATUS_RANK = {"Fail": 0, "Warning": 1, "Pass": 2, NA_STATUS: 3}
SEVERITY_RANK = {"High": 0, "Medium": 1, "Low": 2, "None": 3}
STATUS_ICON = {"Fail": "❌", "Warning": "⚠️", "Pass": "✅", NA_STATUS: "➖"}


def parse_findings(payload: object) -> list[dict]:
    """Accept the auditor's findings list, or raw JSON text/object with a
    ``findings`` key, and return the finding dicts."""
    if isinstance(payload, str):
        payload = json.loads(payload)
    if isinstance(payload, dict):
        payload = payload.get("findings", [])
    if not isinstance(payload, list):
        raise ValueError(f"Expected a findings list, got {type(payload).__name__}")
    return [item for item in payload if isinstance(item, dict)]


def _rank(finding: dict) -> tuple[int, int]:
    return (
        STATUS_RANK.get(finding.get("status", ""), 4),
        SEVERITY_RANK.get(finding.get("severity", ""), 4),
    )


def _quote(text: str) -> str:
    """Render evidence as a Markdown blockquote, preserving it verbatim."""
    lines = (text or "").strip().splitlines()
    if not lines:
        return "> *(nothing in this document addresses this requirement)*"
    return "\n".join(f"> {line}".rstrip() for line in lines)


def _header(title: str, source: str, generated_at: datetime) -> str:
    return (
        f"# {title}\n\n"
        f"**Document:** {source}  \n"
        f"**Generated:** {generated_at.strftime('%Y-%m-%d %H:%M UTC')}  \n"
        "**Scope:** Technical AI risk assessment, not legal advice.\n"
    )


def _summary_table(findings: list[dict]) -> str:
    rows = [
        "| Regulation | Status | Severity |",
        "| --- | --- | --- |",
    ]
    for finding in findings:
        severity = finding.get("severity", "")
        rows.append(
            f"| {finding['regulation']} | {finding['status']} | "
            f"{'—' if severity == 'None' else severity} |"
        )
    return "\n".join(rows)


def _remediation_block(finding: dict) -> str:
    """Render the five-part remediation as an executive Markdown block."""
    plan = finding.get("remediation_plan")
    if not isinstance(plan, dict):
        return ""
    fix = plan.get("exactFix") if isinstance(plan.get("exactFix"), dict) else {}

    blocks: list[str] = []
    for label, key in (
        ("1. Problem", "problem"),
        ("2. Root cause", "rootCause"),
        ("3. Consequences", "consequences"),
    ):
        text = str(plan.get(key) or "").strip()
        if text:
            blocks.append(f"**{label}** — {text}")

    redline = str(fix.get("copyRedline") or "").strip()
    patch = str(fix.get("policyOrControlPatch") or "").strip()
    if redline or patch:
        lines = ["**4. Exact fix**"]
        if redline:
            lines.append(f"- *Copy redline:* {redline}")
        if patch:
            lines.append(f"- *Policy or control patch:* {patch}")
        blocks.append("\n".join(lines))

    prevention = str(plan.get("prevention") or "").strip()
    if prevention:
        blocks.append(f"**5. Prevention** — {prevention}")

    # One stray field is not a breakdown; show it only when the block is real.
    return "\n\n".join(blocks) if len(blocks) >= 3 else ""


def _counts(findings: list[dict]) -> tuple[int, int, int]:
    fails = sum(1 for f in findings if f["status"] == "Fail")
    warnings = sum(1 for f in findings if f["status"] == "Warning")
    out_of_scope = sum(1 for f in findings if f["status"] == NA_STATUS)
    return fails, warnings, out_of_scope


def render_full_report(
    findings: list[dict],
    source: str,
    *,
    generated_at: datetime | None = None,
) -> str:
    """Complete report: open findings, passes and out-of-scope items apart."""
    generated_at = generated_at or datetime.now(timezone.utc)
    ranked = sorted(findings, key=_rank)
    open_items = [f for f in ranked if f["status"] in OPEN_STATUSES]
    passing = [f for f in ranked if f["status"] == "Pass"]
    out_of_scope = [f for f in ranked if f["status"] == NA_STATUS]
    fails, warnings, _ = _counts(findings)

    parts = [
        _header("AI Compliance Gap Analysis — Full Report", source, generated_at),
        "## Summary\n",
        _summary_table(findings),
        f"\n**{fails} violation(s) · {warnings} gap(s) · "
        f"{len(passing)} in scope and passing · {len(out_of_scope)} out of scope.**\n",
    ]

    parts.append("## Open findings\n")
    if not open_items:
        parts.append("No in-scope gaps were detected in the reviewed documents.\n")
    for index, finding in enumerate(open_items, start=1):
        icon = STATUS_ICON.get(finding["status"], "")
        parts.append(
            f"### {index}. {finding['regulation']} — {icon} {finding['status']} "
            f"({finding['severity']} severity)\n"
        )
        if finding["evidence_quote"]:
            parts.append(f"**Evidence**\n\n{_quote(finding['evidence_quote'])}\n")
        else:
            parts.append(
                "**Evidence**\n\n> *(no problematic wording found; this is a "
                "disclosure gap, not a violation)*\n"
            )
        parts.append(f"**Recommended change**\n\n{finding['remediation_note']}\n")
        block = _remediation_block(finding)
        if block:
            parts.append(f"### Executive remediation\n\n{block}\n")

    if passing:
        parts.append("## In scope and passing\n")
        for finding in passing:
            parts.append(
                f"- ✅ **{finding['regulation']}** — requirements met. "
                f"{finding['remediation_note']}\n"
            )

    if out_of_scope:
        parts.append("## Out of scope\n")
        parts.append(
            "These were checked for applicability and not graded. Marking them "
            "out of scope is not a finding against the company.\n"
        )
        for finding in out_of_scope:
            parts.append(
                f"- ➖ **{finding['regulation']}** — {NA_STATUS}. "
                f"{finding['remediation_note']}\n"
            )

    return "\n".join(parts).rstrip() + "\n"


def render_teaser_report(
    findings: list[dict],
    source: str,
    *,
    generated_at: datetime | None = None,
    contact: str = CONTACT_LINE,
) -> str:
    """Teaser: top 1-2 open findings, the rest locked behind a count."""
    generated_at = generated_at or datetime.now(timezone.utc)
    ranked = sorted(findings, key=_rank)
    exposed = [f for f in ranked if f["status"] in OPEN_STATUSES][:TEASER_MAX_FINDINGS]
    fails, warnings, out_of_scope = _counts(findings)
    passing = sum(1 for f in findings if f["status"] == "Pass")
    # Lock only real findings that were not shown: locking a pass or an
    # out-of-scope item would read as withheld bad news.
    hidden = max(0, fails + warnings - len(exposed))

    parts = [
        _header("AI Compliance Gap Analysis — Preview", source, generated_at),
        f"**{fails + warnings} of {len(findings)} regulations** have open gaps.\n",
        "## Top findings\n",
    ]

    if not exposed:
        parts.append("No in-scope gaps were detected in the reviewed documents.\n")
    for index, finding in enumerate(exposed, start=1):
        icon = STATUS_ICON.get(finding["status"], "")
        parts.append(
            f"### {index}. {finding['regulation']} — {icon} {finding['status']} "
            f"({finding['severity']} severity)\n"
        )
        parts.append(f"{_quote(finding['evidence_quote'])}\n")

    also_reviewed = []
    if passing:
        also_reviewed.append(f"- ✅ {passing} in scope and passing")
    if out_of_scope:
        also_reviewed.append(f"- ➖ {out_of_scope} out of scope (not applicable to these documents)")
    if also_reviewed:
        parts.append("## Also reviewed\n")
        parts.append("\n".join(also_reviewed) + "\n")

    if hidden:
        parts.append(f"> 🔒 {hidden} Additional Findings Locked\n")

    parts.append("---\n")
    parts.append(f"{contact}\n")
    return "\n".join(parts).rstrip() + "\n"


def write_reports(
    findings: list[dict],
    source: str,
    *,
    out_dir: str | Path = "output",
    generated_at: datetime | None = None,
) -> tuple[Path, Path]:
    """Write ``full_report.md`` and ``teaser_report.md``; return both paths."""
    findings = parse_findings(findings)
    directory = Path(out_dir)
    directory.mkdir(parents=True, exist_ok=True)
    generated_at = generated_at or datetime.now(timezone.utc)

    full_path = directory / FULL_REPORT_NAME
    teaser_path = directory / TEASER_REPORT_NAME

    full_path.write_text(
        render_full_report(findings, source, generated_at=generated_at), encoding="utf-8"
    )
    teaser_path.write_text(
        render_teaser_report(findings, source, generated_at=generated_at), encoding="utf-8"
    )
    return full_path, teaser_path
