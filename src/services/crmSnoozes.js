import { supabase } from '../lib/supabaseClient'

export const SNOOZE_OPTIONS = [
  { label: 'فردا', days: 1 },
  { label: '۳ روز', days: 3 },
  { label: '۷ روز', days: 7 },
]

// One active snooze per (company_id, reason_key, order_id, invoice_id): this
// matches the DB's unique context index, so re-snoozing the same reason for
// the same order/invoice just moves snooze_until forward via upsert instead
// of stacking a duplicate row. A reason with no related order/invoice (e.g.
// inactivity) snoozes with order_id/invoice_id both null.
export async function snoozeCompanyAttention({ companyId, reasonKey, orderId, invoiceId, days }) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const snoozeUntil = new Date()
  snoozeUntil.setDate(snoozeUntil.getDate() + days)

  const { error } = await supabase.from('crm_snoozes').upsert(
    {
      company_id: companyId,
      reason_key: reasonKey,
      order_id: orderId || null,
      invoice_id: invoiceId || null,
      snooze_until: snoozeUntil.toISOString(),
      created_by: user?.id ?? null,
    },
    { onConflict: 'company_id,reason_key,order_id,invoice_id' },
  )
  if (error) throw error
}
