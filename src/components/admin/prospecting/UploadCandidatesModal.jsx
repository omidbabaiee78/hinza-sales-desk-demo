import { useState } from 'react'
import ErrorBanner from '../../common/ErrorBanner'
import '../../common/Modal.css'

// Phase 23's one working source: a simple pasted table (from Excel/CSV),
// never the full flexible column-alias system the lead importer has - a
// deliberate scope choice for this first adapter (see
// src/prospecting/sourceAdapters/uploadedDataset.js).
const EXPECTED_COLUMNS = [
  'company_name',
  'phone',
  'mobile',
  'email',
  'website',
  'province',
  'city',
  'address',
  'industry_guess',
  'business_description',
  'source_url',
  'source_external_id',
]

function parsePastedTable(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim())
  if (lines.length < 2) {
    return { rows: [], error: 'حداقل یک ردیف سرستون و یک ردیف داده لازم است.' }
  }
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const headers = lines[0].split(delimiter).map((h) => h.trim())
  if (!headers.includes('company_name')) {
    return { rows: [], error: 'ستون company_name الزامی است.' }
  }
  const rows = []
  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter)
    const row = {}
    headers.forEach((header, i) => {
      if (EXPECTED_COLUMNS.includes(header)) row[header] = (cells[i] || '').trim()
    })
    if (row.company_name) rows.push(row)
  }
  if (rows.length === 0) {
    return { rows: [], error: 'هیچ ردیف معتبری (با نام شرکت) یافت نشد.' }
  }
  return { rows, error: null }
}

export default function UploadCandidatesModal({ onSubmit, onCancel, submitting }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const { rows, error: parseError } = parsePastedTable(text)
    if (parseError) {
      setError(parseError)
      return
    }
    setError('')
    onSubmit(rows)
  }

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : onCancel}>
      <div className="modal-panel prospecting-upload-modal" onClick={(e) => e.stopPropagation()}>
        <h2>آپلود فهرست مشتریان بالقوه</h2>
        <p className="lead-form-hint">
          یک جدول (کپی از اکسل یا CSV، با ستون در ردیف اول) جای‌گذاری کنید. فقط ستون <code>company_name</code> الزامی
          است؛ بقیه اختیاری‌اند.
        </p>
        <p className="lead-form-hint">
          ستون‌های قابل‌قبول: company_name، phone، mobile، email، website، province، city، address، industry_guess،
          business_description
        </p>
        <form onSubmit={handleSubmit}>
          <label>
            جدول
            <textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'company_name\tcity\tbusiness_description\nصنایع پلاستیک امید\tکرج\tتولیدکننده فیلم پلی اتیلن'}
            />
          </label>
          <ErrorBanner message={error} />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
              انصراف
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'در حال بررسی...' : 'بررسی و اجرا'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
