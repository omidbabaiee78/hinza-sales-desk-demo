import { useState } from 'react'
import {
  CLASSIFICATION_LABELS,
  ROW_ACTIONS,
  ROW_ACTION_LABELS,
  summarizeLeadImportRows,
} from '../../../utils/leadImport/duplicateEngine'
import { CONFIDENCE_LABELS, CONTACT_QUALITY_LABELS } from '../../../utils/leadImport/smartParse'
import ErrorBanner from '../../common/ErrorBanner'

const CLASSIFICATION_TONE = {
  new: 'success',
  duplicate_lead: 'warning',
  possible_duplicate: 'warning',
  existing_customer: 'info',
  needs_review: 'warning',
  error: 'danger',
}

const CONFIDENCE_TONE = { high: 'success', medium: 'warning', needs_review: 'danger' }
const CONTACT_QUALITY_TONE = { complete: 'success', limited: 'warning', incomplete: 'danger' }

const SUMMARY_ORDER = ['new', 'duplicate_lead', 'possible_duplicate', 'existing_customer', 'needs_review', 'error']

export default function LeadImportPreviewStep({
  rows,
  ignoredRows,
  onSetRowAction,
  onBack,
  backLabel,
  suggestedSourceLabel,
  importError,
  importing,
  onConfirm,
}) {
  const [sourceLabel, setSourceLabel] = useState(suggestedSourceLabel || '')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const showConfidence = rows.some((r) => r.confidence)

  const summary = summarizeLeadImportRows(rows)
  const actionable = rows.filter((r) => r.action !== ROW_ACTIONS.SKIP && r.classification !== 'error')
  const canImport = actionable.length > 0

  return (
    <div className="import-preview-step">
      <div className="import-summary">
        <div className="import-summary-item">
          <span className="import-summary-count">{summary.total}</span>
          <span>کل ردیف‌ها</span>
        </div>
        {SUMMARY_ORDER.map((key) => (
          <div key={key} className={`import-summary-item tone-${CLASSIFICATION_TONE[key]}`}>
            <span className="import-summary-count">{summary[key]}</span>
            <span>{CLASSIFICATION_LABELS[key]}</span>
          </div>
        ))}
        {ignoredRows?.length > 0 && (
          <div className="import-summary-item">
            <span className="import-summary-count">{ignoredRows.length}</span>
            <span>نادیده گرفته‌شده</span>
          </div>
        )}
      </div>

      {ignoredRows?.length > 0 && (
        <p className="profile-empty">
          {ignoredRows.length} ردیف (عنوان/توضیح/سربرگ جدول) به‌عنوان سرنخ در نظر گرفته نشد و در ورود گروهی شرکت
          نمی‌کند.
        </p>
      )}

      <div className="table-wrapper import-preview-table">
        <table>
          <thead>
            <tr>
              <th>ردیف</th>
              <th>شرکت</th>
              <th>شخص تماس</th>
              <th>موبایل</th>
              <th>تلفن</th>
              <th>شهر</th>
              <th>محصول / نیاز</th>
              <th>وضعیت تشخیص</th>
              <th>کیفیت تماس</th>
              {showConfidence && <th>اطمینان تشخیص</th>}
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>{row.fields.company_name || '—'}</td>
                <td>{row.fields.contact_name || '—'}</td>
                <td dir="ltr" style={{ textAlign: 'right' }} className="cell-notes" title={row.fields.mobile || ''}>
                  {row.fields.mobile || '—'}
                </td>
                <td dir="ltr" style={{ textAlign: 'right' }} className="cell-notes" title={row.fields.phone || ''}>
                  {row.fields.phone || '—'}
                </td>
                <td>{row.fields.city || '—'}</td>
                <td className="cell-notes" title={row.fields.need_note || ''}>
                  {row.fields.need_note || '—'}
                </td>
                <td>
                  <span className={`import-status-badge tone-${CLASSIFICATION_TONE[row.classification]}`}>
                    {CLASSIFICATION_LABELS[row.classification]}
                  </span>
                  {row.matchLabel && <div className="import-row-note">{row.matchLabel}</div>}
                  {row.errors.length > 0 && <div className="import-row-note">{row.errors.join(' / ')}</div>}
                  {row.confidence === 'needs_review' && row.rawExcerpt && (
                    <div className="import-row-note" title={row.rawExcerpt}>
                      متن اصلی: {row.rawExcerpt.length > 60 ? `${row.rawExcerpt.slice(0, 60)}...` : row.rawExcerpt}
                    </div>
                  )}
                </td>
                <td>
                  {row.contactQuality && (
                    <span className={`import-status-badge tone-${CONTACT_QUALITY_TONE[row.contactQuality]}`}>
                      {CONTACT_QUALITY_LABELS[row.contactQuality]}
                    </span>
                  )}
                </td>
                {showConfidence && (
                  <td>
                    {row.confidence && (
                      <span
                        className={`import-status-badge tone-${CONFIDENCE_TONE[row.confidence]}`}
                        title={row.rawExcerpt || ''}
                      >
                        {CONFIDENCE_LABELS[row.confidence]}
                      </span>
                    )}
                  </td>
                )}
                <td>
                  {row.classification === 'error' ? (
                    '—'
                  ) : (
                    <select value={row.action} onChange={(e) => onSetRowAction(row.rowNumber, e.target.value)}>
                      {row.availableActions.map((action) => (
                        <option key={action} value={action}>
                          {ROW_ACTION_LABELS[action]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ErrorBanner message={importError} />

      {!confirmOpen ? (
        <>
          <label>
            برچسب منبع (اختیاری - مثال: نمایشگاه پلاستیک ۱۴۰۴)
            <input type="text" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onBack} disabled={importing}>
              {backLabel || 'بازگشت'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!canImport || importing}
              onClick={() => setConfirmOpen(true)}
            >
              تأیید و ورود گروهی
            </button>
          </div>
        </>
      ) : (
        <div className="import-confirm-box">
          <p>آیا از ورود گروهی این فایل مطمئن هستید؟</p>
          <ul>
            <li>{rows.filter((r) => r.action === ROW_ACTIONS.CREATE).length} سرنخ جدید ثبت می‌شود</li>
            <li>{rows.filter((r) => r.action === ROW_ACTIONS.UPDATE).length} سرنخ موجود بروزرسانی می‌شود</li>
            <li>{rows.filter((r) => r.action === ROW_ACTIONS.SKIP).length} ردیف رد می‌شود</li>
            <li>{summary.error} ردیف دارای خطا و وارد نمی‌شود</li>
            {ignoredRows?.length > 0 && <li>{ignoredRows.length} ردیف (عنوان/سربرگ) نادیده گرفته شد</li>}
          </ul>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={importing}>
              انصراف
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={importing}
              onClick={() => onConfirm(sourceLabel.trim())}
            >
              {importing ? 'در حال ارسال...' : 'تأیید و ورود گروهی'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
