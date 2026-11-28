"""Backend tests: auth, public lead capture, admin API. Offline, temp SQLite.

Run with ``python3 tests/test_backend.py`` or ``pytest tests/test_backend.py``.
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_TMP = tempfile.mkdtemp(prefix="soteria-tests-")
os.environ["AEGIS_DB"] = str(Path(_TMP) / "aegis.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("GROQ_API_KEY", None)
os.environ.pop("SOTERIA_AUTH", None)
os.environ.pop("SOTERIA_TRUST_PROXY", None)
os.environ.pop("SLACK_WEBHOOK_URL", None)
os.environ.pop("DISCORD_WEBHOOK_URL", None)
os.environ["ADMIN1_EMAIL"] = "Alice@Soteria.test"
os.environ["ADMIN1_NAME"] = "Alice"
os.environ["ADMIN1_PASSWORD"] = "correct-horse-battery"
os.environ["ADMIN2_EMAIL"] = "bob@soteria.test"
os.environ["ADMIN2_NAME"] = "Bob"
os.environ["ADMIN2_PASSWORD"] = "another-long-password"

from fastapi.testclient import TestClient  # noqa: E402

import backend  # noqa: E402
from backend import db, notify, security  # noqa: E402
import server  # noqa: E402

PASSWORD = "correct-horse-battery"
LEAD = {
    "name": "Ada Lovelace",
    "email": "Ada@Example.com",
    "company": "Analytical Engines",
    "role": "CTO",
    "interest": "audit",
    "message": "We ship an AI hiring tool.",
    "website": "",
    "consent": True,
}


def _reset_state() -> None:
    for table in ("leads", "lead_notes", "prospects", "activity", "rate_events"):
        db.execute(f"DELETE FROM {table}")
    db.execute("DELETE FROM sessions")


def make_client(ip: str = "10.0.0.1") -> TestClient:
    backend.ensure_ready()
    _reset_state()
    return TestClient(server.app, client=(ip, 5000))


def login(client: TestClient, email: str = "alice@soteria.test", password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def signed_in(ip: str = "10.0.0.1") -> TestClient:
    client = make_client(ip)
    assert login(client).status_code == 200
    return client


class Sink:
    """Collects webhook posts instead of touching the network."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, url: str, payload: dict) -> None:
        self.calls.append((url, payload))


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #


def test_engine_routes_require_a_session():
    client = make_client()
    for method, path in (("get", "/api/documents"), ("get", "/api/console"), ("get", "/api/monitoring/targets"),
                         ("post", "/api/brief"), ("get", "/api/admin/overview")):
        response = getattr(client, method)(path)
        assert response.status_code == 401, path
        assert response.json() == {"detail": "Not signed in"}


def test_health_is_minimal_when_signed_out_and_full_when_signed_in():
    client = make_client()
    assert client.get("/api/health").json() == {"ok": True}
    assert login(client).status_code == 200
    full = client.get("/api/health").json()
    assert full["ok"] is True and "regulations" in full and "keyConfigured" in full


def test_spa_paths_stay_public():
    client = make_client()
    assert client.get("/some/client/route").status_code in (200, 503)


def test_login_success_sets_a_hardened_cookie_and_stores_only_a_hash():
    client = make_client()
    response = login(client, "ALICE@soteria.test")
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "alice@soteria.test"
    assert response.json()["user"]["name"] == "Alice"
    assert "password" not in response.text
    cookie = response.headers["set-cookie"].lower()
    assert "soteria_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "secure" not in cookie
    token = client.cookies.get("soteria_session")
    assert token
    rows = db.fetchall("SELECT token_hash FROM sessions")
    assert len(rows) == 1 and rows[0]["token_hash"] != token and token not in rows[0]["token_hash"]
    assert client.get("/api/documents").status_code == 200


def test_cookie_is_secure_when_configured(monkeypatch=None):
    os.environ["SOTERIA_COOKIE_SECURE"] = "1"
    try:
        client = make_client()
        assert "secure" in login(client).headers["set-cookie"].lower()
    finally:
        del os.environ["SOTERIA_COOKIE_SECURE"]


def test_login_failure_is_generic():
    client = make_client()
    wrong = login(client, password="nope-nope-nope")
    unknown = login(client, email="nobody@soteria.test")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email or password"}
    assert "set-cookie" not in wrong.headers


def test_login_is_throttled_after_eight_failures_per_ip():
    client = make_client("10.9.9.9")
    for _ in range(8):
        assert login(client, password="bad-bad-bad-bad").status_code == 401
    blocked = login(client)  # even the right password is refused while throttled
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0
    other = TestClient(server.app, client=("10.9.9.10", 1))
    assert login(other).status_code == 200


def test_successful_login_resets_the_failure_count():
    client = make_client("10.8.8.8")
    for _ in range(5):
        login(client, password="bad-bad-bad-bad")
    assert login(client).status_code == 200
    for _ in range(5):
        assert login(client, password="bad-bad-bad-bad").status_code == 401


def test_me_and_logout():
    client = make_client()
    assert client.get("/api/auth/me").status_code == 401
    login(client)
    assert client.get("/api/auth/me").json()["user"]["email"] == "alice@soteria.test"
    assert client.post("/api/auth/logout").json() == {"ok": True}
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/documents").status_code == 401
    assert db.fetchall("SELECT 1 FROM sessions") == []


def test_expired_sessions_are_rejected():
    client = signed_in()
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.execute("UPDATE sessions SET expires_at = ?", (past,))
    assert client.get("/api/auth/me").status_code == 401


def test_password_hashing_roundtrip():
    hashed = security.hash_password("s3cret-passphrase")
    assert hashed.startswith("scrypt$") and "s3cret" not in hashed
    assert security.verify_password("s3cret-passphrase", hashed)
    assert not security.verify_password("other", hashed)
    assert not security.verify_password("x", "garbage")


def test_both_admins_are_bootstrapped():
    backend.ensure_ready()
    emails = {row["email"] for row in db.fetchall("SELECT email FROM users")}
    assert {"alice@soteria.test", "bob@soteria.test"} <= emails


def test_auth_off_opens_engine_routes_but_not_admin():
    os.environ["SOTERIA_AUTH"] = "off"
    try:
        client = make_client()
        assert client.get("/api/documents").status_code == 200
        assert client.get("/api/admin/leads").status_code == 401
    finally:
        del os.environ["SOTERIA_AUTH"]


# --------------------------------------------------------------------------- #
# Public leads
# --------------------------------------------------------------------------- #


def test_lead_happy_path_stores_a_hashed_ip_and_logs_activity():
    client = make_client("203.0.113.7")
    response = client.post("/api/public/leads", json=LEAD)
    assert response.status_code == 201 and response.json() == {"ok": True}
    row = db.fetchall("SELECT * FROM leads")[0]
    assert row["email"] == "ada@example.com" and row["status"] == "new" and row["consent"] == 1
    assert row["source"] == "website"
    assert "203.0.113.7" not in row["ip_hash"] and len(row["ip_hash"]) == 32
    assert db.fetchall("SELECT action FROM activity")[0]["action"] == "lead.created"


def test_lead_honeypot_returns_201_and_stores_nothing():
    client = make_client()
    response = client.post("/api/public/leads", json={**LEAD, "website": "http://spam.example"})
    assert response.status_code == 201
    assert db.fetchall("SELECT id FROM leads") == []


def test_lead_requires_consent_and_valid_fields():
    client = make_client()
    assert client.post("/api/public/leads", json={**LEAD, "consent": False}).status_code == 422
    missing = {k: v for k, v in LEAD.items() if k != "consent"}
    assert client.post("/api/public/leads", json=missing).status_code == 422
    assert client.post("/api/public/leads", json={**LEAD, "email": "not-an-email"}).status_code == 422
    assert client.post("/api/public/leads", json={**LEAD, "interest": "other-thing"}).status_code == 422
    assert client.post("/api/public/leads", json={**LEAD, "name": "   "}).status_code == 422
    assert client.post("/api/public/leads", json={**LEAD, "message": "x" * 4001}).status_code == 422
    assert db.fetchall("SELECT id FROM leads") == []


def test_lead_rate_limit_is_five_per_hour_per_ip():
    client = make_client("198.51.100.1")
    for _ in range(5):
        assert client.post("/api/public/leads", json=LEAD).status_code == 201
    assert client.post("/api/public/leads", json=LEAD).status_code == 429
    other = TestClient(server.app, client=("198.51.100.2", 1))
    assert other.post("/api/public/leads", json=LEAD).status_code == 201
    assert len(db.fetchall("SELECT id FROM leads")) == 6


def test_forwarded_for_is_ignored_unless_proxy_is_trusted():
    client = make_client("198.51.100.5")
    for i in range(6):
        response = client.post("/api/public/leads", json=LEAD, headers={"X-Forwarded-For": f"1.1.1.{i}"})
    assert response.status_code == 429  # spoofed header did not dodge the limit

    os.environ["SOTERIA_TRUST_PROXY"] = "1"
    try:
        client = make_client("198.51.100.5")
        for i in range(6):
            response = client.post("/api/public/leads", json=LEAD, headers={"X-Forwarded-For": f"2.2.2.{i}, 9.9.9.9"})
        assert response.status_code == 201  # distinct first hops, distinct buckets
    finally:
        del os.environ["SOTERIA_TRUST_PROXY"]


def test_public_config():
    client = make_client()
    assert client.get("/api/public/config").json() == {"posthogKey": None, "posthogHost": "https://us.i.posthog.com"}
    os.environ["POSTHOG_KEY"], os.environ["POSTHOG_HOST"] = "phc_test", "https://eu.i.posthog.com"
    try:
        assert client.get("/api/public/config").json() == {"posthogKey": "phc_test", "posthogHost": "https://eu.i.posthog.com"}
    finally:
        del os.environ["POSTHOG_KEY"], os.environ["POSTHOG_HOST"]


# --------------------------------------------------------------------------- #
# Notifications
# --------------------------------------------------------------------------- #


def _with_webhooks(test):
    original = notify._post_json
    os.environ["SLACK_WEBHOOK_URL"] = "https://hooks.slack.test/abc"
    os.environ["DISCORD_WEBHOOK_URL"] = "https://discord.test/api/webhooks/1/xyz"
    try:
        test()
    finally:
        notify._post_json = original
        del os.environ["SLACK_WEBHOOK_URL"], os.environ["DISCORD_WEBHOOK_URL"]


def test_lead_notifies_slack_and_discord_with_trimmed_safe_text():
    def run():
        sink = Sink()
        notify._post_json = sink
        client = make_client()
        message = "@everyone @here <!channel> " + "y" * 400
        assert client.post("/api/public/leads", json={**LEAD, "message": message}).status_code == 201
        by_url = dict(sink.calls)
        slack = by_url["https://hooks.slack.test/abc"]
        discord = by_url["https://discord.test/api/webhooks/1/xyz"]
        assert set(slack) == {"text"} and "content" in discord
        for text in (slack["text"], discord["content"]):
            assert "Ada Lovelace" in text and "Analytical Engines" in text
            assert "@everyone" not in text and "@here" not in text
            assert text.count("y") <= 200
        assert "<!channel>" not in slack["text"]
        assert discord["allowed_mentions"] == {"parse": []}

    _with_webhooks(run)


def test_only_configured_channels_are_called():
    sink = Sink()
    original = notify._post_json
    notify._post_json = sink
    os.environ["DISCORD_WEBHOOK_URL"] = "https://discord.test/hook"
    try:
        make_client().post("/api/public/leads", json=LEAD)
        assert [url for url, _ in sink.calls] == ["https://discord.test/hook"]
    finally:
        notify._post_json = original
        del os.environ["DISCORD_WEBHOOK_URL"]


def test_notification_failure_does_not_fail_the_request():
    def run():
        def boom(url, payload):
            raise OSError("network down")

        notify._post_json = boom
        client = make_client()
        assert client.post("/api/public/leads", json=LEAD).status_code == 201
        assert len(db.fetchall("SELECT id FROM leads")) == 1

    _with_webhooks(run)


# --------------------------------------------------------------------------- #
# Admin: leads
# --------------------------------------------------------------------------- #


def _seed_lead(client: TestClient, **overrides) -> int:
    ip = f"192.0.2.{len(db.fetchall('SELECT id FROM leads')) + 1}"
    TestClient(server.app, client=(ip, 1)).post("/api/public/leads", json={**LEAD, **overrides})
    return db.fetchall("SELECT id FROM leads ORDER BY id DESC")[0]["id"]


def test_admin_requires_session_for_every_route():
    client = make_client()
    for method, path in (
        ("get", "/api/admin/leads"), ("get", "/api/admin/leads/1"), ("patch", "/api/admin/leads/1"),
        ("post", "/api/admin/leads/1/notes"), ("delete", "/api/admin/leads/1"),
        ("get", "/api/admin/prospects"), ("post", "/api/admin/prospects"),
        ("post", "/api/admin/prospects/import"), ("patch", "/api/admin/prospects/1"),
        ("delete", "/api/admin/prospects/1"), ("get", "/api/admin/team"),
        ("get", "/api/admin/activity"), ("get", "/api/admin/overview"),
    ):
        assert getattr(client, method)(path).status_code == 401, path


def test_admin_lead_list_filter_search_patch_notes_delete():
    client = signed_in()
    first = _seed_lead(client, name="Grace Hopper", company="Compilers Inc", interest="scorecard")
    second = _seed_lead(client, name="Linus", company="Kernel Ltd", message="100% fine_print")

    listing = client.get("/api/admin/leads").json()
    assert listing["total"] == 2 and [l["id"] for l in listing["leads"]] == [second, first]
    assert "ip_hash" not in listing["leads"][0]
    assert client.get("/api/admin/leads?q=compilers").json()["total"] == 1
    assert client.get("/api/admin/leads?q=100%25").json()["total"] == 1  # % is literal
    assert client.get("/api/admin/leads?q=zzz").json()["total"] == 0
    assert client.get("/api/admin/leads?limit=1").json()["leads"][0]["id"] == second
    assert client.get("/api/admin/leads?status=bogus").status_code == 422

    patched = client.patch(f"/api/admin/leads/{first}", json={"status": "contacted", "assignee": "bob@soteria.test"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "contacted" and patched.json()["assignee"] == "bob@soteria.test"
    assert client.get("/api/admin/leads?status=contacted").json()["total"] == 1
    assert client.patch(f"/api/admin/leads/{first}", json={"status": "weird"}).status_code == 422
    assert client.patch(f"/api/admin/leads/{first}", json={"assignee": "ghost@x.test"}).status_code == 422
    assert client.patch(f"/api/admin/leads/{first}", json={"assignee": None}).json()["assignee"] is None
    assert client.patch("/api/admin/leads/9999", json={"status": "won"}).status_code == 404

    note = client.post(f"/api/admin/leads/{first}/notes", json={"body": "Called, wants a scorecard."})
    assert note.status_code == 201 and note.json()["author"] == "Alice"
    assert client.post(f"/api/admin/leads/{first}/notes", json={"body": "  "}).status_code == 422
    assert client.post("/api/admin/leads/9999/notes", json={"body": "x"}).status_code == 404
    detail = client.get(f"/api/admin/leads/{first}").json()
    assert detail["id"] == first and [n["body"] for n in detail["notes"]] == ["Called, wants a scorecard."]
    assert client.get("/api/admin/leads/9999").status_code == 404

    assert client.delete(f"/api/admin/leads/{first}").status_code == 204
    assert client.get(f"/api/admin/leads/{first}").status_code == 404
    assert db.fetchall("SELECT id FROM lead_notes") == []
    assert client.delete(f"/api/admin/leads/{first}").status_code == 404

    actions = [(a["who"], a["action"]) for a in client.get("/api/admin/activity").json()["activity"]]
    assert ("Alice", "lead.updated") in actions and ("Alice", "lead.note") in actions
    assert ("Alice", "lead.deleted") in actions and ("Website", "lead.created") in actions


def test_activity_names_the_acting_user():
    client = make_client()
    login(client, "bob@soteria.test", "another-long-password")
    client.post("/api/admin/prospects", json={"company": "Acme"})
    top = client.get("/api/admin/activity?limit=1").json()["activity"][0]
    assert top["who"] == "Bob" and top["action"] == "prospect.created" and top["subject"] == "Acme"


# --------------------------------------------------------------------------- #
# Admin: prospects
# --------------------------------------------------------------------------- #


def test_prospect_crud_and_filters():
    client = signed_in()
    created = client.post("/api/admin/prospects", json={
        "company": "Acme AI", "url": "acme.ai", "segment": "HR tech", "contact_email": "CEO@acme.ai",
    })
    assert created.status_code == 201
    body = created.json()
    assert body["stage"] == "research" and body["url"] == "https://acme.ai" and body["contact_email"] == "ceo@acme.ai"
    pid = body["id"]
    client.post("/api/admin/prospects", json={"company": "Beta", "segment": "Fintech", "stage": "call"})

    assert client.get("/api/admin/prospects").json()["total"] == 2
    assert client.get("/api/admin/prospects?stage=call").json()["prospects"][0]["company"] == "Beta"
    assert client.get("/api/admin/prospects?segment=hr%20tech").json()["total"] == 1
    assert client.get("/api/admin/prospects?q=acme").json()["total"] == 1
    assert client.get("/api/admin/prospects?stage=nope").status_code == 422

    updated = client.patch(f"/api/admin/prospects/{pid}", json={"stage": "replied", "notes": "Warm intro"})
    assert updated.status_code == 200 and updated.json()["stage"] == "replied" and updated.json()["notes"] == "Warm intro"
    assert client.patch(f"/api/admin/prospects/{pid}", json={"stage": "bogus"}).status_code == 422
    assert client.patch(f"/api/admin/prospects/{pid}", json={"company": None}).status_code == 422
    assert client.patch(f"/api/admin/prospects/{pid}", json={"contact_email": "bad"}).status_code == 422
    assert client.patch("/api/admin/prospects/9999", json={"stage": "call"}).status_code == 404
    assert client.post("/api/admin/prospects", json={"company": "", "stage": "research"}).status_code == 422
    assert client.post("/api/admin/prospects", json={"company": "X", "url": "ftp://x"}).status_code == 422

    assert client.delete(f"/api/admin/prospects/{pid}").status_code == 204
    assert client.delete(f"/api/admin/prospects/{pid}").status_code == 404
    assert client.get("/api/admin/prospects").json()["total"] == 1


def test_prospect_import_skips_duplicates_and_enforces_limit():
    client = signed_in()
    client.post("/api/admin/prospects", json={"company": "Acme", "url": "https://acme.ai"})
    rows = [
        {"company": "acme", "url": "https://ACME.ai/"},      # duplicate of existing (case/slash)
        {"company": "Newco", "url": "https://newco.io", "segment": "SaaS"},
        {"company": "Newco", "url": "newco.io"},              # duplicate within the batch
        {"company": "Acme", "url": "https://acme.com"},      # same company, other url: kept
        {"company": "NoUrl"},
    ]
    result = client.post("/api/admin/prospects/import", json={"rows": rows})
    assert result.status_code == 200 and result.json() == {"created": 3, "skipped": 2}
    assert client.get("/api/admin/prospects").json()["total"] == 4
    again = client.post("/api/admin/prospects/import", json={"rows": rows}).json()
    assert again == {"created": 0, "skipped": 5}

    too_many = [{"company": f"Co{i}"} for i in range(201)]
    assert client.post("/api/admin/prospects/import", json={"rows": too_many}).status_code == 422
    assert client.post("/api/admin/prospects/import", json={"rows": [{"company": "A", "stage": "x"}]}).status_code == 422


def test_team_lists_only_safe_fields():
    client = signed_in()
    team = client.get("/api/admin/team").json()["team"]
    assert {m["email"] for m in team} >= {"alice@soteria.test", "bob@soteria.test"}
    assert all(set(m) == {"id", "name", "email"} for m in team)


# --------------------------------------------------------------------------- #
# Overview
# --------------------------------------------------------------------------- #


def test_overview_shape_and_counts():
    client = signed_in()
    a = _seed_lead(client)
    b = _seed_lead(client, name="Old Lead")
    client.patch(f"/api/admin/leads/{b}", json={"status": "qualified"})
    old = (datetime.now(timezone.utc) - timedelta(days=21)).strftime("%Y-%m-%dT%H:%M:%SZ")
    db.execute("UPDATE leads SET created_at = ? WHERE id = ?", (old, b))
    client.post("/api/admin/prospects", json={"company": "P1", "stage": "call"})

    data = client.get("/api/admin/overview").json()
    assert set(data) == {"kpis", "leads_by_week", "leads_by_status", "pipeline_by_stage",
                         "findings_by_status", "recent_activity"}
    assert set(data["kpis"]) == {"leads_total", "leads_new", "leads_7d", "prospects", "audits",
                                 "open_gaps", "high_gaps", "monitored", "drifted"}
    assert data["kpis"]["leads_total"] == 2 and data["kpis"]["leads_new"] == 1
    assert data["kpis"]["leads_7d"] == 1 and data["kpis"]["prospects"] == 1

    weeks = data["leads_by_week"]
    assert len(weeks) == 8
    days = [datetime.strptime(w["week"], "%Y-%m-%d") for w in weeks]
    assert days == sorted(days) and all(d.weekday() == 0 for d in days)
    assert [(days[i + 1] - days[i]).days for i in range(7)] == [7] * 7
    assert sum(w["count"] for w in weeks) == 2 and weeks[-1]["count"] == 1
    assert any(w["count"] == 0 for w in weeks)

    assert data["leads_by_status"] == {"new": 1, "contacted": 0, "qualified": 1, "won": 0, "lost": 0}
    assert list(data["pipeline_by_stage"]) == ["research", "contacted", "replied", "scorecard_sent", "call", "audit_sold", "lost"]
    assert data["pipeline_by_stage"]["call"] == 1
    assert set(data["findings_by_status"]) == {"Fail", "Warning", "Pass", "N/A (Out of Scope)"}
    assert 1 <= len(data["recent_activity"]) <= 15
    assert set(data["recent_activity"][0]) == {"at", "who", "action", "subject", "detail"}
    assert a  # seeded


def test_overview_counts_engine_findings_and_monitoring():
    import json
    import sqlite3

    client = signed_in()
    path = db.sqlite_path()
    conn = sqlite3.connect(path)
    try:
        # The engine may or may not have created its tables yet; make sure they exist.
        server._db()
        import monitoring

        monitoring.list_targets()  # creates monitored_targets
        conn.executescript("DELETE FROM documents; DELETE FROM monitored_targets;")
        findings = [
            {"status": "Fail", "severity": "High"}, {"status": "Warning", "severity": "Medium"},
            {"status": "Pass", "severity": "Low"}, {"status": "N/A (Out of Scope)", "severity": "Low"},
            {"status": "Fail", "severity": "High"},
        ]
        for doc_id, raw in (("d1", json.dumps(findings)), ("d2", None), ("d3", "not json")):
            conn.execute(
                "INSERT INTO documents (id, name, file_type, size_bytes, chars, created_at, status, source, text, findings)"
                " VALUES (?, 'n', 'txt', 1, 1, 'now', 'ready', 's', 't', ?)", (doc_id, raw))
        for target_id, active, status in (("t1", 1, "drift_detected"), ("t2", 1, "clean"), ("t3", 0, "drift_detected")):
            conn.execute(
                "INSERT INTO monitored_targets (id, client_name, url, label, active, created_at, last_status)"
                " VALUES (?, 'c', 'https://x.test', 'l', ?, 'now', ?)", (target_id, active, status))
        conn.commit()
    finally:
        conn.close()
    try:
        data = client.get("/api/admin/overview").json()
        assert data["findings_by_status"] == {"Fail": 2, "Warning": 1, "Pass": 1, "N/A (Out of Scope)": 1}
        kpis = data["kpis"]
        assert (kpis["audits"], kpis["open_gaps"], kpis["high_gaps"]) == (2, 3, 2)
        assert (kpis["monitored"], kpis["drifted"]) == (2, 1)
    finally:
        conn = sqlite3.connect(path)
        conn.executescript("DELETE FROM documents; DELETE FROM monitored_targets;")
        conn.commit()
        conn.close()


def test_overview_survives_missing_engine_tables():
    client = signed_in()
    data = client.get("/api/admin/overview").json()
    assert data["kpis"]["audits"] >= 0 and len(data["leads_by_week"]) == 8


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed")
