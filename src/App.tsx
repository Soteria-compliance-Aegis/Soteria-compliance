import { useEffect, useRef } from 'react'

import { scrollToHash, useLocation } from './lib/router'
import { Workspace } from './pages/Workspace'

/*
  Three routes only. This app exists to upload policies, run audits and read
  the findings; nothing from the template's marketing site is shipped.
*/
const routes = [
  { path: '/', title: 'Overview', render: () => <Workspace view="overview" /> },
  { path: '/audit', title: 'Footprint audit', render: () => <Workspace view="footprint" /> },
  { path: '/diff/:id', title: 'Footprint audit', render: () => <Workspace view="diff" /> },
  { path: '/redteam', title: 'Red-team lab', render: () => <Workspace view="redteam" /> },
  { path: '/redteam/:id', title: 'Red-team report', render: () => <Workspace view="redteamRun" /> },
  { path: '/artifacts', title: 'Fix artifacts', render: () => <Workspace view="artifacts" /> },
  { path: '/artifacts/:id', title: 'Draft', render: () => <Workspace view="artifact" /> },
  { path: '/documents', title: 'Documents', render: () => <Workspace view="library" /> },
  { path: '/documents/:id', title: 'Audit', render: () => <Workspace view="document" /> },
  { path: '/monitoring', title: 'Monitoring', render: () => <Workspace view="monitoring" /> },
  { path: '/brief/:id', title: 'Mini-audit', render: () => <Workspace view="brief" /> },
  { path: '/console', title: 'Console', render: () => <Workspace view="console" /> },
]

function resolve(path: string) {
  const exact = routes.find((route) => route.path === path)
  if (exact) return exact
  const nested: [string, (typeof routes)[number]][] = [
    ['/documents/', routes[8]],
    ['/diff/', routes[2]],
    ['/redteam/', routes[4]],
    ['/artifacts/', routes[6]],
    ['/brief/', routes[9]],
  ]
  return nested.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null
}

export function App() {
  const { path, hash } = useLocation()
  const hit = resolve(path)
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  useEffect(() => {
    document.title = hit ? `${hit.title} | Soteria` : 'Not found | Soteria'
  }, [hit])

  // Jump to the hash target or the top, and move focus on real navigations.
  useEffect(() => {
    let raf = 0
    let tries = 0
    const run = () => {
      const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
      if (hash && !target && tries++ < 120) {
        raf = requestAnimationFrame(run)
        return
      }
      const isFirst = first.current
      first.current = false
      // A console launch link such as /#upload waits for its card, then jumps to
      // it; a plain navigation starts at the top. Never both — the smooth scroll
      // would win the animation and cancel the anchor jump.
      if (hash && target) scrollToHash(hash, false)
      else window.scrollTo({ top: 0 })
      if (!isFirst && !hash) main.current?.focus({ preventScroll: true })
    }
    raf = requestAnimationFrame(run)
    return () => cancelAnimationFrame(raf)
  }, [path, hash])

  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-control bg-white px-5 py-2.5 text-[14px] font-medium text-black focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70]"
      >
        Skip to content
      </a>
      <main id="main" ref={main} tabIndex={-1} className="outline-none">
        {hit ? hit.render() : <Workspace view="notFound" />}
      </main>
    </>
  )
}
