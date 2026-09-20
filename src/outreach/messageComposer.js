import { BRAND_NAME_FA } from '../constants/brand.js'
import { firstName, hasUsableText } from './shared.js'

// ---------------------------------------------------------------------------
// MESSAGE COMPOSER - writes text ONLY. Every decision about WHO to contact,
// WHY, WHEN and which CHANNEL already happened in eligibility.js /
// channelSelection.js / contactWindow.js before this is ever called; this
// module never re-derives or overrides any of that.
//
// Fully deterministic (same lead + purpose -> same draft) and grounded only
// in data actually on the lead record - never a price, discount, stock
// level, delivery promise, technical spec, or product the lead didn't
// mention. Phase 20/21 can swap this implementation for an AI-generated
// draft without any caller needing to change, as long as it keeps this same
// composeOutreachMessage(purpose, context) -> string shape.
// ---------------------------------------------------------------------------

function greeting(contactName) {
  const name = firstName(contactName)
  return name ? `سلام ${name} عزیز،` : 'سلام وقت بخیر،'
}

function productSummaryText(productNames) {
  const names = (productNames || []).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= 2) return names.join(' و ')
  return `${names.slice(0, 2).join('، ')} و چند محصول دیگر`
}

function selectVariant(variants, ctx) {
  const match = variants.find((variant) => variant.when(ctx))
  return (match || variants[variants.length - 1]).build(ctx)
}

const TEMPLATES = {
  lead_first_contact: [
    {
      when: (ctx) => Boolean(ctx.productSummary),
      build: (ctx) =>
        `${greeting(ctx.contactName)} از ${BRAND_NAME_FA} مزاحم می‌شم. متوجه شدم برای ${ctx.productSummary} نیاز دارید؛ در همین زمینه فعالیت داریم و خوشحال می‌شم بررسی کنم.`,
    },
    {
      when: (ctx) => Boolean(ctx.industry),
      build: (ctx) =>
        `${greeting(ctx.contactName)} از ${BRAND_NAME_FA} مزاحم می‌شم. با توجه به فعالیت مجموعه شما در حوزه ${ctx.industry}، در زمینه تأمین مستربچ و مواد پلیمری فعالیت داریم. اگر محصول خاصی مدنظرتون هست خوشحال می‌شم بررسی کنم.`,
    },
    {
      when: () => true,
      build: () =>
        'سلام وقت بخیر، از هینزا پلیمر مزاحم می‌شم. در زمینه تأمین مستربچ و مواد پلیمری فعالیت داریم. اگر در حال حاضر برای مجموعه شما محصول خاصی مورد نیاز هست خوشحال می‌شم بررسی کنم.',
    },
  ],

  lead_followup: [
    {
      when: (ctx) => Boolean(ctx.productSummary),
      build: (ctx) =>
        `${greeting(ctx.contactName)} در ادامه صحبت قبلی، خواستم ببینم برای تأمین ${ctx.productSummary} موردی هست که بتونیم بررسی کنیم؟`,
    },
    {
      when: () => true,
      build: (ctx) =>
        `${greeting(ctx.contactName)} در ادامه صحبت قبلی خواستم ببینم برای تأمین مواد مورد نیاز مجموعه‌تون موردی هست که بتونیم بررسی کنیم؟`,
    },
  ],
}

const PURPOSE_TEMPLATE_KEY = {
  lead_first_contact: 'lead_first_contact',
  lead_followup_due: 'lead_followup',
  lead_followup_overdue: 'lead_followup',
}

function buildContext(lead, productNames) {
  return {
    contactName: lead?.contact_name || null,
    companyName: lead?.company_name || null,
    industry: hasUsableText(lead?.industry) ? lead.industry : null,
    city: hasUsableText(lead?.city) ? lead.city : null,
    productSummary: productSummaryText(productNames),
  }
}

// Returns null for an unrecognized purpose - callers only ever pass one of
// the three lead task types the Outreach Hub consumes.
export function composeOutreachMessage(purpose, { lead, productNames } = {}) {
  const templateKey = PURPOSE_TEMPLATE_KEY[purpose]
  const variants = TEMPLATES[templateKey]
  if (!variants) return null
  return selectVariant(variants, buildContext(lead, productNames))
}

const SUBJECT_BY_PURPOSE = {
  lead_first_contact: () => `معرفی ${BRAND_NAME_FA}`,
  lead_followup_due: (lead) => `پیگیری همکاری با ${BRAND_NAME_FA}${lead?.company_name ? ` - ${lead.company_name}` : ''}`,
  lead_followup_overdue: (lead) => `پیگیری همکاری با ${BRAND_NAME_FA}${lead?.company_name ? ` - ${lead.company_name}` : ''}`,
}

// Email-only - other channels have no subject line.
export function composeOutreachSubject(purpose, { lead } = {}) {
  const build = SUBJECT_BY_PURPOSE[purpose]
  return build ? build(lead) : `پیام از ${BRAND_NAME_FA}`
}
