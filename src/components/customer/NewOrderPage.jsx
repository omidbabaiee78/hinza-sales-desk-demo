import { useEffect, useRef, useState } from 'react'
import { useActiveProducts } from '../../hooks/useActiveProducts'
import { useCreateOrder } from '../../hooks/useCreateOrder'
import { useOrder } from '../../hooks/useOrder'
import ErrorBanner from '../common/ErrorBanner'
import { todayJalaali, jalaaliToGregorianIso } from '../../utils/jalali'
import { formatJalaliDate } from '../../utils/formatters'
import './NewOrderPage.css'

function emptyItem(productId = '') {
  return { key: crypto.randomUUID(), productId, quantityKg: '', note: '' }
}

function todayIso() {
  const { jy, jm, jd } = todayJalaali()
  return jalaaliToGregorianIso(jy, jm, jd)
}

// Builds prefill rows from a previous order's items - product and quantity
// ONLY. unit_price_rial/discount_percent/line_total_rial on the source
// order_items are deliberately never read here: Hinza always re-quotes at
// current/day pricing, so nothing about price ever survives a reorder.
// Products no longer active are excluded (reported back as skipped) and
// same-product duplicates are merged by summing quantity.
function buildReorderPrefill(sourceOrder, activeProductIds) {
  const quantityByProductId = new Map()
  const skipped = []

  for (const item of sourceOrder.order_items || []) {
    const quantity = Number(item.quantity_kg)
    if (!item.product_id || !(quantity > 0)) continue
    if (!activeProductIds.has(item.product_id)) {
      skipped.push({ name: item.products?.name_fa || 'محصول', code: item.products?.code || '' })
      continue
    }
    quantityByProductId.set(item.product_id, (quantityByProductId.get(item.product_id) || 0) + quantity)
  }

  const items = [...quantityByProductId.entries()].map(([productId, quantityKg]) => ({
    key: crypto.randomUUID(),
    productId,
    quantityKg: String(quantityKg),
    note: '',
  }))

  return { items, skipped }
}

// initialProductId lets "درخواست قیمت" on a product card/detail page open
// this form with that product already selected in the first row.
// sourceOrderId lets "سفارش مجدد" open it prefilled from a previous order's
// products/quantities (never its prices). Only one of the two is ever set
// by the caller. Both only affect the initial fill, never fight the
// customer's own later edits.
export default function NewOrderPage({ onCreated, initialProductId, sourceOrderId }) {
  const { products, loading: productsLoading, error: productsError } =
    useActiveProducts()
  const { createOrder, submitting } = useCreateOrder()
  const {
    order: sourceOrder,
    loading: sourceOrderLoading,
    error: sourceOrderError,
  } = useOrder(sourceOrderId || null)

  const [items, setItems] = useState(() => [emptyItem(initialProductId)])
  const [customerNote, setCustomerNote] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reorderNotice, setReorderNotice] = useState(null)
  // A ref (not state) guards "apply the prefill exactly once": it doesn't
  // need to be an effect dependency, so setting it can't re-trigger the
  // very effect that set it.
  const reorderAppliedRef = useRef(false)

  useEffect(() => {
    if (!sourceOrderId || reorderAppliedRef.current) return
    if (sourceOrderLoading || productsLoading) return

    // Deferred to a microtask (matching the same .then()-callback shape
    // useOrder() itself already uses to apply fetched data) rather than
    // calling setState directly in the effect body.
    Promise.resolve().then(() => {
      reorderAppliedRef.current = true

      // Source order failed to load (not found, RLS-blocked, or a network
      // error) - sourceOrderError already carries a friendly Persian
      // message via useOrder(), so just fall back to a blank form instead
      // of crashing.
      if (!sourceOrder) return

      const activeProductIds = new Set(products.map((p) => p.id))
      const { items: prefilledItems, skipped } = buildReorderPrefill(sourceOrder, activeProductIds)

      setItems(prefilledItems.length > 0 ? prefilledItems : [emptyItem()])
      setReorderNotice({
        orderNumber: sourceOrder.order_number ?? sourceOrder.id,
        skipped,
      })
    })
  }, [sourceOrderId, sourceOrder, sourceOrderLoading, products, productsLoading])

  function handleClearReorder() {
    setItems([emptyItem()])
    setReorderNotice(null)
  }

  // The order date is never customer-editable: it's always today, and the
  // backend (create_customer_order) is the real authority that stamps the
  // Iran/Tehran date regardless of what's sent here. This is only kept for
  // RPC signature compatibility.
  const requestedDate = todayIso()

  function updateItem(key, field, value) {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    )
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()])
  }

  function removeItem(key) {
    setItems((prev) => (prev.length > 1 ? prev.filter((item) => item.key !== key) : prev))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const validItems = items.filter((item) => item.productId && Number(item.quantityKg) > 0)
    if (validItems.length === 0) {
      setError('لطفاً حداقل یک ردیف با محصول و مقدار معتبر وارد کنید.')
      return
    }

    try {
      const { orderId } = await createOrder({
        requestedDate,
        customerNote,
        items: validItems.map((item) => ({
          productId: item.productId,
          quantityKg: Number(item.quantityKg),
          note: item.note,
        })),
      })
      setSuccessMessage('سفارش شما با موفقیت ثبت شد.')
      setTimeout(() => onCreated(orderId), 900)
    } catch (err) {
      setError(err.message || 'ثبت سفارش با خطا مواجه شد.')
    }
  }

  return (
    <div className="new-order-page">
      <div className="page-toolbar">
        <h2>ثبت سفارش جدید</h2>
      </div>

      <ErrorBanner message={productsError} />
      <ErrorBanner message={sourceOrderId ? sourceOrderError : ''} />
      <ErrorBanner message={error} />
      {successMessage && <div className="success-banner">{successMessage}</div>}

      {reorderNotice && (
        <div className="reorder-banner">
          <p>این سفارش بر اساس سفارش شماره {reorderNotice.orderNumber} ایجاد شده است.</p>
          {reorderNotice.skipped.length > 0 && (
            <ul className="reorder-banner-warnings">
              {reorderNotice.skipped.map((product, index) => (
                <li key={index}>
                  {product.name}
                  {product.code ? ` (${product.code})` : ''} — این محصول در حال حاضر برای سفارش فعال
                  نیست.
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-link" onClick={handleClearReorder}>
            پاک کردن و شروع سفارش جدید
          </button>
        </div>
      )}

      {!productsLoading && products.length === 0 && !productsError && (
        <p className="profile-empty">
          در حال حاضر محصول فعالی برای سفارش وجود ندارد. لطفاً بعداً دوباره تلاش کنید.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div className="order-items-form">
          {items.map((item) => (
            <div className="order-item-row" key={item.key}>
              <label>
                محصول
                <select
                  value={item.productId}
                  onChange={(e) => updateItem(item.key, 'productId', e.target.value)}
                  disabled={productsLoading}
                >
                  <option value="">انتخاب کنید</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name_fa}
                      {product.code ? ` (${product.code})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                مقدار (کیلوگرم)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={item.quantityKg}
                  onChange={(e) => updateItem(item.key, 'quantityKg', e.target.value)}
                />
              </label>
              <label>
                یادداشت (اختیاری)
                <input
                  type="text"
                  value={item.note}
                  onChange={(e) => updateItem(item.key, 'note', e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-link btn-link-danger remove-item"
                onClick={() => removeItem(item.key)}
                disabled={items.length === 1}
              >
                حذف ردیف
              </button>
            </div>
          ))}
        </div>

        <button type="button" className="btn-secondary" onClick={addItem}>
          + افزودن ردیف محصول
        </button>

        <p className="order-date-note">
          تاریخ ثبت سفارش: امروز — {formatJalaliDate(requestedDate)}
        </p>

        <label className="order-note-field">
          یادداشت سفارش (اختیاری)
          <textarea
            rows={3}
            value={customerNote}
            onChange={(e) => setCustomerNote(e.target.value)}
          />
        </label>

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'در حال ثبت...' : 'ثبت سفارش'}
        </button>
      </form>
    </div>
  )
}
