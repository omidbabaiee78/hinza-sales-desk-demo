// Centralized compatibility resolver for order-status transition timing.
//
// Real order_events data is mixed:
//   canonical: event_type = 'status_changed', metadata->>'to' = <status>
//   legacy:    event_type = <status> directly (e.g. 'quoted', 'rejected')
//
// Every rule that needs "how long has this order been in status X" goes
// through here - never a direct order_events query scattered in a rule,
// and never orders.updated_at as a stand-in for a real transition.
export function buildTransitionTimestampMap(events, targetStatus) {
  const map = new Map()
  for (const event of events) {
    const isCanonical = event.event_type === 'status_changed' && event.metadata?.to === targetStatus
    const isLegacy = event.event_type === targetStatus
    if (!isCanonical && !isLegacy) continue

    const prev = map.get(event.order_id)
    if (!prev || event.created_at > prev) {
      map.set(event.order_id, event.created_at)
    }
  }
  return map
}

// Resolves ONE order's transition timestamp into `targetStatus`.
// - reliable: a matching order_events row was found (canonical or legacy).
// - fallbackUsed: no event at all existed, so `fallbackIso` (typically
//   order.created_at) was used instead - callers MUST downgrade confidence
//   to 'manual_review' when this happens, since the elapsed time is only a
//   rough guess in that case.
export function resolveTransitionTimestamp({ orderId, eventsByStatusMap, fallbackIso }) {
  const found = eventsByStatusMap.get(orderId)
  if (found) return { timestamp: found, reliable: true }
  if (fallbackIso) return { timestamp: fallbackIso, reliable: false }
  return { timestamp: null, reliable: false }
}

export function hoursSince(isoTimestamp, now) {
  if (!isoTimestamp) return null
  const then = new Date(isoTimestamp).getTime()
  if (Number.isNaN(then)) return null
  return (now.getTime() - then) / (1000 * 60 * 60)
}
