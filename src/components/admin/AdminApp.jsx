import { useState } from 'react'
import AppShell from '../layout/AppShell'
import PlaceholderSection from '../common/PlaceholderSection'
import AdminDashboard from './AdminDashboard'
import RegistrationRequestsPage from './RegistrationRequestsPage'

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
  customers: 'مشتریان',
  orders: 'سفارش‌ها',
  products: 'محصولات',
  invoices: 'فاکتورها',
  payments: 'پرداخت‌ها',
  followUps: 'پیگیری‌ها',
}

export default function AdminApp({ profile, onSignOut }) {
  const [activeKey, setActiveKey] = useState('dashboard')

  return (
    <AppShell
      title="پنل هینزا"
      subtitle="مدیریت فروش B2B"
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavigate={setActiveKey}
      userLabel={profile.full_name || profile.phone}
      onSignOut={onSignOut}
    >
      {activeKey === 'dashboard' && (
        <AdminDashboard onNavigate={setActiveKey} />
      )}
      {activeKey === 'registrationRequests' && <RegistrationRequestsPage />}
      {PLACEHOLDER_TITLES[activeKey] && (
        <PlaceholderSection title={PLACEHOLDER_TITLES[activeKey]} />
      )}
    </AppShell>
  )
}
