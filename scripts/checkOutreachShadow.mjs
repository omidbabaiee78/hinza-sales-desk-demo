// Phase 25 - Autonomous Outreach SHADOW MODE regression checks.
// No new test framework - Node's built-in assert, run directly with
// `node scripts/checkOutreachShadow.mjs`.

import assert from 'node:assert/strict'
import { evaluateShadowOutreachOpportunity, computeShadowPriority } from '../src/outreach/prospectingShadow.js'
import { composeShadowOutreachMessage, sanitizeIndustryLabelsForCustomerFacing } from '../src/outreach/shadowMessageComposer.js'
import { runShadowOutreachCycle } from '../src/outreach/shadowPipeline.js'
import { whatsappChannel } from '../src/outreach/channels/whatsapp.js'
import { smsChannel } from '../src/outreach/channels/sms.js'
import { emailChannel } from '../src/outreach/channels/email.js'
import { phoneChannel } from '../src/outreach/channels/phone.js'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`ok - ${name}`)
}

// ---------------------------------------------------------------------------
// Fake Supabase client - same minimal in-memory harness style as
// scripts/checkProspecting.mjs's makeFakeClient(), extended with .contains()
// for the tags array filter shadowPipeline.js uses.
// ---------------------------------------------------------------------------

function makeFakeClient() {
  const tables = {
    sales_leads: [],
    prospect_candidates: [],
    prospect_evidence: [],
    outreach_attempts: [],
    prospect_outreach_suggestions: [],
    prospect_outreach_runs: [],
    automation_settings: [
      {
        id: 1,
        contact_window_start: '09:00:00',
        contact_window_end: '19:00:00',
        outreach_cooldown_hours: 20,
        max_contact_attempts: 6,
        shadow_mode: true,
        outreach_enabled: false,
        max_suggestions_per_run: 20,
      },
    ],
  }
  let nextId = 1
  const newId = (table) => `${table}-${nextId++}`

  function matches(row, filters) {
    return filters.every(([type, field, value]) => {
      if (type === 'eq') return row[field] === value
      if (type === 'neq') return row[field] !== value
      if (type === 'in') return value.includes(row[field])
      if (type === 'contains') return Array.isArray(row[field]) && value.every((v) => row[field].includes(v))
      return true
    })
  }

  function selectChain(table) {
    const filters = []
    let orderField = null
    let ascending = true
    let limitN = null
    const resolveRows = () => {
      let rows = tables[table].filter((r) => matches(r, filters)).map((r) => ({ ...r }))
      if (orderField) rows.sort((a, b) => (a[orderField] > b[orderField] ? 1 : -1) * (ascending ? 1 : -1))
      if (limitN != null) rows = rows.slice(0, limitN)
      return rows
    }
    const chain = {
      eq: (f, v) => (filters.push(['eq', f, v]), chain),
      neq: (f, v) => (filters.push(['neq', f, v]), chain),
      in: (f, v) => (filters.push(['in', f, v]), chain),
      contains: (f, v) => (filters.push(['contains', f, v]), chain),
      order: (f, opts = {}) => {
        orderField = f
        ascending = opts.ascending !== false
        return chain
      },
      limit: (n) => {
        limitN = n
        return chain
      },
      single: async () => {
        const rows = resolveRows()
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }
      },
      maybeSingle: async () => ({ data: resolveRows()[0] || null, error: null }),
      then: (resolve) => resolve({ data: resolveRows(), error: null }),
    }
    return chain
  }

  function insertChain(table, payload) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
      id: newId(table),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ...row,
    }))
    // Emulate the dedupe_key UNIQUE constraint for upsert(...,
    // {onConflict:'dedupe_key', ignoreDuplicates:true}) - the only upsert
    // shape shadowPipeline.js actually uses.
    const inserted = []
    for (const row of rows) {
      if (row.dedupe_key && tables[table].some((r) => r.dedupe_key === row.dedupe_key)) continue
      tables[table].push(row)
      inserted.push(row)
    }
    return {
      select: () => ({
        single: async () => ({ data: inserted[0] || rows[0], error: null }),
        then: (resolve) => resolve({ data: inserted, error: null }),
      }),
      then: (resolve) => resolve({ data: inserted, error: null }),
    }
  }

  function updateChain(table, patch) {
    return {
      eq: (field, value) => {
        const rows = tables[table].filter((r) => r[field] === value)
        rows.forEach((r) => Object.assign(r, patch))
        const result = { data: rows[0] || null, error: null }
        return { select: () => ({ single: async () => result }), then: (resolve) => resolve(result) }
      },
    }
  }

  return {
    from(table) {
      return {
        select: () => selectChain(table),
        insert: (payload) => insertChain(table, payload),
        upsert: (payload) => insertChain(table, payload),
        update: (patch) => updateChain(table, patch),
      }
    },
    tables,
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function prospectLead(overrides = {}) {
  return {
    id: `lead-${Math.random().toString(36).slice(2, 8)}`,
    company_name: 'صنایع پلاستیک نمونه',
    contact_name: 'آقای احمدی',
    mobile: '09121234567',
    phone: null,
    email: null,
    status: 'new',
    do_not_contact: false,
    preferred_channel: null,
    tags: ['prospecting'],
    industry: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function strongCandidate(overrides = {}) {
  return {
    id: `cand-${Math.random().toString(36).slice(2, 8)}`,
    overall_score: 80,
    confidence: 'high',
    industry_guess: 'تولید فیلم پلاستیک',
    source_url: 'https://example.com',
    ...overrides,
  }
}

const noon = new Date('2026-09-22T09:00:00+03:30') // within the default 09:00-19:00 Tehran window
const midnight = new Date('2026-09-22T02:00:00+03:30') // outside the window

// ---------------------------------------------------------------------------
// Pure logic: evaluateShadowOutreachOpportunity
// ---------------------------------------------------------------------------

await check('an eligible new lead with a strong candidate and mobile contact is eligible, with a priority and channel', () => {
  const lead = prospectLead()
  const candidate = strongCandidate()
  const result = evaluateShadowOutreachOpportunity({ lead, candidate, settings: {}, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'eligible')
  assert.equal(result.channel, 'whatsapp')
  assert.ok(typeof result.priority === 'number')
})

await check('a lead with no contact channel at all is blocked, never hallucinated as eligible', () => {
  const lead = prospectLead({ mobile: null, phone: null, email: null })
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

await check('a do_not_contact lead is always blocked', () => {
  const lead = prospectLead({ do_not_contact: true })
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

await check('a converted lead is always blocked', () => {
  const lead = prospectLead({ status: 'converted' })
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

await check('a lost lead is always blocked', () => {
  const lead = prospectLead({ status: 'lost' })
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

await check('a duplicate-risk lead is manual_review, never silently eligible', () => {
  const lead = prospectLead()
  const result = evaluateShadowOutreachOpportunity({
    lead,
    candidate: strongCandidate(),
    settings: {},
    duplicateRiskIds: new Set([lead.id]),
    now: noon,
  })
  assert.equal(result.outreachStatus, 'manual_review')
})

await check('a recent qualifying contact attempt blocks via cooldown', () => {
  const lead = prospectLead()
  const attempts = [{ status: 'completed', created_at: new Date(noon.getTime() - 60 * 60 * 1000).toISOString() }]
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, leadAttempts: attempts, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

await check('outside the contact window is "waiting", never lost as blocked', () => {
  const lead = prospectLead()
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, duplicateRiskIds: new Set(), now: midnight })
  assert.equal(result.outreachStatus, 'waiting')
  assert.ok(result.nextAvailableAt)
})

await check('a manually snoozed lead is "waiting" until the snooze expires', () => {
  const lead = prospectLead()
  const snoozedUntil = new Date(noon.getTime() + 2 * 60 * 60 * 1000).toISOString()
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, duplicateRiskIds: new Set(), snoozedUntil, now: noon })
  assert.equal(result.outreachStatus, 'waiting')
  assert.equal(result.nextAvailableAt, snoozedUntil)
})

await check('a lead with an already-pending suggestion is "waiting", never re-suggested', () => {
  const lead = prospectLead()
  const result = evaluateShadowOutreachOpportunity({ lead, candidate: strongCandidate(), settings: {}, duplicateRiskIds: new Set(), hasActionableSuggestion: true, now: noon })
  assert.equal(result.outreachStatus, 'waiting')
})

await check('a low-confidence, low-score candidate is manual_review, not auto-suggested', () => {
  const lead = prospectLead()
  const candidate = strongCandidate({ overall_score: 47, confidence: 'low' })
  const result = evaluateShadowOutreachOpportunity({ lead, candidate, settings: {}, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'manual_review')
})

await check('a high-confidence candidate at the same score is still eligible (confidence, not score alone, gates the extra review)', () => {
  const lead = prospectLead()
  const candidate = strongCandidate({ overall_score: 47, confidence: 'high' })
  const result = evaluateShadowOutreachOpportunity({ lead, candidate, settings: {}, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'eligible')
})

await check('priority is deterministic: higher score / higher confidence / fresher lead -> lower (more urgent) number', () => {
  const now = noon
  const strong = computeShadowPriority({ candidate: strongCandidate({ overall_score: 90, confidence: 'high' }), lead: { created_at: now.toISOString() }, now })
  const weak = computeShadowPriority({ candidate: strongCandidate({ overall_score: 50, confidence: 'medium' }), lead: { created_at: now.toISOString() }, now })
  assert.ok(strong < weak, 'a stronger candidate must get a lower (more urgent) priority number')
})

// ---------------------------------------------------------------------------
// Message composer - grounding / hedged language
// ---------------------------------------------------------------------------

await check('message composer uses hedged "may be relevant" language for product fit, never a confirmed-need claim', () => {
  const { message } = composeShadowOutreachMessage({ lead: prospectLead(), industryLabels: [], productFitProducts: ['مستربچ سفید'] })
  assert.match(message, /ممکن است.*مرتبط باشد/)
  assert.doesNotMatch(message, /می‌دانیم که شما.*نیاز دارید/)
})

await check('message composer falls back to a safe generic line when there is no evidence at all - never invents specifics', () => {
  const { message, evidenceUsed } = composeShadowOutreachMessage({ lead: prospectLead(), industryLabels: [], productFitProducts: [] })
  assert.equal(evidenceUsed, 'none')
  assert.ok(message.length > 0)
})

// ---------------------------------------------------------------------------
// Phase 25 quality fix - raw source/adapter taxonomy must NEVER reach
// customer-facing copy. General allowlist-based sanitization, not a
// blocklist of specific bad strings.
// ---------------------------------------------------------------------------

await check('a raw OSM tag value ("works") never appears in customer-facing message text, even if a caller passed it by mistake', () => {
  const { message } = composeShadowOutreachMessage({ lead: prospectLead(), industryLabels: ['works'], productFitProducts: [] })
  assert.doesNotMatch(message, /works/)
})

await check('sanitizeIndustryLabelsForCustomerFacing drops "works" - not because it is specifically blocked, but because it is not a real TARGET_INDUSTRIES label', () => {
  assert.deepEqual(sanitizeIndustryLabelsForCustomerFacing(['works']), [])
})

await check('a generic raw tag ("industrial") is never turned into an invented specific industry', () => {
  const { message } = composeShadowOutreachMessage({ lead: prospectLead(), industryLabels: ['industrial'], productFitProducts: [] })
  assert.doesNotMatch(message, /industrial/)
  // falls through to the fully generic line, never a fabricated specific claim
  assert.match(message, /در زمینه تأمین مستربچ و مواد پلیمری فعالیت داریم/)
})

await check('an unrecognized/unknown raw value ("yes"/"unknown") is safely omitted, not exposed and not guessed', () => {
  assert.deepEqual(sanitizeIndustryLabelsForCustomerFacing(['yes', 'unknown', 'other']), [])
  const { message } = composeShadowOutreachMessage({ lead: prospectLead(), industryLabels: ['yes', 'unknown'], productFitProducts: [] })
  assert.doesNotMatch(message, /\byes\b|\bunknown\b/)
})

await check('a genuine, curated target-industry label (e.g. "قالب‌گیری تزریقی") remains available and IS used in the message', () => {
  assert.deepEqual(sanitizeIndustryLabelsForCustomerFacing(['قالب‌گیری تزریقی']), ['قالب‌گیری تزریقی'])
  const { message, evidenceUsed } = composeShadowOutreachMessage({ lead: prospectLead(), industryLabels: ['قالب‌گیری تزریقی'], productFitProducts: [] })
  assert.match(message, /قالب‌گیری تزریقی/)
  assert.equal(evidenceUsed, 'industry_taxonomy_match')
})

await check('a mix of one real label and one raw/unknown value keeps only the real one', () => {
  assert.deepEqual(sanitizeIndustryLabelsForCustomerFacing(['works', 'بسته‌بندی پلاستیکی']), ['بسته‌بندی پلاستیکی'])
})

await check('empty product-fit AND no real industry label produces safe, fully generic copy - never a raw label substitute', () => {
  const { message, evidenceUsed } = composeShadowOutreachMessage({ lead: prospectLead(), industryLabels: ['works', 'yes'], productFitProducts: [] })
  assert.equal(evidenceUsed, 'none')
  assert.doesNotMatch(message, /works|yes/)
  assert.match(message, /در زمینه تأمین مستربچ و مواد پلیمری فعالیت داریم/)
})

// ---------------------------------------------------------------------------
// Structural "never sends anything" guarantee
// ---------------------------------------------------------------------------

await check('every outreach channel adapter\'s execute() is structurally disabled - it throws, unconditionally', () => {
  for (const channel of [whatsappChannel, smsChannel, emailChannel, phoneChannel]) {
    assert.throws(() => channel.execute())
  }
})

// ---------------------------------------------------------------------------
// Full pipeline (runShadowOutreachCycle) via the fake client
// ---------------------------------------------------------------------------

async function seedLead(client, overrides = {}) {
  const { data: lead } = await client.from('sales_leads').insert(prospectLead(overrides)).select().single()
  return lead
}
async function seedCandidate(client, leadId, overrides = {}) {
  const { data: candidate } = await client.from('prospect_candidates').insert(strongCandidate({ promoted_lead_id: leadId, ...overrides })).select().single()
  return candidate
}

await check('a fresh shadow run creates a suggestion for an eligible prospecting lead', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client)
  await seedCandidate(client, lead.id)
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.status, 'completed')
  assert.equal(run.leads_scanned, 1)
  assert.equal(run.eligible_count, 1)
  assert.equal(run.suggestions_created, 1)
  assert.equal(client.tables.prospect_outreach_suggestions.length, 1)
  assert.equal(client.tables.prospect_outreach_suggestions[0].status, 'pending')
  assert.ok(client.tables.prospect_outreach_suggestions[0].message_draft)
})

await check('Phase 25 quality fix, end-to-end: a raw OSM industry_guess ("works") with no real keyword evidence never leaks into the suggestion message, but IS preserved for diagnostics', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client)
  await seedCandidate(client, lead.id, { industry_guess: 'works', business_description: null, canonical_name: 'یک کسب‌وکار نمونه' })
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.suggestions_created, 1)
  const suggestion = client.tables.prospect_outreach_suggestions[0]
  assert.doesNotMatch(suggestion.message_draft, /works/)
  assert.equal(suggestion.evidence_snapshot.rawIndustryGuess, 'works', 'the raw value is still kept internally for diagnostics/audit')
  assert.deepEqual(suggestion.evidence_snapshot.industryLabelsUsed, [], 'no real target-industry label was actually matched')
})

await check('Phase 25 quality fix, end-to-end: genuine keyword evidence in business_description DOES produce the real target-industry label in the message', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client)
  await seedCandidate(client, lead.id, {
    industry_guess: 'works', // still a raw, unhelpful tag - the message must be grounded by the REAL evidence below, not this
    canonical_name: 'کارخانه تولیدی نمونه',
    business_description: 'تولیدکننده قطعات پلاستیکی به روش تزریق پلاستیک',
  })
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.suggestions_created, 1)
  const suggestion = client.tables.prospect_outreach_suggestions[0]
  // The matched industry (قالب‌گیری تزریقی) also has real productFit
  // categories, so the composer prefers the more specific product-fit
  // sentence over the industry sentence (existing, correct precedence) -
  // what matters here is that the REAL match was found and tracked, never
  // the raw "works" tag, regardless of which sentence variant wins.
  assert.doesNotMatch(suggestion.message_draft, /works/)
  assert.ok(suggestion.evidence_snapshot.industryLabelsUsed.includes('قالب‌گیری تزریقی'), 'the real target-industry label was matched from genuine evidence')
})

await check('a non-prospecting lead (no "prospecting" tag) is never scanned', async () => {
  const client = makeFakeClient()
  await seedLead(client, { tags: ['manual'] })
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.leads_scanned, 0)
  assert.equal(run.suggestions_created, 0)
})

await check('a repeated shadow run creates ZERO duplicate pending suggestions (idempotency, STEP 7)', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client)
  await seedCandidate(client, lead.id)
  await runShadowOutreachCycle(client, { runType: 'manual' })
  const secondRun = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(client.tables.prospect_outreach_suggestions.length, 1, 'still only one suggestion after two runs')
  assert.equal(secondRun.suggestions_created, 0)
  assert.equal(secondRun.duplicates_skipped, 1)
})

await check('a do_not_contact lead never gets a suggestion, and is counted as blocked', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client, { do_not_contact: true })
  await seedCandidate(client, lead.id)
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.blocked_count, 1)
  assert.equal(run.suggestions_created, 0)
})

await check('a converted lead never gets a suggestion', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client, { status: 'converted' })
  await seedCandidate(client, lead.id)
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.blocked_count, 1)
  assert.equal(run.suggestions_created, 0)
})

await check('a lead missing a usable contact channel is blocked, not suggested', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client, { mobile: null, phone: null, email: null })
  await seedCandidate(client, lead.id)
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.blocked_count, 1)
  assert.equal(run.suggestions_created, 0)
})

await check('two leads sharing the same mobile are both flagged manual_review as duplicate risk, neither auto-suggested', async () => {
  const client = makeFakeClient()
  const leadA = await seedLead(client, { mobile: '09121112233' })
  const leadB = await seedLead(client, { mobile: '09121112233' })
  await seedCandidate(client, leadA.id)
  await seedCandidate(client, leadB.id)
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.manual_review_count, 2)
  assert.equal(run.suggestions_created, 0)
})

await check('a lead with a recent qualifying outreach_attempts row is blocked by cooldown', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client)
  await seedCandidate(client, lead.id)
  await client.from('outreach_attempts').insert({ lead_id: lead.id, channel: 'whatsapp', purpose: 'test', status: 'completed', created_at: new Date().toISOString() })
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.blocked_count, 1)
  assert.equal(run.suggestions_created, 0)
})

await check('a lead with an existing pending suggestion is skipped as a duplicate on the next run, not re-suggested', async () => {
  const client = makeFakeClient()
  const lead = await seedLead(client)
  await seedCandidate(client, lead.id)
  await client.from('prospect_outreach_suggestions').insert({ lead_id: lead.id, dedupe_key: `prospect_outreach:${lead.id}`, outreach_status: 'eligible', status: 'pending' })
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.suggestions_created, 0)
  assert.equal(run.duplicates_skipped, 1)
  assert.equal(client.tables.prospect_outreach_suggestions.length, 1, 'no second row created')
})

await check('zero eligible leads completes cleanly with suggestions_created=0 and no errors', async () => {
  const client = makeFakeClient()
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.status, 'completed')
  assert.equal(run.leads_scanned, 0)
  assert.equal(run.suggestions_created, 0)
  assert.equal(run.errors_count, 0)
})

await check('max_suggestions_per_run caps how many new suggestions one run creates', async () => {
  const client = makeFakeClient()
  client.tables.automation_settings[0].max_suggestions_per_run = 1
  const leadA = await seedLead(client, { company_name: 'شرکت الف', mobile: '09121110001' })
  const leadB = await seedLead(client, { company_name: 'شرکت ب', mobile: '09121110002' })
  await seedCandidate(client, leadA.id)
  await seedCandidate(client, leadB.id)
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.suggestions_created, 1, 'only one suggestion created even though two leads were eligible')
})

await check('a scheduled run is skipped while another scheduled run is already "running" (duplicate invocation safety)', async () => {
  const client = makeFakeClient()
  await client.from('prospect_outreach_runs').insert({ run_type: 'scheduled', status: 'running' })
  const result = await runShadowOutreachCycle(client, { runType: 'scheduled' })
  assert.equal(result.skipped, true)
  assert.equal(client.tables.prospect_outreach_runs.length, 1)
})

await check('a shadow run never writes to any table other than prospect_outreach_suggestions/prospect_outreach_runs (no outreach/messaging side effects)', async () => {
  // The fake client defines ONLY sales_leads/prospect_candidates/
  // prospect_evidence/outreach_attempts/prospect_outreach_* tables - if the
  // pipeline ever tried to write to an actual messaging/send table, this
  // would throw (tables[unknown] is undefined) instead of completing.
  const client = makeFakeClient()
  const lead = await seedLead(client)
  await seedCandidate(client, lead.id)
  const outreachAttemptsBefore = client.tables.outreach_attempts.length
  const run = await runShadowOutreachCycle(client, { runType: 'manual' })
  assert.equal(run.status, 'completed')
  assert.equal(client.tables.outreach_attempts.length, outreachAttemptsBefore, 'outreach_attempts (real send-attempt log) must never be written by the shadow runner itself')
})

console.log(`\n${passed} check(s) passed.`)
