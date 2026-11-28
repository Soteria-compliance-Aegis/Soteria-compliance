import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

/*
  Report sheets. A finding report is a document, not a card: it sits on the
  ink ground as a dark sheet with a ruled header, serif title and mono
  metadata, so it belongs to the workspace instead of punching a white hole
  in it. Print flattens it to paper (see the @media print block in
  styles.css); keep all colours token-based so that flip keeps working.
*/
export function Sheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <article
      className={cx(
        'brief-paper sheet mx-auto max-w-[880px] rounded-card px-6 py-8 text-soft sm:px-10 sm:py-11',
        className,
      )}
    >
      {children}
    </article>
  )
}

export type SheetMetaItem = { label: string; value: ReactNode }

export function SheetHeader({
  title,
  tag = 'Technical readiness check',
  meta,
}: {
  title: ReactNode
  tag?: ReactNode
  meta?: SheetMetaItem[]
}) {
  return (
    <header className="border-b border-line-strong pb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-mono text-[11px]">
        <span className="text-brass-text">{tag}</span>
        <span className="text-faint">Not legal advice</span>
      </div>
      <h1 className="display mt-2.5 text-[27px] leading-[1.08] text-fg sm:text-[32px]">{title}</h1>
      {meta?.length ? (
        <dl className="mt-4 grid gap-x-8 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
          {meta.map((item) => (
            <div key={item.label} className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-faint">{item.label}</dt>
              <dd className="min-w-0 text-soft">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  )
}

export function SheetHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('font-serif text-[19px] leading-snug text-fg', className)}>{children}</h2>
}

/** A clause in a sheet: index, title and an optional mark on one line. */
export function ClauseTitle({ index, title, mark }: { index: number; title: ReactNode; mark?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
      <span className="font-mono text-[11.5px] tabular-nums text-brass-text">{String(index).padStart(2, '0')}</span>
      <h3 className="min-w-0 text-[14px] font-medium leading-snug text-fg">{title}</h3>
      {mark}
    </div>
  )
}

const markTones = {
  pass: 'bg-pass/10 text-pass ring-pass/30',
  warn: 'bg-warn/10 text-warn ring-warn/30',
  fail: 'bg-fail/10 text-fail ring-fail/35',
  neutral: 'bg-black/[0.05] text-muted ring-line-strong',
}

export function Mark({ tone = 'neutral', children, className }: { tone?: keyof typeof markTones; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1.5 rounded-control px-2.5 font-mono text-[10.5px] ring-1 ring-inset',
        markTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function SheetNote({ children }: { children: ReactNode }) {
  return (
    <>
      <hr className="my-6 border-line" />
      <p className="text-[11.5px] italic leading-relaxed text-faint">{children}</p>
    </>
  )
}

/** Small mono label for a field inside a clause. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11px] text-faint">{children}</span>
}
