import { eventLabel } from '../../utils/orderStatus'
import { formatJalaliDateTime } from '../../utils/formatters'
import './OrderTimeline.css'

export default function OrderTimeline({ events, fallbackCreatedAt }) {
  const items =
    events.length > 0
      ? events
      : fallbackCreatedAt
        ? [
            {
              id: 'fallback',
              event_type: 'pending_review',
              created_at: fallbackCreatedAt,
            },
          ]
        : []

  if (items.length === 0) {
    return <p className="timeline-empty">هنوز رویدادی برای این سفارش ثبت نشده است.</p>
  }

  return (
    <ol className="order-timeline">
      {items.map((event) => (
        <li key={event.id}>
          <span className="timeline-dot" />
          <div className="timeline-body">
            <span className="timeline-label">{eventLabel(event.event_type)}</span>
            <span className="timeline-date">
              {formatJalaliDateTime(event.created_at)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
