import { useRef, useState } from 'react'
import { useProductImport } from '../../hooks/useProductImport'
import { summarizeClassification } from '../../utils/productImport/classifyRows'
import { downloadProductImportTemplate } from '../../utils/productImport/templateCsv'
import { availabilityLabel } from '../../constants/productAvailability'
import ErrorBanner from '../common/ErrorBanner'
import '../common/Modal.css'
import './ProductImportModal.css'

const STATUS_LABELS = { new: 'جدید', update: 'بروزرسانی', error: 'خطا' }
const STATUS_TONE = { new: 'success', update: 'warning', error: 'danger' }

// A five-step wizard (select -> parsing -> preview -> confirm -> importing
// -> result), all in one component since each step only shows the previous
// step's output - never a separate page/route.
export default function ProductImportModal({ onClose, onImported }) {
  const fileInputRef = useRef(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { rows, parsing, parseError, importing, progress, result, loadFile, runImport, reset } =
    useProductImport()

  const summary = summarizeClassification(rows)
  const hasPreview = rows.length > 0 && !result
  const canImport = summary.newCount + summary.updateCount > 0

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) loadFile(file)
  }

  function handleStartOver() {
    reset()
    setConfirmOpen(false)
  }

  async function handleConfirmImport() {
    setConfirmOpen(false)
    await runImport()
  }

  function handleFinish() {
    onImported()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={result || importing ? undefined : onClose}>
      <div
        className="modal-panel modal-panel-wide product-import-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>ورود گروهی محصولات</h2>

        {!hasPreview && !parsing && !result && (
          <div className="import-select-step">
            <p className="profile-empty">
              یک فایل Excel (.xlsx) یا CSV حاوی محصولات انتخاب کنید. ابتدا پیش‌نمایش و اعتبارسنجی نمایش
              داده می‌شود و هیچ داده‌ای بدون تأیید شما ثبت نمی‌شود.
            </p>
            <p className="import-note">
              عکس محصولات پس از ورود گروهی از بخش ویرایش محصول قابل افزودن است.
            </p>
            <ErrorBanner message={parseError} />
            <div className="import-select-actions">
              <button type="button" className="btn-secondary" onClick={downloadProductImportTemplate}>
                دانلود نمونه فایل
              </button>
              <div className="import-select-actions-left">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  انصراف
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  انتخاب فایل
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              hidden
              onChange={handleFileChange}
            />
          </div>
        )}

        {parsing && <p className="profile-empty">در حال خواندن و بررسی فایل...</p>}

        {hasPreview && !importing && (
          <div className="import-preview-step">
            <div className="import-summary">
              <div className="import-summary-item tone-success">
                <span className="import-summary-count">{summary.newCount}</span>
                <span>محصول جدید</span>
              </div>
              <div className="import-summary-item tone-warning">
                <span className="import-summary-count">{summary.updateCount}</span>
                <span>بروزرسانی</span>
              </div>
              <div className="import-summary-item tone-danger">
                <span className="import-summary-count">{summary.errorCount}</span>
                <span>خطا</span>
              </div>
              <div className="import-summary-item">
                <span className="import-summary-count">{summary.total}</span>
                <span>کل ردیف‌ها</span>
              </div>
            </div>

            <div className="table-wrapper import-preview-table">
              <table>
                <thead>
                  <tr>
                    <th>ردیف</th>
                    <th>کد</th>
                    <th>نام محصول</th>
                    <th>دسته‌بندی</th>
                    <th>پایه</th>
                    <th>وضعیت</th>
                    <th>نوع عملیات</th>
                    <th>خطا</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td dir="ltr" style={{ textAlign: 'right' }}>
                        {row.code}
                      </td>
                      <td>{row.name_fa}</td>
                      <td>{row.category || '—'}</td>
                      <td>{row.polymer_base || '—'}</td>
                      <td>{row.availability ? availabilityLabel(row.availability) : '—'}</td>
                      <td>
                        <span className={`import-status-badge tone-${STATUS_TONE[row.status]}`}>
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="cell-notes" title={row.errors.join(' / ')}>
                        {row.errors.join(' / ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!confirmOpen ? (
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={handleStartOver}>
                  انتخاب فایل دیگر
                </button>
                <button type="button" className="btn-secondary" onClick={onClose}>
                  انصراف
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canImport}
                  onClick={() => setConfirmOpen(true)}
                >
                  تأیید و ثبت
                </button>
              </div>
            ) : (
              <div className="import-confirm-box">
                <p>آیا از ورود این محصولات مطمئن هستید؟</p>
                <ul>
                  <li>{summary.newCount} محصول جدید</li>
                  <li>{summary.updateCount} محصول بروزرسانی می‌شود</li>
                  <li>{summary.errorCount} ردیف دارای خطا و وارد نمی‌شود</li>
                </ul>
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)}>
                    انصراف
                  </button>
                  <button type="button" className="btn-primary" onClick={handleConfirmImport}>
                    تأیید و ثبت
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {importing && (
          <div className="import-progress-step">
            <p>
              در حال ثبت {progress.done} از {progress.total} محصول...
            </p>
            <div className="import-progress-bar">
              <div
                className="import-progress-bar-fill"
                style={{
                  width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%',
                }}
              />
            </div>
          </div>
        )}

        {result && (
          <div className="import-result-step">
            <div className="import-summary">
              <div className="import-summary-item tone-success">
                <span className="import-summary-count">{result.insertedCount}</span>
                <span>ثبت شد</span>
              </div>
              <div className="import-summary-item tone-warning">
                <span className="import-summary-count">{result.updatedCount}</span>
                <span>بروزرسانی شد</span>
              </div>
              <div className="import-summary-item tone-danger">
                <span className="import-summary-count">
                  {result.failures.length + summary.errorCount}
                </span>
                <span>رد شد</span>
              </div>
            </div>

            {(result.failures.length > 0 || summary.errorCount > 0) && (
              <div className="table-wrapper import-preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>ردیف</th>
                      <th>کد</th>
                      <th>دلیل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failures.map((f) => (
                      <tr key={`f-${f.rowNumber}`}>
                        <td>{f.rowNumber}</td>
                        <td dir="ltr" style={{ textAlign: 'right' }}>
                          {f.code}
                        </td>
                        <td>{f.reason}</td>
                      </tr>
                    ))}
                    {rows
                      .filter((r) => r.status === 'error')
                      .map((r) => (
                        <tr key={`e-${r.rowNumber}`}>
                          <td>{r.rowNumber}</td>
                          <td dir="ltr" style={{ textAlign: 'right' }}>
                            {r.code}
                          </td>
                          <td>{r.errors.join(' / ')}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={handleFinish}>
                بازگشت به محصولات
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
