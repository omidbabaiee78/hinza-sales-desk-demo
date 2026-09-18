import { formatKg, formatRial, formatRialPerKg } from '../../utils/formatters'
import '../common/DataTable.css'
import '../orders/OrderItemsTable.css'

export default function InvoiceItemsTable({ items }) {
  if (!items || items.length === 0) {
    return <p className="order-items-warning">اقلام این فاکتور ثبت نشده‌اند.</p>
  }

  return (
    <div className="order-items">
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>محصول</th>
              <th>مقدار</th>
              <th>قیمت هر کیلو</th>
              <th>تخفیف</th>
              <th>مبلغ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.product_name_fa || 'محصول نامشخص'}
                  {item.product_code ? ` (${item.product_code})` : ''}
                </td>
                <td>{formatKg(item.quantity)}</td>
                <td>
                  {item.unit_price_rial != null ? formatRialPerKg(item.unit_price_rial) : '—'}
                </td>
                <td>{item.discount_percent ? `٪${item.discount_percent}` : '—'}</td>
                <td>{item.line_total_rial != null ? formatRial(item.line_total_rial) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
