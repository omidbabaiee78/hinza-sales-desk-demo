import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات سرنخ. لطفاً دوباره تلاش کنید.'
}

function fetchLead(leadId) {
  return supabase.from('sales_leads').select('*').eq('id', leadId).maybeSingle()
}

function fetchLeadProducts(leadId) {
  return supabase.from('lead_products').select('product_id, products(id, code, name_fa)').eq('lead_id', leadId)
}

function fetchActivities(leadId) {
  return supabase
    .from('lead_activities')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
}

export function useLeadDetail(leadId) {
  const [lead, setLead] = useState(null)
  const [products, setProducts] = useState([])
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!leadId) return
    let ignore = false

    async function load() {
      const [{ data: leadRow, error: leadError }, { data: productRows }, { data: activityRows }] = await Promise.all([
        fetchLead(leadId),
        fetchLeadProducts(leadId),
        fetchActivities(leadId),
      ])
      if (ignore) return
      if (leadError) {
        setError(translateDbError(leadError.message))
        setLoading(false)
        return
      }
      setError('')
      setLead(leadRow)
      setProducts((productRows || []).map((row) => row.products).filter(Boolean))
      setActivities(activityRows || [])
      setLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
  }, [leadId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { lead, products, activities, loading, error, refresh }
}
