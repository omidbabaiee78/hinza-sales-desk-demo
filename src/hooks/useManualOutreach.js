import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { applyContacted, bestCandidateByLead, splitManualRows } from '../outreach/manualOutreach'

async function must(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

const LEAD_FIELDS = 'id, company_name, contact_name, city, province, industry, status, need_note'
const CANDIDATE_FIELDS = 'promoted_lead_id, overall_score, relevance_score, qualification_reason, business_description, industry_guess'

// Today's manual list. prepare_manual_outreach_day() (admin-only RPC)
// builds/refreshes today's rows on the server, then they are read back.
// Ticking goes through set_manual_outreach_contacted(); the UI updates at
// once and reverts if the server refuses.
export function useManualOutreach() {
  const [day, setDay] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(() => new Set())

  const load = useCallback(async () => {
    try {
      const summary = await must(supabase.rpc('prepare_manual_outreach_day'))
      const list = await must(
        supabase
          .from('manual_outreach_contacts')
          .select(`id, lead_id, assigned_on, phone, phone_kind, status, contacted_at, lead:sales_leads(${LEAD_FIELDS})`)
          .eq('assigned_on', summary.day)
          .order('created_at', { ascending: true }),
      )
      const leadIds = list.map((r) => r.lead_id)
      const candidates = leadIds.length
        ? await must(supabase.from('prospect_candidates').select(CANDIDATE_FIELDS).in('promoted_lead_id', leadIds))
        : []
      const best = bestCandidateByLead(candidates)
      setRows(list.map((r) => ({ ...r, candidate: best.get(r.lead_id) || null })))
      setDay(summary.day)
      setError('')
    } catch {
      setError('بارگذاری فهرست تماس امروز انجام نشد. «به‌روزرسانی» را بزنید.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  const split = useMemo(() => splitManualRows(rows), [rows])

  async function setContacted(id, contacted) {
    const before = rows
    setRows((current) => applyContacted(current, id, contacted))
    setSaving((s) => new Set(s).add(id))
    try {
      const row = await must(supabase.rpc('set_manual_outreach_contacted', { p_id: id, p_contacted: contacted }))
      setRows((current) => current.map((r) => (r.id === id ? { ...r, status: row.status, contacted_at: row.contacted_at } : r)))
      setError('')
    } catch {
      setRows(before)
      setError('ثبت وضعیت انجام نشد. دوباره امتحان کنید.')
    } finally {
      setSaving((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    }
  }

  return { day, ...split, loading, error, saving, refresh: load, setContacted }
}
