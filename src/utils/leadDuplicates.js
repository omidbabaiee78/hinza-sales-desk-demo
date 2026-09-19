import { toE164Iran } from './phone'

export function normalizeCompanyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// Deliberately no fuzzy-matching library - a simple normalized-equality or
// substring check catches the common real-world case ("شرکت پلیمر آریا" vs
// "پلیمر آریا") without adding a dependency for this modest a check.
export function companyNamesLikelyMatch(a, b) {
  const na = normalizeCompanyName(a)
  const nb = normalizeCompanyName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))
}

function normalizedPhone(value) {
  return String(value || '').replace(/\D/g, '')
}

// Pure/synchronous - callers already hold the bulk-fetched leads/companies
// arrays (the app's established "fetch small table, filter client-side"
// pattern), so no extra query is issued per keystroke.
export function findLeadDuplicates({ mobile, phone, companyName, excludeLeadId, leads = [], companies = [] }) {
  const mobileE164 = mobile ? toE164Iran(mobile) : ''
  const phoneDigits = phone ? normalizedPhone(phone) : ''

  function phoneMatches(candidateMobile, candidatePhone) {
    const candidateMobileE164 = candidateMobile ? toE164Iran(candidateMobile) : ''
    const candidatePhoneDigits = candidatePhone ? normalizedPhone(candidatePhone) : ''
    if (mobileE164 && candidateMobileE164 && candidateMobileE164 === mobileE164) return true
    if (mobileE164 && candidatePhoneDigits && toE164Iran(candidatePhoneDigits) === mobileE164) return true
    if (phoneDigits && candidatePhoneDigits && candidatePhoneDigits === phoneDigits) return true
    if (phoneDigits && candidateMobileE164 && candidateMobileE164.replace('+', '') === phoneDigits) return true
    return false
  }

  const leadMatches = leads
    .filter((lead) => lead.id !== excludeLeadId)
    .filter(
      (lead) =>
        phoneMatches(lead.mobile, lead.phone) ||
        (companyName && companyNamesLikelyMatch(companyName, lead.company_name)),
    )
    .map((lead) => ({
      type: 'lead',
      id: lead.id,
      label: lead.company_name || lead.contact_name || '—',
      sub: lead.city || '',
      status: lead.status,
    }))

  const companyMatches = companies
    .filter(
      (company) =>
        phoneMatches(null, company.phone) || (companyName && companyNamesLikelyMatch(companyName, company.name)),
    )
    .map((company) => ({
      type: 'company',
      id: company.id,
      label: company.name || '—',
      sub: company.city || '',
    }))

  return [...leadMatches, ...companyMatches]
}
