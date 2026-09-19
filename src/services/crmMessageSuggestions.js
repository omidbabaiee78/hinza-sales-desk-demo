import { supabase } from '../lib/supabaseClient'

export function fetchAllSuggestions() {
  return supabase.from('crm_message_suggestions').select('*').order('priority', { ascending: true })
}

// Dedupe is enforced by the dedupe_key UNIQUE constraint - this is always
// an insert, never an upsert-that-overwrites, so an existing row (whatever
// its status) is left completely untouched.
export async function insertSuggestions(rows) {
  if (rows.length === 0) return
  const { error } = await supabase
    .from('crm_message_suggestions')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  if (error) throw error
}

export async function expireSuggestions(ids) {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('crm_message_suggestions')
    .update({ status: 'expired' })
    .in('id', ids)
  if (error) throw error
}

export async function approveSuggestion(id) {
  const { error } = await supabase
    .from('crm_message_suggestions')
    .update({ status: 'approved', feedback: 'good' })
    .eq('id', id)
  if (error) throw error
}

// The original message_draft is never touched - only message_final changes.
export async function editSuggestion(id, finalText) {
  const { error } = await supabase
    .from('crm_message_suggestions')
    .update({ status: 'edited', message_final: finalText, feedback: 'edited' })
    .eq('id', id)
  if (error) throw error
}

export async function dismissSuggestion(id) {
  const { error } = await supabase
    .from('crm_message_suggestions')
    .update({ status: 'dismissed', feedback: 'not_needed' })
    .eq('id', id)
  if (error) throw error
}

// Called once the admin actually performs the action (WhatsApp opened /
// call clicked) - never on approve/edit alone. `feedback` is only supplied
// as a default (the caller preserves an already-set 'edited' feedback
// rather than overwriting it with 'good').
export async function markSuggestionActed(id, { finalText, actedBy, feedback }) {
  const { error } = await supabase
    .from('crm_message_suggestions')
    .update({
      status: 'acted',
      message_final: finalText,
      feedback: feedback || 'good',
      acted_at: new Date().toISOString(),
      acted_by: actedBy || null,
    })
    .eq('id', id)
  if (error) throw error
}
