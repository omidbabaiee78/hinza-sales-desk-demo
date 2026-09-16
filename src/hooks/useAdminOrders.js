import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت سفارش‌ها. لطفاً دوباره تلاش کنید.'
}

function fetchOrders() {
  return supabase
    .from('orders')
    .select('*, order_items(quantity_kg, products(name_fa))')
    .order('created_at', { ascending: false })
}

function fetchCompanies() {
  return supabase.from('companies').select('id, name')
}

function fetchCreators(userIds) {
  if (userIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('profiles').select('id, full_name, phone').in('id', userIds)
}

function summarize(order, companiesById, creatorsById) {
  const items = order.order_items || []
  const totalQuantityKg = items.reduce(
    (sum, item) => sum + (Number(item.quantity_kg) || 0),
    0,
  )
  const names = items.map((item) => item.products?.name_fa).filter(Boolean)
  const productsSummary =
    names.length <= 1 ? names[0] || '' : `${names[0]} + ${names.length - 1} محصول دیگر`
  return {
    ...order,
    totalQuantityKg,
    productsSummary,
    company: companiesById.get(order.company_id) || null,
    creator: creatorsById.get(order.created_by) || null,
  }
}

export function useAdminOrders() {
  const [orders, setOrders] = useState([])
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    Promise.all([fetchOrders(), fetchCompanies()]).then(
      ([ordersRes, companiesRes]) => {
        if (ignore) return
        if (ordersRes.error) {
          setError(translateDbError(ordersRes.error.message))
          setLoading(false)
          return
        }
        const companiesById = new Map(
          (companiesRes.data || []).map((c) => [c.id, c]),
        )
        const creatorIds = [
          ...new Set((ordersRes.data || []).map((o) => o.created_by).filter(Boolean)),
        ]
        fetchCreators(creatorIds).then((creatorsRes) => {
          if (ignore) return
          const creatorsById = new Map(
            (creatorsRes.data || []).map((c) => [c.id, c]),
          )
          setError('')
          setOrders(
            ordersRes.data.map((o) => summarize(o, companiesById, creatorsById)),
          )
          setCompanies(companiesRes.data || [])
          setLoading(false)
        })
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

  return { orders, companies, loading, error, refresh }
}
