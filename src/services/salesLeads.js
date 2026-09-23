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
export async function addLeadActivity(leadId, { activityType, note, nextFollowUpAt, clearFollowUp = false }) {
  await insertActivity(leadId, activityType, note, nextFollowUpAt)

  const updates = {}
  if (CONTACT_ACTIVITY_TYPES.has(activityType)) updates.last_contact_at = new Date().toISOString()
  if (nextFollowUpAt) updates.next_follow_up_at = nextFollowUpAt
  else if (clearFollowUp) updates.next_follow_up_at = null
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

// ---------------------------------------------------------------------------
// Bulk actions (multi-select on the leads list). Every action here is scoped
// to the ids the admin explicitly selected - never a filtered/implicit set -
// and never touches converted/lost leads' terminal fields or history tables.
// ---------------------------------------------------------------------------

const BULK_ID_CHUNK_SIZE = 200
const BULK_ROW_BATCH_SIZE = 25

function chunkArray(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
  return chunks
}

export async function bulkSetLeadPriority(leadIds, priority) {
  for (const idChunk of chunkArray(leadIds, BULK_ID_CHUNK_SIZE)) {
    const { error } = await supabase.from('sales_leads').update({ priority }).in('id', idChunk)
    if (error) throw error
  }
}

export async function bulkSetLeadPreferredChannel(leadIds, preferredChannel) {
  for (const idChunk of chunkArray(leadIds, BULK_ID_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('sales_leads')
      .update({ preferred_channel: preferredChannel || null })
      .in('id', idChunk)
    if (error) throw error
  }
}

export async function bulkSetLeadFollowUp(leadIds, nextFollowUpAtIso) {
  for (const idChunk of chunkArray(leadIds, BULK_ID_CHUNK_SIZE)) {
    const { error } = await supabase
      .from('sales_leads')
      .update({ next_follow_up_at: nextFollowUpAtIso })
      .in('id', idChunk)
    if (error) throw error
  }
}

// Only ever sets do_not_contact to true in bulk - re-enabling contact stays a
// deliberate single-lead edit, never a bulk/silent action.
export async function bulkMarkLeadsDoNotContact(leadIds) {
  for (const idChunk of chunkArray(leadIds, BULK_ID_CHUNK_SIZE)) {
    const { error } = await supabase.from('sales_leads').update({ do_not_contact: true }).in('id', idChunk)
    if (error) throw error
  }
}

// Restricted to the 6 active pipeline statuses, same as the single-lead
// flow - converted/lost each require their own dedicated flow. Logs one
// status_change activity per lead via a single bulk insert.
export async function bulkChangeLeadStatus(leadIds, newStatus) {
  const createdBy = await currentUserId()
  for (const idChunk of chunkArray(leadIds, BULK_ID_CHUNK_SIZE)) {
    const { error } = await supabase.from('sales_leads').update({ status: newStatus }).in('id', idChunk)
    if (error) throw error
  }
  const note = `وضعیت به «${leadStatusLabel(newStatus)}» تغییر یافت (تغییر گروهی).`
  const { error: activityError } = await supabase
    .from('lead_activities')
    .insert(leadIds.map((leadId) => ({ lead_id: leadId, activity_type: 'status_change', note, created_by: createdBy })))
  if (activityError) throw activityError
}

// Tag sets differ per lead, so this can't be one uniform UPDATE - fetches
// current tags first, unions the new tag client-side, then writes back in
// small batches (never one unbounded Promise.all for the whole selection).
export async function bulkAddLeadTag(leadIds, tag) {
  const trimmedTag = tag.trim()
  if (!trimmedTag) return

  const { data: rows, error: fetchError } = await supabase.from('sales_leads').select('id, tags').in('id', leadIds)
  if (fetchError) throw fetchError

  for (const batch of chunkArray(rows || [], BULK_ROW_BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map((row) => {
        const currentTags = row.tags || []
        if (currentTags.some((t) => t.toLowerCase() === trimmedTag.toLowerCase())) {
          return Promise.resolve({ error: null })
        }
        return supabase
          .from('sales_leads')
          .update({ tags: [...currentTags, trimmedTag] })
          .eq('id', row.id)
      }),
    )
    const failed = results.find((r) => r.error)
    if (failed) throw failed.error
  }
}
