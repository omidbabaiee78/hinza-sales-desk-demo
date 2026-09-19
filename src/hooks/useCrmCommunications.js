import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { logCrmCommunication } from '../services/crmCommunications'

function isMissingTableError(message) {
  return Boolean(message && message.includes('does not exist'))
}

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  if (isMissingTableError(message)) {
    return 'تاریخچه ارتباط CRM هنوز در پایگاه داده ایجاد نشده است.'
  }
  return 'خطا در دریافت تاریخچه ارتباط. لطفاً دوباره تلاش کنید.'
}

function fetchCommunications(companyId) {
  return supabase
    .from('crm_communications')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
}

// Per-company communication history for the CRM 360 profile. Degrades
// gracefully (schemaMissing=true) until the crm_communications migration has
// been applied - it never fakes rows or falls back to localStorage.
export function useCrmCommunications(companyId) {
  const [communications, setCommunications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    fetchCommunications(companyId).then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setSchemaMissing(isMissingTableError(loadError.message))
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setSchemaMissing(false)
        setCommunications(data || [])
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

  async function logCommunication(payload) {
    setSubmitting(true)
    try {
      await logCrmCommunication({ companyId, ...payload })
      refresh()
    } catch (err) {
      throw new Error(translateDbError(err.message), { cause: err })
    } finally {
      setSubmitting(false)
    }
  }

  return {
    communications,
    loading: companyId ? loading : false,
    error,
    schemaMissing,
    refresh,
    logCommunication,
    submitting,
  }
}
