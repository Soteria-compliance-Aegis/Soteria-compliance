import { useEffect, useRef } from 'react'

import { useLocation } from './lib/router'
import { NotFound } from './pages/NotFound'
import { Workspace } from './pages/Workspace'

/*
  Three routes only. This app exists to upload policies, run audits and read
  the findings; nothing from the template's marketing site is shipped.
*/
const routes = [
  { path: '/', title: 'Overview', render: () => <Workspace view="overview" /> },
  { path: '/documents', title: 'Documents', render: () => <Workspace view="library" /> },
  { path: '/documents/:id', title: 'Audit', render: () => <Workspace view="document" /> },
]

function resolve(path: string) {
  const exact = routes.find((route) => route.path === path)
  if (exact) return exact
  return path.startsWith('/documents/') ? routes[2] : null
}

export function App() {
  const { path, hash } = useLocation()
  const hit = resolve(path)
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  useEffect(() => {
    document.title = hit ? `${hit.title} | Aegis` : 'Not found | Aegis'
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
      window.scrollTo({ top: 0 })
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
        {hit ? hit.render() : <NotFound />}
      </main>
    </>
  )
}
