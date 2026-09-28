// ---------------------------------------------------------------------------
// The ONE claim + result record for a real WhatsApp/Bale introduction,
// shared by the automatic runner (channelOutreachPipeline.js) and the manual
// admin send (sendPipeline.js attemptSend), so both paths hit the same
// authoritative checks: claim_channel_send() in the database
// (phase37_whatsapp_outreach.sql) decides - under one lock - whether this
// (channel, destination, lead) may be sent now, and moves the
// channel_outreach_messages row to 'sending'. Only the caller that got
// 'claimed' ever calls the provider.
// ---------------------------------------------------------------------------

export const CHANNEL_CLAIM_REASONS = {
  duplicate: 'این مقصد یا این سرنخ قبلاً پیام معرفی این کانال را گرفته است (یا ارسال دیگری در جریان است) - ارسال تکراری مجاز نیست.',
  opted_out: 'این سرنخ درخواست عدم تماس داده است.',
  closed: 'این سرنخ تبدیل‌شده یا ازدست‌رفته است.',
  no_lead: 'سرنخ مرتبط یافت نشد.',
  gap: 'کمتر از ۲۴ ساعت از اولین ایمیل این سرنخ گذشته است - پیام واتساپ بعد از این فاصله ارسال می‌شود.',
  cap_reached: 'سقف روزانه پیام این کانال پر شده است.',
}

// -> { result: 'claimed'|'duplicate'|'opted_out'|'closed'|'no_lead'|'gap'|'cap_reached', id, until }
export async function claimChannelSend(client, { channel, destination, destinationKind, leadId, source, suggestionId = null }) {
  const { data, error } = await client.rpc('claim_channel_send', {
    p_channel: channel,
    p_destination: destination,
    p_destination_kind: destinationKind,
    p_lead_id: leadId,
    p_source: source,
    p_suggestion_id: suggestionId,
  })
  if (error) throw error
  return { result: data?.result || 'duplicate', id: data?.id || null, until: data?.until || null }
}

const VALID_OUTCOMES = new Set(['accepted', 'rejected', 'unknown'])

// Three-state outcome of a WhatsApp/Bale provider result. A valid explicit
// `outcome` (whatsappProvider.js sets one) is trusted; otherwise only a
// clean ok is accepted, a timeout/network error/exception is unknown, and
// anything else is a rejection.
export function channelOutcome(result) {
  if (VALID_OUTCOMES.has(result?.outcome)) return result.outcome
  if (result?.uncertain || result?.errorCode === 'timeout' || result?.errorCode === 'network_error') return 'unknown'
  return result?.ok ? 'accepted' : 'rejected'
}

// accepted -> sent (provider_status 'accepted': Meta took it; delivery only
// ever comes from the status webhook), rejected -> failed, unknown ->
// uncertain (never retried automatically).
export const OUTCOME_STATUS = { accepted: 'sent', rejected: 'failed', unknown: 'uncertain' }

// Records the provider result on the claimed row (only while it is still
// 'sending') and appends the history event. Returns the row status.
export async function recordChannelSendResult(client, { messageId, leadId, channel, result, snapshot = null }) {
  const outcome = channelOutcome(result)
  const status = OUTCOME_STATUS[outcome]
  const nowIso = new Date().toISOString()
  const { data, error } = await client
    .from('channel_outreach_messages')
    .update({
      status,
      provider: result?.provider || null,
      provider_message_id: result?.providerMessageId || null,
      provider_status: outcome === 'accepted' ? 'accepted' : outcome === 'rejected' ? 'rejected' : null,
      provider_status_at: nowIso,
      error_code: result?.errorCode || null,
      error_message: result?.errorMessage || null,
      message_snapshot: snapshot,
      sent_at: status === 'sent' ? nowIso : null,
      updated_at: nowIso,
    })
    .eq('id', messageId)
    .in('status', ['sending'])
    .select('*')
  if (error) throw error
  const { error: eventError } = await client.from('channel_outreach_events').insert({
    message_id: messageId,
    lead_id: leadId,
    channel,
    event: status,
    detail: { provider: result?.provider || null, providerMessageId: result?.providerMessageId || null, errorCode: result?.errorCode || null },
  })
  if (eventError) throw eventError
  return { status, outcome, row: data?.[0] || null }
}
