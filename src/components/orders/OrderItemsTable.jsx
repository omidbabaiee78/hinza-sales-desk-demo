import { useState } from 'react'
import { formatRial, formatRialPerKg, formatKg } from '../../utils/formatters'
import '../common/DataTable.css'
import './OrderItemsTable.css'

function buildDraft(items) {
  const draft = {}
  for (const item of items) {
    draft[item.id] = {
      unit_price_rial: item.unit_price_rial ?? '',
      discount_percent: item.discount_percent ?? '',
    }
  }
  return draft
}

function calcLineTotal(quantityKg, unitPrice, discountPercent) {
  const qty = Number(quantityKg) || 0
  const price = Number(unitPrice) || 0
  const discount = Number(discountPercent) || 0
  const gross = qty * price
  return Math.round(gross * (1 - discount / 100))
}

export default function OrderItemsTable({
  items,
  editable,
  totalRial,
  onAnnouncePrice,
  saving,
}) {
  const [draft, setDraft] = useState(() => buildDraft(items))
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
      setValidationError('لطفاً قیمت هر کیلو را برای همهٔ اقلام وارد کنید.')
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
        return (
          sum + calcLineTotal(item.quantity_kg, row.unit_price_rial, row.discount_percent)
        )
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
              <th>قیمت هر کیلو{editable ? ' (ریال)' : ''}</th>
              <th>تخفیف (%)</th>
              <th>مبلغ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const row = draft[item.id] || {}
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
                      <td>
                        {item.discount_percent ? `٪${item.discount_percent}` : '—'}
                      </td>
                    </>
                  )}
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
