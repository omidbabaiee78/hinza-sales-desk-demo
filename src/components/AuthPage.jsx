import { useState } from 'react'
import './AuthPage.css'

export default function AuthPage({ onSignIn, onSignUp }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const isSignUp = mode === 'signup'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    if (!email.trim() || !password.trim()) {
      setError('لطفاً ایمیل و رمز عبور را وارد کنید.')
      return
    }
    setSubmitting(true)
    try {
      if (isSignUp) {
        await onSignUp(email.trim(), password)
        setMessage('ثبت‌نام با موفقیت انجام شد. اکنون می‌توانید وارد شوید.')
        setMode('signin')
      } else {
        await onSignIn(email.trim(), password)
      }
    } catch (err) {
      setError(err.message || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <h1>Hinza Sales Desk</h1>
        <p className="auth-subtitle">
          {isSignUp ? 'ساخت حساب کاربری جدید' : 'ورود به پنل فروش'}
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            ایمیل
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            رمز عبور
            <input
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <div className="auth-message auth-error">{error}</div>}
          {message && (
            <div className="auth-message auth-success">{message}</div>
          )}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? 'در حال پردازش...'
              : isSignUp
                ? 'ثبت‌نام'
                : 'ورود'}
          </button>
        </form>

        <button
          type="button"
          className="auth-toggle"
          onClick={() => {
            setMode(isSignUp ? 'signin' : 'signup')
            setError('')
            setMessage('')
          }}
        >
          {isSignUp
            ? 'حساب کاربری دارید؟ وارد شوید'
            : 'حساب کاربری ندارید؟ ثبت‌نام کنید'}
        </button>
      </div>
    </div>
  )
}
