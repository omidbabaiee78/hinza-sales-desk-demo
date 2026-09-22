import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { runShadowOutreachCycle } from '../outreach/shadowPipeline'
import {
  fetchAllSuggestions,
  approveSuggestion,
  editSuggestion,
  dismissSuggestion,
  snoozeSuggestion,
} from '../services/outreachSuggestions'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات حالت سایه (Shadow Mode). لطفاً دوباره تلاش کنید.'
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

  const load = useCallback(async () => {
    try {
      const { data, error: fetchError } = await fetchAllSuggestions()
      if (fetchError) throw fetchError
      setError('')
      setRows(data || [])
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

  return {
    rows,
    loading,
    running,
    error,
    actionError,
    lastRun,
    refresh: load,
    runShadowNow,
    approve: (id) => runAction(approveSuggestion, id),
    edit: (id, finalText) => runAction(editSuggestion, id, finalText),
    dismiss: (id, feedback) => runAction(dismissSuggestion, id, feedback),
    snooze: (id, untilIso) => runAction(snoozeSuggestion, id, untilIso),
  }
}
