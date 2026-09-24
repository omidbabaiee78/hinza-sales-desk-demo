// Phase 23 - server-side autonomous prospecting execution.
//
// Runs the EXACT SAME discovery pipeline the admin's manual "اجرای این
// منبع"/"تست منبع" buttons on /admin/prospecting trigger - both call
// prospecting/discoveryPipeline.js's runDiscovery()/testSource() directly.
// Only the DB client (service-role instead of the browser's authenticated
// client) and the auth/transport wrapper are server-specific, same split
// already established by supabase/functions/automation-reconcile.
//
// PREPARED FOR DEPLOYMENT. Do not activate the daily cron until this
// function has been deployed and manually verified (see the Phase 23
// report's cron section) - activating a schedule before that just produces
// interval failures with nothing tested behind them.
//
// Phase 23B: this is now the ONLY place any live-source network call
// (e.g. the OSM Overpass adapter) is allowed to run. It must never be
// called directly from a browser - both because a shared public API like
// Overpass is not meant to be hit from many individual browser sessions,
// and because browsers apply CORS/third-party-fetch restrictions that
// would make such a call unreliable in ways a server-side fetch is not.
//
// Two independent ways to authenticate a request, checked in order:
//   1. x-prospecting-secret matching PROSPECTING_CRON_SECRET - for
//      pg_net/cron (runType 'scheduled', always all sources, always a full
//      run - `mode` is ignored for this path).
//   2. A valid Supabase user session (Authorization: Bearer <jwt>) whose
//      profiles.role = 'admin' - for the admin UI's own "تست منبع"/"اجرای
//      این منبع" buttons (runType 'manual'). supabase-js's
//      `functions.invoke()` attaches this automatically from the logged-in
//      admin's own session - no secret ever reaches the browser.
// Same fail-closed shape as automation-reconcile otherwise: missing secret
// config -> 500, no valid auth -> 401, non-POST -> 405.
//
// CORS: pg_net/cron never sends a browser preflight, but the admin UI's
// supabase.functions.invoke() does - it attaches Authorization/apikey/
// x-client-info/content-type headers, which the browser always preflights
// with an OPTIONS request first. Every response (including OPTIONS itself)
// must carry Access-Control-Allow-* headers, or the browser silently
// refuses to even send the real POST - surfacing in supabase-js as
// "Failed to send a request to the Edge Function", with no server log at
// all (the request never left the browser). This is unrelated to the
// admin-JWT/cron-secret authentication above, which is unchanged.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { runDiscovery, testSource, dryRunQualification, runComprehensiveAudit, promoteEligibleCandidates } from '../../../src/prospecting/discoveryPipeline.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

// Set via `supabase secrets set PROSPECTING_CRON_SECRET=...` - never
// hardcoded here, never the same value as any frontend key or the
// automation engine's own secret.
const CRON_SECRET = Deno.env.get('PROSPECTING_CRON_SECRET')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prospecting-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

// Returns { actorType: 'cron' } | { actorType: 'admin', userId } | null.
// Never trusts a client-supplied role - the admin path always re-checks
// profiles.role against the service-role client, the one source of truth.
async function authenticate(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const providedSecret = req.headers.get('x-prospecting-secret')
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

  // Preflight - checked BEFORE the POST-only gate below, since a browser
  // sends this as its own separate OPTIONS request that must succeed on
  // its own before the actual POST is ever sent.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('prospect-discovery: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  }
  if (!CRON_SECRET) {
    console.error('prospect-discovery: PROSPECTING_CRON_SECRET is not configured')
    return jsonResponse({ ok: false, error: 'scheduler_not_configured' }, 500)
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const auth = await authenticate(req, client)
  if (!auth) {
    console.error('prospect-discovery: rejected request with invalid or missing credentials')
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  // Body: { sourceId, mode }. sourceId omitted/null runs every enabled
  // source (what the daily schedule always does). mode: 'health' only ever
  // runs the adapter's own healthCheck() - no candidates are
  // discovered/written - used by the admin UI's "تست منبع" button.
  // mode: 'dry_run_qualification' (Phase 23D) recomputes Smart
  // Qualification 2.0 against every EXISTING manual_review candidate and
  // returns the predictions - a pure read + in-memory compute, no database
  // write of any kind, no promotion, sourceId is irrelevant/ignored for it.
  // mode: 'verify_qualification_state' (Phase 23D.3) and mode:
  // 'comprehensive_audit' (Phase 23D-FINAL.1) are now BOTH just aliases for
  // the one, single comprehensive audit (runComprehensiveAudit() -
  // discoveryPipeline.js) - it always covers manual_review + rejected +
  // qualified server-side, always reports the full real database
  // distribution too (databaseStatusCounts, including duplicate/promoted),
  // and never writes anything. Kept as two names deliberately: the exact
  // "which button/mode did you use" ambiguity between a narrower,
  // manual_review-only query and this one was itself the root cause of a
  // prior audit-coverage bug report - there is now only ONE real query
  // behind either name.
  // mode: 'promote_eligible_candidates' (Controlled Promotion Acceptance
  // round) - the ONE bulk-promotion action: re-verifies and promotes every
  // candidate the comprehensive audit currently reports as
  // predicted_auto_promotable=true (see promoteEligibleCandidates() -
  // discoveryPipeline.js). This IS a real write (creates sales_leads rows,
  // updates prospect_candidates.status) - deliberately admin-JWT ONLY,
  // never reachable via the cron secret (checked right below), so no
  // future scheduled run can silently start bulk-promoting without a human
  // in the loop clicking the button.
  //
  // Anything else (including the cron path, which never sends `mode`) does
  // a full discovery run.
  // Phase 24, STEP 8 - a secure way to trigger ONE complete server-side
  // pipeline run manually, exercising the EXACT SAME code path the future
  // cron will use, without any browser/admin session: curl this function
  // with the x-prospecting-secret header (the same secret pg_net will send)
  // and { "mode": "run", "manualTest": true } - actorType becomes 'cron' the
  // same way a real scheduled trigger's request would, so runType below
  // becomes 'scheduled' automatically. manualTest forces dryRun=true AND a
  // small, safe, NEVER-PERSISTED settings override (see runDiscovery()'s own
  // settingsOverride parameter) - daily_run_enabled:true (so the test can
  // exercise the scheduled path even while the PERSISTED
  // prospect_settings.daily_run_enabled stays false) plus a tiny 3-candidate/
  // 2-external-request budget - so a manual test can never do a full-cost
  // run, never write a real lead, and never itself turns the real daily
  // schedule on. dryRun can also be requested on its own (without
  // manualTest's smaller budget/override) for a full-budget dry run against
  // whatever daily_run_enabled is CURRENTLY persisted as. Neither field is
  // ever sent by the real pg_cron trigger (supabase/sql/
  // phase23_prospecting_cron.sql always POSTs an empty body), so this has
  // zero effect on the actual daily schedule once activated - a genuine
  // scheduled trigger still respects the persisted daily_run_enabled exactly
  // as before.
  let sourceId: string | null = null
  let mode: string = 'run'
  let manualTest = false
  let dryRun = false
  try {
    const body = await req.json().catch(() => ({}))
    sourceId = body?.sourceId || null
    manualTest = body?.manualTest === true
    dryRun = body?.dryRun === true
    mode =
      body?.mode === 'health'
        ? 'health'
        : body?.mode === 'dry_run_qualification'
          ? 'dry_run_qualification'
          : body?.mode === 'verify_qualification_state' || body?.mode === 'comprehensive_audit'
            ? 'comprehensive_audit'
            : body?.mode === 'promote_eligible_candidates'
              ? 'promote_eligible_candidates'
              : 'run'
  } catch {
    sourceId = null
  }

  if (mode === 'health' && !sourceId) {
    return jsonResponse({ ok: false, error: 'source_id_required_for_health_check' }, 400)
  }
  if (mode === 'promote_eligible_candidates' && auth.actorType !== 'admin') {
    console.error('prospect-discovery: rejected promote_eligible_candidates from a non-admin actor', auth.actorType)
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  console.log(
    'prospect-discovery: start',
    `actor=${auth.actorType}`,
    `mode=${mode}`,
    sourceId ? `source=${sourceId}` : 'all sources',
    manualTest ? 'manualTest=true' : '',
    dryRun ? 'dryRun=true' : '',
  )

  try {
    if (mode === 'health') {
      const { result } = await testSource(client, sourceId as string)
      const durationMs = Date.now() - startedAt
      console.log('prospect-discovery: health check finished', JSON.stringify(result))
      return jsonResponse({ ok: true, mode: 'health', result, duration_ms: durationMs })
    }

    if (mode === 'dry_run_qualification') {
      const result = await dryRunQualification(client)
      const durationMs = Date.now() - startedAt
      console.log('prospect-discovery: dry-run finished', JSON.stringify({ total: result.total, counts: result.counts, errors: result.errors }))
      return jsonResponse({ ok: true, mode: 'dry_run_qualification', ...result, duration_ms: durationMs })
    }

    if (mode === 'comprehensive_audit') {
      const result = await runComprehensiveAudit(client)
      const durationMs = Date.now() - startedAt
      console.log(
        'prospect-discovery: comprehensive audit finished',
        JSON.stringify({
          databaseStatusCounts: result.databaseStatusCounts,
          auditedCount: result.auditedCount,
          excludedCount: result.excludedCount,
          errors: result.errors,
          logicalConflictCount: result.logicalConflictCount,
        }),
      )
      return jsonResponse({ ok: true, mode: 'comprehensive_audit', ...result, duration_ms: durationMs })
    }

    if (mode === 'promote_eligible_candidates') {
      const result = await promoteEligibleCandidates(client, { createdBy: auth.userId })
      const durationMs = Date.now() - startedAt
      console.log(
        'prospect-discovery: promote_eligible_candidates finished',
        JSON.stringify({
          eligibleBefore: result.eligibleBefore,
          promoted: result.promoted,
          alreadyPromoted: result.alreadyPromoted,
          skippedExistingMatch: result.skippedExistingMatch,
          noLongerEligible: result.noLongerEligible,
          failed: result.failed,
        }),
      )
      return jsonResponse({ ok: true, mode: 'promote_eligible_candidates', ...result, duration_ms: durationMs })
    }

    const runType = auth.actorType === 'cron' ? 'scheduled' : 'manual'
    const run = await runDiscovery(client, {
      sourceId,
      runType,
      createdBy: auth.userId,
      dryRun: dryRun || manualTest,
      // Read pending candidates' own websites and search leads' official
      // sites after the sources (discoveryPipeline.js runDiscovery header).
      serverPhases: true,
      // manualTest must be able to exercise the SAME runType:'scheduled' path
      // the real daily cron will use, WITHOUT requiring the persisted
      // prospect_settings.daily_run_enabled to be temporarily flipped on -
      // daily_run_enabled:true here is a one-off override inside
      // runDiscovery()'s in-memory settings object for THIS call only (see
      // settingsOverride's own header in discoveryPipeline.js), never
      // written to the database. A real scheduled cron trigger never sends
      // manualTest (phase23_prospecting_cron.sql always POSTs an empty
      // body), so this has zero effect on whether the real daily schedule
      // is gated - that gate is still the persisted column, checked exactly
      // as before for every non-manualTest scheduled invocation. Combined
      // with dryRun above and the tiny budget below, a manualTest run can
      // exercise the scheduled path but can never write a real lead, never
      // exceed 3 candidates/2 external requests, and never itself enables
      // anything persisted.
      settingsOverride: manualTest
        ? { daily_run_enabled: true, max_candidates_per_source_per_run: 3, max_external_requests_per_run: 2, run_timeout_ms: 60000 }
        : null,
    })
    const durationMs = Date.now() - startedAt

    if (run.skipped) {
      console.log('prospect-discovery: skipped', run.reason)
      return jsonResponse({ ok: true, skipped: true, reason: run.reason, duration_ms: durationMs })
    }

    // Never return candidate names/contact data - counts and the run id
    // only, same "no unnecessary PII" discipline as automation-reconcile.
    const response = {
      ok: true,
      run_id: run.id,
      run_type: run.run_type,
      status: run.status,
      dry_run: run.summary?.dryRun ?? false,
      would_promote_count: run.summary?.wouldPromoteCount ?? 0,
      external_requests_used: run.summary?.externalRequestsUsed ?? 0,
      external_request_budget: run.summary?.externalRequestBudget ?? null,
      timed_out: run.summary?.timedOut ?? false,
      candidates_found: run.candidates_found,
      candidates_created: run.candidates_created,
      candidates_updated: run.candidates_updated,
      candidates_promoted: run.candidates_promoted,
      duplicates_detected: run.duplicates_detected,
      errors_count: run.errors_count,
      items_not_processed: run.summary?.itemsNotProcessed ?? 0,
      site_verification: run.summary?.siteVerification ?? null,
      lead_site_search: run.summary?.leadSiteSearch ?? null,
      emails_found_today_before: run.summary?.emailsFoundTodayBefore ?? null,
      emails_found_today_after: run.summary?.emailsFoundTodayAfter ?? null,
      daily_email_target: run.summary?.dailyEmailTarget ?? null,
      duration_ms: durationMs,
    }

    console.log('prospect-discovery: finish', JSON.stringify(response))
    return jsonResponse(response, 200)
  } catch (err) {
    const durationMs = Date.now() - startedAt
    console.error('prospect-discovery: failed', err instanceof Error ? err.message : 'unknown_error', `${durationMs}ms`)
    return jsonResponse({ ok: false, error: 'discovery_failed', duration_ms: durationMs }, 500)
  }
})
