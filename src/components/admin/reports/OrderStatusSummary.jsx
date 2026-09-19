import './Reports.css'

const GROUP_TONE = {
  'در انتظار اقدام': 'warning',
  'منتظر مشتری': 'neutral',
  'در حال انجام': 'warning',
  'تحویل‌شده': 'success',
  'لغو / رد شده': 'danger',
}

export default function OrderStatusSummary({ summary }) {
  return (
    <div className="reports-status-grid">
      {summary.map((row) => (
        <div className={`reports-status-item tone-${GROUP_TONE[row.group] || 'neutral'}`} key={row.group}>
          <span className="reports-status-count">{row.count}</span>
          <span className="reports-status-label">{row.group}</span>
        </div>
      ))}
    </div>
  )
}
