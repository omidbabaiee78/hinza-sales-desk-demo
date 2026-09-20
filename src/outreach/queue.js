import { evaluateOutreachOpportunity } from './eligibility.js'
import { composeOutreachMessage, composeOutreachSubject } from './messageComposer.js'
import { mostRecentAttemptAt, countQualifyingAttempts } from './cooldown.js'

const LEAD_TASK_TYPES = new Set(['lead_first_contact', 'lead_followup_due', 'lead_followup_overdue'])
const QUEUEABLE_TASK_STATUSES = new Set(['ready', 'waiting_approval'])

export function isOutreachTaskType(taskType) {
  return LEAD_TASK_TYPES.has(taskType)
}

// Composes eligibility + channel selection + message drafting into one
// display-ready "outreach opportunity" per active lead task. Pure function -
// the hook (useOutreachHub.js) owns fetching everything this needs.
export function buildOutreachOpportunities({ tasks, leadsById, settings, attemptsByLeadId, duplicateRiskIds, now = new Date() }) {
  const opportunities = []

  for (const task of tasks) {
    if (!isOutreachTaskType(task.task_type)) continue
    if (!QUEUEABLE_TASK_STATUSES.has(task.status)) continue

    const lead = task.lead_id ? leadsById.get(task.lead_id) : null
    const leadAttempts = task.lead_id ? attemptsByLeadId.get(task.lead_id) || [] : []

    const evaluation = evaluateOutreachOpportunity({ lead, settings, leadAttempts, duplicateRiskIds, now })

    const productNames = (lead?.products || []).map((p) => p.name_fa).filter(Boolean)
    const message =
      evaluation.channel && lead ? composeOutreachMessage(task.task_type, { lead, productNames }) : null
    const subject =
      evaluation.channel === 'email' && lead ? composeOutreachSubject(task.task_type, { lead }) : null

    opportunities.push({
      taskId: task.id,
      task,
      lead,
      leadId: task.lead_id || null,
      companyName: lead?.company_name || task.context?.companyName || null,
      contactName: lead?.contact_name || task.context?.contactName || null,
      city: lead?.city || null,
      industry: lead?.industry || null,
      purpose: task.task_type,
      priority: task.priority,
      taskStatus: task.status,
      dueAt: task.due_at,
      reason: task.reason,
      outreachStatus: evaluation.outreachStatus,
      reasons: evaluation.reasons,
      channel: evaluation.channel,
      withinContactWindow: evaluation.withinContactWindow,
      nextAvailableAt: evaluation.nextAvailableAt,
      message,
      subject,
      productNames,
      attemptCount: countQualifyingAttempts(leadAttempts),
      lastOutreachAt: mostRecentAttemptAt(leadAttempts),
    })
  }

  return opportunities
}
