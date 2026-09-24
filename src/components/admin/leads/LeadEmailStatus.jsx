import { useEmailOutreach } from '../../../hooks/useEmailOutreach'
import { EMAIL_STATE_ACTIONS, EMAIL_STATE_REASONS } from '../../../outreach/autoEmail'
import { formatJalaliDateTime } from '../../../utils/formatters'

function safeDecode(url) {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

// Read-only: what the automatic intro email did for this lead (same
// classification as the «ارسال ایمیل» page and the server runner). There is
// no per-lead approve/send button - sending is automatic.
export default function LeadEmailStatus({ leadId }) {
  const { entries, loading, error } = useEmailOutreach()
  const entry = entries.find((e) => e.lead.id === leadId)

  let text = '—'
  if (loading) text = 'در حال بارگذاری...'
  else if (error) text = error
  else if (entry?.state === 'sent') {
    text = `ارسال شد به ${entry.email}${entry.attempt ? ` — ${formatJalaliDateTime(entry.attempt.updated_at || entry.attempt.created_at)} — شناسه: ${entry.attempt.external_message_id || '—'}` : ''}${
      entry.kind === 'bounced' ? ` — ${EMAIL_STATE_REASONS.bounced}` : ''
    }`
  } else if (entry?.state === 'queued') text = `در صف ارسال به ${entry.email}`
  else if (entry?.state === 'ready') text = `در اجرای بعدی به صف ارسال ${entry.email} اضافه می‌شود`
  else if (entry) text = `${EMAIL_STATE_REASONS[entry.kind]}${EMAIL_STATE_ACTIONS[entry.kind] ? ` — ${EMAIL_STATE_ACTIONS[entry.kind]}` : ''}`

  const lead = entry?.lead
  return (
    <section className="lead-detail-card">
      <h3>ایمیل معرفی</h3>
      <p className="lead-form-hint">{text}</p>
      {lead?.email_source_url && (
        <p className="lead-form-hint">
          ایمیل به‌طور خودکار از{' '}
          <a href={lead.email_source_url} target="_blank" rel="noreferrer" dir="ltr">
            {safeDecode(lead.email_source_url)}
          </a>{' '}
          پیدا شد{lead.email_lookup_at ? ` — ${formatJalaliDateTime(lead.email_lookup_at)}` : ''}.
        </p>
      )}
      {!lead?.email && lead?.email_lookup_status && lead.email_lookup_status !== 'found' && (
        <p className="lead-form-hint">
          جست‌وجوی خودکار ایمیل: {lead.email_lookup_reason || lead.email_lookup_status}
          {lead.email_lookup_at ? ` — ${formatJalaliDateTime(lead.email_lookup_at)}` : ''}
        </p>
      )}
    </section>
  )
}
