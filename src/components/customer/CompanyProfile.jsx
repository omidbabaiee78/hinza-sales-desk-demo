import { useCompanyBalance } from '../../hooks/useCompanyBalance'
import { useCustomerOrders } from '../../hooks/useCustomerOrders'
import { useCustomerInvoices } from '../../hooks/useCustomerInvoices'
import { formatJalaliDate } from '../../utils/formatters'
import { formatBalanceLine } from '../../utils/balance'
import { isInvoiceOpen } from '../../utils/invoice'
import '../common/DashboardCards.css'
import './CompanyProfile.css'

function InfoRow({ label, value, ltr }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value" dir={ltr ? 'ltr' : undefined}>
        {value || '—'}
      </span>
    </div>
  )
}

export default function CompanyProfile({ profile, company, onNavigate }) {
  const { balance, loading: balanceLoading } = useCompanyBalance(company?.id)
  const { orders, loading: ordersLoading } = useCustomerOrders(company?.id)
  const { invoices, loading: invoicesLoading } = useCustomerInvoices(company?.id)

  const lastPurchaseAt =
    orders.filter((order) => order.status === 'delivered')[0]?.created_at || null
  const openInvoicesCount = invoices.filter((invoice) => isInvoiceOpen(invoice.status)).length

  const metrics = [
    { key: 'balance', label: 'مانده حساب', value: balanceLoading ? '—' : formatBalanceLine(balance) },
    { key: 'orders', label: 'تعداد سفارش‌ها', value: ordersLoading ? '—' : orders.length },
    { key: 'invoices', label: 'فاکتورهای باز', value: invoicesLoading ? '—' : openInvoicesCount },
    {
      key: 'lastPurchase',
      label: 'آخرین خرید',
      value: ordersLoading ? '—' : lastPurchaseAt ? formatJalaliDate(lastPurchaseAt) : '—',
    },
  ]

  return (
    <div>
      <div className="profile-grid">
        <section className="profile-card">
          <h2>اطلاعات نماینده</h2>
          <InfoRow label="نام و نام خانوادگی" value={profile.full_name} />
          <InfoRow label="شماره موبایل" value={profile.phone} ltr />
          <InfoRow label="ایمیل" value={profile.email} ltr />
          <InfoRow label="تاریخ عضویت" value={formatJalaliDate(profile.created_at)} />
        </section>

        <section className="profile-card">
          <h2>اطلاعات شرکت</h2>
          {company ? (
            <>
              <InfoRow label="نام شرکت" value={company.name} />
              <InfoRow label="استان" value={company.province} />
              <InfoRow label="شهر" value={company.city} />
              {company.address && <InfoRow label="آدرس" value={company.address} />}
            </>
          ) : (
            <p className="profile-empty">اطلاعات شرکت هنوز ثبت نشده است.</p>
          )}
        </section>
      </div>

      {company && (
        <>
          <div className="dashboard-grid" style={{ margin: '16px 0' }}>
            {metrics.map((metric) => (
              <div className="dashboard-card" key={metric.key}>
                <span className="dashboard-card-value">{metric.value}</span>
                <span className="dashboard-card-label">{metric.label}</span>
              </div>
            ))}
          </div>

          <div className="profile-links">
            <button type="button" className="btn-secondary" onClick={() => onNavigate('orders')}>
              سفارش‌های من
            </button>
            <button type="button" className="btn-secondary" onClick={() => onNavigate('invoices')}>
              فاکتورها
            </button>
            <button type="button" className="btn-secondary" onClick={() => onNavigate('account')}>
              حساب و پرداخت‌ها
            </button>
          </div>
        </>
      )}
    </div>
  )
}
