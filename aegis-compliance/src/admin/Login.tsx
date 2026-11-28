import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { SoteriaLogo } from '../components/Brand'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'

export function Login() {
  const { signIn } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      await signIn(String(f.get('email') ?? ''), String(f.get('password') ?? ''))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const input =
    'h-12 w-full rounded-field bg-raised px-4 text-[15px] text-fg outline-none ring-1 ring-inset ring-line-strong transition-shadow placeholder:text-faint focus:ring-2 focus:ring-ink'

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col justify-between p-6 sm:p-10">
        <Link href="/" site aria-label="Back to the Soteria site">
          <SoteriaLogo />
        </Link>
        <form onSubmit={submit} className="mx-auto w-full max-w-[380px] py-16">
          <h1 className="site-display text-[52px]">Team sign in</h1>
          <p className="mt-3 text-[15px] text-muted">The Soteria admin portal is limited to the founding team.</p>
          <label className="mt-8 grid gap-1.5">
            <span className="text-[13px] text-soft">Email</span>
            <input name="email" type="email" required autoComplete="username" className={input} />
          </label>
          <label className="mt-4 grid gap-1.5">
            <span className="text-[13px] text-soft">Password</span>
            <input name="password" type="password" required autoComplete="current-password" className={input} />
          </label>
          {error ? <p role="alert" className="mt-4 text-[14px] text-fail">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-6 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-control bg-ink text-[16px] font-medium text-cream transition-colors hover:bg-plasma hover:text-ink disabled:opacity-60"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            Sign in
          </button>
        </form>
        <p className="font-mono text-[11px] text-faint">Technical AI risk assessment, not legal advice.</p>
      </div>
      <div aria-hidden className="relative hidden overflow-hidden bg-ink lg:block">
        <div className="absolute -right-24 top-1/4 size-[520px] rounded-full bg-plasma/45 blur-[110px]" />
        <p className="site-display absolute bottom-10 left-10 right-10 text-[clamp(60px,9vw,130px)] leading-[0.85] text-cream">
          Evidence,<br />
          <span className="text-plasma">not theatre.</span>
        </p>
      </div>
    </div>
  )
}
