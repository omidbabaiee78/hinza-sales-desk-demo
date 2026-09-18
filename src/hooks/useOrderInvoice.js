import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function fetchOrderInvoices(orderId) {
  return supabase
    .from('invoices')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
}

// Looks up whether an order already has a non-cancelled invoice, so the
// order detail page can show "مشاهده فاکتور" instead of letting the admin
// issue a duplicate.
export function useOrderInvoice(orderId) {
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!orderId) return
    let ignore = false
    fetchOrderInvoices(orderId).then(({ data, error }) => {
      if (ignore) return
      if (!error && data) {
        setInvoice(data.find((inv) => inv.status !== 'cancelled') || null)
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

  return { invoice, loading, refresh }
}
