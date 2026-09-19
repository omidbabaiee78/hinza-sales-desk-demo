import { useCallback, useEffect, useState } from 'react'
import { computeReconciliationPlan } from '../automation/reconciler'
import {
  applyReconciliationPlan,
  approveTask,
  cancelTask,
  fetchActiveAndFailedTasks,
  fetchAutomationRules,
  fetchAutomationSettings,
  fetchAutomationSnapshot,
  fetchTaskHistory,
  retryTask,
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
// runs a full reconciliation cycle (fetch business data -> compute plan ->
// apply it), and exposes small, explicit admin actions. This is the ONLY
// place that triggers reconciliation from the frontend - a temporary
// execution path (page-open + manual button) until a real scheduler exists
// server-side; the reconciler itself (automation/reconciler.js) has no
// knowledge of how/when it's invoked, so moving it server-side later needs
// no rule changes.
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
      const settingsData = await fetchAutomationSettings()
      const rulesData = await fetchAutomationRules()
      // automation_rules rows are identified by `rule_key`, not `task_type`
      // (that column only exists on automation_tasks) - its value is the
      // same task_type string, just under a different column name.
      const rulesByType = new Map(rulesData.map((r) => [r.rule_key, r]))
      let tasks = await fetchActiveAndFailedTasks()

      if (withReconcile) {
        setReconciling(true)
        // Business-data names (company/lead) are only ever needed for tasks
        // that exist - and a task only ever gets created DURING
        // reconciliation, so this snapshot always covers every task the
        // admin can currently see, first load or not.
        const snapshot = await fetchAutomationSnapshot(tasks)
        const plan = computeReconciliationPlan({
          settings: settingsData,
          rulesByType,
          existingTasks: tasks,
          businessData: snapshot,
          now: new Date(),
        })
        const summary = await applyReconciliationPlan(plan)
        setLastReconcileSummary(summary)
        tasks = await fetchActiveAndFailedTasks()
        setCompaniesById(snapshot.companiesById)
        setLeadsById(snapshot.leadsById)
        setOrdersById(snapshot.ordersById)
        setInvoicesById(snapshot.invoicesById)
        setSuggestionsById(snapshot.suggestionsById)
      }

      const history = await fetchTaskHistory()
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
      await fn(...args)
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
