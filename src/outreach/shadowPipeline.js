// ---------------------------------------------------------------------------
// Phase 25 - Autonomous Outreach SHADOW MODE: the DB I/O + orchestration
// layer. Same convention as src/prospecting/discoveryPipeline.js - no
// Supabase client is imported here, every function takes one as its first
// argument, so the SAME pipeline runs from the admin UI or, server-side,
// from supabase/functions/outreach-shadow/index.ts on a schedule.
//
// SHADOW MODE, structurally: this file never imports, calls, or references
// any channel adapter's execute() (see src/outreach/channels/*.js -
// disabledExecute() makes every one of those throw regardless). It only
// ever writes prospect_outreach_suggestions/prospect_outreach_runs rows.
// ---------------------------------------------------------------------------

import { evaluateShadowOutreachOpportunity } from './prospectingShadow.js'
import { composeShadowOutreachMessage, composeShadowOutreachSubject } from './shadowMessageComposer.js'
import { suggestProductFit } from '../prospecting/productFit.js'
import { extractEvidence, matchedIndustryKeys } from '../prospecting/evidenceEngine.js'
import { TARGET_INDUSTRIES } from '../prospecting/industryTaxonomy.js'
import { computeDuplicateRiskLeadIds } from '../utils/leadIntelligence.js'

const STALE_SCHEDULED_RUN_THRESHOLD_MS = 30 * 60 * 1000
const ACTIONABLE_SUGGESTION_STATUSES = new Set(['pending', 'approved', 'edited'])

function isUniqueViolationError(err) {
  return err?.code === '23505' || /duplicate key value/i.test(err?.message || '')
}

async function guardConcurrentScheduledRun(client) {
  const { data: runningRows, error } = await client
    .from('prospect_outreach_runs')
    .select('id, started_at')
    .eq('run_type', 'scheduled')
    .eq('status', 'running')
  if (error) throw error

  const now = Date.now()
  for (const row of runningRows || []) {
    const age = now - new Date(row.started_at).getTime()
    if (age > STALE_SCHEDULED_RUN_THRESHOLD_MS) {
      await client
        .from('prospect_outreach_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), summary: { abandoned: true, reason: 'stale_running_row_reclaimed' } })
        .eq('id', row.id)
    } else {
      return { skipped: true, reason: 'اجرای زمان‌بندی‌شده دیگری از ارزیابی خروجی هم‌اکنون در حال اجراست.' }
    }
  }
  return { skipped: false }
}

async function fetchAutomationSettings(client) {
  const { data, error } = await client.from('automation_settings').select('*').eq('id', 1).single()
  if (error) throw error
  return data
}

async function fetchProspectingLeads(client) {
  const { data, error } = await client.from('sales_leads').select('*').contains('tags', ['prospecting'])
  if (error) throw error
  return data || []
}

async function fetchAllLeadsForDuplicateCheck(client) {
  const { data, error } = await client.from('sales_leads').select('id, company_name, mobile, phone, email, city')
  if (error) throw error
  return data || []
}

async function fetchCandidatesByLeadId(client, leadIds) {
  if (leadIds.length === 0) return new Map()
  const { data, error } = await client.from('prospect_candidates').select('*').in('promoted_lead_id', leadIds)
  if (error) throw error
  const map = new Map()
  for (const row of data || []) map.set(row.promoted_lead_id, row)
  return map
}

async function fetchOutreachAttemptsByLeadId(client, leadIds) {
  if (leadIds.length === 0) return new Map()
  const { data, error } = await client.from('outreach_attempts').select('*').in('lead_id', leadIds)
  if (error) throw error
  const map = new Map()
  for (const row of data || []) {
    const list = map.get(row.lead_id) || []
    list.push(row)
    map.set(row.lead_id, list)
  }
  return map
}

async function fetchExistingSuggestionsByLeadId(client, leadIds) {
  if (leadIds.length === 0) return new Map()
  const { data, error } = await client.from('prospect_outreach_suggestions').select('*').in('lead_id', leadIds)
  if (error) throw error
  const map = new Map()
  for (const row of data || []) {
    const list = map.get(row.lead_id) || []
    list.push(row)
    map.set(row.lead_id, list)
  }
  return map
}

function dedupeKeyFor(leadId) {
  // Deliberately ONE stable key per lead, forever - this is a first-contact
  // opportunity (same framing as the existing lead_first_contact automation
  // rule's own dedupeKey), not a repeating nurture sequence. Guarantees
  // STEP 7's "second identical run creates zero duplicate pending
  // suggestions" structurally, via the dedupe_key UNIQUE constraint, not
  // just application logic.
  return `prospect_outreach:${leadId}`
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

export async function runShadowOutreachCycle(client, { runType = 'manual', createdBy, settingsOverride = null } = {}) {
  const fetchedSettings = await fetchAutomationSettings(client)
  const settings = settingsOverride ? { ...fetchedSettings, ...settingsOverride } : fetchedSettings

  // Fail-closed, STEP 8: outreach_enabled is read but NEVER acted on - no
  // code path below (or anywhere in src/outreach/*) ever calls a channel
  // adapter's execute(). This check exists purely so a future accidental
  // wiring mistake that DID try to send something would have an explicit,
  // auditable flag to check first - it is not itself what prevents sending
  // today (disabledExecute() is what prevents it, unconditionally).
  if (settings.outreach_enabled === true) {
    // Still never sends anything - shadow_mode stays authoritative for this
    // phase regardless of what outreach_enabled says.
  }

  if (runType === 'scheduled') {
    const guard = await guardConcurrentScheduledRun(client)
    if (guard.skipped) return guard
  }

  let runRow
  try {
    const { data, error } = await client.from('prospect_outreach_runs').insert({ run_type: runType, status: 'running' }).select('*').single()
    if (error) throw error
    runRow = data
  } catch (err) {
    if (runType === 'scheduled' && isUniqueViolationError(err)) {
      return { skipped: true, reason: 'اجرای زمان‌بندی‌شده دیگری از ارزیابی خروجی هم‌اکنون در حال اجراست.' }
    }
    throw err
  }

  const now = new Date()
  const stats = {
    leadsScanned: 0,
    eligibleCount: 0,
    waitingCount: 0,
    blockedCount: 0,
    manualReviewCount: 0,
    suggestionsCreated: 0,
    duplicatesSkipped: 0,
    errorsCount: 0,
  }
  const examples = []

  try {
    const [prospectingLeads, allLeads] = await Promise.all([fetchProspectingLeads(client), fetchAllLeadsForDuplicateCheck(client)])
    const duplicateRiskIds = computeDuplicateRiskLeadIds(allLeads)

    const leadIds = prospectingLeads.map((l) => l.id)
    const [candidatesByLeadId, attemptsByLeadId, existingSuggestionsByLeadId] = await Promise.all([
      fetchCandidatesByLeadId(client, leadIds),
      fetchOutreachAttemptsByLeadId(client, leadIds),
      fetchExistingSuggestionsByLeadId(client, leadIds),
    ])

    stats.leadsScanned = prospectingLeads.length
    const maxSuggestions = settings.max_suggestions_per_run ?? 20
    const toInsert = []

    for (const lead of prospectingLeads) {
      try {
        const candidate = candidatesByLeadId.get(lead.id) || null
        const existingRows = existingSuggestionsByLeadId.get(lead.id) || []
        const hasActionableSuggestion = existingRows.some((r) => ACTIONABLE_SUGGESTION_STATUSES.has(r.status))
        const snoozedRow = existingRows.find((r) => r.status === 'snoozed' && r.snoozed_until && new Date(r.snoozed_until) > now)

        const evaluation = evaluateShadowOutreachOpportunity({
          lead,
          candidate,
          settings,
          leadAttempts: attemptsByLeadId.get(lead.id) || [],
          duplicateRiskIds,
          hasActionableSuggestion,
          snoozedUntil: snoozedRow?.snoozed_until || null,
          now,
        })

        if (evaluation.outreachStatus === 'eligible') stats.eligibleCount += 1
        else if (evaluation.outreachStatus === 'waiting') stats.waitingCount += 1
        else if (evaluation.outreachStatus === 'blocked') stats.blockedCount += 1
        else if (evaluation.outreachStatus === 'manual_review') stats.manualReviewCount += 1

        // A dedupe_key already existing means this lead already has a row
        // (of ANY status, including a past dismiss/expire) - never create a
        // second one for the same lead. Counted, never silently dropped.
        if (existingRows.length > 0) {
          stats.duplicatesSkipped += 1
          continue
        }

        // Only ELIGIBLE opportunities get a drafted message and a persisted
        // row - 'waiting'/'blocked'/'manual_review' leads are reported in
        // the run's stats (and remain re-evaluated on every future run,
        // since they never get a dedupe_key row) but nothing is stored for
        // them individually, matching STEP 6 ("For eligible leads generate
        // a suggested outreach message").
        if (evaluation.outreachStatus !== 'eligible') continue
        if (toInsert.length >= maxSuggestions) continue

        let productFitProducts = []
        // Phase 25 quality fix - customer-facing industry labels are
        // derived ONLY from real matched evidence (industry_keyword items -
        // an actual keyword found in the candidate's own business_
        // description/name), via the exact same TARGET_INDUSTRIES taxonomy
        // qualification/scoring already uses. NEVER from candidate.
        // industry_guess or lead.industry directly - those are raw adapter/
        // source taxonomy (e.g. a literal OSM tag value like "works") and
        // must never reach customer-facing text (see
        // shadowMessageComposer.js's file header). The raw value is still
        // kept below, in evidence_snapshot only, for internal diagnostics.
        let industryLabels = []
        if (candidate) {
          // Recomputed FRESH from the candidate's own stored fields, the
          // same way runComprehensiveAudit()/promoteEligibleCandidates()
          // already do - NOT read back from the persisted prospect_evidence
          // rows, which drop each item's `meta` (no such column exists;
          // matchedIndustryKeys() needs meta.industryKey to identify WHICH
          // target industry matched, so a DB round-trip here would silently
          // return zero industry labels even when real evidence exists).
          const evidence = extractEvidence(candidate)
          productFitProducts = suggestProductFit(evidence).products
          industryLabels = matchedIndustryKeys(evidence)
            .map((key) => TARGET_INDUSTRIES.find((i) => i.key === key)?.label)
            .filter(Boolean)
        }

        const { message, evidenceUsed } = composeShadowOutreachMessage({ lead, industryLabels, productFitProducts })
        const subject = evaluation.channel === 'email' ? composeShadowOutreachSubject(lead) : null

        toInsert.push({
          lead_id: lead.id,
          candidate_id: candidate?.id || null,
          run_id: runRow.id,
          dedupe_key: dedupeKeyFor(lead.id),
          outreach_status: evaluation.outreachStatus,
          reasons: evaluation.reasons,
          channel: evaluation.channel,
          fallback_channel: evaluation.fallbackChannel,
          priority: evaluation.priority,
          message_draft: message,
          subject_draft: subject,
          evidence_used: evidenceUsed,
          evidence_snapshot: {
            overallScore: candidate?.overall_score ?? null,
            confidence: candidate?.confidence ?? null,
            // Raw, UNSANITIZED source value - diagnostics/audit only, never
            // shown to a customer (see the header comment above).
            rawIndustryGuess: candidate?.industry_guess ?? null,
            industryLabelsUsed: industryLabels,
            productFitProducts,
            sourceUrl: candidate?.source_url ?? null,
          },
          within_contact_window: evaluation.withinContactWindow,
          suggested_send_at: evaluation.suggestedSendAt || null,
          next_available_at: evaluation.nextAvailableAt || null,
          status: 'pending',
          generated_at: now.toISOString(),
        })

        if (examples.length < 5) {
          examples.push({ leadId: lead.id, companyName: lead.company_name, channel: evaluation.channel, priority: evaluation.priority, reason: evaluation.reasons?.[0] || null })
        }
      } catch {
        stats.errorsCount += 1
      }
    }

    if (toInsert.length > 0) {
      const { data: inserted, error: insertError } = await client
        .from('prospect_outreach_suggestions')
        .upsert(toInsert, { onConflict: 'dedupe_key', ignoreDuplicates: true })
        .select('id')
      if (insertError) throw insertError
      stats.suggestionsCreated = (inserted || []).length
      stats.duplicatesSkipped += toInsert.length - stats.suggestionsCreated
    }
  } catch (fatalError) {
    await client
      .from('prospect_outreach_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        leads_scanned: stats.leadsScanned,
        eligible_count: stats.eligibleCount,
        waiting_count: stats.waitingCount,
        blocked_count: stats.blockedCount,
        manual_review_count: stats.manualReviewCount,
        suggestions_created: stats.suggestionsCreated,
        duplicates_skipped: stats.duplicatesSkipped,
        errors_count: stats.errorsCount + 1,
        summary: { fatalError: fatalError instanceof Error ? fatalError.message : 'unknown_error' },
      })
      .eq('id', runRow.id)
    throw fatalError
  }

  const status = stats.errorsCount === 0 ? 'completed' : stats.leadsScanned > 0 ? 'partial' : 'failed'
  const { data: finishedRun, error: finishError } = await client
    .from('prospect_outreach_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      leads_scanned: stats.leadsScanned,
      eligible_count: stats.eligibleCount,
      waiting_count: stats.waitingCount,
      blocked_count: stats.blockedCount,
      manual_review_count: stats.manualReviewCount,
      suggestions_created: stats.suggestionsCreated,
      duplicates_skipped: stats.duplicatesSkipped,
      errors_count: stats.errorsCount,
      summary: { examples, createdBy: createdBy || null },
    })
    .eq('id', runRow.id)
    .select('*')
    .single()
  if (finishError) throw finishError
  return finishedRun
}
