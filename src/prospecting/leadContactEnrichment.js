import { lookupCompanyEmail, resolveOfficialWebsite, EMAIL_LOOKUP_REASONS } from '../outreach/emailDiscovery.js'
import { firstMobile, normalizeMobile } from '../outreach/contactPoints.js'
import { normalizeEmail } from './normalization.js'
import { splitContactDisplay, joinContactDisplay } from '../utils/leadImport/contactNumbers.js'
import { normalizeDigits } from '../utils/leadImport/digits.js'
import { hasUsableText } from '../outreach/shared.js'

// ---------------------------------------------------------------------------
// Contact enrichment for REGISTERED leads (sales_leads) - discovered,
// imported, uploaded or entered by hand alike. Reads the company's own
// website (the lead's, or its discovery candidate's) with the same lookup,
// identity rules and page limits as the email lookup, now also collecting
// the phone numbers the site publishes (emailDiscovery.js extractPhones).
//
// Only EMPTY fields are filled - an admin-entered email/mobile/phone is
// never replaced - and a value already on another lead is never attached
// (it would tie two companies to one contact). Every added value keeps its
// source page: email_source_url / phone_source_url. Leads whose recorded
// website is not their own (a PDF, news or directory page) are left to the
// official-site search (leadSiteSearch.js), which uses paid web search and
// has its own small per-run budget.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000
const MAX_NUMBERS_PER_FIELD = 2

function landlineDigits(value) {
  const digits = normalizeDigits(String(value || '')).replace(/\D/g, '')
  return digits.length >= 10 ? digits : null
}

// Every email/mobile/landline already on some lead -> that lead's id.
export function takenContacts(leads) {
  const emails = new Map()
  const mobiles = new Map()
  const landlines = new Map()
  for (const lead of leads) {
    const email = normalizeEmail(lead.email)
    if (email && !emails.has(email)) emails.set(email, lead.id)
    for (const raw of [...splitContactDisplay(lead.mobile), ...splitContactDisplay(lead.phone)]) {
      const mobile = normalizeMobile(raw)
      if (mobile) {
        if (!mobiles.has(mobile)) mobiles.set(mobile, lead.id)
        continue
      }
      const landline = landlineDigits(raw)
      if (landline && !landlines.has(landline)) landlines.set(landline, lead.id)
    }
  }
  return { emails, mobiles, landlines }
}

const free = (map, key, leadId) => !map.has(key) || map.get(key) === leadId

// The sales_leads update for one lookup result, or null when nothing new
// was found. Marks what it adds as taken, so two leads in the same run
// never receive the same contact.
export function contactPatchFor(lead, result, taken, now = new Date()) {
  const patch = {}
  const added = []
  let phoneSource = null

  const email = normalizeEmail(result.email)
  if (!hasUsableText(lead.email) && email && free(taken.emails, email, lead.id)) {
    Object.assign(patch, {
      email,
      email_source_url: result.sourceUrl,
      email_lookup_status: 'found',
      email_lookup_reason: EMAIL_LOOKUP_REASONS.found,
      email_lookup_at: now.toISOString(),
    })
    taken.emails.set(email, lead.id)
    added.push('email')
  }

  if (!hasUsableText(lead.mobile) && !firstMobile(lead)) {
    const picked = (result.mobiles || []).filter((m) => free(taken.mobiles, normalizeMobile(m.number), lead.id)).slice(0, MAX_NUMBERS_PER_FIELD)
    if (picked.length > 0) {
      patch.mobile = joinContactDisplay(picked.map((m) => m.number))
      phoneSource = picked[0].sourceUrl
      for (const m of picked) taken.mobiles.set(normalizeMobile(m.number), lead.id)
      added.push('mobile')
    }
  }

  if (!hasUsableText(lead.phone)) {
    const picked = (result.landlines || []).filter((l) => free(taken.landlines, l.number, lead.id)).slice(0, MAX_NUMBERS_PER_FIELD)
    if (picked.length > 0) {
      patch.phone = joinContactDisplay(picked.map((l) => l.number))
      phoneSource = phoneSource || picked[0].sourceUrl
      for (const l of picked) taken.landlines.set(l.number, lead.id)
      added.push('phone')
    }
  }
  if (phoneSource) patch.phone_source_url = phoneSource
  const sources = contactSourcesFor({ ...lead, ...patch }, result)
  if (sources) patch.contact_sources = sources
  return added.length > 0 || sources ? { patch, added } : null
}

function sameSource(a, b) {
  return a.field === b.field && a.value === b.value && a.sourceUrl === b.sourceUrl
}

// Per contact on the lead (after the patch): the page of its own website
// that publishes it - for added values AND for values the lead already had
// that the site confirms. -> the merged contact_sources list, or null when
// nothing changed. [{ field: 'email'|'mobile'|'phone', value, sourceUrl }]
export function contactSourcesFor(lead, result) {
  const found = []
  const email = normalizeEmail(lead.email)
  if (email && normalizeEmail(result.email) === email && result.sourceUrl) found.push({ field: 'email', value: email, sourceUrl: result.sourceUrl })
  const onSite = new Map([...(result.mobiles || []).map((m) => [normalizeMobile(m.number), m.sourceUrl])])
  for (const raw of splitContactDisplay(lead.mobile)) {
    const key = normalizeMobile(raw)
    if (key && onSite.has(key)) found.push({ field: 'mobile', value: raw, sourceUrl: onSite.get(key) })
  }
  const landlinesOnSite = new Map((result.landlines || []).map((l) => [l.number, l.sourceUrl]))
  for (const raw of splitContactDisplay(lead.phone)) {
    const key = landlineDigits(raw)
    if (key && landlinesOnSite.has(key)) found.push({ field: 'phone', value: raw, sourceUrl: landlinesOnSite.get(key) })
  }
  const existing = Array.isArray(lead.contact_sources) ? lead.contact_sources : []
  const merged = [...existing]
  for (const s of found) if (!merged.some((e) => sameSource(e, s))) merged.push(s)
  return merged.length > existing.length ? merged : null
}

// Which leads the site-based enrichment should read now: missing an email
// or a mobile (or never source-checked), reachable through a website that could be the company's own,
// and not checked in the last 30 days (a site that failed to load: after a
// day). Leads with nothing at all come first, then the newest.
export function leadsDueForContactEnrichment(leads, candidateByLead = new Map(), now = new Date()) {
  const due = leads.filter((lead) => {
    if (lead.do_not_contact || lead.status === 'converted' || lead.status === 'lost') return false
    // Complete leads are read once too, to record where their contacts are
    // published (contact_sources); after that, only incomplete ones.
    const complete = normalizeEmail(lead.email) && firstMobile(lead)
    if (complete && Array.isArray(lead.contact_sources) && lead.contact_sources.length > 0) return false
    const candidate = candidateByLead.get(lead.id)
    if (!resolveOfficialWebsite([lead.website, candidate?.website]).ok) return false
    if (!lead.contact_lookup_at) return true
    const age = now.getTime() - new Date(lead.contact_lookup_at).getTime()
    return lead.contact_lookup_status === 'fetch_failed' ? age >= DAY : age >= 30 * DAY
  })
  const nothing = (l) => (normalizeEmail(l.email) || firstMobile(l) || hasUsableText(l.phone) ? 1 : 0)
  due.sort((a, b) => nothing(a) - nothing(b) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return due
}

// Reads due leads' websites and fills in what they publish. Bounded by
// maxLeads and the deadline. -> summary counts.
export async function enrichLeadContacts(client, { deadline, maxLeads, fetchPage = null, concurrency = 4, now = new Date() }) {
  const summary = { due: 0, checked: 0, updated: 0, emailsAdded: 0, mobilesAdded: 0, phonesAdded: 0, sourcesRecorded: 0, byStatus: {}, errors: 0 }
  if (maxLeads <= 0) return summary
  const [leadsRes, candidatesRes] = await Promise.all([client.from('sales_leads').select('*'), client.from('prospect_candidates').select('promoted_lead_id, website')])
  if (leadsRes.error) throw leadsRes.error
  if (candidatesRes.error) throw candidatesRes.error
  const leads = leadsRes.data || []
  const candidateByLead = new Map((candidatesRes.data || []).filter((c) => c.promoted_lead_id).map((c) => [c.promoted_lead_id, c]))
  const due = leadsDueForContactEnrichment(leads, candidateByLead, now)
  summary.due = due.length
  const taken = takenContacts(leads)

  async function handle(lead) {
    const candidate = candidateByLead.get(lead.id)
    const result = await lookupCompanyEmail({
      websites: [lead.website, candidate?.website],
      companyName: lead.company_name || lead.contact_name,
      discoveredOn: candidate?.website || null,
      collectPhones: true,
      ...(fetchPage ? { fetchPage } : {}),
    })
    summary.checked += 1
    const found = contactPatchFor(lead, result, taken, now)
    const added = found?.added || []
    const status = added.length > 0 ? 'found' : found ? 'confirmed' : result.status === 'found' ? 'nothing_new' : result.status
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1
    const patch = { ...(found?.patch || {}), contact_lookup_status: status, contact_lookup_at: now.toISOString() }
    const { error } = await client.from('sales_leads').update(patch).eq('id', lead.id)
    if (error) throw error
    if (found?.patch.contact_sources) summary.sourcesRecorded += 1
    if (added.length > 0) {
      summary.updated += 1
      if (found.added.includes('email')) summary.emailsAdded += 1
      if (found.added.includes('mobile')) summary.mobilesAdded += 1
      if (found.added.includes('phone')) summary.phonesAdded += 1
    }
  }

  const batch = due.slice(0, maxLeads)
  for (let i = 0; i < batch.length; i += concurrency) {
    if (Date.now() >= deadline) break
    await Promise.all(
      batch.slice(i, i + concurrency).map((lead) =>
        handle(lead).catch(() => {
          summary.errors += 1
        }),
      ),
    )
  }
  return summary
}
