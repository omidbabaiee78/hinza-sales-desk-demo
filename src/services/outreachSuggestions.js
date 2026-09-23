import { supabase } from '../lib/supabaseClient'

// I/O layer for prospect_outreach_suggestions - the Phase 25 SHADOW MODE
// queue. Mirrors crmMessageSuggestions.js's exact shape (insert-only dedupe
// via ON CONFLICT DO NOTHING, explicit action verbs, never a raw update()
// exposed to callers) for consistency across the two suggestion systems.
//
// There is NO "send" function here, on purpose - approve()/edit() only ever
// mark a row approved-for-future-send (Phase 25 STEP 9); nothing in this
// file, or anywhere else in the outreach module, can cause a real message to
// go out (see src/outreach/channels/*.js's disabledExecute()).

export function fetchAllSuggestions() {
  return supabase.from('prospect_outreach_suggestions').select('*, sales_leads(company_name, contact_name, city, industry, email, status, do_not_contact)').order('priority', { ascending: true, nullsFirst: false })
}

export async function fetchSuggestionsForLeads(leadIds) {
  if (!leadIds || leadIds.length === 0) return []
  const { data, error } = await supabase.from('prospect_outreach_suggestions').select('*').in('lead_id', leadIds)
  if (error) throw error
  return data || []
}

// Dedupe is enforced by the dedupe_key UNIQUE constraint - always an insert,
// never an upsert-that-overwrites, so an existing row (whatever its status)
// is left completely untouched. Returns the count actually inserted.
export async function insertSuggestions(rows) {
  if (rows.length === 0) return 0
  const { data, error } = await supabase
    .from('prospect_outreach_suggestions')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return (data || []).length
}

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

// Approved-for-future-send ONLY - never sends anything, never can.
export async function approveSuggestion(id) {
  const approvedBy = await currentUserId()
  const { error } = await supabase
    .from('prospect_outreach_suggestions')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: approvedBy, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// The original message_draft is never touched - only message_final changes.
export async function editSuggestion(id, finalText) {
  const { error } = await supabase
    .from('prospect_outreach_suggestions')
    .update({ status: 'edited', message_final: finalText, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function dismissSuggestion(id, feedback) {
  const { error } = await supabase
    .from('prospect_outreach_suggestions')
    .update({ status: 'dismissed', feedback: feedback || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function snoozeSuggestion(id, untilIso) {
  const { error } = await supabase
    .from('prospect_outreach_suggestions')
    .update({ status: 'snoozed', snoozed_until: untilIso, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function expireSuggestions(ids) {
  if (ids.length === 0) return
  const { error } = await supabase.from('prospect_outreach_suggestions').update({ status: 'expired', updated_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
}

export function fetchRecentOutreachRuns() {
  return supabase.from('prospect_outreach_runs').select('*').order('started_at', { ascending: false }).limit(50)
}
