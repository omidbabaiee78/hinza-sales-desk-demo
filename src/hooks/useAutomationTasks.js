import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  approveTask,
  cancelTask,
  fetchActiveAndFailedTasks,
  fetchAutomationRules,
  fetchAutomationSettings,
  fetchTaskHistory,
  retryTask,
  runReconciliationCycle,
  setAutomationEnabled,
  setRuleAutonomyMode,
  setRuleEnabled,
  snoozeTask,
} from '../automation/taskService'

function translateDbError(message) {
  if (!message) return 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'
  if (message.includes('Failed to fetch') || message.includes('network')) {
    return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.'
  }
  return 'خطا در پردازش موتور اتوماسیون. لطفاً دوباره تلاش کنید.'
}

// Orchestrates the Automation page: loads settings/rules/tasks, optionally
// runs a full reconciliation cycle, and exposes small, explicit admin
// actions. This is the manual/browser trigger for reconciliation - the same
// cycle also runs on a schedule server-side (supabase/functions/automation-
// reconcile), both calling automation/taskService.runReconciliationCycle()
// directly so there is exactly one reconciliation code path, never a
// browser copy and a server copy.
export function useAutomationTasks() {
  const [settings, setSettings] = useState(null)
  const [rules, setRules] = useState([])
  const [activeTasks, setActiveTasks] = useState([])
  const [historyTasks, setHistoryTasks] = useState([])
  const [companiesById, setCompaniesById] = useState(new Map())
  const [leadsById, setLeadsById] = useState(new Map())
  const [ordersById, setOrdersById] = useState(new Map())
  const [invoicesById, setInvoicesById] = useState(new Map())
  const [suggestionsById, setSuggestionsById] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [reconciling, setReconciling] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [lastReconcileSummary, setLastReconcileSummary] = useState(null)

  const load = useCallback(async ({ withReconcile }) => {
    try {
      let settingsData
      let rulesData
      let tasks

      if (withReconcile) {
        setReconciling(true)
        // Business-data names (company/lead) are only ever needed for tasks
        // that exist - and a task only ever gets created DURING
        // reconciliation, so this snapshot always covers every task the
        // admin can currently see, first load or not.
        const cycle = await runReconciliationCycle(supabase)
        settingsData = cycle.settings
        rulesData = cycle.rules
        setLastReconcileSummary(cycle.summary)
        setCompaniesById(cycle.snapshot.companiesById)
        setLeadsById(cycle.snapshot.leadsById)
        setOrdersById(cycle.snapshot.ordersById)
        setInvoicesById(cycle.snapshot.invoicesById)
        setSuggestionsById(cycle.snapshot.suggestionsById)
        tasks = await fetchActiveAndFailedTasks(supabase)
      } else {
        ;[settingsData, rulesData, tasks] = await Promise.all([
          fetchAutomationSettings(supabase),
          fetchAutomationRules(supabase),
          fetchActiveAndFailedTasks(supabase),
        ])
      }

      const history = await fetchTaskHistory(supabase)
      setError('')
      setSettings(settingsData)
      setRules(rulesData)
      setActiveTasks(tasks)
      setHistoryTasks(history)
    } catch (err) {
      setError(translateDbError(err.message))
    } finally {
      setLoading(false)
      setReconciling(false)
    }
  }, [])

  useEffect(() => {
    // "Also reconcile safely when Admin Automation page opens." Deferred to
    // a microtask so state updates inside load() happen in a callback, not
    // synchronously in the effect body itself.
    Promise.resolve().then(() => load({ withReconcile: true }))
  }, [load])

  async function reconcile() {
    setLoading(true)
    await load({ withReconcile: true })
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

  return {
    settings,
    rules,
    activeTasks,
    historyTasks,
    companiesById,
    leadsById,
    ordersById,
    invoicesById,
    suggestionsById,
    loading,
    reconciling,
    error,
    actionError,
    lastReconcileSummary,
    reconcile,
    approve: (taskId) => runAction(approveTask, taskId),
    cancel: (taskId, reason) => runAction(cancelTask, taskId, reason),
    snooze: (taskId, availableAtIso) => runAction(snoozeTask, taskId, availableAtIso),
    retry: (taskId) => runAction(retryTask, taskId),
    toggleGlobal: (enabled) => runAction(setAutomationEnabled, enabled),
    updateRuleEnabled: (taskType, enabled) => runAction(setRuleEnabled, taskType, enabled),
    updateRuleAutonomyMode: (taskType, mode) => runAction(setRuleAutonomyMode, taskType, mode),
  }
}
