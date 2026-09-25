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
import AdminAutomationPage from './automation/AdminAutomationPage'
import EmailOutreachPage from './outreach/EmailOutreachPage'
import ChannelOutreachPage from './outreach/ChannelOutreachPage'
import AdminReplyInboxPage from './replies/AdminReplyInboxPage'
import AdminProspectingPage from './prospecting/AdminProspectingPage'
import AdminMissionPage from './AdminMissionPage'
import AdminSectionNav from './AdminSectionNav'
import { GROUPS, GROUPS_BY_KEY, GROUP_OF_KEY, PAGE_LABELS, routeFromPathname } from './adminSections'
import './today/Today.css'
import './AdminNavGroups.css'

// Menu, breadcrumbs and Previous/Next come from adminSections.js. Legacy
// pages remain directly accessible at their old URLs and from «ابزارهای
// بیشتر» on the overview, but are not displayed in the primary navigation.

// 'payments' has never had its own dedicated page - PlaceholderSection is
// what it has always rendered.
const PLACEHOLDER_TITLES = {
  payments: 'پرداخت‌ها',
}

const SIDEBAR_ITEMS = GROUPS.map((g) => ({ key: g.key, label: g.label }))

function scrollToTop() {
  try {
    window.scrollTo(0, 0)
  } catch {
    // non-browser environment
  }
}

export default function AdminApp({ profile, onSignOut, pathname, onNavigateUrl }) {
  const [activeKey, setActiveKey] = useState(() => routeFromPathname(pathname).key)
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)
  const [selectedLeadId, setSelectedLeadId] = useState(() => routeFromPathname(pathname).leadId)
  // Where «بازگشت» on a lead page goes: the page the lead was opened from.
  // Opened inside the app -> browser history (keeps that page's tab);
  // opened from a bookmark/link -> the leads list.
  const [leadReturnKey, setLeadReturnKey] = useState('leads')
  const [leadOpenedInApp, setLeadOpenedInApp] = useState(false)
  // Optional tab to open on the destination page (e.g. an overview number
  // linking straight to the bounced emails).
  const [pageTab, setPageTab] = useState(null)

  // Keeps the page (and an open lead, /admin/leads/<id>) in sync with
  // browser back/forward - adjusting state during render (React's
  // documented pattern for "state derived from a prop") rather than in a
  // useEffect, which would cause an extra render.
  const [syncedPathname, setSyncedPathname] = useState(pathname)
  if (pathname !== syncedPathname) {
    const route = routeFromPathname(pathname)
    setSyncedPathname(pathname)
    setActiveKey(route.key)
    setSelectedLeadId(route.leadId)
  }

  function navigate(key, options = {}) {
    setActiveKey(key)
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
    setSelectedLeadId(null)
    setPageTab(options.tab || null)
    onNavigateUrl?.(`/admin/${key}`)
    scrollToTop()
  }

  function navigateToGroup(groupKey) {
    const group = GROUPS_BY_KEY.get(groupKey)
    navigate(group?.defaultKey || groupKey)
  }

  function openInvoice(invoiceId) {
    onNavigateUrl?.('/admin/invoices')
    setActiveKey('invoices')
    setSelectedOrderId(null)
    setSelectedCustomerId(null)
    setSelectedInvoiceId(invoiceId)
  }

  function openOrder(orderId) {
    onNavigateUrl?.('/admin/orders')
    setActiveKey('orders')
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
    setSelectedOrderId(orderId)
  }

  function openCustomer(companyId) {
    onNavigateUrl?.('/admin/customers')
    setActiveKey('customers')
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedLeadId(null)
    setSelectedCustomerId(companyId)
  }

  function openLead(leadId) {
    setLeadReturnKey(activeKey === 'leads' || !PAGE_LABELS[activeKey] ? 'leads' : activeKey)
    setLeadOpenedInApp(true)
    setActiveKey('leads')
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
    setSelectedLeadId(leadId)
    onNavigateUrl?.(`/admin/leads/${leadId}`)
    scrollToTop()
  }

  const activeGroupKey = GROUP_OF_KEY[activeKey] || null
  const activeGroup = GROUPS_BY_KEY.get(activeGroupKey)

  return (
    <AppShell
      title="پنل هینزا"
      subtitle="کشف مشتری و ارتباط اولیه"
      logo={<BrandLogo size="sm" />}
      navItems={SIDEBAR_ITEMS}
      activeKey={activeGroupKey}
      onNavigate={navigateToGroup}
      userLabel={profile.full_name || profile.phone}
      onSignOut={onSignOut}
    >
      <AdminSectionNav activeKey={activeKey} detailLabel={activeKey === 'leads' && selectedLeadId ? 'جزئیات سرنخ' : null} onNavigate={navigate} />

      {activeGroup?.tabs && (
        <nav className="admin-hub-subnav" aria-label={activeGroup.label}>
          {activeGroup.tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`today-chip${activeKey === tab.key ? ' active' : ''}`}
              aria-current={activeKey === tab.key ? 'page' : undefined}
              onClick={() => navigate(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      {activeKey === 'home' && <AdminMissionPage onNavigate={navigate} />}
      {activeKey === 'today' && (
        <AdminTodayPage
          onNavigate={navigate}
          onOpenLead={openLead}
          onOpenOrder={openOrder}
          onOpenInvoice={openInvoice}
          onOpenCustomer={openCustomer}
        />
      )}
      {activeKey === 'dashboard' && (
        <AdminDashboard
          onNavigate={navigate}
          onOpenOrder={openOrder}
          onOpenCustomer={openCustomer}
        />
      )}
      {activeKey === 'automation' && (
        <AdminAutomationPage
          onNavigate={navigate}
          onOpenLead={openLead}
          onOpenOrder={openOrder}
          onOpenInvoice={openInvoice}
        />
      )}
      {activeKey === 'outreach' && <EmailOutreachPage key={pageTab || 'default'} initialTab={pageTab} onOpenLead={openLead} />}
      {activeKey === 'channels' && <ChannelOutreachPage key={pageTab || 'default'} initialFilter={pageTab} onOpenLead={openLead} />}
      {activeKey === 'replies' && <AdminReplyInboxPage onOpenLead={openLead} />}
      {activeKey === 'prospecting' && <AdminProspectingPage key={pageTab || 'default'} initialTab={pageTab} />}
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
            key={selectedLeadId}
            leadId={selectedLeadId}
            backLabel={`بازگشت به ${leadOpenedInApp ? PAGE_LABELS[leadReturnKey] || 'سرنخ‌ها' : 'سرنخ‌ها'}`}
            onBack={() => (leadOpenedInApp ? window.history.back() : navigate('leads'))}
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
