import { useState } from 'react'
import { useRegisterCustomer } from '../../hooks/useRegisterCustomer'
import { isValidIranMobile } from '../../utils/phone'

const EMPTY_FORM = {
  fullName: '',
  companyName: '',
  mobile: '',
  email: '',
  province: '',
  city: '',
  password: '',
  repeatPassword: '',
}

export default function RegisterForm({ onRegistered, onSwitchToLogin }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const { registerCustomer, submitting } = useRegisterCustomer()

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (
      !form.fullName.trim() ||
      !form.companyName.trim() ||
      !form.mobile.trim() ||
      !form.province.trim() ||
      !form.city.trim() ||
      !form.password
    ) {
      setError('لطفاً همه فیلدهای الزامی را تکمیل کنید.')
      return
    }
    if (!isValidIranMobile(form.mobile)) {
      setError('شماره موبایل را به‌صورت صحیح وارد کنید.')
      return
    }
    if (form.password.length < 6) {
      setError('رمز عبور باید حداقل ۶ کاراکتر باشد.')
      return
    }
    if (form.password !== form.repeatPassword) {
      setError('رمز عبور و تکرار آن یکسان نیستند.')
      return
    }

    try {
      await registerCustomer(form)
      onRegistered()
    } catch (err) {
      setError(err.message || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.')
    }
  }

  return (
    <div className="auth-panel">
      <h1>هینزا پلیمر</h1>
      <p className="auth-subtitle">ثبت‌نام مشتری جدید</p>

      <form onSubmit={handleSubmit}>
        <div className="auth-row">
          <label>
            نام و نام خانوادگی *
            <input
              type="text"
              required
              value={form.fullName}
              onChange={(e) => handleChange('fullName', e.target.value)}
            />
          </label>
          <label>
            نام شرکت *
            <input
              type="text"
              required
              value={form.companyName}
              onChange={(e) => handleChange('companyName', e.target.value)}
            />
          </label>
        </div>

        <div className="auth-row">
          <label>
            شماره موبایل *
            <input
              type="tel"
              dir="ltr"
              required
              placeholder="09xxxxxxxxx"
              value={form.mobile}
              onChange={(e) => handleChange('mobile', e.target.value)}
            />
          </label>
          <label>
            ایمیل (اختیاری)
            <input
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </label>
        </div>

        <div className="auth-row">
          <label>
            استان *
            <input
              type="text"
              required
              value={form.province}
              onChange={(e) => handleChange('province', e.target.value)}
            />
          </label>
          <label>
            شهر *
            <input
              type="text"
              required
              value={form.city}
              onChange={(e) => handleChange('city', e.target.value)}
            />
          </label>
        </div>

        <div className="auth-row">
          <label>
            رمز عبور *
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
            />
          </label>
          <label>
            تکرار رمز عبور *
            <input
              type="password"
              required
              value={form.repeatPassword}
              onChange={(e) => handleChange('repeatPassword', e.target.value)}
            />
          </label>
        </div>

        {error && <div className="auth-message auth-error">{error}</div>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'در حال ثبت‌نام...' : 'ثبت‌نام'}
        </button>
      </form>

      <button type="button" className="auth-toggle" onClick={onSwitchToLogin}>
        قبلاً ثبت‌نام کرده‌اید؟ وارد شوید
      </button>
    </div>
  )
}
