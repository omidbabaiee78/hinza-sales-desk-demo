// Automatic first-introduction email - server-side run. Runs
// runAutoEmailCycle() (src/outreach/autoEmailPipeline.js), which sends
// every email through the SAME attemptSend() pipeline outreach-send uses
// (send gate, atomic claim, idempotency key, opt-out footer).
//
// Does nothing unless automation_settings.auto_email_enabled = true (the
// switch on the «ارسال ایمیل» page) and the existing outreach_enabled /
// email_provider_enabled switches are on. Queues any time; sends only inside
// the contact window, at most auto_email_max_per_run per run, one intro per
// address. Email only - no WhatsApp/SMS. Needs phase28 + phase29 SQL.
//
// Two ways to authenticate, same pattern as outreach-shadow:
//   1. x-outreach-auto-email-secret = OUTREACH_AUTO_EMAIL_CRON_SECRET (a
//      DEDICATED secret) - the pg_cron schedule in
//      phase28_auto_email_cron.sql.
//   2. An approved admin's session - the "اجرای اکنون" button.
// Fail-closed: missing config -> 500, no valid auth -> 401.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { runAutoEmailCycle } from '../../../src/outreach/autoEmailPipeline.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const CRON_SECRET = Deno.env.get('OUTREACH_AUTO_EMAIL_CRON_SECRET')

// Same Resend secrets as outreach-send.
const EMAIL_API_KEY = Deno.env.get('RESEND_API_KEY')
const EMAIL_FROM_ADDRESS = Deno.env.get('EMAIL_FROM_ADDRESS')
const EMAIL_FROM_NAME = Deno.env.get('EMAIL_FROM_NAME')
const EMAIL_REPLY_TO = Deno.env.get('EMAIL_REPLY_TO')
const EMAIL_TEST_RECIPIENT = Deno.env.get('EMAIL_TEST_RECIPIENT')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-outreach-auto-email-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })
}

async function authenticate(req: Request, serviceClient: ReturnType<typeof createClient>) {
  const providedSecret = req.headers.get('x-outreach-auto-email-secret')
  if (CRON_SECRET && providedSecret && providedSecret === CRON_SECRET) return { actorType: 'cron' as const, userId: null as string | null }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !SUPABASE_URL || !ANON_KEY) return null
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } })
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return null
  // Same rule as outreach-send / private.is_admin(): role AND approval.
  const { data: profile } = await serviceClient.from('profiles').select('role, approval_status').eq('id', user.id).single()
  if (profile?.role !== 'admin' || profile?.approval_status !== 'approved') return null
  return { actorType: 'admin' as const, userId: user.id }
}

Deno.serve(async (req) => {
  const startedAt = Date.now()
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CRON_SECRET) {
    console.error('outreach-auto-email: missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or OUTREACH_AUTO_EMAIL_CRON_SECRET')
    return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const auth = await authenticate(req, client)
  if (!auth) {
    console.error('outreach-auto-email: rejected request - no valid credentials')
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  console.log('outreach-auto-email: start', `actor=${auth.actorType}`)
  try {
    const result = await runAutoEmailCycle(client, {
      trigger: auth.actorType,
      actorUserId: auth.userId,
      credentials: {
        email: EMAIL_API_KEY && EMAIL_FROM_ADDRESS ? { apiKey: EMAIL_API_KEY, fromAddress: EMAIL_FROM_ADDRESS, fromName: EMAIL_FROM_NAME, replyTo: EMAIL_REPLY_TO } : null,
      },
      testRecipients: { email: EMAIL_TEST_RECIPIENT || null },
    })
    const durationMs = Date.now() - startedAt
    // Counts go to the log; the full report (company names, outcomes) only
    // back to the caller - the admin's own "Run now" or pg_net - and into
    // the admin-only email_outreach_runs row.
    console.log(
      'outreach-auto-email: finish',
      JSON.stringify({ status: result.status, scanned: result.leadsScanned, queued: result.queued, sent: result.sent, duplicates: result.duplicatesSkipped, failed: result.failed, uncertain: result.uncertain, durationMs }),
    )
    return jsonResponse({ ok: true, ...result, duration_ms: durationMs }, 200)
  } catch (err) {
    console.error('outreach-auto-email: failed', err instanceof Error ? err.message : 'unknown_error')
    return jsonResponse({ ok: false, error: 'auto_email_failed', duration_ms: Date.now() - startedAt }, 500)
  }
})
