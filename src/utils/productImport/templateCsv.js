import { buildCsv, downloadCsv } from '../csv'

const TEMPLATE_HEADERS = [
  'کد',
  'نام محصول',
  'دسته‌بندی',
  'پایه',
  'کاربرد',
  'بسته‌بندی',
  'وضعیت',
  'توضیح',
  'نمایش',
  'مشخصات',
]

// A made-up example row only - never real business data.
const EXAMPLE_ROW = [
  '7101',
  'مستربچ سفید نمونه',
  'مستربچ سفید',
  'PE',
  'فیلم، تزریق',
  'کیسه ۲۵ کیلویی',
  'موجود',
  'این یک ردیف نمونه برای راهنمایی قالب فایل است.',
  'فعال',
  'TiO2=69% | LF=8',
]

export function buildProductImportTemplateCsv() {
  return buildCsv([TEMPLATE_HEADERS, EXAMPLE_ROW])
}

export function downloadProductImportTemplate() {
  downloadCsv('نمونه-ورود-گروهی-محصولات.csv', buildProductImportTemplateCsv())
}
