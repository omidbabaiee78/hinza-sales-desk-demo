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
//   3. SEND - only when outreach_enabled, the channel is not in test mode
//      (WhatsApp: whatsapp_test_mode; Bale: provider_test_mode), inside the
//      contact window, and the channel's provider is ready. The lead is
//      re-checked, then each row is claimed with the SAME claim the manual
//      send uses (channelClaims.js -> claim_channel_send: one intro per
//      number and lead, opt-outs, the 24h gap after the first email, the
//      daily cap - WhatsApp never above 20) so a row is sent by exactly one
//      run or admin. An exception or unknown outcome leaves the row
//      'uncertain' - never retried automatically.
// Every change is appended to channel_outreach_events (the attempt
// history). A sent intro is logged on the lead's timeline but never stamps
// last_contact_at, so the email intro still reaches the lead (and vice
// versa). Nothing here writes the email tables or outreach_attempts.
// ---------------------------------------------------------------------------

import { evaluateContactWindow } from './contactWindow.js'
import { productHintsFor } from './autoEmail.js'
import {
  CHANNELS,
  CHANNEL_LABELS,
  channelProviderReadiness,
  composeChannelIntro,
  leadIntroBlock,
  messageKey,
  replySets,
  resolveChannelLimits,
} from './channelOutreach.js'
import { detectContactPoints, normalizeMobile } from './contactPoints.js'
import { safirPhoneNumber } from './providers/baleProvider.js'
import { describeTemplateSend, introTemplateParameters } from './providers/whatsappProvider.js'
import { channelTestMode, maskRecipient } from './sendGate.js'
import { channelOutcome, claimChannelSend, recordChannelSendResult } from './channelClaims.js'

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
  const report = { status: 'completed', reason: null, leadsScanned: 0, registered: 0, requeued: 0, parked: 0, optedOut: 0, sent: 0, failed: 0, uncertain: 0, deferred: 0, notSending: null, testModeChannels: [], readiness: {}, details: [] }

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
    const [leads, messages, replies, recipients, candidates, attempts] = await Promise.all([
      fetchAll(client, 'sales_leads'),
      fetchAll(client, 'channel_outreach_messages'),
      fetchAll(client, 'inbound_replies', 'lead_id, predicted_intent, final_intent'),
      fetchAll(client, 'email_outreach_recipients', 'lead_id, status'),
      fetchAll(client, 'prospect_candidates'),
      fetchAll(client, 'outreach_attempts', 'lead_id, channel, purpose, status, test_mode'),
    ])
    report.leadsScanned = leads.length
    const sets = replySets(replies, recipients, attempts)
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
    report.testModeChannels = CHANNELS.filter((c) => channelTestMode(settings, c))
    const queued = [...byKey.values()].filter((r) => r.status === 'queued').sort((a, b) => String(a.queued_at || a.created_at).localeCompare(String(b.queued_at || b.created_at)))
    const sendable = queued.filter((r) => !report.testModeChannels.includes(r.channel))
    if (queued.length === 0) report.notSending = 'پیامی در صف واتساپ/بله نیست.'
    else if (!settings.outreach_enabled) report.notSending = 'ارسال واقعی در تنظیمات غیرفعال است.'
    else if (sendable.length === 0) report.notSending = `حالت آزمایشی ${report.testModeChannels.map((c) => CHANNEL_LABELS[c]).join('، ')} روشن است؛ ارسال خودکار انجام نمی‌شود.`
    else if (!evaluateContactWindow(settings, now).withinWindow) report.notSending = 'خارج از بازه زمانی مجاز تماس.'
    if (report.notSending) return await finish('completed')

    const { maxPerRun } = resolveChannelLimits(settings)
    const sentPerChannel = Object.fromEntries(CHANNELS.map((c) => [c, 0]))
    const capped = new Set()
    for (const row of sendable) {
      if (capped.has(row.channel) || sentPerChannel[row.channel] >= maxPerRun) continue
      const lead = leadById.get(row.lead_id)
      if (!lead || !readinessFor(row.channel, row.destination_kind).ready) continue
      if (leadIntroBlock(lead, sets)) continue
      const claim = await claimChannelSend(client, {
        channel: row.channel,
        destination: row.normalized_destination,
        destinationKind: row.destination_kind,
        leadId: lead.id,
        source: trigger === 'admin' ? 'auto_admin' : 'auto',
      })
      if (claim.result === 'cap_reached') {
        capped.add(row.channel)
        continue
      }
      if (claim.result === 'gap') {
        report.deferred += 1
        report.details.push({ company: lead.company_name || '—', channel: row.channel, outcome: 'deferred', until: claim.until })
        continue
      }
      if (claim.result === 'opted_out') {
        const updated = await transition(client, row, ['queued', 'waiting_provider'], { status: 'opted_out' })
        if (updated) {
          report.optedOut += 1
          await logEvent(client, updated, 'opted_out')
        }
        continue
      }
      if (claim.result !== 'claimed') continue
      sentPerChannel[row.channel] += 1

      const { industryLabels, products } = productHintsFor({ candidate: candidateByLead.get(lead.id) || null })
      const text = composeChannelIntro({ lead, industryLabels, products })
      const wa = credentials.whatsapp || {}
      const snapshot =
        row.channel === 'whatsapp'
          ? describeTemplateSend({ templateName: wa.templateName, languageCode: wa.languageCode, bodyParameters: introTemplateParameters(wa.params, lead) })
          : text
      let result
      try {
        result = await sendThroughProvider(providers, row, lead, text)
      } catch (err) {
        result = { ok: false, uncertain: true, errorCode: 'send_exception', errorMessage: err instanceof Error ? err.message : 'unknown_error' }
      }
      const { status } = await recordChannelSendResult(client, { messageId: row.id, leadId: lead.id, channel: row.channel, result, snapshot })
      row.status = status
      report[status] += 1
      if (status === 'sent' && row.channel === 'whatsapp') {
        const { error: activityError } = await client.from('lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'whatsapp',
          note: `پیام معرفی ${CHANNEL_LABELS[row.channel]} (${result?.provider || '—'}) - سرویس پذیرفت؛ تحویل تأیید نشده. شناسه: ${result?.providerMessageId || '—'}`,
          created_by: null,
        })
        if (activityError) throw activityError
      }
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

// One controlled WhatsApp message to the admin's own test number
// (WHATSAPP_TEST_RECIPIENT) - the approved intro template, filled with a
// sample company name. Never touches the queue, a lead, the daily cap or
// any setting (it does not need whatsapp_provider_enabled, so the waiting
// rows stay parked); recorded as an admin run. Accepted is reported as
// accepted - delivery only ever comes from the webhook.
export async function runWhatsAppTestSend(client, { credentials = {}, providers = {}, testRecipient = null } = {}) {
  const recipient = normalizeMobile(testRecipient)
  const wa = credentials.whatsapp || {}
  const missing = []
  if (!wa.accessToken || !wa.phoneNumberId) missing.push('credentials_missing')
  if (!wa.templateName) missing.push('template_missing')
  if (!recipient) missing.push('test_recipient_missing')
  const report = { mode: 'whatsapp_test_send', recipientMasked: maskRecipient(recipient, 'whatsapp'), missing, outcome: null, providerMessageId: null, errorCode: null, errorMessage: null }
  const { data: runRow, error: runError } = await client.from('channel_outreach_runs').insert({ trigger: 'admin', status: 'running' }).select('*').single()
  if (runError) throw runError
  if (missing.length === 0) {
    const lead = { company_name: 'شرکت نمونه (آزمایشی)' }
    let result
    try {
      result = await providers.whatsapp({ recipient, lead, text: '' })
    } catch (err) {
      result = { ok: false, uncertain: true, errorCode: 'send_exception', errorMessage: err instanceof Error ? err.message : 'unknown_error' }
    }
    report.outcome = OUTCOME_LABEL[channelOutcome(result)]
    report.providerMessageId = result?.providerMessageId || null
    report.errorCode = result?.errorCode || null
    report.errorMessage = result?.errorMessage || null
    report.snapshot = describeTemplateSend({ templateName: wa.templateName, languageCode: wa.languageCode, bodyParameters: introTemplateParameters(wa.params, lead) })
  }
  const status = missing.length === 0 && report.outcome !== 'failed' ? 'completed' : 'failed'
  await client.from('channel_outreach_runs').update({ status, finished_at: new Date().toISOString(), sent: report.outcome === 'accepted' ? 1 : 0, failed: report.outcome === 'failed' ? 1 : 0, report }).eq('id', runRow.id)
  return { runId: runRow.id, ...report }
}

const OUTCOME_LABEL = { accepted: 'accepted', rejected: 'failed', unknown: 'uncertain' }
