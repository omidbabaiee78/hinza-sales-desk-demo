import { formatRial, formatQuantity } from '../../../utils/formatters'
import './Reports.css'

function ChangeBadge({ percent }) {
  if (percent == null) {
    return <span className="reports-change neutral">نسبت به دوره قبل: داده‌ای موجود نیست</span>
  }
  const tone = percent > 0 ? 'positive' : percent < 0 ? 'negative' : 'neutral'
  const sign = percent > 0 ? '+' : ''
  return (
    <span className={`reports-change ${tone}`}>
      نسبت به دوره قبل: {sign}
      {formatQuantity(percent)}٪
    </span>
  )
}

export default function ReportSummaryCards({
  periodSalesRial,
  periodSalesChangePercent,
  periodCollectedRial,
  periodCollectedChangePercent,
  currentOutstandingRial,
  orderCount,
  deliveredOrderCount,
  averageInvoiceRial,
}) {
  return (
    <div className="reports-summary-grid">
      <div className="reports-summary-card">
        <span className="reports-summary-label">فروش دوره</span>
        <span className="reports-summary-value">{formatRial(periodSalesRial)}</span>
        <ChangeBadge percent={periodSalesChangePercent} />
      </div>

      <div className="reports-summary-card">
        <span className="reports-summary-label">وصولی دوره</span>
        <span className="reports-summary-value">{formatRial(periodCollectedRial)}</span>
        <ChangeBadge percent={periodCollectedChangePercent} />
      </div>

      <div className="reports-summary-card tone-current">
        <span className="reports-summary-label">
          مانده حساب فعلی
          <span className="reports-summary-badge">لحظه‌ای، مستقل از بازه</span>
        </span>
        <span className="reports-summary-value">{formatRial(currentOutstandingRial)}</span>
      </div>

      <div className="reports-summary-card">
        <span className="reports-summary-label">تعداد سفارش‌ها</span>
        <span className="reports-summary-value">{formatQuantity(orderCount)}</span>
      </div>

      <div className="reports-summary-card">
        <span className="reports-summary-label">سفارش‌های تحویل‌شده</span>
        <span className="reports-summary-value">{formatQuantity(deliveredOrderCount)}</span>
      </div>

      <div className="reports-summary-card">
        <span className="reports-summary-label">میانگین مبلغ فاکتور</span>
        <span className="reports-summary-value">
          {averageInvoiceRial == null ? '—' : formatRial(averageInvoiceRial)}
        </span>
      </div>
    </div>
  )
}
