import { useChannelOutreach } from '../../../hooks/useChannelOutreach'
import { CONTACT_SOURCE_LABELS, leadOrigin } from '../../../outreach/contactPoints'
import ChannelStatusCell from '../outreach/ChannelStatusCell'

// Read-only: this lead's WhatsApp and Bale introduction status (the email
// card above covers email). Same classification as «وضعیت کانال‌ها».
export default function LeadChannelStatus({ leadId }) {
  const { entries, loading, error, notInstalled } = useChannelOutreach()
  const entry = entries.find((e) => e.lead.id === leadId)
  const origin = entry ? leadOrigin(entry.lead) : null

  return (
    <section className="lead-detail-card">
      <h3>واتساپ و بله</h3>
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
          {notInstalled && <p className="lead-form-hint">صف واتساپ/بله هنوز در پایگاه داده نصب نشده است.</p>}
        </>
      )}
    </section>
  )
}
