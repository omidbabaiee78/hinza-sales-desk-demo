// Phase 18A - server-side automation reconciliation.
//
// Runs the EXACT SAME reconciliation cycle the "به‌روزرسانی موتور" admin
// button runs in the browser (src/hooks/useAutomationTasks.js) - both call
// automation/taskService.runReconciliationCycle() directly, which in turn
// calls the pure rule layer (automation/reconciler.js + ruleDefinitions.js).
// Nothing about WHAT gets generated/invalidated/promoted is reimplemented
// here; only the DB client (service-role instead of the browser's
// authenticated client) and the auth/transport wrapper are server-specific.
//
// Still Phase 17 semantics: no external messaging, no order/invoice/lead
// mutation, no LLM call - reconciliation only ever changes automation_tasks/
// automation_task_events rows.
//
// PREPARED, NOT DEPLOYED. See supabase/sql/phase18a_automation_cron.sql for
// the (also unapplied) pg_cron wiring that would call this on a schedule.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { runReconciliationCycle, fetchActiveAndFailedTasks } from '../../../src/automation/taskService.js'

// Supabase injects these into every Edge Function automatically - never set
// manually, and never the anon/publishable key here (this function must run
// with elevated, RLS-bypassing access since there is no browser user
// session to authenticate as).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

// Scheduler-only secret - set via `supabase secrets set AUTOMATION_CRON_SECRET=...`,
// NEVER hardcoded here and NEVER the same value as any frontend key. The
// pg_cron job (see the prepared SQL) reads the matching value out of Vault
// and sends it as the x-automation-secret header; anyone without it gets a
// 401 before any query runs.
const CRON_SECRET = Deno.env.get('AUTOMATION_CRON_SECRET')

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const startedAt = Date.now()

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  if (!CRON_SECRET) {
    // Fail closed - an unconfigured secret must never be treated as "no
    // auth required".
    console.error('automation-reconcile: AUTOMATION_CRON_SECRET is not configured')
    return jsonResponse({ ok: false, error: 'scheduler_not_configured' }, 500)
  }

  const providedSecret = req.headers.get('x-automation-secret')
  if (!providedSecret || providedSecret !== CRON_SECRET) {
    console.error('automation-reconcile: rejected request with invalid or missing x-automation-secret')
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('automation-reconcile: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  }

  console.log('automation-reconcile: start')

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  try {
    const { summary } = await runReconciliationCycle(client, { now: new Date() })
    const activeTasks = await fetchActiveAndFailedTasks(client)
    const durationMs = Date.now() - startedAt

    // Never return customer data (names, numbers, message text) - counts only.
    const response = {
      ok: true,
      created: summary.created,
      completed: summary.completed,
      cancelled: summary.cancelled,
      expired: 0, // no rule currently produces `expired` - reported for shape stability
      promoted: summary.promoted,
      active: activeTasks.length,
      duration_ms: durationMs,
    }

    console.log('automation-reconcile: finish', JSON.stringify(response))
    return jsonResponse(response, 200)
  } catch (err) {
    const durationMs = Date.now() - startedAt
    // Safe error only - never log the raw error object (could carry query
    // parameters/row data); message text alone is diagnostic enough.
    console.error('automation-reconcile: failed', err instanceof Error ? err.message : 'unknown_error', `${durationMs}ms`)
    return jsonResponse({ ok: false, error: 'reconciliation_failed', duration_ms: durationMs }, 500)
  }
})
