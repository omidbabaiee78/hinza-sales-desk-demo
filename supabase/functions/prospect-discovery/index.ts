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
import { runDiscovery, testSource } from '../../../src/prospecting/discoveryPipeline.js'

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
  // discovered/written - used by the admin UI's "تست منبع" button;
  // anything else (including the cron path, which never sends `mode`) does
  // a full discovery run.
  let sourceId: string | null = null
  let mode: string = 'run'
  try {
    const body = await req.json().catch(() => ({}))
    sourceId = body?.sourceId || null
    mode = body?.mode === 'health' ? 'health' : 'run'
  } catch {
    sourceId = null
  }

  if (mode === 'health' && !sourceId) {
    return jsonResponse({ ok: false, error: 'source_id_required_for_health_check' }, 400)
  }

  console.log('prospect-discovery: start', `actor=${auth.actorType}`, `mode=${mode}`, sourceId ? `source=${sourceId}` : 'all sources')

  try {
    if (mode === 'health') {
      const { result } = await testSource(client, sourceId as string)
      const durationMs = Date.now() - startedAt
      console.log('prospect-discovery: health check finished', JSON.stringify(result))
      return jsonResponse({ ok: true, mode: 'health', result, duration_ms: durationMs })
    }

    const runType = auth.actorType === 'cron' ? 'scheduled' : 'manual'
    const run = await runDiscovery(client, { sourceId, runType, createdBy: auth.userId })
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
      status: run.status,
      candidates_found: run.candidates_found,
      candidates_created: run.candidates_created,
      candidates_updated: run.candidates_updated,
      candidates_promoted: run.candidates_promoted,
      duplicates_detected: run.duplicates_detected,
      errors_count: run.errors_count,
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
