import { Fragment, useState } from 'react'
import { useRegistrationRequests } from '../../hooks/useRegistrationRequests'
import { formatJalaliDate } from '../../utils/formatters'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'

export default function RegistrationRequestsPage() {
  const { requests, loading, error, approveRequest, rejectRequest, refresh } =
    useRegistrationRequests()
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectNote, setRejectNote] = useState('')

  async function handleApprove(id) {
    setActionError('')
    setBusyId(id)
    try {
      await approveRequest(id)
    } catch (err) {
      setActionError(err.message || 'تأیید درخواست با خطا مواجه شد.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(id) {
    setActionError('')
    setBusyId(id)
    try {
      await rejectRequest(id, rejectNote.trim())
      setRejectingId(null)
      setRejectNote('')
    } catch (err) {
      setActionError(err.message || 'رد درخواست با خطا مواجه شد.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="page-toolbar">
        <h2>درخواست‌های عضویت در انتظار تأیید</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />
      <ErrorBanner message={actionError} />

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>نام و نام خانوادگی</th>
              <th>نام شرکت</th>
              <th>موبایل</th>
              <th>ایمیل</th>
              <th>استان / شهر</th>
              <th>تاریخ ثبت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              requests.map((req) => (
                <Fragment key={req.id}>
                  <tr>
                    <td>{req.full_name}</td>
                    <td>{req.company_name}</td>
                    <td dir="ltr" style={{ textAlign: 'right' }}>
                      {req.mobile}
                    </td>
                    <td dir="ltr" style={{ textAlign: 'right' }}>
                      {req.email || '—'}
                    </td>
                    <td>
                      {req.province} / {req.city}
                    </td>
                    <td>{formatJalaliDate(req.created_at)}</td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => handleApprove(req.id)}
                        disabled={busyId === req.id}
                      >
                        {busyId === req.id ? 'در حال پردازش...' : 'تأیید'}
                      </button>
                      <button
                        type="button"
                        className="btn-link btn-link-danger"
                        onClick={() =>
                          setRejectingId(rejectingId === req.id ? null : req.id)
                        }
                        disabled={busyId === req.id}
                      >
                        رد درخواست
                      </button>
                    </td>
                  </tr>
                  {rejectingId === req.id && (
                    <tr>
                      <td colSpan={7}>
                        <div className="reject-row">
                          <input
                            type="text"
                            placeholder="یادداشت رد درخواست (اختیاری)"
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => handleReject(req.id)}
                            disabled={busyId === req.id}
                          >
                            {busyId === req.id
                              ? 'در حال ثبت...'
                              : 'ثبت رد درخواست'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setRejectingId(null)
                              setRejectNote('')
                            }}
                          >
                            انصراف
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            {!loading && requests.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  درخواست در انتظار تأییدی وجود ندارد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
