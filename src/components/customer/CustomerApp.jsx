import { useState } from 'react'
import AppShell from '../layout/AppShell'
import PlaceholderSection from '../common/PlaceholderSection'
import CustomerDashboard from './CustomerDashboard'
import CompanyProfile from './CompanyProfile'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'داشبورد من' },
  { key: 'newOrder', label: 'ثبت سفارش' },
  { key: 'orders', label: 'سفارش‌های من' },
  { key: 'invoices', label: 'فاکتورها' },
  { key: 'account', label: 'حساب و پرداخت‌ها' },
  { key: 'profile', label: 'پروفایل شرکت' },
]

const PLACEHOLDER_TITLES = {
  newOrder: 'ثبت سفارش',
  orders: 'سفارش‌های من',
  invoices: 'فاکتورها',
  account: 'حساب و پرداخت‌ها',
}

export default function CustomerApp({ profile, company, onSignOut }) {
  const [activeKey, setActiveKey] = useState('dashboard')

  return (
    <AppShell
      title="هینزا پلیمر"
      subtitle={company?.name || 'پرتال مشتریان'}
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavigate={setActiveKey}
      userLabel={profile.full_name || profile.phone}
      onSignOut={onSignOut}
    >
      {activeKey === 'dashboard' && (
        <CustomerDashboard company={company} onNavigate={setActiveKey} />
      )}
      {activeKey === 'profile' && (
        <CompanyProfile profile={profile} company={company} />
      )}
      {PLACEHOLDER_TITLES[activeKey] && (
        <PlaceholderSection title={PLACEHOLDER_TITLES[activeKey]} />
      )}
    </AppShell>
  )
}
