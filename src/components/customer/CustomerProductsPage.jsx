import { useMemo, useState } from 'react'
import { useActiveProducts } from '../../hooks/useActiveProducts'
import { AVAILABILITY_OPTIONS } from '../../constants/productAvailability'
import ProductCard from '../products/ProductCard'
import ErrorBanner from '../common/ErrorBanner'
import './CustomerProductsPage.css'

function matchesSearch(product, query) {
  if (!query) return true
  const text = [
    product.name_fa,
    product.code,
    product.category,
    product.description_fa,
    product.polymer_base,
    ...(product.applications || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return text.includes(query)
}

export default function CustomerProductsPage({ onOpenProduct, onRequestPrice }) {
  const { products, loading, error } = useActiveProducts()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [polymerBaseFilter, setPolymerBaseFilter] = useState('')
  const [availabilityFilter, setAvailabilityFilter] = useState('')

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products],
  )
  const polymerBases = useMemo(
    () => [...new Set(products.map((p) => p.polymer_base).filter(Boolean))].sort(),
    [products],
  )

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter((product) => {
      if (categoryFilter && product.category !== categoryFilter) return false
      if (polymerBaseFilter && product.polymer_base !== polymerBaseFilter) return false
      if (availabilityFilter && (product.availability || 'available') !== availabilityFilter) {
        return false
      }
      return matchesSearch(product, query)
    })
  }, [products, search, categoryFilter, polymerBaseFilter, availabilityFilter])

  return (
    <div className="customer-products-page">
      <div className="page-toolbar">
        <h2>محصولات</h2>
      </div>

      <ErrorBanner message={error} />

      <input
        type="text"
        className="product-search-input"
        placeholder="جستجو بر اساس نام، کد، دسته‌بندی، پایه پلیمری یا کاربرد... مثلاً 7101، ABS یا فیلم"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="product-filters">
        {categories.length > 0 && (
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">همه دسته‌بندی‌ها</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        )}
        {polymerBases.length > 0 && (
          <select
            value={polymerBaseFilter}
            onChange={(e) => setPolymerBaseFilter(e.target.value)}
          >
            <option value="">همه پایه‌های پلیمری</option>
            {polymerBases.map((base) => (
              <option key={base} value={base}>
                {base}
              </option>
            ))}
          </select>
        )}
        <select value={availabilityFilter} onChange={(e) => setAvailabilityFilter(e.target.value)}>
          <option value="">همه وضعیت‌ها</option>
          {AVAILABILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="profile-empty">در حال بارگذاری محصولات...</p>}

      {!loading && filteredProducts.length === 0 && (
        <p className="profile-empty">
          {products.length === 0
            ? 'در حال حاضر محصولی برای نمایش وجود ندارد.'
            : 'محصولی مطابق جستجو یافت نشد.'}
        </p>
      )}

      {!loading && filteredProducts.length > 0 && (
        <div className="product-grid">
          {filteredProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onView={onOpenProduct}
              onRequestPrice={onRequestPrice}
            />
          ))}
        </div>
      )}
    </div>
  )
}
