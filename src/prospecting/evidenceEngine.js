import { normalizeSearchText } from './normalization.js'
import {
  TARGET_INDUSTRIES,
  COMPETITOR_SUPPLIER_KEYWORDS,
  NEGATIVE_SIGNALS,
  MANUFACTURING_INDICATOR_TERMS,
  GENERIC_POLYMER_TERMS,
  findMatchingKeywords,
} from './industryTaxonomy.js'

// ---------------------------------------------------------------------------
// RAW CANDIDATE TEXT -> a list of concrete, individually-inspectable
// evidence items. Never a single opaque "relevant: yes/no" - every claim the
// UI later shows the admin traces back to exactly one of these. Purely
// deterministic keyword/field matching for Phase 23 - no external AI call
// (see src/prospecting/README notes in scoringEngine.js for the AI-readiness
// boundary).
// ---------------------------------------------------------------------------

function candidateSearchText(candidate) {
  return normalizeSearchText(
    [candidate.business_description, candidate.industry_guess, candidate.raw_name, candidate.canonical_name]
      .filter(Boolean)
      .join(' '),
  )
}

export function extractEvidence(candidate) {
  const evidence = []
  const text = candidateSearchText(candidate)

  for (const industry of TARGET_INDUSTRIES) {
    const matches = findMatchingKeywords(text, industry.keywords.map((k) => normalizeSearchText(k)))
    for (const match of matches) {
      evidence.push({
        evidenceType: 'industry_keyword',
        value: `${industry.label} — «${match}»`,
        weight: 12,
        confidence: 'medium',
        meta: { industryKey: industry.key },
      })
    }
  }

  // Fallback for terse records with no specific matched industry - a real
  // manufacturer's NAME alone (e.g. a directory listing with no
  // description) often just says "کارخانه پلاستیک X", never one of the
  // more specific TARGET_INDUSTRIES phrases. Only fires when nothing more
  // specific already matched, so it never inflates an already-well-
  // evidenced candidate.
  const hasSpecificIndustryMatch = evidence.some((e) => e.evidenceType === 'industry_keyword')
  if (!hasSpecificIndustryMatch) {
    const manufacturingMatch = findMatchingKeywords(text, MANUFACTURING_INDICATOR_TERMS.map((k) => normalizeSearchText(k)))[0]
    const polymerMatch = findMatchingKeywords(text, GENERIC_POLYMER_TERMS.map((k) => normalizeSearchText(k)))[0]
    if (manufacturingMatch && polymerMatch) {
      evidence.push({
        evidenceType: 'generic_manufacturing_signal',
        value: `نشانه عمومی تولید — «${manufacturingMatch}» + «${polymerMatch}»`,
        weight: 10,
        confidence: 'low',
      })
    }
  }

  const competitorMatches = findMatchingKeywords(text, COMPETITOR_SUPPLIER_KEYWORDS.map((k) => normalizeSearchText(k)))
  for (const match of competitorMatches) {
    evidence.push({
      evidenceType: 'possible_competitor_supplier',
      value: `احتمال تولیدکننده مستربچ/رقیب — «${match}»`,
      weight: -15,
      confidence: 'low',
    })
  }

  for (const signal of NEGATIVE_SIGNALS) {
    const matches = findMatchingKeywords(text, signal.keywords.map((k) => normalizeSearchText(k)))
    for (const match of matches) {
      evidence.push({
        evidenceType: 'negative_signal',
        value: `${signal.label} — «${match}»`,
        weight: signal.weight,
        confidence: 'medium',
        meta: { negativeKey: signal.key },
      })
    }
  }

  if (candidate.website) {
    evidence.push({ evidenceType: 'active_website', value: candidate.website, weight: 8, confidence: 'high', sourceUrl: candidate.website })
  }
  if (candidate.address) {
    evidence.push({ evidenceType: 'factory_address', value: candidate.address, weight: 6, confidence: 'medium' })
  }
  if (candidate.phone) {
    evidence.push({ evidenceType: 'industrial_phone', value: candidate.phone, weight: 4, confidence: 'medium' })
  }
  if (candidate.mobile) {
    evidence.push({ evidenceType: 'mobile_contact', value: candidate.mobile, weight: 3, confidence: 'medium' })
  }
  if (candidate.source_url) {
    evidence.push({ evidenceType: 'source_directory_listing', value: candidate.source_url, weight: 3, confidence: 'low', sourceUrl: candidate.source_url })
  }

  return evidence
}

// Distinct matched TARGET_INDUSTRIES keys for a candidate's evidence list -
// used by productFit.js, never re-derived by re-scanning text a second time.
export function matchedIndustryKeys(evidenceList) {
  return [...new Set(evidenceList.filter((e) => e.evidenceType === 'industry_keyword').map((e) => e.meta?.industryKey).filter(Boolean))]
}
