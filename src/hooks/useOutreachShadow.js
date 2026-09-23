import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { runShadowOutreachCycle } from '../outreach/shadowPipeline'
import {
  fetchAllSuggestions,
  approveSuggestion,
  editSuggestion,
  dismissSuggestion,
  snoozeSuggestion,
} from '../services/outreachSuggestions'
import { sendFirstEmail, sendTestMessage } from '../services/outreachSend'
import { previewFirstEmailSend } from '../outreach/sendGate'
import { updateLead } from '../services/salesLeads'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات حالت سایه (Shadow Mode). لطفاً دوباره تلاش کنید.'
}

const FIRST_EMAIL_CHECK_UNAVAILABLE = ['امکان بررسی شرایط ارسال نبود؛ صفحه را به‌روزرسانی کنید.']

// Pre-checks every approved email suggestion with the same gate the server
// runs (sendGate.js previewFirstEmailSend) -> { [suggestionId]: { allowed,
// reasons } }. Fails closed: if settings/attempts can't be read, every
// candidate is marked not allowed. Display only - the server re-checks.
async function loadFirstEmailChecks(rows) {
  const candidates = rows.filter((r) => r.channel === 'email' && ['approved', 'edited'].includes(r.status))
  if (candidates.length === 0) return {}
  try {
    const leadIds = [...new Set(candidates.map((r) => r.lead_id).filter(Boolean))]
    const [{ data: settings, error: settingsError }, { data: attempts, error: attemptsError }] = await Promise.all([
      supabase.from('automation_settings').select('*').eq('id', 1).single(),
      supabase.from('outreach_attempts').select('*').in('lead_id', leadIds),
    ])
    if (settingsError || attemptsError) throw settingsError || attemptsError
    const now = new Date()
    return Object.fromEntries(
      candidates.map((r) => {
        const { sales_leads: lead, ...suggestion } = r
        const leadAttempts = (attempts || []).filter((a) => a.lead_id === r.lead_id)
        return [r.id, previewFirstEmailSend({ suggestion, lead, settings, leadAttempts, now })]
      }),
    )
  } catch {
    return Object.fromEntries(candidates.map((r) => [r.id, { allowed: false, reasons: FIRST_EMAIL_CHECK_UNAVAILABLE }]))
  }
}

// SHADOW MODE ONLY - runShadowOutreachCycle() (src/outreach/shadowPipeline.js)
// only ever generates/persists suggestions; nothing this hook calls can send
// a real message (see src/outreach/channels/*.js's disabledExecute()).
export function useOutreachShadow() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [lastRun, setLastRun] = useState(null)
  const [sendResults, setSendResults] = useState({})
  const [sendingId, setSendingId] = useState(null)
  const [firstEmailChecks, setFirstEmailChecks] = useState({})

  const load = useCallback(async () => {
    try {
      const { data, error: fetchError } = await fetchAllSuggestions()
      if (fetchError) throw fetchError
      setError('')
      setRows(data || [])
      setFirstEmailChecks(await loadFirstEmailChecks(data || []))
    } catch (err) {
      setError(translateDbError(err.message))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  async function runShadowNow() {
    setRunning(true)
    setActionError('')
    try {
      const run = await runShadowOutreachCycle(supabase, { runType: 'manual' })
      setLastRun(run)
      await load()
    } catch (err) {
      setActionError(translateDbError(err.message))
    } finally {
      setRunning(false)
    }
  }

  async function runAction(fn, ...args) {
    setActionError('')
    try {
      await fn(...args)
      await load()
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  // Surfaces the gate's own reasons (e.g. "credentials not configured")
  // directly, rather than a generic error, since a blocked send is an
  // expected, informative outcome here, not a failure of the app itself.
  //
  // Only ONE send (test or first-email) may be in flight at a time across
  // the whole page - the ref blocks a second call synchronously, before
  // React re-renders the disabled buttons. The server-side claim
  // (sendPipeline.js claimSend) is still the real duplicate guard.
  const sendInFlight = useRef(false)

  async function runSend(kind, sendFn, suggestionId) {
    if (sendInFlight.current) return null
    sendInFlight.current = true
    setSendingId(suggestionId)
    setActionError('')
    try {
      const result = await sendFn(suggestionId)
      setSendResults((prev) => ({ ...prev, [suggestionId]: { ...result, kind } }))
      return result
    } catch (err) {
      setActionError(
        kind === 'first_email'
          ? 'نتیجه ارسال ایمیل مشخص نشد. دوباره ارسال نکنید؛ ابتدا صفحه را به‌روزرسانی و وضعیت را بررسی کنید.'
          : translateDbError(err.message),
      )
      return null
    } finally {
      // Always reload, so the card shows the server's real send_status
      // (e.g. 'sending'/'sent') and hides the send action accordingly.
      await load()
      sendInFlight.current = false
      setSendingId(null)
    }
  }

  function sendTest(suggestionId) {
    return runSend('test', sendTestMessage, suggestionId)
  }

  function sendFirstEmailNow(suggestionId) {
    return runSend('first_email', sendFirstEmail, suggestionId)
  }

  return {
    rows,
    loading,
    running,
    error,
    actionError,
    lastRun,
    sendResults,
    sendingId,
    firstEmailChecks,
    refresh: load,
    runShadowNow,
    approve: (id) => runAction(approveSuggestion, id),
    edit: (id, finalText) => runAction(editSuggestion, id, finalText),
    dismiss: (id, feedback) => runAction(dismissSuggestion, id, feedback),
    snooze: (id, untilIso) => runAction(snoozeSuggestion, id, untilIso),
    sendTest,
    sendFirstEmail: sendFirstEmailNow,
    // Opt-out: only ever sets do_not_contact (never clears it); every send
    // path's server gate then blocks this lead.
    markDoNotContact: async (leadId) => {
      await updateLead(leadId, { fields: { do_not_contact: true } })
      await load()
    },
  }
}
