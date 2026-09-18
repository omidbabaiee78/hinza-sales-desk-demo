import { useCustomerDashboardData } from '../../hooks/useCustomerDashboardData'
import { useCompanyBalance } from '../../hooks/useCompanyBalance'
import { formatRial } from '../../utils/formatters'
import { describeBalance } from '../../utils/balance'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DashboardCards.css'

export default function CustomerDashboard({ company, onNavigate }) {
  const { activeOrders, previousOrders, unpaidInvoices, specialDiscounts, loading, error } =
    useCustomerDashboardData(company?.id)
  const { balance, loading: balanceLoading } = useCompanyBalance(company?.id)

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

  const cards = [
    { key: 'account', label: 'مانده حساب', value: balanceValue, isBalance: true },
    { key: 'orders', label: 'سفارش‌های جاری', value: activeOrders },
    { key: 'orders', label: 'سفارش‌های قبلی', value: previousOrders },
    { key: 'invoices', label: 'فاکتورهای باز', value: unpaidInvoices },
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
              {!card.isBalance && loading ? '—' : card.value}
            </span>
            <span className="dashboard-card-label">{card.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
