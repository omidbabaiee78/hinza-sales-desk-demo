import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات پروفایل. لطفاً دوباره تلاش کنید.'
}

function fetchProfile(userId) {
  return supabase.from('profiles').select('*').eq('id', userId).single()
}

function fetchMembership(userId) {
  return supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .maybeSingle()
}

function fetchCompany(companyId) {
  return supabase.from('companies').select('*').eq('id', companyId).maybeSingle()
}

const MAX_NOT_FOUND_RETRIES = 5
const RETRY_DELAY_MS = 700

// Right after registration there is a brief window where the auth session
// exists but the profiles row has not finished being written yet. We retry
// a few times on "not found" before surfacing an error.
export function useProfile(userId) {
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false
    let attempt = 0

    function resolveCompanyThen(profileData) {
      if (profileData.role === 'customer' && profileData.approval_status === 'approved') {
        fetchMembership(userId).then(({ data: membership }) => {
          if (ignore) return
          if (!membership) {
            setCompany(null)
            setLoading(false)
            return
          }
          fetchCompany(membership.company_id).then(({ data: companyData }) => {
            if (ignore) return
            setCompany(companyData ?? null)
            setLoading(false)
          })
        })
      } else {
        setCompany(null)
        setLoading(false)
      }
    }

    function attemptFetch() {
      fetchProfile(userId).then(({ data, error: profileError }) => {
        if (ignore) return
        if (profileError) {
          if (profileError.code === 'PGRST116' && attempt < MAX_NOT_FOUND_RETRIES) {
            attempt += 1
            setTimeout(() => {
              if (!ignore) attemptFetch()
            }, RETRY_DELAY_MS)
            return
          }
          setError(translateDbError(profileError.message))
          setProfile(null)
          setCompany(null)
          setLoading(false)
          return
        }
        setError('')
        setProfile(data)
        resolveCompanyThen(data)
      })
    }

    attemptFetch()

    return () => {
      ignore = true
    }
  }, [userId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { profile, company, loading, error, refresh }
}
