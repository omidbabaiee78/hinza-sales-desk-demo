import { formatJalaliDateTime } from '../../../utils/formatters'
import { leadActivityTypeLabel } from '../../../utils/leadStatus'

export default function LeadActivityTimeline({ activities }) {
  if (!activities || activities.length === 0) {
    return <p className="profile-empty">هنوز فعالیتی برای این سرنخ ثبت نشده است.</p>
  }
  return (
    <ul className="lead-activity-timeline">
      {activities.map((activity) => (
        <li key={activity.id}>
          <div className="lead-activity-top">
            <span className="lead-activity-type">{leadActivityTypeLabel(activity.activity_type)}</span>
            <span className="lead-activity-date">{formatJalaliDateTime(activity.created_at)}</span>
          </div>
          {activity.note && <p className="lead-activity-note">{activity.note}</p>}
          {activity.next_follow_up_at && (
            <p className="lead-activity-followup">
              پیگیری بعدی ثبت‌شده: {formatJalaliDateTime(activity.next_follow_up_at)}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
