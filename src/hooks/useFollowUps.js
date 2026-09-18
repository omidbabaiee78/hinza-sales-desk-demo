import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'ذخیره پیگیری با خطا مواجه شد. لطفاً دوباره تلاش کنید.'
}

const BASE_COLUMNS =
  'id, company_id, assigned_to, due_at, status, note, created_by, created_at, updated_at'

// Shared by both the per-customer widget and the admin follow-ups
// page/dashboard so create/complete/cancel logic lives in exactly one place.
async function insertFollowUp({ companyId, dueAt, note }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase.from('follow_ups').insert({
    company_id: companyId,
    due_at: dueAt,
    note: note?.trim() || null,
    status: 'open',
    created_by: user?.id ?? null,
    assigned_to: user?.id ?? null,
  })
  if (error) throw new Error(translateDbError(error.message))
}

async function updateFollowUpStatus(id, status) {
  const { error } = await supabase.from('follow_ups').update({ status }).eq('id', id)
  if (error) throw new Error(translateDbError(error.message))
}

// Follow-ups for a single customer - the "پیگیری‌ها" section in Admin
// Customer Detail.
export function useCompanyFollowUps(companyId) {
  const [followUps, setFollowUps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    supabase
      .from('follow_ups')
      .select(BASE_COLUMNS)
      .eq('company_id', companyId)
      .order('due_at', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (ignore) return
        if (loadError) {
          setError(translateDbError(loadError.message))
        } else {
          setError('')
          setFollowUps(data || [])
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

  async function createFollowUp({ dueAt, note }) {
    setSubmitting(true)
    try {
      await insertFollowUp({ companyId, dueAt, note })
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function setStatus(id, status) {
    setSubmitting(true)
    try {
      await updateFollowUpStatus(id, status)
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return {
    followUps,
    loading: companyId ? loading : false,
    error,
    refresh,
    createFollowUp,
    setStatus,
    submitting,
  }
}

// All follow-ups across every customer - one query shared by the admin
// Follow-ups page and the dashboard summary; each screen buckets the same
// rows into today/overdue/upcoming/done locally instead of querying per bucket.
export function useAdminFollowUps() {
  const [followUps, setFollowUps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let ignore = false
    supabase
      .from('follow_ups')
      .select(`${BASE_COLUMNS}, companies(id, name)`)
      .order('due_at', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (ignore) return
        if (loadError) {
          setError(translateDbError(loadError.message))
        } else {
          setError('')
          setFollowUps(data || [])
        }
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  async function setStatus(id, status) {
    setSubmitting(true)
    try {
      await updateFollowUpStatus(id, status)
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return { followUps, loading, error, refresh, setStatus, submitting }
}
