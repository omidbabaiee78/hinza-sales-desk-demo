import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات گزارش. لطفاً دوباره تلاش کنید.'
}

function fetchCompanies() {
  return supabase.from('companies').select('id, name')
}

function fetchOrders() {
  return supabase.from('orders').select('id, order_number, company_id, status, created_at')
}

function fetchInvoices() {
  return supabase
    .from('invoices')
    .select('id, company_id, invoice_number, status, total_rial, issued_at, due_date, created_at')
}

function fetchPayments() {
  return supabase.from('payments').select('id, company_id, invoice_id, amount_rial, paid_at')
}

function fetchInvoiceItems() {
  return supabase
    .from('invoice_items')
    .select('id, invoice_id, product_code, quantity, unit_price_rial, discount_percent, line_total_rial')
}

function fetchProductNames() {
  return supabase.from('products').select('code, name_fa')
}

// One bulk fetch per table (never per-row/per-period), matching the same
// "fetch the reasonably-small full table, filter/aggregate in memory"
// pattern already used by useAdminOrders/useAdminCustomers/useCrmCustomers
// elsewhere in this app. This also means changing the period or a filter on
// the Reports page recomputes instantly with no re-query.
export function useAdminReportsData() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    Promise.all([
      fetchCompanies(),
      fetchOrders(),
      fetchInvoices(),
      fetchPayments(),
      fetchInvoiceItems(),
      fetchProductNames(),
    ]).then(([companiesRes, ordersRes, invoicesRes, paymentsRes, invoiceItemsRes, productsRes]) => {
      if (ignore) return
      const firstError =
        companiesRes.error ||
        ordersRes.error ||
        invoicesRes.error ||
        paymentsRes.error ||
        invoiceItemsRes.error ||
        productsRes.error
      if (firstError) {
        setError(translateDbError(firstError.message))
        setLoading(false)
        return
      }

      setError('')
      setData({
        companies: companiesRes.data || [],
        orders: ordersRes.data || [],
        invoices: invoicesRes.data || [],
        payments: paymentsRes.data || [],
        invoiceItems: invoiceItemsRes.data || [],
        products: productsRes.data || [],
      })
      setLoading(false)
    })

    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { data, loading, error, refresh }
}
