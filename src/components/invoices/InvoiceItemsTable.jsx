import { formatQuantity, formatRial } from '../../utils/formatters'
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
              <th>ردیف</th>
              <th>کد محصول</th>
              <th>شرح محصول</th>
              <th>مقدار</th>
              <th>واحد</th>
              <th>قیمت واحد</th>
              <th>تخفیف</th>
              <th>مبلغ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td>{formatQuantity(index + 1)}</td>
                <td dir="ltr" style={{ textAlign: 'right' }}>
                  {item.product_code || '—'}
                </td>
                <td>{item.product_name_fa || 'محصول نامشخص'}</td>
                <td>{formatQuantity(item.quantity)}</td>
                <td>کیلوگرم</td>
                <td>{item.unit_price_rial != null ? formatRial(item.unit_price_rial) : '—'}</td>
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
