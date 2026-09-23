import { supabase } from '../lib/supabaseClient'
import { addLeadActivity } from './salesLeads'
import { formatJalaliDate, formatKg } from '../utils/formatters'

// Sample tracking (phase 27, public.lead_samples). Every write also logs a
// normal 'sample' timeline entry through addLeadActivity, so the lead's
// activity history and last_contact_at keep working exactly as before. The
// lead's own next_follow_up_at is never changed here - due sample feedback
// is surfaced on Today from lead_samples.feedback_due_on instead.

export const SAMPLE_STATUS_LABELS = {
  pending: 'منتظر بازخورد',
  approved: 'تأیید شد',
  rejected: 'رد شد',
}

export const SAMPLE_STATUS_TONE = {
  pending: 'sample',
  approved: 'won',
  rejected: 'lost',
}

const SAMPLE_SELECT = '*, products(id, code, name_fa)'

export function sampleProductLabel(sample) {
  return sample.products ? `${sample.products.code} ${sample.products.name_fa}` : 'محصول'
}

export function fetchLeadSamples(leadId) {
  return supabase.from('lead_samples').select(SAMPLE_SELECT).eq('lead_id', leadId).order('sent_on', { ascending: false })
}

// Pending samples whose feedback date (a Tehran calendar day) is today or
// earlier, oldest first - converted/lost leads are left out.
export async function fetchDueSamples(todayKey) {
  const { data, error } = await supabase
    .from('lead_samples')
    .select(`${SAMPLE_SELECT}, sales_leads!inner(id, company_name, contact_name, status)`)
    .eq('status', 'pending')
    .lte('feedback_due_on', todayKey)
    .not('sales_leads.status', 'in', '(converted,lost)')
    .order('feedback_due_on', { ascending: true })
  if (error) throw error
  return data || []
}

// Once the lead_samples write has succeeded the sample is saved, so a failed
// timeline entry must never surface as an error the user would "retry" (that
// would insert a duplicate sample). Returns false instead so the UI can say
// only the timeline entry is missing.
async function logSampleTimeline(leadId, note) {
  try {
    await addLeadActivity(leadId, { activityType: 'sample', note })
    return true
  } catch {
    return false
  }
}

// created_by is filled by the column default (auth.uid()), never the client.
// Resolves to { timelineSaved } - it only throws if the sample itself failed.
export async function recordLeadSample(leadId, { productId, productLabel, quantityKg, sentOn, feedbackDueOn, note }) {
  const { error } = await supabase.from('lead_samples').insert({
    lead_id: leadId,
    product_id: productId,
    quantity_kg: Number(quantityKg),
    sent_on: sentOn,
    feedback_due_on: feedbackDueOn,
  })
  if (error) throw error

  const summary = `ارسال نمونه ${productLabel} - ${formatKg(quantityKg)} - موعد بازخورد: ${formatJalaliDate(feedbackDueOn)}`
  const timelineSaved = await logSampleTimeline(leadId, note ? `${summary} — ${note}` : summary)
  return { timelineSaved }
}

// Same contract as recordLeadSample: resolves to { timelineSaved }.
export async function resolveLeadSample(sample, { status, feedbackNote }) {
  const { data, error } = await supabase
    .from('lead_samples')
    .update({ status, feedback_note: feedbackNote || null, resolved_at: new Date().toISOString() })
    .eq('id', sample.id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('این نمونه قبلاً بررسی شده است. صفحه را به‌روزرسانی کنید.')

  const summary = `بازخورد نمونه ${sampleProductLabel(sample)}: ${SAMPLE_STATUS_LABELS[status]}`
  const timelineSaved = await logSampleTimeline(sample.lead_id, feedbackNote ? `${summary} — ${feedbackNote}` : summary)
  return { timelineSaved }
}
