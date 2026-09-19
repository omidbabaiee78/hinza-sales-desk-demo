import { useState } from 'react'
import {
  bulkAddLeadTag,
  bulkChangeLeadStatus,
  bulkMarkLeadsDoNotContact,
  bulkSetLeadFollowUp,
  bulkSetLeadPreferredChannel,
  bulkSetLeadPriority,
} from '../../../services/salesLeads'
import {
  LEAD_PREFERRED_CHANNELS,
  LEAD_PRIORITIES,
  PIPELINE_STATUSES,
  leadPreferredChannelLabel,
  leadPriorityLabel,
  leadStatusLabel,
} from '../../../utils/leadStatus'
import { followUpIsoFromDate } from '../../../utils/leadFollowUp'
import JalaliDateInput from '../../common/JalaliDateInput'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

const ACTION_LABELS = {
  tag: 'افزودن تگ',
  priority: 'تغییر اولویت',
  status: 'تغییر وضعیت',
  followUp: 'تعیین پیگیری',
  channel: 'تغییر کانال ترجیحی',
  doNotContact: 'عدم تماس',
}

// One shared modal for every bulk action on the leads list - only the
// action-specific control + submit handler differ. No bulk delete, no bulk
// messaging - both explicitly out of scope for phase 15B.
export default function LeadBulkActionsModal({ action, leadIds, onDone, onCancel }) {
  const [priority, setPriority] = useState('medium')
  const [status, setStatus] = useState(PIPELINE_STATUSES[0])
  const [channel, setChannel] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [tag, setTag] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (action === 'priority') {
        await bulkSetLeadPriority(leadIds, priority)
      } else if (action === 'status') {
        await bulkChangeLeadStatus(leadIds, status)
      } else if (action === 'channel') {
        await bulkSetLeadPreferredChannel(leadIds, channel)
      } else if (action === 'followUp') {
        if (!followUpDate) {
          setError('تاریخ پیگیری را انتخاب کنید.')
          setSubmitting(false)
          return
        }
        await bulkSetLeadFollowUp(leadIds, followUpIsoFromDate(followUpDate))
      } else if (action === 'tag') {
        if (!tag.trim()) {
          setError('یک تگ وارد کنید.')
          setSubmitting(false)
          return
        }
        await bulkAddLeadTag(leadIds, tag)
      } else if (action === 'doNotContact') {
        await bulkMarkLeadsDoNotContact(leadIds)
      }
      onDone()
    } catch (err) {
      setError(err.message || 'اجرای عملیات گروهی با خطا مواجه شد.')
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2>{ACTION_LABELS[action]}</h2>
        <p className="lead-form-hint">{leadIds.length} سرنخ انتخاب شده است.</p>
        <form onSubmit={handleSubmit}>
          {action === 'priority' && (
            <label>
              اولویت جدید
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {LEAD_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {leadPriorityLabel(p)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === 'status' && (
            <label>
              وضعیت جدید
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {PIPELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {leadStatusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === 'channel' && (
            <label>
              کانال ترجیحی جدید
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">—</option>
                {LEAD_PREFERRED_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {leadPreferredChannelLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === 'followUp' && (
            <label>
              تاریخ پیگیری
              <JalaliDateInput value={followUpDate} onChange={setFollowUpDate} />
            </label>
          )}
          {action === 'tag' && (
            <label>
              تگ
              <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="مثال: مستربچ سفید" />
            </label>
          )}
          {action === 'doNotContact' && (
            <p className="lead-form-hint">
              این سرنخ‌ها به عنوان «عدم تماس» علامت‌گذاری می‌شوند و از لیست «آماده تماس» خارج می‌شوند. این کار
              تاریخچه آن‌ها را حذف نمی‌کند.
            </p>
          )}

          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'در حال اجرا...' : 'اجرا'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
