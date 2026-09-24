import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { buildEmailOutreachState, summarizeEmailOutreach } from '../outreach/autoEmail'

const LEAD_COLUMNS =
  'id, company_name, contact_name, email, website, status, do_not_contact, tags, last_contact_at, created_at, email_source_url, email_lookup_status, email_lookup_reason, email_lookup_at'
const ATTEMPT_COLUMNS =
  'id, lead_id, suggestion_id, channel, status, test_mode, idempotency_key, provider, external_message_id, provider_status, provider_status_at, subject_snapshot, error_code, failure_reason, created_at, updated_at'

async function must(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

// Everything the «ارسال ایمیل» page and the lead page show, classified with
// the SAME buildEmailOutreachState() the server runner uses.
export function useEmailOutreach() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [runReport, setRunReport] = useState(null)

  const load = useCallback(async () => {
    try {
      const [settings, leads, suggestions, attempts, recipients, replies, runs, schedule] = await Promise.all([
        must(supabase.from('automation_settings').select('*').eq('id', 1).single()),
        must(supabase.from('sales_leads').select(LEAD_COLUMNS)),
        must(supabase.from('prospect_outreach_suggestions').select('*').eq('channel', 'email')),
        must(supabase.from('outreach_attempts').select(ATTEMPT_COLUMNS)),
        must(supabase.from('email_outreach_recipients').select('*')),
        must(supabase.from('inbound_replies').select('lead_id, predicted_intent, final_intent')),
        must(supabase.from('email_outreach_runs').select('*').order('started_at', { ascending: false }).limit(5)),
        must(supabase.rpc('email_outreach_schedule')),
      ])
      setData({ settings, leads, suggestions, attempts, recipients, replies, runs, schedule: schedule?.[0] || null })
      setError('')
    } catch {
      setError('بارگذاری اطلاعات ارسال ایمیل انجام نشد. «به‌روزرسانی» را بزنید.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  const entries = useMemo(() => (data ? buildEmailOutreachState(data) : []), [data])
  const counts = useMemo(() => summarizeEmailOutreach(entries), [entries])

  // Saves and reads the row back: the page only ever shows what the
  // database actually holds, and a write that did not persist is reported.
  async function saveSetting(column, value, label) {
    setSaving(true)
    setSaveMessage('')
    try {
      const saved = await must(supabase.from('automation_settings').update({ [column]: value }).eq('id', 1).select(column).single())
      if (saved?.[column] !== value) throw new Error('not_persisted')
      setSaveMessage(`${label} ذخیره شد.`)
    } catch {
      setSaveMessage(`${label} ذخیره نشد. مقدار نمایش‌داده‌شده همان مقدار فعلی دیتابیس است.`)
    } finally {
      await load()
      setSaving(false)
    }
  }

  async function runNow() {
    setRunning(true)
    setRunReport(null)
    try {
      const { data: report, error: invokeError } = await supabase.functions.invoke('outreach-auto-email', { body: {} })
      if (invokeError || !report?.ok) throw invokeError || new Error('run_failed')
      setRunReport(report)
    } catch {
      setRunReport({ ok: false })
    } finally {
      await load()
      setRunning(false)
    }
  }

  return {
    ...(data || {}),
    entries,
    counts,
    loading,
    error,
    saving,
    saveMessage,
    running,
    runReport,
    refresh: load,
    runNow,
    setEnabled: (enabled) => saveSetting('auto_email_enabled', enabled, 'وضعیت ارسال خودکار'),
    setLimit: (limit) => saveSetting('auto_email_max_per_run', limit, 'حداکثر ارسال در هر اجرا'),
  }
}
