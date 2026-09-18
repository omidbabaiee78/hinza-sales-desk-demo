import { useAdminDashboardData } from '../../hooks/useAdminDashboardData'
import { useAttentionItems } from '../../hooks/useAttentionItems'
import { formatJalaliDate, formatRial } from '../../utils/formatters'
import StatusBadge from '../orders/StatusBadge'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import '../common/DashboardCards.css'
import './AdminDashboard.css'

export default function AdminDashboard({ onNavigate, onOpenOrder, onOpenCustomer }) {
  const { pendingRequests, openInvoices, recentOrders, recentPayments, loading, error } =
    useAdminDashboardData()
  const { items: attentionItems, loading: attentionLoading } = useAttentionItems()

  const needsQuoteCount = attentionItems.filter(
    (item) => item.reason === 'نیاز به اعلام قیمت',
  ).length
  const needsApprovalCount = attentionItems.filter(
    (item) => item.reason === 'نیاز به تأیید سفارش',
  ).length
  const waitingOnCustomerCount = attentionItems.filter(
    (item) => item.group === 'waiting',
  ).length
  const paymentFollowUpCount = attentionItems.filter(
    (item) => item.group === 'financial',
  ).length

  const attentionCards = [
    {
      key: 'followUps',
      label: 'نیاز به اعلام قیمت',
      value: needsQuoteCount,
      loading: attentionLoading,
    },
    {
      key: 'followUps',
      label: 'نیاز به تأیید سفارش',
      value: needsApprovalCount,
      loading: attentionLoading,
    },
    {
      key: 'followUps',
      label: 'منتظر مشتری',
      value: waitingOnCustomerCount,
      loading: attentionLoading,
    },
    {
      key: 'followUps',
      label: 'پیگیری پرداخت',
      value: paymentFollowUpCount,
      loading: attentionLoading,
    },
    {
      key: 'registrationRequests',
      label: 'درخواست عضویت',
      value: pendingRequests,
      loading,
    },
  ]

  return (
    <div>
      <div className="page-toolbar">
        <h2>داشبورد</h2>
      </div>

      <ErrorBanner message={error} />

      <section className="dashboard-section">
        <h3>نیاز به توجه</h3>
        <div className="dashboard-attention-grid">
          {attentionCards.map((card, index) => {
            const displayValue = card.loading ? '—' : card.value
            const tone = !card.loading && card.value > 0 ? 'warning' : 'neutral'
            return (
              <button
                type="button"
                key={`${card.key}-${index}`}
                className={`dashboard-card dashboard-card-compact tone-${tone}`}
                onClick={() => onNavigate(card.key)}
              >
                <span className="dashboard-card-value">{displayValue}</span>
                <span className="dashboard-card-label">{card.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="dashboard-section">
        <h3>آخرین سفارش‌ها</h3>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>شماره سفارش</th>
                <th>مشتری</th>
                <th>وضعیت</th>
                <th>مبلغ</th>
                <th>تاریخ</th>
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
              {!loading && recentOrders.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-row">
                    موردی برای نمایش وجود ندارد.
                  </td>
                </tr>
              )}
              {!loading &&
                recentOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="clickable-row"
                    onClick={() => onOpenOrder(order.id)}
                  >
                    <td dir="ltr" style={{ textAlign: 'right' }}>
                      {order.order_number ?? order.id}
                    </td>
                    <td>{order.company?.name || '—'}</td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td>{order.total_rial ? formatRial(order.total_rial) : '—'}</td>
                    <td>{formatJalaliDate(order.created_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-section">
        <h3>خلاصه مالی</h3>
        <button
          type="button"
          className="dashboard-mini-stat"
          onClick={() => onNavigate('invoices')}
        >
          <span className="dashboard-mini-stat-label">فاکتورهای باز</span>
          <span
            className={`dashboard-mini-stat-value${
              !loading && openInvoices > 0 ? ' is-notable' : ''
            }`}
          >
            {loading ? '—' : openInvoices}
          </span>
        </button>

        <h4 className="dashboard-subheading">آخرین پرداخت‌ها</h4>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>مشتری</th>
                <th>مبلغ</th>
                <th>تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={3} className="empty-row">
                    در حال بارگذاری...
                  </td>
                </tr>
              )}
              {!loading && recentPayments.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-row">
                    موردی برای نمایش وجود ندارد.
                  </td>
                </tr>
              )}
              {!loading &&
                recentPayments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="clickable-row"
                    onClick={() => onOpenCustomer(payment.company_id)}
                  >
                    <td>{payment.company?.name || '—'}</td>
                    <td>{formatRial(payment.amount_rial)}</td>
                    <td>{formatJalaliDate(payment.paid_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
