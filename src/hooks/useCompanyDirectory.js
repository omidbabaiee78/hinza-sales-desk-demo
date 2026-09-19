import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Lean, bulk-fetched-once directory used by lead duplicate-detection and the
// "convert to customer" existing-company search - never a per-keystroke query.
function fetchCompanies() {
  return supabase.from('companies').select('id, name, phone, city, province').order('name', { ascending: true })
}

export function useCompanyDirectory() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    fetchCompanies().then(({ data }) => {
      if (ignore) return
      setCompanies(data || [])
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [])

  return { companies, loading }
}
