import { buildCsv, downloadCsv } from './csv'
import { formatJalaliDate } from './formatters'
import { invoiceStatusLabel } from './invoice'

// Only display-safe, already-visible-in-the-UI fields are exported - no
// internal ids, no auth data, nothing beyond what the report itself shows.
// Respects whatever date/customer/product filters produced these rows.
export function buildReportExportCsv({ invoiceRows, topCustomers, topProducts }) {
  const sections = []

  sections.push(['فاکتورها و فروش'])
  sections.push([
    'تاریخ',
    'شماره فاکتور',
    'مشتری',
    'مبلغ کل (ریال)',
    'وضعیت',
    'پرداخت‌شده (ریال)',
    'مانده (ریال)',
  ])
  for (const invoice of invoiceRows) {
    sections.push([
      formatJalaliDate(invoice.issued_at),
      invoice.invoice_number ?? '',
      invoice.companyName,
      invoice.total_rial,
      invoiceStatusLabel(invoice.status),
      invoice.paidRial,
      invoice.remainingRial,
    ])
  }
  sections.push([])

  sections.push(['خلاصه مشتریان'])
  sections.push(['مشتری', 'تعداد فاکتور', 'فروش دوره (ریال)', 'پرداخت‌شده (ریال)'])
  for (const customer of topCustomers) {
    sections.push([customer.companyName, customer.invoiceCount, customer.salesRial, customer.paidRial])
  }
  sections.push([])

  sections.push(['خلاصه محصولات'])
  sections.push(['کد محصول', 'نام محصول', 'مقدار (کیلوگرم)', 'فروش (ریال)'])
  for (const product of topProducts) {
    sections.push([product.code, product.name, product.quantityKg, product.salesRial])
  }

  return buildCsv(sections)
}

export function downloadReportExport(payload) {
  const stamp = new Date().toISOString().slice(0, 10)
  downloadCsv(`گزارش-فروش-هینزا-${stamp}.csv`, buildReportExportCsv(payload))
}
