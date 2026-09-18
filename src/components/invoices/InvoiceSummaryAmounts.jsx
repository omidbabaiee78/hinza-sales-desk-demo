import { formatRial } from '../../utils/formatters'
import './InvoiceSummaryAmounts.css'

export default function InvoiceSummaryAmounts({
  subtotalRial,
  discountRial,
  totalRial,
  paidRial,
  remainingRial,
}) {
  return (
    <div className="invoice-summary-amounts">
      <div className="invoice-amount-row">
        <span>جمع کل</span>
        <strong>{formatRial(subtotalRial)}</strong>
      </div>
      <div className="invoice-amount-row">
        <span>تخفیف</span>
        <strong>{formatRial(discountRial)}</strong>
      </div>
      <div className="invoice-amount-row invoice-amount-final">
        <span>مبلغ نهایی</span>
        <strong>{formatRial(totalRial)}</strong>
      </div>
      <div className="invoice-amount-row">
        <span>پرداخت‌شده</span>
        <strong>{formatRial(paidRial)}</strong>
      </div>
      <div className="invoice-amount-row invoice-amount-remaining">
        <span>مانده</span>
        <strong>{formatRial(remainingRial)}</strong>
      </div>
    </div>
  )
}
