import { normalizeSearchText } from './normalization.js'
import {
  TARGET_INDUSTRIES,
  COMPETITOR_SUPPLIER_KEYWORDS,
  NEGATIVE_SIGNALS,
  MANUFACTURING_INDICATOR_TERMS,
  GENERIC_POLYMER_TERMS,
  STRONG_NEGATIVE_WEIGHT_THRESHOLD,
  findMatchingKeywords,
} from './industryTaxonomy.js'
import { findMatchingKeywordsStrict } from './textMatching.js'
import { classifyEntityType, isNonCompanyEntityType, ENTITY_TYPE_LABELS_FA } from './entityClassification.js'
import { NON_BUYER_ORG_SIGNALS, deriveBuyerFit, BUYER_FIT_LABELS_FA, deriveBusinessRole, BUSINESS_ROLE_LABELS_FA } from './buyerFit.js'
import { resolveIdentity } from './identityResolution.js'

// Phase 23D-FINAL, section C - STRUCTURED SOURCE EVIDENCE. OSM/Overpass
// nodes carry real, deliberately-tagged structured facts that are far more
// reliable than free-text keyword matching - but osmOverpass.js's
// tagsToDescription() only ever handled a handful of tag keys (shop/craft/
// man_made/office), and even then dumped the raw, untranslated English tag
// VALUE into business_description (man_made=works became the literal
// English word "works", which no Persian keyword list could ever match).
// This reads the ORIGINAL tags directly off candidate.raw_data.tags (only
// present/meaningful for OSM-sourced candidates - every other adapter's
// raw_data has a different shape, so this naturally no-ops for them) -
// never re-derives anything from business_description text, and never
// fetches anything.
const STRUCTURED_INDUSTRIAL_MAN_MADE = new Set(['works', 'factory'])

function extractStructuredIndustrialSignals(candidate) {
  const tags = candidate.raw_data?.tags
  if (!tags || typeof tags !== 'object') return []
  const signals = []
  const manMade = String(tags.man_made || '').toLowerCase()
  if (STRUCTURED_INDUSTRIAL_MAN_MADE.has(manMade)) signals.push(`man_made=${manMade}`)
  if (tags.craft) signals.push(`craft=${tags.craft}`)
  if (tags.industrial) signals.push(`industrial=${tags.industrial}`)
  if (/plastic/i.test(String(tags.product || ''))) signals.push(`product=${tags.product}`)
  if (String(tags['recycling:plastic'] || '').toLowerCase() === 'yes') signals.push('recycling:plastic=yes')
  return signals
}

// ---------------------------------------------------------------------------
// RAW CANDIDATE TEXT -> a list of concrete, individually-inspectable
// evidence items. Never a single opaque "relevant: yes/no" - every claim the
// UI later shows the admin traces back to exactly one of these. Purely
// deterministic keyword/field matching for Phase 23 - no external AI call
// (see src/prospecting/README notes in scoringEngine.js for the AI-readiness
// boundary).
// ---------------------------------------------------------------------------

// Phase 23D (Smart Qualification 2.0): TRUSTED text only - what the
// candidate's own title/description actually says. Deliberately EXCLUDES
// industry_guess - for a live search source (Serper) that field is nothing
// more than which query theme surfaced the result, never proof the result
// ITSELF says anything about manufacturing (an article that merely appeared
// for "تولید کننده فیلم پلی اتیلن" is not thereby a film manufacturer just
// because that string exists somewhere on the candidate row). industry_guess
// still contributes a little, but only as its own separate, low-weight,
// clearly-labeled hint below (see 'query_or_label_hint') - never folded into
// the main keyword-matching text every other evidence type relies on.
function candidateSearchText(candidate) {
  return normalizeSearchText([candidate.business_description, candidate.raw_name, candidate.canonical_name].filter(Boolean).join(' '))
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// "FINAL REGRESSION FIX" round, item 3 (Omid Omran machinery page) - "خط
// تولید X" NAMES a production LINE (a machine) as if X were its own
// product - the same way a machinery vendor's own page/title reads ("خط
// تولید نایلون گلخانه‌ای" = "the greenhouse-nylon production LINE", i.e. the
// MACHINE for sale, never a claim that the page itself PRODUCES nylon).
// Deliberately narrower than a bare "دستگاه"/"ماشین" prefix - "با ماشین/
// دستگاه تزریق مدرن تولید می‌کنیم" (a real processor describing its OWN
// equipment) is a legitimate, already-covered self-reference pattern that
// must never be swept into this.
function isMachineryNamedProduct(text, keyword) {
  return new RegExp(`خط\\s*تولید\\s+${escapeRegExp(keyword)}`).test(text)
}

export function extractEvidence(candidate) {
  const evidence = []
  const text = candidateSearchText(candidate)
  const machineryNamedMatches = []

  // Computed up front - both the "خط تولید X" machinery-naming guard right
  // below AND the later hasProductionLanguage/hasStrongNegative checks need
  // this same "does the text independently self-identify as a producer"
  // signal, so it is derived exactly once here rather than re-scanned
  // separately in three different places.
  const hasManufacturingIndicatorMatch = findMatchingKeywords(text, MANUFACTURING_INDICATOR_TERMS.map((k) => normalizeSearchText(k))).length > 0

  for (const industry of TARGET_INDUSTRIES) {
    const matches = findMatchingKeywords(text, industry.keywords.map((k) => normalizeSearchText(k)))
    for (const match of matches) {
      // Only suppressed when the text has NO OTHER independent, stronger
      // production self-identification (تولیدکننده/تولید کننده/کارخانه/...)
      // - if a real processor's text ALSO separately says e.g. "کارخانه
      // تولیدی ما..." that deliberate self-declaration wins instead, and
      // the "خط تولید X" phrasing is left alone (most likely describing
      // their OWN production capacity, not a machine being sold).
      if (!hasManufacturingIndicatorMatch && isMachineryNamedProduct(text, match)) {
        machineryNamedMatches.push(match)
        continue
      }
      evidence.push({
        evidenceType: 'industry_keyword',
        value: `${industry.label} — «${match}»`,
        weight: 12,
        confidence: 'medium',
        meta: { industryKey: industry.key },
      })
    }
  }

  // Section C - structured OSM tags are real, first-class evidence, not a
  // weaker fallback - a source that explicitly says man_made=works or
  // product=plastic_products has already told us more reliably than any
  // free-text guess ever could. Counted as an industry match on its own.
  const structuredSignals = extractStructuredIndustrialSignals(candidate)
  if (structuredSignals.length > 0) {
    evidence.push({
      evidenceType: 'structured_industrial_signal',
      value: `شواهد ساختاریافته صنعتی از منبع — ${structuredSignals.join('، ')}`,
      weight: 14,
      confidence: 'medium',
    })
  }

  // Fallback for terse records with no specific matched industry - a real
  // manufacturer's NAME alone (e.g. a directory listing with no
  // description) often just says "کارخانه پلاستیک X", never one of the
  // more specific TARGET_INDUSTRIES phrases. Only fires when nothing more
  // specific already matched, so it never inflates an already-well-
  // evidenced candidate.
  const hasSpecificIndustryMatch = evidence.some((e) => e.evidenceType === 'industry_keyword' || e.evidenceType === 'structured_industrial_signal')
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

  // A weak, clearly separate hint from industry_guess - never strong enough
  // alone to justify 'qualified' (see the function-header note above). Only
  // fires when nothing more specific already matched in the trusted text,
  // so it never double-counts alongside a real industry_keyword hit.
  if (candidate.industry_guess && !hasSpecificIndustryMatch) {
    const allIndustryKeywords = TARGET_INDUSTRIES.flatMap((industry) => industry.keywords.map((k) => normalizeSearchText(k)))
    const guessMatches = findMatchingKeywords(normalizeSearchText(candidate.industry_guess), allIndustryKeywords)
    if (guessMatches.length > 0) {
      evidence.push({
        evidenceType: 'query_or_label_hint',
        value: `برچسب/عبارت مرتبط — «${candidate.industry_guess}»`,
        weight: 3,
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

  // Phase 23D.2 - polymer-industry-ADJACENT organizations (trade
  // associations, machinery/production-line vendors, research/consultancy
  // outfits) that are never themselves a likely masterbatch/pigment/
  // additive CONSUMER, no matter how much polymer-industry language their
  // own page uses - see buyerFit.js. Kept as its OWN evidence type (never
  // folded into negative_signal) so the specific reason stays auditable.
  for (const signal of NON_BUYER_ORG_SIGNALS) {
    // Section B - exact word/phrase-boundary matching, never substring: a
    // false trigger here actively suppresses a real prospect (e.g.
    // "پزشکی" [medical, a real B2B vertical] must never match "پزشک"
    // [doctor] just because it contains it as a substring).
    const matches = findMatchingKeywordsStrict(text, signal.keywords)
    for (const match of matches) {
      evidence.push({
        evidenceType: 'non_buyer_organization',
        value: `${signal.label} — «${match}»`,
        weight: -20,
        confidence: 'medium',
        meta: { nonBuyerKey: signal.key, nonBuyerLabel: signal.label },
      })
    }
  }

  // A "خط تولید X" match (see isMachineryNamedProduct above) IS itself
  // direct evidence of a machinery/production-line vendor - the SAME
  // evidence type and downstream handling as any other NON_BUYER_ORG_SIGNALS
  // match, so buyer_fit/business_role read it back identically (never a
  // separate, parallel "kind of not-a-buyer").
  if (machineryNamedMatches.length > 0) {
    const machinerySignal = NON_BUYER_ORG_SIGNALS.find((s) => s.key === 'machinery_supplier')
    evidence.push({
      evidenceType: 'non_buyer_organization',
      value: `${machinerySignal.label} — «خط تولید ${machineryNamedMatches[0]}»`,
      weight: -20,
      confidence: 'medium',
      meta: { nonBuyerKey: 'machinery_supplier', nonBuyerLabel: machinerySignal.label },
    })
  }

  for (const signal of NEGATIVE_SIGNALS) {
    // Same strict, boundary-aware matching as NON_BUYER_ORG_SIGNALS above -
    // this is exactly what stops "پزشکی" (medical) from being misread as
    // the "پزشک" (doctor) negative signal.
    const matches = findMatchingKeywordsStrict(text, signal.keywords)
    for (const match of matches) {
      evidence.push({
        evidenceType: 'negative_signal',
        value: `${signal.label} — «${match}»`,
        weight: signal.weight,
        confidence: 'medium',
        meta: { negativeKey: signal.key, exemptWhenProduction: Boolean(signal.exemptWhenProduction) },
      })
    }
  }

  // "FINAL REGRESSION FIX"/"FINAL PRODUCTION GATE" rounds (generalized) - a
  // STRONG negative signal normally means "not a buyer" regardless of any
  // other evidence. But some negative signals are marked
  // `exemptWhenProduction: true` in industryTaxonomy.js's NEGATIVE_SIGNALS
  // (currently retail_only - "نمایندگی فروش و تولید قطعات پلاستیکی خودرو" -
  // and generic_commercial_cta's bare "مشاوره" - "کارخانه تولید قطعات
  // پلاستیکی خودرو (مشاوره رایگان + قیمت)") because they are AMBIGUOUS: a
  // genuine manufacturer routinely uses this exact wording as ordinary
  // marketing copy, not as a claim about what kind of business it is.
  // Exempted ONLY when the text ALSO independently self-identifies as a
  // producer - a genuinely unrelated business (an ad agency, a clinic, a
  // restaurant) never gets the benefit of the doubt just because "تولید"
  // appears somewhere in unrelated wording, and every OTHER negative
  // signal (medical/unrelated_business/machinery/a dedicated agency/legal/
  // accounting firm) stays a hard, unconditional negative - these describe
  // a fundamentally different KIND of business, not ambiguous phrasing.
  //
  // Computed ONCE, here, as the single source of truth - see
  // matchedHasStrongNegative() below, which qualification.js now reads
  // back instead of independently re-deriving its own copy of this same
  // decision (two independent recomputations of "is this a strong
  // negative" is exactly the split-brain risk that caused the
  // business_role/buyer_fit contradiction bug fixed in an earlier round).
  const hasStrongNegative = evidence.some((e) => {
    if (e.evidenceType !== 'negative_signal' || e.weight > STRONG_NEGATIVE_WEIGHT_THRESHOLD) return false
    if (e.meta?.exemptWhenProduction && hasManufacturingIndicatorMatch) return false
    return true
  })
  evidence.push({
    evidenceType: 'strong_negative_assessment',
    value: hasStrongNegative ? 'شواهد منفی قوی یافت شد' : 'شواهد منفی قوی یافت نشد',
    weight: 0,
    confidence: 'medium',
    meta: { hasStrongNegative },
  })

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

  // Phase 23D/23D.1 - deterministic entity-type classification (see
  // entityClassification.js). A page ABOUT many companies (a directory,
  // listicle article, marketplace ad, social post, video) is never itself
  // one of them, no matter how many manufacturing keywords it echoes back -
  // this is what lets a real manufacturer's own site outscore a "بهترین
  // تولیدکنندگان..." article even when both mention similar keywords, and
  // what qualification.js reads back (via matchedEntityType()) to hard-block
  // auto-promotion for anything that isn't a confirmed direct company.
  //
  // 23D.1 item 3 - ENTITY TYPE is decided independently of manufacturing
  // RELEVANCE: a confirmed direct-company page gets its identity evidence
  // regardless of whether it also happens to match an industry keyword here
  // (weight scales up when it does, but the identity itself never depends
  // on it) - qualification.js is what layers the separate "is this
  // industry-relevant" question on top, via its own hasIndustryEvidence
  // check.
  const entityType = classifyEntityType({
    domain: candidate.domain,
    title: candidate.raw_name,
    snippet: candidate.business_description,
    url: candidate.source_url || candidate.website,
  })
  if (entityType === 'direct_company') {
    evidence.push({
      evidenceType: 'direct_company_site',
      value: hasSpecificIndustryMatch
        ? 'این نتیجه به‌نظر می‌رسد وب‌سایت مستقیم خود شرکت است و شواهد صریح تولید نیز در آن یافت شد.'
        : 'این نتیجه به‌نظر می‌رسد وب‌سایت مستقیم خود شرکت است، نه یک صفحه فهرستی یا مقاله.',
      weight: hasSpecificIndustryMatch ? 15 : 5,
      confidence: hasSpecificIndustryMatch ? 'medium' : 'low',
      meta: { entityType },
    })
  } else if (isNonCompanyEntityType(entityType)) {
    evidence.push({
      evidenceType: 'non_company_content',
      value: `این نتیجه ${ENTITY_TYPE_LABELS_FA[entityType]} به‌نظر می‌رسد، نه وب‌سایت مستقل یک شرکت.`,
      weight: -20,
      confidence: 'high',
      meta: { entityType },
    })
  }

  // Phase 23D.2 - BUYER FIT: a dimension separate from entity_type (never
  // merged into it, per spec). Being a real, direct-website polymer-
  // industry company answers "is this a company?" - buyer_fit answers the
  // separate question "would this specific company actually consume
  // masterbatch/pigments/polymer additives?" (a trade association or a
  // production-line vendor can be entity_type=direct_company and still be
  // buyer_fit=not_buyer). See buyerFit.js for the decision table.
  const hasIndustryEvidenceForBuyerFit = hasSpecificIndustryMatch || evidence.some((e) => e.evidenceType === 'generic_manufacturing_signal')
  // man_made=works/factory IS, on its own, strong production evidence
  // (that's literally what the tag asserts) - ORed with the usual Persian
  // production-language check (already computed once, at the top of this
  // function, as hasManufacturingIndicatorMatch), never a replacement for
  // it.
  const hasProductionLanguage = hasManufacturingIndicatorMatch || structuredSignals.length > 0
  const hasNonBuyerOrgSignal = evidence.some((e) => e.evidenceType === 'non_buyer_organization')
  const nonBuyerKey = evidence.find((e) => e.evidenceType === 'non_buyer_organization')?.meta?.nonBuyerKey || null
  const hasCompetitorCaution = competitorMatches.length > 0
  const buyerFit = deriveBuyerFit({
    entityType,
    isNonCompany: isNonCompanyEntityType(entityType),
    hasIndustryEvidence: hasIndustryEvidenceForBuyerFit,
    hasProductionEvidence: hasProductionLanguage,
    hasNonBuyerOrgSignal,
    hasCompetitorCaution,
    hasStrongNegative,
  })
  evidence.push({
    evidenceType: 'buyer_fit_assessment',
    value: BUYER_FIT_LABELS_FA[buyerFit],
    weight: 0,
    confidence: 'medium',
    meta: { buyerFit },
  })

  // Section E - BUSINESS ROLE: a categorical dimension separate from both
  // entity_type and buyer_fit (see buyerFit.js's header note for why one
  // blended score was never enough to tell a competitor apart from a
  // processor, or a machinery vendor from an association).
  //
  // 23D-FINAL.1, section 9: must ALSO respect hasStrongNegative, exactly
  // like deriveBuyerFit above - without this, a candidate with real
  // production evidence but ALSO a strong negative signal that ISN'T
  // specifically retail_only (e.g. agency/unrelated_business) could reach
  // business_role=polymer_processor while buyer_fit=not_buyer at the same
  // time - a real, self-contradictory pair the new conflict checks
  // (discoveryPipeline.js) would otherwise have to catch after the fact.
  const businessRole = deriveBusinessRole({
    isNonCompany: isNonCompanyEntityType(entityType),
    nonBuyerKey,
    hasStrongRetailSignal: evidence.some((e) => e.evidenceType === 'negative_signal' && e.meta?.negativeKey === 'retail_only'),
    hasCompetitorCaution,
    entityType,
    hasProductionEvidence: hasProductionLanguage,
    hasIndustryEvidence: hasIndustryEvidenceForBuyerFit,
    hasStrongNegative,
  })
  evidence.push({
    evidenceType: 'business_role_assessment',
    value: BUSINESS_ROLE_LABELS_FA[businessRole],
    weight: 0,
    confidence: 'medium',
    meta: { businessRole },
  })

  // Sections 5/6/7 - SITE OWNER IDENTITY, separate from page type
  // (entity_type above). See identityResolution.js. This is only the
  // BASELINE pass (no live fetch) - discoveryPipeline.js may later call
  // replaceIdentityEvidence() below to upgrade this entry after a real
  // website-verification fetch (see the "FINAL AUTONOMY BLOCKER" round).
  const identity = resolveIdentity(candidate, entityType)
  evidence.push(identityEvidenceItem(identity))

  return evidence
}

function identityEvidenceItem(identity) {
  return {
    evidenceType: 'identity_assessment',
    value: identity.resolvedName
      ? `هویت شرکت: ${identity.resolvedName} (منبع: ${identity.source}, وضعیت: ${identity.status})`
      : 'هویت شرکت قابل تایید نبود.',
    weight: 0,
    confidence: identity.status === 'verified' ? 'high' : identity.status === 'probable' ? 'medium' : 'low',
    meta: identity,
  }
}

// Swaps a candidate's identity_assessment evidence item for an UPGRADED
// identity (e.g. after a live website-verification fetch confirmed a real
// JSON-LD/og:site_name/About-page self-declaration) - never appends a
// second one, so matchedIdentity() always reads back exactly one, current
// answer. Used by discoveryPipeline.js only; extractEvidence() itself never
// fetches anything (see the file header).
export function replaceIdentityEvidence(evidenceList, identity) {
  return [...evidenceList.filter((e) => e.evidenceType !== 'identity_assessment'), identityEvidenceItem(identity)]
}

// The unified "is this a strong negative" verdict, read back the same way
// as every other matchedX() reader - see the strong_negative_assessment
// push above for why this now has exactly ONE source of truth instead of
// qualification.js independently re-deriving its own copy.
export function matchedHasStrongNegative(evidenceList) {
  const found = evidenceList.find((e) => e.evidenceType === 'strong_negative_assessment')
  return found?.meta?.hasStrongNegative || false
}

// Distinct matched TARGET_INDUSTRIES keys for a candidate's evidence list -
// used by productFit.js, never re-derived by re-scanning text a second time.
export function matchedIndustryKeys(evidenceList) {
  return [...new Set(evidenceList.filter((e) => e.evidenceType === 'industry_keyword').map((e) => e.meta?.industryKey).filter(Boolean))]
}

// The entity-type verdict for a candidate, read back off its OWN evidence
// list (never re-classified from scratch) - so qualification.js and the UI
// always agree with what extractEvidence() actually recorded. 'unknown'
// (the default) means neither a confirmed direct-company site NOR a
// confirmed non-company page - e.g. a directory/OSM candidate with no
// website at all, which is neither penalized nor given the new bonus.
export function matchedEntityType(evidenceList) {
  const nonCompany = evidenceList.find((e) => e.evidenceType === 'non_company_content')
  if (nonCompany) return nonCompany.meta?.entityType || 'unknown'
  if (evidenceList.some((e) => e.evidenceType === 'direct_company_site')) return 'direct_company'
  return 'unknown'
}

// The buyer-fit verdict for a candidate, read back off its OWN evidence
// list the same way matchedEntityType() is - qualification.js and the UI
// always agree with what extractEvidence() actually recorded.
export function matchedBuyerFit(evidenceList) {
  const found = evidenceList.find((e) => e.evidenceType === 'buyer_fit_assessment')
  return found?.meta?.buyerFit || 'unknown'
}

// The business-role verdict, read back the same way.
export function matchedBusinessRole(evidenceList) {
  const found = evidenceList.find((e) => e.evidenceType === 'business_role_assessment')
  return found?.meta?.businessRole || 'unknown'
}

// The resolved SITE OWNER IDENTITY, read back the same way - { resolvedName,
// source, status }, see identityResolution.js.
export function matchedIdentity(evidenceList) {
  const found = evidenceList.find((e) => e.evidenceType === 'identity_assessment')
  return found?.meta || { resolvedName: null, source: 'unresolved', status: 'unresolved' }
}
