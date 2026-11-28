# Aegis compliance workspace

A local dashboard for the Aegis audit engine, built on the Fusion energy
template's design system (pure black, fire and plasma light).

Upload a privacy policy, terms of service or AI disclosure as **PDF, DOCX or
TXT** and it is graded against the rubrics in `rules.py`: California ADMT /
CCPA, Texas TRAIGA, NYC Local Law 144, FTC Section 5 and India's DPDP Act.
Findings are split into **Fail**, **Warning**, **Pass** and **N/A (Out of
Scope)**, each with the exact evidence quote (or an explicit "disclosure gap")
and a concrete remediation.

Technical AI risk assessment, not legal advice.

## Run it

```sh
npm install
.venv/Scripts/python.exe -m pip install -r requirements.txt

npm run build
.venv/Scripts/python.exe server.py        # http://127.0.0.1:8000
```

`GROQ_API_KEY` must be in `.env` and is never committed. Uploaded text stays on
this machine; only the audit call goes to Groq, inside the same 8,000 TPM
budget the CLI uses. Every audit in the server process shares **one** sliding
window (`auditor.shared_budget()`), so two uploads started at the same time
queue behind the cap instead of each spending it in full; `GET /api/health`
reports the current `tokenBudget`.

## Develop

```sh
.venv/Scripts/python.exe server.py        # API on :8000
npm run dev                               # Vite on :5303, proxies /api
```

- `src/pages/Workspace.tsx` — overview, document library and audit detail.
- `src/lib/aegis.ts` — typed API client.
- `src/styles.css` — the template's tokens (kept as shipped).
- `server.py` — FastAPI + SQLite (`data/aegis.db`); calls `auditor.py` and
  `reporter.py` directly. Uploads are truncated at `DEFAULT_MAX_CHARS` exactly
  like a scraped page.

## CLI (unchanged)

```sh
.venv/Scripts/python.exe main.py --url https://example.com --out-dir output
```

## Checks

```sh
.venv/Scripts/python.exe tests/test_offline.py   # audit engine, offline
.venv/Scripts/python.exe tests/test_backend.py   # auth, leads, admin API (also runs under pytest)
npm run typecheck                               # workspace
```

## Admin backend and lead capture

`backend/` adds a session-authenticated admin API and public lead capture next
to the engine (which it does not modify). Every `/api/*` engine route now needs
a signed-in session, except `GET /api/health` (minimal `{ok: true}` when signed
out), `/api/public/*` and `/api/auth/*`. Static files and SPA routes stay public.

For local use set `ADMIN1_EMAIL`/`ADMIN1_PASSWORD` in `.env` (see
`.env.example`), or `SOTERIA_DEV=1` to get a throwaway `dev@soteria.local`
account whose random password is printed once. `SOTERIA_AUTH=off` opens the
legacy engine routes for local development only (the admin API still needs a
login).

## Deploying to Vercel

`api/index.py` exposes the FastAPI app as a Python serverless function and
`vercel.json` builds the SPA (`npm run build` to `dist`), rewrites `/api/*` to
the function (60 s max duration) and everything else to `index.html`.

Read this before you deploy:

- **`DATABASE_URL` (Neon/Supabase Postgres) is required** for leads and logins.
  The function filesystem is read-only/ephemeral (only `/tmp`, per instance), so
  SQLite would lose users and leads. Install `psycopg[binary]` (uncomment it in
  `requirements.txt`).
- **The legacy engine tables are still SQLite** (`documents`, `diffs`,
  `redteam_*`, `artifacts`, `monitored_targets`, ...), so on Vercel they live in
  `/tmp` and are **not durable**. Long audits can also exceed the function time
  limit. Run audits locally or on a long-lived host until those tables are
  ported to Postgres.
- Set `SOTERIA_COOKIE_SECURE=1` and, since Vercel is a trusted proxy,
  `SOTERIA_TRUST_PROXY=1` so rate limits see the real client IP.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Audit engine model access |
| `DATABASE_URL` | Postgres URL for users, sessions, leads, prospects (required on Vercel) |
| `ADMIN1_EMAIL`, `ADMIN1_NAME`, `ADMIN1_PASSWORD` | First admin, created/updated at startup (password 10+ chars) |
| `ADMIN2_EMAIL`, `ADMIN2_NAME`, `ADMIN2_PASSWORD` | Second admin |
| `SLACK_WEBHOOK_URL` | Optional: new-lead message to Slack |
| `DISCORD_WEBHOOK_URL` | Optional: new-lead message to Discord |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Optional: returned by `GET /api/public/config` (host defaults to `https://us.i.posthog.com`) |
| `SOTERIA_COOKIE_SECURE` | `1` forces the `Secure` cookie flag (also automatic over HTTPS) |
| `SOTERIA_TRUST_PROXY` | `1` trusts the first `X-Forwarded-For` hop for rate limits |
| `SOTERIA_AUTH` | `off` disables auth on legacy engine routes (local dev only) |
| `SOTERIA_DEV` | `1` creates `dev@soteria.local` when no admin is configured (local dev only) |
| `SOTERIA_IP_SALT` | Optional salt for stored IP hashes (otherwise generated and kept in the DB) |
| `AEGIS_DB` | SQLite path (defaults to `data/aegis.db`, or `/tmp/soteria.db` on Vercel) |
