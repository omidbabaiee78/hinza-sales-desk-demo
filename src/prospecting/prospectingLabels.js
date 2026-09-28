export const CANDIDATE_STATUS_LABELS = {
  new: 'جدید',
  enriching: 'در حال بررسی',
  qualified: 'واجد شرایط',
  rejected: 'رد شده',
  duplicate: 'تکراری',
  promoted: 'واردشده به لیدها',
  manual_review: 'نیازمند بررسی',
}
export function candidateStatusLabel(status) {
  return CANDIDATE_STATUS_LABELS[status] || status
}

// Where a candidate stands (candidateQueue.js buildCandidateQueue).
export const QUEUE_STATE_LABELS = {
  waiting: 'در انتظار بررسی خودکار',
  eligible: 'واجد شرایط، در انتظار ثبت خودکار',
  attention: 'نیازمند بررسی شما',
  registered: 'ثبت‌شده در سرنخ‌ها',
  closed: 'رد شده یا تکراری',
}
export function queueStateLabel(key) {
  return QUEUE_STATE_LABELS[key] || key
}

// Why the site step could not decide on its own (site_review_reason).
export const REVIEW_REASON_LABELS = {
  site_unreadable: 'صفحه اصلی وب‌سایت متن کافی برای تشخیص فعالیت ندارد.',
  site_unreachable: 'وب‌سایت پس از چند تلاش باز نشد.',
  not_iranian: 'معلوم نیست شرکت ایرانی باشد.',
  insufficient_evidence: 'وب‌سایت شرکت است، اما شواهد کافی از تولید یا فرآوری پلاستیک ندارد.',
  name_unclear: 'نام شرکت از وب‌سایت قابل تشخیص نیست.',
  conflicting_signals: 'وب‌سایت می‌گوید محصول پلاستیکی تولید می‌کند، اما نشانه‌ای از غیرمشتری بودن هم دارد (مثلاً انجمن، مشاوره یا واژه‌ای نامرتبط).',
  possible_duplicate:'نام آن شبیه یک سرنخ ثبت‌شده است؛ ممکن است همان شرکت باشد.',
  no_website: 'وب‌سایتی برای بررسی خودکار ندارد.',
  other: 'بررسی خودکار نتیجه قطعی نداد.',
}
export function reviewReasonLabel(reason) {
  return REVIEW_REASON_LABELS[reason] || REVIEW_REASON_LABELS.other
}

// Why the site step rejected a candidate (stored as rejection_reason).
export const SITE_REJECT_REASON_LABELS = {
  not_company_page: 'صفحه مقاله، فهرست مشاغل، بازارچه یا شبکه اجتماعی است، نه وب‌سایت یک شرکت.',
  not_company: 'وب‌سایت ثبت‌شده متعلق به خود شرکت نیست.',
  machinery_seller: 'فروشنده یا سازنده ماشین‌آلات است، نه تولیدکننده محصول پلاستیکی.',
  listing_site: 'وب‌سایت یک فهرست، پرتال یا آگهی است.',
  raw_material_trader: 'فروشنده مواد اولیه است، نه مصرف‌کننده.',
  unrelated_business: 'فعالیت وب‌سایت (مثلاً نرم‌افزار) به تولید پلاستیک ربطی ندارد.',
  site_not_company: 'وب‌سایت، وب‌سایت یک شرکت تولیدی نیست.',
  no_polymer_signal_on_site: 'در وب‌سایت نشانه‌ای از تولید یا فرآوری پلاستیک و پلیمر نیست.',
  not_buyer: 'بر اساس وب‌سایت، مشتری مواد پلیمری نیست.',
}
export function siteRejectReasonLabel(reason) {
  return SITE_REJECT_REASON_LABELS[reason] || 'بر اساس وب‌سایت رد شد.'
}

export const CONFIDENCE_LABELS = {
  high: 'اطمینان بالا',
  medium: 'اطمینان متوسط',
  low: 'اطمینان کم',
  manual_review: 'نیازمند بررسی',
}
export function confidenceLabel(confidence) {
  return CONFIDENCE_LABELS[confidence] || 'نامشخص'
}

export const EVIDENCE_TYPE_LABELS = {
  industry_keyword: 'شواهد صنعت مرتبط',
  possible_competitor_supplier: 'احتمال تولیدکننده/رقیب',
  negative_signal: 'نشانه منفی',
  active_website: 'وب‌سایت فعال',
  factory_address: 'آدرس کارخانه',
  industrial_phone: 'تلفن صنعتی',
  mobile_contact: 'موبایل تماس',
  source_directory_listing: 'ثبت در فهرست منبع',
  generic_manufacturing_signal: 'نشانه عمومی تولید',
  direct_company_site: 'وب‌سایت مستقیم شرکت',
  non_company_content: 'محتوای غیرشرکتی (مقاله/فهرست/شبکه اجتماعی/...)',
  query_or_label_hint: 'برچسب/عبارت جستجوی مرتبط',
  non_buyer_organization: 'سازمان غیرمصرف‌کننده (انجمن/تامین‌کننده تجهیزات/پژوهشی)',
  buyer_fit_assessment: 'ارزیابی تناسب به‌عنوان مشتری (Buyer Fit)',
  structured_industrial_signal: 'شواهد ساختاریافته صنعتی (از منبع)',
  business_role_assessment: 'نقش کسب‌وکار (Business Role)',
}
export function evidenceTypeLabel(type) {
  return EVIDENCE_TYPE_LABELS[type] || type
}

export const SOURCE_TYPE_LABELS = {
  uploaded_dataset: 'داده آپلودشده',
  public_directory: 'فهرست عمومی',
  industrial_directory: 'فهرست صنعتی',
  search_result: 'نتیجه جستجو',
  company_website: 'وب‌سایت شرکت',
  trade_show_directory: 'فهرست نمایشگاهی',
  association_directory: 'فهرست انجمن صنفی',
  government_registry: 'ثبت دولتی',
  existing_database: 'پایگاه داده موجود',
  custom_api: 'API اختصاصی',
}
export function sourceTypeLabel(type) {
  return SOURCE_TYPE_LABELS[type] || type
}

export const RUN_STATUS_LABELS = {
  running: 'در حال اجرا',
  completed: 'تکمیل‌شده',
  failed: 'ناموفق',
  partial: 'ناقص (برخی خطا)',
}
export function runStatusLabel(status) {
  return RUN_STATUS_LABELS[status] || status
}

export const RUN_TYPE_LABELS = {
  manual: 'دستی',
  scheduled: 'زمان‌بندی‌شده (روزانه)',
}
export function runTypeLabel(type) {
  return RUN_TYPE_LABELS[type] || type
}
