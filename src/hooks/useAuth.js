import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateAuthError(message) {
  const map = {
    'Invalid login credentials': 'ایمیل یا رمز عبور اشتباه است.',
    'User already registered': 'کاربری با این ایمیل قبلاً ثبت‌نام کرده است.',
    'Email not confirmed': 'ایمیل شما هنوز تأیید نشده است.',
    'Password should be at least 6 characters':
      'رمز عبور باید حداقل ۶ کاراکتر باشد.',
  }
  return map[message] || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
}

export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
      },
    )

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw new Error(translateAuthError(error.message))
  }

  async function signUp(email, password) {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw new Error(translateAuthError(error.message))
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(translateAuthError(error.message))
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
