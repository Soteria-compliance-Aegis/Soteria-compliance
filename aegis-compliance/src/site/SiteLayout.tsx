import { ArrowUpRight, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { SoteriaLogo } from '../components/Brand'
import { cx } from '../lib/cx'
import { Link, useRawLocation } from '../lib/router'
import { FRAMEWORKS, NAV, SITE } from './content'

export function SiteLayout({ children }: { children: ReactNode }) {
  const { path } = useRawLocation()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <div className="site min-h-screen bg-bg text-fg">
      <a
        href="#main"
        className="sr-only rounded-control bg-ink px-5 py-2.5 text-[14px] font-medium text-cream focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70]"
      >
        Skip to content
      </a>
      <header
        className={cx(
          'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300',
          scrolled || open ? 'border-b border-line bg-bg/85 backdrop-blur-xl' : 'border-b border-transparent',
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="Soteria home">
            <SoteriaLogo />
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  'rounded-control px-3.5 py-2 text-[14px] transition-colors hover:bg-black/[0.06]',
                  path === item.href ? 'text-fg' : 'text-soft',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/#request"
              className="hidden h-10 items-center gap-1.5 rounded-control bg-ink px-5 text-[14px] font-medium text-cream transition-colors hover:bg-plasma hover:text-ink sm:inline-flex"
            >
              Request a scorecard
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
            <button
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="grid size-10 place-items-center rounded-control ring-1 ring-inset ring-line-strong lg:hidden"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        {open ? (
          <nav aria-label="Mobile" className="border-t border-line bg-bg px-5 pb-6 pt-3 lg:hidden">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="block border-b border-line py-3.5 text-[17px] text-fg">
                {item.label}
              </Link>
            ))}
            <Link href="/#request" className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-control bg-ink text-[15px] font-medium text-cream">
              Request a scorecard
            </Link>
          </nav>
        ) : null}
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>

      <footer className="border-t border-line bg-ink text-cream">
        <div className="mx-auto max-w-[1240px] px-5 pb-10 pt-16 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <SoteriaLogo tone="cream" />
              <p className="mt-5 max-w-[340px] text-[14px] leading-relaxed text-cream/65">{SITE.disclaimer}</p>
            </div>
            <FooterCol
              title="Product"
              links={[
                { label: 'Policy audit', href: '/#product' },
                { label: 'How it works', href: '/#how' },
                { label: 'Sample scorecard', href: '/sample' },
                { label: 'Pricing', href: '/#pricing' },
              ]}
            />
            <FooterCol title="Frameworks" links={FRAMEWORKS.map((f) => ({ label: f.short, href: `/frameworks/${f.slug}` }))} />
            <FooterCol
              title="Company"
              links={[
                { label: 'About', href: '/about' },
                { label: 'Security', href: '/security' },
                { label: 'Notes', href: '/blog' },
                { label: 'Request a scorecard', href: '/#request' },
                { label: 'Team login', href: '/admin' },
              ]}
            />
          </div>
          <p
            aria-hidden
            className="site-display mt-16 select-none text-[clamp(64px,17vw,230px)] leading-[0.8] text-cream/[0.07]"
          >
            Soteria
          </p>
          <div className="mt-6 flex flex-col gap-2 border-t border-cream/10 pt-6 text-[12.5px] text-cream/50 sm:flex-row sm:justify-between">
            <span>© {new Date().getFullYear()} Soteria. Technical AI risk assessment, not legal advice.</span>
            <span className="font-mono">Rule dates are verified by a human before any client report.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="eyebrow-mono text-cream/45">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-[14.5px] text-cream/80 transition-colors hover:text-plasma">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
