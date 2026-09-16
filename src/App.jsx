import { useAuth } from './hooks/useAuth'
import { useProfile } from './hooks/useProfile'
import LoadingScreen from './components/common/LoadingScreen'
import AuthEntry from './components/auth/AuthEntry'
import AccountStatusScreen from './components/auth/AccountStatusScreen'
import AdminApp from './components/admin/AdminApp'
import CustomerApp from './components/customer/CustomerApp'

function AuthenticatedGate({ user, onSignOut }) {
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
    return <AccountStatusScreen variant="rejected" onSignOut={onSignOut} />
  }

  if (approvalStatus !== 'approved') {
    return <AccountStatusScreen variant="pending" onSignOut={onSignOut} />
  }

  if (role === 'admin') {
    return <AdminApp profile={profile} onSignOut={onSignOut} />
  }

  if (role === 'customer') {
    return <CustomerApp profile={profile} company={company} onSignOut={onSignOut} />
  }

  return <AccountStatusScreen variant="unknown" onSignOut={onSignOut} />
}

function App() {
  const { session, user, loading, signIn, signOut } = useAuth()

  if (loading) {
    return <LoadingScreen />
  }

  if (!session) {
    return <AuthEntry onSignIn={signIn} />
  }

  return <AuthenticatedGate user={user} onSignOut={signOut} />
}

export default App
