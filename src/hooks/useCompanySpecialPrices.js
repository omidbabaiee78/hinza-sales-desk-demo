import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در ذخیره قیمت اختصاصی. لطفاً دوباره تلاش کنید.'
}

function fetchPrices(companyId) {
  return supabase
    .from('company_prices')
    .select(
      'id, company_id, product_id, discount_percent, valid_from, valid_to, note, created_at, products(id, code, name_fa)',
    )
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
}

// company_prices has no `active` flag - validity is purely valid_from/valid_to,
// the same range the get_pricing_suggestion RPC itself evaluates.
export function useCompanySpecialPrices(companyId) {
  const [prices, setPrices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    fetchPrices(companyId).then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setPrices(data || [])
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

  function toRow({ productId, discountPercent, validFrom, validTo, note }) {
    return {
      product_id: productId,
      discount_percent:
        discountPercent === '' || discountPercent == null ? null : Number(discountPercent),
      valid_from: validFrom || null,
      valid_to: validTo || null,
      note: note?.trim() || null,
    }
  }

  async function createPrice(values) {
    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('company_prices')
        .insert({ company_id: companyId, ...toRow(values) })
      if (error) throw new Error(translateDbError(error.message))
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function updatePrice(id, values) {
    setSubmitting(true)
    try {
      const { error } = await supabase.from('company_prices').update(toRow(values)).eq('id', id)
      if (error) throw new Error(translateDbError(error.message))
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function removePrice(id) {
    setSubmitting(true)
    try {
      const { error } = await supabase.from('company_prices').delete().eq('id', id)
      if (error) throw new Error(translateDbError(error.message))
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return {
    prices,
    loading: companyId ? loading : false,
    error,
    refresh,
    createPrice,
    updatePrice,
    removePrice,
    submitting,
  }
}
