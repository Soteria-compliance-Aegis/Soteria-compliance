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
npm run typecheck                               # workspace
```
