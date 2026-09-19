import { useActiveProducts } from '../../hooks/useActiveProducts'
import { buildProductFixedSpecs, buildMiniSpecs } from '../../utils/productDatasheet'
import { getProductImageUrl } from '../../services/productImages'
import ProductImage from '../products/ProductImage'
import ErrorBanner from '../common/ErrorBanner'
import LoadingScreen from '../common/LoadingScreen'
import './CustomerProductDetail.css'

export default function CustomerProductDetail({ productId, onBack, onRequestPrice }) {
  const { products, loading, error } = useActiveProducts()

  if (loading) return <LoadingScreen text="در حال بارگذاری محصول..." />
  if (error) return <ErrorBanner message={error} />

  const product = products.find((p) => p.id === productId)
  if (!product) {
    return (
      <div>
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <p className="profile-empty" style={{ marginTop: 16 }}>
          این محصول یافت نشد.
        </p>
      </div>
    )
  }

  const fixedSpecs = buildProductFixedSpecs(product)
  const miniSpecs = buildMiniSpecs(product)

  return (
    <div className="product-detail">
      <div className="page-toolbar">
        <button type="button" className="btn-secondary" onClick={onBack}>
          بازگشت
        </button>
        <h2>{product.name_fa}</h2>
      </div>

      <div className="product-detail-grid">
        <ProductImage src={getProductImageUrl(product.image_path)} alt={product.name_fa} size="lg" />

        <div className="product-detail-info">
          <div className="product-detail-code" dir="ltr">
            کد: {product.code}
          </div>

          {product.description_fa && (
            <p className="product-detail-description">{product.description_fa}</p>
          )}

          <div className="product-datasheet">
            {fixedSpecs.map((row) => (
              <div className="info-row" key={row.label}>
                <span className="info-label">{row.label}</span>
                <span className="info-value">{row.value}</span>
              </div>
            ))}
          </div>

          {miniSpecs.length > 0 && (
            <div className="product-mini-specs">
              <h3>مشخصات کوتاه</h3>
              <div className="product-datasheet">
                {miniSpecs.map((row) => (
                  <div className="info-row" key={row.label}>
                    <span className="info-label">{row.label}</span>
                    <span className="info-value">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn-primary product-detail-cta"
            onClick={() => onRequestPrice(product.id)}
          >
            درخواست قیمت
          </button>
        </div>
      </div>
    </div>
  )
}
