import { useState } from 'react'
import { useAdminProducts } from '../../hooks/useAdminProducts'
import { removeProductImage } from '../../services/productImages'
import ErrorBanner from '../common/ErrorBanner'
import ProductForm from './ProductForm'
import '../common/DataTable.css'

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
  const [toggleError, setToggleError] = useState('')
  const [togglingId, setTogglingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

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

  return (
    <div>
      <div className="page-toolbar">
        <h2>محصولات</h2>
        <button type="button" className="btn-primary" onClick={() => setShowAddForm(true)}>
          + افزودن محصول
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />
      <ErrorBanner message={toggleError} />
      <ErrorBanner message={deleteError} />

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>کد</th>
              <th>نام محصول</th>
              <th>دسته‌بندی</th>
              <th>توضیحات</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="empty-row">
                  در حال بارگذاری...
                </td>
              </tr>
            )}
            {!loading &&
              products.map((product) => (
                <tr key={product.id}>
                  <td dir="ltr" style={{ textAlign: 'right' }}>
                    {product.code}
                  </td>
                  <td>{product.name_fa}</td>
                  <td>{product.category || '—'}</td>
                  <td className="cell-notes" title={product.description_fa}>
                    {product.description_fa || '—'}
                  </td>
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
            {!loading && products.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  هنوز محصولی ثبت نشده است.
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
    </div>
  )
}
