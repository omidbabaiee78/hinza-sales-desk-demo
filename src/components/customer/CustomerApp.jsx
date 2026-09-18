import { useState } from 'react'
import AppShell from '../layout/AppShell'
import CustomerDashboard from './CustomerDashboard'
import CompanyProfile from './CompanyProfile'
import NewOrderPage from './NewOrderPage'
import CustomerOrdersPage from './CustomerOrdersPage'
import CustomerOrderDetail from './CustomerOrderDetail'
import CustomerInvoicesPage from './CustomerInvoicesPage'
import CustomerInvoiceDetail from './CustomerInvoiceDetail'
import AccountPage from './AccountPage'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'داشبورد من' },
  { key: 'newOrder', label: 'ثبت سفارش' },
  { key: 'orders', label: 'سفارش‌های من' },
  { key: 'invoices', label: 'فاکتورها' },
  { key: 'account', label: 'حساب و پرداخت‌ها' },
  { key: 'profile', label: 'پروفایل شرکت' },
]

export default function CustomerApp({ profile, company, onSignOut }) {
  const [activeKey, setActiveKey] = useState('dashboard')
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)

  function navigate(key) {
    setActiveKey(key)
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
  }

  function openInvoice(invoiceId) {
    setActiveKey('invoices')
    setSelectedOrderId(null)
    setSelectedInvoiceId(invoiceId)
  }

  return (
    <AppShell
      title="هینزا پلیمر"
      subtitle={company?.name || 'پرتال مشتریان'}
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavigate={navigate}
      userLabel={profile.full_name || profile.phone}
      onSignOut={onSignOut}
    >
      {activeKey === 'dashboard' && (
        <CustomerDashboard company={company} onNavigate={navigate} />
      )}
      {activeKey === 'newOrder' && (
        <NewOrderPage
          onCreated={(orderId) => {
            setActiveKey('orders')
            setSelectedOrderId(orderId)
          }}
        />
      )}
      {activeKey === 'orders' &&
        (selectedOrderId ? (
          <CustomerOrderDetail
            orderId={selectedOrderId}
            onBack={() => setSelectedOrderId(null)}
          />
        ) : (
          <CustomerOrdersPage company={company} onOpenOrder={setSelectedOrderId} />
        ))}
      {activeKey === 'invoices' &&
        (selectedInvoiceId ? (
          <CustomerInvoiceDetail
            invoiceId={selectedInvoiceId}
            onBack={() => setSelectedInvoiceId(null)}
          />
        ) : (
          <CustomerInvoicesPage company={company} onOpenInvoice={setSelectedInvoiceId} />
        ))}
      {activeKey === 'account' && (
        <AccountPage company={company} onOpenInvoice={openInvoice} />
      )}
      {activeKey === 'profile' && (
        <CompanyProfile profile={profile} company={company} />
      )}
    </AppShell>
  )
}
