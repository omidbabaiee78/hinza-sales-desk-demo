import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useSalesLeads } from './useSalesLeads'
import { useSmartSuggestions } from './useSmartSuggestions'
import { calcInvoicePaid, calcInvoiceRemaining } from '../utils/invoice'
import { snoozeSignature } from '../utils/crmRules'
import {
  TODAY_ORDER_STATUSES,
  buildInvoiceItems,
  buildLeadFirstContactItems,
  buildLeadFollowUpItems,
  buildMessagingItems,
  buildOrderItems,
  groupTodayItems,
} from '../utils/todayQueue'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت کارهای امروز. لطفاً دوباره تلاش کنید.'
}

// Lean, Today-page-only queries - narrow columns, only the order/invoice
// statuses that can actually produce an active task (never the full
// orders/invoices lists those pages' own hooks fetch).
function fetchTodayOrders() {
  return supabase
    .from('orders')
    .select('id, order_number, company_id, status, created_at')
    .in('status', TODAY_ORDER_STATUSES)
}

function fetchOpenInvoicesForToday() {
  return supabase
    .from('invoices')
    .select('id, company_id, invoice_number, status, total_rial, due_date')
    .in('status', ['issued', 'partially_paid'])
    .not('due_date', 'is', null)
}

function fetchPayments(invoiceIds) {
  if (invoiceIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('payments').select('invoice_id, amount_rial').in('invoice_id', invoiceIds)
}

function fetchCompanies(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('companies').select('id, name').in('id', companyIds)
}

// Aggregates orders + invoices needing action (this hook's own lean
// queries) with leads (useSalesLeads) and Messaging Brain suggestions
// (useSmartSuggestions, run as-is - never a second engine) into one
// prioritized, grouped queue. Nothing here decides business meaning -
// utils/todayQueue.js does that; this hook only fetches and wires data in.
export function useTodayQueue() {
  const { leads, loading: leadsLoading, error: leadsError, refresh: refreshLeads } = useSalesLeads()
  const smartSuggestions = useSmartSuggestions()

  const [orders, setOrders] = useState([])
  const [invoicesWithRemaining, setInvoicesWithRemaining] = useState([])
  const [companiesById, setCompaniesById] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    async function load() {
      const [ordersRes, invoicesRes] = await Promise.all([fetchTodayOrders(), fetchOpenInvoicesForToday()])
      if (ignore) return
      const firstError = ordersRes.error || invoicesRes.error
      if (firstError) {
        setError(translateDbError(firstError.message))
        setLoading(false)
        return
      }

      const ordersData = ordersRes.data || []
      const invoicesData = invoicesRes.data || []
      const invoiceIds = invoicesData.map((inv) => inv.id)

      const { data: payments, error: paymentsError } = await fetchPayments(invoiceIds)
      if (ignore) return
      if (paymentsError) {
        setError(translateDbError(paymentsError.message))
        setLoading(false)
        return
      }

      const paymentsByInvoiceId = new Map()
      for (const payment of payments || []) {
        const list = paymentsByInvoiceId.get(payment.invoice_id) || []
        list.push(payment)
        paymentsByInvoiceId.set(payment.invoice_id, list)
      }

      const invoicesResolved = invoicesData.map((invoice) => ({
        ...invoice,
        remainingRial: calcInvoiceRemaining(invoice.total_rial, calcInvoicePaid(paymentsByInvoiceId.get(invoice.id) || [])),
      }))

      const companyIds = [...new Set([...ordersData.map((o) => o.company_id), ...invoicesResolved.map((i) => i.company_id)])]
      const { data: companies, error: companiesError } = await fetchCompanies(companyIds)
      if (ignore) return
      if (companiesError) {
        setError(translateDbError(companiesError.message))
        setLoading(false)
        return
      }

      setError('')
      setOrders(ordersData)
      setInvoicesWithRemaining(invoicesResolved)
      setCompaniesById(new Map((companies || []).map((c) => [c.id, c])))
      setLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
  }, [reloadToken])

  const queue = useMemo(() => {
    // "now" deliberately lives inside the memo - a Date built outside would
    // be a fresh object every render and defeat the memoization entirely.
    const now = new Date()
    const items = [
      ...buildLeadFollowUpItems(leads, now),
      ...buildOrderItems(orders, companiesById, now),
      ...buildInvoiceItems(invoicesWithRemaining, companiesById, now),
      ...buildMessagingItems(
        smartSuggestions.rows,
        smartSuggestions.activeSnoozeSignatures,
        snoozeSignature,
        smartSuggestions.companiesById,
      ),
    ]
    return groupTodayItems(items)
  }, [leads, orders, invoicesWithRemaining, companiesById, smartSuggestions.rows, smartSuggestions.activeSnoozeSignatures, smartSuggestions.companiesById])

  const firstContactItems = useMemo(() => buildLeadFirstContactItems(leads), [leads])

  const isLoading = loading || leadsLoading || smartSuggestions.loading

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
    refreshLeads()
    smartSuggestions.refresh()
  }

  return {
    queue,
    firstContactItems,
    loading: isLoading,
    error: error || leadsError || smartSuggestions.error,
    refresh,
    smartSuggestions,
  }
}
