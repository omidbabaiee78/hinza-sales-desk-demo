import { useState } from 'react'
import { useActiveProducts } from '../../../hooks/useActiveProducts'
import { recordLeadSample } from '../../../services/leadSamples'
import { tehranDateKey } from '../../../utils/leadFollowUp'
import JalaliDateInput from '../../common/JalaliDateInput'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

// Records one sample sent to a lead. The lead's own follow-up date is left
// as-is - the feedback due date is tracked on the sample and shown on Today.
export default function LeadSampleFormModal({ leadId, onSaved, onCancel }) {
  const { products } = useActiveProducts()
  const [productId, setProductId] = useState('')
  const [quantityKg, setQuantityKg] = useState('')
  const [sentOn, setSentOn] = useState(() => tehranDateKey())
  const [feedbackDueOn, setFeedbackDueOn] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!productId || !sentOn || !feedbackDueOn || !(Number(quantityKg) > 0)) {
      setError('محصول، مقدار، تاریخ ارسال و موعد بازخورد را کامل وارد کنید.')
      return
    }
    if (feedbackDueOn < sentOn) {
      setError('موعد بازخورد نمی‌تواند قبل از تاریخ ارسال باشد.')
      return
    }
    const product = products.find((p) => p.id === productId)
    setSubmitting(true)
    try {
      const result = await recordLeadSample(leadId, {
        productId,
        productLabel: product ? `${product.code} ${product.name_fa}` : 'محصول',
        quantityKg,
        sentOn,
        feedbackDueOn,
        note,
      })
      onSaved(result)
    } catch (err) {
      setError(err.message || 'ثبت نمونه با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>ثبت ارسال نمونه</h2>
        <form onSubmit={handleSubmit}>
          <label>
            محصول
            <select value={productId} required onChange={(e) => setProductId(e.target.value)}>
              <option value="">انتخاب محصول...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.name_fa}
                </option>
              ))}
            </select>
          </label>
          <label>
            مقدار (کیلوگرم)
            <input type="number" min="0.01" step="0.01" dir="ltr" required value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)} />
          </label>
          <label>
            تاریخ ارسال
            <JalaliDateInput value={sentOn} onChange={setSentOn} required />
          </label>
          <label>
            موعد بازخورد
            <JalaliDateInput value={feedbackDueOn} onChange={setFeedbackDueOn} required />
          </label>
          <label>
            یادداشت (اختیاری)
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'در حال ثبت...' : 'ثبت نمونه'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
