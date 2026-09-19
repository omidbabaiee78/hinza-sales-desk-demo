import ErrorBanner from '../../common/ErrorBanner'

const MODE_LABELS = { standard: 'جدول استاندارد', smart: 'نیمه‌ساختاریافته (هوشمند)' }

function rowPreviewText(row) {
  return (row || [])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
    .join(' | ')
}

// Shown after every file load, before any field is read as real data. Lets
// the admin confirm the auto-detected mode, pick a worksheet, and skip
// leading title/explanatory rows - the fallback controls the spec asks for
// when smart mode can't confidently reconstruct anything live right here.
export default function LeadImportStructureStep({
  workbook,
  activeSheetIndex,
  onSetActiveSheet,
  startRow,
  onSetStartRow,
  fullGridRows,
  mode,
  onSetMode,
  detection,
  smartPreview,
  previewError,
  buildingPreview,
  onBack,
  onContinue,
}) {
  const hasMultipleSheets = workbook.sheets.length > 1
  const smartRecordCount = smartPreview?.records.length || 0
  const smartIgnoredCount = smartPreview?.ignoredRows.length || 0
  const smartCouldNotReconstruct = mode === 'smart' && fullGridRows.length > 0 && smartRecordCount === 0
  const canContinue = mode === 'standard' || smartRecordCount > 0

  return (
    <div className="import-structure-step">
      {hasMultipleSheets && (
        <label>
          کاربرگ (Sheet)
          <select value={activeSheetIndex} onChange={(e) => onSetActiveSheet(Number(e.target.value))}>
            {workbook.sheets.map((sheet, index) => (
              <option key={sheet.name + index} value={index}>
                {sheet.name} ({sheet.bodyRows.length} ردیف)
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        شروع از سطر (برای رد کردن عنوان یا ردیف‌های توضیحی ابتدای فایل)
        <input
          type="number"
          min={0}
          value={startRow}
          onChange={(e) => onSetStartRow(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>

      <div className="import-mode-switch">
        <span className="import-mode-switch-label">حالت پردازش:</span>
        <button
          type="button"
          className={`lead-segment-chip${mode === 'standard' ? ' active' : ''}`}
          onClick={() => onSetMode('standard')}
        >
          {MODE_LABELS.standard}
        </button>
        <button
          type="button"
          className={`lead-segment-chip${mode === 'smart' ? ' active' : ''}`}
          onClick={() => onSetMode('smart')}
        >
          {MODE_LABELS.smart}
        </button>
        <span className="import-mode-auto-note">
          (تشخیص خودکار: {MODE_LABELS[detection.mode]} - در هر زمان قابل تغییر دستی)
        </span>
      </div>

      {mode === 'smart' && (
        <p className="profile-empty">
          در این حالت، به جای ستون‌های ثابت، برچسب‌ها یا الگوی تکرارشونده هر ردیف شناسایی و سرنخ‌های مربوطه
          بازسازی می‌شود. {smartRecordCount} سرنخ به‌صورت آزمایشی شناسایی شد
          {smartIgnoredCount > 0 && ` (${smartIgnoredCount} ردیف عنوان/سربرگ نادیده گرفته شد)`}.
        </p>
      )}

      {smartCouldNotReconstruct && (
        <div className="modal-warning">
          <p>ساختار فایل به‌صورت خودکار تشخیص داده نشد.</p>
          <p className="lead-form-hint">
            می‌توانید سطر شروع را تغییر دهید، کاربرگ دیگری انتخاب کنید، یا به حالت «جدول استاندارد» بروید و
            ستون‌ها را دستی تطبیق دهید.
          </p>
        </div>
      )}

      <div className="table-wrapper import-preview-table import-structure-preview">
        <table>
          <thead>
            <tr>
              <th>سطر</th>
              <th>محتوا</th>
            </tr>
          </thead>
          <tbody>
            {fullGridRows.slice(0, 10).map((row, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td className="cell-notes">{rowPreviewText(row) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ErrorBanner message={previewError} onRetry={onContinue} />

      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onBack} disabled={buildingPreview}>
          انتخاب فایل دیگر
        </button>
        <button type="button" className="btn-primary" disabled={!canContinue || buildingPreview} onClick={onContinue}>
          {buildingPreview
            ? 'در حال آماده‌سازی پیش‌نمایش...'
            : mode === 'standard'
              ? 'ادامه به تطبیق ستون‌ها'
              : 'ادامه به پیش‌نمایش'}
        </button>
      </div>
    </div>
  )
}
