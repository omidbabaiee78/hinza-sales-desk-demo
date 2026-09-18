import { useMemo } from 'react'
import { useAttentionItems } from '../../hooks/useAttentionItems'
import { formatJalaliDate, formatJalaliDateTime } from '../../utils/formatters'
import { ATTENTION_GROUPS } from '../../utils/attentionItems'
import AttentionReasonBadge from '../followups/AttentionReasonBadge'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import './AdminFollowUpsPage.css'

function formatItemDate(item) {
  return item.action.type === 'invoice'
    ? formatJalaliDate(item.date)
    : formatJalaliDateTime(item.date)
}

// Fully automatic "چه چیزی الان نیاز به توجه دارد" list - built from
// existing order/invoice statuses, never a manually created task list.
export default function AdminFollowUpsPage({ onOpenOrder, onOpenInvoice, onOpenCustomer }) {
  const { items, loading, error, refresh } = useAttentionItems()

  const grouped = useMemo(
    () =>
      ATTENTION_GROUPS.map((group) => ({
        ...group,
        items: items.filter((item) => item.group === group.key),
      })),
    [items],
  )

  return (
    <div>
      <div className="page-toolbar">
        <h2>پیگیری‌ها</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      {loading && <p className="profile-empty">در حال بارگذاری...</p>}
      {!loading && items.length === 0 && (
        <p className="profile-empty">در حال حاضر موردی نیاز به توجه ندارد.</p>
      )}

      {!loading &&
        grouped.map((group) =>
          group.items.length === 0 ? null : (
            <section key={group.key} className="attention-group">
              <h3>
                {group.label}{' '}
                <span className="attention-group-count">({group.items.length})</span>
              </h3>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>مشتری</th>
                      <th>دلیل</th>
                      <th>شماره</th>
                      <th>تاریخ</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.company?.name || '—'}</td>
                        <td>
                          <AttentionReasonBadge item={item} />
                        </td>
                        <td dir="ltr" style={{ textAlign: 'right' }}>
                          {item.refLabel}
                        </td>
                        <td>{formatItemDate(item)}</td>
                        <td className="cell-actions">
                          {item.action.type === 'order' && (
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => onOpenOrder(item.action.id)}
                            >
                              مشاهده سفارش
                            </button>
                          )}
                          {item.action.type === 'invoice' && (
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => onOpenInvoice(item.action.id)}
                            >
                              مشاهده فاکتور
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => onOpenCustomer(item.companyId)}
                          >
                            مشاهده مشتری
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ),
        )}
    </div>
  )
}
