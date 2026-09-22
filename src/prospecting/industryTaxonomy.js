// ---------------------------------------------------------------------------
// Phase 23 - the configurable target-industry taxonomy. This list is
// explicitly NOT exhaustive and NOT hardcoded into the scoring/evidence
// engines' logic - both only ever iterate this array, so adding a new
// target industry later means adding one entry here, never touching
// evidenceEngine.js/scoringEngine.js.
//
// Every keyword is a POSITIVE signal that a company manufactures/processes
// polymer materials in a way that plausibly consumes masterbatch, pigments
// or polymer additives - never a guess about what they currently buy.
// ---------------------------------------------------------------------------

export const TARGET_INDUSTRIES = [
  {
    key: 'plastic_film',
    label: 'فیلم پلاستیک',
    keywords: ['فیلم پلی اتیلن', 'فیلم پلاستیک', 'نایلون', 'تولید فیلم', 'اکستروژن فیلم'],
    productFit: ['مستربچ سفید', 'مستربچ مشکی', 'مستربچ رنگی'],
  },
  {
    key: 'agricultural_film',
    label: 'فیلم کشاورزی',
    keywords: ['فیلم کشاورزی', 'مالچ', 'پوشش گلخانه', 'نایلون گلخانه'],
    productFit: ['مستربچ ضد UV', 'مستربچ مشکی'],
  },
  {
    key: 'shrink_film',
    label: 'فیلم شرینک',
    keywords: ['شرینک', 'فیلم انقباضی'],
    productFit: ['مستربچ شفاف', 'افزودنی پلیمری'],
  },
  {
    key: 'packaging',
    label: 'بسته‌بندی پلاستیکی',
    keywords: ['بسته بندی پلاستیک', 'نایلکس', 'کیسه پلاستیک', 'ظروف بسته بندی', 'تولید کیسه'],
    productFit: ['مستربچ رنگی', 'مستربچ سفید'],
  },
  {
    key: 'pe_pipe',
    label: 'لوله پلی‌اتیلن',
    // 23D.3 - 'اتصالات پلی اتیلن' (PE pipe FITTINGS) added: a real direct
    // manufacturer of PE pipe/fittings is a direct polymer processor and
    // normally a likely masterbatch/additive consumer.
    keywords: ['لوله پلی اتیلن', 'اتصالات پلی اتیلن', 'لوله پلیمری', 'تولید لوله', 'لوله پلاستیک'],
    productFit: ['مستربچ مشکی', 'افزودنی ضد UV'],
  },
  {
    key: 'irrigation_tape',
    label: 'نوار آبیاری',
    keywords: ['نوار آبیاری', 'تیپ آبیاری', 'آبیاری قطره ای'],
    productFit: ['مستربچ مشکی', 'افزودنی ضد UV'],
  },
  {
    key: 'hose',
    label: 'شیلنگ صنعتی',
    keywords: ['شیلنگ صنعتی', 'تولید شیلنگ', 'هوز پلاستیک'],
    productFit: ['مستربچ رنگی', 'افزودنی پلیمری'],
  },
  {
    key: 'injection_molding',
    label: 'قالب‌گیری تزریقی',
    // 23D-FINAL, section A (کادوس پلاستیک آریا false negative) - "به روش
    // تزریقی" ("via the injection method") is a real, common OSM/structured-
    // description phrasing that the older, narrower "تزریق پلاستیک" phrase
    // never matched.
    // "قطعات پلاستیکی" added - a very common, direct Persian phrase for
    // "plastic parts/components" (the FARZAM BASPAR false negative in the
    // 23D-FINAL audit), almost always the output of injection molding.
    keywords: ['تزریق پلاستیک', 'قالب گیری تزریقی', 'ماشین تزریق', 'انژکسیون پلاستیک', 'روش تزریقی', 'تزریقی', 'قطعات پلاستیکی'],
    productFit: ['مستربچ رنگی', 'مستربچ سفید'],
  },
  {
    key: 'household_plastics',
    label: 'لوازم خانگی پلاستیکی',
    keywords: ['لوازم خانگی پلاستیکی', 'ظروف پلاستیکی خانگی', 'تولید ظروف پلاستیک'],
    productFit: ['مستربچ رنگی'],
  },
  {
    key: 'disposable_plastic',
    label: 'ظروف یکبار مصرف',
    keywords: ['ظروف یکبار مصرف', 'لیوان یکبار مصرف', 'تولید یکبار مصرف'],
    productFit: ['مستربچ سفید', 'مستربچ رنگی'],
  },
  {
    key: 'toys',
    label: 'اسباب‌بازی',
    keywords: ['اسباب بازی', 'تولید اسباب بازی'],
    productFit: ['مستربچ رنگی'],
  },
  {
    key: 'pet_products',
    label: 'محصولات PET',
    keywords: ['بطری pet', 'پریفرم', 'تولید بطری'],
    productFit: ['مستربچ شفاف', 'افزودنی پلیمری'],
  },
  {
    key: 'pc_abs',
    label: 'ورق و قطعات ABS/PC',
    keywords: ['پلی کربنات', 'ورق pc', 'abs', 'قطعات پلی کربنات'],
    productFit: ['مستربچ رنگی ABS/PC'],
  },
  {
    key: 'compounders',
    label: 'کامپاند پلیمری',
    keywords: ['کامپاند پلیمر', 'کامپاندینگ', 'مستربچ کامپاند'],
    productFit: ['افزودنی پلیمری', 'مستربچ سفارشی'],
  },
  {
    key: 'extrusion',
    label: 'اکستروژن',
    keywords: ['اکستروژن', 'اکسترودر', 'خط اکستروژن'],
    productFit: ['مستربچ رنگی', 'افزودنی پلیمری'],
  },
  {
    key: 'blow_molding',
    label: 'قالب‌گیری بادی',
    // 23D-FINAL, section A - "به روش بادی" mirrors the injection_molding fix
    // above for the same real-world OSM/structured-description phrasing.
    keywords: ['قالب بادی', 'بلومولدینگ', 'تولید دمشی', 'روش بادی'],
    productFit: ['مستربچ رنگی', 'مستربچ سفید'],
  },
  {
    key: 'rotational_molding',
    label: 'قالب‌گیری دورانی',
    keywords: ['روتاسیونال مولدینگ', 'قالب گیری دورانی', 'تولید دوار'],
    productFit: ['مستربچ مشکی', 'افزودنی ضد UV'],
  },
  {
    key: 'profiles',
    label: 'پروفیل پلاستیک',
    keywords: ['پروفیل پلاستیک', 'پروفیل یو پی وی سی', 'upvc', 'پروفیل پلیمری'],
    productFit: ['مستربچ رنگی'],
  },
  {
    key: 'cable_compounds',
    label: 'کامپاند کابل',
    keywords: ['کامپاند کابل', 'روکش کابل', 'عایق کابل'],
    productFit: ['افزودنی پلیمری'],
  },
]

// A fallback signal for terse records (a directory listing's NAME is often
// the only text available, e.g. "کارخانه پلاستیک شاهین پلاست" - a real
// manufacturer name that mentions no specific product/process at all) -
// never as strong as an actual matched TARGET_INDUSTRIES keyword, but
// enough to avoid rejecting a plausible manufacturer just for lacking a
// detailed description. Requires BOTH a manufacturing-indicator word AND a
// generic polymer-material word to fire - "پلاستیک فروشی" (a plastic SHOP)
// has the material word but no manufacturing indicator, so it correctly
// does not qualify for this fallback.
// 23D-FINAL.1, section 4 (omidomranco.com false positive): a bare 'تولید'
// was tried here in 23D.3 to catch "تولید کننده" written WITH a space
// (OSM/structured descriptions often do), but bare 'تولید' alone is far
// too generic - "خط تولید نایلون گلخانه‌ای" (a greenhouse-film PRODUCTION
// LINE for sale, i.e. a machinery listing) contains it too, wrongly
// granting buyer_fit=high to a machinery vendor. Replaced with the exact
// "تولید کننده" (space-separated) phrase instead - it still catches the
// real کادوس پلاستیک آریا wording ("تولید کننده انواع قطعات...") without
// matching every generic mention of "تولید" anywhere.
export const MANUFACTURING_INDICATOR_TERMS = ['کارخانه', 'صنایع', 'تولیدی', 'تولیدکننده', 'تولید کننده', 'تولید و', 'کارگاه تولید', 'گروه صنعتی']
export const GENERIC_POLYMER_TERMS = ['پلاستیک', 'پلیمر', 'پلی اتیلن', 'پی وی سی', 'pvc', 'پلی پروپیلن']

// Companies that MAKE masterbatch/pigments themselves are a possible
// competitor or supplier, not automatically a customer - flagged as a
// caution signal (reduces confidence, never a hard rejection, since many
// compounders both make and consume different grades).
export const COMPETITOR_SUPPLIER_KEYWORDS = ['تولیدکننده مستربچ', 'تولید مسترچ', 'کارخانه مستربچ']

// A negative_signal evidence item at or below this weight is a STRONG
// negative - shared here (not duplicated as a private constant in both
// evidenceEngine.js and qualification.js) so there is exactly ONE place
// that decides what "strong" means for a NEGATIVE_SIGNALS weight, never two
// independently-maintained copies that could silently drift apart (see the
// "FINAL REGRESSION FIX" round's unified hasStrongNegative computation in
// evidenceEngine.js for why that split-brain risk is exactly what caused an
// earlier business_role/buyer_fit contradiction bug).
export const STRONG_NEGATIVE_WEIGHT_THRESHOLD = -25

// Negative signals - businesses that are unlikely to be industrial polymer
// consumers regardless of how many positive keywords also appear.
//
// "FINAL PRODUCTION GATE" round - a signal may set `exemptWhenProduction:
// true`: evidenceEngine.js's hasStrongNegative computation skips it
// entirely when the SAME text also independently self-identifies as a
// producer (a MANUFACTURING_INDICATOR_TERMS match, e.g. "کارخانه"/
// "تولیدکننده"). Reserved for words that are genuinely AMBIGUOUS between
// "this business is X" and "this manufacturer also mentions X as routine
// marketing copy" - never for a category that, by itself, describes a
// fundamentally different (non-manufacturing) kind of business (medical,
// restaurant/hotel, a dedicated accounting/legal firm - those stay hard
// negatives regardless of any co-occurring "تولید" wording).
export const NEGATIVE_SIGNALS = [
  { key: 'retail_only', label: 'خرده‌فروشی', keywords: ['فروشگاه', 'خرده فروشی', 'نمایندگی فروش'], weight: -25, exemptWhenProduction: true },
  { key: 'trading_only', label: 'صرفاً بازرگانی/واردات', keywords: ['بازرگانی', 'واردات', 'صادرات و واردات', 'وارد کننده'], weight: -10 },
  { key: 'agency', label: 'آژانس/خدمات غیرمرتبط', keywords: ['آژانس تبلیغاتی', 'دیجیتال مارکتینگ', 'حسابداری', 'وکالت'], weight: -30 },
  // bare "مشاوره" (consultation) split out of 'agency' above - a real
  // production example ("کارخانه تولید قطعات پلاستیکی خودرو (مشاوره رایگان
  // + قیمت)") showed it is one of the single most common Iranian
  // manufacturer marketing CTAs ("مشاوره رایگان" = "free consultation,"
  // i.e. "call us for advice about our OWN products"), not proof of being a
  // standalone consulting/advisory firm. A genuine consulting agency (no
  // manufacturing self-identification anywhere on its own page) is still
  // correctly flagged; a real factory that also offers free advice is not.
  { key: 'generic_commercial_cta', label: 'زبان تجاری عمومی (مشاوره/خرید/قیمت)', keywords: ['مشاوره'], weight: -30, exemptWhenProduction: true },
  { key: 'unrelated_business', label: 'کسب‌وکار نامرتبط', keywords: ['رستوران', 'هتل', 'آرایشگاه', 'کافه'], weight: -40 },
  // 23D.3 - the word "پلاستیک" alone must never imply polymer manufacturing
  // when the actual subject is medical/cosmetic ("جراح پلاستیک" = plastic
  // SURGEON, not a plastics company). A strong, unconditional negative -
  // weight below STRONG_NEGATIVE_WEIGHT_THRESHOLD so it forces rejection
  // whenever no genuine industry evidence is also present.
  {
    key: 'medical_cosmetic',
    label: 'پزشکی/زیبایی (نه صنعت پلیمر)',
    // "FINAL AUTONOMY BLOCKER" round, section 5B: bare "کلینیک" removed -
    // see the matching buyerFit.js NON_BUYER_ORG_SIGNALS entry for the full
    // rationale (a plain service/repair center like "کلینیک تاسیسات
    // ساختمانی" is not medical just because it uses the word "کلینیک").
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
    weight: -50,
  },
]

export function findMatchingKeywords(text, keywords) {
  const t = text || ''
  return keywords.filter((kw) => t.includes(kw))
}
