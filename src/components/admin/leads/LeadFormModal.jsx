import { useState } from 'react'
import { createLead, updateLead } from '../../../services/salesLeads'
import { findLeadDuplicates } from '../../../utils/leadDuplicates'
import {
  LEAD_PREFERRED_CHANNELS,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  leadPreferredChannelLabel,
  leadPriorityLabel,
  leadSourceLabel,
} from '../../../utils/leadStatus'
import { followUpDateOnly, followUpIsoFromDate } from '../../../utils/leadFollowUp'
import JalaliDateInput from '../../common/JalaliDateInput'
import ErrorBanner from '../../common/ErrorBanner'
import LeadProductPicker from './LeadProductPicker'
import LeadDuplicateWarning from './LeadDuplicateWarning'
import LeadTagsEditor from './LeadTagsEditor'
import '../../common/Modal.css'
import './Leads.css'

function initialFieldsFrom(lead) {
  return {
    company_name: lead?.company_name || '',
    contact_name: lead?.contact_name || '',
    mobile: lead?.mobile || '',
    phone: lead?.phone || '',
    email: lead?.email || '',
    website: lead?.website || '',
    province: lead?.province || '',
    city: lead?.city || '',
    address: lead?.address || '',
    industry: lead?.industry || '',
    source: lead?.source || '',
    priority: lead?.priority || 'medium',
    need_note: lead?.need_note || '',
    notes: lead?.notes || '',
    assigned_to: lead?.assigned_to || '',
    preferred_channel: lead?.preferred_channel || '',
    do_not_contact: lead?.do_not_contact || false,
  }
}

// Shared create/edit form. A converted lead is rendered read-only by the
// caller instead of mounting this component at all - editing must never
// silently rewrite converted history.
export default function LeadFormModal({ lead, leads, companies, admins, onSaved, onCancel }) {
  const isEdit = Boolean(lead)
  // A converted lead is mostly historical - editing is still possible for a
  // rare correction, but the form opens read-only and needs an explicit
  // toggle rather than defaulting to editable.
  const isConverted = lead?.status === 'converted'
  const [readOnly, setReadOnly] = useState(isConverted)
  const [fields, setFields] = useState(() => initialFieldsFrom(lead))
  const [productIds, setProductIds] = useState(() => (lead?.products || []).map((p) => p.id))
  const [followUpDate, setFollowUpDate] = useState(() => followUpDateOnly(lead?.next_follow_up_at))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [duplicateMatches, setDuplicateMatches] = useState(null)
  const [confirmedDuplicates, setConfirmedDuplicates] = useState(false)
  const [tags, setTags] = useState(() => lead?.tags || [])

  function setField(name, value) {
    setFields((prev) => ({ ...prev, [name]: value }))
    setConfirmedDuplicates(false)
    setDuplicateMatches(null)
  }

  function validate() {
    if (!fields.company_name.trim() && !fields.contact_name.trim()) {
      return 'وارد کردن نام شرکت یا نام شخص تماس الزامی است.'
    }
    return ''
  }

  function buildPayload() {
    return {
      company_name: fields.company_name.trim() || null,
      contact_name: fields.contact_name.trim() || null,
      mobile: fields.mobile.trim() || null,
      phone: fields.phone.trim() || null,
      email: fields.email.trim() || null,
      website: fields.website.trim() || null,
      province: fields.province.trim() || null,
      city: fields.city.trim() || null,
      address: fields.address.trim() || null,
      industry: fields.industry.trim() || null,
      source: fields.source || null,
      priority: fields.priority,
      need_note: fields.need_note.trim() || null,
      notes: fields.notes.trim() || null,
      assigned_to: fields.assigned_to || null,
      preferred_channel: fields.preferred_channel || null,
      do_not_contact: fields.do_not_contact,
      tags,
      next_follow_up_at: followUpIsoFromDate(followUpDate),
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')

    if (!isEdit && !confirmedDuplicates) {
      const matches = findLeadDuplicates({
        mobile: fields.mobile,
        phone: fields.phone,
        companyName: fields.company_name,
        leads,
        companies,
      })
      if (matches.length > 0) {
        setDuplicateMatches(matches)
        setConfirmedDuplicates(true)
        return
      }
    }

    setSubmitting(true)
    try {
      const payload = buildPayload()
      if (isEdit) {
        await updateLead(lead.id, { fields: payload, productIds })
        onSaved(lead.id)
      } else {
        const newId = await createLead({ fields: payload, productIds })
        onSaved(newId)
      }
    } catch (err) {
      setError(err.message || 'ذخیره سرنخ با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h2>{isEdit ? 'ویرایش سرنخ' : 'افزودن سرنخ'}</h2>
        {isConverted && (
          <p className="lead-form-hint">
            این سرنخ به مشتری تبدیل شده و بیشتر جنبه تاریخی دارد.{' '}
            {readOnly && (
              <button type="button" className="btn-link" onClick={() => setReadOnly(false)}>
                ویرایش موقت
              </button>
            )}
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <fieldset disabled={readOnly} className="lead-form-fieldset">
          <div className="lead-form-grid">
            <label>
              نام شرکت
              <input type="text" value={fields.company_name} onChange={(e) => setField('company_name', e.target.value)} />
            </label>
            <label>
              نام شخص تماس
              <input type="text" value={fields.contact_name} onChange={(e) => setField('contact_name', e.target.value)} />
            </label>
            <label>
              موبایل
              <input type="text" dir="ltr" value={fields.mobile} onChange={(e) => setField('mobile', e.target.value)} />
            </label>
            <label>
              تلفن
              <input type="text" dir="ltr" value={fields.phone} onChange={(e) => setField('phone', e.target.value)} />
            </label>
            <label>
              ایمیل
              <input type="email" dir="ltr" value={fields.email} onChange={(e) => setField('email', e.target.value)} />
            </label>
            <label>
              وب‌سایت
              <input
                type="text"
                dir="ltr"
                placeholder="example.com"
                value={fields.website}
                onChange={(e) => setField('website', e.target.value)}
              />
            </label>
            <label>
              استان
              <input type="text" value={fields.province} onChange={(e) => setField('province', e.target.value)} />
            </label>
            <label>
              شهر
              <input type="text" value={fields.city} onChange={(e) => setField('city', e.target.value)} />
            </label>
            <label className="lead-form-span-2">
              آدرس
              <input type="text" value={fields.address} onChange={(e) => setField('address', e.target.value)} />
            </label>
            <label>
              صنعت
              <input
                type="text"
                placeholder="مثال: فیلم، لوله، تزریق"
                value={fields.industry}
                onChange={(e) => setField('industry', e.target.value)}
              />
            </label>
            <label>
              کانال ترجیحی
              <select value={fields.preferred_channel} onChange={(e) => setField('preferred_channel', e.target.value)}>
                <option value="">—</option>
                {LEAD_PREFERRED_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {leadPreferredChannelLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              منبع
              <select value={fields.source} onChange={(e) => setField('source', e.target.value)}>
                <option value="">—</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {leadSourceLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              اولویت
              <select value={fields.priority} onChange={(e) => setField('priority', e.target.value)}>
                {LEAD_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {leadPriorityLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            {admins.length > 0 && (
              <label>
                فروشنده مسئول
                <select value={fields.assigned_to} onChange={(e) => setField('assigned_to', e.target.value)}>
                  <option value="">—</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name || 'بدون نام'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              پیگیری بعدی
              <JalaliDateInput
                value={followUpDate}
                onChange={(iso) => {
                  setFollowUpDate(iso)
                  setConfirmedDuplicates(false)
                  setDuplicateMatches(null)
                }}
              />
            </label>
          </div>

          <label>
            محصولات موردنیاز
            <LeadProductPicker selectedIds={productIds} onChange={setProductIds} />
          </label>

          <label>
            نیاز / توضیح محصول (برای مواردی که در کاتالوگ نیست)
            <textarea
              rows={2}
              value={fields.need_note}
              onChange={(e) => setField('need_note', e.target.value)}
              placeholder="مثال: مستر سفید برای فیلم کشاورزی"
            />
          </label>

          <label>
            یادداشت
            <textarea rows={3} value={fields.notes} onChange={(e) => setField('notes', e.target.value)} />
          </label>

          <label>
            تگ‌ها
            <LeadTagsEditor tags={tags} onChange={setTags} />
          </label>

          <label className="product-form-availability">
            <input
              type="checkbox"
              checked={fields.do_not_contact}
              onChange={(e) => setField('do_not_contact', e.target.checked)}
            />
            عدم تماس (این سرنخ نباید تماس گرفته شود)
          </label>
          </fieldset>

          <ErrorBanner message={error} />
          {duplicateMatches && <LeadDuplicateWarning matches={duplicateMatches} />}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              {readOnly ? 'بستن' : 'انصراف'}
            </button>
            {!readOnly && (
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting
                  ? 'در حال ذخیره...'
                  : duplicateMatches
                    ? 'ذخیره با وجود این'
                    : 'ذخیره'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
