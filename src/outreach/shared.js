// Small pure helpers shared across the outreach module - no Supabase, no
// React, so every file here stays trivially unit-testable and safe to reuse
// from both the browser hook and scripts/ checks.

export function hasUsableText(value) {
  return Boolean(value && String(value).trim())
}

export function hoursBetween(fromIso, toDate) {
  const from = new Date(fromIso).getTime()
  if (Number.isNaN(from)) return null
  return (toDate.getTime() - from) / (1000 * 60 * 60)
}

export function firstName(fullName) {
  if (!hasUsableText(fullName)) return null
  const trimmed = fullName.trim()
  return trimmed.split(/\s+/)[0] || null
}
