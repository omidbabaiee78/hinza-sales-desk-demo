import { useState } from 'react'
import JalaliDateInput from '../common/JalaliDateInput'
import ErrorBanner from '../common/ErrorBanner'
import MoneyInput from '../common/MoneyInput'
import { todayJalaali, jalaaliToGregorianIso } from '../../utils/jalali'
import './PaymentForm.css'

function todayIso() {
  const { jy, jm, jd } = todayJalaali()
  return jalaaliToGregorianIso(jy, jm, jd)
}

export default function PaymentForm({ onSubmit, onCancel, submitting }) {
  const [amountRial, setAmountRial] = useState('')
  const [paidAt, setPaidAt] = useState(todayIso())
  const [method, setMethod] = useState('')
  const [referenceCode, setReferenceCode] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const amountNumber = Number(amountRial)
    if (!amountNumber || amountNumber <= 0) {
      setError('لطفاً مبلغ پرداختی معتبر وارد کنید.')
      return
    }
    if (!paidAt) {
      setError('لطفاً تاریخ پرداخت را انتخاب کنید.')
      return
    }

    try {
      await onSubmit({
        amountRial: Math.round(amountNumber),
        paidAt,
        method: method.trim(),
        referenceCode: referenceCode.trim(),
        note: note.trim(),
      })
    } catch (err) {
      setError(err.message || 'ثبت پرداخت با خطا مواجه شد.')
    }
  }

  return (
    <form className="payment-form" onSubmit={handleSubmit}>
      <label>
        مبلغ پرداختی *
        <MoneyInput valueRial={amountRial} onChangeRial={setAmountRial} required />
      </label>
      <label>
        تاریخ پرداخت *
        <JalaliDateInput value={paidAt} onChange={setPaidAt} required />
      </label>
      <label>
        روش پرداخت (اختیاری)
        <input type="text" value={method} onChange={(e) => setMethod(e.target.value)} />
      </label>
      <label>
        شماره پیگیری (اختیاری)
        <input
          type="text"
          dir="ltr"
          value={referenceCode}
          onChange={(e) => setReferenceCode(e.target.value)}
        />
      </label>
      <label>
        توضیح (اختیاری)
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <ErrorBanner message={error} />

      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
          انصراف
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'در حال ثبت...' : 'ثبت پرداخت'}
        </button>
      </div>
    </form>
  )
}
