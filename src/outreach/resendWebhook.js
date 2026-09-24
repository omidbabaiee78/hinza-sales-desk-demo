import { normalizeEmail } from '../prospecting/normalization.js'

// ---------------------------------------------------------------------------
// Resend delivery webhooks (resend-webhook Edge Function). Resend signs every
// event with Svix: headers svix-id / svix-timestamp / svix-signature, and the
// signature is base64(HMAC-SHA256(secret, "<id>.<timestamp>.<raw body>"))
// where secret is the base64 part of the endpoint's "whsec_..." signing
// secret. An event is applied only after that check passes and only once per
// svix-id (email_provider_events.provider_event_id is unique).
//
// Handled: email.delivered, email.bounced, email.complained. They update the
// matching outreach_attempts row (external_message_id = data.email_id) and
// the address's email_outreach_recipients row. A hard (Permanent) bounce or
// a complaint suppresses the address - no send path emails it again - and a
// complaint also sets do_not_contact on every lead with that address. A
// status never moves backwards (a late "delivered" never hides a bounce).
// Pure except applyResendEvent(), which gets the Supabase client passed in.
// ---------------------------------------------------------------------------

export const RESEND_WEBHOOK_EVENTS = ['email.delivered', 'email.bounced', 'email.complained']
const TOLERANCE_SECONDS = 5 * 60

// Higher rank wins; equal rank is a no-op.
const STATUS_RANK = { sent: 0, delivery_delayed: 1, delivered: 2, bounced_transient: 2, opened: 3, clicked: 3, bounced: 4, complained: 5 }

export function statusRank(status) {
  return STATUS_RANK[status] ?? 0
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes) {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin)
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function signResendPayload({ secret, id, timestamp, body }) {
  const key = await crypto.subtle.importKey('raw', base64ToBytes(String(secret).replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  return bytesToBase64(mac)
}

// -> { ok: true } | { ok: false, reason }. Never throws.
export async function verifyResendSignature({ secret, id, timestamp, signature, body, now = new Date() }) {
  if (!secret) return { ok: false, reason: 'no_secret' }
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' }
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' }
  let expected
  try {
    expected = await signResendPayload({ secret, id, timestamp, body })
  } catch {
    return { ok: false, reason: 'bad_secret' }
  }
  // "v1,<sig> v1,<sig2>" - any matching v1 signature is accepted (secret rotation).
  const match = String(signature)
    .split(' ')
    .map((part) => part.split(','))
    .some(([version, sig]) => version === 'v1' && sig && timingSafeEqual(sig, expected))
  return match ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

// The status this event gives the email, or null for an event we ignore.
export function deliveryStatusFor(event) {
  if (event?.type === 'email.delivered') return 'delivered'
  if (event?.type === 'email.complained') return 'complained'
  if (event?.type === 'email.bounced') return String(event?.data?.bounce?.type || '').toLowerCase() === 'transient' ? 'bounced_transient' : 'bounced'
  return null
}

export function suppressionReasonFor(status) {
  if (status === 'bounced') return 'hard_bounce'
  if (status === 'complained') return 'complaint'
  return null
}

function recipientsOf(event) {
  const to = event?.data?.to
  return [...new Set((Array.isArray(to) ? to : [to]).map((v) => normalizeEmail(v)).filter(Boolean))]
}

// Applies one verified event. Idempotent: a repeated svix-id is recorded
// once and changes nothing. Returns { duplicate, status, attemptsUpdated,
// suppressed, leadsOptedOut }.
export async function applyResendEvent(client, { eventId, event, payloadText, now = new Date() }) {
  const status = deliveryStatusFor(event)
  const emailId = event?.data?.email_id || null
  const addresses = recipientsOf(event)
  const at = event?.created_at || now.toISOString()
  const result = { duplicate: false, status, attemptsUpdated: 0, suppressed: [], leadsOptedOut: 0 }

  const { data: inserted, error: insertError } = await client
    .from('email_provider_events')
    .upsert([{ provider_event_id: eventId, event_type: event?.type || 'unknown', email_id: emailId, recipients: addresses, status, occurred_at: at, payload: JSON.parse(payloadText) }], {
      onConflict: 'provider_event_id',
      ignoreDuplicates: true,
    })
    .select('id')
  if (insertError) throw insertError
  if (!inserted || inserted.length === 0) return { ...result, duplicate: true }
  if (!status) return result

  if (emailId) {
    const { data: attempts, error } = await client.from('outreach_attempts').select('id, provider_status').eq('external_message_id', emailId)
    if (error) throw error
    for (const attempt of attempts || []) {
      if (statusRank(status) <= statusRank(attempt.provider_status) && attempt.provider_status) continue
      const { error: updateError } = await client.from('outreach_attempts').update({ provider_status: status, provider_status_at: at }).eq('id', attempt.id)
      if (updateError) throw updateError
      result.attemptsUpdated += 1
    }
  }

  const suppression = suppressionReasonFor(status)
  for (const address of addresses) {
    const { data: rows, error } = await client.from('email_outreach_recipients').select('*').eq('normalized_email', address)
    if (error) throw error
    const row = rows?.[0]
    const patch = { updated_at: now.toISOString() }
    if (!row?.delivery_status || statusRank(status) > statusRank(row.delivery_status)) Object.assign(patch, { delivery_status: status, delivery_status_at: at })
    if (suppression && !row?.suppressed_at) Object.assign(patch, { suppressed_at: at, suppression_reason: suppression })
    if (row) {
      const { error: updateError } = await client.from('email_outreach_recipients').update(patch).eq('normalized_email', address)
      if (updateError) throw updateError
    } else {
      // An address emailed outside the automatic intro (e.g. the manual
      // first-email action): record it so it is never auto-emailed again.
      const { error: upsertError } = await client
        .from('email_outreach_recipients')
        .upsert([{ normalized_email: address, status: 'sent', provider_message_id: emailId, note: 'from resend webhook', ...patch }], { onConflict: 'normalized_email' })
      if (upsertError) throw upsertError
    }
    if (patch.suppressed_at) result.suppressed.push(address)

    if (status === 'complained') {
      const { data: leads, error: leadsError } = await client.from('sales_leads').select('id, email, do_not_contact').eq('do_not_contact', false)
      if (leadsError) throw leadsError
      for (const lead of (leads || []).filter((l) => normalizeEmail(l.email) === address)) {
        const { error: dncError } = await client.from('sales_leads').update({ do_not_contact: true }).eq('id', lead.id)
        if (dncError) throw dncError
        result.leadsOptedOut += 1
      }
    }
  }
  return result
}
