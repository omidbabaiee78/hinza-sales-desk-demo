import { formatJalaliDate, formatKg, formatQuantity, formatRialPerKg } from '../../utils/formatters'
import '../common/DataTable.css'

// "محصولات مشتری" - derived entirely from this company's own delivered
// order history, never manually curated.
export default function CrmProductIntelligence({ products }) {
  if (!products || products.length === 0) {
    return <p className="profile-empty">این مشتری تاکنون خرید تحویل‌شده‌ای ثبت نکرده است.</p>
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>کد محصول</th>
            <th>نام محصول</th>
            <th>مجموع خرید</th>
            <th>تعداد دفعات خرید</th>
            <th>آخرین تاریخ خرید</th>
            <th>آخرین مقدار</th>
            <th>آخرین قیمت نهایی هر کیلو</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.productId}>
              <td dir="ltr" style={{ textAlign: 'right' }}>
                {product.code || '—'}
              </td>
              <td>{product.name}</td>
              <td>{formatKg(product.totalKg)}</td>
              <td>{formatQuantity(product.purchaseCount)} خرید</td>
              <td>{product.lastPurchaseAt ? formatJalaliDate(product.lastPurchaseAt) : '—'}</td>
              <td>{product.lastQuantityKg != null ? formatKg(product.lastQuantityKg) : '—'}</td>
              <td>
                {product.lastFinalUnitPriceRial != null
                  ? formatRialPerKg(product.lastFinalUnitPriceRial)
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
