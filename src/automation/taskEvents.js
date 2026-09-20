// Audit-log I/O for automation_task_events. No Supabase client is imported
// here - every function takes one as its first argument, so the exact same
// code runs against the browser's authenticated client (frontend) or a
// server-side service-role client (Edge Function), never two copies of this
// logic. See automation/taskService.js for the equivalent pattern.

async function currentUserId(client) {
  // A server-side (service-role) client has no user session - getUser()
  // can reject in that case. Every server-triggered event write already
  // passes an explicit actorUserId (see taskService.applyReconciliationPlan),
  // so this fallback only ever really resolves for the browser; on any
  // failure it degrades to `null` (system actor) rather than throwing.
  try {
    const {
      data: { user },
    } = await client.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

// One insert per event - never batched into a single opaque row, and never
// written "just because reconciliation ran" (see reconciler.js: this is
// only called for an ACTUAL transition, keeping the audit log meaningful
// instead of noisy).
export async function logTaskEvent(client, taskId, eventType, { message, metadata, actorUserId } = {}) {
  const actor = actorUserId !== undefined ? actorUserId : await currentUserId(client)
  const { error } = await client.from('automation_task_events').insert({
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
export async function logTaskEventsBatch(client, events) {
  if (events.length === 0) return
  // The reconciliation path always sets actorUserId explicitly (null, the
  // system actor) on every event it logs, so currentUserId() is only ever
  // actually needed for admin-action events that omit it - never call
  // auth.getUser() when nothing in the batch needs it.
  const needsActor = events.some((e) => e.actorUserId === undefined)
  const actor = needsActor ? await currentUserId(client) : null
  const rows = events.map((e) => ({
    task_id: e.taskId,
    event_type: e.eventType,
    message: e.message || null,
    metadata: e.metadata || {},
    actor_user_id: e.actorUserId !== undefined ? e.actorUserId : actor,
  }))
  const { error } = await client.from('automation_task_events').insert(rows)
  if (error) throw error
}

export function fetchTaskEvents(client, taskId) {
  return client
    .from('automation_task_events')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
}
