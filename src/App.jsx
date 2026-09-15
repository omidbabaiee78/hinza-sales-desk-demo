import { useState } from 'react'
import { useCustomers } from './hooks/useCustomers'
import Dashboard from './components/Dashboard'
import CustomerList from './components/CustomerList'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const { customers, addCustomer, updateCustomer } = useCustomers()

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <h1>Hinza Sales Desk</h1>
          <p>Polymer &amp; masterbatch sales CRM</p>
        </div>
        <nav className="app-tabs">
          <button
            type="button"
            className={activeTab === 'dashboard' ? 'active' : ''}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={activeTab === 'customers' ? 'active' : ''}
            onClick={() => setActiveTab('customers')}
          >
            Customers
          </button>
        </nav>
      </header>

      <main className="app-main">
        {activeTab === 'dashboard' && <Dashboard customers={customers} />}
        {activeTab === 'customers' && (
          <CustomerList
            customers={customers}
            onAdd={addCustomer}
            onUpdate={updateCustomer}
          />
        )}
      </main>
    </div>
  )
}

export default App
