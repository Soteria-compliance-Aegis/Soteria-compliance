"""Offline checks that need no Groq key: cleaning, prompts, findings, reports."""

from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import tempfile
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import auditor  # noqa: E402
import reporter  # noqa: E402
import scraper  # noqa: E402
from auditor import TokenBudget, audit_document, estimate_tokens, normalize_findings  # noqa: E402
from rules import NA_STATUS, REGULATIONS, REGULATION_IDS, build_prompt  # noqa: E402
from scraper import clean_html, scrape, truncate  # noqa: E402

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)

FINDINGS = [
    {
        "regulation": "California ADMT / CCPA",
        "regulation_id": "ccpa_admt",
        "status": "Fail",
        "severity": "High",
        "evidence_quote": "We use automated scoring to rank candidates.",
        "remediation_note": "Add a pre-use ADMT notice and an opt-out route.",
    },
    {
        "regulation": "Texas TRAIGA",
        "regulation_id": "texas_traiga",
        "status": "Warning",
        "severity": "Medium",
        "evidence_quote": "Our models are tested regularly.",
        "remediation_note": "Name the testing framework and publish results.",
    },
    {
        "regulation": "NYC Local Law 144",
        "regulation_id": "nyc_ll144",
        "status": "Pass",
        "severity": "Low",
        "evidence_quote": "2025 bias audit summary available.",
        "remediation_note": "Keep the audit summary current annually.",
    },
    {
        "regulation": "FTC Section 5 (AI-Washing)",
        "regulation_id": "ftc_section5",
        "status": "Fail",
        "severity": "High",
        "evidence_quote": "100% unbiased, fully HIPAA compliant.",
        "remediation_note": "Remove the absolute claims or substantiate them.",
    },
]


class _Response:
    def __init__(self, text="<p>policy</p>", status=200, content_type="text/html; charset=utf-8"):
        self.text = text
        self.status_code = status
        self.headers = {"Content-Type": content_type}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise scraper.requests.HTTPError(f"{self.status_code}")


class _FakeCompletions:
    def __init__(self, content):
        self.content = content
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        choice = type("Choice", (), {})()
        choice.message = type("Message", (), {"content": self.content})()
        choice.finish_reason = "stop"
        return type("Response", (), {"choices": [choice]})()


class _FakeClient:
    def __init__(self, content):
        self.completions = _FakeCompletions(content)
        self.chat = type("Chat", (), {"completions": self.completions})()


def _patch_client(monkeypatch, content):
    fake = _FakeClient(content)
    monkeypatch.setattr(auditor, "_client", lambda: fake)
    return fake


class _MonkeyPatch:
    """Minimal stand-in for pytest's monkeypatch (tests run as a plain script)."""

    def __init__(self):
        self._undo = []

    def setattr(self, target, name, value):
        self._undo.append((target, name, getattr(target, name)))
        setattr(target, name, value)

    def undo(self):
        for target, name, value in reversed(self._undo):
            setattr(target, name, value)
        self._undo.clear()


def test_clean_html_strips_boilerplate():
    html = """
    <html><head><style>.x{color:red}</style></head>
    <body>
      <nav>Home Pricing</nav>
      <script>alert(1)</script>
      <main><h1>Privacy Policy</h1><p>We collect usage data.</p></main>
      <footer>(c) 2026 Acme</footer>
    </body></html>
    """
    text = clean_html(html)
    assert "Privacy Policy" in text
    assert "We collect usage data." in text
    for noise in ("Home Pricing", "alert(1)", "color:red", "(c) 2026"):
        assert noise not in text


def test_truncate_stays_under_limit_on_word_boundary():
    text = truncate("word " * 6_000)  # 30,000 chars
    assert len(text) <= scraper.DEFAULT_MAX_CHARS
    assert not text.endswith("wor")
    assert text.endswith("word")


def test_scrape_probes_every_page_group_on_root_domain(monkeypatch):
    pages = {
        "https://acme.com/privacy": "Privacy policy body. " * 30,
        "https://acme.com/security": "Security page body. " * 30,
        "https://acme.com/ai": "AI disclosure body. " * 30,
    }

    monkeypatch.setattr(scraper, "_try_fetch", lambda url, **kw: pages.get(url))
    monkeypatch.setattr(scraper, "fetch_page", lambda url, **kw: "should not be used")

    page = scrape("acme.com")
    assert [section.kind for section in page.sections] == ["privacy", "security", "ai"]
    assert len(page.sections) <= scraper.MAX_SECTIONS == 3
    # Each page is tagged so the auditor knows where a sentence came from.
    assert "=== SOURCE: privacy policy / privacy notice — https://acme.com/privacy ===" in page.text
    assert "=== SOURCE: security / trust page — https://acme.com/security ===" in page.text
    assert "=== SOURCE: AI disclosure / product terms page — https://acme.com/ai ===" in page.text
    assert page.label() == "privacy policy / privacy notice + security / trust page + AI disclosure / product terms page"
    assert len(page.text) <= scraper.DEFAULT_MAX_CHARS


def test_scrape_keeps_one_page_per_group(monkeypatch):
    seen = []

    def fake_try_fetch(url, **kwargs):
        seen.append(url)
        return f"{url} substantive policy text. " * 20

    monkeypatch.setattr(scraper, "_try_fetch", fake_try_fetch)
    monkeypatch.setattr(scraper, "fetch_page", lambda url, **kw: "unused")
    page = scrape("acme.com")

    assert [section.kind for section in page.sections] == ["privacy", "security", "ai"]
    # The /privacy-policy fallback was never needed once /privacy answered.
    assert "https://acme.com/privacy-policy" not in seen


def test_scrape_falls_back_to_given_path(monkeypatch):
    seen = []
    monkeypatch.setattr(scraper, "_try_fetch", lambda url, **kw: seen.append(url))
    monkeypatch.setattr(scraper, "fetch_page", lambda url, **kw: "Security page text " * 20)

    page = scrape("https://acme.com/security")
    assert page.url == "https://acme.com/security"
    assert seen == []  # explicit paths are fetched as given
    assert page.sections[0].kind == "security"
    assert "=== SOURCE: security / trust page" in page.text


def test_scrape_skips_thin_privacy_stub(monkeypatch):
    monkeypatch.setattr(scraper, "_try_fetch", lambda url, **kw: "Not found")
    monkeypatch.setattr(scraper, "fetch_page", lambda url, **kw: "Home page marketing copy")

    page = scrape("https://acme.com/")
    assert page.url == "https://acme.com/"


def test_prompt_covers_every_rubric_and_sends_document_once():
    messages = build_prompt("UNIQUE_POLICY_SENTENCE", source="https://acme.com")
    assert len(messages) == 2
    joined = "\n".join(message["content"] for message in messages)
    for regulation_id in REGULATION_IDS:
        assert regulation_id in joined
        assert REGULATIONS[regulation_id]["name"] in joined
    assert joined.count("UNIQUE_POLICY_SENTENCE") == 1
    assert '"findings"' in joined
    for key in ("severity", "evidence_quote", "remediation_note"):
        assert key in joined
    # Every rubric states its applicability boundary, and N/A is a real status.
    assert joined.count("SCOPE — out of scope when:") == len(REGULATION_IDS)
    assert NA_STATUS in joined
    assert "Never use\n  Fail for a simple absence of language." in joined


def test_normalize_findings_returns_one_per_regulation_in_order():
    findings = normalize_findings([{"regulation": "ccpa_admt", "status": "FAIL", "severity": "high"}])
    assert [f["regulation_id"] for f in findings] == list(REGULATION_IDS)
    assert findings[0]["status"] == "Fail"
    assert findings[0]["severity"] == "High"
    assert findings[1]["status"] == "Warning"
    assert findings[1]["severity"] == "Medium"
    assert "no finding" in findings[1]["remediation_note"].lower()


def test_normalize_findings_matches_names_and_ignores_junk():
    findings = normalize_findings(
        [
            "not a finding",
            {"regulation": "NYC Local Law 144", "status": "Pass", "severity": "Low"},
            {"regulation": "made up", "status": "Fail"},
        ]
    )
    assert len(findings) == len(REGULATION_IDS)
    nyc = findings[list(REGULATION_IDS).index("nyc_ll144")]
    assert nyc["status"] == "Pass"


def test_audit_document_makes_exactly_one_call():
    monkeypatch = _MonkeyPatch()
    payload = (
        '{"findings": ['
        '{"regulation": "ccpa_admt", "status": "Fail", "severity": "High", '
        '"evidence_quote": "quoted", "remediation_note": "fix it"},'
        '{"regulation": "texas_traiga", "status": "Pass", "severity": "Low", '
        '"evidence_quote": "", "remediation_note": "none"},'
        '{"regulation": "nyc_ll144", "status": "Warning", "severity": "Medium", '
        '"evidence_quote": "q", "remediation_note": "n"},'
        '{"regulation": "ftc_section5", "status": "Pass", "severity": "Low", '
        '"evidence_quote": "", "remediation_note": "n"}]}'
    )
    try:
        fake = _patch_client(monkeypatch, payload)
        findings = audit_document(
            "Some policy text that is quoted here.", source="https://acme.com", budget=TokenBudget()
        )
    finally:
        monkeypatch.undo()

    assert len(fake.completions.calls) == 1
    sent = fake.completions.calls[0]
    assert sent["response_format"] == {"type": "json_object"}
    assert sent["max_completion_tokens"] > 500
    assert "max_tokens" not in sent
    assert len(findings) == len(REGULATION_IDS)
    assert findings[0]["status"] == "Fail"


def test_audit_document_falls_back_when_output_is_junk():
    monkeypatch = _MonkeyPatch()
    try:
        _patch_client(monkeypatch, "no json here")
        findings = audit_document("Some policy text.", budget=TokenBudget())
    finally:
        monkeypatch.undo()
    assert len(findings) == len(REGULATION_IDS)
    assert all(finding["status"] == "Warning" for finding in findings)


def test_teaser_exposes_top_findings_and_locks_the_rest():
    teaser = reporter.render_teaser_report(FINDINGS, "https://acme.com", generated_at=NOW)
    assert "100% unbiased" in teaser  # a High Fail quote is shown
    assert len([line for line in teaser.splitlines() if line.startswith("### ")]) == 2
    # Three open findings, two shown: only the unseen one is locked.
    assert "🔒 1 Additional Findings Locked" in teaser
    assert "Texas TRAIGA" not in teaser  # the third-ranked finding stays hidden
    assert teaser.rstrip().splitlines()[-1] == reporter.CONTACT_LINE


def test_teaser_locks_everything_when_only_passes() -> None:
    passing = [dict(finding, status="Pass", severity="Low") for finding in FINDINGS]
    teaser = reporter.render_teaser_report(passing, "https://acme.com", generated_at=NOW)
    assert "No in-scope gaps were detected" in teaser
    assert "✅ 4 in scope and passing" in teaser
    # Nothing is being withheld, so no lock line: it would read as bad news.
    assert "Additional Findings Locked" not in teaser
    assert teaser.rstrip().splitlines()[-1] == reporter.CONTACT_LINE


def test_full_report_lists_all_findings_with_evidence():
    full = reporter.render_full_report(FINDINGS, "https://acme.com", generated_at=NOW)
    for finding in FINDINGS:
        assert finding["regulation"] in full
    assert "> We use automated scoring to rank candidates." in full
    assert "Add a pre-use ADMT notice and an opt-out route." in full


def test_write_reports_creates_both_files():
    with tempfile.TemporaryDirectory() as temp_dir:
        full_path, teaser_path = reporter.write_reports(
            FINDINGS, "https://acme.com", out_dir=temp_dir, generated_at=NOW
        )
        assert full_path.name == "full_report.md"
        assert teaser_path.name == "teaser_report.md"
        assert full_path.parent == teaser_path.parent == Path(temp_dir)
        assert "AI Compliance Gap Analysis" in teaser_path.read_text(encoding="utf-8")


def test_token_budget_rejects_oversized_request():
    budget = TokenBudget(tpm=100)
    try:
        budget.acquire(101)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for request above TPM limit")


def test_full_scope_fits_the_free_tier_budget():
    body = "word " * 4_000  # comfortably past the scraper's document cap
    prompt_tokens = sum(
        estimate_tokens(message["content"]) for message in build_prompt(truncate(body))
    )
    assert prompt_tokens + auditor.DEFAULT_MAX_OUTPUT_TOKENS <= auditor.TPM_LIMIT


def test_normalize_findings_cleans_literal_empty_markers():
    findings = normalize_findings(
        [
            {"regulation": "nyc_ll144", "status": "Fail", "severity": "High", "evidence_quote": '""'},
            {"regulation": "ftc_section5", "status": "Fail", "severity": "High", "evidence_quote": " none "},
        ]
    )
    ids = list(REGULATION_IDS)
    assert findings[ids.index("nyc_ll144")]["evidence_quote"] == ""
    assert findings[ids.index("ftc_section5")]["evidence_quote"] == ""


def test_classify_page_uses_fast_model_and_short_excerpt():
    monkeypatch = _MonkeyPatch()
    try:
        fake = _patch_client(monkeypatch, '{"label": "privacy_policy"}')
        label = auditor.classify_page("POLICY_START " + "x" * 8_000, budget=TokenBudget())
    finally:
        monkeypatch.undo()

    assert label == "privacy_policy"
    sent = fake.completions.calls[0]
    assert sent["model"] == auditor.MODEL_FAST == "openai/gpt-oss-20b"
    assert sent["response_format"] == {"type": "json_object"}
    assert sent["max_completion_tokens"] == auditor.DEFAULT_CLASSIFY_OUTPUT_TOKENS
    excerpt = sent["messages"][-1]["content"]
    assert "POLICY_START" in excerpt
    assert len(excerpt) < auditor.SCREEN_MAX_CHARS + 200
    assert "json" in sent["messages"][0]["content"].lower()


def test_classify_page_rejects_unrecognised_label():
    monkeypatch = _MonkeyPatch()
    try:
        _patch_client(monkeypatch, '{"label": "weird_page"}')
        try:
            auditor.classify_page("some text", budget=TokenBudget())
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError for an unknown label")
    finally:
        monkeypatch.undo()


def test_cli_skips_deep_audit_for_non_policy_page():
    import os

    import main as cli

    monkeypatch = _MonkeyPatch()
    os.environ["GROQ_API_KEY"] = "test"
    try:
        monkeypatch.setattr(cli, "classify_page", lambda text, **kw: "other")

        def _explode(*args, **kwargs):
            raise AssertionError("deep audit must not run for a non-policy page")

        monkeypatch.setattr(cli, "audit_document", _explode)
        code = cli.main(["--file", "samples/sample_privacy_policy.txt"])
    finally:
        monkeypatch.undo()
        os.environ.pop("GROQ_API_KEY", None)
    assert code == 1


def test_cli_fails_open_when_screening_errors():
    import os

    import main as cli

    monkeypatch = _MonkeyPatch()
    os.environ["GROQ_API_KEY"] = "test"
    seen = []
    try:
        def _boom(text, **kw):
            raise RuntimeError("screening down")

        monkeypatch.setattr(cli, "classify_page", _boom)
        monkeypatch.setattr(
            cli,
            "audit_document",
            lambda text, **kw: (seen.append(text), FINDINGS)[1],
        )
        code = cli.main(["--file", "samples/sample_privacy_policy.txt", "--out-dir", tempfile.mkdtemp()])
    finally:
        monkeypatch.undo()
        os.environ.pop("GROQ_API_KEY", None)
    assert code == 0
    assert seen  # the deep audit still ran


def test_screening_plus_deep_audit_fits_the_free_tier_budget():
    body = truncate("word " * 4_000)  # the scraper's document cap
    screening = (
        estimate_tokens(auditor.CLASSIFY_PROMPT)
        + estimate_tokens(body[: auditor.SCREEN_MAX_CHARS])
        + auditor.DEFAULT_CLASSIFY_OUTPUT_TOKENS
    )
    deep = sum(estimate_tokens(m["content"]) for m in build_prompt(body))
    assert screening + deep + auditor.DEFAULT_MAX_OUTPUT_TOKENS <= auditor.TPM_LIMIT


def test_normalize_findings_accepts_out_of_scope_and_drops_its_quote():
    findings = normalize_findings(
        [
            {
                "regulation": "nyc_ll144",
                "status": "N/A (Out of Scope)",
                "severity": "High",
                "evidence_quote": "We collect usage data.",
                "remediation_note": "",
            },
            {"regulation": "ftc_section5", "status": "not applicable"},
        ]
    )
    ids = list(REGULATION_IDS)
    nyc = findings[ids.index("nyc_ll144")]
    assert nyc["status"] == NA_STATUS
    assert nyc["severity"] == "None"
    assert nyc["evidence_quote"] == ""  # never evidence of a problem
    assert findings[ids.index("ftc_section5")]["status"] == NA_STATUS


def test_fail_without_a_quote_is_downgraded_to_a_gap():
    monkeypatch = _MonkeyPatch()
    payload = (
        '{"findings": [{"regulation": "nyc_ll144", "status": "Fail", "severity": "High", '
        '"evidence_quote": "", "remediation_note": "Publish a bias audit."}]}'
    )
    try:
        _patch_client(monkeypatch, payload)
        findings = audit_document("A plain privacy policy with no hiring content.", budget=TokenBudget())
    finally:
        monkeypatch.undo()

    nyc = findings[list(REGULATION_IDS).index("nyc_ll144")]
    assert nyc["status"] == "Warning"
    assert nyc["severity"] == "Medium"
    assert "disclosure gap" in nyc["remediation_note"]


def test_fabricated_quote_is_never_shown_as_evidence():
    monkeypatch = _MonkeyPatch()
    payload = (
        '{"findings": [{"regulation": "ftc_section5", "status": "Fail", "severity": "High", '
        '"evidence_quote": "We are 100% HIPAA compliant and fully unbiased.", '
        '"remediation_note": "Remove the claim."}]}'
    )
    try:
        _patch_client(monkeypatch, payload)
        findings = audit_document("We test our models before launch.", budget=TokenBudget())
    finally:
        monkeypatch.undo()

    ftc = findings[list(REGULATION_IDS).index("ftc_section5")]
    assert ftc["evidence_quote"] == ""
    assert ftc["status"] == "Warning"


def test_long_quote_with_fabricated_tail_is_not_evidence():
    real = (
        "We process your personal data to provide the service, to secure the "
        "service, and to communicate with you about changes to our terms and "
        "policies."
    )
    document = f"Privacy policy. {real} We never sell your data."
    # Opening matches the document; the closing words are invented.
    quote = real[:120] + " We also guarantee full DPDP compliance at all times."
    assert auditor.quote_in_document(quote, document) is False
    # Clipping the passage to its real opening is still accepted.
    assert auditor.quote_in_document(real[:120], document) is True
    assert auditor.quote_in_document(real, document) is True


def test_verbatim_quote_keeps_the_fail():
    monkeypatch = _MonkeyPatch()
    payload = (
        '{"findings": [{"regulation": "ftc_section5", "status": "Fail", "severity": "High", '
        '"evidence_quote": "We are 100% HIPAA compliant.", '
        '"remediation_note": "Remove the claim."}]}'
    )
    try:
        _patch_client(monkeypatch, payload)
        findings = audit_document("Security page. We are 100% HIPAA compliant. Contact us.", budget=TokenBudget())
    finally:
        monkeypatch.undo()

    ftc = findings[list(REGULATION_IDS).index("ftc_section5")]
    assert ftc["status"] == "Fail"
    assert ftc["evidence_quote"] == "We are 100% HIPAA compliant."


def test_full_report_separates_open_passes_and_out_of_scope():
    mixed = [
        FINDINGS[0],  # Fail
        FINDINGS[2],  # Pass
        {
            "regulation": "NYC Local Law 144",
            "regulation_id": "nyc_ll144",
            "status": NA_STATUS,
            "severity": "None",
            "evidence_quote": "",
            "remediation_note": "Only applies to employers using an AEDT for hiring.",
        },
    ]
    full = reporter.render_full_report(mixed, "https://acme.com", generated_at=NOW)
    assert full.index("## Open findings") < full.index("## In scope and passing")
    assert full.index("## In scope and passing") < full.index("## Out of scope")
    assert "not a finding against the company" in full
    assert "➖ **NYC Local Law 144** — N/A (Out of Scope)" in full
    assert "no problematic wording found" not in full  # the Fail has a real quote


def test_teaser_never_exposes_out_of_scope_items():
    mixed = [
        {
            "regulation": "NYC Local Law 144",
            "status": NA_STATUS,
            "severity": "None",
            "evidence_quote": "",
            "remediation_note": "Out of scope for a consumer privacy notice.",
        },
        FINDINGS[1],  # Warning
    ]
    teaser = reporter.render_teaser_report(mixed, "https://acme.com", generated_at=NOW)
    assert "**1 of 2 regulations** have open gaps." in teaser
    assert "➖ 1 out of scope" in teaser
    assert "### 1. Texas TRAIGA" in teaser
    assert teaser.count("### ") == 1


def test_parse_findings_accepts_raw_json():
    payload = json.dumps({"findings": [FINDINGS[0], "junk"]})
    parsed = reporter.parse_findings(payload)
    assert len(parsed) == 1
    assert parsed[0]["status"] == "Fail"
    assert reporter.parse_findings(FINDINGS) == FINDINGS


def test_normalize_findings_matches_short_regulation_names():
    findings = normalize_findings(
        [
            {"regulation": "DPDP Act", "status": "N/A (Out of Scope)"},
            {"regulation": "Section 5", "status": "Pass"},
            {"regulation": "Local Law 144", "status": "Warning"},
        ]
    )
    by_id = {finding["regulation_id"]: finding for finding in findings}
    assert by_id["india_dpdp"]["status"] == NA_STATUS
    assert by_id["ftc_section5"]["status"] == "Pass"
    assert by_id["nyc_ll144"]["status"] == "Warning"


def test_prompt_carries_the_dpdp_notice_grievance_and_retention_checks():
    joined = "\n".join(m["content"] for m in build_prompt("POLICY_TEXT"))
    dpdp = REGULATIONS["india_dpdp"]
    assert dpdp["name"] == "India DPDP Act"
    assert "[india_dpdp] India DPDP Act" in joined
    assert "Grievance" in joined or "grievance" in joined
    assert "retention" in joined.lower()
    # A bundled/obscure notice can be a Fail; a pure absence stays a Warning.
    assert "GRADING NOTE:" in joined
    assert "quote the collecting sentence" in joined
    # Every rubric must carry a scope boundary and at least one check.
    for regulation_id, meta in REGULATIONS.items():
        assert meta["scope"]["applies_when"], regulation_id
        assert meta["scope"]["not_applicable_when"], regulation_id
        assert meta["checks"], regulation_id


def test_dpdp_marks_india_out_of_scope_and_bundled_consent_as_a_fail():
    document = (
        "=== SOURCE: privacy policy / privacy notice — https://acme.com/privacy ===\n"
        "We serve customers in the United States and Canada. "
        "By continuing to browse, you consent to all processing of your data "
        "for any purpose we choose."
    )
    dpdp_index = list(REGULATION_IDS).index("india_dpdp")
    monkeypatch = _MonkeyPatch()
    try:
        _patch_client(
            monkeypatch,
            '{"findings": [{"regulation": "india_dpdp", "status": "N/A (Out of Scope)", '
            '"severity": "High", "evidence_quote": "We serve customers in the United States and Canada.", '
            '"remediation_note": ""}]}',
        )
        findings = audit_document(document, budget=TokenBudget())
    finally:
        monkeypatch.undo()
    na = findings[dpdp_index]
    assert na["status"] == NA_STATUS
    assert na["severity"] == "None"
    assert na["evidence_quote"] == ""

    monkeypatch = _MonkeyPatch()
    try:
        _patch_client(
            monkeypatch,
            '{"findings": [{"regulation": "india_dpdp", "status": "Fail", "severity": "High", '
            '"evidence_quote": "By continuing to browse, you consent to all processing of your data ", '
            '"remediation_note": "Replace bundling with a specific, purpose-itemised notice."}]}',
        )
        findings = audit_document(document, budget=TokenBudget())
    finally:
        monkeypatch.undo()
    fail = findings[dpdp_index]
    assert fail["status"] == "Fail"
    assert fail["severity"] == "High"
    assert "By continuing to browse" in fail["evidence_quote"]


def test_shared_budget_is_one_instance_for_every_audit():
    assert auditor.shared_budget() is auditor.shared_budget()


def test_dashboard_audits_draw_on_the_shared_budget(monkeypatch):
    """Two audits begun without an explicit budget must spend one window."""
    shared = TokenBudget(tpm=20_000)
    document = (
        "=== SOURCE: privacy policy / privacy notice - https://acme.com/privacy ===\n"
        "We collect email addresses."
    )
    try:
        monkeypatch.setattr(auditor, "_SHARED_BUDGET", shared)
        _patch_client(monkeypatch, '{"findings": []}')
        auditor.audit_document(document)
        auditor.audit_document(document)
    finally:
        monkeypatch.undo()

    per_audit = (
        sum(estimate_tokens(message["content"]) for message in build_prompt(document))
        + auditor.DEFAULT_MAX_OUTPUT_TOKENS
    )
    # Both reservations land in the one window instead of two private windows.
    assert shared.used() == 2 * per_audit


def test_concurrent_threads_cannot_overspend_one_budget():
    """A second thread blocks until the first reservation leaves the window."""
    budget = TokenBudget(tpm=1_200, window_seconds=0.8)
    acquired_at: list[float] = []
    guard = threading.Lock()

    def worker() -> None:
        budget.acquire(700)
        with guard:
            acquired_at.append(time.monotonic())

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    acquired_at.sort()
    assert len(acquired_at) == 2
    assert acquired_at[1] - acquired_at[0] >= 0.7, acquired_at
    assert budget.used() <= budget.tpm


def test_cli_accepts_url_flag_and_positional_form():
    import main as cli

    flag_args = cli.parse_args(["--url", "https://example.com/privacy-policy"])
    assert flag_args.url_option == "https://example.com/privacy-policy"
    positional = cli.parse_args(["https://example.com"])
    assert positional.target == "https://example.com"
    assert positional.url_option is None


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        if test.__code__.co_argcount == 1:
            patch = _MonkeyPatch()
            try:
                test(patch)
            finally:
                patch.undo()
        else:
            test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed")
