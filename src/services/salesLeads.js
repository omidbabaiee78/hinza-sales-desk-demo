import { supabase } from '../lib/supabaseClient'
import { CONTACT_ACTIVITY_TYPES, leadLossReasonLabel, leadStatusLabel } from '../utils/leadStatus'

// Plain write helpers (no React state), matching the existing
// crmCommunications.js/crmSnoozes.js style - callers own their own
// busy/error state and decide how to translate the thrown error.

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

// Replaces the full interested-products set for a lead - a simple
// delete-then-insert is correct and cheap at this scale (a handful of
// products per lead), no diffing needed.
export async function setLeadProducts(leadId, productIds) {
  const { error: deleteError } = await supabase.from('lead_products').delete().eq('lead_id', leadId)
  if (deleteError) throw deleteError
  if (!productIds || productIds.length === 0) return
  const { error: insertError } = await supabase
    .from('lead_products')
    .insert(productIds.map((productId) => ({ lead_id: leadId, product_id: productId })))
  if (insertError) throw insertError
}

export async function createLead({ fields, productIds = [] }) {
  const createdBy = await currentUserId()
  const { data, error } = await supabase
    .from('sales_leads')
    .insert({ ...fields, created_by: createdBy })
    .select('id')
    .single()
  if (error) throw error
  if (productIds.length > 0) {
    await setLeadProducts(data.id, productIds)
  }
  return data.id
}

export async function updateLead(leadId, { fields, productIds } = {}) {
  if (fields) {
    const { error } = await supabase.from('sales_leads').update(fields).eq('id', leadId)
    if (error) throw error
  }
  if (productIds) {
    await setLeadProducts(leadId, productIds)
  }
}

async function insertActivity(leadId, activityType, note, nextFollowUpAt) {
  const createdBy = await currentUserId()
  const { error } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: activityType,
    note: note || null,
    next_follow_up_at: nextFollowUpAt || null,
    created_by: createdBy,
  })
  if (error) throw error
}

// Logs a timeline entry and keeps sales_leads.last_contact_at /
// next_follow_up_at consistent with it, per the phase-15 spec: a real
// contact (phone/whatsapp/meeting/sample/quote) stamps last_contact_at, and
// a supplied next_follow_up_at always overwrites the lead's own field.
export async function addLeadActivity(leadId, { activityType, note, nextFollowUpAt }) {
  await insertActivity(leadId, activityType, note, nextFollowUpAt)

  const updates = {}
  if (CONTACT_ACTIVITY_TYPES.has(activityType)) updates.last_contact_at = new Date().toISOString()
  if (nextFollowUpAt) updates.next_follow_up_at = nextFollowUpAt
  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('sales_leads').update(updates).eq('id', leadId)
    if (error) throw error
  }
}

// Generic status change - restricted by the UI to the 6 active pipeline
// statuses. 'converted' must go through convertLeadToNewCompany/
// convertLeadToExistingCompany, 'lost' must go through markLeadLost -
// this function is never used for either.
export async function changeLeadStatus(leadId, newStatus) {
  const { error } = await supabase.from('sales_leads').update({ status: newStatus }).eq('id', leadId)
  if (error) throw error
  await insertActivity(leadId, 'status_change', `وضعیت به «${leadStatusLabel(newStatus)}» تغییر یافت.`)
}

export async function markLeadLost(leadId, { lossReason, clearFollowUp }) {
  const updates = { status: 'lost', loss_reason: lossReason || null }
  if (clearFollowUp) updates.next_follow_up_at = null
  const { error } = await supabase.from('sales_leads').update(updates).eq('id', leadId)
  if (error) throw error
  await insertActivity(
    leadId,
    'status_change',
    lossReason ? `از دست رفته - دلیل: ${leadLossReasonLabel(lossReason)}` : 'از دست رفته',
  )
}

// If the lead never had a company_name (only a contact_name), the admin
// must supply one here before a NEW company can be created - never silently
// using the person's name as the company name.
export async function convertLeadToNewCompany(leadId, { companyNameOverride } = {}) {
  if (companyNameOverride) {
    const { error } = await supabase
      .from('sales_leads')
      .update({ company_name: companyNameOverride })
      .eq('id', leadId)
    if (error) throw error
  }
  const { data, error } = await supabase.rpc('convert_lead_to_company', {
    p_lead_id: leadId,
    p_existing_company_id: null,
  })
  if (error) throw error
  return data
}

export async function convertLeadToExistingCompany(leadId, existingCompanyId) {
  const { data, error } = await supabase.rpc('convert_lead_to_company', {
    p_lead_id: leadId,
    p_existing_company_id: existingCompanyId,
  })
  if (error) throw error
  return data
}
