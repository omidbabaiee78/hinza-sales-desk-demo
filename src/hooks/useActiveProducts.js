import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت فهرست محصولات. لطفاً دوباره تلاش کنید.'
}

function fetchActiveProducts() {
  return supabase
    .from('products')
    .select('id, code, name_fa, category')
    .eq('active', true)
    .order('name_fa', { ascending: true })
}

export function useActiveProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let ignore = false
    fetchActiveProducts().then(({ data, error: loadError }) => {
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
  }, [])

  return { products, loading, error }
}
