import { useState } from 'react'
import LoginForm from './LoginForm'
import RegisterForm from './RegisterForm'
import BrandLogo from '../common/BrandLogo'
import PolymerDots from '../common/PolymerDots'
import Footer from '../common/Footer'
import QuickContact from '../common/QuickContact'
import { BRAND_NAME_FA, BRAND_TAGLINE } from '../../constants/brand'
import './Auth.css'

export default function AuthEntry({ onSignIn, onOpenContact }) {
  const [mode, setMode] = useState('login')

  return (
    <div className="auth-shell">
      <div className="auth-layout">
        <div className="auth-branding">
          <BrandLogo size="lg" />
          <h1>{BRAND_NAME_FA}</h1>
          <p>{BRAND_TAGLINE}</p>
          <PolymerDots className="auth-branding-dots" />
        </div>

        <div className="auth-form-area">
          {mode === 'login' ? (
            <LoginForm onSignIn={onSignIn} onSwitchToRegister={() => setMode('register')} />
          ) : (
            <RegisterForm onRegistered={() => {}} onSwitchToLogin={() => setMode('login')} />
          )}
          <button type="button" className="auth-contact-link" onClick={onOpenContact}>
            تماس با ما
          </button>
        </div>
      </div>

      <Footer />
      <QuickContact />
    </div>
  )
}
