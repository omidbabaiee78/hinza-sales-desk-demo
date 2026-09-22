import { matchedEntityType, matchedBuyerFit, matchedIdentity, matchedHasStrongNegative } from './evidenceEngine.js'
import { isNonCompanyEntityType, ENTITY_TYPE_LABELS_FA } from './entityClassification.js'
import { isPromotableIdentity } from './identityResolution.js'

// Phase 23D-FINAL, section N (decision versioning). Bump this whenever
// qualification/entity/buyer-fit LOGIC changes in a way that could change a
// candidate's decision - it lets an admin (or a future automated pass) know
// which "brain" produced a given row's current status/score/reason, and is
// what makes "re-evaluate existing candidates under a newer brain version"
// a well-defined operation instead of a guess. NOT YET WIRED into any
// database write - see the 23D-FINAL report for why (no
// prospect_candidates.qualification_version column exists in the live
// schema yet; supabase/sql/phase23_qualification_version.sql is the
// prepared, not-yet-applied migration that adds it). Once that migration
// is applied, reEvaluateCandidate()/processCandidate() can start stamping
// this value on every write.
export const QUALIFICATION_VERSION = 6

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
//
// Phase 23D (Smart Qualification 2.0): 'qualified' and 'safe to auto-
// promote' are now two SEPARATE questions, not one. Before this, a real
// manufacturer with a strong direct website but only ONE matched industry
// keyword (medium confidence) sat in manual_review at a score around 40-56,
// indistinguishable from a "بهترین تولیدکنندگان..." listicle article that
// happened to echo similar keywords - because both were held to the exact
// same score>=80 bar just to be considered "qualified" at all. Now:
//   - 'qualified' is reachable at a materially lower score for a candidate
//     whose result is CONFIRMED to be a direct company's own site (not an
//     article/directory/marketplace/social/video page) with real
//     manufacturing evidence.
//   - a confirmed directory/article/marketplace/social/video result can
//     NEVER auto-promote, regardless of score or confidence - checked
//     first, unconditionally.
//
// Phase 23D.1: the production dry-run of 2.0 showed the entity
// classification itself (see entityClassification.js) was too permissive -
// "has a domain, no obvious red flag" was wrongly treated as proof of
// direct_company for general classifieds/B2B-directory sites. Once that was
// tightened, real strong manufacturers still only scored ~45-50 (short
// Serper snippets rarely accumulate a high raw score) - so the qualify bar
// moved to 45, and the direct-company auto-promote decision was rebuilt
// around identity/evidence strength (confirmed entity + real industry
// match + no strong negative + confidence + contact) rather than a raw
// score threshold, which is why isSafeToAutoPromoteDirectCompany below has
// no overallScore check at all. The GENERIC (non-direct-company) path below
// still uses the original score-gated isSafeToAutoPromote, unchanged.
//
// Phase 23D.2 (Buyer Fit Qualification): entity_type=direct_company only
// answers "is this a real company with its own site" - it does NOT answer
// "would this company actually buy masterbatch/pigments/polymer additives".
// A trade association, a machinery/production-line vendor, or a research
// institute can be a perfectly confirmed direct_company, drenched in
// polymer-industry language, and still never be a Hinza buyer. buyer_fit
// (see buyerFit.js/evidenceEngine.js) is a SEPARATE dimension answering
// exactly that, read back via matchedBuyerFit() the same way entity_type is
// read back via matchedEntityType(). buyer_fit=not_buyer caps status at
// manual_review (checked right after the entity-type gate, same shape);
// buyer_fit!=high blocks auto-promotion everywhere, unconditionally
// (checked inside both isSafeToAutoPromote and
// isSafeToAutoPromoteDirectCompany below) - "never auto-promote if buyer
// fit is not high," per spec item D. The direct-company auto-promote gate
// also no longer requires confidence=high - medium confidence is accepted
// when every other buyer-fit gate (entity, industry relevance, production
// evidence, no strong negative) is already satisfied, per spec.
//
// Phase 23D.3: production dry-run of 2.2 showed auto_promotable=0 across
// the board despite several candidates meeting every stated criterion
// (tamashaplast.com, pouryaplasticrey.com, pooshanplastic.com - all
// direct_company/buyer_fit=high/qualified). Root cause: hasUsableContact
// required a real phone/mobile/email, which most Serper snippets never
// contain - so it silently zeroed out auto-promotion regardless of
// identity/evidence strength. Fixed by accepting a confirmed company-owned
// WEBSITE as a legitimate contact channel for the direct-company gate
// specifically (hasUsableContactOrWebsite below) - the generic/OSM gates
// keep the original strict phone/mobile/email requirement. Also added:
// source-trust distrust of OSM-only identity (isOsmSourced - OSM data is
// community-mapped, not a first-party resolved web result, so it must
// clear the OLD stricter gate to auto-promote), a low-confidence guard
// (only 'qualified', not just auto-promotable, when buyer_fit=high backs
// it up), and a hard medical/cosmetic negative signal so "جراح پلاستیک"
// (a plastic SURGEON) can never gain polymer buyer-fit from the word
// "پلاستیک" alone (industryTaxonomy.js NEGATIVE_SIGNALS + buyerFit.js
// NON_BUYER_ORG_SIGNALS).
// ---------------------------------------------------------------------------

const MIN_TEXT_LENGTH_TO_JUDGE = 20

// The new, lower bar a CONFIRMED direct-company result can reach 'qualified'
// at - deliberately well below the old universal 80. 23D.1: real production
// examples (alborznylon.ir, pooshanplastic.com) scored 47 once entity
// classification was fixed - "around 45-50, never require 55+" per the
// 23D.1 spec - so the bar sits at 45.
const DIRECT_COMPANY_QUALIFY_MIN_SCORE = 45

// The GENERIC (non-direct-company-fast-path) auto-promote gate - the admin's
// own configurable score/confidence bar, as since 23D, PLUS (23D.2) the
// unconditional buyer_fit=high requirement.
function isSafeToAutoPromote({ scores, settings, hasUsableContact, buyerFit, hasResolvedIdentity }) {
  // Section 6 (company name resolution): NO exceptions - a candidate whose
  // real company identity hasn't been resolved to at least medium
  // confidence (a bare domain-label fallback, or genuinely unresolved) can
  // never auto-promote, no matter how strong everything else is. Creating a
  // real sales_leads row named after a page/product title, or after a raw
  // domain label, is worse than not promoting at all.
  if (!hasResolvedIdentity) return false
  if (buyerFit !== 'high') return false
  if (!hasUsableContact) return false
  const requiredConfidence = settings?.min_confidence_auto_promote ?? 'high'
  const meetsConfidence =
    requiredConfidence === 'medium' ? scores.confidence === 'high' || scores.confidence === 'medium' : scores.confidence === 'high'
  if (!meetsConfidence) return false
  return scores.overallScore >= (settings?.min_score_auto_promote ?? 80)
}

// 23D.1 item 5 - a SEPARATE, identity-driven auto-promote gate for the
// direct-company fast path. Deliberately has NO raw overallScore threshold:
// the old blanket score>=80 bar was calibrated for score-driven promotion
// (any candidate, any entity type), and was why the 2.0 dry run produced
// ZERO auto-promotable candidates even for a confirmed strong manufacturer
// like tamashaplast.com - real Serper snippets are short, so relevance
// score rarely climbs that high even when identity/evidence are genuinely
// solid. Promotion safety here comes from the STACK of conditions already
// guaranteed by the time this is called (confirmed direct_company entity,
// real matched industry evidence, no strong negative signal - see
// qualifyCandidate below), plus confidence and contact, still gated by the
// admin's own min_confidence_auto_promote setting exactly as before.
// max_promotions_per_run (discoveryPipeline.js) remains the hard cap either
// way.
// 23D.2: no longer reads settings.min_confidence_auto_promote at all -
// medium confidence is unconditionally acceptable here (per spec item on
// auto-promotion: "Do NOT require confidence=high if deterministic
// evidence is strong enough"), since by the time this is called the
// candidate has ALREADY cleared confirmed direct_company identity, real
// matched industry evidence, no strong negative signal, AND buyer_fit=high
// - that evidence stack is what makes medium confidence safe here, not an
// admin dial.
//
// 23D.3: does not check `scores.confidence` at all any more. By the time
// this is reached, buyer_fit=high is ALREADY guaranteed - and buyer_fit=
// high (see buyerFit.js) already requires confirmed direct_company entity
// + a real matched industry keyword + explicit production language
// together, which IS the "unusually strong deterministic evidence" bar the
// spec asks a low-confidence candidate to clear (computeConfidence's own
// 'low' classification mostly reflects a raw SCORE that's merely under 55,
// e.g. alborznylon.ir at 54 - not weak evidence). qualifyCandidate's own
// low-confidence guard (right below, in the fast-path branch) is what
// keeps this from being reckless: a low-confidence candidate only even
// REACHES 'qualified' status when buyer_fit=high already backed it up;
// anything weaker stays manual_review before this function is ever called.
function isSafeToAutoPromoteDirectCompany({ hasUsableContact, buyerFit, hasResolvedIdentity }) {
  // Section 6 - same "no exceptions" identity requirement as the generic
  // gate above.
  if (!hasResolvedIdentity) return false
  if (buyerFit !== 'high') return false
  return hasUsableContact
}

// firstIndustryLabel()/buildBuyerFitReasonFa() give the specific,
// non-technical explanation the 23D.2 spec asks for ("تولیدکننده مستقیم
// فیلم پلی‌اتیلن؛ مصرف‌کننده بالقوه مستربچ و افزودنی.") for a strong,
// confirmed buyer - falls back to the general scores.reasonFa for every
// other case, exactly as before.
function firstIndustryLabel(evidence) {
  const hit = evidence.find((e) => e.evidenceType === 'industry_keyword')
  return hit ? hit.value.split(' — ')[0] : null
}

function buildBuyerFitReasonFa(evidence) {
  const industryLabel = firstIndustryLabel(evidence)
  return `تولیدکننده مستقیم${industryLabel ? ` ${industryLabel}` : ' محصولات پلیمری'}؛ مصرف‌کننده بالقوه مستربچ و افزودنی.`
}

// 23D.3 "IMPORTANT SOURCE TRUST": OSM/Overpass data is community-mapped,
// not a first-party web result the way a Serper search hit resolving to a
// real live page is - a `website` TAG on an OSM node can be stale, wrong,
// or someone else's site. osmOverpass.js always sets source_url to the
// node's own openstreetmap.org permalink (never the company's site), which
// makes OSM-sourced rows reliably detectable here without threading the
// source/adapter type through the whole pipeline. An OSM-sourced
// entity_type=direct_company candidate can still reach 'qualified' exactly
// like any other, but is NOT eligible for the relaxed, identity-driven
// direct-company auto-promote gate below - it must clear the original,
// stricter isSafeToAutoPromote() (real score bar, real contact info, the
// admin's own confidence setting) to auto-promote at all.
function isOsmSourced(candidate) {
  return typeof candidate.source_url === 'string' && candidate.source_url.includes('openstreetmap.org')
}

export function qualifyCandidate({ candidate, evidence, scores, settings }) {
  const entityType = matchedEntityType(evidence)
  const buyerFit = matchedBuyerFit(evidence)
  const identity = matchedIdentity(evidence)
  // "FINAL AUTONOMY BLOCKER" round, section 6: the ONE gate every
  // auto-promote path uses - verified OR strong-probable identity only, see
  // identityResolution.js's isPromotableIdentity(). No exceptions.
  const hasResolvedIdentity = isPromotableIdentity(identity)

  // Item 5C/6: a confirmed directory/article/marketplace/social/video page
  // is NEVER treated as a company in its own right, no matter what else its
  // evidence says - capped at manual_review (still a genuine discovery
  // lead - e.g. a directory page might list more real manufacturers worth
  // following up on by hand) and never auto-promotable. Checked FIRST, so
  // it can never be overridden by an otherwise-high score.
  if (isNonCompanyEntityType(entityType)) {
    return {
      status: 'manual_review',
      reason: `${ENTITY_TYPE_LABELS_FA[entityType] || 'صفحه غیرشرکتی'} است؛ خود این صفحه یک شرکت مستقل محسوب نمی‌شود - ممکن است به‌عنوان منبع کشف بیشتر مفید باشد.`,
      autoPromotable: false,
    }
  }

  const hasIndustryEvidence = evidence.some(
    (e) => e.evidenceType === 'industry_keyword' || e.evidenceType === 'generic_manufacturing_signal' || e.evidenceType === 'structured_industrial_signal',
  )
  // "FINAL REGRESSION FIX" round, item 2: read back the SAME
  // hasStrongNegative evidenceEngine.js already computed (including its
  // retail_only-with-production-language exemption) instead of
  // independently re-deriving a second, possibly-disagreeing copy here.
  const hasStrongNegative = matchedHasStrongNegative(evidence)
  // A directory-sourced candidate may have nothing but a name (no
  // description at all) - judging "is there enough to go on" purely from
  // business_description would wrongly call every such record "incomplete."
  const textLength = `${candidate.business_description || ''} ${candidate.raw_name || ''}`.trim().length
  const hasUsableContact = Boolean(candidate.mobile || candidate.phone || candidate.email)
  // 23D.3: root cause of the "auto_promotable=0" bug - most real Serper
  // snippets never contain a parseable phone/email at all, so
  // hasUsableContact was false for nearly every candidate regardless of how
  // strong everything else was. For the direct-company/buyer-fit-driven
  // auto-promote gate specifically, a confirmed company-owned WEBSITE is
  // itself a legitimate, actionable contact channel (a contact form, an
  // "about us" page) - kept as a SEPARATE variable, never used for the
  // stricter generic/OSM gates below, which still require real phone/
  // mobile/email exactly as before.
  const hasUsableContactOrWebsite = hasUsableContact || Boolean(candidate.website)

  if (hasStrongNegative && !hasIndustryEvidence) {
    return {
      status: 'rejected',
      reason: 'این کسب‌وکار بیشتر شبیه خرده‌فروشی یا فعالیتی غیرمرتبط است و شواهدی از تولید صنعتی پلیمر یافت نشد.',
      autoPromotable: false,
    }
  }

  // Section D (mandatory architectural rule): ABSENCE of evidence is never
  // treated as NEGATIVE evidence. A candidate with no strong negative
  // signal AND no matched industry keyword is simply UNCERTAIN - it goes to
  // manual_review either way now, regardless of how much text there is.
  // Rejection is reserved exclusively for the affirmative-negative-evidence
  // branch above (hasStrongNegative && !hasIndustryEvidence) - "no target
  // keyword matched" on its own used to fall through to REJECTED here too,
  // which is exactly the "false negative loses a real customer" failure
  // mode this whole audit exists to fix (see kadousplastic.com/
  // arapolymerco.com in the 23D-FINAL report, both of which had real
  // structured evidence the OLD taxonomy simply didn't recognize yet).
  if (!hasIndustryEvidence) {
    return {
      status: 'manual_review',
      reason:
        textLength < MIN_TEXT_LENGTH_TO_JUDGE
          ? 'اطلاعات موجود برای تشخیص کافی نیست - نیازمند بررسی دستی.'
          : 'شواهد صریحی از تولید یا فرآوری مواد پلیمری یافت نشد - این می‌تواند به معنای عدم ارتباط یا صرفاً کمبود اطلاعات باشد؛ نیازمند بررسی دستی یا غنی‌سازی بیشتر است.',
      autoPromotable: false,
    }
  }

  // 23D.2/23D.3: a confirmed direct_company (or otherwise-real) entity that
  // is a trade association, machinery/production-line vendor, research/
  // consultancy outfit, or medical/cosmetic business ("جراح پلاستیک" must
  // never gain polymer buyer-fit from the word "پلاستیک") is polymer-
  // industry-ADJACENT but never itself a likely buyer - capped at
  // manual_review, never auto-promotable, regardless of how much polymer-
  // industry language it uses. Checked AFTER the strong-negative/no-
  // industry-evidence rejection above, so e.g. a retail shop with zero
  // industry evidence is still correctly REJECTED, not merely deprioritized
  // to manual_review.
  if (buyerFit === 'not_buyer') {
    const nonBuyerEvidence = evidence.find((e) => e.evidenceType === 'non_buyer_organization')
    return {
      status: 'manual_review',
      reason: `فعال در صنعت پلیمر است اما ${nonBuyerEvidence?.meta?.nonBuyerLabel || 'مصرف‌کننده مستقیم مواد پلیمری نیست'} و مصرف‌کننده مستقیم مواد محسوب نمی‌شود.`,
      autoPromotable: false,
    }
  }

  // Item 5A/6: a CONFIRMED direct-company result with real industry
  // evidence and no strong negative signal reaches 'qualified' at the new,
  // much lower bar - even at only medium confidence. Auto-promotion is
  // decided completely separately, right below, and still needs the full
  // original (admin-configurable) bar.
  if (entityType === 'direct_company' && scores.overallScore >= DIRECT_COMPANY_QUALIFY_MIN_SCORE && !hasStrongNegative) {
    // 23D.3: a low-confidence candidate (a weak, non-strong negative signal
    // dragged confidence down, or too few distinct industry matches) only
    // stays 'qualified' when buyer_fit=high - which already bundles exactly
    // the "unusually strong deterministic evidence" the spec asks for
    // (confirmed company-owned domain + explicit manufacturer language +
    // real matched industry evidence, see buyerFit.js). Otherwise it drops
    // back to manual_review rather than diluting 'qualified' with weak
    // low-confidence rows.
    if (scores.confidence === 'low' && buyerFit !== 'high') {
      return {
        status: 'manual_review',
        reason: `${scores.reasonFa} اطمینان کم است و شواهد کافی برای تایید قطعی وجود ندارد - بررسی دستی توصیه می‌شود.`,
        autoPromotable: false,
      }
    }
    return {
      status: 'qualified',
      reason: buyerFit === 'high' ? buildBuyerFitReasonFa(evidence) : scores.reasonFa,
      autoPromotable: isOsmSourced(candidate)
        ? isSafeToAutoPromote({ scores, settings, hasUsableContact, buyerFit, hasResolvedIdentity })
        : isSafeToAutoPromoteDirectCompany({ scores, hasUsableContact: hasUsableContactOrWebsite, buyerFit, hasResolvedIdentity }),
    }
  }

  const meetsAutoScore = scores.overallScore >= (settings?.min_score_auto_promote ?? 80)
  const requiredConfidence = settings?.min_confidence_auto_promote ?? 'high'
  const meetsAutoConfidence =
    requiredConfidence === 'medium' ? scores.confidence === 'high' || scores.confidence === 'medium' : scores.confidence === 'high'

  if (meetsAutoScore && meetsAutoConfidence && hasUsableContact) {
    return {
      status: 'qualified',
      reason: buyerFit === 'high' ? buildBuyerFitReasonFa(evidence) : scores.reasonFa,
      autoPromotable: isSafeToAutoPromote({ scores, settings, hasUsableContact, buyerFit, hasResolvedIdentity }),
    }
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
