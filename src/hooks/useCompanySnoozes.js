import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { snoozeCompanyAttention } from '../services/crmSnoozes'

function isMissingTableError(message) {
  return Boolean(message && message.includes('does not exist'))
}

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  if (isMissingTableError(message)) {
    return 'یادآوری CRM هنوز در پایگاه داده ایجاد نشده است.'
  }
  return 'ثبت یادآوری با خطا مواجه شد. لطفاً دوباره تلاش کنید.'
}

// Per-company snoozes for the CRM 360 profile (list + cancel). The CRM list
// itself only needs to know which (reason_key, order_id, invoice_id)
// signatures are currently snoozed, which useCrmCustomers fetches in bulk
// separately.
export function useCompanySnoozes(companyId) {
  const [snoozes, setSnoozes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    supabase
      .from('crm_snoozes')
      .select('*')
      .eq('company_id', companyId)
      .order('snooze_until', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (ignore) return
        if (loadError) {
          setSchemaMissing(isMissingTableError(loadError.message))
          setError(translateDbError(loadError.message))
        } else {
          setError('')
          setSchemaMissing(false)
          setSnoozes(data || [])
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

  async function snooze(payload) {
    setSubmitting(true)
    try {
      await snoozeCompanyAttention({ companyId, ...payload })
      refresh()
    } catch (err) {
      throw new Error(translateDbError(err.message), { cause: err })
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelSnooze(id) {
    setSubmitting(true)
    try {
      const { error } = await supabase.from('crm_snoozes').delete().eq('id', id)
      if (error) throw new Error(translateDbError(error.message))
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return {
    snoozes,
    loading: companyId ? loading : false,
    error,
    schemaMissing,
    refresh,
    snooze,
    cancelSnooze,
    submitting,
  }
}
