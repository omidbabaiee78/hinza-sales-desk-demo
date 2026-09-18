import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت موارد نیازمند توجه. لطفاً دوباره تلاش کنید.'
}

const ACTIONABLE_ORDER_STATUSES = ['pending_review', 'quoted', 'customer_approved']
const OVERDUE_INVOICE_STATUSES = ['issued', 'partially_paid']

// Which group/reason an actionable order status maps to. quoted orders are
// waiting on the customer, not the admin, so they get their own group.
const ORDER_REASONS = {
  pending_review: { group: 'action', reason: 'نیاز به اعلام قیمت' },
  quoted: { group: 'waiting', reason: 'منتظر تأیید مشتری' },
  customer_approved: { group: 'action', reason: 'نیاز به تأیید سفارش' },
}

function fetchActionableOrders() {
  return supabase
    .from('orders')
    .select('id, order_number, company_id, status, created_at')
    .in('status', ACTIONABLE_ORDER_STATUSES)
}

// "Overdue" mirrors the same definition used elsewhere in the app: an
// invoice that still needs money collected (issued/partially_paid) whose
// due_date has already passed. Invoices with no due_date are left out since
// there is nothing to be overdue against.
function fetchOverdueInvoices(todayIso) {
  return supabase
    .from('invoices')
    .select('id, invoice_number, company_id, status, due_date')
    .in('status', OVERDUE_INVOICE_STATUSES)
    .not('due_date', 'is', null)
    .lt('due_date', todayIso)
}

function fetchCompanies() {
  return supabase.from('companies').select('id, name')
}

function ordersToItems(orders, companiesById) {
  return orders.map((order) => {
    const { group, reason } = ORDER_REASONS[order.status]
    return {
      id: `order-${order.id}`,
      group,
      reason,
      company: companiesById.get(order.company_id) || null,
      companyId: order.company_id,
      refLabel: order.order_number ?? order.id,
      date: order.created_at,
      action: { type: 'order', id: order.id },
    }
  })
}

function invoicesToItems(invoices, companiesById) {
  return invoices.map((invoice) => ({
    id: `invoice-${invoice.id}`,
    group: 'financial',
    reason: 'پیگیری پرداخت',
    company: companiesById.get(invoice.company_id) || null,
    companyId: invoice.company_id,
    refLabel: invoice.invoice_number ?? invoice.id,
    date: invoice.due_date,
    action: { type: 'invoice', id: invoice.id },
  }))
}

// Fully automatic "what needs my attention right now" list, derived only
// from existing order/invoice statuses and dates - nothing here is ever
// manually created. Backs both the admin Follow-ups page and the dashboard
// summary from the same two lean queries (never the full orders/invoices
// lists those pages' own hooks fetch).
export function useAttentionItems() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false
    const todayIso = new Date().toISOString().slice(0, 10)

    Promise.all([fetchActionableOrders(), fetchOverdueInvoices(todayIso), fetchCompanies()]).then(
      ([ordersRes, invoicesRes, companiesRes]) => {
        if (ignore) return
        const firstError = ordersRes.error || invoicesRes.error || companiesRes.error
        if (firstError) {
          setError(translateDbError(firstError.message))
          setLoading(false)
          return
        }
        const companiesById = new Map((companiesRes.data || []).map((c) => [c.id, c]))
        const combined = [
          ...ordersToItems(ordersRes.data || [], companiesById),
          ...invoicesToItems(invoicesRes.data || [], companiesById),
        ].sort((a, b) => new Date(a.date) - new Date(b.date))
        setError('')
        setItems(combined)
        setLoading(false)
      },
    )

    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { items, loading, error, refresh }
}
