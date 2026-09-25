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
  { key: 'waiting', label: 'منتظر راه‌اندازی سرویس' },
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

export default function ChannelOutreachPage({ onOpenLead, initialFilter }) {
  const c = useChannelOutreach()
  const email = useEmailOutreach()
  const [filter, setFilter] = useState(FILTERS.some((f) => f.key === initialFilter) ? initialFilter : 'all')

  const rows = useMemo(() => {
    const emailByLead = new Map(email.entries.map((e) => [e.lead.id, e]))
    return c.entries.map((entry) => ({ channel: entry, email: emailStatusLabel(emailByLead.get(entry.lead.id)) }))
  }, [c.entries, email.entries])
  const shown = rows.filter((r) => matchesFilter(r, filter))
  const lastRun = c.runs?.[0]
  const readiness = lastRun?.report?.readiness || null
  const sentOn = (channel) => (c.counts[channel]?.sent || 0) + (c.counts[channel]?.delivered || 0)
  const waitingOn = (channel) => c.counts[channel]?.not_configured || 0
  const providerLine = (channel, label, enabled) =>
    enabled
      ? `${label}: سرویس روشن است · ${sentOn(channel)} پیام ارسال شده`
      : `${label}: سرویس هنوز راه‌اندازی نشده · ${sentOn(channel)} پیام ارسال شده`

  function refresh() {
    c.refresh()
    email.refresh()
  }

  return (
    <div className="today-page">
      <div className="page-toolbar">
        <div>
          <h2>وضعیت کانال‌ها</h2>
          <p className="today-subtitle">برای هر سرنخ ثبت‌شده، وضعیت ایمیل، واتساپ و بله کنار هم. فقط نمایش است؛ از این صفحه پیامی ارسال نمی‌شود.</p>
        </div>
        <button type="button" className="btn-secondary" disabled={c.loading || c.running} onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <section className="lead-detail-card admin-channel-plain">
        <p className="admin-status-line">
          {c.loading ? 'در حال بارگذاری...' : providerLine('whatsapp', 'واتساپ', c.settings?.whatsapp_provider_enabled)}
        </p>
        <p className="admin-status-line">{c.loading ? '' : providerLine('bale', 'بله', c.settings?.bale_provider_enabled)}</p>
        <p className="lead-form-hint">
          تا وقتی سرویس یک کانال راه‌اندازی و روشن نشده، هیچ پیامی از آن کانال ارسال نمی‌شود. شماره‌ها فقط ثبت می‌شوند تا بعداً قابل استفاده باشند. ایمیل جداگانه و
          خودکار ارسال می‌شود (صفحهٔ «ایمیل‌ها»).
        </p>
      </section>

      <ErrorBanner message={c.error || email.error} onRetry={refresh} />
      {c.notInstalled && <ErrorBanner message="بخش واتساپ/بله هنوز در سیستم فعال نشده است؛ وضعیت‌ها فقط بر اساس اطلاعات تماس نمایش داده می‌شوند." />}
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
          <span className="today-summary-value">{sentOn('whatsapp')}</span>
          <span className="today-summary-label">واتساپ ارسال‌شده</span>
        </div>
        <div className="today-summary-card tone-won">
          <span className="today-summary-value">{sentOn('bale')}</span>
          <span className="today-summary-label">بله ارسال‌شده</span>
        </div>
        <button type="button" className="today-summary-card admin-stat tone-offer" onClick={() => setFilter('waiting')}>
          <span className="today-summary-value">{waitingOn('whatsapp')}</span>
          <span className="today-summary-label">واتساپ: منتظر راه‌اندازی سرویس</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-offer" onClick={() => setFilter('waiting')}>
          <span className="today-summary-value">{waitingOn('bale')}</span>
          <span className="today-summary-label">بله: منتظر راه‌اندازی سرویس</span>
        </button>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{(c.counts.whatsapp?.failed || 0) + (c.counts.bale?.failed || 0) + (c.counts.whatsapp?.uncertain || 0) + (c.counts.bale?.uncertain || 0)}</span>
          <span className="today-summary-label">واتساپ/بله ناموفق یا نامشخص</span>
        </div>
      </div>

      <p className="admin-note">
        عددهای «منتظر راه‌اندازی» برای هر کانال جداگانه شمرده می‌شوند: شرکتی که هم واتساپ و هم بله دارد در هر دو شمرده می‌شود. به همین دلیل جمع این عددها می‌تواند
        از تعداد سرنخ‌ها بیشتر باشد. عددهای این صفحه را با عددهای «کشف مشتری» جمع نکنید.
      </p>

      <details className="admin-more-tools">
        <summary>ابزارهای بیشتر (جزئیات سرویس و اجرای دستی)</summary>
        <section className="lead-detail-card">
          <p className="lead-form-hint">
            واتساپ: {c.settings?.whatsapp_provider_enabled ? 'روشن در تنظیمات' : 'خاموش'}
            {readiness?.whatsapp?.length ? ` — آماده نیست: ${readiness.whatsapp.map((r) => READINESS_REASON_LABELS[r] || r).join('، ')}` : readiness ? ' — آماده ارسال' : ''}
          </p>
          <p className="lead-form-hint">
            بله: {c.settings?.bale_provider_enabled ? 'روشن در تنظیمات' : 'خاموش'}
            {readiness?.bale?.length ? ` — آماده نیست: ${readiness.bale.map((r) => READINESS_REASON_LABELS[r] || r).join('، ')}` : readiness ? ' — آماده ارسال' : ''}
          </p>
          <p className="lead-form-hint">
            آخرین اجرای واتساپ/بله: {lastRun ? `${formatJalaliDateTime(lastRun.started_at)} · ثبت ${lastRun.registered} · ارسال ${lastRun.sent} · ناموفق ${lastRun.failed}` : 'هنوز اجرایی ثبت نشده است.'}
          </p>
          <div className="admin-tools-actions">
            <button type="button" className="btn-secondary" disabled={c.loading || c.running || c.notInstalled} onClick={c.runNow}>
              {c.running ? 'در حال اجرا...' : 'اجرای اکنون (واتساپ/بله) — فقط ثبت اطلاعات تماس تا وقتی سرویس‌ها خاموش‌اند'}
            </button>
          </div>
        </section>
      </details>

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
