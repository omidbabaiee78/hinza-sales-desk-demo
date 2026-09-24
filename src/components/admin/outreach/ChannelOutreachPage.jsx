import { useMemo, useState } from 'react'
import { useChannelOutreach } from '../../../hooks/useChannelOutreach'
import { useEmailOutreach } from '../../../hooks/useEmailOutreach'
import { READINESS_REASON_LABELS, emailStatusLabel } from '../../../outreach/channelOutreach'
import ChannelStatusCell, { StatusBadge } from './ChannelStatusCell'
import { CONTACT_SOURCE_LABELS, leadOrigin } from '../../../outreach/contactPoints'
import { formatJalaliDateTime } from '../../../utils/formatters'
import ErrorBanner from '../../common/ErrorBanner'
import '../today/Today.css'

// Per registered lead: email / WhatsApp / Bale status side by side. Email
// is the existing automatic pipeline; WhatsApp/Bale come from the
// outreach-channels runner. Read-only - there is no per-lead Send button.

const FILTERS = [
  { key: 'all', label: 'همه' },
  { key: 'contact', label: 'دارای اطلاعات تماس' },
  { key: 'waiting', label: 'منتظر پیکربندی سرویس' },
  { key: 'sent', label: 'ارسال‌شده' },
  { key: 'problem', label: 'ناموفق / برگشتی / لغو' },
  { key: 'none', label: 'بدون اطلاعات تماس' },
]

function matchesFilter(row, filter) {
  const states = [row.channel.channels.whatsapp.state, row.channel.channels.bale.state, row.email.key]
  if (filter === 'contact') return row.channel.hasContact
  if (filter === 'waiting') return states.includes('not_configured')
  if (filter === 'sent') return states.some((s) => s === 'sent' || s === 'delivered')
  if (filter === 'problem') return states.some((s) => ['failed', 'bounced', 'uncertain', 'opted_out'].includes(s))
  if (filter === 'none') return !row.channel.hasContact
  return true
}

export default function ChannelOutreachPage({ onOpenLead }) {
  const c = useChannelOutreach()
  const email = useEmailOutreach()
  const [filter, setFilter] = useState('all')

  const rows = useMemo(() => {
    const emailByLead = new Map(email.entries.map((e) => [e.lead.id, e]))
    return c.entries.map((entry) => ({ channel: entry, email: emailStatusLabel(emailByLead.get(entry.lead.id)) }))
  }, [c.entries, email.entries])
  const shown = rows.filter((r) => matchesFilter(r, filter))
  const lastRun = c.runs?.[0]
  const readiness = lastRun?.report?.readiness || null

  function refresh() {
    c.refresh()
    email.refresh()
  }

  return (
    <div className="today-page">
      <div className="page-toolbar">
        <div>
          <h2>وضعیت کانال‌ها</h2>
          <p className="today-subtitle">
            برای هر سرنخ ثبت‌شده (دستی، فهرست آپلودشده پس از ثبت، یا کشف خودکار): ایمیل، واتساپ و بله. پیام معرفی خودکار است؛ برای هر مقصد در هر کانال فقط یک‌بار.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary" disabled={c.loading || c.running} onClick={refresh}>
            به‌روزرسانی
          </button>
          <button type="button" className="btn-secondary" disabled={c.loading || c.running || c.notInstalled} onClick={c.runNow} title="اطلاعات تماس را ثبت می‌کند؛ ارسال فقط وقتی سرویس کانال پیکربندی شده باشد.">
            {c.running ? 'در حال اجرا...' : 'اجرای اکنون (واتساپ/بله)'}
          </button>
        </div>
      </div>

      <ErrorBanner message={c.error || email.error} onRetry={refresh} />
      {c.notInstalled && <ErrorBanner message="جدول‌های صف واتساپ/بله هنوز در پایگاه داده ساخته نشده‌اند (phase34_channel_outreach.sql). وضعیت‌ها فقط بر اساس اطلاعات تماس نمایش داده می‌شوند." />}
      {c.runReport && !c.runReport.ok && <ErrorBanner message="اجرا انجام نشد یا نتیجه آن معلوم نیست." />}

      <div className="today-summary-grid">
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{c.counts.leads}</span>
          <span className="today-summary-label">سرنخ ثبت‌شده</span>
        </div>
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{c.counts.withContact}</span>
          <span className="today-summary-label">دارای اطلاعات تماس</span>
        </div>
        <div className="today-summary-card tone-won">
          <span className="today-summary-value">{(c.counts.whatsapp?.sent || 0) + (c.counts.whatsapp?.delivered || 0)}</span>
          <span className="today-summary-label">واتساپ ارسال‌شده</span>
        </div>
        <div className="today-summary-card tone-won">
          <span className="today-summary-value">{(c.counts.bale?.sent || 0) + (c.counts.bale?.delivered || 0)}</span>
          <span className="today-summary-label">بله ارسال‌شده</span>
        </div>
        <div className="today-summary-card tone-offer">
          <span className="today-summary-value">{c.counts.waitingProvider || 0}</span>
          <span className="today-summary-label">واتساپ/بله منتظر پیکربندی سرویس</span>
        </div>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{(c.counts.whatsapp?.failed || 0) + (c.counts.bale?.failed || 0) + (c.counts.whatsapp?.uncertain || 0) + (c.counts.bale?.uncertain || 0)}</span>
          <span className="today-summary-label">واتساپ/بله ناموفق یا نامشخص</span>
        </div>
      </div>

      <section className="lead-detail-card" style={{ marginTop: 12 }}>
        <h3>سرویس‌های ارسال</h3>
        <p className="lead-form-hint">
          واتساپ: {c.settings?.whatsapp_provider_enabled ? 'روشن در تنظیمات' : 'خاموش'}
          {readiness?.whatsapp?.length ? ` — آماده نیست: ${readiness.whatsapp.map((r) => READINESS_REASON_LABELS[r] || r).join('، ')}` : readiness ? ' — آماده ارسال' : ''}
        </p>
        <p className="lead-form-hint">
          بله: {c.settings?.bale_provider_enabled ? 'روشن در تنظیمات' : 'خاموش'}
          {readiness?.bale?.length ? ` — آماده نیست: ${readiness.bale.map((r) => READINESS_REASON_LABELS[r] || r).join('، ')}` : readiness ? ' — آماده ارسال' : ''}
        </p>
        <p className="lead-form-hint">
          تا وقتی سرویس یک کانال پیکربندی و روشن نشده، هیچ پیامی در آن کانال ارسال نمی‌شود و وضعیت «کانال پیکربندی نشده» است. لینک یا پیش‌نویس آماده‌شده به‌معنای ارسال نیست.
        </p>
        <p className="lead-form-hint">آخرین اجرای واتساپ/بله: {lastRun ? `${formatJalaliDateTime(lastRun.started_at)} · ثبت ${lastRun.registered} · ارسال ${lastRun.sent} · ناموفق ${lastRun.failed}` : 'هنوز اجرایی ثبت نشده است.'}</p>
      </section>

      <div className="today-filters">
        <div className="today-filter-group">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`today-chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label} ({rows.filter((r) => matchesFilter(r, f.key)).length})
            </button>
          ))}
        </div>
      </div>

      {c.loading && <p className="profile-empty">در حال بارگذاری...</p>}
      {!c.loading && (
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>منشأ سرنخ</th>
              <th>ایمیل</th>
              <th>واتساپ</th>
              <th>بله</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="profile-empty">
                  موردی نیست.
                </td>
              </tr>
            )}
            {shown.map(({ channel, email: emailStatus }) => {
              const origin = leadOrigin(channel.lead)
              return (
                <tr key={channel.lead.id}>
                  <td>
                    <button type="button" className="btn-link" onClick={() => onOpenLead?.(channel.lead.id)}>
                      {channel.lead.company_name || channel.lead.contact_name || '—'}
                    </button>
                  </td>
                  <td>
                    {CONTACT_SOURCE_LABELS[origin.source]}
                    {origin.detail && <div className="lead-form-hint">{origin.detail}</div>}
                  </td>
                  <td>
                    <StatusBadge stateKey={emailStatus.key} text={emailStatus.text} />
                    {channel.contacts.email && (
                      <div className="lead-form-hint" dir="ltr">
                        {channel.contacts.email.destination}
                      </div>
                    )}
                  </td>
                  <td>
                    <ChannelStatusCell channel={channel.channels.whatsapp} />
                  </td>
                  <td>
                    <ChannelStatusCell channel={channel.channels.bale} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
