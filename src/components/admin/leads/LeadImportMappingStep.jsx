import { CANONICAL_LEAD_FIELDS, LEAD_FIELD_LABELS } from '../../../utils/leadImport/columnAliases'
import ErrorBanner from '../../common/ErrorBanner'

function sampleValues(bodyRows, columnIndex) {
  const values = []
  for (const row of bodyRows) {
    const cell = row[columnIndex]
    if (cell != null && String(cell).trim() !== '') values.push(String(cell).trim())
    if (values.length >= 2) break
  }
  return values.join('، ')
}

// Lets the admin confirm/correct the auto-detected column mapping before
// anything is read into real fields - "Never guess destructively": an
// unrecognized header simply starts as "نادیده گرفته شود", never a guess.
export default function LeadImportMappingStep({
  grid,
  mapping,
  onSetMapping,
  previewError,
  buildingPreview,
  onBack,
  onContinue,
}) {
  const mappedFieldCount = Object.keys(mapping).length
  const hasIdentityField = Object.values(mapping).includes('company_name') || Object.values(mapping).includes('contact_name')

  return (
    <div className="import-mapping-step">
      <p className="profile-empty">
        ستون‌های فایل را به فیلدهای سرنخ تطبیق دهید. ستون‌هایی که تشخیص داده نشده‌اند به صورت «نادیده گرفته شود»
        علامت خورده‌اند و می‌توانید هر ستون را دستی تغییر دهید.
      </p>

      <div className="table-wrapper import-preview-table">
        <table>
          <thead>
            <tr>
              <th>ستون فایل</th>
              <th>نمونه داده</th>
              <th>فیلد مقصد</th>
            </tr>
          </thead>
          <tbody>
            {grid.headers.map((header, index) => (
              <tr key={index}>
                <td>{header || `ستون ${index + 1}`}</td>
                <td className="cell-notes">{sampleValues(grid.bodyRows, index) || '—'}</td>
                <td>
                  <select value={mapping[index] || ''} onChange={(e) => onSetMapping(index, e.target.value || null)}>
                    <option value="">نادیده گرفته شود</option>
                    {CANONICAL_LEAD_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {LEAD_FIELD_LABELS[field]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!hasIdentityField && (
        <p className="modal-warning">
          حداقل یکی از فیلدهای «نام شرکت» یا «شخص تماس» باید تطبیق داده شود، در غیر این صورت همه ردیف‌ها خطا خواهند
          داشت.
        </p>
      )}

      <ErrorBanner message={previewError} onRetry={onContinue} />

      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onBack} disabled={buildingPreview}>
          بازگشت
        </button>
        <button type="button" className="btn-primary" disabled={mappedFieldCount === 0 || buildingPreview} onClick={onContinue}>
          {buildingPreview ? 'در حال آماده‌سازی پیش‌نمایش...' : 'پیش‌نمایش'}
        </button>
      </div>
    </div>
  )
}
