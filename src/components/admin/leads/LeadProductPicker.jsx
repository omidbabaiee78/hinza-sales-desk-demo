import { useMemo, useState } from 'react'
import { useActiveProducts } from '../../../hooks/useActiveProducts'

// Search-by-code/name multi-select for a lead's interested products. Keeps
// the actual relation to public.products (lead_products) - free text only
// ever lives in the separate need_note field, never mixed into this list.
export default function LeadProductPicker({ selectedIds, onChange }) {
  const { products } = useActiveProducts()
  const [query, setQuery] = useState('')

  const selectedProducts = useMemo(
    () => selectedIds.map((id) => products.find((p) => p.id === id)).filter(Boolean),
    [selectedIds, products],
  )

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return products
      .filter((p) => !selectedIds.includes(p.id))
      .filter((p) => `${p.code} ${p.name_fa}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [products, query, selectedIds])

  function addProduct(id) {
    onChange([...selectedIds, id])
    setQuery('')
  }

  function removeProduct(id) {
    onChange(selectedIds.filter((existingId) => existingId !== id))
  }

  return (
    <div className="lead-product-picker">
      {selectedProducts.length > 0 && (
        <div className="lead-product-chips">
          {selectedProducts.map((p) => (
            <span key={p.id} className="lead-product-chip">
              {p.code} {p.name_fa}
              <button type="button" onClick={() => removeProduct(p.id)} aria-label="حذف">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder="جستجو با کد یا نام محصول..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="lead-product-suggestions">
          {suggestions.map((p) => (
            <button type="button" key={p.id} onClick={() => addProduct(p.id)}>
              {p.code} {p.name_fa}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
