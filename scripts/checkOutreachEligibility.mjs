// Lightweight pure-logic checks for the Phase 19 Outreach Hub (src/outreach/*).
// No new test framework - just Node's built-in assert, run directly with
// `node scripts/checkOutreachEligibility.mjs`. Covers the properties the
// Phase 19 spec calls out explicitly: do_not_contact/converted leads never
// become eligible, missing contact data blocks correctly, cooldown/max-
// attempts are hard blocks, and channel selection follows the documented
// priority order.

import assert from 'node:assert/strict'
import { evaluateOutreachOpportunity } from '../src/outreach/eligibility.js'
import { selectOutreachChannel } from '../src/outreach/channelSelection.js'
import { evaluateContactWindow } from '../src/outreach/contactWindow.js'
import { composeOutreachMessage } from '../src/outreach/messageComposer.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

function baseLead(overrides = {}) {
  return {
    id: 'lead-1',
    company_name: 'شرکت نمونه',
    contact_name: 'آقای رضایی',
    mobile: '09121234567',
    phone: null,
    email: null,
    status: 'new',
    do_not_contact: false,
    preferred_channel: null,
    ...overrides,
  }
}

// contact_window_start/end mirror what Supabase actually returns for a
// Postgres `time` column - an "HH:MM:SS" string, never a number.
const defaultSettings = {
  contact_window_start: '09:00:00',
  contact_window_end: '19:00:00',
  outreach_cooldown_hours: 20,
  max_contact_attempts: 6,
}
const noon = new Date('2026-09-20T09:00:00+03:30') // 09:00 Tehran - inside the default window

check('do_not_contact lead is always blocked', () => {
  const lead = baseLead({ do_not_contact: true })
  const result = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: [], duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

check('converted lead is always blocked', () => {
  const lead = baseLead({ status: 'converted' })
  const result = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: [], duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

check('lost lead is always blocked', () => {
  const lead = baseLead({ status: 'lost' })
  const result = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: [], duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

check('lead with no contact channel is blocked, not hallucinated as eligible', () => {
  const lead = baseLead({ mobile: null, phone: null, email: null })
  const result = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: [], duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
  assert.equal(result.channel, null)
})

check('max contact attempts reached blocks further outreach', () => {
  const lead = baseLead()
  const attempts = Array.from({ length: 6 }, (_, i) => ({ status: 'completed', created_at: `2020-01-0${(i % 9) + 1}T00:00:00Z` }))
  const result = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: attempts, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
})

check('recent outreach within cooldown blocks a repeat attempt', () => {
  const lead = baseLead()
  const attempts = [{ status: 'opened', created_at: new Date(noon.getTime() - 2 * 60 * 60 * 1000).toISOString() }]
  const result = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: attempts, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'blocked')
  assert.ok(result.nextAvailableAt)
})

check('an attempt older than the cooldown window no longer blocks', () => {
  const lead = baseLead()
  const attempts = [{ status: 'opened', created_at: new Date(noon.getTime() - 30 * 60 * 60 * 1000).toISOString() }]
  const result = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: attempts, duplicateRiskIds: new Set(), now: noon })
  assert.equal(result.outreachStatus, 'eligible')
})

check('duplicate-risk lead is manual_review, not silently blocked or hidden', () => {
  const lead = baseLead()
  const result = evaluateOutreachOpportunity({
    lead,
    settings: defaultSettings,
    leadAttempts: [],
    duplicateRiskIds: new Set(['lead-1']),
    now: noon,
  })
  assert.equal(result.outreachStatus, 'manual_review')
  assert.equal(result.channel, 'whatsapp')
})

check('repeated evaluation with identical input is idempotent', () => {
  const lead = baseLead()
  const a = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: [], duplicateRiskIds: new Set(), now: noon })
  const b = evaluateOutreachOpportunity({ lead, settings: defaultSettings, leadAttempts: [], duplicateRiskIds: new Set(), now: noon })
  assert.deepEqual(a, b)
})

check('channel selection: whatsapp wins when a valid mobile exists and nothing preferred', () => {
  assert.equal(selectOutreachChannel(baseLead()), 'whatsapp')
})

check('channel selection: preferred_channel is honored when usable', () => {
  assert.equal(selectOutreachChannel(baseLead({ preferred_channel: 'email', email: 'x@example.com' })), 'email')
})

check('channel selection: an unusable preferred_channel falls back to priority order', () => {
  assert.equal(selectOutreachChannel(baseLead({ preferred_channel: 'email', email: null })), 'whatsapp')
})

check('channel selection: landline-only lead gets phone, not whatsapp/sms', () => {
  assert.equal(selectOutreachChannel(baseLead({ mobile: null, phone: '02144667800' })), 'phone')
})

check('channel selection: email-only lead gets email', () => {
  assert.equal(selectOutreachChannel(baseLead({ mobile: null, phone: null, email: 'x@example.com' })), 'email')
})

check('contact window: 09:00 Tehran is within the default 9-19 window', () => {
  const result = evaluateContactWindow(defaultSettings, noon)
  assert.equal(result.withinWindow, true)
})

check('contact window: 22:00 Tehran is outside the default window and returns a next time', () => {
  const evening = new Date('2026-09-20T22:00:00+03:30')
  const result = evaluateContactWindow(defaultSettings, evening)
  assert.equal(result.withinWindow, false)
  assert.ok(result.nextAvailableAt)
})

check('message composer never produces the exact same text for different lead contexts', () => {
  const withProduct = composeOutreachMessage('lead_first_contact', {
    lead: baseLead(),
    productNames: ['مستربچ سفید'],
  })
  const withoutProduct = composeOutreachMessage('lead_first_contact', { lead: baseLead(), productNames: [] })
  assert.notEqual(withProduct, withoutProduct)
})

console.log(`\n${passed} check(s) passed.`)
