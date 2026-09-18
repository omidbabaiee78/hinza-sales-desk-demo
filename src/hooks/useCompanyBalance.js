import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت مانده حساب. لطفاً دوباره تلاش کنید.'
}

// Always calls the database RPC fresh - the balance is never cached or
// recomputed from account_entries in the frontend.
export function useCompanyBalance(companyId) {
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    supabase
      .rpc('company_balance_rial', { p_company_id: companyId })
      .then(({ data, error: rpcError }) => {
        if (ignore) return
        if (rpcError) {
          setError(translateDbError(rpcError.message))
          setLoading(false)
          return
        }
        setError('')
        setBalance(Number(data) || 0)
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [companyId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { balance, loading: companyId ? loading : false, error, refresh }
}
