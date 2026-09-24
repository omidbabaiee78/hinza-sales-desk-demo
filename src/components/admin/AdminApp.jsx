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
import './today/Today.css'
import './AdminNavGroups.css'

// Keep the demo focused on discovery, first contact and recording outcomes.
// Legacy pages remain directly accessible at their old URLs, but are not
// displayed in the primary navigation.
const GROUPS = [
  { key: 'home', label: 'نمای کار' },
  { key: 'prospecting', label: 'کشف مشتری' },
  { key: 'leads', label: 'سرنخ‌ها' },
  {
    key: 'contact',
    label: 'ارتباط اولیه',
    defaultKey: 'outreach',
    tabs: [
      { key: 'outreach', label: 'ایمیل‌ها' },
      { key: 'channels', label: 'وضعیت کانال‌ها (ایمیل، واتساپ، بله)' },
      { key: 'replies', label: 'نتیجهٔ ارتباط' },
    ],
  },
]

const GROUPS_BY_KEY = new Map(GROUPS.map((g) => [g.key, g]))

const GROUP_OF_KEY = (() => {
  const map = { dashboard: 'home', today: 'home' }
  for (const group of GROUPS) {
    map[group.key] = group.key
    for (const tab of group.tabs || []) map[tab.key] = group.key
  }
  return map
})()

const ALL_VALID_KEYS = new Set([
  'home',
  'dashboard',
  'today',
  'automation',
  'outreach',
  'channels',
  'replies',
  'prospecting',
  'registrationRequests',
  'customers',
  'crm',
  'leads',
  'orders',
  'products',
  'invoices',
  'payments',
  'followUps',
  'reports',
])

// 'payments' has never had its own dedicated page (same as before this
// cleanup) - PlaceholderSection is what it has always rendered.
const PLACEHOLDER_TITLES = {
  payments: 'پرداخت‌ها',
}

const SIDEBAR_ITEMS = GROUPS.map((g) => ({ key: g.key, label: g.label }))

// Maps a URL like /admin/outreach to its activeKey - so every admin page is
// still a real, bookmarkable/deep-linkable route, exactly as before. An
// unrecognized or bare /admin path now falls back to 'home' (previously
// 'dashboard') - the new operational starting point.
function keyFromPathname(pathname) {
  const match = /^\/admin\/([a-zA-Z]+)/.exec(pathname || '')
  const key = match ? match[1] : 'home'
  return ALL_VALID_KEYS.has(key) ? key : 'home'
}

export default function AdminApp({ profile, onSignOut, pathname, onNavigateUrl }) {
  const [activeKey, setActiveKey] = useState(() => keyFromPathname(pathname))
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null)
  const [selectedLeadId, setSelectedLeadId] = useState(null)

  // Keeps activeKey in sync with browser back/forward navigation - adjusting
  // state during render (React's documented pattern for "state derived from
  // a prop") rather than in a useEffect, which would cause an extra render.
  const [syncedPathname, setSyncedPathname] = useState(pathname)
  if (pathname !== syncedPathname) {
    setSyncedPathname(pathname)
    setActiveKey(keyFromPathname(pathname))
  }

  function navigate(key) {
    setActiveKey(key)
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedCustomerId(null)
    setSelectedLeadId(null)
    onNavigateUrl?.(`/admin/${key}`)
  }

  function navigateToGroup(groupKey) {
    const group = GROUPS_BY_KEY.get(groupKey)
    navigate(group?.defaultKey || groupKey)
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

  const activeGroupKey = GROUP_OF_KEY[activeKey] || 'home'
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
      {activeGroup?.tabs && (
        <nav className="admin-hub-subnav" aria-label="بخش‌های پنل">
          {activeGroup.tabs.filter((tab) => !tab.advanced).map((tab) => (
            <button key={tab.key} type="button" className={`today-chip${activeKey === tab.key ? ' active' : ''}`} onClick={() => navigate(tab.key)}>
              {tab.label}
            </button>
          ))}
          {activeGroup.tabs.some((tab) => tab.advanced) && (
            <details className="admin-hub-more" key={activeGroup.key} open={activeGroup.tabs.some((tab) => tab.advanced && tab.key === activeKey) || undefined}>
              <summary>بخش‌های دیگر</summary>
              <div className="admin-hub-more-links">
                {activeGroup.tabs.filter((tab) => tab.advanced).map((tab) => (
                  <button key={tab.key} type="button" className={`today-chip${activeKey === tab.key ? ' active' : ''}`} onClick={() => navigate(tab.key)}>{tab.label}</button>
                ))}
              </div>
            </details>
          )}
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
      {activeKey === 'outreach' && <EmailOutreachPage onOpenLead={openLead} />}
      {activeKey === 'channels' && <ChannelOutreachPage onOpenLead={openLead} />}
      {activeKey === 'replies' && <AdminReplyInboxPage onOpenLead={openLead} />}
      {activeKey === 'prospecting' && <AdminProspectingPage />}
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
