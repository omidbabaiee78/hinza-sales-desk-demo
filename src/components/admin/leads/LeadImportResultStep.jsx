// One status per lead_import_batches.status - shown up front so a batch
// that resolved without throwing but still wrote nothing (status: 'failed')
// or only partly succeeded is never presented as if it were a clean success.
const STATUS_MESSAGES = {
  completed: { tone: 'success', text: 'این ایمپورت با موفقیت کامل انجام شد.' },
  partial: { tone: 'warning', text: 'این ایمپورت به‌صورت نسبی انجام شد - برخی ردیف‌ها رد شدند یا با خطا مواجه شدند.' },
  failed: { tone: 'danger', text: 'این ایمپورت ناموفق بود - هیچ سرنخی ثبت یا بروزرسانی نشد.' },
}

export default function LeadImportResultStep({ result, onFinish }) {
  const statusMessage = STATUS_MESSAGES[result.status]

  return (
    <div className="import-result-step">
      {statusMessage && (
        <p className={`import-result-status tone-${statusMessage.tone}`}>{statusMessage.text}</p>
      )}

      <div className="import-summary">
        <div className="import-summary-item tone-success">
          <span className="import-summary-count">{result.insertedRows}</span>
          <span>جدید ثبت شد</span>
        </div>
        <div className="import-summary-item tone-info">
          <span className="import-summary-count">{result.updatedRows}</span>
          <span>بروزرسانی شد</span>
        </div>
        <div className="import-summary-item tone-warning">
          <span className="import-summary-count">{result.skippedRows}</span>
          <span>رد شد</span>
        </div>
        <div className="import-summary-item tone-danger">
          <span className="import-summary-count">{result.invalidRows + result.failures.length}</span>
          <span>خطا</span>
        </div>
      </div>

      {result.failures.length > 0 && (
        <div className="table-wrapper import-preview-table">
          <table>
            <thead>
              <tr>
                <th>ردیف</th>
                <th>دلیل</th>
              </tr>
            </thead>
            <tbody>
              {result.failures.map((f) => (
                <tr key={f.rowNumber}>
                  <td>{f.rowNumber}</td>
                  <td>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn-primary" onClick={onFinish}>
          مشاهده بانک مشتریان بالقوه
        </button>
      </div>
    </div>
  )
}
