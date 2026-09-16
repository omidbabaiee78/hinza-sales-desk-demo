import { useState } from 'react'

export default function LoginForm({ onSignIn, onSwitchToRegister }) {
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!mobile.trim() || !password.trim()) {
      setError('لطفاً شماره موبایل و رمز عبور را وارد کنید.')
      return
    }
    setSubmitting(true)
    try {
      await onSignIn(mobile.trim(), password)
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
            type="tel"
            dir="ltr"
            autoComplete="tel"
            placeholder="09xxxxxxxxx"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            required
          />
        </label>
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
