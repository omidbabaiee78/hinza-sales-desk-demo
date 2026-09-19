import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calcInvoicePaid, calcInvoiceRemaining, isInvoiceOpen } from '../utils/invoice'
import { OVERDUE_INVOICE_STATUSES } from './useAttentionItems'
import { buildProductIntelligence } from '../utils/productIntelligence'
import {
  computeCustomerAttention,
  daysBetween,
  deriveNextAction,
  deriveSegments,
  reasonContext,
  snoozeSignature,
} from '../utils/crmRules'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات CRM. لطفاً دوباره تلاش کنید.'
}

function fetchCompanies() {
  return supabase.from('companies').select('id, name, city, province, created_at')
}

function fetchMembers(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('company_members').select('company_id, user_id').in('company_id', companyIds)
}

function fetchProfiles(userIds) {
  if (userIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('profiles').select('id, full_name, phone, created_at').in('id', userIds)
}

// All orders, lean columns only - this is the one full-table order scan the
// list needs; everything else (items, events, invoices) is fetched only for
// the bounded subsets that actually require it (delivered orders, quoted
// orders, overdue invoices), never per customer.
function fetchOrders() {
  return supabase.from('orders').select('id, order_number, company_id, status, created_at')
}

function fetchDeliveredOrderItems(deliveredOrderIds) {
  if (deliveredOrderIds.length === 0) return Promise.resolve({ data: [] })
  return supabase
    .from('order_items')
    .select('order_id, product_id, quantity_kg, unit_price_rial, discount_percent, products(code, name_fa)')
    .in('order_id', deliveredOrderIds)
}

// Same "currently quoted, waiting on the customer" definition as Phase 7,
// but we also need *when* it became quoted to detect the 2-day escalation.
function fetchQuotedSince(quotedOrderIds) {
  if (quotedOrderIds.length === 0) return Promise.resolve({ data: [] })
  return supabase
    .from('order_events')
    .select('order_id, created_at')
    .eq('event_type', 'quoted')
    .in('order_id', quotedOrderIds)
}

function fetchInvoices() {
  return supabase
    .from('invoices')
    .select('id, company_id, invoice_number, status, due_date, total_rial')
    .neq('status', 'cancelled')
}

function fetchOverdueInvoices(todayIso) {
  return supabase
    .from('invoices')
    .select('id, company_id, invoice_number, status, due_date, total_rial')
    .in('status', OVERDUE_INVOICE_STATUSES)
    .not('due_date', 'is', null)
    .lt('due_date', todayIso)
}

function fetchPaymentsForInvoices(invoiceIds) {
  if (invoiceIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('payments').select('invoice_id, amount_rial').in('invoice_id', invoiceIds)
}

function fetchBalances(companyIds) {
  return Promise.all(
    companyIds.map((id) =>
      supabase
        .rpc('company_balance_rial', { p_company_id: id })
        .then(({ data, error }) => ({ id, balance: error ? null : Number(data) || 0 })),
    ),
  )
}

// Best-effort: both tables may not exist yet until the CRM migration has
// been applied. A missing table degrades the relevant column/feature instead
// of breaking the whole CRM list.
function fetchLastContacts(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [], missing: false })
  return supabase
    .from('crm_communications')
    .select('company_id, channel, reason, created_at')
    .in('company_id', companyIds)
    .order('created_at', { ascending: false })
    .then(({ data, error }) => ({ data: data || [], missing: Boolean(error) }))
}

function fetchActiveSnoozes(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [], missing: false })
  const nowIso = new Date().toISOString()
  return supabase
    .from('crm_snoozes')
    .select('company_id, reason_key, order_id, invoice_id, snooze_until')
    .in('company_id', companyIds)
    .gt('snooze_until', nowIso)
    .then(({ data, error }) => ({ data: data || [], missing: Boolean(error) }))
}

function latestByDate(list, dateField) {
  return list.reduce((latest, row) => {
    if (!latest || row[dateField] > latest[dateField]) return row
    return latest
  }, null)
}

export function useCrmCustomers() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [crmSchemaReady, setCrmSchemaReady] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    async function load() {
      const { data: companies, error: companiesError } = await fetchCompanies()
      if (ignore) return
      if (companiesError) {
        setError(translateDbError(companiesError.message))
        setLoading(false)
        return
      }
      const companyIds = (companies || []).map((c) => c.id)
      const todayIso = new Date().toISOString().slice(0, 10)

      const [membersRes, ordersRes, invoicesRes, overdueInvoicesRes, balances, lastContactsRes, snoozesRes] =
        await Promise.all([
          fetchMembers(companyIds),
          fetchOrders(),
          fetchInvoices(),
          fetchOverdueInvoices(todayIso),
          fetchBalances(companyIds),
          fetchLastContacts(companyIds),
          fetchActiveSnoozes(companyIds),
        ])
      if (ignore) return

      const userIds = [...new Set((membersRes.data || []).map((m) => m.user_id))]
      const { data: profiles } = await fetchProfiles(userIds)
      if (ignore) return

      const orders = ordersRes.data || []
      const deliveredOrders = orders.filter((o) => o.status === 'delivered')
      const deliveredOrderIds = deliveredOrders.map((o) => o.id)
      const quotedOrderIds = orders.filter((o) => o.status === 'quoted').map((o) => o.id)

      const [itemsRes, quotedSinceRes, overduePaymentsRes] = await Promise.all([
        fetchDeliveredOrderItems(deliveredOrderIds),
        fetchQuotedSince(quotedOrderIds),
        fetchPaymentsForInvoices((overdueInvoicesRes.data || []).map((inv) => inv.id)),
      ])
      if (ignore) return

      // ---- lookup maps ----
      const profilesById = new Map((profiles || []).map((p) => [p.id, p]))
      const representativeByCompany = new Map()
      for (const member of membersRes.data || []) {
        if (!representativeByCompany.has(member.company_id)) {
          representativeByCompany.set(member.company_id, profilesById.get(member.user_id) || null)
        }
      }

      const ordersByCompany = new Map()
      for (const order of orders) {
        const list = ordersByCompany.get(order.company_id) || []
        list.push(order)
        ordersByCompany.set(order.company_id, list)
      }

      const deliveredOrderById = new Map(deliveredOrders.map((o) => [o.id, o]))
      const itemsByCompany = new Map()
      for (const item of itemsRes.data || []) {
        const order = deliveredOrderById.get(item.order_id)
        if (!order) continue
        const list = itemsByCompany.get(order.company_id) || []
        list.push({ ...item, order_created_at: order.created_at })
        itemsByCompany.set(order.company_id, list)
      }

      const quotedSinceByOrderId = new Map()
      for (const event of quotedSinceRes.data || []) {
        const prev = quotedSinceByOrderId.get(event.order_id)
        if (!prev || event.created_at > prev) quotedSinceByOrderId.set(event.order_id, event.created_at)
      }

      const invoicesByCompany = new Map()
      for (const invoice of invoicesRes.data || []) {
        const list = invoicesByCompany.get(invoice.company_id) || []
        list.push(invoice)
        invoicesByCompany.set(invoice.company_id, list)
      }

      const paymentsByInvoice = new Map()
      for (const payment of overduePaymentsRes.data || []) {
        const list = paymentsByInvoice.get(payment.invoice_id) || []
        list.push(payment)
        paymentsByInvoice.set(payment.invoice_id, list)
      }

      // Headline overdue invoice per company = the oldest overdue due_date.
      const overdueByCompany = new Map()
      for (const invoice of overdueInvoicesRes.data || []) {
        const remainingRial = calcInvoiceRemaining(
          invoice.total_rial,
          calcInvoicePaid(paymentsByInvoice.get(invoice.id) || []),
        )
        const prev = overdueByCompany.get(invoice.company_id)
        if (!prev || invoice.due_date < prev.due_date) {
          overdueByCompany.set(invoice.company_id, { ...invoice, remainingRial })
        }
      }

      const balanceByCompany = new Map(balances.map((b) => [b.id, b.balance]))

      const lastContactByCompany = new Map()
      for (const contact of lastContactsRes.data) {
        if (!lastContactByCompany.has(contact.company_id)) {
          lastContactByCompany.set(contact.company_id, contact)
        }
      }

      const snoozedSignaturesByCompany = new Map()
      for (const snooze of snoozesRes.data) {
        const set = snoozedSignaturesByCompany.get(snooze.company_id) || new Set()
        set.add(snoozeSignature(snooze.reason_key, snooze.order_id, snooze.invoice_id))
        snoozedSignaturesByCompany.set(snooze.company_id, set)
      }

      const now = new Date()
      const result = (companies || []).map((company) => {
        const companyOrders = ordersByCompany.get(company.id) || []
        const hasEverOrdered = companyOrders.length > 0

        const companyDeliveredOrders = companyOrders.filter((o) => o.status === 'delivered')
        const lastDeliveredOrder = latestByDate(companyDeliveredOrders, 'created_at')
        const lastPurchaseAt = lastDeliveredOrder?.created_at || null
        const daysSincePurchase = daysBetween(lastPurchaseAt, now)

        const productItems = itemsByCompany.get(company.id) || []
        const products = buildProductIntelligence(productItems)
        const totalKg = productItems.reduce((sum, item) => sum + (Number(item.quantity_kg) || 0), 0)

        const lastOrder = latestByDate(companyOrders, 'created_at')
        const quotedOrder = latestByDate(
          companyOrders.filter((o) => o.status === 'quoted'),
          'created_at',
        )
        const approvedOrder = latestByDate(
          companyOrders.filter((o) => o.status === 'customer_approved'),
          'created_at',
        )
        const quotedSinceDays = quotedOrder
          ? daysBetween(quotedSinceByOrderId.get(quotedOrder.id) || quotedOrder.created_at, now)
          : null

        const representative = representativeByCompany.get(company.id) || null
        const overdueInvoice = overdueByCompany.get(company.id) || null

        const allReasons = computeCustomerAttention({
          overdueInvoice,
          approvedOrder,
          quotedOrder,
          quotedSinceDays,
          daysSincePurchase,
          hasEverOrdered,
          representativeCreatedAt: representative?.created_at || null,
          lastDeliveredOrder,
        })

        const snoozedSignatures = snoozedSignaturesByCompany.get(company.id) || new Set()
        const activeReasons = allReasons.filter((reason) => {
          const { orderId, invoiceId } = reasonContext(reason)
          return !snoozedSignatures.has(snoozeSignature(reason.key, orderId, invoiceId))
        })
        const balance = balanceByCompany.has(company.id) ? balanceByCompany.get(company.id) : null

        return {
          id: company.id,
          name: company.name,
          city: company.city,
          province: company.province,
          representative,
          balance,
          lastPurchaseAt,
          daysSincePurchase,
          totalKg,
          orderCount: companyOrders.length,
          openInvoicesCount: (invoicesByCompany.get(company.id) || []).filter((invoice) =>
            isInvoiceOpen(invoice.status),
          ).length,
          lastOrderStatus: lastOrder?.status || null,
          // Full purchase-history product list (search/filter need every
          // product ever bought); the list view only ever displays the
          // first couple of entries as "محصولات اصلی".
          products,
          allReasons: activeReasons,
          topReason: activeReasons[0] || null,
          nextAction: deriveNextAction(activeReasons),
          lastContact: lastContactByCompany.get(company.id) || null,
          hasEverOrdered,
          segments: deriveSegments({
            hasEverOrdered,
            daysSincePurchase,
            balance,
            representativeCreatedAt: representative?.created_at || null,
          }),
        }
      })

      setError('')
      setCrmSchemaReady(!lastContactsRes.missing && !snoozesRes.missing)
      setRows(result)
      setLoading(false)
    }

    load()

    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { rows, loading, error, crmSchemaReady, refresh }
}
