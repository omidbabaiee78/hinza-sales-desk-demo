import './ProductMiniSpecsEditor.css'

const MAX_ROWS = 8

// Free-form label/value rows (mini_specs jsonb) - different products have
// different technical properties, so this stays flexible instead of one
// fixed input per possible spec. Completely empty rows are dropped on save
// by the parent form, not here.
export default function ProductMiniSpecsEditor({ rows, onChange }) {
  const specs = rows || []

  function updateRow(index, field, value) {
    onChange(specs.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function addRow() {
    if (specs.length >= MAX_ROWS) return
    onChange([...specs, { label: '', value: '' }])
  }

  function removeRow(index) {
    onChange(specs.filter((_, i) => i !== index))
  }

  return (
    <div className="mini-specs-editor">
      {specs.length === 0 && (
        <p className="profile-empty">هنوز مشخصه‌ای اضافه نشده است.</p>
      )}
      {specs.map((row, index) => (
        <div className="mini-spec-row" key={index}>
          <input
            type="text"
            placeholder="عنوان (مثلاً TiO₂)"
            value={row.label}
            onChange={(e) => updateRow(index, 'label', e.target.value)}
          />
          <input
            type="text"
            placeholder="مقدار (مثلاً 69%)"
            value={row.value}
            onChange={(e) => updateRow(index, 'value', e.target.value)}
          />
          <button
            type="button"
            className="btn-link btn-link-danger"
            onClick={() => removeRow(index)}
          >
            حذف ردیف
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary"
        onClick={addRow}
        disabled={specs.length >= MAX_ROWS}
      >
        + افزودن مشخصه
      </button>
    </div>
  )
}
