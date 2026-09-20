import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  approveTask,
  cancelTask,
  fetchActiveAndFailedTasks,
  fetchAutomationSettings,
  runReconciliationCycle,
  snoozeTask,
} from '../automation/taskService'
import { updateLead } from '../services/salesLeads'
import { fetchOutreachAttemptsForLeads, fetchRecentOutreachAttempts, logOutreachAttempt } from '../services/outreachAttempts'
import { useSalesLeads } from './useSalesLeads'
import { computeDuplicateRiskLeadIds } from '../utils/leadIntelligence'
import { buildOutreachOpportunities, isOutreachTaskType } from '../outreach/queue'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در دریافت اطلاعات مرکز ارتباط با مشتریان بالقوه. لطفاً دوباره تلاش کنید.'
}

// Orchestrates the Outreach Hub: reuses the existing automation task engine
// (fetchActiveAndFailedTasks / runReconciliationCycle - never a second task
// engine) and the existing leads hook, then layers the pure eligibility/
// channel/message logic (src/outreach/*) on top for display only.
export function useOutreachHub() {
  const { leads, loading: leadsLoading, error: leadsError, refresh: refreshLeads } = useSalesLeads()

  const [settings, setSettings] = useState(null)
  const [tasks, setTasks] = useState([])
  const [attempts, setAttempts] = useState([])
  const [historyAttempts, setHistoryAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [reconciling, setReconciling] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const leadsById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads])
  const duplicateRiskIds = useMemo(() => computeDuplicateRiskLeadIds(leads), [leads])

  const load = useCallback(async ({ withReconcile }) => {
    try {
      let settingsData
      let taskRows

      if (withReconcile) {
        setReconciling(true)
        const cycle = await runReconciliationCycle(supabase)
        settingsData = cycle.settings
        taskRows = await fetchActiveAndFailedTasks(supabase)
      } else {
        ;[settingsData, taskRows] = await Promise.all([fetchAutomationSettings(supabase), fetchActiveAndFailedTasks(supabase)])
      }

      const leadTaskRows = taskRows.filter((t) => isOutreachTaskType(t.task_type))
      const leadIds = [...new Set(leadTaskRows.map((t) => t.lead_id).filter(Boolean))]
      const [attemptRows, historyRows] = await Promise.all([
        fetchOutreachAttemptsForLeads(leadIds),
        fetchRecentOutreachAttempts(),
      ])

      setError('')
      setSettings(settingsData)
      setTasks(leadTaskRows)
      setAttempts(attemptRows)
      setHistoryAttempts(historyRows)
    } catch (err) {
      setError(translateDbError(err.message))
    } finally {
      setLoading(false)
      setReconciling(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => load({ withReconcile: true }))
  }, [load])

  const attemptsByLeadId = useMemo(() => {
    const map = new Map()
    for (const attempt of attempts) {
      if (!attempt.lead_id) continue
      const list = map.get(attempt.lead_id) || []
      list.push(attempt)
      map.set(attempt.lead_id, list)
    }
    return map
  }, [attempts])

  const opportunities = useMemo(
    () =>
      buildOutreachOpportunities({
        tasks,
        leadsById,
        settings: settings || {},
        attemptsByLeadId,
        duplicateRiskIds,
      }),
    [tasks, leadsById, settings, attemptsByLeadId, duplicateRiskIds],
  )

  async function refresh({ withReconcile = false } = {}) {
    setLoading(true)
    await load({ withReconcile })
    refreshLeads()
  }

  async function runAction(fn, ...args) {
    setActionError('')
    try {
      await fn(supabase, ...args)
      await load({ withReconcile: false })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  // Logs a real channel action (WhatsApp opened / SMS copied / email
  // opened) - audit only, never mutates the lead or the task. The task stays
  // active until an explicit "mark completed" or the lead's own state
  // changes, exactly like every other automation task.
  async function recordAttempt(opportunity, { channel, status, messageSnapshot, subjectSnapshot, failureReason }) {
    setActionError('')
    try {
      await logOutreachAttempt({
        leadId: opportunity.leadId,
        companyId: null,
        sourceTaskId: opportunity.taskId,
        channel,
        purpose: opportunity.purpose,
        messageSnapshot,
        subjectSnapshot,
        status,
        failureReason,
      })
      await load({ withReconcile: false })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  // "Mark completed" - called AFTER LeadActivityFormModal has already
  // written its own lead_activities entry (which stamps last_contact_at /
  // next_follow_up_at per the existing, unchanged business rule - never
  // duplicated here). This only adds the outreach_attempts audit row, then
  // reconciles so a now-satisfied task closes itself through the existing
  // deterministic rules - never a manual task-status override.
  async function recordCompletedAttempt(opportunity, { channel, messageSnapshot }) {
    setActionError('')
    try {
      await logOutreachAttempt({
        leadId: opportunity.leadId,
        companyId: null,
        sourceTaskId: opportunity.taskId,
        channel,
        purpose: opportunity.purpose,
        messageSnapshot: messageSnapshot || null,
        status: 'completed',
      })
      await refresh({ withReconcile: true })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  async function markDoNotContact(leadId) {
    setActionError('')
    try {
      await updateLead(leadId, { fields: { do_not_contact: true } })
      await refresh({ withReconcile: true })
    } catch (err) {
      setActionError(translateDbError(err.message))
    }
  }

  return {
    settings,
    opportunities,
    attempts,
    historyAttempts,
    loading: loading || leadsLoading,
    reconciling,
    error: error || leadsError,
    actionError,
    refresh,
    approve: (taskId) => runAction(approveTask, taskId),
    snooze: (taskId, availableAtIso) => runAction(snoozeTask, taskId, availableAtIso),
    dismiss: (taskId, reason) => runAction(cancelTask, taskId, reason),
    recordAttempt,
    recordCompletedAttempt,
    markDoNotContact,
  }
}
