import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات مشتری. لطفاً دوباره تلاش کنید.'
}

function fetchCompany(companyId) {
  return supabase.from('companies').select('*').eq('id', companyId).maybeSingle()
}

function fetchMember(companyId) {
  return supabase
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .maybeSingle()
}

function fetchProfile(userId) {
  return supabase
    .from('profiles')
    .select('id, full_name, phone, email, created_at')
    .eq('id', userId)
    .maybeSingle()
}

// Just the company + its representative profile. Orders, invoices, payments
// and balance for the detail page all come from the existing per-company
// hooks (useCustomerOrders/useCustomerInvoices/useCompanyPayments/
// useCompanyBalance) - nothing about those is recalculated here.
export function useAdminCustomer(companyId) {
  const [company, setCompany] = useState(null)
  const [representative, setRepresentative] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let ignore = false

    fetchCompany(companyId).then(({ data: companyData, error: companyError }) => {
      if (ignore) return
      if (companyError) {
        setError(translateDbError(companyError.message))
        setCompany(null)
        setRepresentative(null)
        setLoading(false)
        return
      }
      setCompany(companyData ?? null)

      fetchMember(companyId).then(({ data: member }) => {
        if (ignore) return
        if (!member) {
          setRepresentative(null)
          setError('')
          setLoading(false)
          return
        }
        fetchProfile(member.user_id).then(({ data: profileData }) => {
          if (ignore) return
          setRepresentative(profileData ?? null)
          setError('')
          setLoading(false)
        })
      })
    })

    return () => {
      ignore = true
    }
  }, [companyId, reloadToken])

  function refresh() {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }

  return { company, representative, loading: companyId ? loading : false, error, refresh }
}
