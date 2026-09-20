import { serializeLeadForCreate } from '../services/leadPayload.js'
import { mapScoreToPriority } from './qualification.js'
import { suggestProductFit } from './productFit.js'

// ---------------------------------------------------------------------------
// A qualified prospect_candidates row -> a real sales_leads insert payload.
// Reuses the EXISTING serializeLeadForCreate (services/leadPayload.js) so a
// promoted candidate is written with exactly the same enum-safety
// guarantees as a manually-created or imported lead - never a second
// write path into sales_leads.
// ---------------------------------------------------------------------------

export function buildLeadFieldsFromCandidate(candidate, evidence, { sourceName } = {}) {
  const { noteFa } = suggestProductFit(evidence)
  const priority = mapScoreToPriority(candidate.overall_score || 0)

  const notesParts = [
    `ایجاد شده توسط موتور کشف مشتری خودکار — امتیاز کلی: ${candidate.overall_score ?? '—'} (اطمینان: ${candidate.confidence || '—'}).`,
    candidate.qualification_reason || null,
    sourceName ? `منبع کشف: ${sourceName}` : null,
    candidate.source_url ? `آدرس منبع: ${candidate.source_url}` : null,
  ].filter(Boolean)

  return {
    company_name: candidate.canonical_name,
    contact_name: null,
    mobile: candidate.mobile,
    phone: candidate.phone,
    email: candidate.email,
    website: candidate.website,
    province: candidate.province,
    city: candidate.city,
    address: candidate.address,
    industry: candidate.industry_guess,
    // sales_leads.source has no "autonomous discovery" enum value of its
    // own (see utils/leadStatus.js LEAD_SOURCES) - real provenance is
    // preserved in tags/notes/external_ref instead of inventing a new
    // source value that would need its own migration.
    source: 'other',
    priority,
    need_note: noteFa,
    notes: notesParts.join(' '),
    preferred_channel: null,
    external_ref: candidate.source_url || candidate.id,
    tags: ['prospecting', sourceName ? `منبع:${sourceName}` : null].filter(Boolean),
  }
}

export function serializePromotedLead(candidate, evidence, { createdBy, sourceName } = {}) {
  return serializeLeadForCreate(buildLeadFieldsFromCandidate(candidate, evidence, { sourceName }), {
    createdBy,
    importBatchId: null,
  })
}
