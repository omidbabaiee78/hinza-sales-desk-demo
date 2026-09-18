import { formatRial } from '../../utils/formatters'
import MoneyEquivalent from '../common/MoneyEquivalent'
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
        <div>
          <span>مبلغ نهایی</span>
          <MoneyEquivalent rial={totalRial} className="no-print" />
        </div>
        <strong>{formatRial(totalRial)}</strong>
      </div>
      <div className="invoice-amount-row">
        <span>پرداخت‌شده</span>
        <strong>{formatRial(paidRial)}</strong>
      </div>
      <div className="invoice-amount-row invoice-amount-remaining">
        <div>
          <span>مانده</span>
          <MoneyEquivalent rial={remainingRial} className="no-print" />
        </div>
        <strong>{formatRial(remainingRial)}</strong>
      </div>
    </div>
  )
}
