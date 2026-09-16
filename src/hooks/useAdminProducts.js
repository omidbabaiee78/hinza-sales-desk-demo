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

  async function createProduct({ code, name_fa, category, description_fa }) {
    const { error } = await supabase.from('products').insert({
      code,
      name_fa,
      category: category || null,
      description_fa: description_fa || null,
      active: true,
    })
    if (error) throw new Error(translateDbError(error.message))
    refresh()
  }

  async function updateProduct(id, { code, name_fa, category, description_fa }) {
    const { error } = await supabase
      .from('products')
      .update({
        code,
        name_fa,
        category: category || null,
        description_fa: description_fa || null,
      })
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

  return {
    products,
    loading,
    error,
    refresh,
    createProduct,
    updateProduct,
    setProductActive,
  }
}
