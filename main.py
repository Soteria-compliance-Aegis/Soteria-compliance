"""CLI: fetch one policy page, grade every regulation in one Groq call,
then write the full and teaser reports.

    python main.py --url https://example.com/privacy-policy
    python main.py https://acme.com --out-dir reports
    python main.py --file samples/sample_privacy_policy.txt
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

from auditor import MODEL_FAST, POLICY_LABELS, TokenBudget, audit_document, classify_page
from reporter import write_reports
from scraper import DEFAULT_MAX_CHARS, Section, clean_html, format_sections, kind_for_path, scrape, truncate


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aegis: AI compliance gap analysis against four US AI regulations plus India's DPDP Act"
    )
    parser.add_argument(
        "target",
        nargs="?",
        metavar="URL",
        help="Public URL to audit (root domains probe /privacy and /privacy-policy)",
    )
    parser.add_argument(
        "--url",
        dest="url_option",
        metavar="URL",
        help="Target URL to audit; same as passing it positionally",
    )
    parser.add_argument(
        "--file",
        metavar="PATH",
        help="Audit a local text/HTML file instead of a URL",
    )
    parser.add_argument(
        "--no-screen",
        action="store_true",
        help=f"Skip the {MODEL_FAST} page screening and always run the deep audit",
    )
    parser.add_argument(
        "--out-dir",
        default="output",
        metavar="DIR",
        help="Directory for full_report.md and teaser_report.md (default: output)",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=DEFAULT_MAX_CHARS,
        help=f"Truncate the document to this many characters (default: {DEFAULT_MAX_CHARS})",
    )
    return parser.parse_args(argv)


def load_document(url: str | None, file_path: str | None, max_chars: int) -> tuple[str, str]:
    """Return ``(source_label, tagged_text)`` from a URL or a local file."""
    if file_path:
        path = Path(file_path)
        raw = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix.lower() in (".html", ".htm"):
            text = clean_html(raw, max_chars=max_chars)
        else:
            text = truncate(raw, max_chars=max_chars)
        section = Section(kind_for_path(str(path)), str(path), text)
        return f"local file ({path})", format_sections([section], max_chars=max_chars)

    page = scrape(url, max_chars=max_chars)
    urls = ", ".join(dict.fromkeys(section.url for section in page.sections)) or page.url
    return f"{page.label()} ({urls})", page.text


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(argv)
    url = args.url_option or args.target

    if not url and not args.file:
        print("Provide --url URL (or a positional URL) or --file PATH. See --help.")
        return 2
    if url and args.file:
        print("Pass either a URL or --file PATH, not both.")
        return 2
    if not os.getenv("GROQ_API_KEY"):
        print("GROQ_API_KEY is missing. Add it to .env (see .gitignore) and retry.")
        return 2

    try:
        source, text = load_document(url, args.file, args.max_chars)
    except Exception as exc:  # noqa: BLE001 - surface fetch/file problems cleanly
        print(f"Could not load the document: {exc}")
        return 1

    if len(text) < 100:
        print(f"Not enough readable text to audit ({len(text)} characters) from {source}.")
        return 1
    # One shared budget covers screening + deep audit, so both calls together
    # stay inside the 8,000 TPM free-tier ceiling.
    budget = TokenBudget()
    if args.no_screen:
        print("[main] screening: skipped (--no-screen)")
    else:
        try:
            label = classify_page(text, budget=budget)
            print(f"[main] screening ({MODEL_FAST}): {label}")
        except Exception as exc:  # noqa: BLE001 - screening must never block an audit
            label = "unknown"
            print(f"[main] screening failed ({type(exc).__name__}: {exc}); auditing anyway")
        if label not in POLICY_LABELS and label != "unknown":
            print(
                f"{source} looks like '{label}', not a policy or AI disclosure page, "
                "so the deep audit was skipped. Use --no-screen to audit it anyway."
            )
            return 1

    print(f"[main] auditing {source} ({len(text):,} characters)")

    try:
        findings = audit_document(text, source=source, budget=budget)
    except Exception as exc:  # noqa: BLE001 - one failed call should not traceback
        print(f"Audit failed: {type(exc).__name__}: {exc}")
        return 1

    for finding in findings:
        detail = "" if finding["severity"] == "None" else f" ({finding['severity']})"
        print(f"[main] {finding['regulation']}: {finding['status']}{detail}")

    full_path, teaser_path = write_reports(findings, source, out_dir=args.out_dir)
    print(f"[main] wrote {full_path}")
    print(f"[main] wrote {teaser_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
