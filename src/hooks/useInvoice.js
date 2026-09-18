import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات فاکتور. لطفاً دوباره تلاش کنید.'
}

function fetchInvoice(invoiceId) {
  return supabase
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('id', invoiceId)
    .single()
}

function fetchCompany(companyId) {
  return supabase.from('companies').select('*').eq('id', companyId).maybeSingle()
}

// invoice_items only snapshots product_code (not the product name), so the
// name shown here is a live lookup by code, not a historical snapshot - see
// the Phase 3 report for why this is a known, flagged limitation rather than
// a schema change made unilaterally.
function fetchProductNames(codes) {
  if (codes.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('products').select('code, name_fa').in('code', codes)
}

export function useInvoice(invoiceId) {
  const [invoice, setInvoice] = useState(null)
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!invoiceId) return
    let ignore = false

    fetchInvoice(invoiceId).then(({ data, error: invoiceError }) => {
      if (ignore) return
      if (invoiceError) {
        setError(translateDbError(invoiceError.message))
        setInvoice(null)
        setLoading(false)
        return
      }
      const items = data.invoice_items || []
      const codes = [...new Set(items.map((i) => i.product_code).filter(Boolean))]

      Promise.all([fetchCompany(data.company_id), fetchProductNames(codes)]).then(
        ([companyRes, productsRes]) => {
          if (ignore) return
          const namesByCode = new Map(
            (productsRes.data || []).map((p) => [p.code, p.name_fa]),
          )
          setError('')
          setInvoice({
            ...data,
            invoice_items: items.map((item) => ({
              ...item,
              product_name_fa: namesByCode.get(item.product_code) || null,
            })),
          })
          setCompany(companyRes.data ?? null)
          setLoading(false)
        },
      )
    })

    return () => {
      ignore = true
    }
  }, [invoiceId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { invoice, company, loading, error, refresh }
}
