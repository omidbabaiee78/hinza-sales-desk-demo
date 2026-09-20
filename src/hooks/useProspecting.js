import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  fetchCandidates,
  fetchProspectSettings,
  fetchDiscoveryRuns,
  fetchProspectSources,
  ensureDefaultSources,
  runUploadedDatasetDiscovery,
  promoteCandidate,
  rejectCandidate,
  markCandidateDuplicate,
  updateCandidateFields,
  reEvaluateCandidate,
  setSourceEnabled,
} from '../prospecting/discoveryPipeline.js'

// Any action that makes an EXTERNAL network call (a live source's discover()
// or healthCheck()) must run server-side, never directly from the browser -
// both because a shared public API is not meant to be hit from many
// individual browser sessions, and because browser CORS/fetch restrictions
// make such a call unreliable in ways a server fetch is not. This invokes
// the deployed Edge Function, which attaches the current admin's own
// session automatically (supabase-js sends it as the Authorization header)
// - no secret ever needs to reach the browser for this.
async function invokeDiscoveryFunction(body) {
  const { data, error } = await supabase.functions.invoke('prospect-discovery', { body })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.error || 'اجرای موتور کشف مشتری با خطا مواجه شد.')
  return data
}

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return message
}

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

// Orchestrates /admin/prospecting: reads candidates/settings/runs/sources,
// and exposes the admin actions - every one of them a thin wrapper over
// prospecting/discoveryPipeline.js, never a second business-logic path.
export function useProspecting() {
  const [candidates, setCandidates] = useState([])
  const [settings, setSettings] = useState(null)
  const [runs, setRuns] = useState([])
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runningSourceId, setRunningSourceId] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    async function load() {
      try {
        await ensureDefaultSources(supabase)
        const [candidateRows, settingsRow, runRows, sourceRows] = await Promise.all([
          fetchCandidates(supabase),
          fetchProspectSettings(supabase),
          fetchDiscoveryRuns(supabase),
          fetchProspectSources(supabase),
        ])
        if (ignore) return
        setError('')
        setCandidates(candidateRows)
        setSettings(settingsRow)
        setRuns(runRows)
        setSources(sourceRows)
      } catch (err) {
        if (!ignore) setError(translateDbError(err.message))
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((t) => t + 1)
  }

  async function runAction(fn, ...args) {
    setActionError('')
    try {
      await fn(supabase, ...args)
      refresh()
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function uploadAndRun(rows) {
    setRunning(true)
    setActionError('')
    try {
      const createdBy = await currentUserId()
      await runUploadedDatasetDiscovery(supabase, { rows, createdBy })
      refresh()
    } catch (err) {
      setActionError(translateDbError(err.message))
    } finally {
      setRunning(false)
    }
  }

  async function promote(candidateId) {
    setActionError('')
    try {
      const createdBy = await currentUserId()
      await promoteCandidate(supabase, candidateId, { createdBy })
      refresh()
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function toggleSource(sourceId, enabled) {
    await runAction(setSourceEnabled, sourceId, enabled)
  }

  async function testSourceHealth(sourceId) {
    setActionError('')
    try {
      const data = await invokeDiscoveryFunction({ sourceId, mode: 'health' })
      refresh()
      return data.result
    } catch (err) {
      setActionError(translateDbError(err.message))
      return { ok: false, message: err.message }
    }
  }

  async function runSourceNow(sourceId) {
    setRunningSourceId(sourceId)
    setActionError('')
    try {
      await invokeDiscoveryFunction({ sourceId, mode: 'run' })
      refresh()
    } catch (err) {
      setActionError(translateDbError(err.message))
    } finally {
      setRunningSourceId(null)
    }
  }

  return {
    candidates,
    settings,
    runs,
    sources,
    loading,
    running,
    runningSourceId,
    error,
    actionError,
    refresh,
    uploadAndRun,
    promote,
    reject: (id, reason) => runAction(rejectCandidate, id, reason),
    markDuplicate: (id, opts) => runAction(markCandidateDuplicate, id, opts),
    updateFields: (id, fields) => runAction(updateCandidateFields, id, fields),
    reEvaluate: (id) => runAction(reEvaluateCandidate, id),
    toggleSource,
    testSourceHealth,
    runSourceNow,
  }
}
