import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت فاکتورها. لطفاً دوباره تلاش کنید.'
}

function fetchInvoices() {
  return supabase.from('invoices').select('*').order('created_at', { ascending: false })
}

function fetchCompanies() {
  return supabase.from('companies').select('id, name')
}

export function useAdminInvoices() {
  const [invoices, setInvoices] = useState([])
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchInvoices(), fetchCompanies()]).then(
      ([invoicesRes, companiesRes]) => {
        if (ignore) return
        if (invoicesRes.error) {
          setError(translateDbError(invoicesRes.error.message))
          setLoading(false)
          return
        }
        const companiesById = new Map((companiesRes.data || []).map((c) => [c.id, c]))
        setError('')
        setInvoices(
          invoicesRes.data.map((inv) => ({
            ...inv,
            company: companiesById.get(inv.company_id) || null,
          })),
        )
        setCompanies(companiesRes.data || [])
        setLoading(false)
      },
    )
    return () => {
      ignore = true
    }
  }, [reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { invoices, companies, loading, error, refresh }
}
