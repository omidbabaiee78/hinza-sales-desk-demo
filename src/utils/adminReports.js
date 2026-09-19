import { gregorianIsoToJalaali, PERSIAN_MONTHS } from './jalali'
import { isInvoiceOpen, calcInvoicePaid, calcInvoiceRemaining } from './invoice'
import { isWithinRange } from './reportPeriods'

// ---- basic row filtering -------------------------------------------------

export function filterByRange(rows, dateField, from, to) {
  return rows.filter((row) => isWithinRange(row[dateField], from, to))
}

function applyCompanyFilter(invoices, companyId) {
  if (!companyId) return invoices
  return invoices.filter((inv) => inv.company_id === companyId)
}

function applyProductFilter(invoiceItems, productCode) {
  if (!productCode) return invoiceItems
  return invoiceItems.filter((item) => item.product_code === productCode)
}

// ---- summary card numbers -------------------------------------------------

function sumNonCancelledInvoiceTotals(invoices) {
  return invoices
    .filter((inv) => inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + (Number(inv.total_rial) || 0), 0)
}

function sumInvoiceItemLineTotals(items, invoicesById) {
  return items.reduce((sum, item) => {
    const invoice = invoicesById.get(item.invoice_id)
    if (invoice?.status === 'cancelled') return sum
    return sum + (Number(item.line_total_rial) || 0)
  }, 0)
}

function nonCancelledInvoiceCount(invoices) {
  return invoices.filter((inv) => inv.status !== 'cancelled').length
}

export function sumPayments(payments) {
  return payments.reduce((sum, p) => sum + (Number(p.amount_rial) || 0), 0)
}

// A product filter narrows "فروش دوره" to that product's own line-item
// revenue (an invoice total can't be meaningfully attributed to one of
// several products on it); a company filter just narrows which invoices
// count, since every invoice already belongs to exactly one company.
export function computePeriodSales({ periodInvoices, periodInvoiceItems, invoicesById, productFilter }) {
  if (productFilter) {
    return sumInvoiceItemLineTotals(applyProductFilter(periodInvoiceItems, productFilter), invoicesById)
  }
  return sumNonCancelledInvoiceTotals(periodInvoices)
}

export function computeAverageInvoiceAmount(periodInvoices) {
  const count = nonCancelledInvoiceCount(periodInvoices)
  if (count === 0) return null
  return Math.round(sumNonCancelledInvoiceTotals(periodInvoices) / count)
}

// Avoids a meaningless "infinity%" or NaN when the previous period had no
// activity at all - callers should show a neutral message instead in that case.
export function percentChange(current, previous) {
  if (!previous) return null
  const percent = ((current - previous) / previous) * 100
  return Math.round(percent * 10) / 10
}

export { applyCompanyFilter, applyProductFilter }

// ---- sales trend ----------------------------------------------------------

function bucketKey(isoTimestamp, granularity) {
  const day = String(isoTimestamp).slice(0, 10)
  return granularity === 'day' ? day : day.slice(0, 7)
}

function bucketLabel(key, granularity) {
  if (granularity === 'day') {
    const { jm, jd } = gregorianIsoToJalaali(key)
    return `${jd} ${PERSIAN_MONTHS[jm - 1]}`
  }
  const midMonthIso = `${key}-15`
  const { jy, jm } = gregorianIsoToJalaali(midMonthIso)
  return `${PERSIAN_MONTHS[jm - 1]} ${jy}`
}

export function buildSalesTrend(periodInvoices, periodPayments, granularity) {
  const salesByBucket = new Map()
  const paymentsByBucket = new Map()

  for (const inv of periodInvoices) {
    if (inv.status === 'cancelled' || !inv.issued_at) continue
    const key = bucketKey(inv.issued_at, granularity)
    salesByBucket.set(key, (salesByBucket.get(key) || 0) + (Number(inv.total_rial) || 0))
  }
  for (const payment of periodPayments) {
    if (!payment.paid_at) continue
    const key = bucketKey(payment.paid_at, granularity)
    paymentsByBucket.set(key, (paymentsByBucket.get(key) || 0) + (Number(payment.amount_rial) || 0))
  }

  const keys = [...new Set([...salesByBucket.keys(), ...paymentsByBucket.keys()])].sort()
  return keys.map((key) => ({
    key,
    label: bucketLabel(key, granularity),
    sales: salesByBucket.get(key) || 0,
    payments: paymentsByBucket.get(key) || 0,
  }))
}

// ---- top customers ---------------------------------------------------------

export function buildTopCustomers(periodInvoices, allPayments, companiesById, limit = 8) {
  const byCompany = new Map()

  for (const inv of periodInvoices) {
    if (inv.status === 'cancelled') continue
    const entry = byCompany.get(inv.company_id) || {
      companyId: inv.company_id,
      invoiceCount: 0,
      salesRial: 0,
      invoiceIds: [],
    }
    entry.invoiceCount += 1
    entry.salesRial += Number(inv.total_rial) || 0
    entry.invoiceIds.push(inv.id)
    byCompany.set(inv.company_id, entry)
  }

  const paymentsByInvoiceId = new Map()
  for (const payment of allPayments) {
    const list = paymentsByInvoiceId.get(payment.invoice_id) || []
    list.push(payment)
    paymentsByInvoiceId.set(payment.invoice_id, list)
  }

  const rows = [...byCompany.values()].map((entry) => ({
    companyId: entry.companyId,
    companyName: companiesById.get(entry.companyId)?.name || 'مشتری نامشخص',
    invoiceCount: entry.invoiceCount,
    salesRial: entry.salesRial,
    // "پرداخت‌شده": how much of THIS period's invoiced amount has been paid
    // so far (as of now) - the same calcInvoicePaid() formula every other
    // invoice screen already uses, just summed across the company's
    // period invoices.
    paidRial: entry.invoiceIds.reduce(
      (sum, invoiceId) => sum + calcInvoicePaid(paymentsByInvoiceId.get(invoiceId) || []),
      0,
    ),
  }))

  rows.sort((a, b) => b.salesRial - a.salesRial)
  return rows.slice(0, limit)
}

// ---- top products -----------------------------------------------------------

// Every historical quantity in this system is implicitly kilograms - there
// is no per-line unit column on invoice_items (InvoiceItemsTable already
// hardcodes "کیلوگرم"), so there is no incompatible-unit mixing risk to
// guard against here. Ranking is by invoiced revenue, per the spec.
export function buildTopProducts(periodInvoiceItems, invoicesById, namesByCode, limit = 8) {
  const byCode = new Map()

  for (const item of periodInvoiceItems) {
    const invoice = invoicesById.get(item.invoice_id)
    if (!invoice || invoice.status === 'cancelled') continue
    const code = item.product_code || '—'
    const entry = byCode.get(code) || { code, quantityKg: 0, salesRial: 0 }
    entry.quantityKg += Number(item.quantity) || 0
    entry.salesRial += Number(item.line_total_rial) || 0
    byCode.set(code, entry)
  }

  const rows = [...byCode.values()].map((entry) => ({
    ...entry,
    name: namesByCode.get(entry.code) || 'محصول نامشخص',
  }))

  rows.sort((a, b) => b.salesRial - a.salesRial)
  return rows.slice(0, limit)
}

// ---- order status summary ---------------------------------------------------

const STATUS_TO_GROUP = {
  pending_review: 'در انتظار اقدام',
  quoted: 'منتظر مشتری',
  customer_approved: 'در حال انجام',
  admin_approved: 'در حال انجام',
  preparing: 'در حال انجام',
  ready_for_delivery: 'در حال انجام',
  delivered: 'تحویل‌شده',
  rejected: 'لغو / رد شده',
  cancelled: 'لغو / رد شده',
}

const STATUS_GROUP_ORDER = [
  'در انتظار اقدام',
  'منتظر مشتری',
  'در حال انجام',
  'تحویل‌شده',
  'لغو / رد شده',
]

export function buildOrderStatusSummary(periodOrders) {
  const counts = new Map(STATUS_GROUP_ORDER.map((group) => [group, 0]))
  for (const order of periodOrders) {
    const group = STATUS_TO_GROUP[order.status] || 'در حال انجام'
    counts.set(group, (counts.get(group) || 0) + 1)
  }
  return STATUS_GROUP_ORDER.map((group) => ({ group, count: counts.get(group) || 0 }))
}

// ---- conversion -------------------------------------------------------------

// Honest, explicitly-defined cohort metric: of the orders PLACED in this
// period, what share have reached 'delivered' AS OF NOW. This is
// deliberately not "delivered within the period" - a recently-placed order
// may simply still be in progress, and the UI must say so rather than
// implying a low rate means lost sales.
export function buildConversionMetric(periodOrders) {
  const denominator = periodOrders.length
  if (denominator === 0) return null
  const numerator = periodOrders.filter((order) => order.status === 'delivered').length
  return {
    numerator,
    denominator,
    ratePercent: Math.round((numerator / denominator) * 1000) / 10,
  }
}

// ---- outstanding / open invoices ---------------------------------------------

// Always a CURRENT snapshot (never period-filtered) - an old unpaid
// invoice is exactly what management needs to see regardless of which
// sales period is selected. Customer/product filters still apply.
export function buildOutstandingInvoices(allInvoices, allPayments, companiesById) {
  const paymentsByInvoiceId = new Map()
  for (const payment of allPayments) {
    const list = paymentsByInvoiceId.get(payment.invoice_id) || []
    list.push(payment)
    paymentsByInvoiceId.set(payment.invoice_id, list)
  }

  const todayIso = new Date().toISOString().slice(0, 10)

  return allInvoices
    .filter((inv) => isInvoiceOpen(inv.status))
    .map((inv) => {
      const paidRial = calcInvoicePaid(paymentsByInvoiceId.get(inv.id) || [])
      return {
        ...inv,
        companyName: companiesById.get(inv.company_id)?.name || 'مشتری نامشخص',
        paidRial,
        remainingRial: calcInvoiceRemaining(inv.total_rial, paidRial),
        isOverdue: Boolean(inv.due_date && inv.due_date < todayIso),
      }
    })
    .sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
      return (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99')
    })
}

// ---- detailed sales/invoice table ---------------------------------------------

export function buildInvoiceTableRows(periodInvoices, allPayments, companiesById) {
  const paymentsByInvoiceId = new Map()
  for (const payment of allPayments) {
    const list = paymentsByInvoiceId.get(payment.invoice_id) || []
    list.push(payment)
    paymentsByInvoiceId.set(payment.invoice_id, list)
  }

  return periodInvoices
    .map((inv) => {
      const paidRial = calcInvoicePaid(paymentsByInvoiceId.get(inv.id) || [])
      return {
        ...inv,
        companyName: companiesById.get(inv.company_id)?.name || 'مشتری نامشخص',
        paidRial,
        remainingRial: calcInvoiceRemaining(inv.total_rial, paidRial),
      }
    })
    .sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''))
}
