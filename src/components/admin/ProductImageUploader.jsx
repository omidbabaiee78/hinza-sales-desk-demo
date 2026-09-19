import { useRef, useState } from 'react'
import { uploadProductImage, getProductImageUrl } from '../../services/productImages'
import ProductImage from '../products/ProductImage'
import ErrorBanner from '../common/ErrorBanner'
import './ProductImageUploader.css'

// Purely mechanical: pick/validate/upload a file and report the new path
// upward via onChange. It never deletes anything itself - the parent form
// knows the original vs. in-session path and decides what's safe to clean
// up (and only after a save actually succeeds).
export default function ProductImageUploader({ value, onChange }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError('')
    setUploading(true)
    try {
      const path = await uploadProductImage(file)
      onChange(path)
    } catch (err) {
      setError(err.message || 'آپلود تصویر با خطا مواجه شد.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="product-image-uploader">
      <ProductImage src={getProductImageUrl(value)} alt="پیش‌نمایش تصویر محصول" size="md" />
      <div className="product-image-uploader-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'در حال آپلود...' : value ? 'تغییر عکس' : 'آپلود عکس'}
        </button>
        {value && (
          <button
            type="button"
            className="btn-link btn-link-danger"
            onClick={() => onChange(null)}
            disabled={uploading}
          >
            حذف عکس
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        hidden
      />
      <ErrorBanner message={error} />
    </div>
  )
}
