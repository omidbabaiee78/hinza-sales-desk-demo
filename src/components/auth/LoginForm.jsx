import { useState } from 'react'

export default function LoginForm({ onSignIn, onSwitchToRegister }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!identifier.trim() || !password.trim()) {
      setError('لطفاً شماره موبایل و رمز عبور را وارد کنید.')
      return
    }
    setSubmitting(true)
    try {
      await onSignIn(identifier.trim(), password)
    } catch (err) {
      setError(err.message || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-panel">
      <h1>هینزا پلیمر</h1>
      <p className="auth-subtitle">ورود به پنل</p>

      <form onSubmit={handleSubmit}>
        <label>
          شماره موبایل
          <input
            type="text"
            dir="ltr"
            inputMode="tel"
            autoComplete="username"
            placeholder="09xxxxxxxxx"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
        </label>
        <p className="auth-hint">مدیر سیستم می‌تواند با ایمیل وارد شود</p>
        <label>
          رمز عبور
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="auth-message auth-error">{error}</div>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'در حال ورود...' : 'ورود'}
        </button>
      </form>

      <button type="button" className="auth-toggle" onClick={onSwitchToRegister}>
        مشتری جدید هستید؟ ثبت‌نام کنید
      </button>
    </div>
  )
}
