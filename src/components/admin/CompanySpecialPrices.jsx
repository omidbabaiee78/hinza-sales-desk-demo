import { useState } from 'react'
import { useCompanySpecialPrices } from '../../hooks/useCompanySpecialPrices'
import { useActiveProducts } from '../../hooks/useActiveProducts'
import { formatJalaliDate } from '../../utils/formatters'
import { todayJalaali, jalaaliToGregorianIso } from '../../utils/jalali'
import JalaliDateInput from '../common/JalaliDateInput'
import ErrorBanner from '../common/ErrorBanner'
import '../common/DataTable.css'
import '../invoices/PaymentForm.css'

function todayIso() {
  const { jy, jm, jd } = todayJalaali()
  return jalaaliToGregorianIso(jy, jm, jd)
}

function isCurrentlyValid(price) {
  const today = todayIso()
  if (price.valid_from && price.valid_from > today) return false
  if (price.valid_to && price.valid_to < today) return false
  return true
}

const EMPTY_FORM = {
  productId: '',
  discountPercent: '',
  validFrom: todayIso(),
  validTo: '',
  note: '',
}

export default function CompanySpecialPrices({ companyId }) {
  const { prices, loading, error, createPrice, updatePrice, removePrice, submitting } =
    useCompanySpecialPrices(companyId)
  const { products } = useActiveProducts()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [removeError, setRemoveError] = useState('')

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function startAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  function startEdit(price) {
    setEditingId(price.id)
    setForm({
      productId: price.product_id,
      discountPercent: price.discount_percent ?? '',
      validFrom: price.valid_from || '',
      validTo: price.valid_to || '',
      note: price.note || '',
    })
    setFormError('')
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')
    if (!editingId && !form.productId) {
      setFormError('لطفاً محصول را انتخاب کنید.')
      return
    }
    if (form.discountPercent === '' || Number(form.discountPercent) <= 0) {
      setFormError('لطفاً درصد تخفیف اختصاصی را وارد کنید.')
      return
    }
    try {
      if (editingId) {
        await updatePrice(editingId, form)
      } else {
        await createPrice(form)
      }
      setShowForm(false)
      setEditingId(null)
    } catch (err) {
      setFormError(err.message || 'ذخیره قیمت اختصاصی با خطا مواجه شد.')
    }
  }

  async function handleRemove(price) {
    if (!window.confirm('این قیمت اختصاصی حذف شود؟')) return
    setRemoveError('')
    try {
      await removePrice(price.id)
    } catch (err) {
      setRemoveError(err.message || 'حذف قیمت اختصاصی با خطا مواجه شد.')
    }
  }

  return (
    <section>
      <div className="page-toolbar">
        <h3 style={{ margin: 0 }}>تخفیف اختصاصی مشتری</h3>
        {!showForm && (
          <button type="button" className="btn-secondary" onClick={startAdd}>
            + افزودن تخفیف اختصاصی
          </button>
        )}
      </div>

      <ErrorBanner message={error} />
      <ErrorBanner message={removeError} />

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>محصول</th>
              <th>تخفیف اختصاصی</th>
              <th>شروع</th>
              <th>پایان</th>
              <th>یادداشت</th>
              <th>وضعیت</th>
              <th></th>
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
            {!loading && prices.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  تخفیف اختصاصی‌ای برای این مشتری ثبت نشده است.
                </td>
              </tr>
            )}
            {!loading &&
              prices.map((price) => (
                <tr key={price.id}>
                  <td>{price.products?.name_fa || '—'}</td>
                  <td>{price.discount_percent != null ? `٪${price.discount_percent}` : '—'}</td>
                  <td>{price.valid_from ? formatJalaliDate(price.valid_from) : '—'}</td>
                  <td>{price.valid_to ? formatJalaliDate(price.valid_to) : 'نامحدود'}</td>
                  <td className="cell-notes" title={price.note}>
                    {price.note || '—'}
                  </td>
                  <td>{isCurrentlyValid(price) ? 'فعال' : 'غیرفعال'}</td>
                  <td className="cell-actions">
                    <button type="button" className="btn-link" onClick={() => startEdit(price)}>
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="btn-link btn-link-danger"
                      onClick={() => handleRemove(price)}
                      disabled={submitting}
                    >
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <form className="payment-form" onSubmit={handleSubmit}>
          <label>
            محصول *
            <select
              value={form.productId}
              disabled={Boolean(editingId)}
              onChange={(e) => handleChange('productId', e.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name_fa}
                </option>
              ))}
            </select>
          </label>
          <label>
            تخفیف اختصاصی %
            <input
              type="number"
              min="0"
              max="100"
              required
              value={form.discountPercent}
              onChange={(e) => handleChange('discountPercent', e.target.value)}
            />
          </label>
          <label>
            تاریخ شروع (اختیاری)
            <JalaliDateInput
              value={form.validFrom}
              onChange={(value) => handleChange('validFrom', value)}
            />
          </label>
          <label>
            تاریخ پایان (اختیاری)
            <JalaliDateInput value={form.validTo} onChange={(value) => handleChange('validTo', value)} />
          </label>
          <label>
            یادداشت (اختیاری)
            <textarea
              rows={2}
              value={form.note}
              onChange={(e) => handleChange('note', e.target.value)}
            />
          </label>

          <ErrorBanner message={formError} />

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={cancelForm} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'در حال ذخیره...' : editingId ? 'ذخیره تغییرات' : 'افزودن'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
