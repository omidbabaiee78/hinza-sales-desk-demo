// Daily Manual Outreach: pure helpers for the «تماس دستی روزانه» page.
// The list itself is built in Postgres (private.manual_outreach_fill); the
// browser only shows it and ticks rows. Nothing here sends a message.

export const MANUAL_DAILY_LIMIT = 20

// +989121234567 -> 09121234567 (how the number is dialled / pasted in Iran).
export function displayPhone(e164) {
  const value = String(e164 || '')
  return value.startsWith('+98') ? `0${value.slice(3)}` : value
}

// Best qualification row of a lead: highest overall_score among the
// prospect_candidates it was promoted from (imported leads have none).
export function bestCandidateByLead(candidates) {
  const map = new Map()
  for (const c of candidates || []) {
    if (!c.promoted_lead_id) continue
    const prev = map.get(c.promoted_lead_id)
    if (!prev || (c.overall_score ?? -1) > (prev.overall_score ?? -1)) map.set(c.promoted_lead_id, c)
  }
  return map
}

// Pending first (list order), then the completed ones (latest first).
export function splitManualRows(rows) {
  const pending = rows.filter((r) => r.status !== 'contacted')
  const done = rows
    .filter((r) => r.status === 'contacted')
    .sort((a, b) => String(b.contacted_at || '').localeCompare(String(a.contacted_at || '')))
  return { pending, done, total: rows.length, contacted: done.length }
}

export function applyContacted(rows, id, contacted, at = new Date().toISOString()) {
  return rows.map((r) =>
    r.id === id ? { ...r, status: contacted ? 'contacted' : 'pending', contacted_at: contacted ? r.contacted_at || at : null } : r,
  )
}
