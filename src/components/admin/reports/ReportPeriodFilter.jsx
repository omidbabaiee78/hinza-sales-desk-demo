import { PERIOD_PRESETS } from '../../../utils/reportPeriods'
import JalaliDateInput from '../../common/JalaliDateInput'
import './Reports.css'

export default function ReportPeriodFilter({
  presetKey,
  onPresetChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  companies,
  companyFilter,
  onCompanyFilterChange,
  products,
  productFilter,
  onProductFilterChange,
}) {
  return (
    <div className="reports-filter-bar">
      <div className="reports-period-presets">
        {PERIOD_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className={`reports-preset-chip${presetKey === preset.key ? ' active' : ''}`}
            onClick={() => onPresetChange(preset.key)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {presetKey === 'custom' && (
        <div className="reports-custom-range">
          <label>
            از تاریخ
            <JalaliDateInput value={customFrom} onChange={onCustomFromChange} />
          </label>
          <label>
            تا تاریخ
            <JalaliDateInput value={customTo} onChange={onCustomToChange} />
          </label>
        </div>
      )}

      <div className="reports-extra-filters">
        <select value={companyFilter} onChange={(e) => onCompanyFilterChange(e.target.value)}>
          <option value="">همه مشتری‌ها</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <select value={productFilter} onChange={(e) => onProductFilterChange(e.target.value)}>
          <option value="">همه محصولات</option>
          {products.map((product) => (
            <option key={product.code} value={product.code}>
              {product.code} - {product.name_fa}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
