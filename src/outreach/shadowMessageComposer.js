import { BRAND_NAME_FA } from '../constants/brand.js'
import { TARGET_INDUSTRIES } from '../prospecting/industryTaxonomy.js'
import { firstName, hasUsableText } from './shared.js'

// ---------------------------------------------------------------------------
// Phase 25 SHADOW MODE message composer - writes text ONLY, exactly like
// messageComposer.js (which this deliberately does not touch, to keep the
// existing generic-lead Outreach Hub behavior unchanged). Every eligibility/
// priority/channel/timing decision already happened in
// prospectingShadow.js/eligibility.js before this is ever called.
//
// Grounded ONLY in evidence actually attached to the candidate this lead was
// promoted from (matched product-fit categories, matched target-industry
// labels) - never a price, stock level, delivery promise, or a claim the
// lead needs anything specific. When evidence is thin, the copy stays
// deliberately hedged ("ممکن است ... مرتبط باشد"), never asserts a confirmed
// need ("می‌دانیم که ... نیاز دارید"), and never claims prior contact.
//
// Phase 25 quality fix - CUSTOMER-FACING NORMALIZATION LAYER: this composer
// never accepts or interpolates a raw source/adapter taxonomy string (an OSM
// tag value like "works"/"industrial"/"yes", a scraped directory field, an
// admin-pasted free-text column, etc). The ONLY industry text it can ever
// put in front of a customer is a `label` from the curated
// TARGET_INDUSTRIES taxonomy (src/prospecting/industryTaxonomy.js) - the
// exact same taxonomy qualification/scoring already uses, so a label only
// ever appears here when REAL textual evidence (an actual industry_keyword
// match, never the separate, much weaker industry_guess/query_or_label_hint
// signal) already supports it (see shadowPipeline.js, which derives
// `industryLabels` from matchedIndustryKeys(evidence) - never from
// candidate.industry_guess/lead.industry directly). sanitizeIndustryLabels
// below is the defense-in-depth backstop: even if a future caller passed
// something else by mistake, anything not in the curated label set is
// silently dropped, never shown to a customer, and never replaced with an
// invented guess.
// ---------------------------------------------------------------------------

const KNOWN_INDUSTRY_LABELS = new Set(TARGET_INDUSTRIES.map((i) => i.label))

// Filters a list of candidate industry labels down to ONLY ones that are
// real entries in the curated TARGET_INDUSTRIES taxonomy. This is a general
// allowlist, not a blocklist of specific bad strings ("works" is never
// mentioned here) - anything not explicitly recognized as a genuine,
// Hinza-relevant industry is omitted, never passed through raw and never
// swapped for a guess.
export function sanitizeIndustryLabelsForCustomerFacing(labels) {
  return (labels || []).filter((label) => hasUsableText(label) && KNOWN_INDUSTRY_LABELS.has(label))
}

function greeting(contactName) {
  const name = firstName(contactName)
  return name ? `سلام ${name} عزیز،` : 'سلام وقت بخیر،'
}

function productFitSentence(products) {
  const list = (products || []).filter(Boolean)
  if (list.length === 0) return null
  const joined = list.length <= 2 ? list.join(' و ') : `${list.slice(0, 2).join('، ')} و چند محصول دیگر`
  return `با توجه به فعالیت مجموعه شما، ${joined} ممکن است برای شما مرتبط باشد.`
}

function industrySentence(sanitizedLabels) {
  const list = sanitizedLabels.filter(Boolean)
  if (list.length === 0) return null
  const joined = list.length <= 2 ? list.join(' و ') : `${list.slice(0, 2).join('، ')} و زمینه‌های مرتبط دیگر`
  return `با توجه به فعالیت مجموعه شما در حوزه ${joined}، ممکن است همکاری در زمینه مستربچ و مواد پلیمری برایتان مرتبط باشد.`
}

// Returns the composed Persian message text (never null - always has a safe
// generic fallback) plus which evidence, if any, it actually used, so the
// caller can store an honest snapshot of what grounded this specific draft.
// `industryLabels` MUST already be TARGET_INDUSTRIES.label values (see the
// file header) - never a raw source/adapter string.
export function composeShadowOutreachMessage({ lead, industryLabels, productFitProducts }) {
  const parts = [greeting(lead?.contact_name)]
  parts.push(`از طرف ${BRAND_NAME_FA} مزاحم می‌شوم.`)

  const safeIndustryLabels = sanitizeIndustryLabelsForCustomerFacing(industryLabels)
  const productSentence = productFitSentence(productFitProducts)
  const industrySentenceText = !productSentence ? industrySentence(safeIndustryLabels) : null
  const usedEvidence = productSentence ? 'product_fit' : industrySentenceText ? 'industry_taxonomy_match' : 'none'

  if (productSentence) {
    parts.push(productSentence)
  } else if (industrySentenceText) {
    parts.push(industrySentenceText)
  } else {
    parts.push('در زمینه تأمین مستربچ و مواد پلیمری فعالیت داریم و ممکن است برای مجموعه شما مرتبط باشد.')
  }

  parts.push('اگر در حال حاضر نیازی در این زمینه دارید، خوشحال می‌شوم بررسی کنم.')

  return { message: parts.join(' '), evidenceUsed: usedEvidence }
}

export function composeShadowOutreachSubject(lead) {
  return `معرفی ${BRAND_NAME_FA}${lead?.company_name ? ` - ${lead.company_name}` : ''}`
}
