import { useEffect, useState } from 'react'
import * as authService from '../lib/authService'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false

    authService.getSession().then(({ data }) => {
      if (ignore) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = authService.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
      },
    )

    return () => {
      ignore = true
      listener.subscription.unsubscribe()
    }
  }, [])

  async function signIn(identifier, password) {
    await authService.signInWithIdentifier(identifier, password)
  }

  async function signOut() {
    await authService.signOut()
  }

  return {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signOut,
  }
}
