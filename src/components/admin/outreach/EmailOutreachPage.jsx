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
  { key: 'overview', label: 'خلاصه' },
  { key: 'queue', label: 'در انتظار ارسال' },
  { key: 'sent', label: 'ارسال‌شده' },
  { key: 'attention', label: 'ناموفق / برگشتی' },
  { key: 'skipped', label: 'ارسال نمی‌شود (با دلیل)' },
  { key: 'found', label: 'ایمیل‌های پیداشده در وب‌سایت‌ها' },
]
const TAB_KEYS = new Set(TABS.map((t) => t.key))

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

// Only statuses reported by the email service (Resend) - never inferred.
const DELIVERY_LABELS = {
  delivered: 'تحویل شد',
  opened: 'تحویل شد (باز شده)',
  clicked: 'تحویل شد (کلیک شده)',
  sent: 'ارسال شد، در انتظار تحویل',
  queued: 'در صف سرویس ایمیل',
  scheduled: 'زمان‌بندی‌شده',
  delivery_delayed: 'تأخیر در تحویل',
  bounced: 'برگشت خورد — به این نشانی دیگر ایمیل نمی‌رود',
  bounced_transient: 'برگشت موقت',
  complained: 'گزارش هرزنامه — نشانی مسدود و سرنخ «عدم تماس» شد',
  failed: 'ناموفق',
  canceled: 'لغو شد',
}
const DELIVERY_TONES = {
  delivered: 'tone-won',
  opened: 'tone-won',
  clicked: 'tone-won',
  bounced: 'tone-lost',
  complained: 'tone-lost',
  failed: 'tone-lost',
  canceled: 'tone-lost',
  bounced_transient: 'tone-offer',
  delivery_delayed: 'tone-offer',
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

function DeliveryStatus({ entry }) {
  const status = entry.attempt?.provider_status
  if (!status && entry.kind === 'bounced') return <span className="lead-status-badge tone-lost">برگشت خورد</span>
  return (
    <>
      <span className={`lead-status-badge ${DELIVERY_TONES[status] || 'tone-contacted'}`}>
        {status ? DELIVERY_LABELS[status] || status : 'ارسال شد — هنوز گزارش تحویل نرسیده'}
      </span>
      {entry.attempt?.provider_status_at && <div className="lead-form-hint">{formatJalaliDateTime(entry.attempt.provider_status_at)}</div>}
    </>
  )
}

function RunReport({ report }) {
  if (!report) return null
  if (!report.ok) return <ErrorBanner message="اجرا انجام نشد یا نتیجه آن معلوم نیست. قبل از اجرای دوباره، فهرست «ارسال‌شده» و «ناموفق / برگشتی» را بررسی کنید." />
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
              {d.reason ? ` — ${d.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// «خلاصه»: the three questions an owner asks, then the plain status.
function Summary({ settings, runs, counts, recipients, onOpenTab }) {
  const dailyCap = resolveDailyCap(settings)
  const sentToday = countSentToday(recipients)
  const enabled = settings?.auto_email_enabled === true
  const lastRun = runs?.[0]

  return (
    <div>
      <div className="today-summary-grid">
        <button type="button" className="today-summary-card admin-stat tone-offer" onClick={() => onOpenTab('queue')}>
          <span className="today-summary-value">{counts.queued + counts.ready}</span>
          <span className="today-summary-label">چه کسانی منتظر ایمیل‌اند؟</span>
          <span className="admin-stat-hint">در اجراهای بعدی ارسال می‌شود</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-won" onClick={() => onOpenTab('sent')}>
          <span className="today-summary-value">{counts.sent}</span>
          <span className="today-summary-label">برای چه کسانی ایمیل رفت؟</span>
          <span className="admin-stat-hint">{counts.bounced ? `شامل ${counts.bounced} مورد که بعداً برگشت خورد` : 'فهرست گیرنده‌ها و وضعیت تحویل'}</span>
        </button>
        <button type="button" className="today-summary-card admin-stat tone-lost" onClick={() => onOpenTab('attention')}>
          <span className="today-summary-value">{counts.failed + counts.bounced}</span>
          <span className="today-summary-label">کدام ایمیل‌ها برگشت خورد یا ناموفق بود؟</span>
          <span className="admin-stat-hint">نشانی را اصلاح کنید یا از راه دیگر تماس بگیرید</span>
        </button>
      </div>

      <section className="lead-detail-card" style={{ marginTop: 12 }}>
        <div className="info-row">
          <span className="info-label">ارسال خودکار</span>
          <span className="info-value">
            <span className={`lead-status-badge ${enabled ? 'tone-won' : 'tone-lost'}`}>{enabled ? 'روشن' : 'خاموش'}</span>
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">امروز</span>
          <span className="info-value">
            {sentToday} از {dailyCap} ایمیل مجاز روزانه ارسال شده · {Math.max(0, dailyCap - sentToday)} ظرفیت باقی‌مانده
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">آخرین اجرا</span>
          <span className="info-value">
            {lastRun
              ? `${formatJalaliDateTime(lastRun.started_at)} — ${
                  lastRun.status === 'skipped' ? 'ایمیلی ارسال نشد' : `${lastRun.sent} ارسال، ${lastRun.failed + lastRun.uncertain} ناموفق`
                }`
              : 'هنوز اجرایی ثبت نشده است.'}
          </span>
        </div>
        <p className="admin-note">
          «ارسال‌شده» یعنی سرویس ایمیل پیام را پذیرفته است؛ به معنای تحویل یا خوانده‌شدن نیست. وضعیت تحویل و برگشت فقط از گزارش سرویس ایمیل (Resend) نمایش
          داده می‌شود. سیستم به پاسخ‌ها جواب نمی‌دهد.
        </p>
      </section>
    </div>
  )
}

// Controls and technical details - behind «ابزارهای بیشتر».
function EmailTools({ settings, schedule, runs, lastProviderEvent, saving, running, loading, onToggle, onSaveLimit, onRunNow }) {
  const savedLimit = resolveAutoEmailLimit(settings)
  const dailyCap = resolveDailyCap(settings)
  const [draftLimit, setDraftLimit] = useState(null)
  const shownLimit = draftLimit ?? savedLimit
  const enabled = settings?.auto_email_enabled === true
  const lastRun = runs?.[0]
  const nextRun = schedule?.active ? nextCronRun(schedule.schedule) : null
  const nextRunInWindow = nextRun ? evaluateContactWindow(settings, nextRun).withinWindow : false

  return (
    <section className="lead-detail-card">
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
          <span className="lead-form-hint">(مقدار ذخیره‌شده: {savedLimit})</span>
        </span>
      </div>
      <div className="info-row">
        <span className="info-label">سقف روزانه</span>
        <span className="info-value">{dailyCap} ایمیل در هر روز (به وقت تهران، مجموع همه اجراها)</span>
      </div>
      <div className="info-row">
        <span className="info-label">جزئیات آخرین اجرا</span>
        <span className="info-value">
          {lastRun
            ? `${formatJalaliDateTime(lastRun.started_at)} (${lastRun.trigger === 'cron' ? 'زمان‌بندی' : 'اجرای دستی'}) — ${
                lastRun.status === 'skipped' ? `انجام نشد: ${lastRun.report?.reason || ''}` : `ارسال: ${lastRun.sent}، صف: ${lastRun.queued}، ناموفق: ${lastRun.failed + lastRun.uncertain}`
              }`
            : 'هنوز اجرایی ثبت نشده است.'}
        </span>
      </div>
      <div className="info-row">
        <span className="info-label">آخرین گزارش سرویس ایمیل</span>
        <span className="info-value">
          {lastProviderEvent ? `${lastProviderEvent.event_type} — ${formatJalaliDateTime(lastProviderEvent.received_at)}` : 'هنوز گزارشی از سرویس ایمیل دریافت نشده است.'}
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
                : 'فعال'}
        </span>
      </div>
      {settings?.provider_test_mode && <p className="outreach-test-mode-banner">حالت آزمایشی سرویس ایمیل روشن است؛ ارسال خودکار انجام نمی‌شود.</p>}
      {(!settings?.outreach_enabled || !settings?.email_provider_enabled) && <p className="outreach-test-mode-banner">ارسال واقعی یا سرویس ایمیل در تنظیمات سیستم خاموش است.</p>}
      <div className="admin-tools-actions">
        <button type="button" className="btn-secondary" disabled={running || loading} onClick={onRunNow}>
          {running ? 'در حال اجرا...' : 'اجرای اکنون (ایمیل واقعی می‌فرستد)'}
        </button>
      </div>
    </section>
  )
}

export default function EmailOutreachPage({ onOpenLead, initialTab }) {
  const o = useEmailOutreach()
  const [tab, setTab] = useState(TAB_KEYS.has(initialTab) ? initialTab : 'overview')

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

  function runNow() {
    if (!window.confirm('«اجرای اکنون» برای سرنخ‌های در انتظار، ایمیل معرفی واقعی می‌فرستد (با رعایت سقف روزانه). ادامه می‌دهید؟')) return
    o.runNow()
  }

  return (
    <div className="outreach-page">
      <div className="page-toolbar">
        <div>
          <h2>ایمیل‌ها</h2>
          <p className="today-subtitle">یک ایمیل معرفی برای هر سرنخی که نشانی ایمیل دارد؛ به هر نشانی فقط یک‌بار. وضعیت واتساپ و بله در «وضعیت کانال‌ها» است.</p>
        </div>
        <button type="button" className="btn-secondary" disabled={o.loading || o.running} onClick={o.refresh}>
          به‌روزرسانی
        </button>
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
        <>
          <Summary settings={o.settings} runs={o.runs} counts={o.counts} recipients={o.recipients} onOpenTab={setTab} />
          <details className="admin-more-tools">
            <summary>ابزارهای بیشتر (تنظیمات و اجرای دستی)</summary>
            <EmailTools
              settings={o.settings}
              schedule={o.schedule}
              runs={o.runs}
              lastProviderEvent={o.lastProviderEvent}
              saving={o.saving}
              running={o.running}
              loading={o.loading}
              onToggle={toggle}
              onSaveLimit={o.setLimit}
              onRunNow={runNow}
            />
          </details>
        </>
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
                  کسی منتظر ایمیل نیست.
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
                <td>
                  <span className="lead-status-badge tone-offer">{e.state === 'queued' ? 'در صف ارسال' : 'در اجرای بعدی به صف اضافه می‌شود'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!o.loading && tab === 'sent' && (
        <>
          <p className="admin-note">«ارسال‌شده» یعنی سرویس ایمیل پیام را پذیرفته؛ به معنای تحویل یا خوانده‌شدن نیست. ستون آخر فقط گزارش خود سرویس ایمیل را نشان می‌دهد.</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>شرکت</th>
                <th>گیرنده</th>
                <th>زمان ارسال</th>
                <th>گزارش سرویس ایمیل</th>
              </tr>
            </thead>
            <tbody>
              {sent.length === 0 && (
                <tr>
                  <td colSpan={4} className="profile-empty">
                    هنوز ایمیلی ارسال نشده است.
                  </td>
                </tr>
              )}
              {sent.map((e) => (
                <tr key={e.lead.id}>
                  <td>
                    <LeadLink lead={e.lead} onOpenLead={onOpenLead} />
                    {(e.attempt?.subject_snapshot || e.suggestion?.subject_draft) && (
                      <div className="lead-form-hint">موضوع: {e.attempt?.subject_snapshot || e.suggestion?.subject_draft}</div>
                    )}
                  </td>
                  <td dir="ltr">{e.email}</td>
                  <td>{e.attempt ? formatJalaliDateTime(e.attempt.updated_at || e.attempt.created_at) : '—'}</td>
                  <td>
                    <DeliveryStatus entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!o.loading && tab === 'found' && (
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>ایمیل پیداشده</th>
              <th>صفحهٔ وب‌سایت شرکت</th>
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
        <table className="data-table">
          <thead>
            <tr>
              <th>شرکت</th>
              <th>ایمیل</th>
              <th>چه شد</th>
              <th>اقدام پیشنهادی</th>
            </tr>
          </thead>
          <tbody>
            {attention.length === 0 && (
              <tr>
                <td colSpan={4} className="profile-empty">
                  ایمیل برگشتی یا ناموفقی نیست.
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
                  <span className={`lead-status-badge ${e.kind === 'uncertain' ? 'tone-offer' : 'tone-lost'}`}>{EMAIL_STATE_REASONS[e.kind]}</span>
                  {e.attempt?.failure_reason && <div className="lead-form-hint">{e.attempt.failure_reason}</div>}
                </td>
                <td>
                  {EMAIL_STATE_ACTIONS[e.kind]}
                  {e.kind === 'uncertain' && e.attempt?.external_message_id && (
                    <div className="lead-form-hint" dir="ltr">
                      {e.attempt.external_message_id}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
