import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت سرنخ‌های فروش. لطفاً دوباره تلاش کنید.'
}

function fetchLeads() {
  return supabase.from('sales_leads').select('*').order('created_at', { ascending: false })
}

// One bulk join query for every lead's interested products - never a
// per-lead fetch (the list can otherwise easily hit N+1 here).
function fetchLeadProducts(leadIds) {
  if (leadIds.length === 0) return Promise.resolve({ data: [] })
  return supabase
    .from('lead_products')
    .select('lead_id, product_id, products(id, code, name_fa)')
    .in('lead_id', leadIds)
}

export function useSalesLeads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    async function load() {
      const { data: leadRows, error: leadsError } = await fetchLeads()
      if (ignore) return
      if (leadsError) {
        setError(translateDbError(leadsError.message))
        setLoading(false)
        return
      }

      const leadIds = (leadRows || []).map((l) => l.id)
      const { data: leadProductRows } = await fetchLeadProducts(leadIds)
      if (ignore) return

      const productsByLead = new Map()
      for (const row of leadProductRows || []) {
        if (!row.products) continue
        const list = productsByLead.get(row.lead_id) || []
        list.push(row.products)
        productsByLead.set(row.lead_id, list)
      }

      setError('')
      setLeads((leadRows || []).map((lead) => ({ ...lead, products: productsByLead.get(lead.id) || [] })))
      setLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { leads, loading, error, refresh }
}
