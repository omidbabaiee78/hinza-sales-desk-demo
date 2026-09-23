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
import AdminOutreachPage from './outreach/AdminOutreachPage'
import AdminReplyInboxPage from './replies/AdminReplyInboxPage'
import AdminProspectingPage from './prospecting/AdminProspectingPage'
import './today/Today.css'
import './AdminNavGroups.css'

// ---------------------------------------------------------------------------
// Phase 26 prep - Admin Information Architecture cleanup.
//
// This is a PURE navigation/presentation reorganization. Every existing
// page/component below is reused completely unchanged; every existing route
// key (dashboard/today/automation/outreach/replies/prospecting/
// registrationRequests/customers/crm/leads/orders/products/invoices/
// payments/followUps/reports) is STILL a valid, directly-linkable activeKey
// with exactly the same content it always rendered - nothing was deleted,
// nothing was renamed at the routing level, no business logic/API/Supabase
// call changed anywhere. Only the SIDEBAR now shows 5 grouped destinations
// instead of 16 flat ones, with a small sub-tab strip inside each group for
// its member pages. Old bookmarked URLs (e.g. /admin/leads, /admin/crm,
// /admin/dashboard) keep working exactly as before - see keyFromPathname().
//
// GROUPS is the single source of truth for both the sidebar and each
// group's sub-navigation tabs. `tabs` is omitted for a group that is just
// one page (خانه/گزارش‌ها) - no sub-nav is shown for those.
// ---------------------------------------------------------------------------
const GROUPS = [
  { key: 'home', label: 'خانه' },
  {
    key: 'sales',
    label: 'فروش',
    defaultKey: 'leads',
    tabs: [
      { key: 'leads', label: 'سرنخ‌ها' },
      { key: 'outreach', label: 'پیشنهاد پیام (آزمایشی)', advanced: true },
      { key: 'prospecting', label: 'کشف مشتری', advanced: true },
      { key: 'replies', label: 'پاسخ‌ها', advanced: true },
    ],
  },
  {
    key: 'customers',
    label: 'مشتریان',
    defaultKey: 'customers',
    tabs: [
      { key: 'customers', label: 'لیست مشتریان' },
      { key: 'orders', label: 'سفارش‌ها' },
      { key: 'invoices', label: 'فاکتورها' },
      { key: 'crm', label: 'نمای کامل مشتری', advanced: true },
      { key: 'registrationRequests', label: 'درخواست‌های عضویت', advanced: true },
      { key: 'followUps', label: 'پیگیری‌های مالی', advanced: true },
    ],
  },
  { key: 'reports', label: 'گزارش‌ها' },
  {
    key: 'system',
    label: 'سیستم',
    defaultKey: 'products',
    tabs: [
      { key: 'products', label: 'محصولات' },
      { key: 'automation', label: 'اتوماسیون', advanced: true },
    ],
  },
]

const GROUPS_BY_KEY = new Map(GROUPS.map((g) => [g.key, g]))

// Maps every leaf activeKey (and the two legacy Home aliases) to the group
// it now lives under - used to highlight the right sidebar item and to pick
// which group's sub-tabs to show, regardless of which specific page/URL the
// admin is actually on.
const GROUP_OF_KEY = (() => {
  const map = { dashboard: 'home', today: 'home' }
  for (const group of GROUPS) {
    map[group.key] = group.key
    for (const tab of group.tabs || []) map[tab.key] = group.key
  }
  return map
})()

// Every activeKey this app can ever render - unchanged from before this
// cleanup, plus the new 'home' key. Used only to validate a URL segment; it
// is NOT what the sidebar displays (see GROUPS/SIDEBAR_ITEMS above/below).
const ALL_VALID_KEYS = new Set([
  'home',
  'dashboard',
  'today',
  'automation',
  'outreach',
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

  // Sidebar buttons carry a GROUP key (e.g. 'sales'), never a leaf page key
  // directly - clicking one lands on that group's default/first page.
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

  const activeGroupKey = GROUP_OF_KEY[activeKey] || activeKey
  const activeGroup = GROUPS_BY_KEY.get(activeGroupKey)

  return (
    <AppShell
      title="پنل هینزا"
      subtitle="مدیریت فروش B2B"
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

      {(activeKey === 'home' || activeKey === 'today') && (
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
      {activeKey === 'outreach' && <AdminOutreachPage onOpenLead={openLead} />}
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
