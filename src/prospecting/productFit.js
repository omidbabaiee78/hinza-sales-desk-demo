import { TARGET_INDUSTRIES } from './industryTaxonomy.js'
import { matchedIndustryKeys } from './evidenceEngine.js'

// ---------------------------------------------------------------------------
// Evidence -> a CAUTIOUS product-fit suggestion. Never claims a confirmed
// need ("این مشتری حتماً محصول X می‌خواهد") - only a possibility, always
// worded that way, and always empty when there's no supporting evidence
// rather than guessing a default.
// ---------------------------------------------------------------------------

export function suggestProductFit(evidence) {
  const keys = matchedIndustryKeys(evidence)
  if (keys.length === 0) {
    return { products: [], noteFa: 'شواهد کافی برای برآورد محصول مرتبط یافت نشد.' }
  }
  const products = [...new Set(keys.flatMap((key) => TARGET_INDUSTRIES.find((i) => i.key === key)?.productFit || []))]
  if (products.length === 0) {
    return { products: [], noteFa: 'صنعت شناسایی شد اما محصول بالقوه مشخصی برای آن تعریف نشده است.' }
  }
  return {
    products,
    noteFa: `محصولات بالقوه مرتبط (احتمال نیاز): ${products.join('، ')}. این فقط یک برآورد بر اساس صنعت است، نه تأیید نیاز قطعی مشتری.`,
  }
}
