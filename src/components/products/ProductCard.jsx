import { AVAILABILITY_TONE, availabilityLabel } from '../../constants/productAvailability'
import { getProductImageUrl } from '../../services/productImages'
import { buildMiniSpecs } from '../../utils/productDatasheet'
import ProductImage from './ProductImage'
import './ProductCard.css'

const CARD_SPEC_LIMIT = 4

// Compact by design: name, code, category/polymer base, availability, up to
// 4 mini-specs and (if set) the main application - everything else only
// appears on the detail page. All content here is admin-entered; nothing is
// hardcoded per product.
export default function ProductCard({ product, onView, onRequestPrice }) {
  const tone = AVAILABILITY_TONE[product.availability] || 'success'
  const miniSpecs = buildMiniSpecs(product, CARD_SPEC_LIMIT)
  const mainApplication = product.applications?.[0]

  return (
    <div className="product-card">
      <ProductImage src={getProductImageUrl(product.image_path)} alt={product.name_fa} size="md" />

      <div className="product-card-body">
        <h3 className="product-card-name">{product.name_fa}</h3>
        <div className="product-card-code" dir="ltr">
          {product.code}
        </div>

        <div className="product-card-tags">
          {product.category && <span className="product-tag">{product.category}</span>}
          {product.polymer_base && <span className="product-tag">{product.polymer_base}</span>}
          <span className={`product-tag product-tag-availability tone-${tone}`}>
            {availabilityLabel(product.availability)}
          </span>
        </div>

        {mainApplication && (
          <div className="product-card-application">کاربرد: {mainApplication}</div>
        )}

        {miniSpecs.length > 0 && (
          <div className="product-card-specs">
            {miniSpecs.map((spec) => (
              <span className="product-spec-chip" key={spec.label}>
                {spec.label} {spec.value}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="product-card-actions">
        <button type="button" className="btn-secondary" onClick={() => onView(product.id)}>
          مشاهده محصول
        </button>
        <button type="button" className="btn-primary" onClick={() => onRequestPrice(product.id)}>
          درخواست قیمت
        </button>
      </div>
    </div>
  )
}
