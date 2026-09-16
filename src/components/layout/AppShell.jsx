import { useState } from 'react'
import './AppShell.css'

export default function AppShell({
  title,
  subtitle,
  navItems,
  activeKey,
  onNavigate,
  userLabel,
  onSignOut,
  children,
}) {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <nav className="shell-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === activeKey ? 'active' : ''}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="shell-header">
          <span className="shell-user">{userLabel}</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'در حال خروج...' : 'خروج'}
          </button>
        </header>
        <main className="shell-content">{children}</main>
      </div>
    </div>
  )
}
