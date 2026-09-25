import { useCallback, useEffect, useState } from 'react'
import { useEmailOutreach } from '../../hooks/useEmailOutreach'
import { useChannelOutreach } from '../../hooks/useChannelOutreach'
import { countSentToday, resolveDailyCap } from '../../outreach/autoEmail'
import { supabase } from '../../lib/supabaseClient'
import { formatJalaliDateTime } from '../../utils/formatters'
import { runStatusLabel } from '../../prospecting/prospectingLabels'
import ErrorBanner from '../common/ErrorBanner'
import { MORE_TOOLS } from './adminSections'
import './today/Today.css'

const CANDIDATE_STATUSES = ['promoted', 'duplicate', 'manual_review']

async function countCandidates(status) {
  const { count, error } = await supabase.from('prospect_candidates').select('id', { count: 'exact', head: true }).eq('status', status)
  if (error) throw error
  return count || 0
}

function Stat({ value, label, hint, tone = 'tone-contacted', onClick }) {
  return (
    <button type="button" className={`today-summary-card admin-stat ${tone}`} onClick={onClick}>
      <span className="today-summary-value">{value}</span>
      <span className="today-summary-label">{label}</span>
      {hint && <span className="admin-stat-hint">{hint}</span>}
    </button>
  )
}

// Plain-language status of the one workflow: discover → register → first
// email → record the result. Every number links to the page it comes from.
export default function AdminMissionPage({ onNavigate }) {
  const email = useEmailOutreach()
  const channels = useChannelOutreach()
  const [discovery, setDiscovery] = useState({ run: null, counts: null })
  const [discoveryError, setDiscoveryError] = useState('')

  const loadDiscovery = useCallback(async () => {
    try {
      const [{ data, error }, ...counts] = await Promise.all([
        supabase
          .from('prospect_discovery_runs')
          .select('status, started_at, candidates_found, candidates_created, candidates_promoted, duplicates_detected, errors_count')
          .order('started_at', { ascending: false })
          .limit(1),
        ...CANDIDATE_STATUSES.map(countCandidates),
      ])
      if (error) throw error
      setDiscovery({ run: data?.[0] || null, counts: Object.fromEntries(CANDIDATE_STATUSES.map((s, i) => [s, counts[i]])) })
      setDiscoveryError('')
    } catch {
      setDiscoveryError('وضعیت کشف مشتری بارگذاری نشد.')
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(loadDiscovery)
  }, [loadDiscovery])

  function refresh() {
    email.refresh()
    channels.refresh()
    loadDiscovery()
  }

  const dash = (loading, value) => (loading ? '—' : value)
  const lastEmailRun = email.runs?.[0]
  const run = discovery.run
  const autoOn = email.settings?.auto_email_enabled === true
  const dailyCap = resolveDailyCap(email.settings)
  const sentToday = countSentToday(email.recipients || [])
  const c = email.counts
  const waitingWhatsapp = channels.counts.whatsapp?.not_configured || 0
  const waitingBale = channels.counts.bale?.not_configured || 0

  return (
    <div className="today-page admin-overview">
      <div className="page-toolbar">
        <div>
          <h2>نمای کلی</h2>
          <p className="today-subtitle">وضعیت امروز، به زبان ساده. روی هر عدد بزنید تا فهرست همان مورد باز شود.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={email.error || channels.error || discoveryError} onRetry={refresh} />

      <section className="lead-detail-card admin-overview-card">
        <h3>سیستم خودش چه کار می‌کند؟</h3>
        <ol className="admin-flow-list">
          <li>
            <strong>پیدا کردن شرکت‌ها:</strong> طبق برنامه در منابع جست‌وجو می‌کند و شرکت‌های مناسب را پیدا می‌کند.
          </li>
          <li>
            <strong>ثبت سرنخ:</strong> شرکت‌هایی که بررسی را پاس کنند به‌عنوان سرنخ ثبت می‌شوند؛ موارد تکراری دوباره ثبت نمی‌شوند. فهرست دستی هم می‌توانید آپلود کنید.
          </li>
          <li>
            <strong>ایمیل معرفی:</strong> اگر نشانی ایمیل وجود داشته باشد، برای هر نشانی فقط یک ایمیل معرفی می‌فرستد؛ حداکثر {dailyCap} ایمیل در روز.
          </li>
          <li>
            <strong>ثبت نتیجه:</strong> وضعیت تحویل و برگشت ایمیل‌ها را از سرویس ایمیل می‌گیرد و نشانی‌های برگشتی یا لغو دریافت را دیگر ایمیل نمی‌کند.
          </li>
        </ol>
        <p className="lead-form-hint">
          سیستم <strong>مذاکره نمی‌کند و خودکار پاسخ نمی‌دهد.</strong> پاسخ مشتری و پیگیری بعدی را خودتان در «نتیجهٔ ارتباط» یا صفحهٔ سرنخ ثبت می‌کنید. واتساپ و بله هنوز راه‌اندازی نشده‌اند و از طریق آن‌ها پیامی ارسال نمی‌شود.
        </p>
      </section>

      <div className="admin-overview-status">
        <section className="lead-detail-card admin-overview-card">
          <h3>آخرین کشف مشتری</h3>
          {run ? (
            <>
              <p className="admin-status-line">
                {formatJalaliDateTime(run.started_at)} · {runStatusLabel(run.status)}
              </p>
              <p className="lead-form-hint">
                {run.candidates_found} شرکت پیدا شد · {run.candidates_promoted} سرنخ ثبت شد · {run.duplicates_detected} تکراری
              </p>
            </>
          ) : (
            <p className="lead-form-hint">هنوز اجرایی ثبت نشده است.</p>
          )}
          <button type="button" className="btn-link" onClick={() => onNavigate('prospecting')}>
            رفتن به کشف مشتری
          </button>
        </section>

        <section className="lead-detail-card admin-overview-card">
          <h3>ایمیل خودکار</h3>
          <p className="admin-status-line">
            <span className={`lead-status-badge ${autoOn ? 'tone-won' : 'tone-lost'}`}>{email.loading ? '...' : autoOn ? 'روشن' : 'خاموش'}</span>{' '}
            امروز {dash(email.loading, sentToday)} از {dailyCap} ایمیل مجاز روزانه ارسال شده
          </p>
          <p className="lead-form-hint">
            آخرین اجرا:{' '}
            {lastEmailRun
              ? `${formatJalaliDateTime(lastEmailRun.started_at)} · ${lastEmailRun.status === 'skipped' ? 'بدون ارسال' : `${lastEmailRun.sent} ارسال`}`
              : 'هنوز اجرایی ثبت نشده است.'}
          </p>
          <button type="button" className="btn-link" onClick={() => onNavigate('outreach')}>
            رفتن به ایمیل‌ها
          </button>
        </section>
      </div>

      <h3 className="admin-overview-heading">کشف و ثبت</h3>
      <div className="today-summary-grid">
        <Stat value={dash(email.loading, email.entries.length)} label="سرنخ ثبت‌شده" hint="شرکت‌هایی که در فهرست سرنخ‌ها هستند" onClick={() => onNavigate('leads')} />
        <Stat value={dash(channels.loading, channels.counts.withContact)} label="سرنخ دارای اطلاعات تماس" hint="ایمیل، موبایل یا شمارهٔ پیام‌رسان" onClick={() => onNavigate('channels', { tab: 'contact' })} />
        <Stat value={discovery.counts ? discovery.counts.manual_review : '—'} tone="tone-offer" label="نیازمند بررسی شما" hint="شرکت‌های پیداشده‌ای که سیستم دربارهٔ آن‌ها مطمئن نیست" onClick={() => onNavigate('prospecting', { tab: 'manual_review' })} />
        <Stat value={discovery.counts ? discovery.counts.duplicate : '—'} label="تکراری (ثبت نشد)" hint="قبلاً در فهرست بوده‌اند" onClick={() => onNavigate('prospecting', { tab: 'duplicate' })} />
      </div>

      <h3 className="admin-overview-heading">ایمیل معرفی</h3>
      <div className="today-summary-grid">
        <Stat value={dash(email.loading, c.queued + c.ready)} tone="tone-offer" label="در انتظار ایمیل" hint="در اجراهای بعدی ارسال می‌شود" onClick={() => onNavigate('outreach', { tab: 'queue' })} />
        <Stat
          value={dash(email.loading, c.sent)}
          tone="tone-won"
          label="ایمیل ارسال‌شده"
          hint={c.bounced ? `شامل ${c.bounced} مورد که بعداً برگشت خورد` : 'ارسال‌شده یعنی سرویس ایمیل پذیرفت، نه لزوماً خوانده‌شده'}
          onClick={() => onNavigate('outreach', { tab: 'sent' })}
        />
        <Stat value={dash(email.loading, c.failed + c.bounced)} tone="tone-lost" label="ناموفق یا برگشتی" hint="نیاز به اصلاح نشانی یا تماس از راه دیگر" onClick={() => onNavigate('outreach', { tab: 'attention' })} />
        <Stat value={dash(email.loading, c.no_email)} label="بدون ایمیل" hint="ایمیلی ارسال نمی‌شود" onClick={() => onNavigate('outreach', { tab: 'skipped' })} />
      </div>

      <h3 className="admin-overview-heading">واتساپ و بله</h3>
      <div className="today-summary-grid">
        <Stat value={dash(channels.loading, waitingWhatsapp)} tone="tone-offer" label="واتساپ: منتظر راه‌اندازی" hint="پیامی ارسال نشده" onClick={() => onNavigate('channels', { tab: 'waiting' })} />
        <Stat value={dash(channels.loading, waitingBale)} tone="tone-offer" label="بله: منتظر راه‌اندازی" hint="پیامی ارسال نشده" onClick={() => onNavigate('channels', { tab: 'waiting' })} />
      </div>

      <p className="admin-note">
        <strong>این عددها را با هم جمع نکنید.</strong> «شرکت پیداشده» شمارش نتایج جست‌وجو است، «سرنخ ثبت‌شده» شمارش شرکت‌های داخل فهرست است و عددهای هر کانال
        (ایمیل، واتساپ، بله) جداگانه برای هر کانال شمرده می‌شوند. یک شرکت می‌تواند هم‌زمان در چند کانال شمرده شود.
      </p>

      <details className="admin-more-tools">
        <summary>ابزارهای بیشتر</summary>
        <p className="lead-form-hint">صفحه‌های قدیمی و ابزارهای فنی. برای کار روزانهٔ این دمو لازم نیستند و اطلاعات آن‌ها حذف نشده است.</p>
        <div className="admin-more-tools-links">
          {MORE_TOOLS.map((tool) => (
            <button key={tool.key} type="button" className="today-chip" onClick={() => onNavigate(tool.key)}>
              {tool.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
