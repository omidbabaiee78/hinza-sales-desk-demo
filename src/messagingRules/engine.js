import {
  MAX_STAGE,
  STALE_AFTER_HOURS,
  GLOBAL_COOLDOWN_HOURS,
  BYPASSES_GLOBAL_COOLDOWN,
  evaluateQuotedWaitingCustomer,
  evaluateReadyForDelivery,
  evaluateOrderConfirmed,
  evaluateDeliveredFollowup,
  evaluateInvoiceDueSoon,
  evaluateInvoiceOverdue,
  shouldInvalidate,
} from './ruleDefinitions'
import { composeMessage, buildOrderMessageContext, buildInvoiceMessageContext } from './messageComposer'
import { summarizeOrderProducts } from '../utils/productIntelligence'
import { snoozeSignature } from '../utils/crmRules'
import { recommendedContactTime } from './tehranTime'

function buildDedupeKey(reasonKey, entityId, stage) {
  return `${reasonKey}:${entityId}:${stage}`
}

function hoursBetween(aIso, bDate) {
  return (bDate.getTime() - new Date(aIso).getTime()) / (1000 * 60 * 60)
}

// ---- reconcile: expire stale/invalid pending suggestions -------------------

export function reconcileExpirations({ existingSuggestions, ordersById, invoicesById, now }) {
  const toExpireIds = []
  for (const suggestion of existingSuggestions) {
    if (suggestion.status !== 'pending') continue

    if (suggestion.expires_at && new Date(suggestion.expires_at) <= now) {
      toExpireIds.push(suggestion.id)
      continue
    }

    const order = suggestion.order_id ? ordersById.get(suggestion.order_id) : null
    const invoice = suggestion.invoice_id ? invoicesById.get(suggestion.invoice_id) : null
    if (shouldInvalidate(suggestion, { order, invoice })) {
      toExpireIds.push(suggestion.id)
      continue
    }

    const staleAfter = STALE_AFTER_HOURS[suggestion.reason_key]
    if (staleAfter && hoursBetween(suggestion.recommended_at, now) > staleAfter) {
      toExpireIds.push(suggestion.id)
    }
  }
  return toExpireIds
}

// ---- helpers shared by candidate generation --------------------------------

function priorSuggestionsFor(existingSuggestions, reasonKey, entityId, entityField) {
  return existingSuggestions.filter((s) => s.reason_key === reasonKey && s[entityField] === entityId)
}

function priorStagesSet(priorSuggestions) {
  return new Set(priorSuggestions.map((s) => s.reminder_stage))
}

function hasDedupeRow(existingSuggestions, dedupeKey) {
  return existingSuggestions.some((s) => s.dedupe_key === dedupeKey)
}

// ---- candidate generation ---------------------------------------------------

function generateOrderCandidates({ order, ctx }) {
  const results = []
  const communications = ctx.communicationsByCompany.get(order.company_id) || []
  const contact = ctx.contactsByCompany.get(order.company_id) || {}

  function hasMeaningfulContactSince(sinceIso) {
    return communications.some((c) => c.order_id === order.id && c.created_at > sinceIso)
  }

  const evaluators = [
    {
      reasonKey: 'quoted_waiting_customer',
      run: () => {
        const prior = priorSuggestionsFor(ctx.existingSuggestions, 'quoted_waiting_customer', order.id, 'order_id')
        const stage1 = prior.find((s) => s.reminder_stage === 1)
        return evaluateQuotedWaitingCustomer({
          order,
          quotedSinceMap: ctx.quotedSinceMap,
          now: ctx.now,
          priorStages: priorStagesSet(prior),
          stage1RecommendedAt: stage1?.recommended_at || null,
          hasMeaningfulContactSince,
        })
      },
    },
    {
      reasonKey: 'ready_for_delivery',
      run: () =>
        evaluateReadyForDelivery({
          order,
          readySinceMap: ctx.readySinceMap,
          now: ctx.now,
          hasPhone: Boolean(contact.phone),
        }),
    },
    {
      reasonKey: 'order_confirmed',
      run: () =>
        evaluateOrderConfirmed({
          order,
          approvedSinceMap: ctx.approvedSinceMap,
          now: ctx.now,
          hasMeaningfulContactSince,
        }),
    },
    {
      reasonKey: 'delivered_followup',
      run: () => evaluateDeliveredFollowup({ order, deliveredSinceMap: ctx.deliveredSinceMap, now: ctx.now }),
    },
  ]

  for (const { reasonKey, run } of evaluators) {
    const prior = priorSuggestionsFor(ctx.existingSuggestions, reasonKey, order.id, 'order_id')
    if (prior.length >= MAX_STAGE[reasonKey]) continue
    const outcome = run()
    if (!outcome) continue

    const dedupeKey = buildDedupeKey(reasonKey, order.id, outcome.stage)
    if (hasDedupeRow(ctx.existingSuggestions, dedupeKey)) continue

    if (ctx.activeSnoozeSignatures.has(snoozeSignature(reasonKey, order.id, null))) continue

    if (!contact.phone) {
      outcome.confidence = 'manual_review'
    }

    const productSummary = summarizeOrderProducts(ctx.orderItemsByOrderId.get(order.id) || [])
    const messageContext = buildOrderMessageContext({
      contactName: contact.name,
      orderNumber: order.order_number ?? order.id,
      productSummary,
      stage: outcome.stage,
    })
    const messageDraft = composeMessage(reasonKey, messageContext)

    results.push({
      companyId: order.company_id,
      reasonKey,
      orderId: order.id,
      invoiceId: null,
      dedupeKey,
      reminderStage: outcome.stage,
      priority: outcome.priority,
      confidence: outcome.confidence,
      messageDraft,
      explanation: outcome.explanation,
      context: { ...messageContext, reliableTiming: outcome.reliableTiming },
      staleAfterHours: STALE_AFTER_HOURS[reasonKey],
    })
  }

  return results
}

function generateInvoiceCandidates({ invoice, remainingRial, ctx }) {
  const results = []
  const contact = ctx.contactsByCompany.get(invoice.company_id) || {}

  const evaluators = [
    {
      reasonKey: 'invoice_due_soon',
      run: () => evaluateInvoiceDueSoon({ invoice, remainingRial, now: ctx.now }),
    },
    {
      reasonKey: 'invoice_overdue',
      run: () => {
        const prior = priorSuggestionsFor(ctx.existingSuggestions, 'invoice_overdue', invoice.id, 'invoice_id')
        return evaluateInvoiceOverdue({ invoice, remainingRial, now: ctx.now, priorStages: priorStagesSet(prior) })
      },
    },
  ]

  for (const { reasonKey, run } of evaluators) {
    const prior = priorSuggestionsFor(ctx.existingSuggestions, reasonKey, invoice.id, 'invoice_id')
    if (prior.length >= MAX_STAGE[reasonKey]) continue
    const outcome = run()
    if (!outcome) continue

    const dedupeKey = buildDedupeKey(reasonKey, invoice.id, outcome.stage)
    if (hasDedupeRow(ctx.existingSuggestions, dedupeKey)) continue

    if (ctx.activeSnoozeSignatures.has(snoozeSignature(reasonKey, null, invoice.id))) continue

    if (!contact.phone) {
      outcome.confidence = 'manual_review'
    }

    const messageContext = buildInvoiceMessageContext({
      contactName: contact.name,
      invoiceNumber: invoice.invoice_number ?? invoice.id,
      remainingRial,
      stage: outcome.stage,
    })
    const messageDraft = composeMessage(reasonKey, messageContext)

    results.push({
      companyId: invoice.company_id,
      reasonKey,
      orderId: null,
      invoiceId: invoice.id,
      dedupeKey,
      reminderStage: outcome.stage,
      priority: outcome.priority,
      confidence: outcome.confidence,
      messageDraft,
      explanation: outcome.explanation,
      context: { ...messageContext, reliableTiming: outcome.reliableTiming },
      staleAfterHours: STALE_AFTER_HOURS[reasonKey],
    })
  }

  return results
}

// ---- global anti-spam arbitration ------------------------------------------

const ACTIONABLE_STATUSES = new Set(['pending', 'approved', 'edited'])

// True if the company already has an un-acted, un-dismissed, un-expired
// suggestion sitting in front of the admin from a PRIOR run. Anti-spam must
// hold across runs, not just within a single run's own candidates - this is
// what keeps a company down to one active card at a time.
function companyHasActionableSuggestion(companyId, existingSuggestions) {
  return existingSuggestions.some((s) => s.company_id === companyId && ACTIONABLE_STATUSES.has(s.status))
}

function recentlyContactedProactively(companyId, ctx) {
  const communications = ctx.communicationsByCompany.get(companyId) || []
  return communications.some((c) => {
    if (c.channel !== 'whatsapp' && c.channel !== 'sms' && c.channel !== 'phone') return false
    return hoursBetween(c.created_at, ctx.now) < GLOBAL_COOLDOWN_HOURS
  })
}

// Keeps at most ONE new candidate per company per run: the highest priority
// one, unless the company was already proactively contacted within the last
// 24h - in which case only a cooldown-bypass rule (ready_for_delivery) may
// still go through.
function arbitrate(candidatesByCompany, ctx) {
  const survivors = []
  for (const candidates of candidatesByCompany.values()) {
    if (candidates.length === 0) continue
    if (companyHasActionableSuggestion(candidates[0].companyId, ctx.existingSuggestions)) continue
    candidates.sort((a, b) => a.priority - b.priority)

    const withinCooldown = recentlyContactedProactively(candidates[0].companyId, ctx)
    const winner = withinCooldown
      ? candidates.find((c) => BYPASSES_GLOBAL_COOLDOWN.has(c.reasonKey))
      : candidates[0]

    if (winner) survivors.push(winner)
  }
  return survivors
}

// ---- top-level entry point --------------------------------------------------

// `sourceData` is everything the hook bulk-fetched (see useSmartSuggestions.js
// for the exact shape). Returns { toExpireIds, toInsertRows } - the hook is
// responsible for actually writing these via the suggestions service.
export function runMessagingEngine(sourceData) {
  const now = sourceData.now || new Date()
  const ctx = { ...sourceData, now }

  const toExpireIds = reconcileExpirations({
    existingSuggestions: ctx.existingSuggestions,
    ordersById: ctx.ordersById,
    invoicesById: ctx.invoicesById,
    now,
  })

  const candidatesByCompany = new Map()
  function addCandidates(companyId, list) {
    if (list.length === 0) return
    const existing = candidatesByCompany.get(companyId) || []
    candidatesByCompany.set(companyId, [...existing, ...list])
  }

  for (const order of ctx.candidateOrders) {
    addCandidates(order.company_id, generateOrderCandidates({ order, ctx }))
  }
  for (const invoice of ctx.candidateInvoices) {
    const remainingRial = ctx.remainingByInvoiceId.get(invoice.id) ?? 0
    addCandidates(invoice.company_id, generateInvoiceCandidates({ invoice, remainingRial, ctx }))
  }

  const survivors = arbitrate(candidatesByCompany, ctx)

  const recommendedAt = recommendedContactTime(now).toISOString()
  const toInsertRows = survivors.map((candidate) => ({
    company_id: candidate.companyId,
    reason_key: candidate.reasonKey,
    order_id: candidate.orderId,
    invoice_id: candidate.invoiceId,
    dedupe_key: candidate.dedupeKey,
    reminder_stage: candidate.reminderStage,
    priority: candidate.priority,
    confidence: candidate.confidence,
    message_draft: candidate.messageDraft,
    explanation: candidate.explanation,
    context: candidate.context,
    recommended_at: recommendedAt,
    expires_at: candidate.staleAfterHours
      ? new Date(now.getTime() + candidate.staleAfterHours * 60 * 60 * 1000).toISOString()
      : null,
    status: 'pending',
  }))

  return { toExpireIds, toInsertRows }
}
