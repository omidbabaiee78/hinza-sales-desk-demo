import { useState } from 'react'
import { useOrder } from '../../hooks/useOrder'
import { useOrderEvents } from '../../hooks/useOrderEvents'
import { useOrderActions } from '../../hooks/useOrderActions'
import { formatJalaliDate, formatKg, formatRial, formatRialPerKg } from '../../utils/formatters'
import { getAllowedTransitions } from '../../utils/orderStatus'
import StatusBadge from '../orders/StatusBadge'
import OrderTimeline from '../orders/OrderTimeline'
import ErrorBanner from '../common/ErrorBanner'
import LoadingScreen from '../common/LoadingScreen'
import '../orders/OrderDetail.css'
import './CustomerOrderDetail.css'

export default function CustomerOrderDetail({ orderId, onBack }) {
  const { order, loading, error, refresh } = useOrder(orderId)
  const { events, refresh: refreshEvents } = useOrderEvents(orderId)
  const { busy, transitionStatus } = useOrderActions(orderId)
  const [actionError, setActionError] = useState('')
  const [statusSuccess, setStatusSuccess] = useState('')
  const [showDetails, setShowDetails] = useState(false)

  if (loading) return <LoadingScreen text="در حال بارگذاری سفارش..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!order) return null

  const items = order.order_items || []
  const allowed = getAllowedTransitions(order.status, 'customer')
  const hasPrice = order.status !== 'pending_review'

  async function handleApproveQuote() {
    setActionError('')
    setStatusSuccess('')
    try {
      await transitionStatus('customer_approved')
      refresh()
      refreshEvents()
      setStatusSuccess('قیمت با موفقیت تأیید شد.')
    } catch (err) {
      setActionError(err.message || 'تأیید قیمت با خطا مواجه شد.')
    }
  }

  async function handleCancel() {
    const confirmed = window.confirm('سفارش لغو شود؟ این عملیات قابل بازگشت نیست.')
    if (!confirmed) return
    setActionError('')
    setStatusSuccess('')
    try {
      await transitionStatus('cancelled')
      refresh()
      refreshEvents()
      setStatusSuccess('سفارش با موفقیت لغو شد.')
    } catch (err) {
      setActionError(err.message || 'لغو سفارش با خطا مواجه شد.')
    }
  }

  return (
    <div className="order-detail">
      <div className="page-toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <h2>سفارش {order.order_number ?? order.id}</h2>
      </div>

      <ErrorBanner message={actionError} />
      {statusSuccess && <div className="success-banner">{statusSuccess}</div>}

      <div className="simple-order-card">
        {items.length === 0 ? (
          <p className="order-items-warning">اقلام این سفارش ثبت نشده‌اند.</p>
        ) : (
          items.map((item) => {
            const finalUnitPrice =
              hasPrice && item.unit_price_rial != null
                ? Math.round(item.unit_price_rial * (1 - (item.discount_percent || 0) / 100))
                : null
            return (
              <div className="simple-item-row" key={item.id}>
                <div className="simple-item-name">
                  {item.products?.name_fa || 'محصول نامشخص'}
                  {item.products?.code ? ` ${item.products.code}` : ''}
                </div>
                <div className="simple-item-qty">{formatKg(item.quantity_kg)}</div>
                {hasPrice && item.unit_price_rial != null && (
                  <div className="simple-item-price">
                    قیمت هر کیلو: {formatRialPerKg(item.unit_price_rial)}
                  </div>
                )}
                {hasPrice && item.discount_percent > 0 && (
                  <div className="simple-item-discount">
                    تخفیف شما: ٪{item.discount_percent}
                  </div>
                )}
                {finalUnitPrice != null && (
                  <div className="simple-item-final-price">
                    قیمت نهایی: {formatRialPerKg(finalUnitPrice)}
                  </div>
                )}
              </div>
            )
          })
        )}

        {hasPrice && (
          <div className="simple-total-row">
            <span>مبلغ کل</span>
            <strong>{formatRial(order.total_rial)}</strong>
          </div>
        )}

        <div className="simple-status-row">
          <span>وضعیت</span>
          <StatusBadge status={order.status} />
        </div>
      </div>

      {order.status === 'quoted' && allowed.includes('customer_approved') && (
        <button
          type="button"
          className="btn-primary btn-block"
          onClick={handleApproveQuote}
          disabled={busy}
        >
          {busy ? 'در حال ثبت...' : 'تأیید قیمت'}
        </button>
      )}

      {order.status === 'pending_review' && allowed.includes('cancelled') && (
        <button
          type="button"
          className="btn-secondary btn-block"
          onClick={handleCancel}
          disabled={busy}
        >
          {busy ? 'در حال لغو...' : 'لغو سفارش'}
        </button>
      )}

      {order.status === 'admin_approved' && (
        <p className="simple-message">سفارش شما توسط هینزا تأیید شده است.</p>
      )}
      {order.status === 'delivered' && (
        <p className="simple-message success">سفارش تحویل شد</p>
      )}

      <button
        type="button"
        className="btn-link details-toggle"
        onClick={() => setShowDetails((v) => !v)}
      >
        {showDetails ? 'بستن جزئیات' : 'جزئیات'}
      </button>

      {showDetails && (
        <div className="order-extra-details">
          <div className="info-row">
            <span className="info-label">تاریخ ثبت</span>
            <span className="info-value">{formatJalaliDate(order.created_at)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">تاریخ درخواستی تحویل</span>
            <span className="info-value">{formatJalaliDate(order.requested_date)}</span>
          </div>
          {order.customer_note && (
            <div className="info-row">
              <span className="info-label">یادداشت شما</span>
              <span className="info-value">{order.customer_note}</span>
            </div>
          )}
          <h3>تاریخچه سفارش</h3>
          <OrderTimeline events={events} fallbackCreatedAt={order.created_at} />
        </div>
      )}
    </div>
  )
}
