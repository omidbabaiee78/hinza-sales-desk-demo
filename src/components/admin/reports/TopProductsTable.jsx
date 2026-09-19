import { formatRial, formatKg } from '../../../utils/formatters'
import '../../common/DataTable.css'

export default function TopProductsTable({ products }) {
  if (products.length === 0) {
    return <p className="profile-empty">در این بازه فروشی ثبت نشده است.</p>
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>کد</th>
            <th>محصول</th>
            <th>مقدار</th>
            <th>فروش</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.code}>
              <td dir="ltr" style={{ textAlign: 'right' }}>
                {product.code}
              </td>
              <td>{product.name}</td>
              <td>{formatKg(product.quantityKg)}</td>
              <td>{formatRial(product.salesRial)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
