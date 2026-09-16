import { useEffect, useState } from 'react'
import * as authService from '../lib/authService'
import { toE164Iran } from '../utils/phone'

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

  async function signIn(phone, password) {
    await authService.signInWithPhone(toE164Iran(phone), password)
  }

  async function signUp(phone, password) {
    return authService.signUpWithPhone(toE164Iran(phone), password)
  }

  async function signOut() {
    await authService.signOut()
  }

  return {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signUp,
    signOut,
  }
}
