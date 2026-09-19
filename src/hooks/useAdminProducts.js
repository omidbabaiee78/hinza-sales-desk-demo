import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('duplicate key')) return 'کد محصول تکراری است.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در ذخیره اطلاعات محصول. لطفاً دوباره تلاش کنید.'
}

function buildProductPayload({
  code,
  name_fa,
  category,
  description_fa,
  active,
  polymer_base,
  applications,
  packaging,
  availability,
  image_path,
  mini_specs,
}) {
  return {
    code,
    name_fa,
    category: category || null,
    description_fa: description_fa || null,
    active: active !== false,
    polymer_base: polymer_base || null,
    applications: applications || [],
    packaging: packaging || null,
    availability: availability || 'available',
    image_path: image_path || null,
    mini_specs: mini_specs || [],
  }
}

function fetchProducts() {
  return supabase.from('products').select('*').order('created_at', { ascending: false })
}

export function useAdminProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false
    fetchProducts().then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setProducts(data)
      }
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  async function createProduct(form) {
    const { error } = await supabase.from('products').insert(buildProductPayload(form))
    if (error) throw new Error(translateDbError(error.message))
    refresh()
  }

  async function updateProduct(id, form) {
    const { error } = await supabase
      .from('products')
      .update(buildProductPayload(form))
      .eq('id', id)
    if (error) throw new Error(translateDbError(error.message))
    refresh()
  }

  async function setProductActive(id, active) {
    const { error } = await supabase
      .from('products')
      .update({ active })
      .eq('id', id)
    if (error) throw new Error(translateDbError(error.message))
    refresh()
  }

  // Historical orders must keep showing what was actually ordered, so a
  // referenced product is never hard-deleted - deactivating/hiding it is
  // the only supported path once it has real order history.
  async function deleteProduct(id) {
    const { count, error: countError } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id)
    if (countError) throw new Error(translateDbError(countError.message))
    if (count > 0) {
      throw new Error(
        'این محصول در سفارش‌های قبلی استفاده شده و برای حفظ سوابق قابل حذف کامل نیست. به‌جای آن می‌توانید آن را غیرفعال کنید.',
      )
    }

    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) {
      if (error.message?.includes('foreign key')) {
        throw new Error(
          'این محصول در سفارش‌های قبلی استفاده شده و برای حفظ سوابق قابل حذف کامل نیست. به‌جای آن می‌توانید آن را غیرفعال کنید.',
        )
      }
      throw new Error(translateDbError(error.message))
    }
    refresh()
  }

  return {
    products,
    loading,
    error,
    refresh,
    createProduct,
    updateProduct,
    setProductActive,
    deleteProduct,
  }
}
