import { useAuth } from './hooks/useAuth'
import { useProfile } from './hooks/useProfile'
import { usePathname } from './hooks/usePathname'
import LoadingScreen from './components/common/LoadingScreen'
import ContactPage from './components/common/ContactPage'
import AuthEntry from './components/auth/AuthEntry'
import AccountStatusScreen from './components/auth/AccountStatusScreen'
import AdminApp from './components/admin/AdminApp'
import CustomerApp from './components/customer/CustomerApp'

function AuthenticatedGate({ user, onSignOut, onOpenContact }) {
  const { profile, company, loading, error, refresh } = useProfile(user.id)

  if (loading) {
    return <LoadingScreen text="در حال بررسی وضعیت حساب کاربری..." />
  }

  if (error) {
    return (
      <div className="status-screen">
        <div className="status-panel">
          <h1>خطا در دریافت اطلاعات حساب</h1>
          <p>{error}</p>
          <button type="button" className="btn-primary" onClick={refresh}>
            تلاش مجدد
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 10 }}
            onClick={onSignOut}
          >
            خروج
          </button>
        </div>
      </div>
    )
  }

  const approvalStatus = profile?.approval_status
  const role = profile?.role

  if (approvalStatus === 'rejected') {
    return (
      <AccountStatusScreen variant="rejected" onSignOut={onSignOut} onOpenContact={onOpenContact} />
    )
  }

  if (approvalStatus !== 'approved') {
    return (
      <AccountStatusScreen variant="pending" onSignOut={onSignOut} onOpenContact={onOpenContact} />
    )
  }

  if (role === 'admin') {
    return <AdminApp profile={profile} onSignOut={onSignOut} />
  }

  if (role === 'customer') {
    return (
      <CustomerApp
        profile={profile}
        company={company}
        onSignOut={onSignOut}
        onOpenContact={onOpenContact}
      />
    )
  }

  return <AccountStatusScreen variant="unknown" onSignOut={onSignOut} onOpenContact={onOpenContact} />
}

function App() {
  const { pathname, navigate } = usePathname()
  const { session, user, loading, signIn, signOut } = useAuth()

  // /contact is public and works regardless of auth/session state.
  if (pathname === '/contact') {
    return <ContactPage onBack={() => navigate('/')} />
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    return <AuthEntry onSignIn={signIn} onOpenContact={() => navigate('/contact')} />
  }

  return (
    <AuthenticatedGate
      user={user}
      onSignOut={signOut}
      onOpenContact={() => navigate('/contact')}
    />
  )
}

export default App
