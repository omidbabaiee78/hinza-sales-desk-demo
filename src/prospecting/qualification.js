// ---------------------------------------------------------------------------
// Scores + evidence -> a candidate status decision, plus whether it is
// eligible for AUTOMATIC promotion. Deterministic thresholds only - this is
// exactly the kind of decision the spec reserves for deterministic checks,
// never an AI call (see Phase 23 spec section 26 "AI readiness").
//
// "Do not reject solely because data is incomplete" - a candidate with no
// matched industry AND too little text to judge goes to manual_review, not
// rejected; only a candidate with enough text and genuinely no relevant
// evidence (or a strong negative signal) is rejected outright.
// ---------------------------------------------------------------------------

const MIN_TEXT_LENGTH_TO_JUDGE = 20
const STRONG_NEGATIVE_WEIGHT_THRESHOLD = -25

export function qualifyCandidate({ candidate, evidence, scores, settings }) {
  const hasIndustryEvidence = evidence.some(
    (e) => e.evidenceType === 'industry_keyword' || e.evidenceType === 'generic_manufacturing_signal',
  )
  const hasStrongNegative = evidence.some((e) => e.evidenceType === 'negative_signal' && e.weight <= STRONG_NEGATIVE_WEIGHT_THRESHOLD)
  // A directory-sourced candidate may have nothing but a name (no
  // description at all) - judging "is there enough to go on" purely from
  // business_description would wrongly call every such record "incomplete."
  const textLength = `${candidate.business_description || ''} ${candidate.raw_name || ''}`.trim().length
  const hasUsableContact = Boolean(candidate.mobile || candidate.phone || candidate.email)

  if (hasStrongNegative && !hasIndustryEvidence) {
    return {
      status: 'rejected',
      reason: 'این کسب‌وکار بیشتر شبیه خرده‌فروشی یا فعالیتی غیرمرتبط است و شواهدی از تولید صنعتی پلیمر یافت نشد.',
      autoPromotable: false,
    }
  }

  if (!hasIndustryEvidence) {
    if (textLength < MIN_TEXT_LENGTH_TO_JUDGE) {
      return {
        status: 'manual_review',
        reason: 'اطلاعات موجود برای تشخیص کافی نیست - نیازمند بررسی دستی.',
        autoPromotable: false,
      }
    }
    return {
      status: 'rejected',
      reason: 'شواهدی از تولید یا فرآوری مواد پلیمری یافت نشد.',
      autoPromotable: false,
    }
  }

  const meetsAutoScore = scores.overallScore >= (settings?.min_score_auto_promote ?? 80)
  const requiredConfidence = settings?.min_confidence_auto_promote ?? 'high'
  const meetsAutoConfidence =
    requiredConfidence === 'medium' ? scores.confidence === 'high' || scores.confidence === 'medium' : scores.confidence === 'high'

  if (meetsAutoScore && meetsAutoConfidence && hasUsableContact) {
    return { status: 'qualified', reason: scores.reasonFa, autoPromotable: true }
  }

  if (scores.overallScore >= (settings?.min_score_manual_review ?? 50)) {
    return { status: 'manual_review', reason: scores.reasonFa, autoPromotable: false }
  }

  // Weak-but-viable ("low confidence") is retained for a human to see, not
  // silently dropped - per spec, it must not auto-promote, but it should
  // still surface somewhere an admin can find it.
  return {
    status: 'manual_review',
    reason: `${scores.reasonFa} امتیاز نسبتاً پایین است - بررسی دستی توصیه می‌شود.`,
    autoPromotable: false,
  }
}

// Maps a qualified candidate's score onto the EXISTING sales_leads priority
// vocabulary (low/medium/high, see utils/leadStatus.js) - never a second,
// competing priority system.
export function mapScoreToPriority(overallScore) {
  if (overallScore >= 80) return 'high'
  if (overallScore >= 55) return 'medium'
  return 'low'
}
