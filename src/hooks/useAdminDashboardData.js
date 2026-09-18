import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات داشبورد. لطفاً دوباره تلاش کنید.'
}

const RECENT_ORDERS_LIMIT = 6
const RECENT_PAYMENTS_LIMIT = 5

function countPendingRequests() {
  return supabase
    .from('registration_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
}

// "Open" mirrors utils/invoice.js's isInvoiceOpen (anything not paid/cancelled).
function countOpenInvoices() {
  return supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .in('status', ['issued', 'partially_paid'])
}

function fetchRecentOrders() {
  return supabase
    .from('orders')
    .select('id, order_number, company_id, status, total_rial, created_at')
    .order('created_at', { ascending: false })
    .limit(RECENT_ORDERS_LIMIT)
}

function fetchRecentPayments() {
  return supabase
    .from('payments')
    .select('id, company_id, amount_rial, paid_at')
    .order('paid_at', { ascending: false })
    .limit(RECENT_PAYMENTS_LIMIT)
}

function fetchCompanies(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('companies').select('id, name').in('id', companyIds)
}

// Lean, dashboard-only queries (never the full orders/invoices lists their
// own pages fetch) so the dashboard stays fast without duplicating those
// pages' heavier joins.
export function useAdminDashboardData() {
  const [data, setData] = useState({
    pendingRequests: 0,
    openInvoices: 0,
    recentOrders: [],
    recentPayments: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    async function load() {
      const [pendingRes, openInvoicesRes, recentOrdersRes, recentPaymentsRes] =
        await Promise.all([
          countPendingRequests(),
          countOpenInvoices(),
          fetchRecentOrders(),
          fetchRecentPayments(),
        ])
      if (ignore) return

      const firstError =
        pendingRes.error || openInvoicesRes.error || recentOrdersRes.error || recentPaymentsRes.error
      if (firstError) {
        setError(translateDbError(firstError.message))
        setLoading(false)
        return
      }

      const companyIds = [
        ...new Set(
          [...(recentOrdersRes.data || []), ...(recentPaymentsRes.data || [])].map(
            (row) => row.company_id,
          ),
        ),
      ]
      const { data: companies } = await fetchCompanies(companyIds)
      if (ignore) return
      const companiesById = new Map((companies || []).map((c) => [c.id, c]))

      setError('')
      setData({
        pendingRequests: pendingRes.count || 0,
        openInvoices: openInvoicesRes.count || 0,
        recentOrders: (recentOrdersRes.data || []).map((order) => ({
          ...order,
          company: companiesById.get(order.company_id) || null,
        })),
        recentPayments: (recentPaymentsRes.data || []).map((payment) => ({
          ...payment,
          company: companiesById.get(payment.company_id) || null,
        })),
      })
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

  return { ...data, loading, error, refresh }
}
