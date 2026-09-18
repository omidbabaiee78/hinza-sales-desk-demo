import { useCustomerDashboardData } from '../../hooks/useCustomerDashboardData'
import { useCompanyBalance } from '../../hooks/useCompanyBalance'
import { useCustomerOrders } from '../../hooks/useCustomerOrders'
import { formatJalaliDate, formatRial } from '../../utils/formatters'
import { describeBalance } from '../../utils/balance'
import { BRAND_TAGLINE } from '../../constants/brand'
import StatusBadge from '../orders/StatusBadge'
import BrandLogo from '../common/BrandLogo'
import PolymerDots from '../common/PolymerDots'
import ErrorBanner from '../common/ErrorBanner'
import SupportBox from '../common/SupportBox'
import '../common/DashboardCards.css'
import './CustomerDashboard.css'

export default function CustomerDashboard({ profile, company, onNavigate, onOpenOrder }) {
  const { activeOrders, unpaidInvoices, loading, error } = useCustomerDashboardData(company?.id)
  const { balance, loading: balanceLoading } = useCompanyBalance(company?.id)
  const { orders, loading: ordersLoading } = useCustomerOrders(company?.id)

  if (!company) {
    return (
      <div className="placeholder-section">
        <h2>داشبورد من</h2>
        <p>هنوز اطلاعات شرکت شما تکمیل نشده است.</p>
      </div>
    )
  }

  let balanceValue = '—'
  if (!balanceLoading && balance !== null) {
    if (balance === 0) {
      balanceValue = 'تسویه'
    } else {
      const info = describeBalance(balance)
      balanceValue = balance < 0 ? `${info.label}: ${formatRial(info.amount)}` : formatRial(info.amount)
    }
  }

  const latestOrder = orders[0] || null

  const shortcuts = [
    { key: 'orders', label: 'سفارش‌ها', value: loading ? '—' : activeOrders },
    { key: 'invoices', label: 'فاکتورها', value: loading ? '—' : unpaidInvoices },
    { key: 'account', label: 'حساب', value: balanceValue },
  ]

  return (
    <div className="customer-dashboard">
      <section className="dashboard-hero">
        <div className="dashboard-hero-brand">
          <BrandLogo size="md" />
          <div>
            <h2>سلام {profile?.full_name || 'مشتری گرامی'}</h2>
            {company.name && <p className="dashboard-hero-company">{company.name}</p>}
            <p className="dashboard-hero-tagline">{BRAND_TAGLINE}</p>
          </div>
        </div>
        <div className="dashboard-hero-actions">
          <button
            type="button"
            className="btn-primary customer-dashboard-cta"
            onClick={() => onNavigate('newOrder')}
          >
            + ثبت سفارش جدید
          </button>
        </div>
        <PolymerDots className="dashboard-hero-dots" />
      </section>

      <ErrorBanner message={error} />

      {!ordersLoading && latestOrder && (
        <section className="latest-order-card">
          <div className="latest-order-heading">
            <h3 className="accent-heading">آخرین سفارش</h3>
            <StatusBadge status={latestOrder.status} />
          </div>
          <div className="latest-order-body">
            <div className="info-row">
              <span className="info-label">شماره سفارش</span>
              <span className="info-value" dir="ltr">
                {latestOrder.order_number ?? latestOrder.id}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">تاریخ</span>
              <span className="info-value">{formatJalaliDate(latestOrder.created_at)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">مبلغ</span>
              <span className="info-value">
                {latestOrder.status === 'pending_review' || !latestOrder.total_rial
                  ? '—'
                  : formatRial(latestOrder.total_rial)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onOpenOrder(latestOrder.id)}
          >
            مشاهده سفارش
          </button>
        </section>
      )}

      {!ordersLoading && !latestOrder && (
        <p className="profile-empty">هنوز سفارشی ثبت نکرده‌اید.</p>
      )}

      <div className="dashboard-grid customer-shortcut-grid">
        {shortcuts.map((card) => (
          <button
            type="button"
            key={card.key}
            className="dashboard-card"
            onClick={() => onNavigate(card.key)}
          >
            <span className="dashboard-card-value">{card.value}</span>
            <span className="dashboard-card-label">{card.label}</span>
          </button>
        ))}
      </div>

      <SupportBox />
    </div>
  )
}
