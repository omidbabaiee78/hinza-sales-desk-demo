import { useMemo, useState } from 'react'
import { useCrmCustomers } from '../../hooks/useCrmCustomers'
import { useActiveProducts } from '../../hooks/useActiveProducts'
import { dbReasonForAttentionKey, reasonContext } from '../../utils/crmRules'
import { CRM_CHANNEL_LABELS } from '../../constants/crmLabels'
import { formatBalanceLine } from '../../utils/balance'
import { formatJalaliDate, formatKg, formatQuantity } from '../../utils/formatters'
import StatusBadge from '../orders/StatusBadge'
import CrmQuickActions from '../crm/CrmQuickActions'
import CrmSnoozeButton from '../crm/CrmSnoozeButton'
import ErrorBanner from '../common/ErrorBanner'
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

      <div className="table-wrapper">
        <table className="crm-table">
          <thead>
            <tr>
              <th>نام شرکت</th>
              <th>نماینده</th>
              <th>موبایل</th>
              <th data-hide-mobile="true">شهر</th>
              <th data-hide-mobile="true">محصولات اصلی</th>
              <th>آخرین خرید</th>
              <th data-hide-mobile="true">مجموع خرید (کیلوگرم)</th>
              <th data-hide-mobile="true">تعداد سفارش‌ها</th>
              <th data-hide-mobile="true">فاکتور باز</th>
              <th>مانده حساب</th>
              <th data-hide-mobile="true">وضعیت آخرین سفارش</th>
              <th data-hide-mobile="true">آخرین ارتباط</th>
              <th>اقدام پیشنهادی</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={14} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={14} className="empty-row">
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
                  <tr key={row.id}>
                    <td data-label="نام شرکت">{row.name}</td>
                    <td data-label="نماینده">{row.representative?.full_name || '—'}</td>
                    <td data-label="موبایل" dir="ltr" style={{ textAlign: 'right' }}>
                      {row.representative?.phone || '—'}
                    </td>
                    <td data-label="شهر" data-hide-mobile="true">
                      {row.city || '—'}
                    </td>
                    <td data-label="محصولات اصلی" data-hide-mobile="true">
                      {row.products.length === 0
                        ? '—'
                        : row.products
                            .slice(0, 2)
                            .map((p) => p.name)
                            .join('، ')}
                    </td>
                    <td data-label="آخرین خرید">
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
                    <td data-label="مجموع خرید" data-hide-mobile="true">
                      {formatKg(row.totalKg)}
                    </td>
                    <td data-label="تعداد سفارش‌ها" data-hide-mobile="true">
                      {formatQuantity(row.orderCount)}
                    </td>
                    <td data-label="فاکتور باز" data-hide-mobile="true">
                      {formatQuantity(row.openInvoicesCount)}
                    </td>
                    <td data-label="مانده حساب">{formatBalanceLine(row.balance)}</td>
                    <td data-label="وضعیت آخرین سفارش" data-hide-mobile="true">
                      {row.lastOrderStatus ? <StatusBadge status={row.lastOrderStatus} /> : '—'}
                    </td>
                    <td data-label="آخرین ارتباط" data-hide-mobile="true">
                      {row.lastContact
                        ? `${CRM_CHANNEL_LABELS[row.lastContact.channel] || row.lastContact.channel} - ${formatJalaliDate(row.lastContact.created_at)}`
                        : '—'}
                    </td>
                    <td data-label="اقدام پیشنهادی">{row.nextAction}</td>
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
                      />
                      {row.topReason && (
                        <CrmSnoozeButton
                          companyId={row.id}
                          reasonKey={row.topReason.key}
                          orderId={relatedOrderId}
                          invoiceId={relatedInvoiceId}
                          onDone={refresh}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
