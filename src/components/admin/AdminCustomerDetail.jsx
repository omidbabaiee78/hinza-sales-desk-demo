import { useAdminCustomer } from '../../hooks/useAdminCustomer'
import { useCompanyBalance } from '../../hooks/useCompanyBalance'
import { useCustomerOrders } from '../../hooks/useCustomerOrders'
import { useCustomerInvoices } from '../../hooks/useCustomerInvoices'
import { useCompanyPayments } from '../../hooks/useCompanyPayments'
import { useActiveProducts } from '../../hooks/useActiveProducts'
import { usePricingSuggestion } from '../../hooks/usePricingSuggestion'
import { usePricingSettings } from '../../hooks/usePricingSettings'
import { useOrderEvents } from '../../hooks/useOrderEvents'
import { useCrmCommunications } from '../../hooks/useCrmCommunications'
import { useCompanySnoozes } from '../../hooks/useCompanySnoozes'
import { formatJalaliDate, formatKg, formatRial } from '../../utils/formatters'
import { formatBalanceLine } from '../../utils/balance'
import { isInvoiceOpen, calcInvoicePaid, calcInvoiceRemaining } from '../../utils/invoice'
import { invoicesUntilNextTier } from '../../utils/pricing'
import { OVERDUE_INVOICE_STATUSES } from '../../hooks/useAttentionItems'
import {
  computeCustomerAttention,
  daysBetween,
  deriveNextAction,
  dbReasonForAttentionKey,
  reasonContext,
  snoozeSignature,
} from '../../utils/crmRules'
import { buildProductIntelligence } from '../../utils/productIntelligence'
import StatusBadge from '../orders/StatusBadge'
import InvoiceStatusBadge from '../invoices/InvoiceStatusBadge'
import PaymentsList from '../invoices/PaymentsList'
import CompanySpecialPrices from './CompanySpecialPrices'
import ErrorBanner from '../common/ErrorBanner'
import LoadingScreen from '../common/LoadingScreen'
import CrmQuickActions from '../crm/CrmQuickActions'
import CrmSnoozeButton from '../crm/CrmSnoozeButton'
import CrmProductIntelligence from '../crm/CrmProductIntelligence'
import CrmCommunicationHistory from '../crm/CrmCommunicationHistory'
import '../crm/Crm.css'
import '../orders/OrderDetail.css'
import '../common/DashboardCards.css'
import '../common/DataTable.css'

export default function AdminCustomerDetail({ companyId, onBack, onOpenOrder, onOpenInvoice }) {
  const { company, representative, loading, error, refresh } = useAdminCustomer(companyId)
  const { balance, loading: balanceLoading } = useCompanyBalance(companyId)
  const { orders, loading: ordersLoading } = useCustomerOrders(companyId)
  const { invoices, loading: invoicesLoading } = useCustomerInvoices(companyId)
  const { payments, loading: paymentsLoading } = useCompanyPayments(companyId)
  const { products: activeProducts } = useActiveProducts()
  const { suggestion: loyaltyInfo, loading: loyaltyLoading } = usePricingSuggestion(
    companyId,
    activeProducts[0]?.id || null,
  )
  const { settings: pricingSettings } = usePricingSettings()

  // The one order currently in 'quoted' status (if any) needs its actual
  // "became quoted" timestamp for the 2-day follow-up escalation, not just
  // its creation date - order_events already tracks that per order.
  const quotedOrderForEvents = orders.find((order) => order.status === 'quoted') || null
  const { events: quotedOrderEvents } = useOrderEvents(quotedOrderForEvents?.id || null)
  const {
    communications,
    loading: communicationsLoading,
    error: communicationsError,
    schemaMissing: communicationsSchemaMissing,
  } = useCrmCommunications(companyId)
  const { snoozes, refresh: refreshSnoozes } = useCompanySnoozes(companyId)

  if (loading) return <LoadingScreen text="در حال بارگذاری مشتری..." />
  if (error) return <ErrorBanner message={error} onRetry={refresh} />
  if (!company) return null

  const purchaseHistory = orders.filter((order) => order.status === 'delivered')
  const openInvoicesCount = invoices.filter((invoice) => isInvoiceOpen(invoice.status)).length
  const lastPurchaseAt = purchaseHistory[0]?.created_at || null
  const daysSincePurchase = daysBetween(lastPurchaseAt)

  // ---- CRM: this customer's own automatic attention reasons ----
  const hasEverOrdered = orders.length > 0
  const approvedOrder = orders.find((order) => order.status === 'customer_approved') || null
  const quotedSinceIso =
    quotedOrderEvents.find((event) => event.event_type === 'quoted')?.created_at ||
    quotedOrderForEvents?.created_at ||
    null
  const quotedSinceDays = quotedOrderForEvents ? daysBetween(quotedSinceIso) : null

  const todayIso = new Date().toISOString().slice(0, 10)
  const overdueInvoiceRaw =
    invoices
      .filter(
        (invoice) =>
          OVERDUE_INVOICE_STATUSES.includes(invoice.status) &&
          invoice.due_date &&
          invoice.due_date < todayIso,
      )
      .sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0] || null
  const overdueInvoice = overdueInvoiceRaw
    ? {
        ...overdueInvoiceRaw,
        remainingRial: calcInvoiceRemaining(
          overdueInvoiceRaw.total_rial,
          calcInvoicePaid(payments.filter((p) => p.invoice_id === overdueInvoiceRaw.id)),
        ),
      }
    : null

  const nowIso = new Date().toISOString()
  const activeSnoozeSignatures = new Set(
    snoozes
      .filter((snooze) => snooze.snooze_until > nowIso)
      .map((snooze) => snoozeSignature(snooze.reason_key, snooze.order_id, snooze.invoice_id)),
  )
  const attentionReasons = computeCustomerAttention({
    overdueInvoice,
    approvedOrder,
    quotedOrder: quotedOrderForEvents,
    quotedSinceDays,
    daysSincePurchase,
    hasEverOrdered,
    representativeCreatedAt: representative?.created_at || null,
    lastDeliveredOrder: purchaseHistory[0] || null,
  }).filter((reason) => {
    const { orderId, invoiceId } = reasonContext(reason)
    return !activeSnoozeSignatures.has(snoozeSignature(reason.key, orderId, invoiceId))
  })
  const topReason = attentionReasons[0] || null
  const nextAction = deriveNextAction(attentionReasons)

  const customerProducts = buildProductIntelligence(
    purchaseHistory.flatMap((order) =>
      (order.order_items || []).map((item) => ({ ...item, order_created_at: order.created_at })),
    ),
  )

  const isLoyal = loyaltyInfo ? Number(loyaltyInfo.auto_discount_percent) > 0 : false
  const nextTierIn =
    loyaltyInfo && pricingSettings && !isLoyal
      ? invoicesUntilNextTier({
          paidInvoiceCount: loyaltyInfo.paid_invoice_count,
          everyPaidInvoices: pricingSettings.loyalty_every_paid_invoices,
          autoDiscountPercent: loyaltyInfo.auto_discount_percent,
          maxAutoDiscountPercent: pricingSettings.max_auto_discount_percent,
        })
      : null

  const metrics = [
    {
      key: 'balance',
      label: 'مانده حساب',
      value: balanceLoading ? '—' : formatBalanceLine(balance),
    },
    { key: 'orders', label: 'تعداد سفارش‌ها', value: ordersLoading ? '—' : orders.length },
    {
      key: 'openInvoices',
      label: 'تعداد فاکتورهای باز',
      value: invoicesLoading ? '—' : openInvoicesCount,
    },
    {
      key: 'lastPurchase',
      label: 'آخرین خرید',
      value: ordersLoading ? '—' : lastPurchaseAt ? formatJalaliDate(lastPurchaseAt) : '—',
    },
  ]

  return (
    <div className="order-detail">
      <div className="page-toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <h2>{company.name}</h2>
      </div>

      <section className="order-detail-card crm-profile-summary">
        <div className="crm-profile-summary-row">
          <div>
            <h3 style={{ margin: 0 }}>وضعیت CRM</h3>
            <p className="crm-next-action">
              اقدام بعدی: <strong>{nextAction}</strong>
              {isLoyal && <span className="crm-loyal-badge">مشتری وفادار</span>}
            </p>
          </div>
          <CrmQuickActions
            companyId={companyId}
            phone={representative?.phone}
            customerName={representative?.full_name || company.name}
            templateKey={topReason ? dbReasonForAttentionKey(topReason.key) : 'general'}
            templateVars={topReason?.meta || {}}
            relatedOrderId={reasonContext(topReason).orderId}
            relatedInvoiceId={reasonContext(topReason).invoiceId}
            onOpenOrder={onOpenOrder}
            onOpenInvoice={onOpenInvoice}
          />
        </div>

        {attentionReasons.length === 0 ? (
          <p className="profile-empty">فعلاً موردی نیاز به پیگیری برای این مشتری وجود ندارد.</p>
        ) : (
          <ul className="crm-reason-list">
            {attentionReasons.map((reason) => {
              const { orderId, invoiceId } = reasonContext(reason)
              return (
                <li key={reason.key}>
                  <span className="crm-reason-label">{reason.label}</span>
                  <span className="crm-reason-detail">{reason.detail}</span>
                  <CrmSnoozeButton
                    companyId={companyId}
                    reasonKey={reason.key}
                    orderId={orderId}
                    invoiceId={invoiceId}
                    onDone={refreshSnoozes}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="order-detail-grid">
        <section className="order-detail-card">
          <h3>اطلاعات مشتری</h3>
          <div className="info-row">
            <span className="info-label">نام شرکت</span>
            <span className="info-value">{company.name}</span>
          </div>
          <div className="info-row">
            <span className="info-label">نام مشتری / نماینده</span>
            <span className="info-value">{representative?.full_name || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">موبایل</span>
            <span className="info-value" dir="ltr">
              {representative?.phone || '—'}
            </span>
          </div>
          {representative?.email && (
            <div className="info-row">
              <span className="info-label">ایمیل</span>
              <span className="info-value" dir="ltr">
                {representative.email}
              </span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">شهر</span>
            <span className="info-value">{company.city || '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">استان</span>
            <span className="info-value">{company.province || '—'}</span>
          </div>
          {company.address && (
            <div className="info-row">
              <span className="info-label">آدرس</span>
              <span className="info-value">{company.address}</span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">تاریخ عضویت</span>
            <span className="info-value">{formatJalaliDate(representative?.created_at)}</span>
          </div>
        </section>
      </div>

      <div className="dashboard-grid" style={{ marginBottom: 24 }}>
        {metrics.map((metric) => (
          <div className="dashboard-card" key={metric.key}>
            <span className="dashboard-card-value">{metric.value}</span>
            <span className="dashboard-card-label">{metric.label}</span>
          </div>
        ))}
      </div>

      <div className="order-detail-grid">
        <section className="order-detail-card">
          <h3>وفاداری</h3>
          {loyaltyLoading || !loyaltyInfo ? (
            <p className="profile-empty">در حال محاسبه...</p>
          ) : (
            <>
              <div className="info-row">
                <span className="info-label">خریدهای تسویه‌شده</span>
                <span className="info-value">{loyaltyInfo.paid_invoice_count}</span>
              </div>
              {isLoyal ? (
                <>
                  <div className="info-row">
                    <span className="info-label">وضعیت</span>
                    <span className="info-value">مشتری وفادار</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">تخفیف پیشنهادی</span>
                    <span className="info-value">٪{loyaltyInfo.auto_discount_percent}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="info-row">
                    <span className="info-label">تخفیف وفاداری</span>
                    <span className="info-value">هنوز فعال نشده</span>
                  </div>
                  {nextTierIn != null && (
                    <p className="profile-empty">{nextTierIn} خرید تا تخفیف</p>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      <CompanySpecialPrices companyId={companyId} />

      <h3>محصولات مشتری</h3>
      <CrmProductIntelligence products={customerProducts} />

      <h3>تاریخچه ارتباط</h3>
      <CrmCommunicationHistory
        communications={communications}
        loading={communicationsLoading}
        error={communicationsError}
        schemaMissing={communicationsSchemaMissing}
      />

      <h3>سابقه خرید</h3>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>تاریخ</th>
              <th>شماره سفارش</th>
              <th>محصول / محصولات</th>
              <th>مقدار کل</th>
              <th>مبلغ</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {ordersLoading && (
              <tr>
                <td colSpan={6} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!ordersLoading && purchaseHistory.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  هنوز خریدی برای این مشتری ثبت نشده است.
                </td>
              </tr>
            )}
            {!ordersLoading &&
              purchaseHistory.map((order) => (
                <tr
                  key={order.id}
                  className="clickable-row"
                  onClick={() => onOpenOrder(order.id)}
                >
                  <td>{formatJalaliDate(order.created_at)}</td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {order.order_number ?? order.id}
                  </td>
                  <td>{order.productsSummary || '—'}</td>
                  <td>{formatKg(order.totalQuantityKg)}</td>
                  <td>{formatRial(order.total_rial)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h3>فاکتورها</h3>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>شماره فاکتور</th>
              <th>تاریخ</th>
              <th>مبلغ</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoicesLoading && (
              <tr>
                <td colSpan={5} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!invoicesLoading && invoices.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  فاکتوری برای این مشتری ثبت نشده است.
                </td>
              </tr>
            )}
            {!invoicesLoading &&
              invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {invoice.invoice_number ?? invoice.id}
                  </td>
                  <td>{formatJalaliDate(invoice.issued_at)}</td>
                  <td>{formatRial(invoice.total_rial)}</td>
                  <td>
                    <InvoiceStatusBadge status={invoice.status} />
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onOpenInvoice(invoice.id)}
                    >
                      مشاهده
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h3>پرداخت‌ها</h3>
      {paymentsLoading ? <p>در حال بارگذاری...</p> : <PaymentsList payments={payments} />}
    </div>
  )
}
