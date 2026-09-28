import { detectContactPoints, normalizeMobile } from './contactPoints.js'
import { maskRecipient } from './sendGate.js'
import { normalizeReply } from '../replyIntelligence/normalizeReply.js'
import { classifyReply } from '../replyIntelligence/classifyReply.js'
import { processInboundReply } from '../replyIntelligence/replyProcessor.js'

// ---------------------------------------------------------------------------
// WhatsApp Cloud API webhook (whatsapp-webhook Edge Function). Meta signs
// every POST with X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(app
// secret, raw body)); nothing is applied unless it verifies.
//
// statuses[] - sent / delivered / read / failed for a message we sent. They
//   update the matching channel_outreach_messages row (and the manual
//   send's outreach_attempts row) by provider message id. Only these
//   callbacks ever make a row 'delivered' - the send API's acceptance never
//   does. A status never moves backwards.
// messages[] - an inbound message. It goes through the existing reply
//   pipeline (replyProcessor.js -> inbound_replies) for every lead with that
//   number. An opt-out («توقف», «لغو», stop, unsubscribe, or any reply the
//   reply classifier reads as do_not_contact) is confirmed right away, which
//   sets sales_leads.do_not_contact - the same CRM opt-out every channel
//   already honours - and withdraws the number's queued introductions.
//   Any other reply is stored unconfirmed for the admin's reply inbox.
// Every event is recorded once in whatsapp_provider_events (numbers masked,
// no raw payload); a retried delivery of the same event is a no-op.
// Pure except handleWhatsAppWebhook(), which gets the Supabase client.
// ---------------------------------------------------------------------------

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function signMetaPayload({ appSecret, body }) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `sha256=${bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))}`
}

// -> { ok: true } | { ok: false, reason }. Never throws.
export async function verifyMetaSignature({ appSecret, body, signature }) {
  if (!appSecret) return { ok: false, reason: 'no_secret' }
  if (!signature) return { ok: false, reason: 'missing_signature' }
  const expected = await signMetaPayload({ appSecret, body })
  return timingSafeEqual(String(signature).trim().toLowerCase(), expected) ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

// GET handshake when the webhook is registered in the Meta app dashboard.
// -> the challenge to echo back, or null.
export function verifySubscription({ mode, token, challenge, verifyToken }) {
  if (!verifyToken || mode !== 'subscribe' || !token || token !== verifyToken) return null
  return challenge ?? ''
}

const OPT_OUT_WORDS = new Set(['توقف', 'لغو', 'stop', 'unsubscribe'])

function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‎‏]/g, ' ')
    .toLowerCase()
    .replace(/[«»"'.!؟?،,:;()[\]{}\-_*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// An opt-out keyword alone or in a short message ("لغو لطفا", "STOP"), or
// any reply the existing classifier reads as do_not_contact. Leaning towards
// opt-out is the safe direction: the worst case is one lead not messaged.
export function isOptOutMessage(text) {
  const normalized = normalizeText(text)
  if (!normalized) return false
  const words = normalized.split(' ')
  if (words.length <= 3 && words.some((w) => OPT_OUT_WORDS.has(w))) return true
  return classifyReply(normalizeReply(String(text))).intentKey === 'do_not_contact'
}

export function inboundText(message) {
  if (message?.type === 'text') return message.text?.body || ''
  if (message?.type === 'button') return message.button?.text || message.button?.payload || ''
  if (message?.type === 'interactive') return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || ''
  return ''
}

// Higher rank wins; equal or lower is a no-op. A failure after delivery is ignored.
const STATUS_RANK = { accepted: 0, sent: 1, failed: 2, delivered: 2, read: 3 }
export const WHATSAPP_STATUSES = ['sent', 'delivered', 'read', 'failed']

export function statusRank(status) {
  return status == null ? -1 : (STATUS_RANK[status] ?? -1)
}

function occurredAt(timestamp) {
  const n = Number(timestamp)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString()
}

async function alreadyRecorded(client, providerEventId) {
  const { data, error } = await client.from('whatsapp_provider_events').select('id').eq('provider_event_id', providerEventId)
  if (error) throw error
  return (data || []).length > 0
}

async function recordEvent(client, row) {
  const { error } = await client.from('whatsapp_provider_events').upsert([row], { onConflict: 'provider_event_id', ignoreDuplicates: true }).select('id')
  if (error) throw error
}

async function applyStatus(client, st, result) {
  const status = String(st?.status || '')
  if (!st?.id || !WHATSAPP_STATUSES.includes(status)) return
  const providerEventId = `status:${st.id}:${status}`
  if (await alreadyRecorded(client, providerEventId)) {
    result.duplicates += 1
    return
  }
  const at = occurredAt(st.timestamp)
  const err = st.errors?.[0] || null
  const errorCode = err?.code != null ? String(err.code) : null
  const errorTitle = err ? String(err.title || err.message || '').slice(0, 300) : null
  let applied = 0

  const { data: rows, error } = await client.from('channel_outreach_messages').select('*').eq('provider_message_id', st.id)
  if (error) throw error
  for (const row of rows || []) {
    if (statusRank(status) <= statusRank(row.provider_status)) continue
    const patch = { provider_status: status, provider_status_at: at, updated_at: new Date().toISOString() }
    if (status === 'delivered' || status === 'read') Object.assign(patch, { status: 'delivered', delivered_at: row.delivered_at || at })
    else if (status === 'failed') Object.assign(patch, { status: 'failed', error_code: errorCode, error_message: errorTitle })
    else if (status === 'sent' && ['sending', 'uncertain'].includes(row.status)) Object.assign(patch, { status: 'sent', sent_at: row.sent_at || at })
    const { error: updateError } = await client.from('channel_outreach_messages').update(patch).eq('id', row.id)
    if (updateError) throw updateError
    const { error: eventError } = await client.from('channel_outreach_events').insert({ message_id: row.id, lead_id: row.lead_id, channel: 'whatsapp', event: `provider_${status}`, detail: { errorCode } })
    if (eventError) throw eventError
    applied += 1
  }

  const { data: attempts, error: attemptsError } = await client.from('outreach_attempts').select('id, provider_status').eq('external_message_id', st.id)
  if (attemptsError) throw attemptsError
  for (const attempt of attempts || []) {
    if (statusRank(status) <= statusRank(attempt.provider_status)) continue
    const { error: updateError } = await client.from('outreach_attempts').update({ provider_status: status, provider_status_at: at }).eq('id', attempt.id)
    if (updateError) throw updateError
    applied += 1
  }

  await recordEvent(client, {
    provider_event_id: providerEventId,
    kind: 'status',
    provider_message_id: st.id,
    status,
    number_masked: maskRecipient(st.recipient_id ? `+${st.recipient_id}` : null, 'whatsapp'),
    error_code: errorCode,
    error_title: errorTitle,
    applied: applied > 0 ? 'updated' : 'no_matching_message',
    occurred_at: at,
  })
  result.statuses += 1
  if (applied > 0) result.applied += 1
}

async function leadsForNumber(client, number) {
  const { data: rows, error } = await client.from('channel_outreach_messages').select('*').eq('channel', 'whatsapp').eq('normalized_destination', number)
  if (error) throw error
  const ids = new Set((rows || []).map((r) => r.lead_id).filter(Boolean))
  const { data: leads, error: leadsError } = await client.from('sales_leads').select('id, mobile, phone')
  if (leadsError) throw leadsError
  for (const lead of leads || []) {
    if (detectContactPoints(lead).whatsapp?.destination === number) ids.add(lead.id)
  }
  return { leadIds: [...ids], rows: rows || [] }
}

async function applyInbound(client, message, result) {
  if (!message?.id) return
  const providerEventId = `message:${message.id}`
  if (await alreadyRecorded(client, providerEventId)) {
    result.duplicates += 1
    return
  }
  const number = normalizeMobile(message.from ? `+${String(message.from).replace(/^\+/, '')}` : null)
  const text = inboundText(message)
  const optOut = Boolean(text) && isOptOutMessage(text)
  const { leadIds, rows } = number ? await leadsForNumber(client, number) : { leadIds: [], rows: [] }
  const numberMasked = maskRecipient(number || (message.from ? `+${message.from}` : null), 'whatsapp')

  for (const leadId of leadIds) {
    await processInboundReply(client, {
      leadId,
      channel: 'whatsapp',
      source: 'provider_webhook',
      rawMessage: text || `[${message.type || 'message'}]`,
      externalMessageId: message.id,
      providerPayload: { type: message.type || null, from: numberMasked, timestamp: message.timestamp || null },
      createdBy: null,
      confirmation: optOut ? { finalIntentKey: 'do_not_contact', confirmedBy: null, note: 'لغو دریافت از طریق واتساپ - ثبت خودکار.' } : undefined,
    })
  }

  if (optOut) {
    let leadRows = []
    if (leadIds.length > 0) {
      const { data, error } = await client.from('channel_outreach_messages').select('*').in('lead_id', leadIds)
      if (error) throw error
      leadRows = data || []
    }
    const pending = [...rows, ...leadRows].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i && ['queued', 'waiting_provider'].includes(r.status))
    for (const row of pending) {
      const { data: updated, error: updateError } = await client
        .from('channel_outreach_messages')
        .update({ status: 'opted_out', updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .in('status', ['queued', 'waiting_provider'])
        .select('*')
      if (updateError) throw updateError
      if (updated?.length) {
        const { error: eventError } = await client.from('channel_outreach_events').insert({ message_id: row.id, lead_id: row.lead_id, channel: row.channel, event: 'opted_out', detail: { via: 'whatsapp_reply' } })
        if (eventError) throw eventError
      }
    }
    result.optOuts += 1
    result.leadsOptedOut += leadIds.length
  }

  await recordEvent(client, {
    provider_event_id: providerEventId,
    kind: 'message',
    provider_message_id: message.id,
    status: message.type || null,
    number_masked: numberMasked,
    opt_out: optOut,
    lead_ids: leadIds,
    applied: leadIds.length === 0 ? 'no_matching_lead' : optOut ? 'opted_out' : 'reply_recorded',
    occurred_at: occurredAt(message.timestamp),
  })
  result.messages += 1
}

// payload = the parsed webhook body. -> counts of what was applied.
export async function handleWhatsAppWebhook(client, payload) {
  const result = { statuses: 0, applied: 0, messages: 0, optOuts: 0, leadsOptedOut: 0, duplicates: 0 }
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field !== 'messages') continue
      const value = change.value || {}
      for (const st of value.statuses || []) await applyStatus(client, st, result)
      for (const message of value.messages || []) await applyInbound(client, message, result)
    }
  }
  return result
}
