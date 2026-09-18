import { useState } from 'react'
import { formatRial, formatRialPerKg, formatKg } from '../../utils/formatters'
import { resolveSuggestedDiscountPercent } from '../../utils/pricing'
import '../common/DataTable.css'
import './OrderItemsTable.css'

function findSuggestion(suggestions, item) {
  if (!suggestions) return null
  return (
    suggestions.find((s) => s.order_item_id && s.order_item_id === item.id) ||
    suggestions.find((s) => s.product_id && s.product_id === item.product_id) ||
    null
  )
}

function buildDraft(items, suggestions) {
  const draft = {}
  for (const item of items) {
    const hasManualPrice = item.unit_price_rial !== null && item.unit_price_rial !== undefined
    draft[item.id] = {
      unit_price_rial: hasManualPrice ? item.unit_price_rial : '',
      discount_percent: hasManualPrice
        ? (item.discount_percent ?? 0)
        : resolveSuggestedDiscountPercent(findSuggestion(suggestions, item)),
    }
  }
  return draft
}

function calcFinalUnitPrice(unitPrice, discountPercent) {
  const price = Number(unitPrice) || 0
  const discount = Number(discountPercent) || 0
  return Math.round(price * (1 - discount / 100))
}

function calcLineTotal(quantityKg, unitPrice, discountPercent) {
  const qty = Number(quantityKg) || 0
  const price = Number(unitPrice) || 0
  const discount = Number(discountPercent) || 0
  return Math.round(qty * price * (1 - discount / 100))
}

export default function OrderItemsTable({
  items,
  editable,
  totalRial,
  onAnnouncePrice,
  saving,
  pricingSuggestions,
}) {
  const [draft, setDraft] = useState(() => buildDraft(items, pricingSuggestions))
  const [validationError, setValidationError] = useState('')

  if (!items || items.length === 0) {
    return <p className="order-items-warning">اقلام این سفارش ثبت نشده‌اند.</p>
  }

  function handleChange(itemId, field, value) {
    setDraft((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }))
  }

  function handleAnnounce() {
    const invalid = items.some((item) => {
      const price = draft[item.id]?.unit_price_rial
      return price === '' || price === undefined || Number(price) <= 0
    })
    if (invalid) {
      setValidationError('لطفاً قیمت روز هر کیلو را برای همهٔ اقلام وارد کنید.')
      return
    }
    setValidationError('')
    const payload = items.map((item) => {
      const row = draft[item.id] || {}
      return {
        id: item.id,
        unit_price_rial: Number(row.unit_price_rial),
        discount_percent: row.discount_percent === '' ? 0 : Number(row.discount_percent),
      }
    })
    onAnnouncePrice(payload)
  }

  const previewTotal = editable
    ? items.reduce((sum, item) => {
        const row = draft[item.id] || {}
        return sum + calcLineTotal(item.quantity_kg, row.unit_price_rial, row.discount_percent)
      }, 0)
    : null

  return (
    <div className="order-items">
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>محصول</th>
              <th>مقدار</th>
              <th>قیمت روز هر کیلو</th>
              <th>تخفیف پیشنهادی (%)</th>
              <th>قیمت نهایی هر کیلو</th>
              <th>مبلغ نهایی</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const row = draft[item.id] || {}
              const unitPrice = editable ? row.unit_price_rial : item.unit_price_rial
              const discount = editable ? row.discount_percent : item.discount_percent
              const finalUnitPrice =
                unitPrice !== '' && unitPrice != null
                  ? calcFinalUnitPrice(unitPrice, discount)
                  : null
              const lineTotal = editable
                ? calcLineTotal(item.quantity_kg, row.unit_price_rial, row.discount_percent)
                : item.line_total_rial

              return (
                <tr key={item.id}>
                  <td>
                    {item.products?.name_fa || 'محصول نامشخص'}
                    {item.products?.code ? ` (${item.products.code})` : ''}
                  </td>
                  <td>{formatKg(item.quantity_kg)}</td>
                  {editable ? (
                    <>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={row.unit_price_rial ?? ''}
                          onChange={(e) =>
                            handleChange(item.id, 'unit_price_rial', e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={row.discount_percent ?? ''}
                          onChange={(e) =>
                            handleChange(item.id, 'discount_percent', e.target.value)
                          }
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        {item.unit_price_rial != null
                          ? formatRialPerKg(item.unit_price_rial)
                          : '—'}
                      </td>
                      <td>{item.discount_percent ? `٪${item.discount_percent}` : '—'}</td>
                    </>
                  )}
                  <td>{finalUnitPrice != null ? formatRialPerKg(finalUnitPrice) : '—'}</td>
                  <td>{lineTotal != null ? formatRial(lineTotal) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="order-total-row">
        <span>مبلغ کل</span>
        <strong>{formatRial(editable ? previewTotal : totalRial)}</strong>
      </div>

      {editable && (
        <>
          {validationError && <div className="error-banner">{validationError}</div>}
          <button
            type="button"
            className="btn-primary"
            onClick={handleAnnounce}
            disabled={saving}
          >
            {saving ? 'در حال ثبت...' : 'اعلام قیمت'}
          </button>
        </>
      )}
    </div>
  )
}
