// Phase 25 - Autonomous Outreach SHADOW MODE: server-side evaluation run.
//
// Runs the EXACT SAME shadow pipeline the admin UI would trigger -
// runShadowOutreachCycle() in src/outreach/shadowPipeline.js. Same split as
// prospect-discovery/automation-reconcile: only the DB client (service-role)
// and the auth/transport wrapper are server-specific.
//
// SHADOW MODE ONLY, structurally, not just by convention: this function
// (and everything it calls) NEVER imports or invokes a channel adapter's
// execute() (see src/outreach/channels/*.js). It only ever reads sales_leads
// /prospect_candidates/outreach_attempts and writes
// prospect_outreach_suggestions/prospect_outreach_runs rows. No WhatsApp,
// SMS, email, or phone provider is called from here, ever.
//
// PREPARED FOR DEPLOYMENT. Do not activate a recurring schedule until this
// function has been deployed and at least one manual server-side test run
// has been verified (Phase 25 STEP 13/14).
//
// Two independent ways to authenticate, checked in order, same pattern as
// prospect-discovery:
//   1. x-outreach-shadow-secret matching OUTREACH_SHADOW_CRON_SECRET - for
//      pg_net/cron (runType 'scheduled'). A DEDICATED secret, never reused
//      from PROSPECTING_CRON_SECRET or AUTOMATION_CRON_SECRET.
//   2. A valid Supabase user session (Authorization: Bearer <jwt>) whose
//      profiles.role = 'admin' - for an admin-triggered manual run
//      (runType 'manual').
// Fail-closed: missing secret config -> 500, no valid auth -> 401,
// non-POST -> 405.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { runShadowOutreachCycle } from '../../../src/outreach/shadowPipeline.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const CRON_SECRET = Deno.env.get('OUTREACH_SHADOW_CRON_SECRET')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-outreach-shadow-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

async function authenticate(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const providedSecret = req.headers.get('x-outreach-shadow-secret')
  if (CRON_SECRET && providedSecret && providedSecret === CRON_SECRET) {
    return { actorType: 'cron' as const, userId: null as string | null }
  }

  const authHeader = req.headers.get('Authorization')
  if (authHeader && SUPABASE_URL && ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (user) {
      const { data: profile } = await serviceClient.from('profiles').select('role').eq('id', user.id).single()
      if (profile?.role === 'admin') {
        return { actorType: 'admin' as const, userId: user.id }
      }
    }
  }

  return null
}

Deno.serve(async (req) => {
  const startedAt = Date.now()

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('outreach-shadow: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  }
  if (!CRON_SECRET) {
    console.error('outreach-shadow: OUTREACH_SHADOW_CRON_SECRET is not configured')
    return jsonResponse({ ok: false, error: 'scheduler_not_configured' }, 500)
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const auth = await authenticate(req, client)
  if (!auth) {
    console.error('outreach-shadow: rejected request with invalid or missing credentials')
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  // manualTest - a very small, explicit way to trigger ONE server-side
  // shadow run manually (same idea as prospect-discovery's manualTest),
  // exercising the exact runType:'scheduled' code path the future cron will
  // use without needing to enable anything persisted. Unlike Phase 24's
  // manualTest, no budget override is needed here - shadow evaluation is
  // already bounded by max_suggestions_per_run and never has an external
  // network cost (no provider is ever called).
  let manualTest = false
  try {
    const body = await req.json().catch(() => ({}))
    manualTest = body?.manualTest === true
  } catch {
    manualTest = false
  }

  const runType = auth.actorType === 'cron' || manualTest ? 'scheduled' : 'manual'

  console.log('outreach-shadow: start', `actor=${auth.actorType}`, `runType=${runType}`, manualTest ? 'manualTest=true' : '')

  try {
    const run = await runShadowOutreachCycle(client, { runType, createdBy: auth.userId })
    const durationMs = Date.now() - startedAt

    if (run.skipped) {
      console.log('outreach-shadow: skipped', run.reason)
      return jsonResponse({ ok: true, skipped: true, reason: run.reason, duration_ms: durationMs })
    }

    // Never return lead names/contact data/message text - counts and the
    // run id only, same "no unnecessary PII" discipline as every other
    // server-side function in this project.
    const response = {
      ok: true,
      run_id: run.id,
      run_type: run.run_type,
      status: run.status,
      leads_scanned: run.leads_scanned,
      eligible_count: run.eligible_count,
      waiting_count: run.waiting_count,
      blocked_count: run.blocked_count,
      manual_review_count: run.manual_review_count,
      suggestions_created: run.suggestions_created,
      duplicates_skipped: run.duplicates_skipped,
      errors_count: run.errors_count,
      duration_ms: durationMs,
    }

    console.log('outreach-shadow: finish', JSON.stringify(response))
    return jsonResponse(response, 200)
  } catch (err) {
    const durationMs = Date.now() - startedAt
    console.error('outreach-shadow: failed', err instanceof Error ? err.message : 'unknown_error', `${durationMs}ms`)
    return jsonResponse({ ok: false, error: 'shadow_run_failed', duration_ms: durationMs }, 500)
  }
})
