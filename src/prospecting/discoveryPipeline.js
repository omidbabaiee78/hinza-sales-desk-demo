// ---------------------------------------------------------------------------
// The DB I/O layer for the Autonomous Prospecting Engine. No Supabase client
// is imported here - every function takes one as its first argument, the
// exact same convention as automation/taskService.js and
// replyIntelligence/replyProcessor.js, so the SAME pipeline runs from the
// admin UI (manual "run now" / upload) or, server-side, from
// supabase/functions/prospect-discovery/index.ts on a daily schedule.
// ---------------------------------------------------------------------------

import { splitContactDisplay, normalizeMobileForComparison, normalizeLandlineForComparison } from '../utils/leadImport/contactNumbers.js'
import { normalizedNameKey, normalizeEmail } from './normalization.js'
import { buildMatchKeys, resolveDuplicate } from './deduplication.js'
import { getSourceAdapter } from './sourceAdapters/index.js'
import { extractEvidence, matchedEntityType, matchedBuyerFit, matchedBusinessRole, matchedIdentity, replaceIdentityEvidence } from './evidenceEngine.js'
import { isNonCompanyEntityType } from './entityClassification.js'
import { scoreCandidate } from './scoringEngine.js'
import { qualifyCandidate } from './qualification.js'
import { isPromotableIdentity, resolveVerifiedIdentity, isPlausibleOrganizationName, IDENTITY_STATUS } from './identityResolution.js'
import { fetchIdentitySignals } from './websiteEnrichment.js'
import { serializePromotedLead } from './promotion.js'
import { DEFAULT_QUERY_TEMPLATES as DEFAULT_SERPER_QUERY_TEMPLATES, searchWeb } from './sourceAdapters/serperSearch.js'
import { verifyCandidateSite, snippetSaysNotCompany } from './siteVerification.js'
import { findLeadEmailViaSearch, LEAD_SITE_SEARCH_STATUSES } from './leadSiteSearch.js'
import { tehranDateKey } from '../utils/leadFollowUp.js'

// ---------------------------------------------------------------------------
// Phase 23D-FINAL.1, "FINAL AUTONOMY BLOCKER" round, section 1 - IDENTITY
// VERIFICATION. A candidate whose ONLY thing blocking auto-promotion is an
// unverified identity (everything else - real company, buyer_fit=high, real
// industry evidence, no negative signal - already checks out) gets ONE
// lightweight, safety-capped live fetch of its own website (see
// websiteEnrichment.js's fetchIdentitySignals()) to try to confirm a real
// company name via JSON-LD/og:site_name/homepage title/About/Contact page,
// per identityResolution.js's priority order. Never attempted for a
// candidate that wouldn't auto-promote anyway even with a perfect identity -
// this keeps the number of live fetches naturally small (bounded by how
// many candidates are ALREADY this close), never a blanket crawl of every
// row. MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN is still a hard backstop
// on top of that natural bound, so one unusually "identity-starved" batch
// can never make a single audit/run take unbounded wall-clock time.
// ---------------------------------------------------------------------------
const MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN = 30

// ---------------------------------------------------------------------------
// Phase 24 - Autonomous Daily Prospecting Pipeline. runDiscovery() is the
// SAME function the admin UI's manual buttons already call - Phase 24 does
// not introduce a second orchestrator, it adds the safety limits/idempotency
// a fully unattended (no browser, no admin session) daily run needs on top
// of the existing one. Every default below is deliberately conservative -
// see supabase/sql/phase24_autonomous_daily_pipeline.sql for the matching
// prospect_settings columns and their PRODUCTION defaults (which stay
// conservative even where the in-repo constant below is looser, since a
// persisted prospect_settings row always wins once it exists).
// ---------------------------------------------------------------------------
const DEFAULT_MAX_EXTERNAL_REQUESTS_PER_RUN = 20
const DEFAULT_RUN_TIMEOUT_MS = 4 * 60 * 1000 // 4 minutes - safely under a Supabase Edge Function's own execution ceiling
// A 'scheduled' run row stuck in status='running' for longer than this is
// treated as abandoned (crashed process, killed Edge Function, etc.) and
// reclaimed rather than permanently blocking every future daily run.
const STALE_SCHEDULED_RUN_THRESHOLD_MS = 30 * 60 * 1000

// Search sources with config.rotate walk a query x city x page plan (see
// serperSearch.js buildQueryPlan) this many queries per run by default.
const DEFAULT_ROTATING_QUERIES_PER_RUN = 10
// New public emails per Tehran day after which scheduled runs stop
// searching (prospect_settings.daily_new_email_target). The sender's own
// cap (20/day) is separate and unchanged.
const DEFAULT_DAILY_NEW_EMAIL_TARGET = 20
// Share of the run's time budget the search/snippet phase may use; the
// rest is kept for reading candidates' own websites.
const DISCOVERY_PHASE_SHARE = 0.5
const SITE_VERIFY_CONCURRENCY = 4
// Websites read per run - page parsing is the run's main CPU cost, and
// Edge Functions have a CPU-time limit. 10 runs a day = 160 sites.
const MAX_SITE_CHECKS_PER_RUN = 16
// Days before a website that failed to load is tried again.
const SITE_FETCH_RETRY_DAYS = 3
// Web searches per run for leads whose recorded website is not their own.
const MAX_LEAD_SITE_SEARCHES_PER_RUN = 4

// A rough, conservative per-source request-cost ESTIMATE used only to decide
// whether a source fits inside the run-wide external-request budget BEFORE
// calling adapter.discover() - never an exact count of what the adapter ends
// up doing internally (that stays entirely the adapter's own concern, see
// e.g. serperSearch.js/osmOverpass.js's own sequential-request-per-template
// and retry/failover regression tests, which this never touches or
// duplicates). uploaded_dataset/company_website/existing_database sources
// have no live network cost from the orchestrator's point of view.
function estimateSourceRequestCost(source) {
  if (source.source_type === 'search_result') {
    if (source.config?.rotate === true) return Math.max(1, Number(source.config.queriesPerRun) || DEFAULT_ROTATING_QUERIES_PER_RUN)
    const templates = Array.isArray(source.config?.queryTemplates) ? source.config.queryTemplates.length : DEFAULT_SERPER_QUERY_TEMPLATES.length
    return Math.max(1, templates)
  }
  if (
    source.source_type === 'public_directory' ||
    source.source_type === 'industrial_directory' ||
    source.source_type === 'trade_show_directory' ||
    source.source_type === 'association_directory' ||
    source.source_type === 'government_registry' ||
    source.source_type === 'custom_api'
  ) {
    return 1
  }
  return 0
}

// Real Postgres/PostgREST unique-violation shape (SQLSTATE 23505) - the
// backstop for the true-simultaneous-race case guardConcurrentScheduledRun()
// below cannot fully close on its own (two invocations both passing the
// SELECT check in the same instant). Never exercised by the in-memory fake
// client the regression suite uses (it has no constraint concept at all,
// same as every other real DB constraint in this codebase) - the SELECT-based
// guard is what the regression suite actually verifies.
function isUniqueViolationError(err) {
  return err?.code === '23505' || /duplicate key value/i.test(err?.message || '')
}

// Phase 24, STEP 4 - the primary, TESTED concurrency guard against the same
// scheduled invocation firing twice (an accidental double cron trigger, a
// pg_net retry that actually succeeded the first time, etc.): at most one
// 'scheduled' run may be status='running' at once. A run stuck running past
// STALE_SCHEDULED_RUN_THRESHOLD_MS is reclaimed (marked failed) rather than
// blocking the daily pipeline forever.
async function guardConcurrentScheduledRun(client) {
  const { data: runningRows, error } = await client
    .from('prospect_discovery_runs')
    .select('id, started_at')
    .eq('run_type', 'scheduled')
    .eq('status', 'running')
  if (error) throw error

  const now = Date.now()
  for (const row of runningRows || []) {
    const age = now - new Date(row.started_at).getTime()
    if (age > STALE_SCHEDULED_RUN_THRESHOLD_MS) {
      await client
        .from('prospect_discovery_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), summary: { abandoned: true, reason: 'stale_running_row_reclaimed' } })
        .eq('id', row.id)
    } else {
      return { skipped: true, reason: 'اجرای زمان‌بندی‌شده دیگری هم‌اکنون در حال اجراست.' }
    }
  }
  return { skipped: false }
}

function shouldVerifyIdentity({ candidate, entityType, buyerFit, identity, qualification }) {
  if (isNonCompanyEntityType(entityType)) return false
  if (buyerFit !== 'high') return false
  if (identity.status === IDENTITY_STATUS.VERIFIED) return false
  if (!candidate.website) return false
  if (qualification.status !== 'qualified') return false
  if (qualification.autoPromotable) return false
  return true
}

// Runs qualifyCandidate() once with the baseline (no-fetch) identity; if the
// ONLY thing blocking auto-promotion is that identity, attempts ONE live
// website-verification fetch (budget-gated) and, if it found anything,
// re-runs qualifyCandidate() with the upgraded identity evidence. Always
// returns the BEST result found - a fetch failure/timeout/inconclusive page
// simply leaves the baseline result untouched, never worse than not having
// tried (see websiteEnrichment.js's file header - same principle).
export async function qualifyWithIdentityVerification({ candidate, evidence, scores, settings, identityBudget }) {
  let currentEvidence = evidence
  let qualification = qualifyCandidate({ candidate, evidence: currentEvidence, scores, settings })
  const entityType = matchedEntityType(currentEvidence)
  const buyerFit = matchedBuyerFit(currentEvidence)
  const baselineIdentity = matchedIdentity(currentEvidence)

  if (identityBudget.remaining > 0 && shouldVerifyIdentity({ candidate, entityType, buyerFit, identity: baselineIdentity, qualification })) {
    identityBudget.remaining -= 1
    const signals = await fetchIdentitySignals({ homepageUrl: candidate.website })
    if (signals.ok) {
      const verified = resolveVerifiedIdentity({ domain: candidate.domain, signals, baseline: baselineIdentity })
      if (verified.resolvedName && (verified.source !== baselineIdentity.source || verified.status !== baselineIdentity.status)) {
        currentEvidence = replaceIdentityEvidence(currentEvidence, verified)
        qualification = qualifyCandidate({ candidate, evidence: currentEvidence, scores, settings })
      }
    }
  }

  return { evidence: currentEvidence, qualification }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

// Only the FIRST number in a possibly multi-number field is used for
// dedup-key purposes - the same accepted simplification
// utils/leadIntelligence.js already uses for lead scoring ("a robustness fix
// for that field shape, not a matching-rule change").
function firstMobileKey(value) {
  const first = splitContactDisplay(value)[0] || value
  return first ? normalizeMobileForComparison(first) || null : null
}
function firstPhoneKey(value) {
  const first = splitContactDisplay(value)[0] || value
  return first ? normalizeLandlineForComparison(first) || null : null
}

function rowToEvidence(row) {
  return { evidenceType: row.evidence_type, value: row.value, weight: Number(row.weight), confidence: row.confidence, sourceUrl: row.source_url }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchProspectSettings(client) {
  const { data, error } = await client.from('prospect_settings').select('*').eq('id', 1).single()
  if (error) throw error
  return data
}

export async function fetchProspectSources(client) {
  const { data, error } = await client.from('prospect_sources').select('*').order('name')
  if (error) throw error
  return data || []
}

// Phase 23C fix: a specific sourceId means an admin explicitly clicked
// "اجرای این منبع" (run this exact source now) - that is an unambiguous,
// one-off intent that must run regardless of the source's `enabled` flag,
// the same way testSource()'s "تست منبع" already ignores `enabled`
// entirely. `enabled` only gates which sources participate in a BULK run
// (sourceId === null - today, only the daily cron path). Before this fix,
// a disabled source's "اجرای این منبع" button was ALSO disabled client-side
// (see SourceManagementSection.jsx), so clicking it sent no request at all -
// no run row, no error, nothing - which is exactly the "silent no-op" bug
// this file's Phase 23C report traced back to.
async function fetchRunnableSources(client, sourceId) {
  let query = client.from('prospect_sources').select('*')
  query = sourceId ? query.eq('id', sourceId) : query.eq('enabled', true)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchCandidates(client, { statuses } = {}) {
  let query = client.from('prospect_candidates').select('*, prospect_sources(name, source_type)').order('overall_score', { ascending: false })
  if (statuses?.length) query = query.in('status', statuses)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchCandidateEvidence(client, candidateId) {
  const { data, error } = await client.from('prospect_evidence').select('*').eq('candidate_id', candidateId).order('weight', { ascending: false })
  if (error) throw error
  return (data || []).map(rowToEvidence)
}

export async function fetchDiscoveryRuns(client) {
  const { data, error } = await client
    .from('prospect_discovery_runs')
    .select('*, prospect_sources(name)')
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data || []
}

// Existing sales_leads/companies/prospect_candidates, mapped into the
// generic { kind, id, keys } shape resolveDuplicate() compares against -
// this is THE dedup reference set every new candidate is checked against.
async function fetchDedupRecords(client) {
  const [leadsRes, companiesRes, candidatesRes] = await Promise.all([
    client.from('sales_leads').select('id, company_name, mobile, phone, email, city'),
    client.from('companies').select('id, name'),
    client.from('prospect_candidates').select('id, canonical_name, normalized_name_key, domain, mobile, phone, email, city, source_id, source_external_id').neq('status', 'rejected'),
  ])
  if (leadsRes.error) throw leadsRes.error
  if (companiesRes.error) throw companiesRes.error
  if (candidatesRes.error) throw candidatesRes.error

  const records = []
  for (const lead of leadsRes.data || []) {
    records.push({
      kind: 'lead',
      id: lead.id,
      keys: buildMatchKeys({
        nameKey: normalizedNameKey(lead.company_name),
        mobileKey: firstMobileKey(lead.mobile),
        phoneKey: firstPhoneKey(lead.phone),
        email: normalizeEmail(lead.email),
        city: lead.city || null,
      }),
    })
  }
  for (const company of companiesRes.data || []) {
    records.push({ kind: 'company', id: company.id, keys: buildMatchKeys({ nameKey: normalizedNameKey(company.name) }) })
  }
  for (const candidate of candidatesRes.data || []) {
    records.push({
      kind: 'candidate',
      id: candidate.id,
      keys: buildMatchKeys({
        nameKey: candidate.normalized_name_key,
        domain: candidate.domain,
        mobileKey: firstMobileKey(candidate.mobile),
        phoneKey: firstPhoneKey(candidate.phone),
        email: normalizeEmail(candidate.email),
        city: candidate.city,
        sourceExternalId: candidate.source_id && candidate.source_external_id ? `${candidate.source_id}:${candidate.source_external_id}` : null,
      }),
    })
  }
  return records
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function upsertCandidate(client, payload, sourceExternalId, sourceId) {
  if (sourceExternalId) {
    const { data: existing } = await client
      .from('prospect_candidates')
      .select('id, first_seen_at')
      .eq('source_id', sourceId)
      .eq('source_external_id', sourceExternalId)
      .maybeSingle()
    if (existing) {
      const { data, error } = await client
        .from('prospect_candidates')
        .update({ ...payload, first_seen_at: existing.first_seen_at, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throw error
      return { row: data, created: false }
    }
  }
  const { data, error } = await client.from('prospect_candidates').insert(payload).select('*').single()
  if (error) throw error
  return { row: data, created: true }
}

async function replaceEvidence(client, candidateId, evidence) {
  const { error: deleteError } = await client.from('prospect_evidence').delete().eq('candidate_id', candidateId)
  if (deleteError) throw deleteError
  if (evidence.length === 0) return
  const rows = evidence.map((e) => ({
    candidate_id: candidateId,
    evidence_type: e.evidenceType,
    value: e.value,
    source_url: e.sourceUrl || null,
    weight: e.weight,
    confidence: e.confidence,
  }))
  const { error: insertError } = await client.from('prospect_evidence').insert(rows)
  if (insertError) throw insertError
}

// Never a second write path into sales_leads - reuses the exact same
// serializeLeadForCreate() every manual/import lead creation already uses.
// Idempotent: a candidate already 'promoted' is left untouched.
async function promoteCandidateRow(client, candidateRow, evidence, { createdBy, sourceName }) {
  const leadPayload = serializePromotedLead(candidateRow, evidence, { createdBy, sourceName })
  const { data: lead, error: leadError } = await client.from('sales_leads').insert(leadPayload).select('id').single()
  if (leadError) throw leadError
  const { error: updateError } = await client
    .from('prospect_candidates')
    .update({ status: 'promoted', promoted_lead_id: lead.id, updated_at: new Date().toISOString() })
    .eq('id', candidateRow.id)
  if (updateError) throw updateError
  return lead.id
}

async function processCandidate(client, { rawItem, source, adapter, run, settings, dedupRecords, createdBy, remainingPromotions, identityBudget, dryRun = false }) {
  const normalized = adapter.normalize(rawItem, source)
  if (!normalized.canonical_name) {
    throw new Error('candidate is missing a usable company name')
  }

  // Re-discovery of the EXACT same source item (same source_id +
  // source_external_id) across runs. Phase 23D-FINAL, section M: this used
  // to ALWAYS be a pure metadata refresh, for every status - meaning an old
  // 'rejected'/'manual_review' decision could live forever even after the
  // classifier itself improved (a "brain upgrade" could never rescue a
  // false negative on its own; the item had to be independently reprocessed
  // by hand). Now:
  //   - PROMOTED: never re-scored, never re-promoted into a second lead -
  //     it's already a real, acted-on sales_leads row.
  //   - DUPLICATE: its relation is preserved unless an admin resolves it by
  //     hand (markCandidateDuplicate) - rescoring here risks silently
  //     un-duplicating something that may still be a genuine duplicate.
  //   Both cases above: ONLY non-destructive metadata (last_seen_at/
  //   discovery_run_id) is refreshed.
  //   - REJECTED / MANUAL_REVIEW / QUALIFIED: refresh the normalized fields
  //     from this fresh discovery AND rerun the CURRENT
  //     evidence/scoring/qualification logic - this is what lets an old
  //     false negative get rescued the next time this source item is
  //     rediscovered, without needing a separate admin-triggered
  //     re-evaluation pass.
  const selfExternalKey = normalized.source_external_id ? `${source.id}:${normalized.source_external_id}` : null
  if (selfExternalKey) {
    const existingSelf = dedupRecords.find((r) => r.kind === 'candidate' && r.keys.sourceExternalId === selfExternalKey)
    if (existingSelf) {
      const { data: existingRow, error: fetchError } = await client
        .from('prospect_candidates')
        .select('status')
        .eq('id', existingSelf.id)
        .single()
      if (fetchError) throw fetchError

      if (existingRow.status === 'promoted' || existingRow.status === 'duplicate') {
        const { data: updated, error } = await client
          .from('prospect_candidates')
          .update({ last_seen_at: new Date().toISOString(), discovery_run_id: run.id, updated_at: new Date().toISOString() })
          .eq('id', existingSelf.id)
          .select('*')
          .single()
        if (error) throw error
        return { created: false, duplicate: updated.status === 'duplicate', promoted: false, status: updated.status }
      }

      const rescueBaseEvidence = extractEvidence(normalized)
      const rescueScores = scoreCandidate(normalized, rescueBaseEvidence)
      const { evidence: rescueEvidence, qualification: rescueQualification } = await qualifyWithIdentityVerification({
        candidate: normalized,
        evidence: rescueBaseEvidence,
        scores: rescueScores,
        settings,
        identityBudget,
      })
      const { data: updated, error } = await client
        .from('prospect_candidates')
        .update({
          ...normalized,
          source_id: source.id,
          discovery_run_id: run.id,
          last_seen_at: new Date().toISOString(),
          relevance_score: rescueScores.relevanceScore,
          contact_quality_score: rescueScores.contactQualityScore,
          overall_score: rescueScores.overallScore,
          confidence: rescueScores.confidence,
          status: rescueQualification.status,
          qualification_reason: rescueQualification.status === 'rejected' ? null : rescueQualification.reason,
          rejection_reason: rescueQualification.status === 'rejected' ? rescueQualification.reason : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSelf.id)
        .select('*')
        .single()
      if (error) throw error
      await replaceEvidence(client, existingSelf.id, rescueEvidence)

      let rescuePromoted = false
      let rescueWouldPromote = false
      if (rescueQualification.autoPromotable && rescueQualification.status === 'qualified' && remainingPromotions > 0) {
        if (dryRun) {
          rescueWouldPromote = true
        } else {
          await promoteCandidateRow(client, updated, rescueEvidence, { createdBy, sourceName: source.name })
          rescuePromoted = true
        }
      }

      // Report the TRUE final status, not the pre-promotion qualification
      // result - promoteCandidateRow() above already flipped the row itself
      // to 'promoted' in the database, so a run's statusCounts must reflect
      // that too, or a same-run promotion gets silently miscounted under
      // 'qualified' instead of 'promoted'.
      return {
        created: false,
        duplicate: false,
        promoted: rescuePromoted,
        wouldPromote: rescueWouldPromote,
        status: rescuePromoted ? 'promoted' : rescueQualification.status,
      }
    }
  }

  const candidateKeys = buildMatchKeys({
    nameKey: normalized.normalized_name_key,
    domain: normalized.domain,
    mobileKey: firstMobileKey(normalized.mobile),
    phoneKey: firstPhoneKey(normalized.phone),
    email: normalizeEmail(normalized.email),
    city: normalized.city,
    sourceExternalId: normalized.source_external_id ? `${source.id}:${normalized.source_external_id}` : null,
  })

  const match = resolveDuplicate(candidateKeys, dedupRecords)
  const nowIso = new Date().toISOString()
  const basePayload = { ...normalized, source_id: source.id, discovery_run_id: run.id, last_seen_at: nowIso }

  if (match?.matchType === 'duplicate') {
    const payload = {
      ...basePayload,
      status: 'duplicate',
      matched_lead_id: match.kind === 'lead' ? match.id : null,
      matched_company_id: match.kind === 'company' ? match.id : null,
      duplicate_of_candidate_id: match.kind === 'candidate' ? match.id : null,
      match_explanation: match.explanation,
    }
    const saved = await upsertCandidate(client, payload, normalized.source_external_id, source.id)
    return { created: saved.created, duplicate: true, status: 'duplicate' }
  }

  const baseEvidence = extractEvidence(normalized)
  const scores = scoreCandidate(normalized, baseEvidence)
  const { evidence, qualification } = await qualifyWithIdentityVerification({
    candidate: normalized,
    evidence: baseEvidence,
    scores,
    settings,
    identityBudget,
  })

  // A fuzzy (ambiguous) name match ALWAYS forces manual_review, regardless
  // of how strong the qualification signal is - never auto-promoted while
  // a possible duplicate is unresolved.
  const finalStatus = match?.matchType === 'manual_review' ? 'manual_review' : qualification.status

  const payload = {
    ...basePayload,
    relevance_score: scores.relevanceScore,
    contact_quality_score: scores.contactQualityScore,
    overall_score: scores.overallScore,
    confidence: scores.confidence,
    status: finalStatus,
    qualification_reason: finalStatus === 'rejected' ? null : qualification.reason,
    rejection_reason: finalStatus === 'rejected' ? qualification.reason : null,
    matched_lead_id: match?.kind === 'lead' ? match.id : null,
    matched_company_id: match?.kind === 'company' ? match.id : null,
    match_explanation: match?.matchType === 'manual_review' ? match.explanation : null,
  }

  const saved = await upsertCandidate(client, payload, normalized.source_external_id, source.id)
  await replaceEvidence(client, saved.row.id, evidence)

  let promoted = false
  let wouldPromote = false
  if (qualification.autoPromotable && finalStatus === 'qualified' && remainingPromotions > 0) {
    if (dryRun) {
      wouldPromote = true
    } else {
      await promoteCandidateRow(client, saved.row, evidence, { createdBy, sourceName: source.name })
      promoted = true
    }
  }

  return {
    created: saved.created,
    duplicate: false,
    promoted,
    wouldPromote,
    // Same fix as the re-discovery rescue path above: report the TRUE final
    // status. promoteCandidateRow() above already flipped this row to
    // 'promoted' in the database when `promoted` is true, so the run's
    // statusCounts must say 'promoted' too, not the pre-promotion
    // qualification status it was written with a moment earlier.
    status: promoted ? 'promoted' : finalStatus,
    newDedupRecord: { kind: 'candidate', id: saved.row.id, keys: candidateKeys },
  }
}

function hostOfUrl(url) {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

// Public emails found today (Tehran day) - by the site step below, the
// lead site search, or the sender's own lookup: every path records
// email_lookup_status='found' + email_lookup_at on the lead.
async function countEmailsFoundToday(client, now = new Date()) {
  const { data, error } = await client.from('sales_leads').select('email_lookup_status, email_lookup_at')
  if (error) throw error
  const today = tehranDateKey(now)
  return (data || []).filter((l) => l.email_lookup_status === 'found' && l.email_lookup_at && tehranDateKey(new Date(l.email_lookup_at)) === today).length
}

function isSitePending(candidate, now) {
  if (!candidate.website) return false
  if (!candidate.site_checked_at) return true
  if (candidate.site_check_status !== 'fetch_failed') return false
  return now - new Date(candidate.site_checked_at).getTime() >= SITE_FETCH_RETRY_DAYS * 24 * 60 * 60 * 1000
}

// Reads each not-yet-checked candidate's own website (siteVerification.js),
// re-qualifies it with that text, and promotes the ones the site confirms,
// with the email the site publishes. Newest discoveries first; stops at the
// deadline or when the run's promotion budget is used up (the rest stay
// pending for the next run). dryRun: reads and counts, writes nothing.
export async function verifyPendingCandidateSites(client, { settings, deadline, createdBy = null, dryRun = false, promotions, fetchPage, now = Date.now() }) {
  const summary = { pending: 0, checked: 0, promoted: 0, wouldPromote: 0, promotedWithEmail: 0, emailsFound: 0, duplicates: 0, errors: 0, byStatus: {}, stoppedBy: null }
  const [candidatesRes, leadsRes, sourcesRes] = await Promise.all([
    client.from('prospect_candidates').select('*').in('status', ['manual_review', 'qualified']),
    client.from('sales_leads').select('id, email, website'),
    client.from('prospect_sources').select('id, name'),
  ])
  if (candidatesRes.error) throw candidatesRes.error
  if (leadsRes.error) throw leadsRes.error
  if (sourcesRes.error) throw sourcesRes.error

  const pending = (candidatesRes.data || [])
    .filter((c) => isSitePending(c, now))
    .sort((a, b) => String(b.first_seen_at || b.created_at || '').localeCompare(String(a.first_seen_at || a.created_at || '')))
  summary.pending = pending.length
  const leadIdByEmail = new Map((leadsRes.data || []).filter((l) => normalizeEmail(l.email)).map((l) => [normalizeEmail(l.email), l.id]))
  const leadIdByHost = new Map((leadsRes.data || []).filter((l) => hostOfUrl(l.website)).map((l) => [hostOfUrl(l.website), l.id]))
  const sourceNameById = new Map((sourcesRes.data || []).map((src) => [src.id, src.name]))
  const count = (status) => {
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1
  }

  async function markChecked(candidate, patch) {
    if (dryRun) return null
    const { data, error } = await client
      .from('prospect_candidates')
      .update({ site_checked_at: new Date(now).toISOString(), updated_at: new Date().toISOString(), ...patch })
      .eq('id', candidate.id)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  async function handle(candidate) {
    if (snippetSaysNotCompany(candidate)) {
      count('not_company')
      await markChecked(candidate, { site_check_status: 'not_company' })
      return
    }
    const result = await verifyCandidateSite({ candidate, settings, ...(fetchPage ? { fetchPage } : {}) })
    summary.checked += 1
    if (!result.ok) {
      count(result.status)
      await markChecked(candidate, { site_check_status: result.status })
      return
    }
    const email = normalizeEmail(result.email)
    if (email) summary.emailsFound += 1
    const matchedLeadId = (email && leadIdByEmail.get(email)) || leadIdByHost.get(hostOfUrl(candidate.website)) || null
    // A fuzzy name match to another lead/candidate stays for review, as in
    // processCandidate().
    const promote = result.promotable && !matchedLeadId && !candidate.match_explanation
    if (promote && promotions.remaining <= 0) {
      summary.stoppedBy = summary.stoppedBy || 'promotion_budget'
      return
    }
    if (promote) promotions.remaining -= 1
    if (email && promote) leadIdByEmail.set(email, 'this-run')

    const enriched = result.candidate
    const status = matchedLeadId ? 'duplicate' : promote ? 'qualified' : result.qualification.status
    count(matchedLeadId ? 'duplicate' : promote ? 'promoted' : status)
    if (matchedLeadId) summary.duplicates += 1
    const updated = await markChecked(candidate, {
      site_check_status: result.emailStatus === 'found' ? 'email_found' : result.emailStatus || 'checked',
      site_email_source_url: result.emailSourceUrl,
      canonical_name: enriched.canonical_name,
      normalized_name_key: enriched.normalized_name_key,
      business_description: enriched.business_description,
      email: candidate.email || email || null,
      relevance_score: result.scores.relevanceScore,
      contact_quality_score: result.scores.contactQualityScore,
      overall_score: result.scores.overallScore,
      confidence: result.scores.confidence,
      status,
      qualification_reason: status === 'rejected' ? null : result.qualification.reason,
      rejection_reason: status === 'rejected' ? result.qualification.reason : null,
      matched_lead_id: matchedLeadId || candidate.matched_lead_id || null,
      match_explanation: matchedLeadId ? 'همین وب‌سایت یا ایمیل قبلاً برای یک سرنخ ثبت شده است.' : candidate.match_explanation || null,
    })
    if (!promote) return
    if (dryRun) {
      summary.wouldPromote += 1
      return
    }
    await replaceEvidence(client, candidate.id, result.evidence)
    const leadId = await promoteCandidateRow(client, updated, result.evidence, { createdBy, sourceName: sourceNameById.get(candidate.source_id) || null })
    summary.promoted += 1
    if (email) summary.promotedWithEmail += 1
    // Record the lookup on the lead so the sender's own lookup does not
    // repeat it, and so the address shows where it was published.
    const { error } = await client
      .from('sales_leads')
      .update({
        email_lookup_status: result.emailStatus,
        email_lookup_reason: result.emailReason,
        email_lookup_at: new Date(now).toISOString(),
        email_source_url: email ? result.emailSourceUrl : null,
      })
      .eq('id', leadId)
    if (error) throw error
  }

  for (let i = 0; i < pending.length; i += SITE_VERIFY_CONCURRENCY) {
    if (Date.now() >= deadline) {
      summary.stoppedBy = 'time_budget'
      break
    }
    if (summary.stoppedBy === 'promotion_budget') break
    if (summary.checked >= MAX_SITE_CHECKS_PER_RUN) {
      summary.stoppedBy = 'site_check_budget'
      break
    }
    await Promise.all(
      pending.slice(i, i + SITE_VERIFY_CONCURRENCY).map((candidate) =>
        handle(candidate).catch(() => {
          summary.errors += 1
        }),
      ),
    )
  }
  return summary
}

// Leads (any source, including manually added ones) without an email whose
// recorded website is not the company's own: one web search each for the
// official site (leadSiteSearch.js). Each lead is searched once.
export async function searchOfficialSitesForLeads(client, { deadline, maxSearches, search, fetchPage, now = Date.now() }) {
  const summary = { searched: 0, found: 0, byStatus: {}, errors: 0 }
  if (maxSearches <= 0) return summary
  const { data: leads, error } = await client.from('sales_leads').select('*')
  if (error) throw error
  const takenEmails = new Set((leads || []).map((l) => normalizeEmail(l.email)).filter(Boolean))
  const due = (leads || []).filter(
    (l) =>
      !normalizeEmail(l.email) &&
      !l.do_not_contact &&
      l.status !== 'converted' &&
      l.status !== 'lost' &&
      !l.official_site_search_at &&
      LEAD_SITE_SEARCH_STATUSES.has(l.email_lookup_status),
  )

  for (const lead of due) {
    if (summary.searched >= maxSearches || Date.now() >= deadline) break
    let result
    try {
      result = await findLeadEmailViaSearch({ companyName: lead.company_name, search, ...(fetchPage ? { fetchPage } : {}) })
    } catch {
      summary.errors += 1
      continue
    }
    if (result.status !== 'name_too_generic') summary.searched += 1
    summary.byStatus[result.status] = (summary.byStatus[result.status] || 0) + 1
    const email = normalizeEmail(result.email)
    const patch = { official_site_search_at: new Date(now).toISOString() }
    if (result.status === 'found' && email && !takenEmails.has(email)) {
      takenEmails.add(email)
      summary.found += 1
      Object.assign(patch, {
        email,
        email_source_url: result.sourceUrl,
        email_lookup_status: 'found',
        email_lookup_reason: `ایمیل در وب‌سایت رسمی شرکت پیدا شد (وب‌سایت با جستجوی نام شرکت یافت شد: ${result.site})`,
        email_lookup_at: new Date(now).toISOString(),
      })
    }
    const { error: updateError } = await client.from('sales_leads').update(patch).eq('id', lead.id)
    if (updateError) summary.errors += 1
  }
  return summary
}

// ---------------------------------------------------------------------------
// Main entry point - one discovery run across one or all enabled sources.
// Idempotent-by-design: re-running never re-promotes an already-promoted
// candidate, never re-creates a row with the same source+external id, and
// one malformed candidate/source failure never aborts the whole run.
// ---------------------------------------------------------------------------

// Phase 24 additions (all optional, all backward compatible - a plain
// runDiscovery(client, { sourceId, runType, uploadedRows, createdBy }) call,
// exactly as the admin UI has always made it, behaves identically to before):
//   dryRun - when true (or when the persisted settings.dry_run is true),
//     runs the ENTIRE pipeline (discovery, dedupe, enrichment, qualification,
//     candidate/evidence bookkeeping, run logging) exactly as normal, but
//     never calls promoteCandidateRow() - zero rows are ever written to
//     sales_leads. What a real run WOULD have promoted is still reported,
//     under wouldPromoteCount, never conflated with the real promoted count.
//   settingsOverride - a shallow, NEVER-PERSISTED override applied on top of
//     the fetched prospect_settings for this one invocation only (see the
//     manualTest path in supabase/functions/prospect-discovery/index.ts,
//     STEP 8's "very small safe discovery budget" server test trigger).
//   serverPhases - true only from the prospect-discovery Edge Function: after
//     the sources, read pending candidates' own websites
//     (verifyPendingCandidateSites) and search for leads' official sites
//     (searchOfficialSitesForLeads). Never from the browser, which cannot
//     fetch other sites. fetchPage/search override the network for checks.
export async function runDiscovery(
  client,
  { sourceId = null, runType = 'manual', uploadedRows = null, createdBy, dryRun = false, settingsOverride = null, serverPhases = false, fetchPage = null, search = null } = {},
) {
  const fetchedSettings = await fetchProspectSettings(client)
  const settings = settingsOverride ? { ...fetchedSettings, ...settingsOverride } : fetchedSettings
  const effectiveDryRun = Boolean(dryRun || settings.dry_run)

  if (!settings.enabled) {
    return { skipped: true, reason: 'موتور کشف مشتری غیرفعال است.' }
  }
  // Phase 24, STEP 3 - a SEPARATE kill switch for just the unattended daily
  // path, independent of `enabled` (which also gates every manual/admin run).
  // An admin can keep manual "اجرای این منبع"/upload runs available while the
  // daily schedule stays off, or vice versa.
  if (runType === 'scheduled' && !settings.daily_run_enabled) {
    return { skipped: true, reason: 'اجرای روزانه (زمان‌بندی‌شده) غیرفعال است.' }
  }

  // Phase 24, STEP 4 - concurrency guard: at most one scheduled run in
  // status='running' at a time (see guardConcurrentScheduledRun()'s own
  // header). Never applied to manual/admin runs - an admin deliberately
  // clicking two different "اجرای این منبع" buttons is a different, much
  // lower-risk situation than an unattended daily trigger firing twice.
  if (runType === 'scheduled') {
    const guard = await guardConcurrentScheduledRun(client)
    if (guard.skipped) return guard
  }

  // Scheduled runs repeat through the day (see the phase33 cron); once
  // today's target of new public emails is reached they stop spending
  // searches until tomorrow.
  const dailyEmailTarget = settings.daily_new_email_target ?? DEFAULT_DAILY_NEW_EMAIL_TARGET
  const emailsFoundBefore = serverPhases ? await countEmailsFoundToday(client) : null
  if (runType === 'scheduled' && serverPhases && emailsFoundBefore >= dailyEmailTarget) {
    return { skipped: true, reason: `هدف روزانه (${dailyEmailTarget} ایمیل جدید) امروز پر شده است.` }
  }

  const sources = await fetchRunnableSources(client, sourceId)

  let runRow
  try {
    const { data, error } = await client
      .from('prospect_discovery_runs')
      .insert({ source_id: sourceId, run_type: runType, status: 'running' })
      .select('*')
      .single()
    if (error) throw error
    runRow = data
  } catch (err) {
    // Real-DB backstop for the true-simultaneous-race case (see
    // isUniqueViolationError()'s header) - never hit by the in-memory fake
    // client the regression suite uses, since it has no unique-constraint
    // concept; the SELECT-based guard above is what that suite verifies.
    if (runType === 'scheduled' && isUniqueViolationError(err)) {
      return { skipped: true, reason: 'اجرای زمان‌بندی‌شده دیگری هم‌اکنون در حال اجراست.' }
    }
    throw err
  }

  const totals = {
    candidatesFound: 0,
    candidatesCreated: 0,
    candidatesUpdated: 0,
    candidatesPromoted: 0,
    // dry-run-only projection of what WOULD have been promoted - never added
    // to candidatesPromoted, never written to candidates_promoted either;
    // kept entirely separate so a dry run can never be mistaken for a real
    // promotion count anywhere downstream.
    wouldPromoteCount: 0,
    duplicatesDetected: 0,
    errorsCount: 0,
  }
  const statusCounts = {}
  const sourceSummaries = []
  let dedupRecords = await fetchDedupRecords(client)
  const identityBudget = { remaining: MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN }
  // Phase 24, STEP 3 - a single run-wide cap on external SEARCH/discovery
  // requests (Serper/OSM-style sources), independent of the pre-existing
  // identityBudget above (which only ever covers the separate, already
  // tightly-capped live-website identity-verification fetch - see that
  // constant's own header). A source whose estimated cost no longer fits is
  // skipped BEFORE its adapter.discover() is ever called - the external
  // request budget can never be exceeded, only under-used.
  const externalRequestBudget = {
    remaining: settings.max_external_requests_per_run ?? DEFAULT_MAX_EXTERNAL_REQUESTS_PER_RUN,
    used: 0,
  }
  const runTimeoutMs = settings.run_timeout_ms ?? DEFAULT_RUN_TIMEOUT_MS
  const runStartedAt = Date.now()
  let timedOut = false
  // With serverPhases, candidate processing stops at this point so the
  // site step always gets the rest of the time budget.
  const discoveryDeadline = runStartedAt + runTimeoutMs * (serverPhases ? DISCOVERY_PHASE_SHARE : 1)
  let itemsNotProcessed = 0
  let siteVerification = null
  let leadSiteSearch = null

  try {
    for (const source of sources) {
      if (Date.now() - runStartedAt > runTimeoutMs) {
        timedOut = true
        sourceSummaries.push({ sourceId: source.id, name: source.name, skipped: true, reason: 'run_timeout_exceeded' })
        continue
      }

      let requestCost = estimateSourceRequestCost(source)
      // A rotating search source simply runs fewer queries when the budget
      // is short; the cursor continues from wherever it stopped.
      const rotating = source.source_type === 'search_result' && source.config?.rotate === true
      if (rotating) requestCost = Math.min(requestCost, externalRequestBudget.remaining)
      if ((rotating && requestCost < 1) || requestCost > externalRequestBudget.remaining) {
        sourceSummaries.push({ sourceId: source.id, name: source.name, skipped: true, reason: 'external_request_budget_exhausted' })
        continue
      }
      externalRequestBudget.remaining -= requestCost
      externalRequestBudget.used += requestCost

      try {
        const adapter = getSourceAdapter(source.source_type)
        const rawItems = await adapter.discover(source, { rows: uploadedRows || [], maxQueries: requestCost })
        if (Number.isFinite(rawItems.nextCursor) && !effectiveDryRun) {
          const { error: cursorError } = await client
            .from('prospect_sources')
            .update({ config: { ...(source.config || {}), rotationCursor: rawItems.nextCursor } })
            .eq('id', source.id)
          if (cursorError) throw cursorError
        }
        const limit = source.config?.maxCandidatesPerRun ?? settings.max_candidates_per_source_per_run
        const limitedItems = rawItems.slice(0, limit)
        totals.candidatesFound += limitedItems.length

        let sourceErrors = 0
        // Section Q: keep a SHORT, safe diagnostic per failed item - stage +
        // a short error class, never the candidate's own name/contact/PII,
        // never a full stack dump. Capped so one badly-behaved source can't
        // bloat the run summary; the counter (sourceErrors) still reflects
        // the true total either way.
        const errorSamples = []
        for (const rawItem of limitedItems) {
          if (Date.now() >= discoveryDeadline) {
            itemsNotProcessed += 1
            continue
          }
          try {
            const promotedSoFar = effectiveDryRun ? totals.wouldPromoteCount : totals.candidatesPromoted
            const remainingPromotions = settings.max_promotions_per_run - promotedSoFar
            const result = await processCandidate(client, {
              rawItem,
              source,
              adapter,
              run: runRow,
              settings,
              dedupRecords,
              createdBy,
              remainingPromotions,
              identityBudget,
              dryRun: effectiveDryRun,
            })
            if (result.duplicate) totals.duplicatesDetected += 1
            else if (result.created) totals.candidatesCreated += 1
            else totals.candidatesUpdated += 1
            if (result.promoted) totals.candidatesPromoted += 1
            if (result.wouldPromote) totals.wouldPromoteCount += 1
            if (result.status) statusCounts[result.status] = (statusCounts[result.status] || 0) + 1
            if (result.newDedupRecord) dedupRecords = [...dedupRecords, result.newDedupRecord]
          } catch (err) {
            totals.errorsCount += 1
            sourceErrors += 1
            if (errorSamples.length < 5) {
              errorSamples.push({
                stage: 'process_candidate',
                externalId: rawItem?.id ?? rawItem?.source_external_id ?? null,
                error: err instanceof Error ? err.message : 'unknown_error',
              })
            }
          }
        }

        await client
          .from('prospect_sources')
          .update({ last_run_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: sourceErrors > 0 ? `${sourceErrors} مورد با خطا مواجه شد.` : null })
          .eq('id', source.id)
        sourceSummaries.push({ sourceId: source.id, name: source.name, found: limitedItems.length, errors: sourceErrors, errorSamples })
      } catch (sourceError) {
        // One source failing (e.g. an unconfigured/unreachable adapter) never
        // aborts the whole run - the other sources still get a chance.
        totals.errorsCount += 1
        await client.from('prospect_sources').update({ last_run_at: new Date().toISOString(), last_error: sourceError.message }).eq('id', source.id)
        sourceSummaries.push({ sourceId: source.id, name: source.name, error: sourceError.message, stage: 'source_discover' })
      }
    }

    if (serverPhases) {
      const promotedSoFar = effectiveDryRun ? totals.wouldPromoteCount : totals.candidatesPromoted
      siteVerification = await verifyPendingCandidateSites(client, {
        settings,
        deadline: runStartedAt + runTimeoutMs,
        createdBy,
        dryRun: effectiveDryRun,
        promotions: { remaining: Math.max(0, settings.max_promotions_per_run - promotedSoFar) },
        fetchPage,
      })
      totals.candidatesPromoted += siteVerification.promoted
      totals.wouldPromoteCount += siteVerification.wouldPromote
      totals.errorsCount += siteVerification.errors
      if (!effectiveDryRun) {
        const searches = Math.min(MAX_LEAD_SITE_SEARCHES_PER_RUN, externalRequestBudget.remaining)
        leadSiteSearch = await searchOfficialSitesForLeads(client, {
          deadline: runStartedAt + runTimeoutMs,
          maxSearches: searches,
          search: search || ((query) => searchWeb(query)),
          fetchPage,
        })
        externalRequestBudget.remaining -= leadSiteSearch.searched
        externalRequestBudget.used += leadSiteSearch.searched
      }
    }
  } catch (fatalError) {
    // Phase 24, STEP 6 - a genuinely unexpected, unhandled failure (anything
    // NOT already isolated by the per-source/per-candidate try/catch above)
    // still stops safely: the run row is marked 'failed' with a short error
    // summary rather than left stuck at status='running' forever (which
    // guardConcurrentScheduledRun() would otherwise only reclaim after
    // STALE_SCHEDULED_RUN_THRESHOLD_MS). Every promotion already made before
    // the failure stays exactly as-is (promoteCandidateRow() marks each
    // candidate 'promoted' immediately, one at a time) - a subsequent retry
    // never repeats them, the same idempotency the rest of this file relies
    // on throughout.
    await client
      .from('prospect_discovery_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        candidates_found: totals.candidatesFound,
        candidates_created: totals.candidatesCreated,
        candidates_updated: totals.candidatesUpdated,
        candidates_promoted: totals.candidatesPromoted,
        duplicates_detected: totals.duplicatesDetected,
        errors_count: totals.errorsCount + 1,
        summary: {
          sources: sourceSummaries,
          fatalError: fatalError instanceof Error ? fatalError.message : 'unknown_error',
          dryRun: effectiveDryRun,
        },
      })
      .eq('id', runRow.id)
    throw fatalError
  }

  const status = timedOut ? 'partial' : totals.errorsCount === 0 ? 'completed' : totals.candidatesFound > 0 ? 'partial' : 'failed'
  const { data: finishedRun, error: finishError } = await client
    .from('prospect_discovery_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      candidates_found: totals.candidatesFound,
      candidates_created: totals.candidatesCreated,
      candidates_updated: totals.candidatesUpdated,
      // A dry run's own candidate/evidence bookkeeping still happens for
      // audit purposes (see this function's own header), but its promoted
      // COUNT must stay a true, honest zero here - wouldPromoteCount below
      // is the ONLY place the projection is reported.
      candidates_promoted: totals.candidatesPromoted,
      duplicates_detected: totals.duplicatesDetected,
      errors_count: totals.errorsCount,
      summary: {
        sources: sourceSummaries,
        dryRun: effectiveDryRun,
        timedOut,
        runTimeoutMs,
        statusCounts,
        wouldPromoteCount: totals.wouldPromoteCount,
        externalRequestsUsed: externalRequestBudget.used,
        externalRequestBudget: settings.max_external_requests_per_run ?? DEFAULT_MAX_EXTERNAL_REQUESTS_PER_RUN,
        identityVerificationFetchesUsed: MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN - identityBudget.remaining,
        itemsNotProcessed,
        siteVerification,
        leadSiteSearch,
        dailyEmailTarget,
        emailsFoundTodayBefore: emailsFoundBefore,
        emailsFoundTodayAfter: serverPhases && !effectiveDryRun ? await countEmailsFoundToday(client) : null,
      },
    })
    .eq('id', runRow.id)
    .select('*')
    .single()
  if (finishError) throw finishError
  return finishedRun
}

// ---------------------------------------------------------------------------
// Admin-triggered single-candidate actions
// ---------------------------------------------------------------------------

export async function promoteCandidate(client, candidateId, { createdBy } = {}) {
  const { data: candidate, error } = await client
    .from('prospect_candidates')
    .select('*, prospect_sources(name)')
    .eq('id', candidateId)
    .single()
  if (error) throw error
  if (candidate.status === 'promoted') return candidate
  if (candidate.status === 'duplicate') {
    throw new Error('این مورد قبلاً به‌عنوان تکراری شناسایی شده و قابل تبدیل به سرنخ نیست.')
  }
  const evidence = await fetchCandidateEvidence(client, candidateId)
  await promoteCandidateRow(client, candidate, evidence, { createdBy, sourceName: candidate.prospect_sources?.name })
  const { data: updated, error: fetchError } = await client.from('prospect_candidates').select('*').eq('id', candidateId).single()
  if (fetchError) throw fetchError
  return updated
}

export async function rejectCandidate(client, candidateId, reason) {
  const { data, error } = await client
    .from('prospect_candidates')
    .update({ status: 'rejected', rejection_reason: reason || 'رد شده توسط ادمین.', updated_at: new Date().toISOString() })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function markCandidateDuplicate(client, candidateId, { duplicateOfCandidateId, matchedLeadId, matchedCompanyId, explanation }) {
  const { data, error } = await client
    .from('prospect_candidates')
    .update({
      status: 'duplicate',
      duplicate_of_candidate_id: duplicateOfCandidateId || null,
      matched_lead_id: matchedLeadId || null,
      matched_company_id: matchedCompanyId || null,
      match_explanation: explanation || 'ثبت‌شده توسط ادمین به‌عنوان تکراری.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateCandidateFields(client, candidateId, fields) {
  const { data, error } = await client
    .from('prospect_candidates')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Re-runs evidence extraction/scoring/qualification against the candidate's
// CURRENT stored fields (e.g. after an admin edits its description/contact
// info via updateCandidateFields) - never re-fetches from the SOURCE (only
// possibly its own website, for identity verification - see
// qualifyWithIdentityVerification()). `identityBudget` lets a caller
// looping over many candidates (reEvaluateManualReviewCandidates below)
// share one cap across the whole batch; a standalone call (the admin UI's
// single "ارزیابی مجدد" button) gets its own one-shot budget.
export async function reEvaluateCandidate(client, candidateId, { identityBudget } = {}) {
  const [{ data: candidate, error }, settings] = await Promise.all([
    client.from('prospect_candidates').select('*').eq('id', candidateId).single(),
    fetchProspectSettings(client),
  ])
  if (error) throw error

  const baseEvidence = extractEvidence(candidate)
  const scores = scoreCandidate(candidate, baseEvidence)
  const { evidence, qualification } = await qualifyWithIdentityVerification({
    candidate,
    evidence: baseEvidence,
    scores,
    settings,
    identityBudget: identityBudget || { remaining: 1 },
  })

  await replaceEvidence(client, candidateId, evidence)
  const { data: updated, error: updateError } = await client
    .from('prospect_candidates')
    .update({
      relevance_score: scores.relevanceScore,
      contact_quality_score: scores.contactQualityScore,
      overall_score: scores.overallScore,
      confidence: scores.confidence,
      status: qualification.status,
      qualification_reason: qualification.status === 'rejected' ? null : qualification.reason,
      rejection_reason: qualification.status === 'rejected' ? qualification.reason : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId)
    .select('*')
    .single()
  if (updateError) throw updateError
  return updated
}

// Phase 23D, item 10: a safe, idempotent way to rescore EXISTING
// manual_review candidates under Smart Qualification 2.0, without deleting
// or re-fetching anything and without ever creating a lead itself -
// reEvaluateCandidate() above never promotes, only recomputes
// evidence/scores/status from what's already stored. One candidate failing
// (e.g. a row edited into a bad shape) never aborts the rest, same "one
// failure never aborts the whole batch" principle runDiscovery() already
// applies to sources. Re-running this again is always safe: candidates that
// already moved to 'qualified'/'rejected' are simply no longer selected by
// the status='manual_review' filter, and candidates still in manual_review
// are just recomputed again from their current stored fields.
export async function reEvaluateManualReviewCandidates(client) {
  const { data: rows, error } = await client.from('prospect_candidates').select('id').eq('status', 'manual_review')
  if (error) throw error

  let updated = 0
  let errors = 0
  const statusCounts = {}
  const identityBudget = { remaining: MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN }
  for (const row of rows || []) {
    try {
      const result = await reEvaluateCandidate(client, row.id, { identityBudget })
      updated += 1
      statusCounts[result.status] = (statusCounts[result.status] || 0) + 1
    } catch {
      errors += 1
    }
  }
  return { total: (rows || []).length, updated, errors, statusCounts }
}

// Every status prospect_candidates.status can actually hold (see the CHECK
// constraint in supabase/sql/phase23_autonomous_prospecting.sql) - used to
// build databaseStatusCounts below so the report is honest about EVERY row
// in the table, never just the ones it happened to query.
const ALL_CANDIDATE_STATUSES = ['new', 'enriching', 'qualified', 'rejected', 'duplicate', 'promoted', 'manual_review']
// The statuses eligible for re-evaluation - changing qualification on a
// 'duplicate' or 'promoted' row would damage real, already-acted-on
// historical state (see discoveryPipeline.js's re-discovery rescue logic,
// section M) - they are counted, never audited/rescored.
const AUDITABLE_STATUSES = ['manual_review', 'rejected', 'qualified']

// Phase 23D-FINAL.1, section 9 - INVARIANT CHECKS. A prediction that
// violates one of these is, by definition, internally contradictory - e.g.
// business_role=polymer_processor (implies "makes plastic stuff") together
// with buyer_fit=not_buyer (implies "definitely not a plastic-material
// buyer") can only ever both be true if something upstream disagreed with
// itself. Never silently ignored - every conflict is both counted
// (logicalConflictCount) and named (conflicts[]) in the report, and ANY
// conflict on a candidate that would otherwise auto-promote hard-blocks it
// here regardless of what qualifyCandidate() itself decided, as a second,
// independent safety net.
function detectConflicts({ entityType, businessRole, buyerFit, autoPromotable, hasResolvedIdentity, resolvedCompanyName }) {
  const conflicts = []
  if (businessRole === 'polymer_processor' && buyerFit === 'not_buyer') conflicts.push('polymer_processor_but_not_buyer')
  if (businessRole === 'medical' && buyerFit === 'high') conflicts.push('medical_but_high_buyer_fit')
  if (isNonCompanyEntityType(entityType) && autoPromotable) conflicts.push(`${entityType}_but_auto_promotable`)
  if (businessRole === 'machinery_supplier' && autoPromotable) conflicts.push('machinery_supplier_but_auto_promotable')
  if (businessRole === 'retailer' && autoPromotable) conflicts.push('retailer_but_auto_promotable')
  if (!hasResolvedIdentity && autoPromotable) conflicts.push('unresolved_identity_but_auto_promotable')
  // "FINAL REGRESSION FIX" round, item 1 - the invariant: autoPromotable=true
  // => resolved_company_name must pass isPlausibleOrganizationName(). A
  // second, independent safety net on top of resolveVerifiedIdentity()'s
  // own proactive filtering - "no exceptions."
  if (autoPromotable && !isPlausibleOrganizationName(resolvedCompanyName)) conflicts.push('implausible_company_name_but_auto_promotable')
  return conflicts
}

// Phase 23D-FINAL.1, section 13 - the ONE comprehensive, read-only audit.
// Deliberately does NOT take a caller-supplied status list any more (that
// was exactly how the previous "dry run" quietly ended up covering only
// manual_review in practice - "do not trust UI filtering" applies to this
// function's own callers too) - it ALWAYS queries every AUDITABLE status
// (manual_review + rejected + qualified) server-side, and ALWAYS also
// reports the full real database distribution (databaseStatusCounts,
// including duplicate/promoted) so the report is self-proving: anyone
// reading it can verify auditedCount really does equal manual_review +
// rejected + qualified from databaseStatusCounts, without trusting a label.
// Pure read + in-memory recompute - NEVER writes anything.
export async function runComprehensiveAudit(client) {
  const [{ data: allRows, error: allError }, settings] = await Promise.all([
    client.from('prospect_candidates').select('id, status'),
    fetchProspectSettings(client),
  ])
  if (allError) throw allError

  const databaseStatusCounts = {}
  for (const status of ALL_CANDIDATE_STATUSES) databaseStatusCounts[status] = 0
  for (const row of allRows || []) databaseStatusCounts[row.status] = (databaseStatusCounts[row.status] || 0) + 1

  const inputStatusCounts = {}
  for (const status of AUDITABLE_STATUSES) inputStatusCounts[status] = databaseStatusCounts[status] || 0
  const excludedStatusCounts = {}
  for (const status of ALL_CANDIDATE_STATUSES) {
    if (!AUDITABLE_STATUSES.includes(status)) excludedStatusCounts[status] = databaseStatusCounts[status] || 0
  }
  const excludedCount = Object.values(excludedStatusCounts).reduce((sum, n) => sum + n, 0)

  const { data: rows, error } = await client.from('prospect_candidates').select('*').in('status', AUDITABLE_STATUSES)
  if (error) throw error

  const counts = { qualified: 0, manual_review: 0, rejected: 0 }
  const buyerFitCounts = { high: 0, medium: 0, low: 0, not_buyer: 0, unknown: 0 }
  const entityTypeCounts = { direct_company: 0, directory_or_list: 0, article: 0, marketplace: 0, social: 0, video: 0, unknown: 0 }
  const businessRoleCounts = {}
  const transitionMatrix = {}
  const predictions = []
  let autoPromotableCount = 0
  // "FINAL AUTONOMY BLOCKER" round, section 2/7 - identity is now a
  // three-way verified/probable/unresolved count, not a binary
  // resolved/unresolved one (see identityResolution.js's IDENTITY_STATUS).
  let identityVerifiedCount = 0
  let identityProbableCount = 0
  let identityUnresolvedCount = 0
  let identityVerificationAttempted = 0
  let enrichmentNeededCount = 0
  let logicalConflictCount = 0
  // Section S/U/14 - the headline "did this audit actually work" metrics:
  // how many previously-REJECTED rows the CURRENT logic would now rescue
  // out of rejection, and how many previously-QUALIFIED rows it would now
  // (correctly) pull back out of qualified.
  let rescuedFalseNegatives = 0
  let downgradedFalsePositives = 0
  let errors = 0
  // Section 1 - a shared, run-wide cap on live website-verification
  // fetches, so a batch unusually full of "one step from auto-promotable"
  // candidates can never make a single audit invocation take unbounded
  // wall-clock time (see the file header note on
  // MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN).
  const identityBudget = { remaining: MAX_IDENTITY_VERIFICATION_FETCHES_PER_RUN }

  for (const candidate of rows || []) {
    try {
      const baseEvidence = extractEvidence(candidate)
      const scores = scoreCandidate(candidate, baseEvidence)
      const budgetBefore = identityBudget.remaining
      const { evidence, qualification } = await qualifyWithIdentityVerification({
        candidate,
        evidence: baseEvidence,
        scores,
        settings,
        identityBudget,
      })
      if (identityBudget.remaining < budgetBefore) identityVerificationAttempted += 1
      const buyerFit = matchedBuyerFit(evidence)
      const entityType = matchedEntityType(evidence)
      const businessRole = matchedBusinessRole(evidence)
      const identity = matchedIdentity(evidence)
      const hasResolvedIdentity = isPromotableIdentity(identity)
      const isEnrichmentNeeded =
        qualification.status === 'manual_review' && !evidence.some((e) => e.evidenceType === 'non_company_content' || e.evidenceType === 'non_buyer_organization')

      counts[qualification.status] = (counts[qualification.status] || 0) + 1
      buyerFitCounts[buyerFit] = (buyerFitCounts[buyerFit] || 0) + 1
      entityTypeCounts[entityType] = (entityTypeCounts[entityType] || 0) + 1
      businessRoleCounts[businessRole] = (businessRoleCounts[businessRole] || 0) + 1
      if (qualification.autoPromotable) autoPromotableCount += 1
      if (identity.status === IDENTITY_STATUS.VERIFIED) identityVerifiedCount += 1
      else if (identity.status === IDENTITY_STATUS.PROBABLE) identityProbableCount += 1
      else identityUnresolvedCount += 1
      if (isEnrichmentNeeded) enrichmentNeededCount += 1
      if (candidate.status === 'rejected' && qualification.status !== 'rejected') rescuedFalseNegatives += 1
      if (candidate.status === 'qualified' && qualification.status !== 'qualified') downgradedFalsePositives += 1

      const transitionKey = `${candidate.status} -> ${qualification.status}`
      transitionMatrix[transitionKey] = (transitionMatrix[transitionKey] || 0) + 1

      const conflicts = detectConflicts({
        entityType,
        businessRole,
        buyerFit,
        autoPromotable: qualification.autoPromotable,
        hasResolvedIdentity,
        resolvedCompanyName: identity.resolvedName,
      })
      logicalConflictCount += conflicts.length
      // A conflict on a candidate that would otherwise auto-promote is a
      // hard block - a second, independent safety net on top of
      // qualifyCandidate()'s own gates, never just a report footnote.
      const safeAutoPromotable = conflicts.length > 0 ? false : qualification.autoPromotable

      predictions.push({
        id: candidate.id,
        name: candidate.canonical_name,
        original_result_title: candidate.raw_name,
        resolved_company_name: identity.resolvedName,
        identity_source: identity.source,
        identity_status: identity.status,
        current_score: candidate.overall_score,
        current_confidence: candidate.confidence,
        current_status: candidate.status,
        predicted_score: scores.overallScore,
        predicted_confidence: scores.confidence,
        predicted_status: qualification.status,
        predicted_auto_promotable: safeAutoPromotable,
        entity_type: entityType,
        page_type: entityType, // see the file header note: page_type and entity_type are the same classification here
        buyer_fit: buyerFit,
        business_role: businessRole,
        reason: qualification.reason,
        website: candidate.website,
        source_url: candidate.source_url,
        conflicts,
      })
    } catch {
      errors += 1
    }
  }

  // Strongest predicted candidates first - the most informative ordering
  // for a human reviewing the result, not an artifact of DB order.
  predictions.sort((a, b) => (b.predicted_score ?? 0) - (a.predicted_score ?? 0))

  const auditedCount = (rows || []).length

  return {
    databaseStatusCounts,
    inputStatusCounts,
    excludedStatusCounts,
    auditedCount,
    excludedCount,
    errors,
    counts,
    buyerFitCounts,
    entityTypeCounts,
    businessRoleCounts,
    transitionMatrix,
    autoPromotableCount,
    identityVerifiedCount,
    identityProbableCount,
    identityUnresolvedCount,
    identityVerificationAttempted,
    identityVerificationBudgetRemaining: identityBudget.remaining,
    enrichmentNeededCount,
    logicalConflictCount,
    rescuedFalseNegatives,
    downgradedFalsePositives,
    predictions,
  }
}

// Phase 23D, dry-run request: calculates what Smart Qualification 2.0 WOULD
// do to every current manual_review candidate WITHOUT writing anything to
// the database - no update, no insert, no delete, no promotion. Kept as a
// narrower, faster PRE-write preview (e.g. right after tuning logic, before
// touching anything) - runComprehensiveAudit() above is the authoritative,
// full-coverage report; this is deliberately never presented as a
// substitute for it.
export async function dryRunQualification(client) {
  const full = await runComprehensiveAudit(client)
  const manualReviewOnly = full.predictions.filter((p) => p.current_status === 'manual_review')
  const counts = { qualified: 0, manual_review: 0, rejected: 0 }
  const buyerFitCounts = { high: 0, medium: 0, low: 0, not_buyer: 0, unknown: 0 }
  for (const p of manualReviewOnly) {
    counts[p.predicted_status] = (counts[p.predicted_status] || 0) + 1
    buyerFitCounts[p.buyer_fit] = (buyerFitCounts[p.buyer_fit] || 0) + 1
  }
  return {
    total: manualReviewOnly.length,
    errors: full.errors,
    counts,
    buyerFitCounts,
    autoPromotableCount: manualReviewOnly.filter((p) => p.predicted_auto_promotable).length,
    predictions: manualReviewOnly,
    note: 'این یک پیش‌نمایش محدود به «نیازمند بررسی» است - برای حسابرسی کامل (رد شده + واجد شرایط را هم شامل می‌شود) از حسابرسی جامع استفاده کنید.',
  }
}

// Phase 23D.3 production re-evaluation / 23D-FINAL.1: now a thin alias for
// runComprehensiveAudit() - see that function's own header for why a
// SEPARATE, narrower "just the 3 real statuses" query used to exist here
// and why it was consolidated: the "which button did you click" ambiguity
// was itself the root cause of the 23D-FINAL.1 audit-coverage bug report.
export async function verifyQualificationState(client) {
  return runComprehensiveAudit(client)
}

// ---------------------------------------------------------------------------
// Phase 23, "Controlled Promotion Acceptance" round - the ONE, safe,
// idempotent, admin-triggered BULK PROMOTION step. Deliberately reuses
// runComprehensiveAudit() for the eligible-candidate LIST (never a second,
// divergent definition of "eligible" from what the admin already reviewed),
// then re-derives each candidate's eligibility a SECOND time, fresh,
// immediately before writing - never trusts the audit snapshot for the
// actual write decision, the same "requalify before you act" discipline
// processCandidate()'s re-discovery rescue already applies.
//
// Idempotent by construction, same as promoteCandidate() above: a
// candidate already 'promoted' is counted and skipped, never re-promoted;
// re-running this after a first successful run promotes 0 additional
// candidates and creates 0 additional leads (see the regression test).
//
// Requirement 6 ("if an eligible candidate already maps to an existing
// lead/company, use the EXISTING dedupe behavior") - reuses the fields
// deduplication.js/processCandidate() ALREADY computed at discovery time
// (matched_lead_id/matched_company_id/duplicate_of_candidate_id) rather
// than re-deriving a second, parallel dedup pass here; a candidate that
// already maps to something is skipped, never promoted over that mapping.
//
// Never sends any message, never touches prospect_sources/cron config -
// purely: requalify -> persist the requalification -> promote via the
// EXISTING, single promoteCandidateRow() write path (the same one
// promoteCandidate()/processCandidate() already use - no second write
// path into sales_leads).
export async function promoteEligibleCandidates(client, { createdBy } = {}) {
  const [audit, settings] = await Promise.all([runComprehensiveAudit(client), fetchProspectSettings(client)])
  const eligibleIds = audit.predictions.filter((p) => p.predicted_auto_promotable).map((p) => p.id)

  const results = []
  let promoted = 0
  let alreadyPromoted = 0
  let skippedExistingMatch = 0
  let noLongerEligible = 0
  let failed = 0

  for (const candidateId of eligibleIds) {
    try {
      const { data: candidate, error } = await client
        .from('prospect_candidates')
        .select('*, prospect_sources(name)')
        .eq('id', candidateId)
        .single()
      if (error) throw error

      if (candidate.status === 'promoted') {
        alreadyPromoted += 1
        results.push({ candidateId, name: candidate.canonical_name, outcome: 'already_promoted', leadId: candidate.promoted_lead_id })
        continue
      }
      if (candidate.status === 'duplicate') {
        skippedExistingMatch += 1
        results.push({ candidateId, name: candidate.canonical_name, outcome: 'already_duplicate' })
        continue
      }
      if (candidate.matched_lead_id || candidate.matched_company_id || candidate.duplicate_of_candidate_id) {
        skippedExistingMatch += 1
        results.push({
          candidateId,
          name: candidate.canonical_name,
          outcome: 'skipped_existing_match',
          explanation: candidate.match_explanation || null,
        })
        continue
      }

      const baseEvidence = extractEvidence(candidate)
      const scores = scoreCandidate(candidate, baseEvidence)
      const identityBudget = { remaining: 1 }
      const { evidence, qualification } = await qualifyWithIdentityVerification({
        candidate,
        evidence: baseEvidence,
        scores,
        settings,
        identityBudget,
      })
      const entityType = matchedEntityType(evidence)
      const businessRole = matchedBusinessRole(evidence)
      const buyerFit = matchedBuyerFit(evidence)
      const identity = matchedIdentity(evidence)
      const hasResolvedIdentity = isPromotableIdentity(identity)
      const conflicts = detectConflicts({
        entityType,
        businessRole,
        buyerFit,
        autoPromotable: qualification.autoPromotable,
        hasResolvedIdentity,
        resolvedCompanyName: identity.resolvedName,
      })
      const safeAutoPromotable = conflicts.length === 0 && qualification.status === 'qualified' && qualification.autoPromotable

      if (!safeAutoPromotable) {
        noLongerEligible += 1
        results.push({
          candidateId,
          name: candidate.canonical_name,
          outcome: 'no_longer_eligible',
          reason: conflicts.length ? conflicts.join(', ') : qualification.status,
        })
        continue
      }

      // Persist the fresh requalification BEFORE promoting, so the
      // promoted lead's own notes/priority (buildLeadFieldsFromCandidate,
      // promotion.js) are built from the CURRENT score/evidence, never a
      // stale one - the same order processCandidate()'s main path uses.
      const { data: updated, error: updateError } = await client
        .from('prospect_candidates')
        .update({
          relevance_score: scores.relevanceScore,
          contact_quality_score: scores.contactQualityScore,
          overall_score: scores.overallScore,
          confidence: scores.confidence,
          status: qualification.status,
          qualification_reason: qualification.reason,
          rejection_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidateId)
        .select('*, prospect_sources(name)')
        .single()
      if (updateError) throw updateError
      await replaceEvidence(client, candidateId, evidence)

      const leadId = await promoteCandidateRow(client, updated, evidence, { createdBy, sourceName: updated.prospect_sources?.name })
      promoted += 1
      results.push({
        candidateId,
        name: updated.canonical_name,
        resolvedCompanyName: identity.resolvedName,
        outcome: 'promoted',
        leadId,
        sourceUrl: candidate.source_url,
        score: scores.overallScore,
        buyerFit,
        businessRole,
        reason: qualification.reason,
      })
    } catch (err) {
      failed += 1
      results.push({ candidateId, outcome: 'error', error: err instanceof Error ? err.message : 'unknown_error' })
    }
  }

  return {
    eligibleBefore: eligibleIds.length,
    promoted,
    alreadyPromoted,
    skippedExistingMatch,
    noLongerEligible,
    failed,
    results,
  }
}

async function ensureSourceExists(client, { name, sourceType, config, enabled = true }) {
  const { data: existing } = await client.from('prospect_sources').select('*').eq('name', name).maybeSingle()
  if (existing) return existing
  const { data: created, error } = await client
    .from('prospect_sources')
    .insert({ name, source_type: sourceType, enabled, config: config || {} })
    .select('*')
    .single()
  if (error) throw error
  return created
}

const UPLOADED_DATASET_SOURCE_NAME = 'آپلود دستی'
const OSM_SOURCE_NAME = 'دایرکتوری نقشه باز (OpenStreetMap)'
const SERPER_SOURCE_NAME = 'جستجوی وب (Serper / Google)'

// Registers the built-in sources the admin UI always shows, if they don't
// already exist - idempotent, safe to call on every page load. Nothing here
// enables/disables an EXISTING row - ensureSourceExists never touches a row
// that's already there, `enabled` below only ever applies the first time a
// row is created.
//
// Phase 23C: Serper is the primary live source (enabled by default) - real
// testing of OSM/Overpass's public mirrors (Phase 23B) showed them too
// unreliable (timeouts, HTTP 406s) to be primary, so on a FRESH install OSM
// now starts disabled, kept only as an optional secondary/experimental
// source an admin can turn on from /admin/prospecting's "منابع" tab. This
// does not retroactively disable an OSM row that already exists and that an
// admin may have already enabled themselves.
export async function ensureDefaultSources(client) {
  const uploaded = await ensureSourceExists(client, { name: UPLOADED_DATASET_SOURCE_NAME, sourceType: 'uploaded_dataset' })
  const serper = await ensureSourceExists(client, {
    name: SERPER_SOURCE_NAME,
    sourceType: 'search_result',
    enabled: true,
    config: { queryTemplates: DEFAULT_SERPER_QUERY_TEMPLATES, gl: 'ir', hl: 'fa', resultsPerQuery: 10, rotate: true, queriesPerRun: DEFAULT_ROTATING_QUERIES_PER_RUN, maxPages: 3 },
  })
  const osm = await ensureSourceExists(client, {
    name: OSM_SOURCE_NAME,
    sourceType: 'public_directory',
    enabled: false,
    config: { keywords: ['پلاستیک', 'پلیمر', 'مستربچ'], countryCode: 'IR', limit: 80, tier: 'secondary' },
  })
  return [uploaded, serper, osm]
}

export async function setSourceEnabled(client, sourceId, enabled) {
  const { data, error } = await client
    .from('prospect_sources')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', sourceId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// "Test source" - calls the adapter's own healthCheck() without discovering
// or writing any candidates, and records the result on the source row so
// its "آخرین خطا" stays accurate even between real runs.
export async function testSource(client, sourceId) {
  const { data: source, error } = await client.from('prospect_sources').select('*').eq('id', sourceId).single()
  if (error) throw error
  const adapter = getSourceAdapter(source.source_type)
  const result = await adapter.healthCheck(source)
  const { data: updated, error: updateError } = await client
    .from('prospect_sources')
    .update({
      last_run_at: new Date().toISOString(),
      last_success_at: result.ok ? new Date().toISOString() : source.last_success_at,
      last_error: result.ok ? null : result.message,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sourceId)
    .select('*')
    .single()
  if (updateError) throw updateError
  return { source: updated, result }
}

// Convenience wrapper for the admin UI's "upload a list" flow - ensures a
// single reusable 'uploaded_dataset' source row exists, then runs the same
// discovery pipeline against the pasted/uploaded rows.
export async function runUploadedDatasetDiscovery(client, { rows, createdBy }) {
  const source = await ensureSourceExists(client, { name: UPLOADED_DATASET_SOURCE_NAME, sourceType: 'uploaded_dataset' })
  return runDiscovery(client, { sourceId: source.id, runType: 'manual', uploadedRows: rows, createdBy })
}
