import { useRef } from 'react'
import { useLeadImport } from '../../../hooks/useLeadImport'
import { downloadLeadImportTemplate } from '../../../utils/leadImport/templateCsv'
import ErrorBanner from '../../common/ErrorBanner'
import LeadImportStructureStep from './LeadImportStructureStep'
import LeadImportMappingStep from './LeadImportMappingStep'
import LeadImportPreviewStep from './LeadImportPreviewStep'
import LeadImportResultStep from './LeadImportResultStep'
import '../../common/Modal.css'
import '../ProductImportModal.css'
import './Leads.css'

// The full wizard from the spec: انتخاب فایل -> خواندن فایل -> تشخیص ساختار
// (جدول استاندارد یا نیمه‌ساختاریافته) -> [تشخیص/تطبیق ستون‌ها در حالت
// استاندارد] -> پیش‌نمایش (با تشخیص تکراری‌ها) -> تأیید -> ورود گروهی ->
// گزارش نهایی. Nothing is ever written before the explicit "تأیید و ورود
// گروهی" confirmation in the preview step.
export default function LeadImportModal({ onClose, onImported }) {
  const fileInputRef = useRef(null)
  const {
    step,
    parseError,
    workbook,
    activeSheetIndex,
    setActiveSheetIndex,
    startRow,
    setStartRow,
    mode,
    setMode,
    detection,
    smartPreview,
    fullGridRows,
    effectiveGrid,
    mapping,
    rows,
    ignoredRows,
    suggestedSourceLabel,
    progress,
    result,
    previewError,
    buildingPreview,
    importError,
    importing,
    loadFile,
    setColumnMapping,
    continueFromStructure,
    buildPreview,
    setRowAction,
    confirmImport,
    reset,
    goToStructure,
    goToMapping,
  } = useLeadImport()

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) loadFile(file)
  }

  function handleFinish() {
    onImported()
    onClose()
  }

  const closable = step === 'select' || step === 'result'

  return (
    <div className="modal-overlay" onClick={closable ? onClose : undefined}>
      <div className="modal-panel modal-panel-wide product-import-modal lead-import-modal" onClick={(e) => e.stopPropagation()}>
        <h2>افزودن گروهی از Excel</h2>

        {step === 'select' && (
          <div className="import-select-step">
            <p className="profile-empty">
              یک فایل Excel (.xlsx) یا CSV حاوی سرنخ‌ها انتخاب کنید. فایل‌های جدول استاندارد و فایل‌های
              نیمه‌ساختاریافته (که هر سلول متنی مثل «شرکت، پاکسان» دارد) هر دو پشتیبانی می‌شوند. ابتدا ساختار
              فایل، تطبیق ستون‌ها (در صورت نیاز)، پیش‌نمایش و تشخیص تکراری‌ها نمایش داده می‌شود و هیچ سرنخی
              بدون تأیید نهایی شما ثبت نمی‌شود.
            </p>
            <ErrorBanner message={parseError} />
            <div className="import-select-actions">
              <button type="button" className="btn-secondary" onClick={downloadLeadImportTemplate}>
                دانلود نمونه فایل
              </button>
              <div className="import-select-actions-left">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  انصراف
                </button>
                <button type="button" className="btn-primary" onClick={() => fileInputRef.current?.click()}>
                  انتخاب فایل
                </button>
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx" hidden onChange={handleFileChange} />
          </div>
        )}

        {step === 'structure' && workbook && (
          <LeadImportStructureStep
            workbook={workbook}
            activeSheetIndex={activeSheetIndex}
            onSetActiveSheet={setActiveSheetIndex}
            startRow={startRow}
            onSetStartRow={setStartRow}
            fullGridRows={fullGridRows}
            mode={mode}
            onSetMode={setMode}
            detection={detection}
            smartPreview={smartPreview}
            previewError={previewError}
            buildingPreview={buildingPreview}
            onBack={reset}
            onContinue={continueFromStructure}
          />
        )}

        {step === 'mapping' && (
          <LeadImportMappingStep
            grid={effectiveGrid}
            mapping={mapping}
            onSetMapping={setColumnMapping}
            previewError={previewError}
            buildingPreview={buildingPreview}
            onBack={goToStructure}
            onContinue={buildPreview}
          />
        )}

        {step === 'preview' && (
          <LeadImportPreviewStep
            rows={rows}
            ignoredRows={ignoredRows}
            onSetRowAction={setRowAction}
            onBack={mode === 'standard' ? goToMapping : goToStructure}
            backLabel={mode === 'standard' ? 'بازگشت به تطبیق ستون‌ها' : 'بازگشت به تشخیص ساختار'}
            suggestedSourceLabel={suggestedSourceLabel}
            importError={importError}
            importing={importing}
            onConfirm={confirmImport}
          />
        )}

        {step === 'importing' && (
          <div className="import-progress-step">
            <p>
              در حال ثبت {progress.done} از {progress.total}...
            </p>
            <div className="import-progress-bar">
              <div
                className="import-progress-bar-fill"
                style={{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }}
              />
            </div>
          </div>
        )}

        {step === 'result' && result && <LeadImportResultStep result={result} onFinish={handleFinish} />}
      </div>
    </div>
  )
}
