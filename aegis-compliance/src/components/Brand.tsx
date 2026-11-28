import { cx } from '../lib/cx'

/**
 * Soteria mark: an ink tile holding a cream ring that stays open at the top
 * right, closed by an orchid dot. The gap is the finding; the dot is the fix.
 */
export function SoteriaMark({ className, tone = 'ink' }: { className?: string; tone?: 'ink' | 'cream' }) {
  const tile = tone === 'ink' ? '#050505' : '#ece6dc'
  const ring = tone === 'ink' ? '#ece6dc' : '#050505'
  return (
    <svg viewBox="0 0 32 32" className={cx('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill={tile} />
      <path d="M22.6 9.4A9 9 0 1 0 25 16" fill="none" stroke={ring} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="22.4" cy="9.6" r="3.1" fill="#e65bc4" />
    </svg>
  )
}

export function SoteriaLogo({ className, tone = 'ink' }: { className?: string; tone?: 'ink' | 'cream' }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <SoteriaMark tone={tone} />
      <span className={cx('text-[19px] font-semibold leading-none tracking-[-0.03em]', tone === 'ink' ? 'text-fg' : 'text-cream')}>
        Soteria
      </span>
    </span>
  )
}
