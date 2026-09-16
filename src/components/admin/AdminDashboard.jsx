import { useAdminDashboardData } from '../../hooks/useAdminDashboardData'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DashboardCards.css'

export default function AdminDashboard({ onNavigate }) {
  const { pendingRequests, companies, orders, products, loading, error } =
    useAdminDashboardData()

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
  ]

  return (
    <div>
      <ErrorBanner message={error} />
      <div className="dashboard-grid">
        {cards.map((card) => (
          <button
            type="button"
            key={card.key}
            className={`dashboard-card tone-${card.tone}`}
            onClick={() => onNavigate(card.key)}
          >
            <span className="dashboard-card-value">
              {loading ? '—' : card.value}
            </span>
            <span className="dashboard-card-label">{card.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
