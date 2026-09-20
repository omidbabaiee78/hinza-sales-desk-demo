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
    keywords: ['لوله پلی اتیلن', 'لوله پلیمری', 'تولید لوله', 'لوله پلاستیک'],
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
    keywords: ['تزریق پلاستیک', 'قالب گیری تزریقی', 'ماشین تزریق', 'انژکسیون پلاستیک'],
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
    keywords: ['قالب بادی', 'بلومولدینگ', 'تولید دمشی'],
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
export const MANUFACTURING_INDICATOR_TERMS = ['کارخانه', 'صنایع', 'تولیدی', 'تولیدکننده', 'تولید و', 'کارگاه تولید', 'گروه صنعتی']
export const GENERIC_POLYMER_TERMS = ['پلاستیک', 'پلیمر', 'پلی اتیلن', 'پی وی سی', 'pvc', 'پلی پروپیلن']

// Companies that MAKE masterbatch/pigments themselves are a possible
// competitor or supplier, not automatically a customer - flagged as a
// caution signal (reduces confidence, never a hard rejection, since many
// compounders both make and consume different grades).
export const COMPETITOR_SUPPLIER_KEYWORDS = ['تولیدکننده مستربچ', 'تولید مسترچ', 'کارخانه مستربچ']

// Negative signals - businesses that are unlikely to be industrial polymer
// consumers regardless of how many positive keywords also appear.
export const NEGATIVE_SIGNALS = [
  { key: 'retail_only', label: 'خرده‌فروشی', keywords: ['فروشگاه', 'خرده فروشی', 'نمایندگی فروش'], weight: -25 },
  { key: 'trading_only', label: 'صرفاً بازرگانی/واردات', keywords: ['بازرگانی', 'واردات', 'صادرات و واردات', 'وارد کننده'], weight: -10 },
  { key: 'agency', label: 'آژانس/خدمات غیرمرتبط', keywords: ['آژانس تبلیغاتی', 'دیجیتال مارکتینگ', 'مشاوره', 'حسابداری', 'وکالت'], weight: -30 },
  { key: 'unrelated_business', label: 'کسب‌وکار نامرتبط', keywords: ['رستوران', 'هتل', 'آرایشگاه', 'کافه'], weight: -40 },
]

export function findMatchingKeywords(text, keywords) {
  const t = text || ''
  return keywords.filter((kw) => t.includes(kw))
}
