import { buildCsv, downloadCsv } from '../csv'

const TEMPLATE_HEADERS = [
  'نام شرکت',
  'شخص تماس',
  'موبایل',
  'تلفن',
  'ایمیل',
  'وب‌سایت',
  'استان',
  'شهر',
  'صنعت',
  'محصول / نیاز',
  'منبع',
  'اولویت',
  'کانال ترجیحی',
  'تگ‌ها',
  'یادداشت',
]

// A made-up example row only - never real customer data.
const EXAMPLE_ROW = [
  'شرکت نمونه پلیمر',
  'آقای نمونه',
  '09120000000',
  '02100000000',
  'info@example.com',
  'example.com',
  'تهران',
  'تهران',
  'فیلم',
  'مستربچ سفید برای فیلم کشاورزی',
  'نمایشگاه',
  'متوسط',
  'واتساپ',
  'فیلم، تهران',
  'این یک ردیف نمونه برای راهنمایی قالب فایل است.',
]

export function buildLeadImportTemplateCsv() {
  return buildCsv([TEMPLATE_HEADERS, EXAMPLE_ROW])
}

export function downloadLeadImportTemplate() {
  downloadCsv('نمونه-ورود-گروهی-سرنخ‌ها.csv', buildLeadImportTemplateCsv())
}
