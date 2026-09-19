import { supabase } from '../lib/supabaseClient'

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

// One insert per event - never batched into a single opaque row, and never
// written "just because reconciliation ran" (see reconciler.js: this is
// only called for an ACTUAL transition, keeping the audit log meaningful
// instead of noisy).
export async function logTaskEvent(taskId, eventType, { message, metadata, actorUserId } = {}) {
  const actor = actorUserId !== undefined ? actorUserId : await currentUserId()
  const { error } = await supabase.from('automation_task_events').insert({
    task_id: taskId,
    event_type: eventType,
    message: message || null,
    metadata: metadata || {},
    actor_user_id: actor,
  })
  if (error) throw error
}

// Batched insert for the reconciler's own passes (creation/invalidation can
// touch many tasks in one cycle) - one INSERT statement, never one query
// per task.
export async function logTaskEventsBatch(events) {
  if (events.length === 0) return
  const actor = await currentUserId()
  const rows = events.map((e) => ({
    task_id: e.taskId,
    event_type: e.eventType,
    message: e.message || null,
    metadata: e.metadata || {},
    actor_user_id: e.actorUserId !== undefined ? e.actorUserId : actor,
  }))
  const { error } = await supabase.from('automation_task_events').insert(rows)
  if (error) throw error
}

export function fetchTaskEvents(taskId) {
  return supabase
    .from('automation_task_events')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
}
