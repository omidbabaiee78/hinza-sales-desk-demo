import { supabase } from '../lib/supabaseClient'

const BUCKET = 'product-images'
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function validateProductImageFile(file) {
  if (!file) return 'فایلی انتخاب نشده است.'
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return 'فرمت تصویر باید jpg، png یا webp باشد.'
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'حجم تصویر نباید بیشتر از ۵ مگابایت باشد.'
  }
  return ''
}

// The bucket is public, so the URL is derived from the stored path at
// render time - products.image_path only ever holds the storage path.
export function getProductImageUrl(imagePath) {
  if (!imagePath) return null
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(imagePath)
  return data?.publicUrl || null
}

// A fresh random filename every time (never a product/company id in the
// path, since a new product doesn't have an id yet during the create form),
// so an upload never collides with or overwrites another file.
export async function uploadProductImage(file) {
  const validationError = validateProductImageFile(file)
  if (validationError) throw new Error(validationError)

  const ext = EXTENSION_BY_MIME[file.type] || 'jpg'
  const path = `${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error('آپلود تصویر با خطا مواجه شد. لطفاً دوباره تلاش کنید.')

  return path
}

// Best-effort cleanup (replacing/removing an image) - never thrown at the
// caller, since a failed cleanup should never block saving the product.
export async function removeProductImage(imagePath) {
  if (!imagePath) return
  try {
    await supabase.storage.from(BUCKET).remove([imagePath])
  } catch {
    // orphaned file left behind - not worth failing the admin's save over
  }
}
