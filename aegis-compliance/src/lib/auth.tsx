import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import * as api from './portal'
import type { User } from './portal'

type AuthState = {
  user: User | null
  /** true until the first /api/auth/me answer arrives */
  loading: boolean
  /** ask the server who is signed in (once); the admin app calls this on mount */
  check: () => void
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const asked = useRef(false)

  // The public site never needs a session, so /api/auth/me is only asked for
  // when the admin app mounts.
  const check = useCallback(() => {
    if (asked.current) return
    asked.current = true
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password)
    setUser(r.user)
  }, [])
  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(() => ({ user, loading, check, signIn, signOut }), [user, loading, check, signIn, signOut])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
