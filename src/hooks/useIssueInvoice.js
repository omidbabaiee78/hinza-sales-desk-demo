import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'صدور فاکتور با خطا مواجه شد. لطفاً دوباره تلاش کنید.'
}

// Resolves whatever shape the RPC returns (a bare uuid, a single row, or a
// one-row array) into just the invoice id.
function resolveInvoiceId(data) {
  if (!data) return null
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return data[0]?.id ?? data[0]?.invoice_id ?? null
  return data.id ?? data.invoice_id ?? null
}

export function useIssueInvoice() {
  const [submitting, setSubmitting] = useState(false)

  async function issueInvoice({ orderId, dueDate, note }) {
    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('issue_invoice_from_order', {
        p_order_id: orderId,
        p_due_date: dueDate || null,
        p_note: note || null,
      })
      if (error) throw new Error(translateDbError(error.message))
      return { invoiceId: resolveInvoiceId(data) }
    } finally {
      setSubmitting(false)
    }
  }

  return { issueInvoice, submitting }
}
