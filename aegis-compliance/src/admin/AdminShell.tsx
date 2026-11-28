import {
  Activity,
  BarChart3,
  Bug,
  FileSearch,
  FileText,
  Globe,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  SlidersHorizontal,
  Target,
  Wrench,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import { SoteriaLogo } from '../components/Brand'
import { useAuth } from '../lib/auth'
import { cx } from '../lib/cx'
import { Link, useLocation } from '../lib/router'

type Item = { label: string; href: string; icon: LucideIcon; match?: string[] }
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Business',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
      { label: 'Leads', href: '/leads', icon: Inbox },
      { label: 'Prospects', href: '/prospects', icon: Target },
    ],
  },
  {
    title: 'Audit engine',
    items: [
      { label: 'Workbench', href: '/workbench', icon: BarChart3, match: ['/brief'] },
      { label: 'Documents', href: '/documents', icon: FileText },
      { label: 'Footprint audit', href: '/audit', icon: Globe, match: ['/diff'] },
      { label: 'Red-team lab', href: '/redteam', icon: Bug },
      { label: 'Fix artifacts', href: '/artifacts', icon: Wrench },
      { label: 'Monitoring', href: '/monitoring', icon: Radar },
      { label: 'Console', href: '/console', icon: SlidersHorizontal },
    ],
  },
]

function isActive(item: Item, path: string) {
  if (item.href === '/') return path === '/'
  return [item.href, ...(item.match ?? [])].some((h) => path === h || path.startsWith(h + '/'))
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const { path } = useLocation()
  const [open, setOpen] = useState(false)

  const nav = (
    <nav aria-label="Admin" className="flex-1 space-y-7 overflow-y-auto px-3 pb-6">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="eyebrow-mono px-3 pb-2 text-cream/40">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(item, path)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex h-10 items-center gap-3 rounded-xl px-3 text-[14.5px] transition-colors',
                      active ? 'bg-cream text-ink' : 'text-cream/75 hover:bg-cream/10 hover:text-cream',
                    )}
                  >
                    <item.icon className={cx('size-[18px]', active && 'text-[#a3208a]')} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('')

  return (
    <div className="min-h-screen bg-bg lg:grid lg:grid-cols-[256px_1fr]">
      {/* Sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen flex-col bg-ink py-5 lg:flex">
        <div className="px-6 pb-7 pt-1">
          <Link href="/" aria-label="Dashboard">
            <SoteriaLogo tone="cream" />
          </Link>
        </div>
        {nav}
        <div className="mx-3 rounded-2xl bg-cream/[0.07] p-4">
          <p className="eyebrow-mono text-cream/40">Reminder</p>
          <p className="mt-2 text-[12.5px] leading-snug text-cream/65">A human verifies every quote and rule date before a report reaches a client.</p>
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-ink py-5">
            <div className="flex items-center justify-between px-6 pb-6">
              <SoteriaLogo tone="cream" />
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-cream">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b border-line bg-bg/85 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-full ring-1 ring-inset ring-line-strong lg:hidden">
              <Menu className="size-5" />
            </button>
            <span className="hidden items-center gap-2 text-[13px] text-muted sm:flex">
              <Activity className="size-4 text-[#a3208a]" aria-hidden /> Soteria admin portal
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" site className="hidden h-10 items-center gap-2 rounded-control px-4 text-[14px] text-soft ring-1 ring-inset ring-line-strong hover:bg-black/[0.05] sm:inline-flex">
              <FileSearch className="size-4" aria-hidden /> View site
            </Link>
            <div className="flex items-center gap-2.5 rounded-control bg-surface py-1 pl-1 pr-3 ring-1 ring-inset ring-line">
              <span className="grid size-8 place-items-center rounded-full bg-ink text-[12px] font-medium text-cream">{initials}</span>
              <span className="hidden text-[13.5px] sm:block">{user?.name || user?.email}</span>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="grid size-10 place-items-center rounded-full text-soft ring-1 ring-inset ring-line-strong hover:bg-black/[0.05]"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}

export function PageTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-6 pt-8 sm:px-8">
      <div>
        {eyebrow ? <p className="eyebrow-mono text-faint">{eyebrow}</p> : null}
        <h1 className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.035em] sm:text-[44px]">{title}</h1>
      </div>
      {action}
    </div>
  )
}
