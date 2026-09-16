import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'ذخیره تغییرات با خطا مواجه شد. لطفاً دوباره تلاش کنید.'
}

export function useOrderActions(orderId) {
  const [busy, setBusy] = useState(false)

  // order_events is read-only from the frontend: a database trigger already
  // logs a history entry for every orders.status change, so this only ever
  // touches orders.status.
  async function transitionStatus(newStatus) {
    setBusy(true)
    try {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId)
      if (updateError) throw new Error(translateDbError(updateError.message))
    } finally {
      setBusy(false)
    }
  }

  async function saveAdminNote(note) {
    setBusy(true)
    try {
      const { error } = await supabase
        .from('orders')
        .update({ admin_note: note || null })
        .eq('id', orderId)
      if (error) throw new Error(translateDbError(error.message))
    } finally {
      setBusy(false)
    }
  }

  async function saveItemPricing(items) {
    setBusy(true)
    try {
      for (const item of items) {
        const { error } = await supabase
          .from('order_items')
          .update({
            unit_price_rial: item.unit_price_rial,
            discount_percent: item.discount_percent,
          })
          .eq('id', item.id)
        if (error) throw new Error(translateDbError(error.message))
      }
    } finally {
      setBusy(false)
    }
  }

  return { busy, transitionStatus, saveAdminNote, saveItemPricing }
}
