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
  reEvaluateManualReviewCandidates,
  setSourceEnabled,
} from '../prospecting/discoveryPipeline.js'

// Edge Function error codes (supabase/functions/prospect-discovery/index.ts)
// translated to a specific, useful Persian message - falls back to the raw
// code itself (still shown, never swallowed) for anything not listed here.
const EDGE_ERROR_MESSAGES_FA = {
  unauthorized: 'دسترسی رد شد - لطفاً دوباره وارد شوید یا با ادمین تماس بگیرید.',
  server_misconfigured: 'پیکربندی سرور کامل نیست - با ادمین سیستم تماس بگیرید.',
  scheduler_not_configured: 'رمز زمان‌بند روی سرور تنظیم نشده است - با ادمین سیستم تماس بگیرید.',
  method_not_allowed: 'درخواست نامعتبر بود.',
  source_id_required_for_health_check: 'شناسه منبع برای تست سلامت لازم است.',
  discovery_failed: 'اجرای موتور کشف مشتری با خطا مواجه شد - برای جزئیات، «آخرین خطا»ی همان منبع یا تب «اجراها» را بررسی کنید.',
  credential_required: 'این منبع نیازمند یک کلید API است که هنوز روی سرور تنظیم نشده - با ادمین سیستم تماس بگیرید.',
}

// supabase-js's FunctionsHttpError (thrown for any non-2xx Edge Function
// response) only ever carries a generic "non-2xx status code" message on
// its own - the ACTUAL reason is the raw, not-yet-consumed Response sitting
// on `error.context`. Reading it here means a manual-run failure always
// surfaces the Edge Function's real error code, never just "something went
// wrong" - see the Phase 23C report for why silently losing this mattered.
async function extractEdgeErrorCode(error) {
  if (!error?.context || typeof error.context.json !== 'function') return null
  try {
    const body = await error.context.json()
    return body?.error || null
  } catch {
    return null
  }
}

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
  if (error) {
    const code = await extractEdgeErrorCode(error)
    throw new Error(code ? EDGE_ERROR_MESSAGES_FA[code] || `اجرای موتور کشف مشتری با خطا مواجه شد (${code}).` : translateDbError(error.message))
  }
  if (data && data.ok === false) {
    throw new Error(EDGE_ERROR_MESSAGES_FA[data.error] || data.error || 'اجرای موتور کشف مشتری با خطا مواجه شد.')
  }
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
  const [reEvaluatingAll, setReEvaluatingAll] = useState(false)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [dryRunResult, setDryRunResult] = useState(null)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)
  const [promoteEligibleLoading, setPromoteEligibleLoading] = useState(false)
  const [promoteEligibleResult, setPromoteEligibleResult] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
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
      const data = await invokeDiscoveryFunction({ sourceId, mode: 'run' })
      // A 'skipped' run is still an ok:true, 200 response (the prospecting
      // engine is globally disabled via prospect_settings.enabled) - left
      // unchecked, this silently produced zero run rows and zero feedback,
      // indistinguishable from the button doing nothing at all.
      if (data?.skipped) {
        setActionError(data.reason || 'موتور کشف مشتری در حال حاضر به‌صورت کلی غیرفعال است - این اجرا انجام نشد.')
      }
      refresh()
    } catch (err) {
      setActionError(translateDbError(err.message))
    } finally {
      setRunningSourceId(null)
    }
  }

  // Phase 23D, item 10: rescore every EXISTING manual_review candidate under
  // Smart Qualification 2.0's new rules - safe/idempotent (never promotes,
  // never deletes), see reEvaluateManualReviewCandidates() in
  // discoveryPipeline.js. Reports a plain-language summary rather than
  // silently refreshing, since this can move a meaningful number of rows.
  async function reEvaluateAllManualReview() {
    setReEvaluatingAll(true)
    setActionError('')
    setActionNotice('')
    try {
      const result = await reEvaluateManualReviewCandidates(supabase)
      const movedToQualified = result.statusCounts?.qualified || 0
      const stillManualReview = result.statusCounts?.manual_review || 0
      const movedToRejected = result.statusCounts?.rejected || 0
      setActionNotice(
        `${result.updated} از ${result.total} مورد «نیازمند بررسی» دوباره ارزیابی شد` +
          (result.errors ? ` (${result.errors} مورد با خطا مواجه شد)` : '') +
          ` — ${movedToQualified} مورد اکنون واجد شرایط، ${stillManualReview} مورد همچنان نیازمند بررسی، ${movedToRejected} مورد رد شد.`,
      )
      refresh()
    } catch (err) {
      setActionError(translateDbError(err.message))
    } finally {
      setReEvaluatingAll(false)
    }
  }

  // Dry run: calculates what Smart Qualification 2.0 WOULD do to every
  // current manual_review candidate WITHOUT writing anything to the
  // database (see dryRunQualification() in discoveryPipeline.js /
  // mode:'dry_run_qualification' in the Edge Function). Result is kept in
  // state, unformatted, so the admin can copy the raw JSON out to share it.
  async function runDryRunQualification() {
    setDryRunLoading(true)
    setActionError('')
    try {
      const data = await invokeDiscoveryFunction({ mode: 'dry_run_qualification' })
      setDryRunResult(data)
      return data
    } catch (err) {
      setActionError(translateDbError(err.message))
      return null
    } finally {
      setDryRunLoading(false)
    }
  }

  // Phase 23D-FINAL.1: the ONE comprehensive, read-only audit - ALWAYS
  // covers manual_review + rejected + qualified server-side (never just
  // manual_review), and always reports the full real database status
  // distribution too, so its scope is self-evident from the result itself
  // rather than from which button was clicked (see runComprehensiveAudit()
  // in discoveryPipeline.js / mode:'comprehensive_audit'). Safe to run
  // before OR after "ارزیابی مجدد همه موارد نیازمند بررسی" - never writes
  // anything itself either way.
  async function runVerifyQualificationState() {
    setVerifyLoading(true)
    setActionError('')
    try {
      const data = await invokeDiscoveryFunction({ mode: 'comprehensive_audit' })
      setVerifyResult(data)
      return data
    } catch (err) {
      setActionError(translateDbError(err.message))
      return null
    } finally {
      setVerifyLoading(false)
    }
  }

  // "Controlled Promotion Acceptance" round - the ONE real-write bulk
  // promotion action (mode:'promote_eligible_candidates'). Unlike every
  // other function above this one, this DOES create real sales_leads rows
  // and update prospect_candidates.status - see
  // promoteEligibleCandidates() in discoveryPipeline.js for the full
  // idempotency/dedupe-reuse/re-verification discipline. Never called
  // automatically - only ever from an explicit admin button click.
  async function runPromoteEligibleCandidates() {
    setPromoteEligibleLoading(true)
    setActionError('')
    try {
      const data = await invokeDiscoveryFunction({ mode: 'promote_eligible_candidates' })
      setPromoteEligibleResult(data)
      refresh()
      return data
    } catch (err) {
      setActionError(translateDbError(err.message))
      return null
    } finally {
      setPromoteEligibleLoading(false)
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
    reEvaluatingAll,
    dryRunLoading,
    dryRunResult,
    verifyLoading,
    verifyResult,
    promoteEligibleLoading,
    promoteEligibleResult,
    error,
    actionError,
    actionNotice,
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
    reEvaluateAllManualReview,
    runDryRunQualification,
    runVerifyQualificationState,
    runPromoteEligibleCandidates,
  }
}
