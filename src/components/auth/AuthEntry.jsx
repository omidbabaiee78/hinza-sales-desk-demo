import { useState } from 'react'
import LoginForm from './LoginForm'
import RegisterForm from './RegisterForm'
import './Auth.css'

export default function AuthEntry({ onSignIn }) {
  const [mode, setMode] = useState('login')

  return (
    <div className="auth-shell">
      {mode === 'login' ? (
        <LoginForm
          onSignIn={onSignIn}
          onSwitchToRegister={() => setMode('register')}
        />
      ) : (
        <RegisterForm
          onRegistered={() => {}}
          onSwitchToLogin={() => setMode('login')}
        />
      )}
    </div>
  )
}
