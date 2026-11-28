"""Offline checks for continuous external monitoring (no Groq key needed).

The three guarantees under test are the ones the nightly n8n job depends on:

- an unchanged page never reaches the auditor (0 tokens),
- a changed page runs the five-part remediation audit and logs the drift,
- ``/api/monitoring/sweep-all`` returns a digest n8n can mail or post.
"""

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Same rule as tests/test_offline.py: never touch a developer's real database.
os.environ.setdefault(
    "AEGIS_DB", str(Path(tempfile.mkdtemp(prefix="aegis-monitoring-tests-")) / "aegis.db")
)

import pytest  # noqa: E402

import auditor  # noqa: E402
import monitoring  # noqa: E402
import server  # noqa: E402
from rules import OPEN_STATUSES  # noqa: E402


@pytest.fixture()
def store(tmp_path):
    """Point monitoring at a throwaway database, then put it back."""
    original = monitoring.DB_PATH
    monitoring.configure_db(tmp_path / "monitoring.db")
    try:
        yield monitoring
    finally:
        monitoring.configure_db(original)


def _wait_for(predicate, timeout=2.0):
    """Poll briefly for a daemon thread's side effect."""
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.01)


def _findings():
    """Two open gaps from a real normalize_findings pass, with one full plan."""
    return auditor.normalize_findings(
        [
            {
                "regulation": "ccpa_admt",
                "status": "Fail",
                "severity": "High",
                "evidence_quote": "",
                "remediation_note": "Publish a pre-use ADMT notice.",
            },
            {
                "regulation": "ftc_section5",
                "status": "Warning",
                "severity": "Medium",
                "evidence_quote": "",
                "remediation_note": "Soften the absolute compliance claim.",
            },
        ],
        remediation=[
            {
                "regulation": "ccpa_admt",
                "problem": "Automated scoring runs without a pre-use notice.",
                "rootCause": "The hiring tool shipped before the privacy notice.",
                "consequences": "Buyer legal review stalls the deal.",
                "exactFix": {
                    "copyRedline": "Candidates are ranked by automated scoring; request human review.",
                    "policyOrControlPatch": "Add an ADMT section naming the scoring model.",
                },
                "prevention": "Gate releases on a claim-versus-policy diff.",
            }
        ],
    )


def test_unchanged_content_skips_the_llm_entirely(store, monkeypatch):
    page = "Privacy policy. We collect account data to run the service. " * 3
    monkeypatch.setattr(monitoring, "_fetch_target_text", lambda url, label: page)

    target = store.create_target(
        client_name="Acme", url="https://acme.com/privacy", label="Privacy Policy"
    )
    assert target["hasBaseline"] is False

    audits = []

    def baseline(text, source):
        audits.append(text)
        return _findings(), "doc-baseline"

    first = store.check_target_drift(target["id"], audit=baseline)
    assert first["status"] == monitoring.STATUS_DRIFT
    assert first["driftDetected"] is True  # the first run captures a baseline
    assert first["llmCalls"] == 1
    assert len(audits) == 1

    def explode(text, source):
        raise AssertionError("an unchanged page must never reach the auditor")

    second = store.check_target_drift(target["id"], audit=explode)
    assert second["status"] == monitoring.STATUS_CLEAN
    assert second["driftDetected"] is False
    assert second["llmCalls"] == 0
    assert second["tokensUsed"] == 0
    assert second["contentHash"] == first["contentHash"]
    assert second["openGapsCount"] == first["openGapsCount"]  # counts carried forward
    assert len(audits) == 1  # still exactly one audit

    snapshots = store.history()
    assert [item["driftDetected"] for item in snapshots] == [False, True]
    assert store.get_target(target["id"])["lastStatus"] == monitoring.STATUS_CLEAN


def test_changed_content_runs_the_five_part_audit_and_alerts(store, monkeypatch):
    pages = {"https://acme.com/terms": "Terms v1. We may change these terms at any time. " * 3}
    monkeypatch.setattr(monitoring, "_fetch_target_text", lambda url, label: pages[url])

    target = store.create_target(
        client_name="Acme",
        url="https://acme.com/terms",
        label="Terms of Service",
        alert_webhook_url="https://hooks.example.com/aegis",
    )
    alerts = []
    monkeypatch.setattr(
        monitoring, "_post_alert", lambda webhook, payload: alerts.append((webhook, payload))
    )

    findings = _findings()
    first = store.check_target_drift(target["id"], audit=lambda text, source: (findings, "doc-1"))
    _wait_for(lambda: bool(alerts))
    assert alerts  # the baseline drift alerts too
    alerts.clear()

    pages["https://acme.com/terms"] = (
        "Terms v2. We train models on your prompts and never say so. " * 3
    )

    seen = []

    def audit(text, source):
        seen.append(text)
        return findings, "doc-2"

    second = store.check_target_drift(target["id"], audit=audit)

    assert second["driftDetected"] is True
    assert second["status"] == monitoring.STATUS_DRIFT
    assert second["auditDocId"] == "doc-2"
    assert second["contentHash"] != first["contentHash"]
    assert second["llmCalls"] == 1 and second["tokensUsed"] > 0
    assert "Terms v2" in seen[0]

    expected_open = sum(1 for item in findings if item["status"] in OPEN_STATUSES)
    expected_high = sum(
        1
        for item in findings
        if item["status"] in OPEN_STATUSES and item["severity"] == "High"
    )
    assert second["openGapsCount"] == expected_open
    assert second["highGapsCount"] == expected_high
    assert first["contentHash"][:8] in second["diffSummary"]

    # The audit's five-part plan is intact and reaches the alert's redline.
    plan = next(item for item in findings if item["regulation_id"] == "ccpa_admt")[
        "remediation_plan"
    ]
    assert {"problem", "rootCause", "consequences", "exactFix", "prevention"} <= set(plan)

    # The webhook fires off the request path, so give the thread a moment.
    _wait_for(lambda: bool(alerts))
    assert alerts, "the configured webhook should fire after a drift"
    webhook, payload = alerts[0]
    assert webhook == "https://hooks.example.com/aegis"
    assert payload["client_name"] == "Acme"
    assert payload["url"] == "https://acme.com/terms"
    assert payload["label"] == "Terms of Service"
    assert payload["open_gaps_count"] == expected_open
    assert payload["high_gaps_count"] == expected_high
    assert payload["top_redline"].startswith("Candidates are ranked by automated scoring")

    assert store.get_target(target["id"])["lastStatus"] == monitoring.STATUS_DRIFT
    assert store.history()[0]["auditDocId"] == "doc-2"


def test_sweep_all_returns_a_nightly_digest(store, monkeypatch):
    pages = {
        "https://acme.com/privacy": "Privacy v1. We collect account data. " * 4,
        "https://acme.com/pricing": "Pricing v1. The starter plan is $20 per seat. " * 4,
    }
    monkeypatch.setattr(monitoring, "_fetch_target_text", lambda url, label: pages[url])
    monkeypatch.setattr(auditor, "audit_document", lambda text, **kwargs: _findings())
    monkeypatch.setattr(monitoring, "_notify", lambda webhook, payload: None)

    store.create_target(client_name="Acme", url="https://acme.com/privacy", label="Privacy Policy")
    store.create_target(client_name="Acme", url="https://acme.com/pricing", label="Pricing Page")

    first = server.sweep_all_monitoring_targets()
    assert first["targetsChecked"] == 2
    assert first["drifted"] == 2 and first["clean"] == 0
    assert first["errored"] == 0
    assert first["openGaps"] > 0
    assert first["highGaps"] > 0
    assert first["summary"].startswith("Aegis nightly sweep:")

    pages["https://acme.com/pricing"] = "Pricing v2. The starter plan is $25 with a usage cap. " * 4
    second = server.sweep_all_monitoring_targets()
    assert second["drifted"] == 1
    assert second["clean"] == 1
    assert second["errored"] == 0
    assert second["targetsChecked"] == 2

    drifted = [item for item in second["results"] if item["status"] == monitoring.STATUS_DRIFT]
    assert len(drifted) == 1
    assert drifted[0]["url"] == "https://acme.com/pricing"
    # The conditional audit was saved as a normal document and is openable.
    assert drifted[0]["auditDocId"]
    assert server.get_document(drifted[0]["auditDocId"])["counts"]["open"] > 0

    # A digest is self-consistent: totals are the sum of the per-target rows.
    assert second["openGaps"] == sum(item["openGapsCount"] for item in second["results"])
    assert second["tokensUsed"] == sum(item["tokensUsed"] for item in second["results"])

    third = server.sweep_all_monitoring_targets()
    assert third["clean"] == 2 and third["drifted"] == 0
    assert third["tokensUsed"] == 0  # nothing moved, so nothing was spent


def test_targets_can_be_paused_then_purged(store):
    target = store.create_target(
        client_name="Acme", url="https://acme.com/ai", label="AI Product Page"
    )

    paused = server.delete_monitoring_target(target["id"])
    assert paused["purged"] is False
    assert paused["active"] is False
    assert [item["active"] for item in store.list_targets()] == [False]
    # A paused target is skipped by the nightly sweep.
    assert store.list_targets(active_only=True) == []

    purged = server.delete_monitoring_target(target["id"], purge=True)
    assert purged["purged"] is True and purged["active"] is False
    assert store.list_targets() == []
    with pytest.raises(KeyError):
        store.get_target(target["id"])
