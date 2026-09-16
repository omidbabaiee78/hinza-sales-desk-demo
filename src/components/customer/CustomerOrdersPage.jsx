import { useCustomerOrders } from '../../hooks/useCustomerOrders'
import { formatJalaliDate, formatKg, formatRial } from '../../utils/formatters'
import StatusBadge from '../orders/StatusBadge'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'

export default function CustomerOrdersPage({ company, onOpenOrder }) {
  const { orders, loading, error, refresh } = useCustomerOrders(company?.id)

  return (
    <div>
      <div className="page-toolbar">
        <h2>سفارش‌های من</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>شماره سفارش</th>
              <th>تاریخ</th>
              <th>محصول</th>
              <th>مقدار</th>
              <th>وضعیت</th>
              <th>مبلغ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              orders.map((order) => (
                <tr key={order.id}>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {order.order_number ?? order.id}
                  </td>
                  <td>{formatJalaliDate(order.created_at)}</td>
                  <td>{order.productsSummary || '—'}</td>
                  <td>{formatKg(order.totalQuantityKg)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>
                    {order.status === 'pending_review'
                      ? '—'
                      : formatRial(order.total_rial)}
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onOpenOrder(order.id)}
                    >
                      مشاهده
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  هنوز سفارشی ثبت نکرده‌اید.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
