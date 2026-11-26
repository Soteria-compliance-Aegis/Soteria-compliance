import { cx } from '../lib/cx'

/**
 * Soteria mark: a light surveyor's ring around a shielded check, closing on
 * deep blue. Drawn from line and accent rather than a gradient logo.
 */
export function SoteriaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('size-7', className)} aria-hidden>
      <defs>
        <linearGradient id="soteria-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef2fa" />
          <stop offset="0.5" stopColor="#93a3bd" />
          <stop offset="1" stopColor="#4a72dd" />
        </linearGradient>
      </defs>
      <ellipse cx="16" cy="16" rx="13" ry="7" fill="none" stroke="url(#soteria-ring)" strokeWidth="1.5" transform="rotate(-22 16 16)" />
      <path d="M16 6.5l7 2.8v6.8c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V9.3l7-2.8z" fill="#0a0b0d" stroke="#dfe6f4" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M12.6 16l2.5 2.5 4.5-4.9" fill="none" stroke="#a9c1f5" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SoteriaLogo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <SoteriaMark />
      <span className="font-serif text-[20px] leading-none tracking-[-0.01em] text-fg">Soteria</span>
    </span>
  )
}
