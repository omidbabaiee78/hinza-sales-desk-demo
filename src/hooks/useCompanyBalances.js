import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Bulk (but still fanned-out, since company_balance_rial has no bulk form -
// same precedent as useAdminCustomers.js) balance lookup for a SMALL,
// bounded set of company ids - e.g. only the top ~8 customers actually
// rendered on the Reports page, never every company in the system.
export function useCompanyBalances(companyIds) {
  const [balanceByCompanyId, setBalanceByCompanyId] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const key = companyIds.join(',')

  useEffect(() => {
    let ignore = false

    // Always resolved asynchronously (even the empty-list case) so every
    // setState call below happens inside a .then() callback, matching the
    // shape every other data hook in this app already uses.
    Promise.resolve()
      .then(() => {
        if (companyIds.length === 0) return []
        return Promise.all(
          companyIds.map((id) =>
            supabase
              .rpc('company_balance_rial', { p_company_id: id })
              .then(({ data, error }) => ({ id, balance: error ? null : Number(data) || 0 })),
          ),
        )
      })
      .then((results) => {
        if (ignore) return
        setBalanceByCompanyId(new Map(results.map((r) => [r.id, r.balance])))
        setLoading(false)
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { balanceByCompanyId, loading }
}
