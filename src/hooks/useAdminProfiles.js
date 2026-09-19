import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Small, bulk-fetched-once list of admin profiles - backs the "assigned
// salesperson" dropdown/filter on the leads pages.
function fetchAdminProfiles() {
  return supabase.from('profiles').select('id, full_name').eq('role', 'admin').order('full_name', { ascending: true })
}

export function useAdminProfiles() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    fetchAdminProfiles().then(({ data }) => {
      if (ignore) return
      setAdmins(data || [])
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [])

  return { admins, loading }
}
