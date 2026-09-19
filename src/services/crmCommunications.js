import { supabase } from '../lib/supabaseClient'

// Plain write helper (no React state) so a list of CRM rows can log a
// contact without each row mounting a full list-fetching hook. Throws the
// raw Supabase error - callers decide how to translate/display it.
//
// channel: 'phone' | 'whatsapp' | 'sms'
// actionStatus: 'manual_action' | 'opened' | 'copied' | 'sent' | 'delivered' | 'failed'
export async function logCrmCommunication({
  companyId,
  channel,
  reason,
  messageSnapshot,
  actionStatus,
  orderId,
  invoiceId,
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('crm_communications').insert({
    company_id: companyId,
    channel,
    reason,
    message_snapshot: messageSnapshot || null,
    action_status: actionStatus || 'manual_action',
    order_id: orderId || null,
    invoice_id: invoiceId || null,
    created_by: user?.id ?? null,
  })
  if (error) throw error
}
