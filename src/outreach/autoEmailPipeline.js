// ---------------------------------------------------------------------------
// Email outreach runner (outreach-auto-email Edge Function, cron or admin
// "Run now"). The client, provider credentials and the delivery-status
// lookup are always passed in, so Node checks run it against a fake DB.
//
// Each run: 0. looks up missing emails on companies' own websites (always,
// see emailDiscovery.js); then, when automation_settings.auto_email_enabled
// is on:
//   1. classifies every lead (autoEmail.js buildEmailOutreachState),
//   2. QUEUES each eligible lead: one approved intro suggestion per lead
//      (dedupe_key email_intro:<lead>), or adopts an undecided email draft,
//   3. inside the contact window, SENDS queued intros - at most
//      auto_email_max_per_run per run and auto_email_daily_cap per Tehran
//      day - each only after winning the address claim in the database
//      (claim_email_outreach_recipient: unique address + daily cap, under
//      one lock), then
//      through attemptSend() (send gate, per-suggestion claim, idempotency
//      key, opt-out footer),
// and records the run in email_outreach_runs. An uncertain or failed send
// keeps its address claimed, so it is never retried automatically.
// ---------------------------------------------------------------------------

import { attemptSend } from './sendPipeline.js'
import { evaluateContactWindow } from './contactWindow.js'
import { normalizeEmail } from '../prospecting/normalization.js'
import { leadsDueForEmailLookup, lookupCompanyEmail } from './emailDiscovery.js'
import {
  MAX_QUEUE_PER_RUN,
  buildEmailOutreachState,
  composeAutoIntroEmail,
  countSentToday,
  resolveDailyCap,
  productHintsFor,
  resolveAutoEmailLimit,
} from './autoEmail.js'

async function fetchAll(client, table, columns = '*') {
  const { data, error } = await client.from(table).select(columns)
  if (error) throw error
  return data || []
}

function outcomeOf(result) {
  if (result.ok) return 'sent'
  if (result.reasons) return 'blocked'
  if (result.errorCode === 'record_write_failed' || result.status == null || /نامشخص/.test(result.errorMessage || '')) return 'uncertain'
  return 'failed'
}

function companyOf(lead) {
  return lead?.company_name || lead?.contact_name || '—'
}

async function queueEntry(client, entry, candidate, now) {
  const { lead } = entry
  const { industryLabels, products } = productHintsFor({ candidate })
  const { subject, message } = composeAutoIntroEmail({ companyName: lead.company_name || lead.contact_name, industryLabels, products })
  const nowIso = now.toISOString()
  const snapshot = { ...(entry.suggestion?.evidence_snapshot || {}), auto: true, recipientEmail: entry.email, industryLabelsUsed: industryLabels, productFitProducts: products }

  if (entry.suggestion) {
    // Adopt an undecided draft - conditional, so an admin decision or a
    // concurrent run always wins.
    const { data, error } = await client
      .from('prospect_outreach_suggestions')
      .update({ status: 'approved', approved_at: nowIso, approved_by: null, message_final: message, subject_draft: subject, evidence_used: 'auto_email', evidence_snapshot: { ...snapshot, adoptedFromDraft: true }, updated_at: nowIso })
      .eq('id', entry.suggestion.id)
      .eq('status', 'pending')
      .eq('send_status', 'not_sent')
      .select('*')
    if (error) throw error
    return data?.[0] || null
  }

  const { data, error } = await client
    .from('prospect_outreach_suggestions')
    .upsert(
      [
        {
          lead_id: lead.id,
          candidate_id: candidate?.id || null,
          run_id: null,
          dedupe_key: `email_intro:${lead.id}`,
          outreach_status: 'eligible',
          reasons: [],
          channel: 'email',
          fallback_channel: null,
          priority: null,
          message_draft: message,
          message_final: message,
          subject_draft: subject,
          evidence_used: 'auto_email',
          evidence_snapshot: snapshot,
          within_contact_window: null,
          suggested_send_at: nowIso,
          status: 'approved',
          approved_at: nowIso,
          approved_by: null,
          generated_at: nowIso,
        },
      ],
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select('*')
  if (error) throw error
  return data?.[0] || null
}

const EMAIL_LOOKUP_BATCH = 8
const EMAIL_LOOKUP_CONCURRENCY = 4

// Step 0: fill in missing emails from each company's own website (see
// emailDiscovery.js). Updates the in-memory lead too, so a found address
// is classified and queued in this same run.
async function runEmailLookup(client, { leads, candidateByLead, now, fetchPage, report }) {
  const due = leadsDueForEmailLookup(leads, now, EMAIL_LOOKUP_BATCH)
  const lookup = { checked: 0, found: 0, byStatus: {}, results: [] }
  report.emailLookup = lookup
  for (let i = 0; i < due.length; i += EMAIL_LOOKUP_CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + EMAIL_LOOKUP_CONCURRENCY).map(async (lead) => {
        const candidate = candidateByLead.get(lead.id)
        const result = await lookupCompanyEmail({
          websites: [lead.website, candidate?.website],
          companyName: lead.company_name || candidate?.canonical_name,
          discoveredOn: candidate?.website || null,
          ...(fetchPage ? { fetchPage } : {}),
        })
        const patch = { email_lookup_status: result.status, email_lookup_reason: result.reason, email_lookup_at: now.toISOString() }
        if (result.status === 'found') Object.assign(patch, { email: result.email, email_source_url: result.sourceUrl })
        const { error } = await client.from('sales_leads').update(patch).eq('id', lead.id)
        if (error) throw error
        Object.assign(lead, patch)
        lookup.checked += 1
        lookup.byStatus[result.status] = (lookup.byStatus[result.status] || 0) + 1
        if (result.status === 'found') lookup.found += 1
        lookup.results.push({ company: companyOf(lead), status: result.status, email: result.email, sourceUrl: result.sourceUrl, reason: result.reason })
      }),
    )
  }
}

export async function runAutoEmailCycle(
  client,
  { trigger = 'cron', credentials = {}, testRecipients = {}, actorUserId = null, now = new Date(), fetchPage = null } = {},
) {
  const report = {
    status: 'completed',
    reason: null,
    leadsScanned: 0,
    queued: 0,
    sent: 0,
    duplicatesSkipped: 0,
    failed: 0,
    uncertain: 0,
    blocked: 0,
    notSending: null,
    limit: null,
    dailyCap: null,
    sentTodayBefore: null,
    sentToday: null,
    remainingToday: null,
    capReached: false,
    emailLookup: null,
    states: {},
    details: [],
  }

  const { data: runRow, error: runError } = await client.from('email_outreach_runs').insert({ trigger, status: 'running' }).select('*').single()
  if (runError) throw runError

  async function finish(status) {
    report.status = status
    await client
      .from('email_outreach_runs')
      .update({
        status,
        finished_at: new Date().toISOString(),
        leads_scanned: report.leadsScanned,
        queued: report.queued,
        sent: report.sent,
        duplicates_skipped: report.duplicatesSkipped,
        failed: report.failed,
        uncertain: report.uncertain,
        report,
      })
      .eq('id', runRow.id)
    return { runId: runRow.id, ...report }
  }

  try {
    const { data: settings, error: settingsError } = await client.from('automation_settings').select('*').eq('id', 1).single()
    if (settingsError) throw settingsError
    report.limit = resolveAutoEmailLimit(settings)
    report.dailyCap = resolveDailyCap(settings)

    const [leads, suggestions, attempts, recipients, candidates, replies] = await Promise.all([
      fetchAll(client, 'sales_leads'),
      fetchAll(client, 'prospect_outreach_suggestions'),
      fetchAll(client, 'outreach_attempts'),
      fetchAll(client, 'email_outreach_recipients'),
      fetchAll(client, 'prospect_candidates'),
      fetchAll(client, 'inbound_replies', 'lead_id, predicted_intent, final_intent'),
    ])
    const candidateByLead = new Map(candidates.filter((c) => c.promoted_lead_id).map((c) => [c.promoted_lead_id, c]))

    // 0. Email lookup - runs even while sending is paused (it only fills in
    // lead emails; sending is decided below).
    await runEmailLookup(client, { leads, candidateByLead, now, fetchPage, report })

    if (settings?.auto_email_enabled !== true) {
      report.reason = 'ارسال خودکار ایمیل خاموش است.'
      return await finish('skipped')
    }
    if (!settings.outreach_enabled || !settings.email_provider_enabled) {
      report.reason = 'ارسال واقعی یا سرویس ایمیل در تنظیمات غیرفعال است.'
      return await finish('skipped')
    }

    const entries = buildEmailOutreachState({ leads, suggestions, attempts, recipients, replies })
    report.leadsScanned = leads.length
    report.sentTodayBefore = countSentToday(recipients, now)
    for (const e of entries) {
      const key = e.kind || e.state
      report.states[key] = (report.states[key] || 0) + 1
    }

    // 2. Queue.
    let queuedThisRun = 0
    for (const entry of entries.filter((e) => e.state === 'ready')) {
      if (queuedThisRun >= MAX_QUEUE_PER_RUN) break
      const row = await queueEntry(client, entry, candidateByLead.get(entry.lead.id) || null, now)
      if (!row) continue
      queuedThisRun += 1
      entry.suggestion = row
      entry.state = 'queued'
      report.details.push({ company: companyOf(entry.lead), outcome: 'queued' })
    }
    report.queued = queuedThisRun

    // 3. Send.
    const queue = entries.filter((e) => e.state === 'queued' && e.suggestion)
    if (settings.provider_test_mode) report.notSending = 'حالت آزمایشی سرویس ایمیل روشن است؛ ارسال خودکار انجام نمی‌شود.'
    else if (!evaluateContactWindow(settings, now).withinWindow) report.notSending = 'خارج از بازه زمانی مجاز تماس؛ ارسال در اجرای بعدی داخل بازه انجام می‌شود.'
    else if (report.sentTodayBefore >= report.dailyCap) {
      report.capReached = true
      report.notSending = `سقف روزانه (${report.dailyCap} ایمیل در روز) پر شده است؛ ارسال از فردا ادامه می‌یابد.`
    } else if (queue.length === 0) report.notSending = 'ایمیلی در صف ارسال نیست.'

    let sendsAttempted = 0
    if (!report.notSending) {
      for (const entry of queue) {
        if (sendsAttempted >= report.limit) break
        const { lead, suggestion } = entry
        const address = normalizeEmail(lead.email)
        // Atomic in the database: address uniqueness AND the daily cap,
        // serialized across every concurrent run.
        const { data: claim, error: claimError } = await client.rpc('claim_email_outreach_recipient', {
          p_email: address,
          p_lead_id: lead.id,
          p_suggestion_id: suggestion.id,
        })
        if (claimError) throw claimError
        if (claim === 'cap_reached') {
          report.capReached = true
          report.notSending = `سقف روزانه (${report.dailyCap} ایمیل در روز) پر شد؛ بقیه صف از فردا ارسال می‌شود.`
          break
        }
        if (claim !== 'claimed') {
          report.duplicatesSkipped += 1
          report.details.push({ company: companyOf(lead), outcome: 'duplicate', reason: 'این نشانی قبلاً گرفته شده است.' })
          continue
        }

        sendsAttempted += 1
        let result
        try {
          result = await attemptSend(client, { suggestionId: suggestion.id, actorUserId, testMode: false, credentials, testRecipients, now })
        } catch (err) {
          result = { ok: false, errorCode: 'send_exception', errorMessage: err instanceof Error ? err.message : 'unknown_error', status: null }
        }
        const outcome = outcomeOf(result)
        report[outcome] += 1

        if (outcome === 'blocked') {
          // The gate refused before any provider call - release the address.
          await client.from('email_outreach_recipients').delete().eq('normalized_email', address).eq('status', 'claimed')
        } else {
          await client
            .from('email_outreach_recipients')
            .update({ status: outcome, provider_message_id: result.providerMessageId || null, note: result.errorCode || null, updated_at: new Date().toISOString() })
            .eq('normalized_email', address)
        }
        await client
          .from('prospect_outreach_suggestions')
          .update({
            evidence_snapshot: {
              ...(suggestion.evidence_snapshot || {}),
              lastSend: { at: new Date().toISOString(), outcome, recipient: address, providerMessageId: result.providerMessageId || null, errorCode: result.errorCode || null, reasons: result.reasons || null },
            },
          })
          .eq('id', suggestion.id)
        report.details.push({
          company: companyOf(lead),
          outcome,
          recipient: address,
          providerMessageId: result.providerMessageId || null,
          reason: result.reasons?.join('؛ ') || result.errorMessage || null,
        })
      }
    }

    const { data: recipientsAfter, error: recipientsError } = await client.from('email_outreach_recipients').select('*')
    if (recipientsError) throw recipientsError
    report.sentToday = countSentToday(recipientsAfter, now)
    report.remainingToday = Math.max(0, report.dailyCap - report.sentToday)

    return await finish('completed')
  } catch (err) {
    report.reason = err instanceof Error ? err.message : 'unknown_error'
    await finish('failed')
    throw err
  }
}
