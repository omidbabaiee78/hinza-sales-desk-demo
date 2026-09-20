import { SCORING_CONFIG } from './scoringConfig.js'
import { matchedIndustryKeys } from './evidenceEngine.js'
import { isValidIranMobile } from '../utils/phone.js'

// ---------------------------------------------------------------------------
// EVIDENCE + CONTACT DATA -> relevance/contact-quality/overall scores +
// confidence + a Persian explanation. Every number here traces back to
// SCORING_CONFIG - never a magic literal inline, so the whole model can be
// tuned in one file without touching the pipeline or UI.
// ---------------------------------------------------------------------------

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

const INDUSTRY_EVIDENCE_TYPES = new Set(['industry_keyword', 'generic_manufacturing_signal'])

export function computeRelevanceScore(evidence) {
  const cfg = SCORING_CONFIG
  const industryContribution = clamp(
    evidence.filter((e) => INDUSTRY_EVIDENCE_TYPES.has(e.evidenceType)).reduce((sum, e) => sum + e.weight, 0),
    0,
    cfg.maxIndustryContribution,
  )
  const otherContribution = evidence
    .filter((e) => !INDUSTRY_EVIDENCE_TYPES.has(e.evidenceType))
    .reduce((sum, e) => sum + e.weight, 0)
  return clamp(Math.round(cfg.baseRelevanceScore + industryContribution + otherContribution), cfg.minScore, cfg.maxScore)
}

export function computeContactQualityScore(candidate) {
  const cfg = SCORING_CONFIG.contactQuality
  let score = 0
  if (candidate.mobile && isValidIranMobile(candidate.mobile)) score += cfg.validMobile
  if (candidate.phone) score += cfg.validPhone
  if (candidate.email) score += cfg.validEmail
  if (candidate.website) score += cfg.hasWebsite
  if (candidate.city || candidate.address) score += cfg.hasLocation
  return clamp(score, 0, 100)
}

export function computeOverallScore(relevanceScore, contactQualityScore) {
  const w = SCORING_CONFIG.overallWeights
  return clamp(Math.round(relevanceScore * w.relevance + contactQualityScore * w.contactQuality), 0, 100)
}

// Confidence is never higher than the evidence actually supports - zero
// distinct matched industries can never be "high", and any negative signal
// caps it at "low" regardless of score.
export function computeConfidence({ overallScore, evidence }) {
  const industryCount = matchedIndustryKeys(evidence).length
  const hasGenericSignal = evidence.some((e) => e.evidenceType === 'generic_manufacturing_signal')
  const hasNegative = evidence.some((e) => e.evidenceType === 'negative_signal')
  // A generic (name-only) manufacturing signal is real evidence - enough to
  // avoid the forced "manual_review, no evidence at all" floor - but it can
  // never alone reach "high" (that still requires >=2 SPECIFIC matched
  // industries, checked below).
  if (industryCount === 0 && !hasGenericSignal) return 'manual_review'
  if (hasNegative) return 'low'

  const cfg = SCORING_CONFIG.confidence
  const hasCompetitorCaution = evidence.some((e) => e.evidenceType === 'possible_competitor_supplier')
  if (overallScore >= cfg.highMinScore && industryCount >= cfg.highMinIndustryMatches && !hasCompetitorCaution) return 'high'
  if (overallScore >= cfg.mediumMinScore) return 'medium'
  return 'low'
}

function industryLabelsFrom(evidence) {
  return [...new Set(evidence.filter((e) => e.evidenceType === 'industry_keyword').map((e) => e.value.split(' — ')[0]))]
}

// Persian, non-technical - never prints a raw score/weight, only what was
// actually found.
export function buildReasonFa(evidence) {
  const parts = []
  const industryLabels = industryLabelsFrom(evidence)
  if (industryLabels.length > 0) parts.push(`فعالیت احتمالی در حوزه ${industryLabels.join('، ')}`)
  else if (evidence.some((e) => e.evidenceType === 'generic_manufacturing_signal')) {
    parts.push('نام کسب‌وکار به تولید مواد پلیمری اشاره دارد (بدون جزئیات دقیق‌تر)')
  }
  if (evidence.some((e) => e.evidenceType === 'active_website')) parts.push('وب‌سایت فعال دارد')
  if (evidence.some((e) => e.evidenceType === 'factory_address')) parts.push('آدرس کارخانه/محل فعالیت ثبت شده است')
  if (evidence.some((e) => e.evidenceType === 'industrial_phone' || e.evidenceType === 'mobile_contact')) {
    parts.push('اطلاعات تماس معتبر یافت شده')
  }
  if (evidence.some((e) => e.evidenceType === 'possible_competitor_supplier')) {
    parts.push('احتمال فعالیت به‌عنوان تولیدکننده/رقیب مستربچ - نیازمند بررسی دستی')
  }
  if (evidence.some((e) => e.evidenceType === 'negative_signal')) {
    parts.push('نشانه‌هایی از خرده‌فروشی یا فعالیت غیرمرتبط نیز یافت شده')
  }
  if (parts.length === 0) return 'شواهد کافی برای تشخیص یافت نشد - نیازمند بررسی دستی.'
  return `${parts.join('، ')}.`
}

// Single entry point the pipeline calls - bundles every score + the
// explanation together so callers never recompute pieces inconsistently.
export function scoreCandidate(candidate, evidence) {
  const relevanceScore = computeRelevanceScore(evidence)
  const contactQualityScore = computeContactQualityScore(candidate)
  const overallScore = computeOverallScore(relevanceScore, contactQualityScore)
  const confidence = computeConfidence({ overallScore, evidence })
  const reasonFa = buildReasonFa(evidence)
  return { relevanceScore, contactQualityScore, overallScore, confidence, reasonFa }
}
