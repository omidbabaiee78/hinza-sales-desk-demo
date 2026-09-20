import { supabase } from '../lib/supabaseClient'

// I/O layer for outreach_attempts - the audit trail of real admin actions
// taken from the Outreach Hub. Mirrors the existing crmCommunications.js /
// automation/taskEvents.js style: plain async functions, no React state,
// callers own busy/error handling. Never called automatically by
// reconciliation - only by an explicit admin action (WhatsApp opened, SMS
// copied, phone call completed, email opened).

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function fetchOutreachAttemptsForLeads(leadIds) {
  if (!leadIds || leadIds.length === 0) return []
  const { data, error } = await supabase
    .from('outreach_attempts')
    .select('*')
    .in('lead_id', leadIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

const HISTORY_LIMIT = 60

// Broader than fetchOutreachAttemptsForLeads (which is scoped to today's
// active-task leads for cooldown math) - this is the Outreach Hub's
// "history" tab, so it also covers leads whose task has since closed.
export async function fetchRecentOutreachAttempts() {
  const { data, error } = await supabase
    .from('outreach_attempts')
    .select('*, sales_leads(company_name, contact_name)')
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (error) throw error
  return data || []
}

export async function fetchOutreachAttemptsForLead(leadId) {
  const { data, error } = await supabase
    .from('outreach_attempts')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// channel: 'whatsapp' | 'phone' | 'sms' | 'email'
// status: 'opened' | 'copied' | 'completed' | 'failed' | 'cancelled'
// purpose: the source automation task's task_type (lead_first_contact/
// lead_followup_due/lead_followup_overdue) - never invented, always the
// exact reason this outreach exists.
export async function logOutreachAttempt({
  leadId,
  companyId,
  sourceTaskId,
  channel,
  purpose,
  messageSnapshot,
  subjectSnapshot,
  status,
  failureReason,
}) {
  const createdBy = await currentUserId()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('outreach_attempts')
    .insert({
      lead_id: leadId || null,
      company_id: companyId || null,
      source_task_id: sourceTaskId || null,
      channel,
      purpose,
      message_snapshot: messageSnapshot || null,
      subject_snapshot: subjectSnapshot || null,
      execution_mode: 'manual',
      status,
      failure_reason: failureReason || null,
      opened_at: status === 'opened' || status === 'completed' ? nowIso : null,
      acted_at: status === 'completed' ? nowIso : null,
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}
