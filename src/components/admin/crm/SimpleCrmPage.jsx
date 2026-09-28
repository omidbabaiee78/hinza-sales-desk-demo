import { useEffect, useState } from 'react'
import { loadLeadForCrm, searchLeadsForCrm, useSimpleCrm } from '../../../hooks/useSimpleCrm'
import { CRM_SOURCES, crmErrorMessage, crmFormFromLead, crmFormFromRecord, emptyCrmForm, matchesCrmSearch } from '../../../crm/simpleCrm'
import { formatJalaliDateTime } from '../../../utils/formatters'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'
import '../today/Today.css'

// Simple CRM: companies/people the admin deliberately adds once they become
// a real opportunity. Separate from the lead list - a record may link to a
// lead and be prefilled from it, but saving never changes that lead.
// Create / view / edit only.

const FIELD_LABELS = {
  company_name: 'شرکت',
  contact_name: 'نام مخاطب',
  phone: 'تلفن',
  email: 'ایمیل',
  city: 'شهر',
  product_interest: 'محصول مورد علاقه',
  notes: 'یادداشت',
  source: 'منبع',
}

function LeadLinkPicker({ linked, onPick, onClear }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      searchLeadsForCrm(query)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && setResults([]))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  if (linked) {
    return (
      <p className="lead-form-hint">
        متصل به سرنخ: <strong>{linked.company_name || '—'}</strong>{' '}
        <button type="button" className="btn-link" onClick={onClear}>
          حذف اتصال
        </button>
      </p>
    )
  }
  return (
    <label>
      اتصال به سرنخ موجود (اختیاری)
      <input type="search" value={query} placeholder="نام شرکت یا مخاطب..." onChange={(e) => setQuery(e.target.value)} />
      {query.trim().length >= 2 && (
        <div className="admin-more-tools-links">
          {results.length === 0 && <span className="lead-form-hint">سرنخی پیدا نشد.</span>}
          {results.map((lead) => (
            <button key={lead.id} type="button" className="today-chip" onClick={() => onPick(lead.id)}>
              {lead.company_name || lead.contact_name}
              {lead.city ? ` · ${lead.city}` : ''}
            </button>
          ))}
        </div>
      )}
    </label>
  )
}

function CrmFormModal({ record, initialLeadId, onCreate, onUpdate, onOpenRecord, onClose }) {
  const editing = Boolean(record)
  const [form, setForm] = useState(() => (editing ? crmFormFromRecord(record) : emptyCrmForm()))
  const [linked, setLinked] = useState(null) // { id, company_name }
  const [duplicate, setDuplicate] = useState(null) // existing CRM record of the picked lead
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function pickLead(leadId) {
    setError('')
    try {
      const info = await loadLeadForCrm(leadId)
      setLinked({ id: info.lead.id, company_name: info.lead.company_name || info.lead.contact_name })
      setDuplicate(info.existing)
      setForm(crmFormFromLead(info.lead, info))
    } catch {
      setError('خواندن اطلاعات سرنخ انجام نشد.')
    }
  }

  useEffect(() => {
    if (!editing && initialLeadId) Promise.resolve().then(() => pickLead(initialLeadId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (duplicate) return
    setError('')
    setSaving(true)
    try {
      if (editing) await onUpdate(record.id, form)
      else await onCreate(form, linked?.id)
      onClose()
    } catch (err) {
      setError(crmErrorMessage(err))
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? 'ویرایش رکورد CRM' : 'افزودن رکورد CRM'}</h2>
        <form onSubmit={handleSubmit}>
          {editing ? (
            record.lead && <p className="lead-form-hint">متصل به سرنخ: {record.lead.company_name || '—'}</p>
          ) : (
            <LeadLinkPicker
              linked={linked}
              onPick={pickLead}
              onClear={() => {
                setLinked(null)
                setDuplicate(null)
              }}
            />
          )}
          {duplicate && (
            <div className="error-banner">
              این سرنخ قبلاً در CRM ثبت شده است («{duplicate.company_name}»).{' '}
              <button type="button" className="btn-link" onClick={() => onOpenRecord(duplicate.id)}>
                باز کردن همان رکورد
              </button>
            </div>
          )}
          {['company_name', 'contact_name', 'phone', 'email', 'city', 'product_interest'].map((key) => (
            <label key={key}>
              {FIELD_LABELS[key]}
              {key === 'company_name' && ' *'}
              <input
                type={key === 'email' ? 'email' : 'text'}
                dir={key === 'phone' || key === 'email' ? 'ltr' : undefined}
                value={form[key]}
                required={key === 'company_name'}
                onChange={set(key)}
              />
            </label>
          ))}
          <label>
            {FIELD_LABELS.notes}
            <textarea rows={6} value={form.notes} onChange={set('notes')} />
          </label>
          <label>
            {FIELD_LABELS.source}
            <select value={form.source} onChange={set('source')}>
              {Object.entries(CRM_SOURCES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {linked && <p className="lead-form-hint">اطلاعات از سرنخ کپی شد. تغییر آن‌ها اینجا، سرنخ اصلی را تغییر نمی‌دهد.</p>}
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={saving || Boolean(duplicate)}>
              {saving ? 'در حال ذخیره...' : 'ذخیره'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CrmViewModal({ record, onEdit, onOpenLead, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{record.company_name}</h2>
        {['contact_name', 'phone', 'email', 'city', 'product_interest'].map((key) => (
          <p key={key}>
            <strong>{FIELD_LABELS[key]}:</strong> <span dir={key === 'phone' || key === 'email' ? 'ltr' : undefined}>{record[key] || '—'}</span>
          </p>
        ))}
        <p>
          <strong>{FIELD_LABELS.notes}:</strong>
        </p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{record.notes || '—'}</p>
        <p className="lead-form-hint">
          منبع: {CRM_SOURCES[record.source]} · ایجاد: {formatJalaliDateTime(record.created_at)} · آخرین تغییر: {formatJalaliDateTime(record.updated_at)}
        </p>
        {record.lead && (
          <p className="lead-form-hint">
            سرنخ مرتبط:{' '}
            <button type="button" className="btn-link" onClick={() => onOpenLead?.(record.lead.id)}>
              {record.lead.company_name || 'باز کردن'}
            </button>
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            بستن
          </button>
          <button type="button" className="btn-primary" onClick={onEdit}>
            ویرایش
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SimpleCrmPage({ initialLeadId, onOpenLead }) {
  const crm = useSimpleCrm()
  const [query, setQuery] = useState('')
  // { mode: 'add', leadId } | { mode: 'edit', id } | { mode: 'view', id }
  const [modal, setModal] = useState(() => (initialLeadId ? { mode: 'add', leadId: initialLeadId } : null))
  const shown = crm.records.filter((r) => matchesCrmSearch(r, query))
  const current = modal?.id ? crm.records.find((r) => r.id === modal.id) : null

  return (
    <div className="today-page">
      <div className="page-toolbar">
        <div>
          <h2>CRM</h2>
          <p className="today-subtitle">فقط شرکت‌ها و افرادی که خودتان اضافه می‌کنید. فهرست سرنخ‌ها جداست و از اینجا تغییر نمی‌کند.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setModal({ mode: 'add' })}>
          + افزودن رکورد CRM
        </button>
      </div>

      <div className="today-filters">
        <input type="search" value={query} placeholder="جستجو: شرکت، مخاطب، تلفن، محصول، یادداشت..." onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={crm.loading} onClick={crm.refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={crm.error} onRetry={crm.refresh} />

      {crm.loading && <p className="profile-empty">در حال بارگذاری...</p>}
      {!crm.loading && (
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>مخاطب</th>
              <th>تلفن</th>
              <th>ایمیل</th>
              <th>شهر</th>
              <th>محصول مورد علاقه</th>
              <th>یادداشت</th>
              <th>منبع</th>
              <th>آخرین تغییر</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="profile-empty">
                  {crm.records.length ? 'موردی با این جستجو نیست.' : 'CRM هنوز خالی است. با «افزودن رکورد CRM» شروع کنید.'}
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <button type="button" className="btn-link" onClick={() => setModal({ mode: 'view', id: r.id })}>
                    {r.company_name}
                  </button>
                </td>
                <td>{r.contact_name || '—'}</td>
                <td dir="ltr">{r.phone || '—'}</td>
                <td dir="ltr">{r.email || '—'}</td>
                <td>{r.city || '—'}</td>
                <td>{r.product_interest || '—'}</td>
                <td>
                  <div style={{ whiteSpace: 'pre-wrap', maxWidth: '18rem', maxHeight: '4.5em', overflow: 'hidden' }}>{r.notes || '—'}</div>
                </td>
                <td>{CRM_SOURCES[r.source]}</td>
                <td>{formatJalaliDateTime(r.updated_at)}</td>
                <td>
                  <button type="button" className="btn-link" onClick={() => setModal({ mode: 'view', id: r.id })}>
                    مشاهده
                  </button>{' '}
                  <button type="button" className="btn-link" onClick={() => setModal({ mode: 'edit', id: r.id })}>
                    ویرایش
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal?.mode === 'add' && (
        <CrmFormModal
          initialLeadId={modal.leadId}
          onCreate={crm.create}
          onOpenRecord={(id) => setModal({ mode: 'view', id })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'edit' && current && (
        <CrmFormModal key={current.id} record={current} onUpdate={crm.update} onClose={() => setModal({ mode: 'view', id: current.id })} />
      )}
      {modal?.mode === 'view' && current && (
        <CrmViewModal record={current} onEdit={() => setModal({ mode: 'edit', id: current.id })} onOpenLead={onOpenLead} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
