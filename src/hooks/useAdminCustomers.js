import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت مشتریان. لطفاً دوباره تلاش کنید.'
}

function fetchCompanies() {
  return supabase.from('companies').select('*').order('created_at', { ascending: false })
}

function fetchMembers(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('company_members').select('company_id, user_id').in('company_id', companyIds)
}

function fetchProfiles(userIds) {
  if (userIds.length === 0) return Promise.resolve({ data: [] })
  return supabase.from('profiles').select('id, full_name, phone').in('id', userIds)
}

// Only delivered orders count as a real purchase for "آخرین خرید", matching
// the same definition used in the purchase history section of the detail page.
function fetchLastDeliveredOrders(companyIds) {
  if (companyIds.length === 0) return Promise.resolve({ data: [] })
  return supabase
    .from('orders')
    .select('company_id, created_at')
    .in('company_id', companyIds)
    .eq('status', 'delivered')
}

// The balance RPC has no bulk form, so it is called once per company in
// parallel - the same single source of truth used everywhere else, just
// fanned out for the list view.
function fetchBalances(companyIds) {
  return Promise.all(
    companyIds.map((id) =>
      supabase
        .rpc('company_balance_rial', { p_company_id: id })
        .then(({ data, error }) => ({ id, balance: error ? null : Number(data) || 0 })),
    ),
  )
}

export function useAdminCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false

    async function load() {
      const { data: companies, error: companiesError } = await fetchCompanies()
      if (ignore) return
      if (companiesError) {
        setError(translateDbError(companiesError.message))
        setLoading(false)
        return
      }

      const companyIds = (companies || []).map((c) => c.id)
      const [membersRes, ordersRes, balances] = await Promise.all([
        fetchMembers(companyIds),
        fetchLastDeliveredOrders(companyIds),
        fetchBalances(companyIds),
      ])
      if (ignore) return

      const userIds = [...new Set((membersRes.data || []).map((m) => m.user_id))]
      const { data: profiles } = await fetchProfiles(userIds)
      if (ignore) return

      const profilesById = new Map((profiles || []).map((p) => [p.id, p]))
      const representativeByCompany = new Map()
      for (const member of membersRes.data || []) {
        if (!representativeByCompany.has(member.company_id)) {
          representativeByCompany.set(member.company_id, profilesById.get(member.user_id) || null)
        }
      }

      const lastPurchaseByCompany = new Map()
      for (const order of ordersRes.data || []) {
        const prev = lastPurchaseByCompany.get(order.company_id)
        if (!prev || order.created_at > prev) {
          lastPurchaseByCompany.set(order.company_id, order.created_at)
        }
      }

      const balanceByCompany = new Map(balances.map((b) => [b.id, b.balance]))

      setError('')
      setCustomers(
        (companies || []).map((company) => ({
          ...company,
          representative: representativeByCompany.get(company.id) || null,
          lastPurchaseAt: lastPurchaseByCompany.get(company.id) || null,
          balance: balanceByCompany.has(company.id) ? balanceByCompany.get(company.id) : null,
        })),
      )
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

  return { customers, loading, error, refresh }
}
