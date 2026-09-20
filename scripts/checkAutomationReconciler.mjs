// Lightweight pure-logic checks for the Automation Engine's shared
// reconciliation layer (src/automation/reconciler.js + ruleDefinitions.js).
// No new test framework - just Node's built-in assert, run directly with
// `node scripts/checkAutomationReconciler.mjs`. Covers the properties that
// matter most now that the same code runs both in the browser and inside
// the automation-reconcile Edge Function: idempotency, do_not_contact
// safety, the global pause switch, and per-rule enabled gating.

import assert from 'node:assert/strict'
import { computeReconciliationPlan } from '../src/automation/reconciler.js'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

function baseRule(overrides = {}) {
  return {
    rule_key: 'order_pending_review',
    enabled: true,
    autonomy_mode: 'observe',
    priority: 50,
    delay_minutes: 0,
    max_attempts: 3,
    ...overrides,
  }
}

function baseSettings(overrides = {}) {
  return { id: 1, enabled: true, ...overrides }
}

function emptyBusinessData(overrides = {}) {
  return {
    leads: [],
    orders: [],
    invoicesWithRemaining: [],
    quotedSinceMap: new Map(),
    suggestions: [],
    isSuggestionSnoozed: () => false,
    leadsById: new Map(),
    ordersById: new Map(),
    invoicesById: new Map(),
    suggestionsById: new Map(),
    ...overrides,
  }
}

const now = new Date('2026-09-19T10:00:00+03:30')

// ---------------------------------------------------------------------------

check('generates a task for a qualifying pending_review order', () => {
  const order = { id: 'order-1', order_number: '1001', company_id: 'c1', status: 'pending_review', created_at: now.toISOString() }
  const rule = baseRule()
  const rulesByType = new Map([['order_pending_review', rule]])

  const plan = computeReconciliationPlan({
    settings: baseSettings(),
    rulesByType,
    existingTasks: [],
    businessData: emptyBusinessData({ orders: [order], ordersById: new Map([[order.id, order]]) }),
    now,
  })

  assert.equal(plan.toCreate.length, 1)
  assert.equal(plan.toCreate[0].task_type, 'order_pending_review')
  assert.equal(plan.toCreate[0].dedupe_key, 'order_pending_review:order-1')
  assert.equal(plan.toCreate[0].status, 'pending')
})

check('is idempotent - a surviving task with the same dedupe_key is not recreated', () => {
  const order = { id: 'order-1', order_number: '1001', company_id: 'c1', status: 'pending_review', created_at: now.toISOString() }
  const rulesByType = new Map([['order_pending_review', baseRule()]])
  const existingTask = {
    id: 'task-1',
    task_type: 'order_pending_review',
    dedupe_key: 'order_pending_review:order-1',
    status: 'ready',
    order_id: order.id,
    priority: 50,
  }

  const plan = computeReconciliationPlan({
    settings: baseSettings(),
    rulesByType,
    existingTasks: [existingTask],
    businessData: emptyBusinessData({ orders: [order], ordersById: new Map([[order.id, order]]) }),
    now,
  })

  assert.equal(plan.toCreate.length, 0, 'must not duplicate an already-surviving task')
  assert.equal(plan.toCancel.length, 0)
  assert.equal(plan.toComplete.length, 0)
})

check('disabled rule blocks generation even when data qualifies', () => {
  const order = { id: 'order-1', order_number: '1001', company_id: 'c1', status: 'pending_review', created_at: now.toISOString() }
  const rulesByType = new Map([['order_pending_review', baseRule({ enabled: false })]])

  const plan = computeReconciliationPlan({
    settings: baseSettings(),
    rulesByType,
    existingTasks: [],
    businessData: emptyBusinessData({ orders: [order], ordersById: new Map([[order.id, order]]) }),
    now,
  })

  assert.equal(plan.toCreate.length, 0)
})

check('global pause blocks generation but invalidation still runs', () => {
  const lead = { id: 'lead-1', status: 'lost', do_not_contact: false, next_follow_up_at: null }
  const rulesByType = new Map([['lead_first_contact', baseRule({ rule_key: 'lead_first_contact', priority: 40 })]])
  const existingTask = {
    id: 'task-2',
    task_type: 'lead_first_contact',
    dedupe_key: 'lead_first_contact:lead-1',
    status: 'ready',
    lead_id: lead.id,
    priority: 40,
  }

  const plan = computeReconciliationPlan({
    settings: baseSettings({ enabled: false }),
    rulesByType,
    existingTasks: [existingTask],
    businessData: emptyBusinessData({ leads: [lead], leadsById: new Map([[lead.id, lead]]) }),
    now,
  })

  assert.equal(plan.toCreate.length, 0, 'generation must stay off while globally paused')
  assert.equal(plan.toCancel.length, 1, 'safety invalidation (lead lost) must still run while paused')
  assert.equal(plan.toCancel[0].taskId, 'task-2')
})

check('do_not_contact leads never generate first-contact tasks', () => {
  const lead = {
    id: 'lead-2',
    status: 'new',
    do_not_contact: true,
    mobile: '09120000000',
    last_contact_at: null,
    next_follow_up_at: null,
  }
  const rulesByType = new Map([['lead_first_contact', baseRule({ rule_key: 'lead_first_contact', priority: 40 })]])

  const plan = computeReconciliationPlan({
    settings: baseSettings(),
    rulesByType,
    existingTasks: [],
    businessData: emptyBusinessData({ leads: [lead], leadsById: new Map([[lead.id, lead]]) }),
    now,
  })

  assert.equal(plan.toCreate.length, 0, 'do_not_contact must be a hard safety block, never a generated task')
})

check('do_not_contact set on an existing task cancels it, regardless of rule mode', () => {
  const lead = { id: 'lead-3', status: 'new', do_not_contact: true, next_follow_up_at: '2026-09-19T06:00:00.000Z' }
  const rulesByType = new Map([['lead_followup_due', baseRule({ rule_key: 'lead_followup_due', priority: 30 })]])
  const existingTask = {
    id: 'task-3',
    task_type: 'lead_followup_due',
    dedupe_key: `lead_followup_due:lead-3:${lead.next_follow_up_at}`,
    status: 'ready',
    lead_id: lead.id,
    due_at: lead.next_follow_up_at,
    priority: 30,
  }

  const plan = computeReconciliationPlan({
    settings: baseSettings(),
    rulesByType,
    existingTasks: [existingTask],
    businessData: emptyBusinessData({ leads: [lead], leadsById: new Map([[lead.id, lead]]) }),
    now,
  })

  assert.equal(plan.toCancel.length, 1)
  assert.equal(plan.toCancel[0].taskId, 'task-3')
})

console.log(`\n${passed} check(s) passed.`)
