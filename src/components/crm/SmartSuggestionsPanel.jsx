import { useMemo } from 'react'
import { useSmartSuggestions } from '../../hooks/useSmartSuggestions'
import { snoozeSignature } from '../../utils/crmRules'
import ErrorBanner from '../common/ErrorBanner'
import SmartSuggestionCard from './SmartSuggestionCard'
import './Crm.css'

const FINANCIAL_REASONS = new Set(['invoice_due_soon', 'invoice_overdue'])
const ACTIONABLE_STATUSES = new Set(['pending', 'approved', 'edited'])

export default function SmartSuggestionsPanel({ onOpenCustomer }) {
  const {
    rows,
    companiesById,
    contactsByCompany,
    activeSnoozeSignatures,
    loading,
    refreshing,
    error,
    actionError,
    refresh,
    approve,
    edit,
    dismiss,
    whatsapp,
    call,
  } = useSmartSuggestions()

  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => ACTIONABLE_STATUSES.has(row.status))
      .filter((row) => !activeSnoozeSignatures.has(snoozeSignature(row.reason_key, row.order_id, row.invoice_id)))
      .sort((a, b) => a.priority - b.priority)
  }, [rows, activeSnoozeSignatures])

  const summary = useMemo(
    () => ({
      needsReview: visibleRows.filter((r) => r.confidence === 'manual_review').length,
      highPriority: visibleRows.filter((r) => r.priority <= 30).length,
      financial: visibleRows.filter((r) => FINANCIAL_REASONS.has(r.reason_key)).length,
      order: visibleRows.filter((r) => !FINANCIAL_REASONS.has(r.reason_key)).length,
    }),
    [visibleRows],
  )

  return (
    <div className="smart-suggestions-panel">
      <div className="page-toolbar">
        <h3 style={{ margin: 0 }}>پیشنهادهای هوشمند</h3>
        <button type="button" className="btn-secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'در حال به‌روزرسانی...' : 'به‌روزرسانی پیشنهادها'}
        </button>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />
      <ErrorBanner message={actionError} />

      <div className="suggestion-summary-grid">
        <div className="suggestion-summary-item tone-danger">
          <span className="suggestion-summary-count">{summary.needsReview}</span>
          <span>نیازمند بررسی</span>
        </div>
        <div className="suggestion-summary-item tone-warning">
          <span className="suggestion-summary-count">{summary.highPriority}</span>
          <span>اولویت بالا</span>
        </div>
        <div className="suggestion-summary-item">
          <span className="suggestion-summary-count">{summary.financial}</span>
          <span>مالی</span>
        </div>
        <div className="suggestion-summary-item">
          <span className="suggestion-summary-count">{summary.order}</span>
          <span>سفارش</span>
        </div>
      </div>

      {loading && <p className="profile-empty">در حال ارزیابی وضعیت مشتریان...</p>}

      {!loading && visibleRows.length === 0 && (
        <p className="profile-empty">فعلاً پیشنهاد فعالی وجود ندارد.</p>
      )}

      {!loading && visibleRows.length > 0 && (
        <div className="suggestion-list">
          {visibleRows.map((row) => (
            <SmartSuggestionCard
              key={row.id}
              suggestion={row}
              companyName={companiesById.get(row.company_id)?.name || 'مشتری نامشخص'}
              contactName={contactsByCompany.get(row.company_id)?.name || null}
              onApprove={approve}
              onEdit={edit}
              onWhatsapp={whatsapp}
              onCall={call}
              onDismiss={dismiss}
              onSnoozed={refresh}
              onOpenCustomer={onOpenCustomer}
            />
          ))}
        </div>
      )}
    </div>
  )
}
