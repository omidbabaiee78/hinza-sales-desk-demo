import { useState } from 'react'
import AppShell from '../layout/AppShell'
import BrandLogo from '../common/BrandLogo'
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
import AdminCrmPage from './AdminCrmPage'
import AdminReportsPage from './reports/AdminReportsPage'
import AdminLeadsPage from './leads/AdminLeadsPage'
import AdminLeadDetailPage from './leads/AdminLeadDetailPage'
import AdminTodayPage from './today/AdminTodayPage'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'داشبورد' },
  { key: 'today', label: 'امروز' },
  { key: 'registrationRequests', label: 'درخواست‌های عضویت' },
  { key: 'customers', label: 'مشتریان' },
  { key: 'crm', label: 'CRM' },
  { key: 'leads', label: 'سرنخ‌های فروش' },
  { key: 'orders', label: 'سفارش‌ها' },
  { key: 'products', label: 'محصولات' },
  { key: 'invoices', label: 'فاکتورها' },
  { key: 'payments', label: 'پرداخت‌ها' },
  { key: 'followUps', label: 'پیگیری‌ها' },
  { key: 'reports', label: 'گزارش‌ها' },
]

const PLACEHOLDER_TITLES = {
  payments: 'پرداخت‌ها',
}

export default function AdminApp({ profile, onSignOut }) {
  const [activeKey, setActiveKey] = useState('dashboard')
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)
  const [selectedLeadId, setSelectedLeadId] = useState(null)

  function navigate(key) {
    setActiveKey(key)
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
    setSelectedLeadId(null)
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
    setSelectedLeadId(null)
    setSelectedCustomerId(companyId)
  }

  function openLead(leadId) {
    setActiveKey('leads')
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
    setSelectedLeadId(leadId)
  }

  return (
    <AppShell
      title="پنل هینزا"
      subtitle="مدیریت فروش B2B"
      logo={<BrandLogo size="sm" />}
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
      {activeKey === 'today' && (
        <AdminTodayPage
          onNavigate={navigate}
          onOpenLead={openLead}
          onOpenOrder={openOrder}
          onOpenInvoice={openInvoice}
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
      {activeKey === 'crm' && (
        <AdminCrmPage onOpenOrder={openOrder} onOpenInvoice={openInvoice} onOpenCustomer={openCustomer} />
      )}
      {activeKey === 'leads' &&
        (selectedLeadId ? (
          <AdminLeadDetailPage
            leadId={selectedLeadId}
            onBack={() => setSelectedLeadId(null)}
            onOpenCustomer={openCustomer}
          />
        ) : (
          <AdminLeadsPage onOpenLead={openLead} />
        ))}
      {activeKey === 'reports' && (
        <AdminReportsPage onOpenCustomer={openCustomer} onOpenInvoice={openInvoice} />
      )}
      {PLACEHOLDER_TITLES[activeKey] && (
        <PlaceholderSection title={PLACEHOLDER_TITLES[activeKey]} />
      )}
    </AppShell>
  )
}
