import { useMemo, useState } from 'react'
import { useAdminProducts } from '../../hooks/useAdminProducts'
import { removeProductImage } from '../../services/productImages'
import { AVAILABILITY_OPTIONS, availabilityLabel } from '../../constants/productAvailability'
import ErrorBanner from '../common/ErrorBanner'
import ProductForm from './ProductForm'
import ProductImportModal from './ProductImportModal'
import '../common/DataTable.css'
import './ProductsPage.css'

function matchesSearch(product, query) {
  if (!query) return true
  return [product.name_fa, product.code].filter(Boolean).join(' ').toLowerCase().includes(query)
}

export default function ProductsPage() {
  const {
    products,
    loading,
    error,
    refresh,
    createProduct,
    updateProduct,
    setProductActive,
    deleteProduct,
  } = useAdminProducts()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [toggleError, setToggleError] = useState('')
  const [togglingId, setTogglingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [polymerBaseFilter, setPolymerBaseFilter] = useState('')
  const [availabilityFilter, setAvailabilityFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('')

  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState('')

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
      if (activeFilter === 'active' && !product.active) return false
      if (activeFilter === 'inactive' && product.active) return false
      return matchesSearch(product, query)
    })
  }, [products, search, categoryFilter, polymerBaseFilter, availabilityFilter, activeFilter])

  const allVisibleSelected =
    filteredProducts.length > 0 && filteredProducts.every((p) => selectedIds.has(p.id))

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        filteredProducts.forEach((p) => next.delete(p.id))
        return next
      }
      const next = new Set(prev)
      filteredProducts.forEach((p) => next.add(p.id))
      return next
    })
  }

  async function handleAddSave(form) {
    await createProduct(form)
    setShowAddForm(false)
  }

  async function handleEditSave(form) {
    await updateProduct(editingProduct.id, form)
    setEditingProduct(null)
  }

  async function handleToggleActive(product) {
    setToggleError('')
    setTogglingId(product.id)
    try {
      await setProductActive(product.id, !product.active)
    } catch (err) {
      setToggleError(err.message || 'تغییر وضعیت محصول با خطا مواجه شد.')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleDelete(product) {
    if (!window.confirm(`محصول «${product.name_fa}» برای همیشه حذف شود؟`)) return
    setDeleteError('')
    setDeletingId(product.id)
    try {
      await deleteProduct(product.id)
      if (product.image_path) removeProductImage(product.image_path)
    } catch (err) {
      setDeleteError(err.message || 'حذف محصول با خطا مواجه شد.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleBulkSetActive(active) {
    setBulkError('')
    setBulkBusy(true)
    try {
      const ids = [...selectedIds]
      for (const id of ids) {
        await setProductActive(id, active)
      }
      setSelectedIds(new Set())
    } catch (err) {
      setBulkError(err.message || 'تغییر وضعیت گروهی با خطا مواجه شد.')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div>
      <div className="page-toolbar">
        <h2>محصولات</h2>
        <div className="products-toolbar-actions">
          <button type="button" className="btn-secondary" onClick={() => setShowImport(true)}>
            ورود گروهی محصولات
          </button>
          <button type="button" className="btn-primary" onClick={() => setShowAddForm(true)}>
            + افزودن محصول
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />
      <ErrorBanner message={toggleError} />
      <ErrorBanner message={deleteError} />
      <ErrorBanner message={bulkError} />

      <div className="products-filters">
        <input
          type="text"
          className="search-input"
          placeholder="جستجو بر اساس نام یا کد محصول..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">همه دسته‌بندی‌ها</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select value={polymerBaseFilter} onChange={(e) => setPolymerBaseFilter(e.target.value)}>
          <option value="">همه پایه‌های پلیمری</option>
          {polymerBases.map((base) => (
            <option key={base} value={base}>
              {base}
            </option>
          ))}
        </select>
        <select value={availabilityFilter} onChange={(e) => setAvailabilityFilter(e.target.value)}>
          <option value="">همه وضعیت‌های موجودی</option>
          {AVAILABILITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
          <option value="">فعال و غیرفعال</option>
          <option value="active">فقط فعال</option>
          <option value="inactive">فقط غیرفعال</option>
        </select>
      </div>

      {selectedIds.size > 0 && (
        <div className="products-bulk-bar">
          <span>{selectedIds.size} محصول انتخاب شده</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleBulkSetActive(true)}
            disabled={bulkBusy}
          >
            فعال کردن
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleBulkSetActive(false)}
            disabled={bulkBusy}
          >
            غیرفعال کردن
          </button>
        </div>
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  aria-label="انتخاب همه"
                />
              </th>
              <th>کد</th>
              <th>نام محصول</th>
              <th>دسته‌بندی</th>
              <th>پایه پلیمری</th>
              <th>وضعیت موجودی</th>
              <th>نمایش</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(product.id)}
                      onChange={() => toggleSelected(product.id)}
                      aria-label={`انتخاب ${product.name_fa}`}
                    />
                  </td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {product.code}
                  </td>
                  <td>{product.name_fa}</td>
                  <td>{product.category || '—'}</td>
                  <td>{product.polymer_base || '—'}</td>
                  <td>{availabilityLabel(product.availability)}</td>
                  <td>{product.active ? 'فعال' : 'غیرفعال'}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setEditingProduct(product)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className={product.active ? 'btn-link btn-link-danger' : 'btn-link'}
                      onClick={() => handleToggleActive(product)}
                      disabled={togglingId === product.id}
                    >
                      {togglingId === product.id
                        ? 'در حال ثبت...'
                        : product.active
                          ? 'غیرفعال کردن'
                          : 'فعال کردن'}
                    </button>
                    <button
                      type="button"
                      className="btn-link btn-link-danger"
                      onClick={() => handleDelete(product)}
                      disabled={deletingId === product.id}
                    >
                      {deletingId === product.id ? 'در حال حذف...' : 'حذف محصول'}
                    </button>
                  </td>
                </tr>
              ))}
            {!loading && filteredProducts.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-row">
                  {products.length === 0
                    ? 'هنوز محصولی ثبت نشده است.'
                    : 'محصولی مطابق فیلتر یافت نشد.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddForm && (
        <ProductForm onSave={handleAddSave} onCancel={() => setShowAddForm(false)} />
      )}

      {editingProduct && (
        <ProductForm
          initialProduct={editingProduct}
          onSave={handleEditSave}
          onCancel={() => setEditingProduct(null)}
        />
      )}

      {showImport && (
        <ProductImportModal onClose={() => setShowImport(false)} onImported={refresh} />
      )}
    </div>
  )
}
