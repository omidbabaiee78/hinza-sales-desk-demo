import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { crmPayload } from '../crm/simpleCrm'

async function must(promise) {
  const { data, error } = await promise
  if (error) throw error
  return data
}

const RECORD_FIELDS = '*, lead:sales_leads(id, company_name)'

// crm_records only. Leads are read (to link / prefill) and never written.
export function useSimpleCrm() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setRecords(await must(supabase.from('crm_records').select(RECORD_FIELDS).order('updated_at', { ascending: false })))
      setError('')
    } catch {
      setError('بارگذاری CRM انجام نشد. «به‌روزرسانی» را بزنید.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  async function create(form, linkedLeadId) {
    const row = await must(
      supabase
        .from('crm_records')
        .insert({ ...crmPayload(form), linked_lead_id: linkedLeadId || null })
        .select(RECORD_FIELDS)
        .single(),
    )
    await load()
    return row
  }

  async function update(id, form) {
    const row = await must(supabase.from('crm_records').update(crmPayload(form)).eq('id', id).select(RECORD_FIELDS).single())
    await load()
    return row
  }

  return { records, loading, error, refresh: load, create, update }
}

export async function searchLeadsForCrm(query) {
  const q = query.replace(/[%_,()]/g, ' ').trim()
  if (q.length < 2) return []
  return must(
    supabase
      .from('sales_leads')
      .select('id, company_name, contact_name, city')
      .or(`company_name.ilike.%${q}%,contact_name.ilike.%${q}%`)
      .order('company_name')
      .limit(10),
  )
}

// Lead fields to prefill with, whether it was ticked in Daily Manual
// Outreach or emailed (for the source), and its existing CRM record if any.
export async function loadLeadForCrm(leadId) {
  const [lead, manual, emailed, existing] = await Promise.all([
    must(supabase.from('sales_leads').select('id, company_name, contact_name, mobile, phone, email, city, province').eq('id', leadId).single()),
    must(supabase.from('manual_outreach_contacts').select('id').eq('lead_id', leadId).eq('status', 'contacted')),
    must(supabase.from('email_outreach_recipients').select('id').eq('lead_id', leadId).in('status', ['sent', 'uncertain'])),
    must(supabase.from('crm_records').select('id, company_name').eq('linked_lead_id', leadId).maybeSingle()),
  ])
  return { lead, manualContacted: manual.length > 0, emailed: emailed.length > 0, existing }
}
