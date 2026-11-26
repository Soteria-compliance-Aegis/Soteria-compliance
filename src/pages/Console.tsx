/*
  Direction, "Control bench"

  Product: the two founders' internal bench for routing the audit engine and
  opening any tool without hunting the workspace.
  Character: instrument panel, exact, unhurried.
  World: a calibration bench of dark steel, engraved mono labels, brass rules.
  Moments: the two model channels and the segmented token meter.
  Signature: numbered bays (01 to 05) with a dotted leader out to the record count.
  Refused: gradient text, glass panels, icon cards in threes, rows of stat cards.
*/
import { useCallback, useEffect, useState } from 'react'

import { Button } from '../components/Button'
import { Notice, Skeleton } from '../components/Controls'
import { Input, Select } from '../components/Field'
import { formatWhen } from '../lib/aegis'
import { cx } from '../lib/cx'
import { fetchConsole, saveModels } from '../lib/console'
import type { ConsoleData, ConsoleTool, ModelEntry } from '../lib/console'
import { Link } from '../lib/router'

const CUSTOM = '__custom'
const METER_TICKS = 40

/** A ruled scale, not a progress bar: one tick per 2.5% of the minute's budget. */
function Meter({ used, total }: { used: number; total: number }) {
  const filled = total > 0 ? Math.round((used / total) * METER_TICKS) : 0
  const hot = filled >= METER_TICKS * 0.8
  return (
    <div
      className="mt-3 flex h-9 items-end gap-[3px]"
      role="img"
      aria-label={`${used.toLocaleString()} of ${total.toLocaleString()} tokens used in the current minute`}
    >
      {Array.from({ length: METER_TICKS }, (_, index) => (
        <span
          key={index}
          className={cx(
            'flex-1 rounded-[1px]',
            index % 5 === 0 ? 'h-9' : 'h-5',
            index < filled ? (hot ? 'bg-fire-2' : 'bg-plasma') : 'bg-white/[0.07]',
          )}
        />
      ))}
    </div>
  )
}

function Channel({
  role,
  hint,
  value,
  catalog,
  budgetTpm,
  onChange,
}: {
  role: string
  hint: string
  value: string
  catalog: ModelEntry[]
  budgetTpm: number
  onChange: (next: string) => void
}) {
  const entry = catalog.find((model) => model.id === value)
  return (
    <div className="grid gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
      <div>
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">{role}</p>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{hint}</p>
      </div>
      <div>
        <Select
          aria-label={role}
          value={entry ? value : CUSTOM}
          onChange={(event) => onChange(event.target.value === CUSTOM ? '' : event.target.value)}
        >
          {catalog.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · {model.id}
            </option>
          ))}
          <option value={CUSTOM}>Custom model id…</option>
        </Select>
        {entry ? null : (
          <Input
            className="mt-2 font-mono text-[13px]"
            aria-label={`${role} custom model id`}
            value={value}
            placeholder="openai/gpt-oss-120b"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
          <span>{entry ? entry.tier : 'unverified id'}</span>
          <span>{entry ? `${entry.tpm.toLocaleString()} TPM free` : 'check it in the Groq console'}</span>
          {entry && entry.tpm < budgetTpm ? (
            <span className="text-fire-3">below the {budgetTpm.toLocaleString()} TPM engine budget</span>
          ) : null}
        </p>
        {entry ? <p className="mt-1 text-[12px] leading-snug text-muted">{entry.note}</p> : null}
      </div>
    </div>
  )
}

function ToolRow({ tool }: { tool: ConsoleTool }) {
  return (
    <li>
      <Link href={tool.href} className="group flex items-baseline gap-3 border-t border-line py-3.5">
        <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-faint">{tool.index}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="shrink-0 text-[15px] font-medium text-fg group-hover:text-ice">{tool.title}</span>
            <span aria-hidden className="mb-[3px] hidden min-w-6 flex-1 border-b border-dotted border-line-strong sm:block" />
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{tool.records.count} on file</span>
          </span>
          <span className="mt-1 block text-[12.5px] leading-snug text-muted">{tool.purpose}</span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-brass-text group-hover:text-ice">
          {tool.action} <span aria-hidden>→</span>
        </span>
      </Link>
    </li>
  )
}

export function Console() {
  const [data, setData] = useState<ConsoleData | null>(null)
  const [deep, setDeep] = useState('')
  const [fast, setFast] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchConsole()
      setData(next)
      setDeep(next.models.deep)
      setFast(next.models.fast)
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const apply = async () => {
    setSaving(true)
    try {
      const next = await saveModels({ deep: deep.trim(), fast: fast.trim() })
      setData(next)
      setDeep(next.models.deep)
      setFast(next.models.fast)
      setSavedAt(next.checkedAt)
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        <p className="font-mono text-[10.5px] tracking-[0.16em] text-faint uppercase">Aegis bench, internal</p>
        <h1 className="display mt-2 text-[36px] sm:text-[44px]">Control bench</h1>
        <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-muted">
          Route the engine, open a tool, read what ran. Two people, one bench, no client view.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/documents" className="font-mono text-[11.5px] text-brass-text hover:text-ice">
          All documents <span aria-hidden>→</span>
        </Link>
        <Button variant="ghost" size="sm" loading={loading} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
    </div>
  )

  if (!data) {
    return (
      <div className="pt-10">
        {header}
        {error ? (
          <Notice tone="error" title="Console unavailable" className="mt-4">
            {error}. Start the API with <span className="font-mono">python server.py</span>.
          </Notice>
        ) : null}
        {loading ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-[180px] w-full" />
            <Skeleton className="h-[220px] w-full" />
          </div>
        ) : null}
      </div>
    )
  }

  const dirty = deep !== data.models.deep || fast !== data.models.fast
  const complete = deep.trim().length > 0 && fast.trim().length > 0
  const budget = data.budget
  const rail: { label: string; value: string; dot?: boolean }[] = [
    { label: 'API', value: 'online', dot: true },
    { label: 'Groq key', value: data.keyConfigured ? 'set' : 'missing' },
    { label: 'Token window', value: `${budget.used.toLocaleString()} / ${budget.tpm.toLocaleString()}` },
    { label: 'Checked', value: formatWhen(data.checkedAt) },
  ]

  return (
    <div className="pt-10">
      {header}

      {error ? (
        <Notice tone="error" title="The last request failed" className="mt-4">
          {error}
        </Notice>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 border-y border-line sm:grid-cols-4">
        {rail.map((item) => (
          <div key={item.label} className="border-r border-line px-4 py-3 last:border-r-0">
            <dt className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">{item.label}</dt>
            <dd className="mt-1 flex items-center gap-1.5 font-mono text-[12px] tabular-nums text-soft">
              {item.dot ? <span className="round size-1.5 shrink-0 rounded-full bg-success" aria-hidden /> : null}
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="depth relative rounded-card bg-surface p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">Model routing</h2>
            <span className="font-mono text-[11px] text-faint">{data.models.catalog.length} in catalogue</span>
          </div>
          <p className="mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted">
            The choice applies to every Groq call made after you save. A run already in flight may finish on the
            previous model.
          </p>

          <div className="mt-5 space-y-5">
            <Channel
              role="Deep grading"
              hint="Rubric grading, remediation copy, diffs, drafts and verdicts."
              value={deep}
              catalog={data.models.catalog}
              budgetTpm={data.models.budgetTpm}
              onChange={setDeep}
            />
            <Channel
              role="Fast screening"
              hint="Page classification before a deep audit. Small and cheap."
              value={fast}
              catalog={data.models.catalog}
              budgetTpm={data.models.budgetTpm}
              onChange={setFast}
            />
          </div>

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[12px] text-faint">
              {complete
                ? savedAt
                  ? `Routing applied ${formatWhen(savedAt)}.`
                  : 'A saved choice survives a server restart.'
                : 'Both channels need a model id.'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!dirty || saving}
                onClick={() => {
                  setDeep(data.models.defaults.deep)
                  setFast(data.models.defaults.fast)
                }}
              >
                Reset
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                disabled={!dirty || !complete}
                onClick={() => void apply()}
              >
                Apply routing
              </Button>
            </div>
          </footer>
        </section>

        <aside className="depth relative rounded-card bg-surface p-5 sm:p-6">
          <h2 className="font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">Token window</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            One sliding minute shared by every audit, brief, diff, probe and draft in this process.
          </p>

          <div className="mt-5 flex items-baseline justify-between font-mono tabular-nums">
            <span className="text-[30px] leading-none text-fg">{budget.used.toLocaleString()}</span>
            <span className="text-[11.5px] text-faint">of {budget.tpm.toLocaleString()} TPM</span>
          </div>
          <Meter used={budget.used} total={budget.tpm} />
          <div className="mt-2 flex justify-between font-mono text-[11px] text-faint">
            <span>{budget.remaining.toLocaleString()} left</span>
            <span>{budget.resetsInSeconds > 0 ? `resets in ${Math.ceil(budget.resetsInSeconds)}s` : 'window empty'}</span>
          </div>

          <dl className="mt-6 border-t border-line pt-3">
            {[
              { label: 'Upload cap', value: `${Math.round(data.limits.maxUploadBytes / (1024 * 1024))} MB` },
              { label: 'Text per document', value: `${data.limits.maxChars.toLocaleString()} chars` },
              { label: 'Red-team probes', value: String(data.limits.redteamProbes) },
              { label: 'Rubrics', value: String(data.limits.rubrics) },
              { label: 'Artifact kinds', value: String(data.limits.artifactKinds) },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-0"
              >
                <dt className="text-[12.5px] text-muted">{row.label}</dt>
                <dd className="font-mono text-[11.5px] tabular-nums text-soft">{row.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <section className="depth relative mt-2 rounded-card bg-surface p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">Tool bench</h2>
          <span className="font-mono text-[11px] text-faint">{data.tools.length} tools</span>
        </div>
        <ul className="mt-4">
          {data.tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </ul>
      </section>

      <section className="depth relative mt-2 rounded-card bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-mono text-[10.5px] tracking-[0.14em] text-faint uppercase">Run ledger</h2>
          <p className="text-[12px] text-faint">Newest first, every stored run across the bench.</p>
        </div>

        {data.activity.length === 0 ? (
          <p className="mt-4 border-t border-line pt-4 text-[13px] text-muted">
            Nothing has run yet. Start with a policy audit.
          </p>
        ) : (
          <div className="-mx-5 mt-3 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[680px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-faint uppercase">
                  <th scope="col" className="py-2 pl-5 pr-3 font-normal sm:pl-6">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Tool
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Record
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    State
                  </th>
                  <th scope="col" className="py-2 pl-3 pr-5 text-right font-normal sm:pr-6">
                    Open
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.activity.map((item) => (
                  <tr key={`${item.kind}-${item.id}`} className="border-b border-line last:border-0">
                    <td className="py-2.5 pl-5 pr-3 font-mono text-[11.5px] tabular-nums whitespace-nowrap text-faint sm:pl-6">
                      {formatWhen(item.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted">{item.kind}</td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={item.href}
                        className="text-soft underline-offset-4 hover:text-ice hover:underline"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{item.detail}</td>
                    <td className="py-2.5 pl-3 pr-5 text-right sm:pr-6">
                      <Link href={item.href} aria-label={`Open ${item.kind} ${item.title}`} className="font-mono text-[11px] text-brass-text hover:text-ice">
                        →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
