import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { buildChannelOutreachState, summarizeChannelOutreach } from '../outreach/channelOutreach'

async function must(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

// WhatsApp/Bale status of every registered lead, classified with the SAME
// buildChannelOutreachState() the server runner uses. The rows come only
// from the server (channel_outreach_messages); the browser never sends.
// Before the phase34 migration is applied the tables do not exist - that is
// reported as `notInstalled`, not as an error.
export function useChannelOutreach() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notInstalled, setNotInstalled] = useState(false)
  const [running, setRunning] = useState(false)
  const [runReport, setRunReport] = useState(null)

  const load = useCallback(async () => {
    try {
      const [settings, leads, replies, recipients] = await Promise.all([
        must(supabase.from('automation_settings').select('*').eq('id', 1).single()),
        must(supabase.from('sales_leads').select('*')),
        must(supabase.from('inbound_replies').select('lead_id, predicted_intent, final_intent')),
        must(supabase.from('email_outreach_recipients').select('lead_id, status')),
      ])
      let messages = []
      let runs = []
      try {
        ;[messages, runs] = await Promise.all([
          must(supabase.from('channel_outreach_messages').select('*')),
          must(supabase.from('channel_outreach_runs').select('*').order('started_at', { ascending: false }).limit(5)),
        ])
        setNotInstalled(false)
      } catch {
        setNotInstalled(true)
      }
      setData({ settings, leads, replies, recipients, messages, runs })
      setError('')
    } catch {
      setError('بارگذاری وضعیت واتساپ و بله انجام نشد. «به‌روزرسانی» را بزنید.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  const entries = useMemo(() => (data ? buildChannelOutreachState(data) : []), [data])
  const counts = useMemo(() => summarizeChannelOutreach(entries), [entries])

  async function runNow() {
    setRunning(true)
    setRunReport(null)
    try {
      const { data: report, error: invokeError } = await supabase.functions.invoke('outreach-channels', { body: {} })
      if (invokeError || !report?.ok) throw invokeError || new Error('run_failed')
      setRunReport(report)
    } catch {
      setRunReport({ ok: false })
    } finally {
      await load()
      setRunning(false)
    }
  }

  return { ...(data || {}), entries, counts, loading, error, notInstalled, running, runReport, refresh: load, runNow }
}
