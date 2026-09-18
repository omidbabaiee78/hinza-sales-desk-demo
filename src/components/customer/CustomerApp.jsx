import { useState } from 'react'
import AppShell from '../layout/AppShell'
import BrandLogo from '../common/BrandLogo'
import Footer from '../common/Footer'
import QuickContact from '../common/QuickContact'
import CustomerDashboard from './CustomerDashboard'
import CompanyProfile from './CompanyProfile'
import NewOrderPage from './NewOrderPage'
import CustomerOrdersPage from './CustomerOrdersPage'
import CustomerOrderDetail from './CustomerOrderDetail'
import CustomerInvoicesPage from './CustomerInvoicesPage'
import CustomerInvoiceDetail from './CustomerInvoiceDetail'
import AccountPage from './AccountPage'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'داشبورد' },
  { key: 'newOrder', label: 'ثبت سفارش' },
  { key: 'orders', label: 'سفارش‌ها' },
  { key: 'invoices', label: 'فاکتورها' },
  { key: 'account', label: 'حساب' },
  { key: 'profile', label: 'پروفایل' },
  { key: 'contact', label: 'تماس با ما' },
]

export default function CustomerApp({ profile, company, onSignOut, onOpenContact }) {
  const [activeKey, setActiveKey] = useState('dashboard')
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)

  function navigate(key) {
    if (key === 'contact') {
      onOpenContact()
      return
    }
    setActiveKey(key)
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
  }

  function openOrder(orderId) {
    setActiveKey('orders')
    setSelectedInvoiceId(null)
    setSelectedOrderId(orderId)
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
      logo={<BrandLogo size="sm" />}
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavigate={navigate}
      userLabel={profile.full_name || profile.phone}
      onSignOut={onSignOut}
      footer={<Footer />}
      floatingAction={<QuickContact />}
    >
      {activeKey === 'dashboard' && (
        <CustomerDashboard
          profile={profile}
          company={company}
          onNavigate={navigate}
          onOpenOrder={openOrder}
        />
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
        <CompanyProfile profile={profile} company={company} onNavigate={navigate} />
      )}
    </AppShell>
  )
}
