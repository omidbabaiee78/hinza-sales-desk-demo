import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات تخفیف. لطفاً دوباره تلاش کنید.'
}

// get_pricing_suggestion needs a product, but the loyalty fields it returns
// (portal_discount_percent, paid_invoice_count, loyalty_bonus_percent,
// auto_discount_percent) are company-wide, not product-specific - so any
// product id works here. Only those fields are used; base/special/suggested
// price fields are ignored by callers that just want the loyalty summary.
export function usePricingSuggestion(companyId, productId) {
  const [suggestion, setSuggestion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!companyId || !productId) return
    let ignore = false
    supabase
      .rpc('get_pricing_suggestion', { p_company_id: companyId, p_product_id: productId })
      .then(({ data, error: rpcError }) => {
        if (ignore) return
        if (rpcError) {
          setError(translateDbError(rpcError.message))
          setSuggestion(null)
          setLoading(false)
          return
        }
        setError('')
        setSuggestion(Array.isArray(data) ? data[0] || null : data || null)
        setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [companyId, productId])

  return {
    suggestion: companyId && productId ? suggestion : null,
    loading: companyId && productId ? loading : false,
    error,
  }
}
