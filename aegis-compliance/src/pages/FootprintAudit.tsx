import { useState } from 'react'
import { Filter, Globe, Sparkles } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Notice } from '../components/Controls'
import { Field, Input, Textarea } from '../components/Field'
import { Eyebrow } from '../components/Typography'
import { createDiff, fetchUrls } from '../lib/aegis'
import type { SnapshotError, UrlSnapshot } from '../lib/aegis'
import { navigate } from '../lib/router'

const MIN_CHARS = 40

/** Extra fields the fetch response carries alongside UrlSnapshot. */
type FetchedClause = { prioritized?: boolean; signalHits?: number }
type ReadSummary = { kind: string; label: string; kept: number; truncated: boolean; prioritized: boolean }

/** Workflow 1: fetch public pages or paste text, then run the claim-vs-policy diff. */
export function FootprintAudit() {
  const [company, setCompany] = useState('')
  const [website, setWebsite] = useState('')
  const [urls, setUrls] = useState({ homepage: '', product: '', privacy: '' })
  const [claims, setClaims] = useState('')
  const [policy, setPolicy] = useState('')
  const [claimsSource, setClaimsSource] = useState('')
  const [policySource, setPolicySource] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchNote, setFetchNote] = useState<string | null>(null)
  const [fetchErrors, setFetchErrors] = useState<SnapshotError[]>([])
  const [readSummary, setReadSummary] = useState<ReadSummary[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPages = async () => {
    setFetchNote(null)
    setFetchErrors([])
    if (!urls.homepage.trim() && !urls.product.trim() && !urls.privacy.trim()) {
      setFetchNote('Enter at least one URL, or paste the text in the boxes below.')
      return
    }
    setFetching(true)
    try {
      const result = await fetchUrls(urls)
      const claimSnapshots = result.snapshots.filter((snapshot) => snapshot.kind !== 'privacy')
      const privacySnapshot = result.snapshots.find((snapshot) => snapshot.kind === 'privacy')

      if (claimSnapshots.length) {
        setClaims(
          claimSnapshots
            .map((snapshot) => `=== SOURCE: ${snapshot.kindLabel} — ${snapshot.finalUrl} ===\n${snapshot.text}`)
            .join('\n\n'),
        )
        setClaimsSource(claimSnapshots.map((snapshot) => snapshot.finalUrl).join(', '))
      }
      if (privacySnapshot) {
        setPolicy(privacySnapshot.text)
        setPolicySource(privacySnapshot.finalUrl)
      }
      setFetchErrors(result.errors)
      setReadSummary(
        result.snapshots.map((snapshot) => ({
          kind: snapshot.kind,
          label: snapshot.kindLabel,
          kept: snapshot.chars,
          truncated: snapshot.truncated,
          prioritized: Boolean((snapshot as UrlSnapshot & FetchedClause).prioritized),
        })),
      )
      setFetchNote(
        result.snapshots.length
          ? `Read ${result.snapshots.length} page(s) and filled the boxes below. Edit anything clipped or missing.`
          : 'No page could be read. Paste the text below and run the audit anyway.',
      )
    } catch (caught) {
      setFetchNote((caught as Error).message)
    } finally {
      setFetching(false)
    }
  }

  const submit = async () => {
    setError(null)
    if (!company.trim()) {
      setError('Enter the company name.')
      return
    }
    if (claims.trim().length < MIN_CHARS) {
      setError(`Add at least ${MIN_CHARS} characters of public claims, or fetch the homepage above.`)
      return
    }
    if (policy.trim().length < MIN_CHARS) {
      setError(`Add at least ${MIN_CHARS} characters of privacy policy text, or fetch it above.`)
      return
    }
    setSubmitting(true)
    try {
      const diff = await createDiff({
        company: company.trim(),
        url: website.trim(),
        claims,
        policy,
        claimsSource: claimsSource.trim(),
        policySource: policySource.trim(),
      })
      navigate(`/diff/${diff.id}`)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="pt-10 pb-7 sm:pt-14">
        <Eyebrow tone="fire">Workflow 1 · Footprint &amp; policy</Eyebrow>
        <h1 className="display mt-3 max-w-[760px] text-balance text-[36px] sm:text-[48px]">
          What you promise, next to what you disclose.
        </h1>
        <p className="mt-4 max-w-[660px] text-pretty text-[16px] leading-[1.6] text-muted">
          Read the live homepage, product, pricing or trust page and the privacy policy, then grade every public
          claim against the disclosure behind it. Evidence is quoted verbatim, and each gap is mapped to the US
          framework a buyer will raise — with its 2026–2027 deadline.
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <Card tone="plain" className="p-5 sm:p-6">
          <h2 className="text-[16px] font-medium text-fg">1 · Who are we auditing</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Company name">
              {(props) => (
                <Input
                  {...props}
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder="Acme AI"
                  autoComplete="organization"
                />
              )}
            </Field>
            <Field label="Website" optional hint="Used in the report header and as the default source.">
              {(props) => (
                <Input
                  {...props}
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://acme.com"
                />
              )}
            </Field>
          </div>
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[16px] font-medium text-fg">2 · Fetch the live pages</h2>
            <span className="text-[13px] text-faint">optional — paste text instead if a site blocks bots</span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-faint">
            Public addresses only. Private and loopback hosts are blocked, redirects are bounded, each page has a
            10-second timeout and a hard byte cap. If a page needs JavaScript, paste it in step 3.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {(
              [
                ['homepage', 'Homepage', 'https://acme.com'],
                ['product', 'Product / pricing / trust', 'https://acme.com/security'],
                ['privacy', 'Privacy policy', 'https://acme.com/privacy'],
              ] as const
            ).map(([kind, label, placeholder]) => (
              <Field key={kind} label={label} optional>
                {(props) => (
                  <Input
                    {...props}
                    value={urls[kind]}
                    onChange={(event) => setUrls((current) => ({ ...current, [kind]: event.target.value }))}
                    placeholder={placeholder}
                    inputMode="url"
                  />
                )}
              </Field>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" loading={fetching} onClick={() => void fetchPages()}>
              <Globe className="size-4" aria-hidden />
              {fetching ? 'Reading pages…' : 'Fetch pages'}
            </Button>
            {fetchNote ? <span className="text-[13px] text-muted">{fetchNote}</span> : null}
          </div>
          {readSummary.length ? (
            <ul className="mt-2 flex flex-col gap-1 text-[12px] text-faint">
              {readSummary.map((item) => (
                <li key={item.kind} className="flex items-center gap-1.5">
                  <Filter className="size-3 shrink-0" aria-hidden />
                  <span>
                    {item.label}: {item.kept.toLocaleString()} chars kept ·{' '}
                    {item.truncated
                      ? item.prioritized
                        ? 'AI/policy clauses prioritised'
                        : 'opening kept; no high-signal clause past the cut'
                      : 'read in full'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {fetchErrors.length ? (
            <div className="mt-3 flex flex-col gap-2">
              {fetchErrors.map((item) => (
                <Notice key={item.kind} tone="error" title={`${item.kindLabel} could not be fetched`}>
                  {item.error}
                </Notice>
              ))}
            </div>
          ) : null}
        </Card>

        <Card tone="plain" className="p-5 sm:p-6">
          <h2 className="text-[16px] font-medium text-fg">3 · Evidence and audit</h2>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <Field label="Public claims" hint="Homepage, product, pricing and trust copy — the promises being made.">
              {(props) => (
                <Textarea
                  {...props}
                  value={claims}
                  onChange={(event) => setClaims(event.target.value)}
                  placeholder={'“Our AI reviews every application in seconds and delivers 100% unbiased decisions…”'}
                  className="min-h-[240px] font-mono text-[13px]"
                />
              )}
            </Field>
            <Field label="Privacy policy" hint="Paste the full policy, or the AI, data-sharing and retention sections.">
              {(props) => (
                <Textarea
                  {...props}
                  value={policy}
                  onChange={(event) => setPolicy(event.target.value)}
                  placeholder={'=== SOURCE: privacy policy — https://acme.com/privacy ===\nWe collect…'}
                  className="min-h-[240px] font-mono text-[13px]"
                />
              )}
            </Field>
          </div>
          {claimsSource || policySource ? (
            <div className="mt-3 flex flex-col gap-1 text-[12px] text-faint">
              {claimsSource ? <span className="truncate">Claims source: {claimsSource}</span> : null}
              {policySource ? <span className="truncate">Policy source: {policySource}</span> : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 text-[13px] text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void submit()} loading={submitting}>
              <Sparkles className="size-4" aria-hidden />
              {submitting ? 'Grading the footprint…' : 'Run footprint audit'}
            </Button>
            <span className="text-[13px] text-faint">
              Severity-rated gaps, verbatim evidence, mapped deadlines. About a minute.
            </span>
          </div>
        </Card>
      </div>
    </>
  )
}
