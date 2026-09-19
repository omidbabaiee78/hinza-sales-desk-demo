import { useState } from 'react'
import { AVAILABILITY_OPTIONS } from '../../constants/productAvailability'
import { removeProductImage } from '../../services/productImages'
import ProductImageUploader from './ProductImageUploader'
import ProductMiniSpecsEditor from './ProductMiniSpecsEditor'
import ErrorBanner from '../common/ErrorBanner'
import '../common/Modal.css'

function applicationsToText(applications) {
  return (applications || []).join('، ')
}

function textToApplications(text) {
  return text
    .split(/[،,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function emptyForm() {
  return {
    code: '',
    name_fa: '',
    category: '',
    description_fa: '',
    active: true,
    polymer_base: '',
    applicationsText: '',
    packaging: '',
    availability: 'available',
    image_path: null,
    mini_specs: [],
  }
}

function formFromProduct(product) {
  return {
    code: product.code || '',
    name_fa: product.name_fa || '',
    category: product.category || '',
    description_fa: product.description_fa || '',
    active: product.active !== false,
    polymer_base: product.polymer_base || '',
    applicationsText: applicationsToText(product.applications),
    packaging: product.packaging || '',
    availability: product.availability || 'available',
    image_path: product.image_path || null,
    mini_specs: Array.isArray(product.mini_specs) ? product.mini_specs : [],
  }
}

// A row only counts as "real" once it has both a label and a value -
// mini_specs saved to the database never includes a half-empty row.
function nonEmptySpecs(specs) {
  return specs
    .map((row) => ({ label: (row.label || '').trim(), value: (row.value || '').trim() }))
    .filter((row) => row.label && row.value)
}

export default function ProductForm({ initialProduct, onSave, onCancel }) {
  const [form, setForm] = useState(
    initialProduct ? formFromProduct(initialProduct) : emptyForm(),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEditing = Boolean(initialProduct)
  const originalImagePath = initialProduct?.image_path || null

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Any image the admin uploaded during this session that never becomes the
  // saved product's image (replaced again, or the form is cancelled) is an
  // orphan file - clean it up immediately since nothing in the database
  // could possibly reference it yet. The ORIGINAL image (already saved on
  // the product) is only ever deleted after a successful save.
  function handleImageChange(newPath) {
    const previousPath = form.image_path
    if (previousPath && previousPath !== originalImagePath) {
      removeProductImage(previousPath)
    }
    handleChange('image_path', newPath)
  }

  function handleCancel() {
    if (form.image_path && form.image_path !== originalImagePath) {
      removeProductImage(form.image_path)
    }
    onCancel()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.code.trim() || !form.name_fa.trim()) return
    setError('')
    setSaving(true)
    try {
      await onSave({
        code: form.code,
        name_fa: form.name_fa,
        category: form.category,
        description_fa: form.description_fa,
        active: form.active,
        polymer_base: form.polymer_base,
        applications: textToApplications(form.applicationsText),
        packaging: form.packaging,
        availability: form.availability,
        image_path: form.image_path,
        mini_specs: nonEmptySpecs(form.mini_specs),
      })
      if (originalImagePath && originalImagePath !== form.image_path) {
        removeProductImage(originalImagePath)
      }
    } catch (err) {
      setError(err.message || 'ذخیره محصول با خطا مواجه شد.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <h2>{isEditing ? 'ویرایش محصول' : 'افزودن محصول'}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            تصویر محصول
            <ProductImageUploader value={form.image_path} onChange={handleImageChange} />
          </label>

          <label>
            نام محصول *
            <input
              type="text"
              required
              value={form.name_fa}
              onChange={(e) => handleChange('name_fa', e.target.value)}
            />
          </label>
          <label>
            کد محصول *
            <input
              type="text"
              dir="ltr"
              required
              value={form.code}
              onChange={(e) => handleChange('code', e.target.value)}
            />
          </label>
          <label>
            دسته‌بندی
            <input
              type="text"
              value={form.category}
              onChange={(e) => handleChange('category', e.target.value)}
            />
          </label>
          <label>
            توضیح کوتاه
            <textarea
              rows={3}
              value={form.description_fa}
              onChange={(e) => handleChange('description_fa', e.target.value)}
            />
          </label>
          <label>
            پایه پلیمری
            <input
              type="text"
              placeholder="مثلاً PE، PP، ABS"
              value={form.polymer_base}
              onChange={(e) => handleChange('polymer_base', e.target.value)}
            />
          </label>
          <label>
            کاربردها
            <input
              type="text"
              placeholder="با کاما جدا کنید - مثلاً فیلم، تزریق، بادی"
              value={form.applicationsText}
              onChange={(e) => handleChange('applicationsText', e.target.value)}
            />
          </label>
          <label>
            بسته‌بندی
            <input
              type="text"
              placeholder="مثلاً کیسه ۲۵ کیلویی"
              value={form.packaging}
              onChange={(e) => handleChange('packaging', e.target.value)}
            />
          </label>
          <label>
            وضعیت موجودی
            <select
              value={form.availability}
              onChange={(e) => handleChange('availability', e.target.value)}
            >
              {AVAILABILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            مشخصات کوتاه
            <ProductMiniSpecsEditor
              rows={form.mini_specs}
              onChange={(rows) => handleChange('mini_specs', rows)}
            />
          </label>

          <label className="product-form-availability">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => handleChange('active', e.target.checked)}
            />
            نمایش به مشتری
          </label>

          <ErrorBanner message={error} />

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCancel}
              disabled={saving}
            >
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'در حال ذخیره...' : isEditing ? 'ذخیره تغییرات' : 'افزودن محصول'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
