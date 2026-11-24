"""Regulatory rubrics, applicability scope, and the combined audit prompt.

Every rubric in ``REGULATIONS`` is graded in one Groq call so the document text
is sent once, which is what keeps the free-tier 8,000 TPM budget workable.

Each rubric carries a SCOPE block. The auditor must decide applicability before
grading, because a consumer privacy notice is not evidence about hiring bias
audits — grading that mismatch as a 'Fail' is exactly the false positive this
prototype has to avoid.
"""

from __future__ import annotations

from typing import Literal

Status = Literal["Pass", "Warning", "Fail", "N/A (Out of Scope)"]
Severity = Literal["High", "Medium", "Low", "None"]

# Single source of truth for the out-of-scope status, imported by reporter too.
NA_STATUS: Status = "N/A (Out of Scope)"
OPEN_STATUSES: tuple[str, ...] = ("Fail", "Warning")

SYSTEM_PROMPT = """You are a technical AI compliance auditor reviewing a startup's
public documents. You are not a lawyer and you do not give legal advice.

The document you receive is one or more web pages, each tagged
"=== SOURCE: <page type> — <url> ===". Attribute every judgement to the page
type it came from: hiring/AEDT evidence lives in a careers or hiring page, AI
testing and security evidence in an AI, security or trust page, and automated
decision-making notices in the privacy policy or AI page.

APPLICABILITY PRE-CHECK — do this before grading anything:
For each regulation decide whether it plausibly applies to this company on the
evidence in these documents. If the scope conditions are not met, grade
"N/A (Out of Scope)". Do not manufacture a violation from a document that is
not about that activity, and do not Fail a regulation because a disclosure is
missing from a page type that could never contain it.

Status values:
- Pass: the required disclosure/practice is clearly present.
- Warning: in scope, but the disclosure is partial, vague, or absent while the
  document contains no problematic text of its own.
- Fail: in scope AND the document contains text that is itself the problem —
  an unsupported or absolute claim, a practice that contradicts the law, a
  prohibited use, or a use disclosed without the required notice. Never use
  Fail for a simple absence of language.
- N/A (Out of Scope): the regulation does not apply to this company or to the
  activities these documents describe.

Severity values (impact if left unfixed), "None" for out of scope:
- High: an outright prohibited practice or unsubstantiated claim creating
  direct legal exposure (e.g. "100% unbiased", "HIPAA compliant").
- Medium: an incomplete or vague disclosure a regulator would likely question.
- Low: a minor gap or wording risk.

Evidence rules:
- evidence_quote must be copied character-for-character from the document.
- For Fail, the quote MUST be the problematic text itself. If you cannot point
  at such a sentence, the finding is a Warning, not a Fail.
- Never quote the nearest unrelated sentence, and never quote a page's general
  scope statement as if it were the violation.
- For Warning, quote only a sentence that shows the ambiguity; if the document
  says nothing on the topic, return "".
- For N/A (Out of Scope) and Pass, return "" (or the enabling sentence for a
  Pass). Never invent text.
- remediation_note must be one concrete, actionable change; for N/A say what
  would bring the company into scope.

Return ONLY a JSON object shaped exactly like this, with exactly one item in
"findings" for every regulation id listed in the user message and no other
keys:
{
  "findings": [
    {
      "regulation": "ccpa_admt",
      "status": "Pass" | "Warning" | "Fail" | "N/A (Out of Scope)",
      "severity": "High" | "Medium" | "Low" | "None",
      "evidence_quote": "verbatim text from the document, or \\"\\"",
      "remediation_note": "one concrete change"
    }
  ]
}
"""

REGULATIONS: dict[str, dict] = {
    "ccpa_admt": {
        "name": "California ADMT / CCPA",
        "aliases": ("ccpa", "admt", "california admt", "cpra"),
        "focus": (
            "Automated decision-making technology (ADMT) used for significant "
            "decisions must have pre-use notice, opt-out rights, and access to "
            "human review."
        ),
        "scope": {
            "applies_when": (
                "The documents show ADMT used for a significant decision about "
                "people: credit, housing, education, employment, healthcare, or "
                "access to essential goods and services."
            ),
            "not_applicable_when": (
                "The product only does analytics, generation, search, or "
                "recommendation for the user's own content, with no automated "
                "eligibility, scoring, ranking or approval of a person."
            ),
            "evidence_pages": "privacy policy, AI disclosure",
        },
        "checks": [
            "Pre-use notice describing the ADMT, its purpose, and the categories of personal information used.",
            "A clear opt-out mechanism (or explanation of an applicable exception).",
            "A right to human review of automated decisions, with how to request it.",
        ],
    },
    "colorado_sb26_189": {
        "name": "Colorado SB 26-189 (ADMT)",
        "aliases": (
            "colorado sb 26-189",
            "colorado sb26-189",
            "sb 26-189",
            "sb26189",
            "colorado ai act",
            "colorado admt",
            "co sb 26-189",
        ),
        "focus": (
            "Developers and deployers of automated decision-making technology "
            "(ADMT) for consequential decisions must give clear notice of the "
            "ADMT's role, explain adverse outcomes in plain language, offer human "
            "review, and hand deployers the documentation they need. Enacted May "
            "14, 2026, replacing SB 24-205; consequential decisions made on or "
            "after January 1, 2027 are covered."
        ),
        "scope": {
            "applies_when": (
                "The documents show ADMT used, built or sold for a consequential "
                "decision about a person: employment, credit or financial "
                "services, housing, insurance, healthcare, education, or access to "
                "essential goods and services."
            ),
            "not_applicable_when": (
                "The product only does analytics, generation, search, or "
                "recommendation for the user's own content, with no automated "
                "eligibility, scoring, ranking or approval of a person, or the "
                "documents show no consequential-decision use at all."
            ),
            "evidence_pages": "privacy policy, AI disclosure, product terms",
        },
        "note": (
            "SB 26-189 repealed and replaced SB 24-205: never cite SB 24-205 "
            "impact-assessment duties as active requirements. Never assume an "
            "employer's headcount or any statutory threshold — the small-deployer "
            "(40 or fewer employees) carve-out is context only, not an "
            "assumption. Obligations beginning January 1, 2027 are upcoming "
            "readiness gaps against the rule text, not present violations."
        ),
        "checks": [
            "Clear notice of the ADMT's role in a consequential decision, given before or at the point of interaction, naming the decision and the categories of data used.",
            "A plain-language adverse-outcome explanation path (within 30 days) describing the role the ADMT played and how to request additional information.",
            "An available human review or override workflow, with instructions on how a consumer exercises it.",
            "Developer-to-deployer documentation for B2B AI vendors: intended use, known limitations, and evaluation and human-review guidance.",
        ],
    },
    "texas_traiga": {
        "name": "Texas TRAIGA",
        "aliases": ("traiga", "texas traiga act", "texas responsible ai"),
        "focus": (
            "Developers and deployers of AI systems must show reasonable care "
            "through bias and security testing aligned with recognized "
            "frameworks such as the NIST AI Risk Management Framework."
        ),
        "scope": {
            "applies_when": (
                "The company develops or deploys an AI system that interacts "
                "with consumers or makes decisions affecting them."
            ),
            "not_applicable_when": (
                "No AI system is described anywhere in the documents — for "
                "example a services or agency site that only mentions using "
                "third-party tools internally."
            ),
            "evidence_pages": "AI disclosure, security/trust page",
        },
        "checks": [
            "Disclosure of bias testing, red-teaming, or evaluation practices.",
            "Reference to a recognized risk framework (e.g. NIST AI RMF) or equivalent controls.",
            "Security safeguards / incident handling for the AI system.",
        ],
    },
    "nyc_ll144": {
        "name": "NYC Local Law 144",
        "aliases": ("ll144", "ll 144", "local law 144", "aedt", "bias audit"),
        "focus": (
            "Employers and employment agencies using automated employment "
            "decision tools (AEDTs) must publish an annual bias audit summary."
        ),
        "scope": {
            "applies_when": (
                "The documents show the company is an employer or employment "
                "agency using an AEDT for hiring, promotion, or candidate "
                "screening — including selling such a tool to employers."
            ),
            "not_applicable_when": (
                "There is no hiring or candidate-screening context at all, or "
                "the company's AI does not rank, score or screen applicants. A "
                "consumer privacy notice is not evidence of AEDT use."
            ),
            "evidence_pages": "careers/hiring page, AI disclosure",
        },
        "checks": [
            "Public summary of an annual independent bias audit for the AEDT.",
            "Impact ratios / selection rates by race, ethnicity, and sex category.",
            "Audit date, data window, and the tool(s) covered.",
        ],
    },
    "illinois_hb3773": {
        "name": "Illinois HB 3773 (AI in Employment)",
        "aliases": (
            "illinois hb 3773",
            "illinois hb3773",
            "hb 3773",
            "public act 103-0804",
            "illinois human rights act",
            "illinois ai employment",
        ),
        "focus": (
            "Employers using AI in employment decisions must notify employees "
            "and applicants, must not use ZIP codes or other geographic proxies "
            "for protected classes, and must be able to show the screening does "
            "not produce a discriminatory effect. In force since January 1, 2026 "
            "under the Illinois Human Rights Act."
        ),
        "scope": {
            "applies_when": (
                "The documents show AI used for recruitment, hiring, promotion, "
                "renewal, selection for training or apprenticeship, tenure, "
                "discharge, discipline, or terms and privileges of employment — "
                "including a vendor selling such a tool to employers."
            ),
            "not_applicable_when": (
                "There is no employment or candidate-screening context, or the "
                "company's AI does not screen, score, rank or otherwise inform an "
                "employment decision. A consumer privacy notice alone is not "
                "evidence of employment AI use."
            ),
            "evidence_pages": "careers/hiring page, privacy policy, AI disclosure",
        },
        "note": (
            "The statute tests discriminatory effect; it does not require an NYC "
            "LL144-style annual public bias audit, so never demand one as if it "
            "were mandatory. The IDHR withdrew its draft implementing rules in "
            "June 2026: check statutory notice and proxy/fairness alignment and "
            "do not treat withdrawn draft rules as binding regulations."
        ),
        "checks": [
            "Notice to employees and applicants that AI is used in recruitment, hiring, promotion, renewal, training or apprenticeship selection, tenure, discharge, discipline, or terms and privileges of employment.",
            "No use of ZIP codes or other geographic proxies for protected classes in AI scoring or screening, with a stated practice rather than silence.",
            "Discriminatory-effect / fairness governance readiness: testing, review, or vendor assurances that the tool does not disadvantage protected classes (a formal public bias audit is not required).",
        ],
    },
    "ftc_section5": {
        "name": "FTC Section 5 (AI-Washing)",
        "aliases": ("ftc", "section 5", "ai-washing", "ai washing"),
        "focus": (
            "AI capability, safety, and compliance claims must be substantiated, "
            "and training on customer data via third-party LLM APIs must be "
            "disclosed."
        ),
        "scope": {
            "applies_when": (
                "The documents make an AI capability, safety, accuracy, or "
                "compliance claim, or describe a product that uses AI."
            ),
            "not_applicable_when": (
                "No AI capability, safety, accuracy, or compliance claim appears "
                "anywhere in these documents, so there is no claim to substantiate."
            ),
            "evidence_pages": "any page",
        },
        "checks": [
            "Absolute claims such as '100% unbiased' or 'HIPAA compliant' backed by evidence.",
            "Disclosure that customer data may be sent to third-party LLM providers for training or inference.",
            "No misleading framing of accuracy, autonomy, or human oversight.",
        ],
    },
    "india_dpdp": {
        "name": "India DPDP Act",
        "aliases": ("dpdp", "dpdp act", "india dpdp", "digital personal data protection"),
        "focus": (
            "Processing the digital personal data of Data Principals in India "
            "requires an itemised, plain-language notice with the exact purpose "
            "of processing, a free and specific consent, a published grievance "
            "contact, and limits on how long data is kept."
        ),
        "scope": {
            "applies_when": (
                "The company targets or serves users in India: an Indian entity "
                "or office, India-specific pricing, support, or an Indian user "
                "base, or a notice that names Indian law, Data Principals, or "
                "DPDP."
            ),
            "not_applicable_when": (
                "Nothing in the documents points to Indian users or operations "
                "— no Indian entity, no India-specific offering, and no mention "
                "of Indian data subjects, DPDP, or an Indian grievance officer. "
                "Serving users worldwide from the US alone is not enough."
            ),
            "evidence_pages": "privacy policy, terms of service",
        },
        "note": (
            "Under DPDP a notice that is present but bundled, buried, or silent "
            "on purpose is itself the problem: quote the collecting sentence or "
            "the vague purpose wording and grade Fail. When the notice or the "
            "grievance contact is simply absent, grade Warning."
        ),
        "checks": [
            "Clear, plain-language notice of what data is collected and the exact purpose, given before or at collection (no bundled or obscure consent).",
            "Published grievance-redressal mechanism: a named contact, email, or Data Protection Officer / Grievance Officer details.",
            "Data minimisation and retention limits, including how and when a Data Principal can request erasure.",
        ],
    },
}

REGULATION_IDS: tuple[str, ...] = tuple(REGULATIONS)


def get_regulation(regulation_id: str) -> dict:
    """Look up a rubric by id, raising a helpful error for typos."""
    try:
        return REGULATIONS[regulation_id]
    except KeyError:
        valid = ", ".join(REGULATION_IDS)
        raise KeyError(f"Unknown regulation {regulation_id!r}. Choose one of: {valid}") from None


def _rubric_block() -> str:
    blocks = []
    for regulation_id, meta in REGULATIONS.items():
        checks = "\n".join(f"  - {item}" for item in meta["checks"])
        scope = meta["scope"]
        note = f"GRADING NOTE: {meta['note']}\n" if meta.get("note") else ""
        blocks.append(
            f"[{regulation_id}] {meta['name']}\n"
            f"FOCUS: {meta['focus']}\n"
            f"SCOPE — applies when: {scope['applies_when']}\n"
            f"SCOPE — out of scope when: {scope['not_applicable_when']}\n"
            f"SCOPE — evidence pages: {scope['evidence_pages']}\n"
            f"{note}"
            f"REQUIRED ELEMENTS:\n{checks}"
        )
    return "\n\n".join(blocks)


def build_prompt(document_text: str, source: str = "document") -> list[dict]:
    """Build one chat prompt covering every regulation for one document set."""
    user_prompt = f"""SOURCE: {source}

The document below may contain several tagged pages. Run the applicability
pre-check for each regulation, then grade it. Return exactly one finding for
each of: {", ".join(REGULATION_IDS)}.

REGULATIONS:

{_rubric_block()}

DOCUMENT:
\"\"\"
{document_text}
\"\"\"
"""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
