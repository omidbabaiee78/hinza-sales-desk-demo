import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calcInvoicePaid, calcInvoiceRemaining } from '../utils/invoice'
import { snoozeSignature } from '../utils/crmRules'
import { buildTransitionTimestampMap } from '../messagingRules/orderEventResolver'
import { runMessagingEngine } from '../messagingRules/engine'
import {
  fetchAllSuggestions,
  insertSuggestions,
  expireSuggestions,
  approveSuggestion,
  editSuggestion,
  dismissSuggestion,
  markSuggestionActed,
} from '../services/crmMessageSuggestions'
import { logCrmCommunication } from '../services/crmCommunications'
import { snoozeCompanyAttention } from '../services/crmSnoozes'
import { telHref, whatsappHref } from '../constants/brand'
import { toE164Iran } from '../utils/phone'

// Only orders in one of these statuses can ever be eligible for one of the
// 4 order-based rules - never fetch/scan the whole orders table.
const CANDIDATE_ORDER_STATUSES = ['quoted', 'ready_for_delivery', 'admin_approved', 'delivered']

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در پردازش پیشنهادهای هوشمند. لطفاً دوباره تلاش کنید.'
}

function fetchCompanies() {
  return supabase.from('companies').select('id, name')
}
function fetchMembers(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('company_members').select('company_id, user_id').in('company_id', companyIds)
}
function fetchProfiles(userIds) {
  if (userIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('profiles').select('id, full_name, phone').in('id', userIds)
}
function fetchCandidateOrders() {
  return supabase
    .from('orders')
    .select('id, order_number, company_id, status, created_at')
    .in('status', CANDIDATE_ORDER_STATUSES)
}
function fetchOrderItems(orderIds) {
  if (orderIds.length === 0) return Promise.resolve({ data: [] })
  return supabase
    .from('order_items')
    .select('order_id, product_id, quantity_kg, products(code, name_fa)')
    .in('order_id', orderIds)
}
function fetchOrderEvents(orderIds) {
  if (orderIds.length === 0) return Promise.resolve({ data: [] })
  return supabase
    .from('order_events')
    .select('order_id, event_type, metadata, created_at')
    .in('order_id', orderIds)
}
function fetchOpenInvoices() {
  return supabase
    .from('invoices')
    .select('id, company_id, invoice_number, status, total_rial, due_date')
    .in('status', ['issued', 'partially_paid'])
}
function fetchPaymentsForInvoices(invoiceIds) {
  if (invoiceIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('payments').select('invoice_id, amount_rial').in('invoice_id', invoiceIds)
}
function fetchCommunications() {
  return supabase
    .from('crm_communications')
    .select('company_id, channel, reason, order_id, invoice_id, action_status, created_at')
    .order('created_at', { ascending: false })
}
function fetchActiveSnoozes() {
  const nowIso = new Date().toISOString()
  return supabase
    .from('crm_snoozes')
    .select('company_id, reason_key, order_id, invoice_id, snooze_until')
    .gt('snooze_until', nowIso)
}

function throwIfAnyError(results) {
  const failed = results.find((r) => r.error)
  if (failed) throw failed.error
}

// Shadow Mode: bulk-fetches everything the engine needs, runs
// reconcile+generate+arbitrate, persists the diff (expire/insert), then
// reloads the suggestion rows themselves. Nothing here decides eligibility
// - that all lives in src/messagingRules/ - this hook only wires data in
// and actions back out.
export function useSmartSuggestions() {
  const [rows, setRows] = useState([])
  const [companiesById, setCompaniesById] = useState(new Map())
  const [contactsByCompany, setContactsByCompany] = useState(new Map())
  const [activeSnoozeSignatures, setActiveSnoozeSignatures] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const runEngineAndLoad = useCallback(async () => {
    setError('')
    try {
      const { data: companies, error: companiesError } = await fetchCompanies()
      if (companiesError) throw companiesError
      const companyIds = (companies || []).map((c) => c.id)

      const [membersRes, candidateOrdersRes, openInvoicesRes, communicationsRes, snoozesRes, existingRes] =
        await Promise.all([
          fetchMembers(companyIds),
          fetchCandidateOrders(),
          fetchOpenInvoices(),
          fetchCommunications(),
          fetchActiveSnoozes(),
          fetchAllSuggestions(),
        ])
      throwIfAnyError([membersRes, candidateOrdersRes, openInvoicesRes, communicationsRes, snoozesRes, existingRes])

      const userIds = [...new Set((membersRes.data || []).map((m) => m.user_id))]
      const { data: profiles, error: profilesError } = await fetchProfiles(userIds)
      if (profilesError) throw profilesError

      const candidateOrders = candidateOrdersRes.data || []
      const orderIds = candidateOrders.map((o) => o.id)
      const openInvoices = openInvoicesRes.data || []
      const invoiceIds = openInvoices.map((inv) => inv.id)

      const [itemsRes, eventsRes, paymentsRes] = await Promise.all([
        fetchOrderItems(orderIds),
        fetchOrderEvents(orderIds),
        fetchPaymentsForInvoices(invoiceIds),
      ])
      throwIfAnyError([itemsRes, eventsRes, paymentsRes])

      // ---- lookup maps ----
      const profilesById = new Map((profiles || []).map((p) => [p.id, p]))
      const contactsByCompanyMap = new Map()
      for (const member of membersRes.data || []) {
        if (!contactsByCompanyMap.has(member.company_id)) {
          const profile = profilesById.get(member.user_id)
          contactsByCompanyMap.set(member.company_id, {
            name: profile?.full_name || null,
            phone: profile?.phone || null,
          })
        }
      }

      const orderItemsByOrderId = new Map()
      for (const item of itemsRes.data || []) {
        const list = orderItemsByOrderId.get(item.order_id) || []
        list.push(item)
        orderItemsByOrderId.set(item.order_id, list)
      }

      const events = eventsRes.data || []
      const quotedSinceMap = buildTransitionTimestampMap(events, 'quoted')
      const readySinceMap = buildTransitionTimestampMap(events, 'ready_for_delivery')
      const approvedSinceMap = buildTransitionTimestampMap(events, 'admin_approved')
      const deliveredSinceMap = buildTransitionTimestampMap(events, 'delivered')

      const paymentsByInvoiceId = new Map()
      for (const payment of paymentsRes.data || []) {
        const list = paymentsByInvoiceId.get(payment.invoice_id) || []
        list.push(payment)
        paymentsByInvoiceId.set(payment.invoice_id, list)
      }
      const remainingByInvoiceId = new Map(
        openInvoices.map((inv) => [
          inv.id,
          calcInvoiceRemaining(inv.total_rial, calcInvoicePaid(paymentsByInvoiceId.get(inv.id) || [])),
        ]),
      )

      const communicationsByCompany = new Map()
      for (const comm of communicationsRes.data || []) {
        const list = communicationsByCompany.get(comm.company_id) || []
        list.push(comm)
        communicationsByCompany.set(comm.company_id, list)
      }

      const activeSnoozeSignatures = new Set(
        (snoozesRes.data || []).map((s) => snoozeSignature(s.reason_key, s.order_id, s.invoice_id)),
      )

      const engineResult = runMessagingEngine({
        now: new Date(),
        candidateOrders,
        candidateInvoices: openInvoices,
        ordersById: new Map(candidateOrders.map((o) => [o.id, o])),
        invoicesById: new Map(openInvoices.map((inv) => [inv.id, inv])),
        orderItemsByOrderId,
        quotedSinceMap,
        readySinceMap,
        approvedSinceMap,
        deliveredSinceMap,
        remainingByInvoiceId,
        contactsByCompany: contactsByCompanyMap,
        communicationsByCompany,
        activeSnoozeSignatures,
        existingSuggestions: existingRes.data || [],
      })

      if (engineResult.toExpireIds.length > 0) await expireSuggestions(engineResult.toExpireIds)
      if (engineResult.toInsertRows.length > 0) await insertSuggestions(engineResult.toInsertRows)

      const { data: finalSuggestions, error: finalError } =
        engineResult.toExpireIds.length > 0 || engineResult.toInsertRows.length > 0
          ? await fetchAllSuggestions()
          : existingRes
      if (finalError) throw finalError

      setCompaniesById(new Map((companies || []).map((c) => [c.id, c])))
      setContactsByCompany(contactsByCompanyMap)
      setActiveSnoozeSignatures(activeSnoozeSignatures)
      setRows(finalSuggestions || [])
    } catch (err) {
      setError(translateDbError(err.message))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    // Deferred to a microtask so the state updates inside runEngineAndLoad
    // happen in a callback, not synchronously in the effect body itself.
    Promise.resolve().then(() => runEngineAndLoad())
  }, [runEngineAndLoad])

  function refresh() {
    setRefreshing(true)
    runEngineAndLoad()
  }

  function updateLocalRow(id, patch) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  async function approve(suggestion) {
    setActionError('')
    try {
      await approveSuggestion(suggestion.id)
      updateLocalRow(suggestion.id, { status: 'approved', feedback: 'good' })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function edit(suggestion, finalText) {
    setActionError('')
    try {
      await editSuggestion(suggestion.id, finalText)
      updateLocalRow(suggestion.id, { status: 'edited', message_final: finalText, feedback: 'edited' })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function dismiss(suggestion) {
    setActionError('')
    try {
      await dismissSuggestion(suggestion.id)
      updateLocalRow(suggestion.id, { status: 'dismissed', feedback: 'not_needed' })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function snooze(suggestion, days) {
    setActionError('')
    try {
      await snoozeCompanyAttention({
        companyId: suggestion.company_id,
        reasonKey: suggestion.reason_key,
        orderId: suggestion.order_id,
        invoiceId: suggestion.invoice_id,
        days,
      })
      refresh()
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function whatsapp(suggestion, finalText) {
    setActionError('')
    const contact = contactsByCompany.get(suggestion.company_id)
    const intlPhone = contact?.phone ? toE164Iran(contact.phone).replace('+', '') : ''
    if (!intlPhone) {
      setActionError('برای این مشتری شماره تماس ثبت نشده است.')
      return
    }
    window.open(`${whatsappHref(intlPhone)}?text=${encodeURIComponent(finalText)}`, '_blank', 'noopener')
    try {
      await logCrmCommunication({
        companyId: suggestion.company_id,
        channel: 'whatsapp',
        reason: suggestion.reason_key,
        messageSnapshot: finalText,
        actionStatus: 'opened',
        orderId: suggestion.order_id,
        invoiceId: suggestion.invoice_id,
      })
      await markSuggestionActed(suggestion.id, { finalText, feedback: suggestion.feedback })
      updateLocalRow(suggestion.id, { status: 'acted', message_final: finalText })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function call(suggestion) {
    setActionError('')
    const contact = contactsByCompany.get(suggestion.company_id)
    if (!contact?.phone) {
      setActionError('برای این مشتری شماره تماس ثبت نشده است.')
      return
    }
    window.location.href = telHref(contact.phone)
    const finalText = suggestion.message_final || suggestion.message_draft
    try {
      await logCrmCommunication({
        companyId: suggestion.company_id,
        channel: 'phone',
        reason: suggestion.reason_key,
        actionStatus: 'manual_action',
        orderId: suggestion.order_id,
        invoiceId: suggestion.invoice_id,
      })
      await markSuggestionActed(suggestion.id, { finalText, feedback: suggestion.feedback })
      updateLocalRow(suggestion.id, { status: 'acted' })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  return {
    rows,
    companiesById,
    contactsByCompany,
    activeSnoozeSignatures,
    loading,
    refreshing,
    error,
    actionError,
    refresh,
    approve,
    edit,
    dismiss,
    snooze,
    whatsapp,
    call,
  }
}
