import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت پرداخت‌ها. لطفاً دوباره تلاش کنید.'
}

function fetchPayments(companyId) {
  return supabase
    .from('payments')
    .select('*')
    .eq('company_id', companyId)
    .order('paid_at', { ascending: false })
}

export function useCompanyPayments(companyId) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    fetchPayments(companyId).then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setPayments(data)
      }
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

  return { payments, loading: companyId ? loading : false, error, refresh }
}
