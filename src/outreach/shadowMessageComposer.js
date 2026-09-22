import { BRAND_NAME_FA } from '../constants/brand.js'
import { firstName, hasUsableText } from './shared.js'

// ---------------------------------------------------------------------------
// Phase 25 SHADOW MODE message composer - writes text ONLY, exactly like
// messageComposer.js (which this deliberately does not touch, to keep the
// existing generic-lead Outreach Hub behavior unchanged). Every eligibility/
// priority/channel/timing decision already happened in
// prospectingShadow.js/eligibility.js before this is ever called.
//
// Grounded ONLY in evidence actually attached to the candidate this lead was
// promoted from (industry_guess, matched product-fit categories) - never a
// price, stock level, delivery promise, or a claim the lead needs anything
// specific. When evidence is thin, the copy stays deliberately hedged
// ("ممکن است ... مرتبط باشد"), never asserts a confirmed need
// ("می‌دانیم که ... نیاز دارید"), and never claims prior contact.
// ---------------------------------------------------------------------------

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

function industrySentence(industry) {
  if (!hasUsableText(industry)) return null
  return `با توجه به فعالیت مجموعه شما در حوزه ${industry}، ممکن است همکاری در زمینه مستربچ و مواد پلیمری برایتان مرتبط باشد.`
}

// Returns the composed Persian message text (never null - always has a safe
// generic fallback) plus which evidence, if any, it actually used, so the
// caller can store an honest snapshot of what grounded this specific draft.
export function composeShadowOutreachMessage({ lead, industryGuess, productFitProducts }) {
  const parts = [greeting(lead?.contact_name)]
  parts.push(`از طرف ${BRAND_NAME_FA} مزاحم می‌شوم.`)

  const productSentence = productFitSentence(productFitProducts)
  const industrySentenceText = !productSentence ? industrySentence(industryGuess) : null
  const usedEvidence = productSentence ? 'product_fit' : industrySentenceText ? 'industry_guess' : 'none'

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
