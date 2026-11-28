import { useEffect, useRef } from 'react'

import { AdminShell } from './admin/AdminShell'
import { Dashboard } from './admin/Dashboard'
import { Leads } from './admin/Leads'
import { Login } from './admin/Login'
import { Prospects } from './admin/Prospects'
import { useAuth } from './lib/auth'
import { initAnalytics, trackPage } from './lib/analytics'
import { ADMIN_BASE, scrollToHash, useLocation, useRawLocation } from './lib/router'
import { NotFound } from './pages/NotFound'
import { Workspace } from './pages/Workspace'
import { SiteLayout } from './site/SiteLayout'
import { Home } from './site/Home'
import { AboutPage, BlogIndex, BlogPost, FrameworkDetail, FrameworksIndex, NotFoundPage, SamplePage, SecurityPage } from './site/Pages'

/*
  Two apps in one bundle. The public site lives at '/', the admin portal at
  '/admin' (sign-in required). Inside /admin the router hides the prefix, so
  the engine pages keep their original '/documents', '/audit', ... paths.
*/

function PublicSite() {
  const { path } = useRawLocation()
  let page = <NotFoundPage />
  if (path === '/') page = <Home />
  else if (path === '/frameworks') page = <FrameworksIndex />
  else if (path.startsWith('/frameworks/')) page = <FrameworkDetail slug={path.split('/')[2]} />
  else if (path === '/sample') page = <SamplePage />
  else if (path === '/about') page = <AboutPage />
  else if (path === '/security') page = <SecurityPage />
  else if (path === '/blog') page = <BlogIndex />
  else if (path.startsWith('/blog/')) page = <BlogPost slug={path.split('/')[2]} />
  return <SiteLayout>{page}</SiteLayout>
}

function titleFor(path: string): string {
  const map: [string, string][] = [
    ['/leads', 'Leads'],
    ['/prospects', 'Prospects'],
    ['/workbench', 'Workbench'],
    ['/documents', 'Documents'],
    ['/audit', 'Footprint audit'],
    ['/diff', 'Footprint audit'],
    ['/redteam', 'Red-team lab'],
    ['/artifacts', 'Fix artifacts'],
    ['/monitoring', 'Monitoring'],
    ['/brief', 'Mini-audit'],
    ['/console', 'Console'],
  ]
  return map.find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? 'Dashboard'
}

function AdminView({ path }: { path: string }) {
  if (path === '/') return <Dashboard />
  if (path === '/leads') return <Leads />
  if (path === '/prospects') return <Prospects />
  if (path === '/workbench') return <Workspace view="overview" />
  if (path === '/documents') return <Workspace view="library" />
  if (path.startsWith('/documents/')) return <Workspace view="document" />
  if (path === '/audit') return <Workspace view="footprint" />
  if (path.startsWith('/diff/')) return <Workspace view="diff" />
  if (path === '/redteam') return <Workspace view="redteam" />
  if (path.startsWith('/redteam/')) return <Workspace view="redteamRun" />
  if (path === '/artifacts') return <Workspace view="artifacts" />
  if (path.startsWith('/artifacts/')) return <Workspace view="artifact" />
  if (path === '/monitoring') return <Workspace view="monitoring" />
  if (path.startsWith('/brief/')) return <Workspace view="brief" />
  if (path === '/console') return <Workspace view="console" />
  return <NotFound />
}

function AdminApp() {
  const { user, loading, check } = useAuth()
  const { path } = useLocation()
  useEffect(() => check(), [check])
  useEffect(() => {
    document.title = user ? `${titleFor(path)} | Soteria admin` : 'Sign in | Soteria admin'
  }, [path, user])
  if (loading) return <div className="grid min-h-screen place-items-center bg-bg text-[14px] text-muted">Loading…</div>
  if (!user) return <Login />
  return (
    <AdminShell>
      <main id="main" tabIndex={-1} className="outline-none">
        <AdminView path={path} />
      </main>
    </AdminShell>
  )
}

export function App() {
  const { path, hash } = useRawLocation()
  const isAdmin = path === ADMIN_BASE || path.startsWith(ADMIN_BASE + '/')
  const first = useRef(true)

  useEffect(() => {
    void initAnalytics()
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      trackPage(path)
      if (!/^\/(frameworks|blog)\//.test(path) || path === '/') {
        /* keep the default title from index.html on the home page */
      }
      const names: Record<string, string> = { '/frameworks': 'Frameworks', '/sample': 'Sample scorecard', '/about': 'About', '/security': 'Security', '/blog': 'Notes' }
      document.title = names[path] ? `${names[path]} | Soteria` : 'Soteria | Pass enterprise AI review in days, not quarters'
    }
  }, [path, isAdmin])

  // Jump to the hash target or the top on navigation.
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
      if (hash && target) scrollToHash(hash, !isFirst)
      else window.scrollTo({ top: 0 })
    }
    raf = requestAnimationFrame(run)
    return () => cancelAnimationFrame(raf)
  }, [path, hash])

  return isAdmin ? <AdminApp /> : <PublicSite />
}
