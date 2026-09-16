import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const CLOSED_ORDER_STATUSES = ['delivered', 'completed', 'cancelled']
const SETTLED_INVOICE_STATUSES = ['paid', 'cancelled']

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات داشبورد. لطفاً دوباره تلاش کنید.'
}

function fetchOrders(companyId) {
  return supabase.from('orders').select('id, status').eq('company_id', companyId)
}

function fetchInvoices(companyId) {
  return supabase
    .from('invoices')
    .select('id, status')
    .eq('company_id', companyId)
}

function fetchDiscountCount(companyId) {
  return supabase
    .from('company_prices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
}

export function useCustomerDashboardData(companyId) {
  const [data, setData] = useState({
    activeOrders: 0,
    previousOrders: 0,
    unpaidInvoices: 0,
    specialDiscounts: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!companyId) return
    let ignore = false

    Promise.all([
      fetchOrders(companyId),
      fetchInvoices(companyId),
      fetchDiscountCount(companyId),
    ]).then(([ordersRes, invoicesRes, discountsRes]) => {
      if (ignore) return
      const firstError =
        ordersRes.error || invoicesRes.error || discountsRes.error
      if (firstError) {
        setError(translateDbError(firstError.message))
        setLoading(false)
        return
      }
      const orders = ordersRes.data || []
      const invoices = invoicesRes.data || []
      const activeOrders = orders.filter(
        (o) => !CLOSED_ORDER_STATUSES.includes(o.status),
      ).length
      const previousOrders = orders.length - activeOrders
      const unpaidInvoices = invoices.filter(
        (i) => !SETTLED_INVOICE_STATUSES.includes(i.status),
      ).length

      setError('')
      setData({
        activeOrders,
        previousOrders,
        unpaidInvoices,
        specialDiscounts: discountsRes.count || 0,
      })
      setLoading(false)
    })

    return () => {
      ignore = true
    }
  }, [companyId])

  return { ...data, loading: companyId ? loading : false, error }
}
