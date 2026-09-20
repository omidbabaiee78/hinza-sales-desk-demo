// ---------------------------------------------------------------------------
// RAW REPLY -> normalize -> classify -> recommendation -> (human
// confirmation) -> business state update. No Supabase client is imported
// here - every function takes one as its first argument, exactly like
// automation/taskService.js - so this same pipeline can run from the
// browser (Phase 20's manual-entry UI) or, later, from a provider-webhook
// Edge Function (Phase 21+) without any business logic changing.
// ---------------------------------------------------------------------------

import { normalizeReply } from './normalizeReply.js'
import { classifyReply } from './classifyReply.js'
import { recommendNextAction } from './recommendNextAction.js'
import { getIntentDefinition } from './intentDefinitions.js'
import { cancelTask } from '../automation/taskService.js'

async function currentUserId(client) {
  try {
    const {
      data: { user },
    } = await client.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

async function insertReplyRow(client, params, normalization, classification, recommendation) {
  const { data, error } = await client
    .from('inbound_replies')
    .insert({
      lead_id: params.leadId || null,
      company_id: params.companyId || null,
      outreach_attempt_id: params.outreachAttemptId || null,
      automation_task_id: params.automationTaskId || null,
      channel: params.channel,
      source: params.source || 'manual',
      raw_message: normalization.raw,
      normalized_message: normalization.normalized,
      predicted_intent: classification.intentKey,
      final_intent: classification.intentKey,
      confidence: classification.confidence,
      classification_source: 'rules',
      recommended_action: recommendation.actionKey,
      recommended_follow_up_at: recommendation.followUpAt,
      admin_confirmed: false,
      admin_notes: params.note || null,
      external_message_id: params.externalMessageId || null,
      provider_payload: params.providerPayload || null,
      created_by: params.createdBy,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

function buildActivityNote(def, reply, note) {
  const preview = (reply.raw_message || '').slice(0, 160)
  const base = `پاسخ دریافت‌شده (${reply.channel}): «${preview}» — تشخیص: ${def.label}.`
  return note ? `${base} یادداشت ادمین: ${note}` : base
}

// Classifies and stores a raw inbound reply. If `confirmation` is provided
// (the Phase 20 manual-entry UI always provides it, since the admin reviews
// before submitting), the reply is confirmed and its business-state
// consequences applied in the SAME call. A future webhook adapter would omit
// `confirmation`, leaving the row as admin_confirmed=false for later human
// review via confirmInboundReply - same pipeline, no rewritten business
// logic.
export async function processInboundReply(client, params) {
  const now = params.now || new Date()
  const normalization = normalizeReply(params.rawMessage)
  const classification = classifyReply(normalization, { now })
  const recommendation = recommendNextAction({ intentKey: classification.intentKey, normalizedText: normalization.normalized, now })

  const createdBy = params.createdBy !== undefined ? params.createdBy : await currentUserId(client)
  const row = await insertReplyRow(client, { ...params, createdBy }, normalization, classification, recommendation)

  if (params.confirmation) {
    return confirmInboundReply(client, row.id, params.confirmation)
  }
  return { reply: row, classification, recommendation }
}

// Applies the business-state consequences of a reply. Idempotent by
// default: once a reply has processed_at set, calling this again is a
// no-op that returns the already-processed row untouched - processing the
// same inbound reply twice (an accidental double-submit, a webhook retry)
// must never cancel a task twice or log a duplicate activity. Pass
// `{ force: true }` only for a deliberate admin correction of an
// already-processed reply (re-opening it from the Reply Inbox to change the
// classification) - that is a new decision, not a duplicate of the old one.
export async function confirmInboundReply(client, replyId, confirmation = {}, { force = false } = {}) {
  const { finalIntentKey, followUpAt, note } = confirmation

  const { data: reply, error: fetchError } = await client.from('inbound_replies').select('*').eq('id', replyId).single()
  if (fetchError) throw fetchError

  if (reply.processed_at && !force) {
    return reply
  }

  const intentKey = finalIntentKey || reply.final_intent || reply.predicted_intent
  const def = getIntentDefinition(intentKey)
  const actorId = confirmation.confirmedBy !== undefined ? confirmation.confirmedBy : await currentUserId(client)

  if (reply.lead_id) {
    // Never overrides an existing do_not_contact back to false - only ever
    // sets it, and only for the two intents whose whole meaning is "stop
    // contacting me."
    if (def.blocksOutreach) {
      const { error } = await client.from('sales_leads').update({ do_not_contact: true }).eq('id', reply.lead_id)
      if (error) throw error
    }
    if (followUpAt) {
      const { error } = await client.from('sales_leads').update({ next_follow_up_at: followUpAt }).eq('id', reply.lead_id)
      if (error) throw error
    }

    const { error: activityError } = await client.from('lead_activities').insert({
      lead_id: reply.lead_id,
      activity_type: 'note',
      note: buildActivityNote(def, reply, note),
      next_follow_up_at: followUpAt || null,
      created_by: actorId,
    })
    if (activityError) throw activityError
  }

  // The originating outreach task, if any, is now superseded by this reply -
  // close it through the EXISTING automation task lifecycle (never a second
  // task engine). The reconciler generates whatever comes next (e.g. a new
  // lead_followup_due task once next_follow_up_at is due).
  if (reply.automation_task_id) {
    try {
      await cancelTask(client, reply.automation_task_id, `پاسخ سرنخ دریافت و پردازش شد - تشخیص: ${def.label}.`)
    } catch {
      // Already closed/missing (e.g. re-confirming the same reply with
      // force:true) - not a failure of the reply confirmation itself.
    }
  }

  const { data: updated, error: updateError } = await client
    .from('inbound_replies')
    .update({
      final_intent: intentKey,
      admin_confirmed: true,
      admin_notes: note ?? reply.admin_notes,
      recommended_follow_up_at: followUpAt ?? reply.recommended_follow_up_at,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', replyId)
    .select('*')
    .single()
  if (updateError) throw updateError
  return updated
}
