import { useState } from 'react'
import AppShell from '../layout/AppShell'
import PlaceholderSection from '../common/PlaceholderSection'
import AdminDashboard from './AdminDashboard'
import RegistrationRequestsPage from './RegistrationRequestsPage'
import AdminOrdersPage from './AdminOrdersPage'
import AdminOrderDetail from './AdminOrderDetail'
import ProductsPage from './ProductsPage'
import AdminInvoicesPage from './AdminInvoicesPage'
import AdminInvoiceDetail from './AdminInvoiceDetail'
import AdminCustomersPage from './AdminCustomersPage'
import AdminCustomerDetail from './AdminCustomerDetail'
import AdminFollowUpsPage from './AdminFollowUpsPage'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'داشبورد' },
  { key: 'registrationRequests', label: 'درخواست‌های عضویت' },
  { key: 'customers', label: 'مشتریان' },
  { key: 'orders', label: 'سفارش‌ها' },
  { key: 'products', label: 'محصولات' },
  { key: 'invoices', label: 'فاکتورها' },
  { key: 'payments', label: 'پرداخت‌ها' },
  { key: 'followUps', label: 'پیگیری‌ها' },
]

const PLACEHOLDER_TITLES = {
  payments: 'پرداخت‌ها',
}

export default function AdminApp({ profile, onSignOut }) {
  const [activeKey, setActiveKey] = useState('dashboard')
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)

  function navigate(key) {
    setActiveKey(key)
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
  }

  function openInvoice(invoiceId) {
    setActiveKey('invoices')
    setSelectedOrderId(null)
    setSelectedCustomerId(null)
    setSelectedInvoiceId(invoiceId)
  }

  function openOrder(orderId) {
    setActiveKey('orders')
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
    setSelectedOrderId(orderId)
  }

  function openCustomer(companyId) {
    setActiveKey('customers')
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedCustomerId(companyId)
  }

  return (
    <AppShell
      title="پنل هینزا"
      subtitle="مدیریت فروش B2B"
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavigate={navigate}
      userLabel={profile.full_name || profile.phone}
      onSignOut={onSignOut}
    >
      {activeKey === 'dashboard' && (
        <AdminDashboard
          onNavigate={navigate}
          onOpenOrder={openOrder}
          onOpenCustomer={openCustomer}
        />
      )}
      {activeKey === 'registrationRequests' && <RegistrationRequestsPage />}
      {activeKey === 'orders' &&
        (selectedOrderId ? (
          <AdminOrderDetail
            orderId={selectedOrderId}
            onBack={() => setSelectedOrderId(null)}
            onOpenInvoice={openInvoice}
          />
        ) : (
          <AdminOrdersPage onOpenOrder={setSelectedOrderId} />
        ))}
      {activeKey === 'products' && <ProductsPage />}
      {activeKey === 'invoices' &&
        (selectedInvoiceId ? (
          <AdminInvoiceDetail
            invoiceId={selectedInvoiceId}
            onBack={() => setSelectedInvoiceId(null)}
          />
        ) : (
          <AdminInvoicesPage onOpenInvoice={setSelectedInvoiceId} />
        ))}
      {activeKey === 'customers' &&
        (selectedCustomerId ? (
          <AdminCustomerDetail
            companyId={selectedCustomerId}
            onBack={() => setSelectedCustomerId(null)}
            onOpenOrder={openOrder}
            onOpenInvoice={openInvoice}
          />
        ) : (
          <AdminCustomersPage onOpenCustomer={setSelectedCustomerId} />
        ))}
      {activeKey === 'followUps' && (
        <AdminFollowUpsPage
          onOpenOrder={openOrder}
          onOpenInvoice={openInvoice}
          onOpenCustomer={openCustomer}
        />
      )}
      {PLACEHOLDER_TITLES[activeKey] && (
        <PlaceholderSection title={PLACEHOLDER_TITLES[activeKey]} />
      )}
    </AppShell>
  )
}
