import { useCustomerDashboardData } from '../../hooks/useCustomerDashboardData'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DashboardCards.css'

export default function CustomerDashboard({ company, onNavigate }) {
  const { activeOrders, previousOrders, unpaidInvoices, specialDiscounts, loading, error } =
    useCustomerDashboardData(company?.id)

  if (!company) {
    return (
      <div className="placeholder-section">
        <h2>داشبورد من</h2>
        <p>هنوز اطلاعات شرکت شما تکمیل نشده است.</p>
      </div>
    )
  }

  const cards = [
    { key: 'orders', label: 'سفارش‌های جاری', value: activeOrders },
    { key: 'orders', label: 'سفارش‌های قبلی', value: previousOrders },
    { key: 'invoices', label: 'فاکتورهای پرداخت‌نشده', value: unpaidInvoices },
    { key: 'account', label: 'تخفیف‌های ویژه', value: specialDiscounts },
  ]

  return (
    <div>
      <ErrorBanner message={error} />
      <div className="dashboard-grid">
        {cards.map((card, idx) => (
          <button
            type="button"
            key={`${card.key}-${idx}`}
            className="dashboard-card"
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
