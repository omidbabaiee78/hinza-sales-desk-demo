export const INVOICE_STATUS_LABELS = {
  issued: 'صادر شده',
  partially_paid: 'بخشی پرداخت شده',
  paid: 'پرداخت شده',
  cancelled: 'لغو شده',
}

export const INVOICE_STATUS_TONE = {
  issued: 'neutral',
  partially_paid: 'warning',
  paid: 'success',
  cancelled: 'danger',
}

export function invoiceStatusLabel(status) {
  return INVOICE_STATUS_LABELS[status] || status
}

// Single source of truth for the paid/remaining formulas so both the admin
// and customer invoice views derive the same numbers from the same real
// payment rows, never a frontend-invented total.
export function calcInvoicePaid(payments) {
  return (payments || []).reduce((sum, p) => sum + (Number(p.amount_rial) || 0), 0)
}

export function calcInvoiceRemaining(totalRial, paidRial) {
  const remaining = (Number(totalRial) || 0) - (Number(paidRial) || 0)
  return remaining > 0 ? remaining : 0
}

// Gross subtotal (before per-line discount) derived from each line's own
// stored quantity/unit_price_rial snapshot - a display breakdown only. The
// actual amount owed always stays invoice.total_rial from the database.
export function calcInvoiceSubtotal(items) {
  return (items || []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 0
    const price = Number(item.unit_price_rial) || 0
    return sum + qty * price
  }, 0)
}
