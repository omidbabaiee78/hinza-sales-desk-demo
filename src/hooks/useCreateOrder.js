import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'ثبت سفارش با خطا مواجه شد. لطفاً دوباره تلاش کنید.'
}

// Resolves whatever shape the RPC returns (a bare id, a single row, or a
// one-row array) into just the new order's id, without guessing wrong in a
// way that breaks the whole flow.
function resolveOrderId(data) {
  if (!data) return null
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return data[0]?.id ?? data[0]?.order_id ?? null
  return data.id ?? data.order_id ?? null
}

export function useCreateOrder() {
  const [submitting, setSubmitting] = useState(false)

  async function createOrder({ requestedDate, customerNote, items }) {
    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('create_customer_order', {
        p_requested_date: requestedDate || null,
        p_customer_note: customerNote || null,
        p_items: items.map((item) => ({
          product_id: item.productId,
          quantity_kg: Number(item.quantityKg),
          note: item.note || null,
        })),
      })

      if (error) throw new Error(translateDbError(error.message))

      return { orderId: resolveOrderId(data) }
    } finally {
      setSubmitting(false)
    }
  }

  return { createOrder, submitting }
}
