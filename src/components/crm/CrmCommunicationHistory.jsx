import { CRM_CHANNEL_LABELS, CRM_REASON_LABELS, CRM_COMM_STATUS_LABELS } from '../../constants/crmLabels'
import { formatJalaliDateTime } from '../../utils/formatters'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'

export default function CrmCommunicationHistory({ communications, loading, error, schemaMissing }) {
  if (schemaMissing) {
    return (
      <p className="profile-empty">
        تاریخچه ارتباط نیاز به اجرای migration مربوط به CRM دارد و هنوز فعال نشده است.
      </p>
    )
  }

  return (
    <div className="table-wrapper">
      <ErrorBanner message={error} />
      <table>
        <thead>
          <tr>
            <th>تاریخ</th>
            <th>کانال</th>
            <th>دلیل</th>
            <th>وضعیت</th>
            <th>متن پیام</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={5} className="empty-row">
                در حال بارگذاری...
              </td>
            </tr>
          )}
          {!loading && communications.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-row">
                هنوز ارتباطی برای این مشتری ثبت نشده است.
              </td>
            </tr>
          )}
          {!loading &&
            communications.map((item) => (
              <tr key={item.id}>
                <td>{formatJalaliDateTime(item.created_at)}</td>
                <td>{CRM_CHANNEL_LABELS[item.channel] || item.channel}</td>
                <td>{CRM_REASON_LABELS[item.reason] || item.reason}</td>
                <td>{CRM_COMM_STATUS_LABELS[item.action_status] || item.action_status}</td>
                <td className="cell-notes" title={item.message_snapshot}>
                  {item.message_snapshot || '—'}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
