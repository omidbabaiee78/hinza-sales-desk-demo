import { useState } from 'react'
import { useCompanyFollowUps } from '../../hooks/useFollowUps'
import { formatJalaliDateTime } from '../../utils/formatters'
import { todayJalaali, jalaaliToGregorianIso } from '../../utils/jalali'
import FollowUpStatusBadge from '../followups/FollowUpStatusBadge'
import JalaliDateInput from '../common/JalaliDateInput'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import '../invoices/PaymentForm.css'

function todayIso() {
  const { jy, jm, jd } = todayJalaali()
  return jalaaliToGregorianIso(jy, jm, jd)
}

// Combines the Jalali-picked Gregorian date with a plain "HH:MM" time into
// the UTC instant timestamptz expects. A date-time string with no timezone
// suffix is interpreted as local time by JS, so this is the only place the
// admin's wall-clock pick turns into the ISO value sent to Supabase.
function toIsoDateTime(dateIso, time) {
  if (!dateIso || !time) return null
  const date = new Date(`${dateIso}T${time}:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const EMPTY_FORM = { date: todayIso(), time: '09:00', note: '' }

export default function CustomerFollowUps({ companyId }) {
  const { followUps, loading, error, createFollowUp, setStatus, submitting } =
    useCompanyFollowUps(companyId)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function startAdd() {
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')
    const dueAt = toIsoDateTime(form.date, form.time)
    if (!dueAt) {
      setFormError('لطفاً تاریخ و ساعت پیگیری را انتخاب کنید.')
      return
    }
    try {
      await createFollowUp({ dueAt, note: form.note })
      setShowForm(false)
    } catch (err) {
      setFormError(err.message || 'ثبت پیگیری با خطا مواجه شد.')
    }
  }

  async function handleAction(id, status) {
    setActionError('')
    try {
      await setStatus(id, status)
    } catch (err) {
      setActionError(err.message || 'به‌روزرسانی پیگیری با خطا مواجه شد.')
    }
  }

  return (
    <section>
      <div className="page-toolbar">
        <h3 style={{ margin: 0 }}>پیگیری‌ها</h3>
        {!showForm && (
          <button type="button" className="btn-secondary" onClick={startAdd}>
            + افزودن پیگیری
          </button>
        )}
      </div>

      <ErrorBanner message={error} />
      <ErrorBanner message={actionError} />

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>تاریخ و زمان پیگیری</th>
              <th>یادداشت</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading && followUps.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-row">
                  پیگیری‌ای برای این مشتری ثبت نشده است.
                </td>
              </tr>
            )}
            {!loading &&
              followUps.map((item) => (
                <tr key={item.id}>
                  <td>{formatJalaliDateTime(item.due_at)}</td>
                  <td className="cell-notes" title={item.note}>
                    {item.note || '—'}
                  </td>
                  <td>
                    <FollowUpStatusBadge followUp={item} />
                  </td>
                  <td className="cell-actions">
                    {item.status === 'open' && (
                      <>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => handleAction(item.id, 'done')}
                          disabled={submitting}
                        >
                          انجام شد
                        </button>
                        <button
                          type="button"
                          className="btn-link btn-link-danger"
                          onClick={() => handleAction(item.id, 'cancelled')}
                          disabled={submitting}
                        >
                          لغو
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <form className="payment-form" onSubmit={handleSubmit}>
          <label>
            تاریخ پیگیری *
            <JalaliDateInput
              value={form.date}
              onChange={(value) => handleChange('date', value)}
              required
            />
          </label>
          <label>
            ساعت *
            <input
              type="time"
              required
              value={form.time}
              onChange={(e) => handleChange('time', e.target.value)}
            />
          </label>
          <label>
            یادداشت
            <textarea
              rows={2}
              value={form.note}
              onChange={(e) => handleChange('note', e.target.value)}
            />
          </label>

          <ErrorBanner message={formError} />

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowForm(false)}
              disabled={submitting}
            >
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'در حال ثبت...' : 'افزودن'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
