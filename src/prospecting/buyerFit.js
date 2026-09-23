// ---------------------------------------------------------------------------
// Phase 23D.2 - Buyer Fit Qualification: a SEPARATE deterministic dimension
// from entity_type. Being a real, direct-website polymer-industry company
// (entity_type=direct_company) is not the same question as "would this
// company actually consume masterbatch/pigments/polymer additives" - a
// trade association, a machinery/production-line vendor, or a research
// institute can all be genuinely direct_company AND genuinely full of
// polymer-industry language, while never themselves being a Hinza buyer.
// Never merged into entity_type (see entityClassification.js) - kept as its
// own field, read back from its own evidence item the same way
// matchedEntityType() reads entity_type back from `direct_company_site`/
// `non_company_content` evidence.
// ---------------------------------------------------------------------------

export const BUYER_FIT = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NOT_BUYER: 'not_buyer',
  UNKNOWN: 'unknown',
}

export const BUYER_FIT_LABELS_FA = {
  high: 'مصرف‌کننده بالقوه قوی مواد پلیمری',
  medium: 'مصرف‌کننده احتمالی (نیازمند بررسی بیشتر)',
  low: 'تناسب کم به‌عنوان مشتری',
  not_buyer: 'غیرمصرف‌کننده مستقیم (انجمن/تامین‌کننده ماشین‌آلات/مرکز پژوهشی و مانند آن)',
  unknown: 'نامشخص',
}

// Polymer-industry-ADJACENT organizations that are never themselves a
// likely masterbatch/pigment/additive consumer, no matter how much
// polymer-industry language their own page uses. Each gets its own evidence
// item (evidenceEngine.js) so the specific reason is always auditable, not
// a single opaque "not a buyer" flag.
export const NON_BUYER_ORG_SIGNALS = [
  {
    key: 'trade_association',
    label: 'انجمن یا تشکل صنفی',
    keywords: ['انجمن'],
  },
  {
    key: 'machinery_supplier',
    // A company selling/building the MACHINES that make film/pipe/etc. is
    // polymer-industry-adjacent but consumes steel and electronics, not
    // masterbatch - the opposite of a processor who buys the machine and
    // then runs raw polymer through it.
    //
    // 23D-FINAL, section J: bare "ماشین آلات" was REMOVED from this list -
    // a real processor legitimately describing its OWN equipment ("تولید
    // قطعات با ماشین تزریق مدرن") must not be misread as a machinery SELLER
    // just because the word "ماشین" appears somewhere. Every multi-word
    // keyword below requires the explicit SELLING/MAKING-FOR-SALE framing
    // ("فروش", "سازنده", "تولیدکننده") applied directly to the machinery/
    // line itself, not just co-occurrence.
    //
    // "FINAL AUTONOMY BLOCKER" round, section 5A: "ماشین سازی" (machine-
    // BUILDING/machine-manufacturing) IS re-added as its own standalone
    // entry - unlike bare "ماشین آلات"/"ماشین" (which any processor
    // mentioning its own equipment could contain), "ماشین سازی" is a
    // specific, conventional Persian company-CATEGORY name (the same
    // "X‌سازی" pattern as "فولادسازی"/"کاشی‌سازی" - a company whose OWN
    // PRODUCT is machines) - a real polymer processor describing its
    // equipment never uses this phrase about itself. A real production
    // example needed exactly this: "ماشین سازی مرتضی امامی سازنده انواع
    // ماشین آلات پلاستیک" - "سازنده ماشین آلات" alone never matched it
    // because "انواع" sits between "سازنده" and "ماشین آلات" in the real
    // text, breaking the strict contiguous-phrase match; "ماشین سازی"
    // alone, appearing at the very start of that same text, does not have
    // this problem.
    label: 'تامین‌کننده ماشین‌آلات/خط تولید (نه تولیدکننده محصول نهایی پلیمری)',
    keywords: [
      'ماشین سازی',
      'فروش ماشین آلات',
      'فروش دستگاه',
      'واردکننده ماشین آلات',
      'تولیدکننده ماشین آلات',
      'سازنده ماشین آلات',
      'سازنده دستگاه',
      'فروش خط تولید',
      'سازنده خط تولید',
      'طراحی و ساخت خط تولید',
    ],
  },
  {
    key: 'research_consultant',
    label: 'مرکز پژوهشی یا مشاوره‌ای',
    keywords: ['پژوهشکده', 'پژوهشگاه', 'مرکز تحقیقات', 'موسسه تحقیقاتی', 'انستیتو', 'مشاوره صنعتی', 'مشاور صنعتی'],
  },
  {
    key: 'medical_cosmetic',
    // 23D.3 - "جراح پلاستیک" (a plastic SURGEON) must never gain polymer
    // buyer-fit merely from the word "پلاستیک" - see the matching
    // NEGATIVE_SIGNALS entry in industryTaxonomy.js for the score-side
    // consequence; this is the buyer_fit-side one.
    //
    // "FINAL AUTONOMY BLOCKER" round, section 5B: bare "کلینیک" was REMOVED.
    // "کلینیک" is routinely used METAPHORICALLY in Persian business names
    // for a plain service/repair center with no medical meaning at all
    // ("کلینیک تاسیسات ساختمانی" - a building-facilities MAINTENANCE
    // center, "کلینیک خودرو" - an auto repair shop). Medical classification
    // now requires explicit health/medical CONTEXT - either a standalone
    // strong medical word (پزشک/دکتر/جراح/جراحی/بیمارستان/درمانگاه), or
    // "کلینیک" in an explicit compound with one.
    label: 'مرکز پزشکی/زیبایی (نه تولیدکننده صنعتی)',
    keywords: [
      'جراح پلاستیک',
      'جراحی پلاستیک',
      'جراحی زیبایی',
      'جراحی بینی',
      'کلینیک زیبایی',
      'کلینیک پزشکی',
      'کلینیک تخصصی پزشکی',
      'کلینیک دندانپزشکی',
      'کلینیک پوست و مو',
      'کلینیک درمانی',
      'پزشک',
      'دکتر',
      'جراح',
      'زیبایی',
      'بیمارستان',
      'درمانگاه',
    ],
  },
]

// entityType/isNonCompany/hasIndustryEvidence/hasProductionEvidence/
// hasNonBuyerOrgSignal/hasCompetitorCaution are all booleans the caller
// (evidenceEngine.js) already derived from the candidate's own evidence -
// this function is a pure decision table over them, no text matching of
// its own (that lives in evidenceEngine.js, one place for all keyword
// matching).
//
//   1. Is this a real company/entity?        -> isNonCompany / entityType
//   2. Is it actually a manufacturer?          -> hasProductionEvidence
//   3. Is it likely to CONSUME Hinza products? -> the rest of this table
export function deriveBuyerFit({
  entityType,
  isNonCompany,
  hasIndustryEvidence,
  hasProductionEvidence,
  hasNonBuyerOrgSignal,
  hasCompetitorCaution,
  hasStrongNegative,
}) {
  if (isNonCompany) return BUYER_FIT.NOT_BUYER
  if (hasNonBuyerOrgSignal) return BUYER_FIT.NOT_BUYER
  // 23D.3 - a strong negative (retail-only, agency, unrelated business,
  // medical/cosmetic) means "not a buyer" even if some industry keyword
  // ALSO happened to match (e.g. a retail shop mentioning a product name in
  // passing) - checked before the industry-evidence check below.
  if (hasStrongNegative) return BUYER_FIT.NOT_BUYER
  if (!hasIndustryEvidence) return BUYER_FIT.UNKNOWN
  // A masterbatch/pigment PRODUCER itself is a supply-side competitor, not
  // a customer - still polymer-relevant, but never "high" fit.
  if (hasCompetitorCaution) return BUYER_FIT.LOW
  if (entityType === 'direct_company' && hasProductionEvidence) return BUYER_FIT.HIGH
  return BUYER_FIT.MEDIUM
}

// ---------------------------------------------------------------------------
// Phase 23D-FINAL, section E - BUSINESS ROLE: a first-pass categorical
// dimension, kept separate from both entity_type (is this a company/page at
// all) and buyer_fit (would they buy from Hinza). A single blended score was
// never enough to tell a masterbatch-producing COMPETITOR apart from a
// finished-goods PROCESSOR, or a machinery vendor from an association - both
// used to just collapse into "rejected"/"not relevant."
//
// This is a coarse, deterministic first pass, not a fine-grained processor/
// converter/compounder classifier - "mixed" and "polymer_processor" are
// deliberately the two catch-alls for anything with real evidence that
// doesn't cleanly match one of the more specific non-buyer categories.
// Refining it further (e.g. reliably telling a compounder from a straight
// converter) would need real product/process detail most short search
// snippets simply don't contain - a documented limitation, not a bug.
// ---------------------------------------------------------------------------

export const BUSINESS_ROLE = {
  POLYMER_PROCESSOR: 'polymer_processor',
  CONVERTER: 'converter',
  FINISHED_GOODS_MANUFACTURER: 'finished_goods_manufacturer',
  COMPOUNDER: 'compounder',
  MASTERBATCH_SUPPLIER: 'masterbatch_supplier',
  RAW_MATERIAL_SUPPLIER: 'raw_material_supplier',
  MACHINERY_SUPPLIER: 'machinery_supplier',
  RETAILER: 'retailer',
  ASSOCIATION: 'association',
  MEDICAL: 'medical',
  SERVICE: 'service',
  MIXED: 'mixed',
  UNKNOWN: 'unknown',
}

export const BUSINESS_ROLE_LABELS_FA = {
  polymer_processor: 'فرآورنده/تولیدکننده مواد پلیمری',
  converter: 'تبدیل‌کننده مواد پلیمری',
  finished_goods_manufacturer: 'تولیدکننده محصول نهایی پلیمری',
  compounder: 'کامپاندکننده',
  masterbatch_supplier: 'تولیدکننده مستربچ/رنگدانه (رقیب/تامین‌کننده)',
  raw_material_supplier: 'تامین‌کننده مواد اولیه',
  machinery_supplier: 'تامین‌کننده ماشین‌آلات/خط تولید',
  retailer: 'خرده‌فروش',
  association: 'انجمن یا تشکل صنفی',
  medical: 'مرکز پزشکی/زیبایی',
  service: 'خدماتی/پژوهشی/مشاوره‌ای',
  mixed: 'نقش ترکیبی/نامشخص با برخی شواهد صنعتی',
  unknown: 'نامشخص',
}

// 23D-FINAL.1, section 9 (buyer-fit/role contradiction invariant):
// hasStrongNegative is now checked here too, exactly like deriveBuyerFit
// above - a candidate can otherwise reach business_role=polymer_processor
// (production evidence + industry evidence, neither of which look at
// negative signals on their own) while buyer_fit=not_buyer (which DOES
// check hasStrongNegative) at the same time - a genuinely self-
// contradictory pair. Both functions must agree on what a strong negative
// means for an entity's role.
export function deriveBusinessRole({
  isNonCompany,
  nonBuyerKey,
  hasStrongRetailSignal,
  hasCompetitorCaution,
  entityType,
  hasProductionEvidence,
  hasIndustryEvidence,
  hasStrongNegative,
}) {
  if (isNonCompany) return BUSINESS_ROLE.UNKNOWN
  if (nonBuyerKey === 'machinery_supplier') return BUSINESS_ROLE.MACHINERY_SUPPLIER
  if (nonBuyerKey === 'trade_association') return BUSINESS_ROLE.ASSOCIATION
  if (nonBuyerKey === 'research_consultant') return BUSINESS_ROLE.SERVICE
  if (nonBuyerKey === 'medical_cosmetic') return BUSINESS_ROLE.MEDICAL
  if (hasStrongRetailSignal) return BUSINESS_ROLE.RETAILER
  if (hasStrongNegative) return BUSINESS_ROLE.UNKNOWN
  if (hasCompetitorCaution) return BUSINESS_ROLE.MASTERBATCH_SUPPLIER
  if (entityType === 'direct_company' && hasProductionEvidence && hasIndustryEvidence) return BUSINESS_ROLE.POLYMER_PROCESSOR
  if (hasIndustryEvidence) return BUSINESS_ROLE.MIXED
  return BUSINESS_ROLE.UNKNOWN
}
