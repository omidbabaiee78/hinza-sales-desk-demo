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
