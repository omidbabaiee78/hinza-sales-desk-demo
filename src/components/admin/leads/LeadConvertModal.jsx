import { useMemo, useState } from 'react'
import { convertLeadToExistingCompany, convertLeadToNewCompany } from '../../../services/salesLeads'
import { findLeadDuplicates } from '../../../utils/leadDuplicates'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

// Critical flow: never creates an auth user/profile/company_members - the
// RPC itself only ever touches companies + sales_leads + lead_activities.
export default function LeadConvertModal({ lead, companies, onConverted, onOpenCustomer, onCancel }) {
  const [companyNameInput, setCompanyNameInput] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null) // { companyId } once converted

  const matches = useMemo(
    () =>
      findLeadDuplicates({
        mobile: lead.mobile,
        phone: lead.phone,
        companyName: lead.company_name,
        leads: [],
        companies,
      }).filter((m) => m.type === 'company'),
    [lead, companies],
  )

  const needsCompanyName = !lead.company_name?.trim()

  async function handleLinkExisting(companyId) {
    setError('')
    setSubmitting(true)
    try {
      await convertLeadToExistingCompany(lead.id, companyId)
      setResult({ companyId })
      onConverted()
    } catch (err) {
      setError(err.message || 'تبدیل به مشتری با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  async function handleCreateNew() {
    if (needsCompanyName && !companyNameInput.trim()) {
      setError('برای ایجاد مشتری جدید، نام شرکت را وارد کنید.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const companyId = await convertLeadToNewCompany(lead.id, {
        companyNameOverride: needsCompanyName ? companyNameInput.trim() : undefined,
      })
      setResult({ companyId })
      onConverted()
    } catch (err) {
      setError(err.message || 'تبدیل به مشتری با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
          <h2>تبدیل به مشتری</h2>
          <p className="success-banner">سرنخ با موفقیت به مشتری تبدیل شد.</p>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              بستن
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onOpenCustomer(result.companyId)}
            >
              مشاهده مشتری
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h2>تبدیل به مشتری</h2>

        {matches.length > 0 && (
          <section className="lead-convert-section">
            <h3>مشتریان احتمالاً مشابه</h3>
            <ul className="lead-convert-matches">
              {matches.map((match) => (
                <li key={match.id}>
                  <div>
                    <div>{match.label}</div>
                    {match.sub && <div className="lead-form-hint">{match.sub}</div>}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={submitting}
                    onClick={() => handleLinkExisting(match.id)}
                  >
                    اتصال به مشتری موجود
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="lead-convert-section">
          <h3>ایجاد مشتری جدید</h3>
          {needsCompanyName ? (
            <label>
              نام شرکت (الزامی)
              <input
                type="text"
                value={companyNameInput}
                onChange={(e) => setCompanyNameInput(e.target.value)}
                placeholder="این سرنخ فقط نام شخص دارد - نام شرکت را وارد کنید"
              />
            </label>
          ) : (
            <p className="lead-form-hint">مشتری جدید با نام «{lead.company_name}» ایجاد می‌شود.</p>
          )}
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="button" className="btn-primary" onClick={handleCreateNew} disabled={submitting}>
              {submitting ? 'در حال ثبت...' : 'ایجاد مشتری جدید'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
