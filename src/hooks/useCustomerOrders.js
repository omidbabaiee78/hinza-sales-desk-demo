import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت سفارش‌ها. لطفاً دوباره تلاش کنید.'
}

function fetchOrders(companyId) {
  return supabase
    .from('orders')
    .select('*, order_items(quantity_kg, products(name_fa))')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
}

function summarize(order) {
  const items = order.order_items || []
  const totalQuantityKg = items.reduce(
    (sum, item) => sum + (Number(item.quantity_kg) || 0),
    0,
  )
  const names = items.map((item) => item.products?.name_fa).filter(Boolean)
  const productsSummary =
    names.length <= 1 ? names[0] || '' : `${names[0]} + ${names.length - 1} محصول دیگر`
  return { ...order, totalQuantityKg, productsSummary }
}

export function useCustomerOrders(companyId) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    fetchOrders(companyId).then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setOrders(data.map(summarize))
      }
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [companyId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { orders, loading: companyId ? loading : false, error, refresh }
}
