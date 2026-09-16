import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات داشبورد. لطفاً دوباره تلاش کنید.'
}

function countOf(table, filters = {}) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value)
  }
  return query
}

export function useAdminDashboardData() {
  const [data, setData] = useState({
    pendingRequests: 0,
    companies: 0,
    orders: 0,
    products: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false

    Promise.all([
      countOf('registration_requests', { status: 'pending' }),
      countOf('companies'),
      countOf('orders'),
      countOf('products'),
    ]).then(([pendingRes, companiesRes, ordersRes, productsRes]) => {
      if (ignore) return
      const firstError =
        pendingRes.error || companiesRes.error || ordersRes.error || productsRes.error
      if (firstError) {
        setError(translateDbError(firstError.message))
        setLoading(false)
        return
      }
      setError('')
      setData({
        pendingRequests: pendingRes.count || 0,
        companies: companiesRes.count || 0,
        orders: ordersRes.count || 0,
        products: productsRes.count || 0,
      })
      setLoading(false)
    })

    return () => {
      ignore = true
    }
  }, [])

  return { ...data, loading, error }
}
