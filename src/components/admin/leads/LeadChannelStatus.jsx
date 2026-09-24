import { useChannelOutreach } from '../../../hooks/useChannelOutreach'
import { CONTACT_SOURCE_LABELS, leadOrigin } from '../../../outreach/contactPoints'
import ChannelStatusCell from '../outreach/ChannelStatusCell'

const SOURCE_FIELD_LABELS = { email: 'ایمیل', mobile: 'موبایل', phone: 'تلفن' }

function safeDecode(url) {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

// Read-only: this lead's WhatsApp and Bale introduction status (the email
// card above covers email). Same classification as «وضعیت کانال‌ها».
export default function LeadChannelStatus({ leadId }) {
  const { entries, loading, error, notInstalled } = useChannelOutreach()
  const entry = entries.find((e) => e.lead.id === leadId)
  const origin = entry ? leadOrigin(entry.lead) : null

  return (
    <section className="lead-detail-card">
      <h3>واتساپ، بله و منبع اطلاعات تماس</h3>
      {loading && <p className="lead-form-hint">در حال بارگذاری...</p>}
      {!loading && error && <p className="lead-form-hint">{error}</p>}
      {!loading && entry && (
        <>
          <div className="info-row">
            <span className="info-label">واتساپ</span>
            <span className="info-value">
              <ChannelStatusCell channel={entry.channels.whatsapp} showSource />
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">بله</span>
            <span className="info-value">
              <ChannelStatusCell channel={entry.channels.bale} showSource />
            </span>
          </div>
          <p className="lead-form-hint">
            منشأ سرنخ: {CONTACT_SOURCE_LABELS[origin.source]}
            {origin.detail ? ` (${origin.detail})` : ''}. ارسال خودکار است و فقط وقتی سرویس کانال پیکربندی شده باشد انجام می‌شود.
          </p>
          {Array.isArray(entry.lead.contact_sources) && entry.lead.contact_sources.length > 0 && (
            <div className="lead-form-hint">
              منبع اطلاعات تماس (وب‌سایت خود شرکت):
              <ul style={{ margin: '4px 0', paddingInlineStart: 18 }}>
                {entry.lead.contact_sources.map((s) => (
                  <li key={`${s.field}-${s.value}-${s.sourceUrl}`}>
                    {SOURCE_FIELD_LABELS[s.field] || s.field}: <span dir="ltr">{s.value}</span> —{' '}
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" dir="ltr">
                      {safeDecode(s.sourceUrl)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notInstalled && <p className="lead-form-hint">صف واتساپ/بله هنوز در پایگاه داده نصب نشده است.</p>}
        </>
      )}
    </section>
  )
}
