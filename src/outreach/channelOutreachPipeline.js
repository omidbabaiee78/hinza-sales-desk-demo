// ---------------------------------------------------------------------------
// WhatsApp / Bale introduction runner (outreach-channels Edge Function, cron
// or admin "Run now"). Rules and states: channelOutreach.js. The client,
// credentials and provider send functions are passed in, so Node checks run
// it against a fake DB with mocked providers.
//
// Each run:
//   1. REGISTER - for every registered lead with a usable WhatsApp/Bale
//      destination, insert one channel_outreach_messages row per (channel,
//      normalized destination) if none exists (insert ... on conflict do
//      nothing - two concurrent runs, or the same company from two sources,
//      still produce one row). Status: opted_out, queued (provider ready)
//      or waiting_provider (not configured - nothing will be sent).
//   2. RECONCILE - waiting_provider <-> queued as providers are configured
//      or switched off; queued/waiting rows of leads that opted out ->
//      opted_out.
//   3. SEND - only when outreach_enabled, not provider_test_mode, inside
//      the contact window, and the channel's provider is ready. Each row is
//      claimed with claim_channel_outreach_message() (queued -> sending
//      under a lock, with the per-channel daily cap) so a row is sent by
//      exactly one run. An exception during the provider call leaves the
//      row 'uncertain' - never retried automatically.
// Every change is appended to channel_outreach_events (the attempt
// history). Nothing here touches the email tables or outreach_attempts.
// ---------------------------------------------------------------------------

import { evaluateContactWindow } from './contactWindow.js'
import { productHintsFor } from './autoEmail.js'
import {
  CHANNELS,
  channelProviderReadiness,
  composeChannelIntro,
  leadIntroBlock,
  messageKey,
  replySets,
  resolveChannelLimits,
} from './channelOutreach.js'
import { detectContactPoints } from './contactPoints.js'
import { safirPhoneNumber } from './providers/baleProvider.js'

async function fetchAll(client, table, columns = '*') {
  const { data, error } = await client.from(table).select(columns)
  if (error) throw error
  return data || []
}

async function logEvent(client, messageRow, event, detail = null) {
  const { error } = await client.from('channel_outreach_events').insert({ message_id: messageRow.id, lead_id: messageRow.lead_id, channel: messageRow.channel, event, detail })
  if (error) throw error
}

// Conditional status change - applies only while the row is still in one of
// `fromStatuses`, so a concurrent run's change is never overwritten.
async function transition(client, row, fromStatuses, patch) {
  const { data, error } = await client
    .from('channel_outreach_messages')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .in('status', fromStatuses)
    .select('*')
  if (error) throw error
  return data?.[0] || null
}

// providers: { whatsapp({ recipient, lead, text }), baleSafir({ phoneNumber, text, requestId }),
// baleBot({ chatId, text }) } -> normalized provider result. Built by the
// Edge Function from real credentials; mocked in checks.
async function sendThroughProvider(providers, row, lead, text) {
  if (row.channel === 'whatsapp') return providers.whatsapp({ recipient: row.normalized_destination, lead, text })
  if (row.destination_kind === 'bale_chat_id') return providers.baleBot({ chatId: row.normalized_destination, text })
  return providers.baleSafir({ phoneNumber: safirPhoneNumber(row.normalized_destination), text, requestId: `intro:${row.id}` })
}

export async function runChannelOutreachCycle(client, { trigger = 'cron', credentials = {}, providers = {}, now = new Date() } = {}) {
  const report = { status: 'completed', reason: null, leadsScanned: 0, registered: 0, requeued: 0, parked: 0, optedOut: 0, sent: 0, failed: 0, uncertain: 0, notSending: null, readiness: {}, details: [] }

  const { data: runRow, error: runError } = await client.from('channel_outreach_runs').insert({ trigger, status: 'running' }).select('*').single()
  if (runError) throw runError
  async function finish(status) {
    report.status = status
    await client.from('channel_outreach_runs').update({ status, finished_at: new Date().toISOString(), sent: report.sent, failed: report.failed, registered: report.registered, report }).eq('id', runRow.id)
    return { runId: runRow.id, ...report }
  }

  try {
    const { data: settings, error: settingsError } = await client.from('automation_settings').select('*').eq('id', 1).single()
    if (settingsError) throw settingsError
    const [leads, messages, replies, recipients, candidates] = await Promise.all([
      fetchAll(client, 'sales_leads'),
      fetchAll(client, 'channel_outreach_messages'),
      fetchAll(client, 'inbound_replies', 'lead_id, predicted_intent, final_intent'),
      fetchAll(client, 'email_outreach_recipients', 'lead_id, status'),
      fetchAll(client, 'prospect_candidates'),
    ])
    report.leadsScanned = leads.length
    const sets = replySets(replies, recipients)
    const leadById = new Map(leads.map((l) => [l.id, l]))
    const candidateByLead = new Map(candidates.filter((c) => c.promoted_lead_id).map((c) => [c.promoted_lead_id, c]))
    const byKey = new Map(messages.map((m) => [messageKey(m.channel, m.normalized_destination), m]))
    const readinessFor = (channel, kind) => channelProviderReadiness(channel, kind, settings, credentials)
    for (const channel of CHANNELS) report.readiness[channel] = readinessFor(channel, channel === 'bale' ? 'mobile_unverified' : 'mobile').reasons

    // 1. Register.
    for (const lead of leads) {
      const block = leadIntroBlock(lead, sets)
      if (block && block !== 'opted_out') continue
      const contacts = detectContactPoints(lead)
      for (const channel of CHANNELS) {
        const point = contacts[channel]
        if (!point || byKey.has(messageKey(channel, point.destination))) continue
        const status = block === 'opted_out' ? 'opted_out' : readinessFor(channel, point.kind).ready ? 'queued' : 'waiting_provider'
        const { data, error } = await client
          .from('channel_outreach_messages')
          .upsert(
            [
              {
                channel,
                normalized_destination: point.destination,
                destination_kind: point.kind,
                lead_id: lead.id,
                contact_source: point.source,
                contact_source_detail: point.sourceDetail,
                status,
                queued_at: status === 'queued' ? now.toISOString() : null,
              },
            ],
            { onConflict: 'channel,normalized_destination', ignoreDuplicates: true },
          )
          .select('*')
        if (error) throw error
        const row = data?.[0]
        if (!row) continue // another run or lead registered this destination first
        byKey.set(messageKey(channel, point.destination), row)
        report.registered += 1
        await logEvent(client, row, 'registered', { status, source: point.source })
      }
    }

    // 2. Reconcile with provider readiness and opt-outs.
    for (const row of byKey.values()) {
      if (row.status !== 'waiting_provider' && row.status !== 'queued') continue
      const lead = leadById.get(row.lead_id)
      if (!lead || leadIntroBlock(lead, sets) === 'opted_out') {
        const updated = await transition(client, row, ['waiting_provider', 'queued'], { status: 'opted_out' })
        if (updated) {
          Object.assign(row, updated)
          report.optedOut += 1
          await logEvent(client, row, 'opted_out')
        }
        continue
      }
      const ready = readinessFor(row.channel, row.destination_kind).ready
      if (ready && row.status === 'waiting_provider') {
        const updated = await transition(client, row, ['waiting_provider'], { status: 'queued', queued_at: now.toISOString() })
        if (updated) {
          Object.assign(row, updated)
          report.requeued += 1
          await logEvent(client, row, 'queued')
        }
      } else if (!ready && row.status === 'queued') {
        const updated = await transition(client, row, ['queued'], { status: 'waiting_provider' })
        if (updated) {
          Object.assign(row, updated)
          report.parked += 1
          await logEvent(client, row, 'waiting_provider')
        }
      }
    }

    // 3. Send.
    const queued = [...byKey.values()].filter((r) => r.status === 'queued').sort((a, b) => String(a.queued_at || a.created_at).localeCompare(String(b.queued_at || b.created_at)))
    if (queued.length === 0) report.notSending = 'پیامی در صف واتساپ/بله نیست.'
    else if (!settings.outreach_enabled) report.notSending = 'ارسال واقعی در تنظیمات غیرفعال است.'
    else if (settings.provider_test_mode) report.notSending = 'حالت آزمایشی سرویس‌ها روشن است؛ ارسال خودکار انجام نمی‌شود.'
    else if (!evaluateContactWindow(settings, now).withinWindow) report.notSending = 'خارج از بازه زمانی مجاز تماس.'
    if (report.notSending) return await finish('completed')

    const { maxPerRun } = resolveChannelLimits(settings)
    const sentPerChannel = Object.fromEntries(CHANNELS.map((c) => [c, 0]))
    const capped = new Set()
    for (const row of queued) {
      if (capped.has(row.channel) || sentPerChannel[row.channel] >= maxPerRun) continue
      const lead = leadById.get(row.lead_id)
      if (!lead || !readinessFor(row.channel, row.destination_kind).ready) continue
      const { data: claim, error: claimError } = await client.rpc('claim_channel_outreach_message', { p_id: row.id })
      if (claimError) throw claimError
      if (claim === 'cap_reached') {
        capped.add(row.channel)
        continue
      }
      if (claim !== 'claimed') continue
      sentPerChannel[row.channel] += 1

      const { industryLabels, products } = productHintsFor({ candidate: candidateByLead.get(lead.id) || null })
      const text = composeChannelIntro({ lead, industryLabels, products })
      let result
      try {
        result = await sendThroughProvider(providers, row, lead, text)
      } catch (err) {
        result = { ok: false, uncertain: true, errorCode: 'send_exception', errorMessage: err instanceof Error ? err.message : 'unknown_error' }
      }
      const status = result?.ok ? 'sent' : result?.uncertain || result?.errorCode === 'timeout' ? 'uncertain' : 'failed'
      const updated = await transition(client, row, ['sending'], {
        status,
        provider: result?.provider || null,
        provider_message_id: result?.providerMessageId || null,
        error_code: result?.errorCode || null,
        error_message: result?.errorMessage || null,
        message_snapshot: text,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      })
      if (updated) Object.assign(row, updated)
      report[status] += 1
      await logEvent(client, row, status, { provider: result?.provider || null, providerMessageId: result?.providerMessageId || null, errorCode: result?.errorCode || null })
      report.details.push({ company: lead.company_name || '—', channel: row.channel, outcome: status, errorCode: result?.errorCode || null })
    }
    if (capped.size > 0) report.notSending = `سقف روزانه برای ${[...capped].join('، ')} پر شد.`
    return await finish('completed')
  } catch (err) {
    report.reason = err instanceof Error ? err.message : 'unknown_error'
    await finish('failed')
    throw err
  }
}
