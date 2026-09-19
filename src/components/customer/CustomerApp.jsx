import { useState } from 'react'
import AppShell from '../layout/AppShell'
import BrandLogo from '../common/BrandLogo'
import Footer from '../common/Footer'
import QuickContact from '../common/QuickContact'
import CustomerDashboard from './CustomerDashboard'
import CompanyProfile from './CompanyProfile'
import NewOrderPage from './NewOrderPage'
import CustomerProductsPage from './CustomerProductsPage'
import CustomerProductDetail from './CustomerProductDetail'
import CustomerOrdersPage from './CustomerOrdersPage'
import CustomerOrderDetail from './CustomerOrderDetail'
import CustomerInvoicesPage from './CustomerInvoicesPage'
import CustomerInvoiceDetail from './CustomerInvoiceDetail'
import AccountPage from './AccountPage'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'داشبورد' },
  { key: 'products', label: 'محصولات' },
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
  const [selectedProductId, setSelectedProductId] = useState(null)
  const [requestedProductId, setRequestedProductId] = useState(null)
  const [reorderSourceOrderId, setReorderSourceOrderId] = useState(null)

  function navigate(key) {
    if (key === 'contact') {
      onOpenContact()
      return
    }
    setActiveKey(key)
    setSelectedOrderId(null)
    setSelectedInvoiceId(null)
    setSelectedProductId(null)
    if (key !== 'newOrder') {
      setRequestedProductId(null)
      setReorderSourceOrderId(null)
    }
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

  function openProduct(productId) {
    setActiveKey('products')
    setSelectedProductId(productId)
  }

  // "درخواست قیمت" IS placing an order in this system (an order always
  // starts as a price request the admin then quotes), so it goes straight
  // to the order form with the product pre-selected rather than a separate
  // quote-only flow.
  function requestPrice(productId) {
    setRequestedProductId(productId)
    setActiveKey('newOrder')
    setSelectedProductId(null)
  }

  // "سفارش مجدد": opens the same order form pre-filled from a previous
  // order's products/quantities (never its prices) - the form itself
  // fetches and validates that order, this just navigates to it.
  function reorderFromOrder(orderId) {
    setReorderSourceOrderId(orderId)
    setActiveKey('newOrder')
    setSelectedOrderId(null)
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
          onReorder={reorderFromOrder}
        />
      )}
      {activeKey === 'products' &&
        (selectedProductId ? (
          <CustomerProductDetail
            productId={selectedProductId}
            onBack={() => setSelectedProductId(null)}
            onRequestPrice={requestPrice}
          />
        ) : (
          <CustomerProductsPage onOpenProduct={openProduct} onRequestPrice={requestPrice} />
        ))}
      {activeKey === 'newOrder' && (
        <NewOrderPage
          initialProductId={requestedProductId}
          sourceOrderId={reorderSourceOrderId}
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
            onReorder={reorderFromOrder}
          />
        ) : (
          <CustomerOrdersPage
            company={company}
            onOpenOrder={setSelectedOrderId}
            onReorder={reorderFromOrder}
          />
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
