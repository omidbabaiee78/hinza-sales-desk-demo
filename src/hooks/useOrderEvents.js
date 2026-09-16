import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت تاریخچه سفارش. لطفاً دوباره تلاش کنید.'
}

function fetchEvents(orderId) {
  return supabase
    .from('order_events')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
}

// RLS is the authority on which rows a viewer receives (customers only ever
// get customer_visible rows back) - this hook renders whatever comes back.
export function useOrderEvents(orderId) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!orderId) return
    let ignore = false
    fetchEvents(orderId).then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setEvents(data)
      }
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [orderId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { events, loading, error, refresh }
}
