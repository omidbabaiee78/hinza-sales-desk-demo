import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات سفارش. لطفاً دوباره تلاش کنید.'
}

function fetchOrder(orderId) {
  return supabase
    .from('orders')
    .select(
      '*, order_items(id, product_id, quantity_kg, unit_price_rial, discount_percent, line_total_rial, note, products(id, code, name_fa, category))',
    )
    .eq('id', orderId)
    .single()
}

function fetchCompany(companyId) {
  return supabase.from('companies').select('*').eq('id', companyId).maybeSingle()
}

function fetchCreator(userId) {
  return supabase
    .from('profiles')
    .select('id, full_name, phone')
    .eq('id', userId)
    .maybeSingle()
}

export function useOrder(orderId) {
  const [order, setOrder] = useState(null)
  const [company, setCompany] = useState(null)
  const [creator, setCreator] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!orderId) return
    let ignore = false

    fetchOrder(orderId).then(({ data, error: orderError }) => {
      if (ignore) return
      if (orderError) {
        setError(translateDbError(orderError.message))
        setOrder(null)
        setLoading(false)
        return
      }
      setError('')
      setOrder(data)

      Promise.all([
        fetchCompany(data.company_id),
        fetchCreator(data.created_by),
      ]).then(([companyRes, creatorRes]) => {
        if (ignore) return
        setCompany(companyRes.data ?? null)
        setCreator(creatorRes.data ?? null)
        setLoading(false)
      })
    })

    return () => {
      ignore = true
    }
  }, [orderId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { order, company, creator, loading, error, refresh }
}
