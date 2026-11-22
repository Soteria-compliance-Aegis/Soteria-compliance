import { cx } from '../lib/cx'

/** Aegis mark: a plasma ring around a shielded check. */
export function AegisMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('size-7', className)} aria-hidden>
      <defs>
        <linearGradient id="aegis-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd36b" />
          <stop offset="0.55" stopColor="#ff9a2e" />
          <stop offset="1" stopColor="#4f9dff" />
        </linearGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="13" ry="7" fill="none" stroke="url(#aegis-ring)" strokeWidth="1.6" transform="rotate(-22 16 16)" />
      <path d="M16 6.5l7 2.8v6.8c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V9.3l7-2.8z" fill="#0a0c11" stroke="#dce7ff" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12.6 16l2.5 2.5 4.5-4.9" fill="none" stroke="#ff9a2e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AegisLogo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <AegisMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Aegis</span>
    </span>
  )
}
