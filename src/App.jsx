import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { useCustomers } from './hooks/useCustomers'
import Dashboard from './components/Dashboard'
import CustomerList from './components/CustomerList'
import AuthPage from './components/AuthPage'

function CrmShell({ user, onSignOut }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [signingOut, setSigningOut] = useState(false)
  const {
    customers,
    loading,
    error,
    addCustomer,
    updateCustomer,
    deleteCustomer,
  } = useCustomers()

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <h1>Hinza Sales Desk</h1>
          <p>سامانه فروش پلیمر و مستربچ</p>
        </div>
        <nav className="app-tabs">
          <button
            type="button"
            className={activeTab === 'dashboard' ? 'active' : ''}
            onClick={() => setActiveTab('dashboard')}
          >
            داشبورد
          </button>
          <button
            type="button"
            className={activeTab === 'customers' ? 'active' : ''}
            onClick={() => setActiveTab('customers')}
          >
            مشتریان
          </button>
        </nav>
        <div className="app-user">
          <span className="app-user-email">{user.email}</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'در حال خروج...' : 'خروج'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'dashboard' && <Dashboard customers={customers} />}
        {activeTab === 'customers' && (
          <CustomerList
            customers={customers}
            loading={loading}
            error={error}
            onAdd={addCustomer}
            onUpdate={updateCustomer}
            onDelete={deleteCustomer}
          />
        )}
      </main>
    </div>
  )
}

function App() {
  const { session, user, loading, signIn, signUp, signOut } = useAuth()

  if (loading) {
    return (
      <div className="app-loading">
        <p>در حال بارگذاری...</p>
      </div>
    )
  }

  if (!session) {
    return <AuthPage onSignIn={signIn} onSignUp={signUp} />
  }

  return <CrmShell user={user} onSignOut={signOut} />
}

export default App
