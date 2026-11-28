import { forwardRef, useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes, MouseEvent } from 'react'

/*
  A tiny History API router. `useLocation()` re-renders on navigation,
  `navigate()` pushes a URL, and `<Link>` turns same-origin clicks into
  navigations (modifier clicks and external URLs behave like normal links).
  The Worker serves index.html for every unknown path (SPA mode), so deep
  links and reloads land on the right page.
*/

const EVENT = 'aegis:navigate'

export type Location = { path: string; hash: string; search: string }

/*
  The admin portal lives under /admin. Pages inside it are written with plain
  paths ('/documents', '/audit', ...), so inside /admin the router strips the
  prefix when reading the location and adds it back when linking or
  navigating. Public pages use `useRawLocation()` and are never rewritten.
*/
export const ADMIN_BASE = '/admin'
const underAdmin = (path: string) => path === ADMIN_BASE || path.startsWith(ADMIN_BASE + '/')
const stripAdmin = (path: string) => (underAdmin(path) ? path.slice(ADMIN_BASE.length) || '/' : path)

/** Inside the admin tree, turn an app path into its real /admin URL. */
export function adminHref(href: string): string {
  if (typeof window === 'undefined' || !underAdmin(window.location.pathname)) return href
  if (!href.startsWith('/') || href.startsWith('//') || underAdmin(href.split(/[?#]/)[0])) return href
  return ADMIN_BASE + (href === '/' ? '' : href)
}

function normalise(path: string) {
  const p = path.replace(/\/+$/, '')
  return p === '' ? '/' : p
}

let cached: Location | null = null
function snapshot(): Location {
  const next = { path: normalise(window.location.pathname), hash: window.location.hash, search: window.location.search }
  if (!cached || cached.path !== next.path || cached.hash !== next.hash || cached.search !== next.search) cached = next
  return cached
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(EVENT, cb)
  }
}

/** The real browser location. */
export function useRawLocation(): Location {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** The location as admin pages see it: '/admin/leads' reads as '/leads'. */
export function useLocation(): Location {
  const raw = useRawLocation()
  return underAdmin(raw.path) ? { ...raw, path: stripAdmin(raw.path) } : raw
}

export function navigate(to: string, { replace = false, site = false }: { replace?: boolean; site?: boolean } = {}) {
  const url = new URL(site ? to : adminHref(to), window.location.href)
  const same = url.pathname === window.location.pathname && url.search === window.location.search
  if (same && url.hash === window.location.hash) {
    // Same URL: just re-run the scroll (e.g. clicking the active nav link).
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { scroll: true } }))
    scrollToHash(url.hash, true)
    return
  }
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash)
  window.dispatchEvent(new Event(EVENT))
}

export function scrollToHash(hash: string, smooth = true) {
  if (!hash) {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    return
  }
  const el = document.getElementById(decodeURIComponent(hash.slice(1)))
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : ('instant' as ScrollBehavior), block: 'start' })
}

/** Match `/blog/:slug`-style patterns. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean)
  const b = path.split('/').filter(Boolean)
  if (a.length !== b.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i])
    else if (a[i] !== b[i]) return null
  }
  return params
}

/** True when `href` points at the current page (ignoring the hash). */
export function isCurrent(href: string, path: string, { exact = false } = {}) {
  const target = normalise(href.split('#')[0].split('?')[0] || path)
  if (exact || target === '/') return target === path
  return path === target || path.startsWith(target + '/')
}

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; site?: boolean }

/** `site` opts out of the admin prefix: the link goes to the public site. */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, onClick, target, site = false, ...rest }, ref) {
  const internal = href.startsWith('/') || href.startsWith('#')
  const resolved = site ? href : adminHref(href)
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || !internal || target === '_blank') return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(resolved.startsWith('#') ? window.location.pathname + resolved : resolved, { site: true })
  }
  return <a ref={ref} href={resolved} target={target} onClick={handle} {...rest} />
})
