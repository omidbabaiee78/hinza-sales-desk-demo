import { useState } from 'react'
import { useActiveProducts } from '../../hooks/useActiveProducts'
import { useCreateOrder } from '../../hooks/useCreateOrder'
import ErrorBanner from '../common/ErrorBanner'
import JalaliDateInput from '../common/JalaliDateInput'
import './NewOrderPage.css'

function emptyItem() {
  return { key: crypto.randomUUID(), productId: '', quantityKg: '', note: '' }
}

export default function NewOrderPage({ onCreated }) {
  const { products, loading: productsLoading, error: productsError } =
    useActiveProducts()
  const { createOrder, submitting } = useCreateOrder()

  const [items, setItems] = useState([emptyItem()])
  const [requestedDate, setRequestedDate] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

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

    if (!requestedDate) {
      setError('لطفاً تاریخ درخواستی تحویل را انتخاب کنید.')
      return
    }

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
      <ErrorBanner message={error} />
      {successMessage && <div className="success-banner">{successMessage}</div>}

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

        <div className="order-meta-row">
          <label>
            تاریخ درخواستی تحویل *
            <JalaliDateInput
              value={requestedDate}
              onChange={setRequestedDate}
              required
            />
          </label>
        </div>

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
