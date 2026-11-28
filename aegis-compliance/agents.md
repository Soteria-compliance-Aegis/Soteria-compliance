# AGENTS.md — Aegis AI Compliance & Red-Teaming Prototype

## Project Overview
We are building the MVP for an AI regulatory compliance and red-teaming tool targeting US Series A/B startups.
- **Core Function:** Perform automated gap analysis comparing a startup's public documents (Privacy Policy, Terms of Service, AI disclosures, careers/hiring pages) against key US AI regulations.
- **Positioning:** Technical AI red-teaming and risk assessment (not legal advice).
- **Target Regulations (MVP Scope):**
  1. **California ADMT / CCPA:** Pre-use notices, opt-outs, and human review rights for automated decision-making.
  2. **Texas TRAIGA:** Bias/security testing alignment and NIST AI RMF safe-harbor practices.
  3. **NYC Local Law 144:** Public summary of annual bias audits for automated employment decision tools (AEDTs).
  4. **FTC Section 5 (AI-Washing):** Unsubstantiated AI claims ("100% unbiased", "HIPAA compliant") and undisclosed training on customer data via third-party LLM APIs.

## Tech Stack & Constraints
- **Language:** Python 3.11+
- **LLM Provider:** Groq Python SDK (`groq`) using `GROQ_API_KEY` from `.env`.
  - Use `openai/gpt-oss-120b` for deep policy discrepancy analysis.
  - Use `openai/gpt-oss-20b` for fast initial page classification/screening.
- **Rate-Limit Guardrails (Free Tier):** Stay strictly under 8,000 tokens per minute (TPM). Always strip HTML boilerplate (`<nav>`, `<footer>`, `<script>`, `<style>`) before sending text to Groq, and include retry/backoff logic for HTTP 429 errors.
- **Output Format:** Structured JSON containing `regulation`, `status` (`Pass`, `Warning`, `Fail`), `evidence_quote`, and `remediation_note`.

## Conventions & Safety
- Never hardcode API keys; always load from `.env` and keep `.env` in `.gitignore`.
- Keep modules cleanly separated: `scraper.py` (fetching & cleaning text), `rules.py` (regulatory prompts/rubrics), `auditor.py` (Groq API calls), and `main.py` (CLI runner).
- Include clear tests/sample runs so we can verify outputs on sample policy text.