import { useState } from 'react'
import { useManualOutreach } from '../../../hooks/useManualOutreach'
import { MANUAL_DAILY_LIMIT, displayPhone } from '../../../outreach/manualOutreach'
import { formatJalaliDate, formatJalaliDateTime } from '../../../utils/formatters'
import ErrorBanner from '../../common/ErrorBanner'
import '../today/Today.css'

// Daily Manual Outreach: up to 20 registered leads with a phone number per
// day. The admin contacts each one by hand (WhatsApp, Bale, a call - any
// app) and ticks «پیام دادم». Nothing is sent from this page.

function PhoneCell({ row }) {
  const [copied, setCopied] = useState(false)
  const number = displayPhone(row.phone)
  async function copy() {
    try {
      await navigator.clipboard.writeText(number)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <>
      <a href={`tel:${row.phone}`} dir="ltr">
        {number}
      </a>
      {row.phone_kind === 'landline' && <div className="lead-form-hint">تلفن ثابت</div>}
      <div>
        <button type="button" className="btn-link" onClick={copy}>
          {copied ? 'کپی شد' : 'کپی شماره'}
        </button>
      </div>
    </>
  )
}

function QualificationCell({ row }) {
  const c = row.candidate
  if (!c) return <span className="lead-form-hint">سرنخ ثبت‌شده{row.lead?.need_note ? ` · ${row.lead.need_note}` : ''}</span>
  return (
    <>
      {c.overall_score != null && <div>امتیاز {c.overall_score}</div>}
      {(c.qualification_reason || c.business_description) && <div className="lead-form-hint">{c.qualification_reason || c.business_description}</div>}
    </>
  )
}

function ManualTable({ rows, saving, onToggle, onOpenLead, onAddToCrm, empty }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>پیام دادم</th>
          <th>شرکت</th>
          <th>نام مخاطب</th>
          <th>شماره</th>
          <th>شهر</th>
          <th>صنعت</th>
          <th>صلاحیت</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="profile-empty">
              {empty}
            </td>
          </tr>
        )}
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <label>
                <input
                  type="checkbox"
                  checked={row.status === 'contacted'}
                  disabled={saving.has(row.id)}
                  onChange={(e) => onToggle(row.id, e.target.checked)}
                />{' '}
                پیام دادم
              </label>
              {row.contacted_at && <div className="lead-form-hint">{formatJalaliDateTime(row.contacted_at)}</div>}
            </td>
            <td>
              <button type="button" className="btn-link" onClick={() => onOpenLead?.(row.lead_id)}>
                {row.lead?.company_name || '—'}
              </button>
              {onAddToCrm && (
                <div>
                  <button type="button" className="btn-link lead-form-hint" onClick={() => onAddToCrm(row.lead_id)}>
                    افزودن به CRM
                  </button>
                </div>
              )}
            </td>
            <td>{row.lead?.contact_name || '—'}</td>
            <td>
              <PhoneCell row={row} />
            </td>
            <td>{[row.lead?.city, row.lead?.province].filter(Boolean).join('، ') || '—'}</td>
            <td>{row.lead?.industry || row.candidate?.industry_guess || '—'}</td>
            <td>
              <QualificationCell row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ManualOutreachPage({ onOpenLead, onAddToCrm }) {
  const m = useManualOutreach()

  return (
    <div className="today-page">
      <div className="page-toolbar">
        <div>
          <h2>تماس دستی روزانه</h2>
          <p className="today-subtitle">
            هر روز حداکثر {MANUAL_DAILY_LIMIT} سرنخ دارای شماره. با واتساپ، بله یا تلفن خودتان تماس بگیرید و «پیام دادم» را بزنید. از این صفحه هیچ پیامی
            ارسال نمی‌شود.
          </p>
        </div>
        <button type="button" className="btn-secondary" disabled={m.loading} onClick={m.refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={m.error} onRetry={m.refresh} />

      <div className="today-summary-grid">
        <div className="today-summary-card tone-won">
          <span className="today-summary-value">
            {m.contacted} / {m.total}
          </span>
          <span className="today-summary-label">انجام‌شدهٔ امروز{m.day ? ` (${formatJalaliDate(m.day)})` : ''}</span>
        </div>
        <div className="today-summary-card tone-offer">
          <span className="today-summary-value">{m.pending.length}</span>
          <span className="today-summary-label">مانده برای امروز</span>
        </div>
      </div>

      {m.loading && <p className="profile-empty">در حال بارگذاری...</p>}
      {!m.loading && (
        <>
          <ManualTable
            rows={m.pending}
            saving={m.saving}
            onToggle={m.setContacted}
            onOpenLead={onOpenLead}
            onAddToCrm={onAddToCrm}
            empty={m.total ? 'همهٔ تماس‌های امروز انجام شد.' : 'امروز سرنخ واجد شرایطی با شماره تماس نیست.'}
          />
          <h3>انجام‌شده امروز</h3>
          <ManualTable rows={m.done} saving={m.saving} onToggle={m.setContacted} onOpenLead={onOpenLead} onAddToCrm={onAddToCrm} empty="هنوز موردی علامت نخورده است." />
        </>
      )}
    </div>
  )
}
