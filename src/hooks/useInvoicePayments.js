import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'ثبت پرداخت با خطا مواجه شد. لطفاً دوباره تلاش کنید.'
}

function fetchPayments(invoiceId) {
  return supabase
    .from('payments')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('paid_at', { ascending: false })
}

export function useInvoicePayments(invoiceId) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!invoiceId) return
    let ignore = false
    fetchPayments(invoiceId).then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setPayments(data)
      }
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [invoiceId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  // Only ever writes the payment record itself. account_entries and
  // invoices.status are updated by the database, never here.
  async function registerPayment({ companyId, amountRial, paidAt, method, referenceCode, note }) {
    setSubmitting(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { error } = await supabase.from('payments').insert({
        company_id: companyId,
        invoice_id: invoiceId,
        amount_rial: amountRial,
        paid_at: paidAt,
        method: method || null,
        reference_code: referenceCode || null,
        note: note || null,
        created_by: user.id,
      })
      if (error) throw new Error(translateDbError(error.message))
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return { payments, loading, error, refresh, registerPayment, submitting }
}
