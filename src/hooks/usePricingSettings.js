import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در ذخیره تنظیمات قیمت‌گذاری. لطفاً دوباره تلاش کنید.'
}

function fetchSettings() {
  return supabase.from('pricing_settings').select('*').limit(1).maybeSingle()
}

// Single global settings row (admin-only via RLS). The same row is what the
// get_pricing_suggestion/get_order_pricing_suggestions RPCs read from, so
// editing it here changes the numbers those RPCs return - nothing about the
// discount formula itself is duplicated in the frontend.
export function usePricingSettings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let ignore = false
    fetchSettings().then(({ data, error: loadError }) => {
      if (ignore) return
      if (loadError) {
        setError(translateDbError(loadError.message))
      } else {
        setError('')
        setSettings(data ?? null)
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

  async function updateSettings(values) {
    if (!settings?.id) return
    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('pricing_settings')
        .update(values)
        .eq('id', settings.id)
      if (error) throw new Error(translateDbError(error.message))
      refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return { settings, loading, error, refresh, updateSettings, submitting }
}
