import { useMemo, useState } from 'react'
import { useCrmCustomers } from '../../hooks/useCrmCustomers'
import { useActiveProducts } from '../../hooks/useActiveProducts'
import { dbReasonForAttentionKey, reasonContext } from '../../utils/crmRules'
import { formatBalanceLine } from '../../utils/balance'
import { formatJalaliDate, formatQuantity } from '../../utils/formatters'
import CrmQuickActions from '../crm/CrmQuickActions'
import CrmSnoozeButton from '../crm/CrmSnoozeButton'
import ErrorBanner from '../common/ErrorBanner'
import '../crm/Crm.css'
import '../common/DataTable.css'
import './AdminCrmPage.css'

const CHIP_DEFS = [
  { key: 'attention', label: 'نیاز به پیگیری' },
  { key: 'settlement', label: 'تسویه' },
  { key: 'waiting', label: 'منتظر پاسخ مشتری' },
  { key: 'inactive', label: 'خرید غیرفعال' },
  { key: 'all', label: 'همه مشتری‌ها' },
]

const INACTIVITY_FILTER_OPTIONS = [
  { value: '', label: 'همه' },
  { value: '30', label: '۳۰ روز یا بیشتر' },
  { value: '60', label: '۶۰ روز یا بیشتر' },
  { value: '90', label: '۹۰ روز یا بیشتر' },
]

function matchesChip(row, chip) {
  if (chip === 'all') return true
  if (chip === 'attention') return Boolean(row.topReason)
  if (chip === 'settlement') return row.allReasons.some((r) => r.key === 'payment_followup')
  if (chip === 'waiting') return row.allReasons.some((r) => r.key === 'quote_followup')
  if (chip === 'inactive') return row.allReasons.some((r) => r.key === 'inactivity')
  return true
}

function matchesSearch(row, query) {
  if (!query) return true
  const text = [row.name, row.representative?.full_name, row.representative?.phone, row.city]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (text.includes(query)) return true
  return row.products.some((p) => `${p.code} ${p.name}`.toLowerCase().includes(query))
}

// Presentation-only tone for the "اقدام بعدی" pill - purely cosmetic, it
// never changes what nextAction string the CRM rules produce.
function nextActionTone(nextAction) {
  if (nextAction === 'پیگیری تسویه') return 'danger'
  if (nextAction === 'پیگیری قیمت' || nextAction === 'نیاز به تأیید سفارش') return 'warning'
  return 'neutral'
}

function MainProducts({ products }) {
  if (!products || products.length === 0) return <span>—</span>
  const shown = products.slice(0, 2)
  const extra = products.length - shown.length
  return (
    <div className="crm-product-lines">
      {shown.map((p) => (
        <span key={p.productId}>
          {p.code ? `${p.code} ${p.name}` : p.name}
        </span>
      ))}
      {extra > 0 && <span className="crm-product-more">+{formatQuantity(extra)} محصول</span>}
    </div>
  )
}

function NextActionCell({ row, onSnoozed }) {
  return (
    <div className="crm-next-action-cell" onClick={(e) => e.stopPropagation()}>
      <span className={`crm-next-action-pill tone-${nextActionTone(row.nextAction)}`}>
        {row.nextAction}
      </span>
      {row.topReason && (
        <CrmSnoozeButton
          companyId={row.id}
          reasonKey={row.topReason.key}
          orderId={reasonContext(row.topReason).orderId}
          invoiceId={reasonContext(row.topReason).invoiceId}
          onDone={onSnoozed}
        />
      )}
    </div>
  )
}

export default function AdminCrmPage({ onOpenOrder, onOpenInvoice, onOpenCustomer }) {
  const { rows, loading, error, crmSchemaReady, refresh } = useCrmCustomers()
  const { products } = useActiveProducts()

  const [chip, setChip] = useState('all')
  const [search, setSearch] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [hasBalanceOnly, setHasBalanceOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [waitingQuoteOnly, setWaitingQuoteOnly] = useState(false)
  const [waitingOrderOnly, setWaitingOrderOnly] = useState(false)
  const [inactivityFilter, setInactivityFilter] = useState('')

  const cities = useMemo(
    () => [...new Set(rows.map((r) => r.city).filter(Boolean))].sort(),
    [rows],
  )

  const counts = useMemo(
    () => ({
      attention: rows.filter((r) => r.topReason).length,
      settlement: rows.filter((r) => r.allReasons.some((x) => x.key === 'payment_followup')).length,
      waiting: rows.filter((r) => r.allReasons.some((x) => x.key === 'quote_followup')).length,
      inactive: rows.filter((r) => r.allReasons.some((x) => x.key === 'inactivity')).length,
      all: rows.length,
    }),
    [rows],
  )

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (!matchesChip(row, chip)) return false
      if (!matchesSearch(row, query)) return false
      if (productFilter && !row.products.some((p) => p.productId === productFilter)) return false
      if (cityFilter && row.city !== cityFilter) return false
      if (hasBalanceOnly && !(Number(row.balance) > 0)) return false
      if (overdueOnly && !row.allReasons.some((r) => r.key === 'payment_followup')) return false
      if (waitingQuoteOnly && !row.allReasons.some((r) => r.key === 'quote_followup')) return false
      if (waitingOrderOnly && !row.allReasons.some((r) => r.key === 'admin_action')) return false
      if (inactivityFilter) {
        const threshold = Number(inactivityFilter)
        if (!(row.daysSincePurchase != null && row.daysSincePurchase >= threshold)) return false
      }
      return true
    })
  }, [
    rows,
    chip,
    search,
    productFilter,
    cityFilter,
    hasBalanceOnly,
    overdueOnly,
    waitingQuoteOnly,
    waitingOrderOnly,
    inactivityFilter,
  ])

  return (
    <div>
      <div className="page-toolbar">
        <h2>CRM</h2>
        <button type="button" className="btn-secondary" onClick={refresh}>
          به‌روزرسانی
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />
      {!crmSchemaReady && (
        <div className="crm-schema-notice">
          برای فعال‌سازی کامل CRM (تاریخچه ارتباط و یادآوری بعداً)، ابتدا migration مربوط باید در
          پایگاه داده اجرا شود. فهرست و پیگیری‌های خودکار همچنان کار می‌کنند.
        </div>
      )}

      <div className="crm-chips">
        {CHIP_DEFS.map((def) => (
          <button
            key={def.key}
            type="button"
            className={`crm-chip${chip === def.key ? ' active' : ''}`}
            onClick={() => setChip(def.key)}
          >
            <span className="crm-chip-count">{loading ? '—' : counts[def.key]}</span>
            <span className="crm-chip-label">{def.label}</span>
          </button>
        ))}
      </div>

      <div className="orders-filters crm-filters">
        <input
          type="text"
          className="search-input"
          placeholder="جستجو بر اساس شرکت، نماینده، موبایل، شهر یا کد/نام محصول..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
          <option value="">همه محصولات</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.code} - {product.name_fa}
            </option>
          ))}
        </select>
        <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
          <option value="">همه شهرها</option>
          {cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
        <select value={inactivityFilter} onChange={(e) => setInactivityFilter(e.target.value)}>
          {INACTIVITY_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              خرید نکرده در {opt.label === 'همه' ? '...' : opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="crm-filter-toggles">
        <label>
          <input
            type="checkbox"
            checked={hasBalanceOnly}
            onChange={(e) => setHasBalanceOnly(e.target.checked)}
          />
          دارای مانده حساب
        </label>
        <label>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          فاکتور سررسید گذشته
        </label>
        <label>
          <input
            type="checkbox"
            checked={waitingQuoteOnly}
            onChange={(e) => setWaitingQuoteOnly(e.target.checked)}
          />
          منتظر تأیید قیمت
        </label>
        <label>
          <input
            type="checkbox"
            checked={waitingOrderOnly}
            onChange={(e) => setWaitingOrderOnly(e.target.checked)}
          />
          منتظر تأیید سفارش
        </label>
      </div>

      {/* Desktop: compact 7-column table, no horizontal scroll at laptop width. */}
      <div className="table-wrapper crm-table-wrapper">
        <table className="crm-table">
          <thead>
            <tr>
              <th>نام شرکت</th>
              <th>نماینده</th>
              <th>محصولات اصلی</th>
              <th>آخرین خرید</th>
              <th>مانده حساب</th>
              <th>اقدام بعدی</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  مشتری با این فیلتر پیدا نشد.
                </td>
              </tr>
            )}
            {!loading &&
              filteredRows.map((row) => {
                const templateKey = row.topReason
                  ? dbReasonForAttentionKey(row.topReason.key)
                  : 'general'
                const { orderId: relatedOrderId, invoiceId: relatedInvoiceId } = reasonContext(
                  row.topReason,
                )

                return (
                  <tr
                    key={row.id}
                    className="crm-clickable-row"
                    onClick={() => onOpenCustomer(row.id)}
                  >
                    <td>
                      <button
                        type="button"
                        className="crm-row-name-button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenCustomer(row.id)
                        }}
                      >
                        {row.name}
                      </button>
                    </td>
                    <td>{row.representative?.full_name || '—'}</td>
                    <td>
                      <MainProducts products={row.products} />
                    </td>
                    <td>
                      {row.lastPurchaseAt ? (
                        <>
                          {formatJalaliDate(row.lastPurchaseAt)}
                          <div className="crm-subtext">
                            {formatQuantity(row.daysSincePurchase)} روز پیش
                          </div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatBalanceLine(row.balance)}</td>
                    <td>
                      <NextActionCell row={row} onSnoozed={refresh} />
                    </td>
                    <td className="cell-actions">
                      <CrmQuickActions
                        companyId={row.id}
                        phone={row.representative?.phone}
                        customerName={row.representative?.full_name || row.name}
                        templateKey={templateKey}
                        templateVars={row.topReason?.meta || {}}
                        relatedOrderId={relatedOrderId}
                        relatedInvoiceId={relatedInvoiceId}
                        onOpenOrder={onOpenOrder}
                        onOpenInvoice={onOpenInvoice}
                        onOpenCustomer={onOpenCustomer}
                        viewLabel="مشاهده"
                        showRelatedLinks={false}
                        compact
                      />
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards instead of a squeezed/scrolling table. */}
      <div className="crm-cards">
        {loading && <p className="profile-empty">در حال بارگذاری...</p>}
        {!loading && filteredRows.length === 0 && (
          <p className="profile-empty">مشتری با این فیلتر پیدا نشد.</p>
        )}
        {!loading &&
          filteredRows.map((row) => {
            const templateKey = row.topReason ? dbReasonForAttentionKey(row.topReason.key) : 'general'
            const { orderId: relatedOrderId, invoiceId: relatedInvoiceId } = reasonContext(row.topReason)

            return (
              <div key={row.id} className="crm-card" onClick={() => onOpenCustomer(row.id)}>
                <div className="crm-card-top">
                  <div>
                    <div className="crm-card-name">{row.name}</div>
                    <div className="crm-card-rep">{row.representative?.full_name || '—'}</div>
                  </div>
                  <NextActionCell row={row} onSnoozed={refresh} />
                </div>
                <div className="crm-card-row">
                  <span className="crm-card-label">محصولات اصلی</span>
                  <MainProducts products={row.products} />
                </div>
                <div className="crm-card-row">
                  <span className="crm-card-label">آخرین خرید</span>
                  <span>
                    {row.lastPurchaseAt
                      ? `${formatJalaliDate(row.lastPurchaseAt)} (${formatQuantity(row.daysSincePurchase)} روز پیش)`
                      : '—'}
                  </span>
                </div>
                <div className="crm-card-row">
                  <span className="crm-card-label">مانده حساب</span>
                  <span>{formatBalanceLine(row.balance)}</span>
                </div>
                <div className="crm-card-actions">
                  <CrmQuickActions
                    companyId={row.id}
                    phone={row.representative?.phone}
                    customerName={row.representative?.full_name || row.name}
                    templateKey={templateKey}
                    templateVars={row.topReason?.meta || {}}
                    relatedOrderId={relatedOrderId}
                    relatedInvoiceId={relatedInvoiceId}
                    onOpenOrder={onOpenOrder}
                    onOpenInvoice={onOpenInvoice}
                    onOpenCustomer={onOpenCustomer}
                    viewLabel="مشاهده"
                    showRelatedLinks={false}
                    compact
                  />
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
