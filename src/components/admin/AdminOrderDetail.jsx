import { useState } from 'react'
import { useOrder } from '../../hooks/useOrder'
import { useOrderEvents } from '../../hooks/useOrderEvents'
import { useOrderActions } from '../../hooks/useOrderActions'
import { formatJalaliDate } from '../../utils/formatters'
import { getAllowedTransitions } from '../../utils/orderStatus'
import StatusBadge from '../orders/StatusBadge'
import OrderItemsTable from '../orders/OrderItemsTable'
import OrderTimeline from '../orders/OrderTimeline'
import ErrorBanner from '../common/ErrorBanner'
import LoadingScreen from '../common/LoadingScreen'
import '../orders/OrderDetail.css'

const PRIMARY_ACTION_BY_STATUS = {
  customer_approved: { label: 'تأیید سفارش', next: 'admin_approved' },
  admin_approved: { label: 'ثبت تحویل', next: 'delivered' },
  preparing: { label: 'ثبت تحویل', next: 'delivered' },
  ready_for_delivery: { label: 'ثبت تحویل', next: 'delivered' },
}

const HELPER_TEXT_BY_STATUS = {
  pending_review: 'قیمت را در بخش قیمت‌گذاری زیر وارد و اعلام کنید.',
  quoted: 'منتظر تأیید مشتری',
  delivered: 'سفارش تحویل داده شده است.',
  rejected: 'این سفارش رد شده است.',
  cancelled: 'این سفارش لغو شده است.',
}

export default function AdminOrderDetail({ orderId, onBack }) {
  const { order, company, creator, loading, error, refresh } = useOrder(orderId)
  const { events, refresh: refreshEvents } = useOrderEvents(orderId)
  const { busy, transitionStatus, saveAdminNote, saveItemPricing } =
    useOrderActions(orderId)

  const [actionError, setActionError] = useState('')
  const [statusSuccess, setStatusSuccess] = useState('')
  const [pricingError, setPricingError] = useState('')
  const [announcing, setAnnouncing] = useState(false)
  const [adminNote, setAdminNote] = useState(null)
  const [noteError, setNoteError] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  if (loading) return <LoadingScreen text="در حال بارگذاری سفارش..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!order) return null

  const items = order.order_items || []
  const noteValue = adminNote ?? order.admin_note ?? ''
  const allowed = getAllowedTransitions(order.status, 'admin')
  const canReject = allowed.includes('rejected')
  const primaryAction = PRIMARY_ACTION_BY_STATUS[order.status] || null

  async function handleTransition(newStatus) {
    setActionError('')
    setStatusSuccess('')
    try {
      await transitionStatus(newStatus)
      refresh()
      refreshEvents()
      setStatusSuccess('وضعیت سفارش با موفقیت به‌روزرسانی شد.')
    } catch (err) {
      setActionError(err.message || 'تغییر وضعیت با خطا مواجه شد.')
    }
  }

  async function handleReject() {
    if (!window.confirm('سفارش رد شود؟ این عملیات قابل بازگشت نیست.')) return
    await handleTransition('rejected')
  }

  // Single action: save the entered prices and announce the quote to the
  // customer in one step, then refetch so totals come from the database.
  async function handleAnnouncePrice(pricedItems) {
    setPricingError('')
    setStatusSuccess('')
    setAnnouncing(true)
    try {
      await saveItemPricing(pricedItems)
      await transitionStatus('quoted')
      refresh()
      refreshEvents()
      setStatusSuccess('قیمت با موفقیت اعلام شد.')
    } catch (err) {
      setPricingError(err.message || 'اعلام قیمت با خطا مواجه شد.')
    } finally {
      setAnnouncing(false)
    }
  }

  async function handleSaveNote() {
    setNoteError('')
    setNoteSaving(true)
    try {
      await saveAdminNote(noteValue)
      refresh()
    } catch (err) {
      setNoteError(err.message || 'ذخیره یادداشت با خطا مواجه شد.')
    } finally {
      setNoteSaving(false)
    }
  }

  const itemsKey = items
    .map((item) => `${item.id}-${item.unit_price_rial}-${item.discount_percent}`)
    .join(',')

  return (
    <div className="order-detail">
      <div className="page-toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <h2>
          سفارش {order.order_number ?? order.id} <StatusBadge status={order.status} />
        </h2>
      </div>

      <ErrorBanner message={actionError} />
      {statusSuccess && <div className="success-banner">{statusSuccess}</div>}

      <div className="order-detail-grid">
        <section className="order-detail-card">
          <h3>اطلاعات سفارش</h3>
          <div className="info-row">
            <span className="info-label">شرکت</span>
            <span className="info-value">{company?.name || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">مشتری</span>
            <span className="info-value">{creator?.full_name || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">موبایل</span>
            <span className="info-value" dir="ltr">
              {creator?.phone || '—'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">تاریخ ثبت</span>
            <span className="info-value">{formatJalaliDate(order.created_at)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">تاریخ درخواستی تحویل</span>
            <span className="info-value">{formatJalaliDate(order.requested_date)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">یادداشت مشتری</span>
            <span className="info-value">{order.customer_note || '—'}</span>
          </div>
        </section>

        <section className="order-detail-card">
          <h3>اقدامات</h3>

          {HELPER_TEXT_BY_STATUS[order.status] && (
            <p className="profile-empty">{HELPER_TEXT_BY_STATUS[order.status]}</p>
          )}

          {primaryAction && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleTransition(primaryAction.next)}
              disabled={busy}
            >
              {busy ? 'در حال ثبت...' : primaryAction.label}
            </button>
          )}

          {canReject && (
            <button
              type="button"
              className="btn-link btn-link-danger reject-action"
              onClick={handleReject}
              disabled={busy}
            >
              رد سفارش
            </button>
          )}

          <label className="admin-note-field">
            یادداشت داخلی هینزا
            <textarea
              rows={3}
              value={noteValue}
              onChange={(e) => setAdminNote(e.target.value)}
            />
          </label>
          <ErrorBanner message={noteError} />
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSaveNote}
            disabled={noteSaving}
            style={{ marginTop: 8 }}
          >
            {noteSaving ? 'در حال ذخیره...' : 'ذخیره یادداشت'}
          </button>
        </section>
      </div>

      <h3>قیمت‌گذاری اقلام</h3>
      <ErrorBanner message={pricingError} />
      <OrderItemsTable
        key={itemsKey}
        items={items}
        editable={order.status === 'pending_review'}
        totalRial={order.total_rial}
        onAnnouncePrice={handleAnnouncePrice}
        saving={announcing}
      />

      <button
        type="button"
        className="btn-link details-toggle"
        onClick={() => setShowHistory((v) => !v)}
      >
        {showHistory ? 'بستن جزئیات' : 'جزئیات'}
      </button>
      {showHistory && (
        <>
          <h3>تاریخچه سفارش</h3>
          <OrderTimeline events={events} fallbackCreatedAt={order.created_at} />
        </>
      )}
    </div>
  )
}
