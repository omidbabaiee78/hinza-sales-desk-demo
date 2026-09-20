// Automation DB I/O layer. No Supabase client is imported here - every
// function takes one as its first argument. This is what lets the exact
// same reconciliation code run two ways with zero duplicated logic:
//   - frontend adapter: the browser's authenticated client (src/lib/supabaseClient.js)
//   - server adapter: a service-role client built inside the Edge Function
//     (supabase/functions/automation-reconcile/index.ts)
// Only the CLIENT differs between the two; every query/mutation below is
// shared verbatim.
import { buildTransitionTimestampMap } from '../messagingRules/orderEventResolver.js'
import { computeReconciliationPlan, isNonTerminalStatus } from './reconciler.js'
import { logTaskEventsBatch, logTaskEvent } from './taskEvents.js'

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
  return chunks
}

async function currentUserId(client) {
  try {
    const {
      data: { user },
    } = await client.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Reads - automation_settings / automation_rules / automation_tasks.
// ---------------------------------------------------------------------------

export async function fetchAutomationSettings(client) {
  const { data, error } = await client.from('automation_settings').select('*').eq('id', 1).single()
  if (error) throw error
  return data
}

export async function fetchAutomationRules(client) {
  const { data, error } = await client.from('automation_rules').select('*')
  if (error) throw error
  return data || []
}

// automation_rules identifies its row by `rule_key` (its value is the same
// task_type string, but the COLUMN name differs from automation_tasks.task_type).
export function buildRulesByType(rules) {
  return new Map(rules.map((r) => [r.rule_key, r]))
}

const NON_TERMINAL_STATUS_LIST = ['pending', 'ready', 'waiting_approval', 'snoozed', 'failed']

// Every currently-live task - bounded by "how much work is active right
// now", never the full historical table.
export async function fetchActiveAndFailedTasks(client) {
  const { data, error } = await client.from('automation_tasks').select('*').in('status', NON_TERMINAL_STATUS_LIST)
  if (error) throw error
  return data || []
}

const HISTORY_LIMIT = 60

export async function fetchTaskHistory(client) {
  const { data, error } = await client
    .from('automation_tasks')
    .select('*')
    .in('status', ['completed', 'cancelled', 'expired'])
    .order('updated_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (error) throw error
  return data || []
}

// ---------------------------------------------------------------------------
// Business-data snapshot for the reconciler - lean, targeted queries only.
// Orders/invoices are fetched TWICE on purpose: once for the active
// candidate-generation set (current relevant statuses), once by the exact
// ids existing tasks already reference (so a task whose order/invoice moved
// OUTSIDE that status set can still be correctly invalidated) - never the
// full orders/invoices table.
// ---------------------------------------------------------------------------

const CANDIDATE_ORDER_STATUSES = ['pending_review', 'customer_approved', 'quoted', 'ready_for_delivery']

function fetchLeansOrdersByStatus(client) {
  return client.from('orders').select('id, order_number, company_id, status, created_at').in('status', CANDIDATE_ORDER_STATUSES)
}

function fetchLeanOrdersByIds(client, ids) {
  if (ids.length === 0) return Promise.resolve({ data: [] })
  return client.from('orders').select('id, order_number, company_id, status, created_at').in('id', ids)
}

function fetchOrderEvents(client, orderIds) {
  if (orderIds.length === 0) return Promise.resolve({ data: [] })
  return client.from('order_events').select('order_id, event_type, metadata, created_at').in('order_id', orderIds)
}

function fetchLeanOpenInvoices(client) {
  return client
    .from('invoices')
    .select('id, company_id, invoice_number, status, total_rial, due_date')
    .in('status', ['issued', 'partially_paid'])
    .not('due_date', 'is', null)
}

function fetchLeanInvoicesByIds(client, ids) {
  if (ids.length === 0) return Promise.resolve({ data: [] })
  return client.from('invoices').select('id, company_id, invoice_number, status, total_rial, due_date').in('id', ids)
}

function fetchPayments(client, invoiceIds) {
  if (invoiceIds.length === 0) return Promise.resolve({ data: [] })
  return client.from('payments').select('invoice_id, amount_rial').in('invoice_id', invoiceIds)
}

function fetchLeanLeads(client) {
  return client
    .from('sales_leads')
    .select('id, company_name, contact_name, mobile, phone, email, status, priority, do_not_contact, next_follow_up_at, last_contact_at, created_at')
}

function fetchActiveSnoozes(client) {
  const nowIso = new Date().toISOString()
  return client.from('crm_snoozes').select('company_id, reason_key, order_id, invoice_id, snooze_until').gt('snooze_until', nowIso)
}

function fetchCompanies(client, companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [] })
  return client.from('companies').select('id, name').in('id', companyIds)
}

// Read-only, no business logic - deliberately NOT imported from
// services/crmMessageSuggestions.js (that module hardcodes the browser
// client and is shared far beyond automation) so this file stays fully
// client-injectable without touching an unrelated, widely-used module.
function fetchSuggestionsForAutomation(client) {
  return client.from('crm_message_suggestions').select('*').order('priority', { ascending: true })
}

function calcPaid(payments) {
  return (payments || []).reduce((sum, p) => sum + (Number(p.amount_rial) || 0), 0)
}
function calcRemaining(total, paid) {
  const remaining = (Number(total) || 0) - (Number(paid) || 0)
  return remaining > 0 ? remaining : 0
}

// Everything computeReconciliationPlan() and the UI need in one shot -
// existingTasks are passed in so this can reuse the same order/invoice id
// set for the invalidation-lookup queries.
export async function fetchAutomationSnapshot(client, existingTasks) {
  const taskOrderIds = [...new Set(existingTasks.filter((t) => t.order_id).map((t) => t.order_id))]
  const taskInvoiceIds = [...new Set(existingTasks.filter((t) => t.invoice_id).map((t) => t.invoice_id))]

  const [candidateOrdersRes, tasksOrdersRes, openInvoicesRes, tasksInvoicesRes, leadsRes, suggestionsRes, snoozesRes] =
    await Promise.all([
      fetchLeansOrdersByStatus(client),
      fetchLeanOrdersByIds(client, taskOrderIds),
      fetchLeanOpenInvoices(client),
      fetchLeanInvoicesByIds(client, taskInvoiceIds),
      fetchLeanLeads(client),
      fetchSuggestionsForAutomation(client),
      fetchActiveSnoozes(client),
    ])

  const firstError =
    candidateOrdersRes.error || tasksOrdersRes.error || openInvoicesRes.error || tasksInvoicesRes.error ||
    leadsRes.error || suggestionsRes.error || snoozesRes.error
  if (firstError) throw firstError

  const ordersById = new Map()
  for (const order of [...(candidateOrdersRes.data || []), ...(tasksOrdersRes.data || [])]) ordersById.set(order.id, order)

  const allInvoiceRows = [...(openInvoicesRes.data || []), ...(tasksInvoicesRes.data || [])]
  const invoiceIds = [...new Set(allInvoiceRows.map((i) => i.id))]
  const { data: payments, error: paymentsError } = await fetchPayments(client, invoiceIds)
  if (paymentsError) throw paymentsError

  const paymentsByInvoiceId = new Map()
  for (const payment of payments || []) {
    const list = paymentsByInvoiceId.get(payment.invoice_id) || []
    list.push(payment)
    paymentsByInvoiceId.set(payment.invoice_id, list)
  }

  const invoicesById = new Map()
  for (const invoice of allInvoiceRows) {
    if (invoicesById.has(invoice.id)) continue
    invoicesById.set(invoice.id, {
      ...invoice,
      remainingRial: calcRemaining(invoice.total_rial, calcPaid(paymentsByInvoiceId.get(invoice.id) || [])),
    })
  }

  // sales_leads is fetched fully (no status filter), so every lead a task
  // could reference is already present - no separate "leads referenced by
  // tasks" lookup query needed, unlike orders/invoices above.
  const leadsById = new Map((leadsRes.data || []).map((l) => [l.id, l]))

  const orderIdsForEvents = [...ordersById.keys()]
  const { data: events, error: eventsError } = await fetchOrderEvents(client, orderIdsForEvents)
  if (eventsError) throw eventsError
  const quotedSinceMap = buildTransitionTimestampMap(events || [], 'quoted')

  const suggestions = suggestionsRes.data || []
  const suggestionsById = new Map(suggestions.map((s) => [s.id, s]))

  const activeSnoozeSignatures = new Set(
    (snoozesRes.data || []).map((s) => `${s.reason_key}|${s.order_id || ''}|${s.invoice_id || ''}`),
  )
  function isSuggestionSnoozed(suggestion) {
    return activeSnoozeSignatures.has(`${suggestion.reason_key}|${suggestion.order_id || ''}|${suggestion.invoice_id || ''}`)
  }

  const companyIds = [
    ...new Set([...ordersById.values()].map((o) => o.company_id).concat([...invoicesById.values()].map((i) => i.company_id)).concat(
      suggestions.map((s) => s.company_id),
    ).filter(Boolean)),
  ]
  const { data: companies, error: companiesError } = await fetchCompanies(client, companyIds)
  if (companiesError) throw companiesError
  const companiesById = new Map((companies || []).map((c) => [c.id, c]))

  return {
    leads: leadsRes.data || [],
    leadsById,
    orders: [...ordersById.values()].filter((o) => CANDIDATE_ORDER_STATUSES.includes(o.status)),
    ordersById,
    invoicesWithRemaining: [...invoicesById.values()].filter((i) => i.status !== 'cancelled'),
    invoicesById,
    quotedSinceMap,
    suggestions,
    suggestionsById,
    isSuggestionSnoozed,
    companiesById,
  }
}

// ---------------------------------------------------------------------------
// Applying a computed reconciliation plan (see reconciler.js). Every state
// change writes its own audit event; nothing here re-derives business
// meaning, it only executes what the plan already decided.
// ---------------------------------------------------------------------------

export async function applyReconciliationPlan(client, plan) {
  const nowIso = new Date().toISOString()

  for (const batch of chunk(plan.toCancel, 25)) {
    await Promise.all(
      batch.map(({ taskId }) =>
        client.from('automation_tasks').update({ status: 'cancelled', cancelled_at: nowIso }).eq('id', taskId),
      ),
    )
  }
  await logTaskEventsBatch(
    client,
    plan.toCancel.map(({ taskId, reason }) => ({ taskId, eventType: 'cancelled', message: reason, actorUserId: null })),
  )

  for (const batch of chunk(plan.toComplete, 25)) {
    await Promise.all(
      batch.map(({ taskId }) =>
        client.from('automation_tasks').update({ status: 'completed', completed_at: nowIso }).eq('id', taskId),
      ),
    )
  }
  await logTaskEventsBatch(
    client,
    plan.toComplete.map(({ taskId, reason }) => ({ taskId, eventType: 'completed', message: reason, actorUserId: null })),
  )

  for (const batch of chunk(plan.toUpdatePriority, 25)) {
    await Promise.all(
      batch.map(({ taskId, newPriority }) => client.from('automation_tasks').update({ priority: newPriority }).eq('id', taskId)),
    )
  }
  await logTaskEventsBatch(
    client,
    plan.toUpdatePriority.map(({ taskId, newPriority }) => ({
      taskId,
      eventType: 'reconciled',
      message: 'اولویت این کار بر اساس مدت‌زمان سپری‌شده به‌روزرسانی شد.',
      metadata: { newPriority },
      actorUserId: null,
    })),
  )

  let createdRows = []
  for (const batch of chunk(plan.toCreate, 30)) {
    // ON CONFLICT (dedupe_key) DO NOTHING - the same idiom already trusted
    // for crm_message_suggestions. .select() after it returns only the rows
    // Postgres actually inserted, which is exactly what's needed to log a
    // 'created' event solely for genuinely new tasks.
    const { data, error } = await client
      .from('automation_tasks')
      .upsert(batch, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id, dedupe_key')
    if (error) throw error
    createdRows = createdRows.concat(data || [])
  }
  await logTaskEventsBatch(
    client,
    createdRows.map((row) => ({
      taskId: row.id,
      eventType: 'created',
      message: 'این کار بر اساس وضعیت فعلی سیستم شناسایی شد.',
      actorUserId: null,
    })),
  )

  for (const batch of chunk(plan.toPromote, 25)) {
    await Promise.all(
      batch.map(({ taskId, newStatus }) => client.from('automation_tasks').update({ status: newStatus }).eq('id', taskId)),
    )
  }
  await logTaskEventsBatch(
    client,
    plan.toPromote.map(({ taskId, newStatus }) => ({
      taskId,
      eventType: 'became_ready',
      metadata: { resultingStatus: newStatus },
      actorUserId: null,
    })),
  )

  return {
    cancelled: plan.toCancel.length,
    completed: plan.toComplete.length,
    created: createdRows.length,
    promoted: plan.toPromote.length,
  }
}

// ---------------------------------------------------------------------------
// Single shared entry point for "run one reconciliation cycle": fetch
// settings/rules/tasks -> snapshot business data -> compute the plan ->
// apply it. This is the ONLY place that sequences those steps - the manual
// admin button (useAutomationTasks hook) and the scheduled Edge Function
// both call this directly, so there is exactly one reconciliation code
// path, never a browser copy and a server copy.
// ---------------------------------------------------------------------------

export async function runReconciliationCycle(client, { now = new Date() } = {}) {
  const settings = await fetchAutomationSettings(client)
  const rules = await fetchAutomationRules(client)
  const rulesByType = buildRulesByType(rules)
  const existingTasks = await fetchActiveAndFailedTasks(client)
  const snapshot = await fetchAutomationSnapshot(client, existingTasks)
  const plan = computeReconciliationPlan({ settings, rulesByType, existingTasks, businessData: snapshot, now })
  const summary = await applyReconciliationPlan(client, plan)
  return { settings, rules, existingTasks, snapshot, plan, summary }
}

// ---------------------------------------------------------------------------
// Admin actions - each is a small, explicit, auditable mutation. None of
// these perform any external effect (no message send, no order/invoice/
// lead mutation) - they only change automation_tasks' own lifecycle state.
// Frontend-only (the Edge Function never calls these).
// ---------------------------------------------------------------------------

export async function approveTask(client, taskId) {
  const { error } = await client.from('automation_tasks').update({ status: 'ready' }).eq('id', taskId)
  if (error) throw error
  await logTaskEvent(client, taskId, 'approved', { message: 'توسط ادمین تأیید شد - آماده اقدام (اجرای واقعی هنوز انجام نشده است).' })
}

export async function cancelTask(client, taskId, reason) {
  const { error } = await client
    .from('automation_tasks')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
  await logTaskEvent(client, taskId, 'cancelled', { message: reason || 'توسط ادمین لغو شد.' })
}

export async function snoozeTask(client, taskId, availableAtIso) {
  const { error } = await client
    .from('automation_tasks')
    .update({ status: 'snoozed', available_at: availableAtIso })
    .eq('id', taskId)
  if (error) throw error
  await logTaskEvent(client, taskId, 'snoozed', { metadata: { availableAt: availableAtIso } })
}

// Only ever moves a failed task back to `pending` for reconciliation to
// pick up again - never increments attempt_count itself (that belongs to
// an actual execution attempt, which Phase 17 has none of) and refuses once
// max_attempts is already reached, per "never allow infinite retries".
export async function retryTask(client, taskId) {
  const { data: task, error: fetchError } = await client
    .from('automation_tasks')
    .select('attempt_count, max_attempts')
    .eq('id', taskId)
    .single()
  if (fetchError) throw fetchError
  if (task.attempt_count >= task.max_attempts) {
    throw new Error('حداکثر تعداد تلاش برای این کار به پایان رسیده است.')
  }
  const { error } = await client
    .from('automation_tasks')
    .update({ status: 'pending', available_at: new Date().toISOString(), next_attempt_at: null })
    .eq('id', taskId)
  if (error) throw error
  await logTaskEvent(client, taskId, 'retried')
}

export async function setAutomationEnabled(client, enabled) {
  const updatedBy = await currentUserId(client)
  const { error } = await client.from('automation_settings').update({ enabled, updated_by: updatedBy }).eq('id', 1)
  if (error) throw error
}

export async function setRuleEnabled(client, taskType, enabled) {
  const { error } = await client.from('automation_rules').update({ enabled }).eq('rule_key', taskType)
  if (error) throw error
}

export async function setRuleAutonomyMode(client, taskType, autonomyMode) {
  const { error } = await client.from('automation_rules').update({ autonomy_mode: autonomyMode }).eq('rule_key', taskType)
  if (error) throw error
}

export { isNonTerminalStatus }
