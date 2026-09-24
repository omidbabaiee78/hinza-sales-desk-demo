import { useCallback, useEffect, useState } from 'react'
import { useEmailOutreach } from '../../hooks/useEmailOutreach'
import { useChannelOutreach } from '../../hooks/useChannelOutreach'
import { supabase } from '../../lib/supabaseClient'
import { formatJalaliDateTime } from '../../utils/formatters'
import ErrorBanner from '../common/ErrorBanner'
import './today/Today.css'

export default function AdminMissionPage({ onNavigate }) {
  const email = useEmailOutreach()
  const channels = useChannelOutreach()
  const [latestDiscovery, setLatestDiscovery] = useState(null)
  const [discoveryError, setDiscoveryError] = useState('')

  const loadDiscovery = useCallback(async () => {
    const { data, error } = await supabase
      .from('prospect_discovery_runs')
      .select('status, started_at, candidates_found, candidates_promoted, errors_count')
      .order('started_at', { ascending: false })
      .limit(1)
    if (error) {
      setDiscoveryError('وضعیت آخرین اجرای کشف مشتری بارگذاری نشد.')
      return
    }
    setDiscoveryError('')
    setLatestDiscovery(data?.[0] || null)
  }, [])

  useEffect(() => {
    Promise.resolve().then(loadDiscovery)
  }, [loadDiscovery])

  function refresh() {
    email.refresh()
    channels.refresh()
    loadDiscovery()
  }

  const lastEmailRun = email.runs?.[0]

  return (
    <div className="today-page">
      <div className="page-toolbar">
        <div>
          <h2>کشف مشتری و ارتباط اولیه</h2>
          <p className="today-subtitle">سیستم شرکت‌ها را پیدا می‌کند، برای نشانی‌های دارای ایمیل یک معرفی اولیه می‌فرستد و نتیجه را ثبت می‌کند.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={refresh}>به‌روزرسانی</button>
      </div>

      <ErrorBanner message={email.error || channels.error || discoveryError} onRetry={refresh} />

      <div className="today-summary-grid">
        <button type="button" className="today-summary-card tone-contacted" onClick={() => onNavigate('leads')}>
          <span className="today-summary-value">{email.loading ? '—' : email.entries.length}</span>
          <span className="today-summary-label">سرنخ ثبت‌شده</span>
        </button>
        <button type="button" className="today-summary-card tone-contacted" onClick={() => onNavigate('channels')}>
          <span className="today-summary-value">{channels.loading ? '—' : channels.counts.withContact}</span>
          <span className="today-summary-label">دارای اطلاعات تماس</span>
        </button>
        <button type="button" className="today-summary-card tone-won" onClick={() => onNavigate('outreach')}>
          <span className="today-summary-value">{email.loading ? '—' : email.counts.sent - email.counts.bounced}</span>
          <span className="today-summary-label">ایمیل ارسال‌شده</span>
        </button>
        <button type="button" className="today-summary-card tone-lost" onClick={() => onNavigate('outreach')}>
          <span className="today-summary-value">{email.loading ? '—' : email.counts.failed + email.counts.bounced}</span>
          <span className="today-summary-label">ایمیل ناموفق یا برگشتی</span>
        </button>
        <button type="button" className="today-summary-card tone-offer" onClick={() => onNavigate('outreach')}>
          <span className="today-summary-value">{email.loading ? '—' : email.counts.queued + email.counts.ready}</span>
          <span className="today-summary-label">در انتظار ایمیل</span>
        </button>
        <button type="button" className="today-summary-card tone-offer" onClick={() => onNavigate('channels')}>
          <span className="today-summary-value">{channels.loading ? '—' : channels.counts.waitingProvider}</span>
          <span className="today-summary-label">واتساپ/بله منتظر پیکربندی سرویس</span>
        </button>
      </div>

      <section className="lead-detail-card" style={{ marginTop: 16 }}>
        <h3>وضعیت خودکار</h3>
        <p className="lead-form-hint">ارسال ایمیل: {email.loading ? 'در حال بررسی...' : email.settings?.auto_email_enabled ? 'روشن' : 'خاموش'}{email.settings?.auto_email_daily_cap ? ` · سقف ${email.settings.auto_email_daily_cap} ایمیل در روز` : ''}</p>
        <p className="lead-form-hint">آخرین کشف مشتری: {latestDiscovery ? `${formatJalaliDateTime(latestDiscovery.started_at)} · ${latestDiscovery.status === 'completed' ? 'انجام شد' : latestDiscovery.status} · ${latestDiscovery.candidates_promoted} سرنخ اضافه شد` : 'هنوز اجرای ثبت‌شده‌ای نمایش داده نشده است.'}</p>
        <p className="lead-form-hint">آخرین اجرای ایمیل: {lastEmailRun ? `${formatJalaliDateTime(lastEmailRun.started_at)} · ${lastEmailRun.sent} ارسال` : 'هنوز اجرای ثبت‌شده‌ای نمایش داده نشده است.'}</p>
      </section>

      <div className="admin-mission-actions">
        <button type="button" className="btn-secondary" onClick={() => onNavigate('prospecting')}>۱. کشف مشتری</button>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('leads')}>۲. سرنخ‌ها</button>
        <button type="button" className="btn-primary" onClick={() => onNavigate('outreach')}>۳. ایمیل و نتیجهٔ ارسال</button>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('channels')}>۴. وضعیت کانال‌ها</button>
        <button type="button" className="btn-secondary" onClick={() => onNavigate('replies')}>۵. ثبت پاسخ</button>
      </div>

      <p className="lead-form-hint" style={{ marginTop: 20 }}>واتساپ و بله: اطلاعات تماس ثبت می‌شود، اما تا وقتی سرویس ارسال این کانال‌ها پیکربندی و روشن نشده، هیچ پیامی ارسال نمی‌شود. مذاکره و پاسخ‌دادن از طرف سیستم انجام نمی‌شود.</p>
    </div>
  )
}
