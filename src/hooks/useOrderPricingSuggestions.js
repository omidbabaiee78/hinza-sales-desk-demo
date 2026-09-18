import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت پیشنهاد قیمت.'
}

// Pricing suggestions are informational only - a failure here must never
// block pricing/quoting an order, so callers get `suggestions: null` on
// error instead of throwing, and the order pricing form falls back to
// plain manual entry exactly as before this feature existed.
export function useOrderPricingSuggestions(orderId) {
  const [suggestions, setSuggestions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderId) return
    let ignore = false
    supabase
      .rpc('get_order_pricing_suggestions', { p_order_id: orderId })
      .then(({ data, error: rpcError }) => {
        if (ignore) return
        if (rpcError) {
          setError(translateDbError(rpcError.message))
          setSuggestions(null)
          setLoading(false)
          return
        }
        setError('')
        setSuggestions(data || [])
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [orderId])

  return { suggestions: orderId ? suggestions : null, loading: orderId ? loading : false, error }
}
