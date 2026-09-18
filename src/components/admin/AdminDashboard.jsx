import { useAdminDashboardData } from '../../hooks/useAdminDashboardData'
import { useAttentionItems } from '../../hooks/useAttentionItems'
import { formatJalaliDate, formatJalaliDateTime } from '../../utils/formatters'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DashboardCards.css'
import './AdminDashboard.css'

const NEXT_ITEMS_LIMIT = 5

export default function AdminDashboard({ onNavigate, onOpenCustomer }) {
  const { pendingRequests, companies, orders, products, loading, error } =
    useAdminDashboardData()
  const { items: attentionItems, loading: attentionLoading } = useAttentionItems()

  const actionCount = attentionItems.filter((item) => item.group === 'action').length
  const financialCount = attentionItems.filter((item) => item.group === 'financial').length
  // Already sorted oldest/most-overdue first, so the top few are the most
  // urgent regardless of which group they belong to.
  const nextItems = attentionItems.slice(0, NEXT_ITEMS_LIMIT)

  const cards = [
    {
      key: 'registrationRequests',
      label: 'درخواست‌های عضویت در انتظار',
      value: pendingRequests,
      tone: 'warning',
    },
    { key: 'customers', label: 'شرکت‌های فعال', value: companies, tone: 'neutral' },
    { key: 'orders', label: 'کل سفارش‌ها', value: orders, tone: 'neutral' },
    { key: 'products', label: 'کل محصولات', value: products, tone: 'neutral' },
    {
      key: 'followUps',
      label: 'نیاز به اقدام',
      value: attentionLoading ? '—' : actionCount,
      tone: actionCount > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'followUps',
      label: 'پیگیری پرداخت',
      value: attentionLoading ? '—' : financialCount,
      tone: financialCount > 0 ? 'warning' : 'neutral',
    },
  ]

  return (
    <div>
      <ErrorBanner message={error} />
      <div className="dashboard-grid">
        {cards.map((card, index) => (
          <button
            type="button"
            key={`${card.key}-${index}`}
            className={`dashboard-card tone-${card.tone}`}
            onClick={() => onNavigate(card.key)}
          >
            <span className="dashboard-card-value">
              {loading && card.key !== 'followUps' ? '—' : card.value}
            </span>
            <span className="dashboard-card-label">{card.label}</span>
          </button>
        ))}
      </div>

      <section className="dashboard-attention">
        <h3>موارد نیازمند توجه</h3>
        {attentionLoading ? (
          <p className="profile-empty">در حال بارگذاری...</p>
        ) : nextItems.length === 0 ? (
          <p className="profile-empty">در حال حاضر موردی نیاز به توجه ندارد.</p>
        ) : (
          <ul className="dashboard-attention-list">
            {nextItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="dashboard-attention-row"
                  onClick={() => onOpenCustomer(item.companyId)}
                >
                  <span className="dashboard-attention-company">
                    {item.company?.name || '—'}
                  </span>
                  <span className="dashboard-attention-reason">{item.reason}</span>
                  <span className="dashboard-attention-date">
                    {item.action.type === 'invoice'
                      ? formatJalaliDate(item.date)
                      : formatJalaliDateTime(item.date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
