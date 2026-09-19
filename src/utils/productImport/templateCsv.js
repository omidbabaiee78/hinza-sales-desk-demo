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

function toCsvValue(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildProductImportTemplateCsv() {
  return [TEMPLATE_HEADERS, EXAMPLE_ROW]
    .map((row) => row.map(toCsvValue).join(','))
    .join('\r\n')
}

// A UTF-8 BOM prefix keeps Excel from mangling Persian text when it opens
// the downloaded CSV.
export function downloadProductImportTemplate() {
  const csv = buildProductImportTemplateCsv()
  const bom = String.fromCharCode(0xfeff)
  const blob = new Blob([`${bom}${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'نمونه-ورود-گروهی-محصولات.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
