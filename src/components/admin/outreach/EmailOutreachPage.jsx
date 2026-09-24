import { useState } from 'react'
import { useEmailOutreach } from '../../../hooks/useEmailOutreach'
import {
  AUTO_EMAIL_MAX_LIMIT,
  EMAIL_STATE_ACTIONS,
  EMAIL_STATE_REASONS,
  SKIP_KINDS,
  countSentToday,
  nextCronRun,
  resolveAutoEmailLimit,
  resolveDailyCap,
} from '../../../outreach/autoEmail'
import { EMAIL_LOOKUP_REASONS } from '../../../outreach/emailDiscovery'
import { evaluateContactWindow } from '../../../outreach/contactWindow'
import { formatJalaliDateTime } from '../../../utils/formatters'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/DataTable.css'
import '../today/Today.css'
import './Outreach.css'

const TABS = [
  { key: 'overview', label: 'نمای کلی' },
  { key: 'found', label: 'ایمیل‌های پیداشده' },
  { key: 'queue', label: 'صف ارسال' },
  { key: 'sent', label: 'ارسال‌شده' },
  { key: 'attention', label: 'ناموفق / برگشتی' },
  { key: 'skipped', label: 'ردشده' },
]

const STATE_LABELS = { sent: 'ارسال شد', queued: 'در صف ارسال', ready: 'در اجرای بعدی به صف اضافه می‌شود' }

function safeDecode(url) {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

// One line for any lead: what happened / why it is not emailed.
function stateText(e) {
  if (e.kind === 'bounced') return EMAIL_STATE_REASONS.bounced
  if (STATE_LABELS[e.state]) return STATE_LABELS[e.state]
  return EMAIL_STATE_REASONS[e.kind] || e.kind || '—'
}

// Why a lead without an email still has none: the last automatic lookup.
function lookupText(lead) {
  if (!lead.email_lookup_status) return 'جست‌وجوی خودکار هنوز انجام نشده؛ در اجراهای بعدی بررسی می‌شود.'
  return `${lead.email_lookup_reason || EMAIL_LOOKUP_REASONS[lead.email_lookup_status] || lead.email_lookup_status}${
    lead.email_lookup_at ? ` (${formatJalaliDateTime(lead.email_lookup_at)})` : ''
  }`
}

const SOURCE_LABELS = { discovered: 'کشف خودکار', manual: 'دستی' }
const DELIVERY_LABELS = {
  delivered: 'تحویل شد',
  opened: 'تحویل شد (باز شده)',
  clicked: 'تحویل شد (کلیک شده)',
  sent: 'ارسال شد، در انتظار تحویل',
  queued: 'در صف سرویس ایمیل',
  scheduled: 'زمان‌بندی‌شده',
  delivery_delayed: 'تأخیر در تحویل',
  bounced: 'برگشت خورد (bounce دائمی) — نشانی مسدود شد',
  bounced_transient: 'برگشت موقت (bounce موقت)',
  complained: 'گزارش هرزنامه — نشانی مسدود شد و سرنخ «عدم تماس» شد',
  failed: 'ناموفق',
  canceled: 'لغو شد',
}
const LIMIT_OPTIONS = Array.from({ length: AUTO_EMAIL_MAX_LIMIT }, (_, i) => i + 1)

function company(lead) {
  return lead?.company_name || lead?.contact_name || '—'
}

function LeadLink({ lead, onOpenLead }) {
  return onOpenLead ? (
    <button type="button" className="btn-link" onClick={() => onOpenLead(lead.id)}>
      {company(lead)}
    </button>
  ) : (
    company(lead)
  )
}

function RunReport({ report }) {
  if (!report) return null
  if (!report.ok) return <ErrorBanner message="اجرا انجام نشد یا نتیجه آن معلوم نیست. قبل از اجرای دوباره، فهرست «ارسال‌شده» و «نیازمند توجه» را بررسی کنید." />
  if (report.status === 'skipped') return <p className="outreach-test-mode-banner">اجرا انجام نشد: {report.reason}</p>
  return (
    <div className="prospect-evidence-box">
      <p className="lead-form-hint">
        نتیجه اجرا — سرنخ‌های بررسی‌شده: {report.leadsScanned} | به صف اضافه شد: {report.queued} | ارسال‌شده: {report.sent} | ردشده به‌دلیل تکراری بودن نشانی:{' '}
        {report.duplicatesSkipped} | ناموفق: {report.failed} | نامشخص: {report.uncertain} | مسدود توسط کنترل ارسال: {report.blocked}
      </p>
      {report.dailyCap != null && (
        <p className="lead-form-hint">
          سقف روزانه: {report.sentToday ?? '—'} / {report.dailyCap} ارسال امروز — ظرفیت باقی‌مانده امروز: {report.remainingToday ?? '—'}
          {report.capReached ? ' — سقف روزانه پر شد' : ''}
        </p>
      )}
      {report.emailLookup && (
        <p className="lead-form-hint">
          جست‌وجوی ایمیل در وب‌سایت شرکت‌ها — بررسی‌شده: {report.emailLookup.checked} | ایمیل پیدا شد: {report.emailLookup.found}
          {report.emailLookup.results
            ?.filter((r) => r.status === 'found')
            .map((r) => ` | ${r.company}: ${r.email}`)
            .join('')}
        </p>
      )}
      {report.notSending && <p className="lead-form-hint">ارسال در این اجرا: {report.notSending}</p>}
      {report.details?.length > 0 && (
        <ul className="outreach-reason-list">
          {report.details.map((d, i) => (
            <li key={i}>
              {d.company}: {{ queued: 'به صف اضافه شد', sent: 'ارسال شد', failed: 'ناموفق', uncertain: 'نامشخص', blocked: 'مسدود', duplicate: 'تکراری' }[d.outcome] || d.outcome}
              {d.recipient ? ` — ${d.recipient}` : ''}
              {d.providerMessageId ? ` — شناسه: ${d.providerMessageId}` : ''}
              {d.reason ? ` — ${d.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Overview({ settings, schedule, runs, counts, recipients, lastProviderEvent, saving, onToggle, onSaveLimit }) {
  const savedLimit = resolveAutoEmailLimit(settings)
  const dailyCap = resolveDailyCap(settings)
  const sentToday = countSentToday(recipients)
  const remainingToday = Math.max(0, dailyCap - sentToday)
  const [draftLimit, setDraftLimit] = useState(null)
  const shownLimit = draftLimit ?? savedLimit
  const enabled = settings?.auto_email_enabled === true
  const lastRun = runs?.[0]
  const nextRun = schedule?.active ? nextCronRun(schedule.schedule) : null
  const nextRunInWindow = nextRun ? evaluateContactWindow(settings, nextRun).withinWindow : false

  return (
    <div>
      <div className="today-summary-grid">
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">
            {sentToday} / {dailyCap}
          </span>
          <span className="today-summary-label">ارسال‌شده امروز</span>
        </div>
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{remainingToday}</span>
          <span className="today-summary-label">ظرفیت باقی‌مانده امروز</span>
        </div>
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{counts.sent}</span>
          <span className="today-summary-label">ارسال‌شده (کل)</span>
        </div>
        <div className="today-summary-card tone-offer">
          <span className="today-summary-value">{counts.queued + counts.ready}</span>
          <span className="today-summary-label">در صف</span>
        </div>
        <div className="today-summary-card tone-contacted">
          <span className="today-summary-value">{counts.found}</span>
          <span className="today-summary-label">ایمیل پیداشده خودکار</span>
        </div>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{counts.failed}</span>
          <span className="today-summary-label">ناموفق / نامشخص</span>
        </div>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{counts.bounced}</span>
          <span className="today-summary-label">برگشتی (bounce)</span>
        </div>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{counts.not_emailed}</span>
          <span className="today-summary-label">ردشده (با دلیل)</span>
        </div>
        <div className="today-summary-card tone-lost">
          <span className="today-summary-value">{counts.no_email}</span>
          <span className="today-summary-label">بدون ایمیل</span>
        </div>
      </div>

      <section className="lead-detail-card" style={{ marginTop: 12 }}>
        <div className="info-row">
          <span className="info-label">ارسال خودکار</span>
          <span className="info-value">
            <span className={`lead-status-badge ${enabled ? 'tone-won' : 'tone-lost'}`}>{enabled ? 'روشن' : 'خاموش'}</span>{' '}
            <button type="button" className="btn-link" disabled={saving} onClick={onToggle}>
              {enabled ? 'خاموش کردن' : 'روشن کردن'}
            </button>
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">حداکثر ارسال در هر اجرا</span>
          <span className="info-value">
            <select value={shownLimit} disabled={saving} onChange={(e) => setDraftLimit(Number(e.target.value))}>
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>{' '}
            {draftLimit !== null && draftLimit !== savedLimit && (
              <button
                type="button"
                className="btn-link"
                disabled={saving}
                onClick={async () => {
                  await onSaveLimit(draftLimit)
                  setDraftLimit(null)
                }}
              >
                ذخیره
              </button>
            )}{' '}
            <span className="lead-form-hint">(مقدار ذخیره‌شده در دیتابیس: {savedLimit})</span>
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">سقف روزانه</span>
          <span className="info-value">{dailyCap} ایمیل در هر روز (به وقت تهران، مجموع همه اجراها)</span>
        </div>
        <div className="info-row">
          <span className="info-label">آخرین اجرا</span>
          <span className="info-value">
            {lastRun
              ? `${formatJalaliDateTime(lastRun.started_at)} (${lastRun.trigger === 'cron' ? 'زمان‌بندی' : 'اجرای دستی'}) — ${
                  lastRun.status === 'skipped' ? `انجام نشد: ${lastRun.report?.reason || ''}` : `ارسال: ${lastRun.sent}، صف: ${lastRun.queued}، ناموفق: ${lastRun.failed + lastRun.uncertain}`
                }`
              : 'هنوز اجرایی ثبت نشده است.'}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">وضعیت تحویل (وب‌هوک Resend)</span>
          <span className="info-value">
            {lastProviderEvent
              ? `آخرین رویداد: ${lastProviderEvent.event_type} — ${formatJalaliDateTime(lastProviderEvent.received_at)}`
              : 'هنوز رویدادی از Resend دریافت نشده است؛ وضعیت تحویل فقط از رویدادهای Resend نمایش داده می‌شود.'}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">اجرای زمان‌بندی‌شده بعدی</span>
          <span className="info-value">
            {!schedule
              ? 'زمان‌بندی یافت نشد.'
              : !schedule.active
                ? 'زمان‌بندی غیرفعال است.'
                : nextRun
                  ? `${formatJalaliDateTime(nextRun.toISOString())}${nextRunInWindow ? '' : ' (خارج از بازه تماس - فقط صف‌بندی)'}`
                  : schedule.schedule}
          </span>
        </div>
        {settings?.provider_test_mode && <p className="outreach-test-mode-banner">حالت آزمایشی سرویس ایمیل روشن است؛ ارسال خودکار انجام نمی‌شود.</p>}
        {(!settings?.outreach_enabled || !settings?.email_provider_enabled) && <p className="outreach-test-mode-banner">ارسال واقعی یا سرویس ایمیل در تنظیمات سیستم خاموش است.</p>}
      </section>
    </div>
  )
}

export default function EmailOutreachPage({ onOpenLead }) {
  const o = useEmailOutreach()
  const [tab, setTab] = useState('overview')

  const queue = o.entries.filter((e) => e.state === 'queued' || e.state === 'ready')
  const sent = o.entries.filter((e) => e.state === 'sent')
  // Failed / uncertain / bounced sends - an address that was attempted.
  const attention = o.entries.filter((e) => ['failed', 'uncertain', 'bounced'].includes(e.kind))
  // Never emailed, each with its reason (no email -> the lookup's result).
  const skipped = o.entries.filter((e) => SKIP_KINDS.has(e.kind))
  const found = o.entries
    .filter((e) => e.lead.email_source_url)
    .sort((a, b) => String(b.lead.email_lookup_at || '').localeCompare(String(a.lead.email_lookup_at || '')))
  const tabCount = { found: found.length, queue: queue.length, sent: sent.length, attention: attention.length, skipped: skipped.length }

  function toggle() {
    const turningOn = o.settings?.auto_email_enabled !== true
    if (turningOn && !window.confirm('با روشن کردن، سیستم برای هر سرنخ دارای ایمیل (کشف‌شده یا دستی) یک ایمیل معرفی واقعی می‌فرستد - برای هر نشانی فقط یک‌بار. ادامه می‌دهید؟')) return
    o.setEnabled(turningOn)
  }

  return (
    <div className="outreach-page">
      <div className="page-toolbar">
        <div>
          <h2>ارسال ایمیل</h2>
          <p className="today-subtitle">یک ایمیل معرفی خودکار برای هر سرنخ دارای ایمیل، برای هر نشانی فقط یک‌بار. وضعیت واتساپ و بله در «وضعیت کانال‌ها» است.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary" disabled={o.loading || o.running} onClick={o.refresh}>
            به‌روزرسانی
          </button>
          <button type="button" className="btn-primary" disabled={o.running || o.loading} onClick={o.runNow}>
            {o.running ? 'در حال اجرا...' : 'اجرای اکنون'}
          </button>
        </div>
      </div>

      <ErrorBanner message={o.error} onRetry={o.refresh} />
      {o.saveMessage && <p className="lead-form-hint">{o.saveMessage}</p>}
      <RunReport report={o.runReport} />

      <div className="today-filters">
        <div className="today-filter-group">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`today-chip${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
              {tabCount[t.key] !== undefined ? ` (${tabCount[t.key]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {o.loading && <p className="profile-empty">در حال بارگذاری...</p>}

      {!o.loading && o.settings && tab === 'overview' && (
        <Overview settings={o.settings} schedule={o.schedule} runs={o.runs} counts={o.counts} recipients={o.recipients} lastProviderEvent={o.lastProviderEvent} saving={o.saving} onToggle={toggle} onSaveLimit={o.setLimit} />
      )}

      {!o.loading && tab === 'queue' && (
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>ایمیل گیرنده</th>
              <th>منبع</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 && (
              <tr>
                <td colSpan={4} className="profile-empty">
                  ایمیلی در صف نیست.
                </td>
              </tr>
            )}
            {queue.map((e) => (
              <tr key={e.lead.id}>
                <td>
                  <LeadLink lead={e.lead} onOpenLead={onOpenLead} />
                </td>
                <td dir="ltr">{e.email}</td>
                <td>{SOURCE_LABELS[e.source]}</td>
                <td>{e.state === 'queued' ? 'در صف ارسال' : 'در اجرای بعدی به صف اضافه می‌شود'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!o.loading && tab === 'sent' && (
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>گیرنده</th>
              <th>موضوع</th>
              <th>زمان ارسال</th>
              <th>شناسه پیام</th>
              <th>وضعیت تحویل</th>
            </tr>
          </thead>
          <tbody>
            {sent.length === 0 && (
              <tr>
                <td colSpan={6} className="profile-empty">
                  هنوز ایمیلی ارسال نشده است.
                </td>
              </tr>
            )}
            {sent.map((e) => (
              <tr key={e.lead.id}>
                <td>
                  <LeadLink lead={e.lead} onOpenLead={onOpenLead} />
                </td>
                <td dir="ltr">{e.email}</td>
                <td>{e.attempt?.subject_snapshot || e.suggestion?.subject_draft || '—'}</td>
                <td>{e.attempt ? formatJalaliDateTime(e.attempt.updated_at || e.attempt.created_at) : '—'}</td>
                <td dir="ltr" style={{ fontSize: 12 }}>
                  {e.attempt?.external_message_id || '—'}
                </td>
                <td>
                  {e.attempt?.provider_status
                    ? DELIVERY_LABELS[e.attempt.provider_status] || e.attempt.provider_status
                    : 'پذیرفته‌شده توسط Resend — وضعیت تحویل هنوز از Resend دریافت نشده'}
                  {e.attempt?.provider_status_at && <div className="lead-form-hint">{formatJalaliDateTime(e.attempt.provider_status_at)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!o.loading && tab === 'found' && (
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>ایمیل پیداشده</th>
              <th>منبع (صفحه وب‌سایت شرکت)</th>
              <th>زمان</th>
              <th>وضعیت ایمیل معرفی</th>
            </tr>
          </thead>
          <tbody>
            {found.length === 0 && (
              <tr>
                <td colSpan={5} className="profile-empty">
                  هنوز ایمیلی به‌طور خودکار پیدا نشده است.
                </td>
              </tr>
            )}
            {found.map((e) => (
              <tr key={e.lead.id}>
                <td>
                  <LeadLink lead={e.lead} onOpenLead={onOpenLead} />
                </td>
                <td dir="ltr">{e.lead.email}</td>
                <td dir="ltr" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  <a href={e.lead.email_source_url} target="_blank" rel="noreferrer">
                    {safeDecode(e.lead.email_source_url)}
                  </a>
                </td>
                <td>{e.lead.email_lookup_at ? formatJalaliDateTime(e.lead.email_lookup_at) : '—'}</td>
                <td>{stateText(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!o.loading && tab === 'skipped' && (
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>ایمیل</th>
              <th>دلیل ارسال‌نشدن</th>
            </tr>
          </thead>
          <tbody>
            {skipped.length === 0 && (
              <tr>
                <td colSpan={3} className="profile-empty">
                  موردی نیست.
                </td>
              </tr>
            )}
            {skipped.map((e) => (
              <tr key={e.lead.id}>
                <td>
                  <LeadLink lead={e.lead} onOpenLead={onOpenLead} />
                </td>
                <td dir="ltr">{e.email || e.lead.email || '—'}</td>
                <td>
                  {EMAIL_STATE_REASONS[e.kind]}
                  {e.kind === 'no_email' && <div className="lead-form-hint">جست‌وجوی خودکار: {lookupText(e.lead)}</div>}
                  {EMAIL_STATE_ACTIONS[e.kind] && <div className="lead-form-hint">{EMAIL_STATE_ACTIONS[e.kind]}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!o.loading && tab === 'attention' && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>شرکت</th>
                <th>ایمیل</th>
                <th>مشکل</th>
                <th>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {attention.length === 0 && (
                <tr>
                  <td colSpan={4} className="profile-empty">
                    موردی نیست.
                  </td>
                </tr>
              )}
              {attention.map((e) => (
                <tr key={e.lead.id}>
                  <td>
                    <LeadLink lead={e.lead} onOpenLead={onOpenLead} />
                  </td>
                  <td dir="ltr">{e.email || e.lead.email || '—'}</td>
                  <td>
                    {EMAIL_STATE_REASONS[e.kind]}
                    {e.attempt?.external_message_id && <div className="lead-form-hint" dir="ltr">{e.attempt.external_message_id}</div>}
                    {e.attempt?.failure_reason && <div className="lead-form-hint">{e.attempt.failure_reason}</div>}
                  </td>
                  <td>{EMAIL_STATE_ACTIONS[e.kind]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
