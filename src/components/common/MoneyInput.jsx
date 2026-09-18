import { useState } from 'react'
import {
  formatRialEquivalent,
  formatTomanEquivalent,
  fromRial,
  parseMoneyInput,
  toRial,
} from '../../utils/money'
import './MoneyInput.css'

const numberFormatter = new Intl.NumberFormat('fa-IR')

function formatForDisplay(amount) {
  if (amount == null || Number.isNaN(amount)) return ''
  return numberFormatter.format(amount)
}

function normalizeRial(valueRial) {
  return valueRial === '' || valueRial == null ? '' : Number(valueRial)
}

// Shared Rial/Toman money entry. `valueRial` is always the integer Rial
// source of truth (or '' when empty); `onChangeRial` is always called with
// an integer Rial value (or ''), regardless of which unit the admin is
// currently typing in - callers never need to know Toman exists.
export default function MoneyInput({
  id,
  valueRial,
  onChangeRial,
  required,
  disabled,
  placeholder,
}) {
  const [unit, setUnit] = useState('rial')
  const [text, setText] = useState(() =>
    valueRial === '' || valueRial == null ? '' : formatForDisplay(fromRial(Number(valueRial), 'rial')),
  )
  const [lastExternalValue, setLastExternalValue] = useState(valueRial)

  // Resync the displayed text from the Rial source of truth only when the
  // incoming value changed for a reason other than this field's own typing
  // (e.g. a parent-side prefill or reset) - adjusted directly during render,
  // React's documented alternative to syncing props into state via an
  // effect, so we never fight the user's keystrokes.
  if (valueRial !== lastExternalValue) {
    const typedParsed = parseMoneyInput(text)
    const typedRial = typedParsed == null ? '' : toRial(typedParsed, unit)
    const incoming = normalizeRial(valueRial)
    if (typedRial !== incoming) {
      setText(incoming === '' ? '' : formatForDisplay(fromRial(incoming, unit)))
    }
    setLastExternalValue(valueRial)
  }

  function handleTextChange(e) {
    const raw = e.target.value
    setText(raw)
    const parsed = parseMoneyInput(raw)
    onChangeRial(parsed === null ? '' : toRial(parsed, unit))
  }

  function handleUnitChange(nextUnit) {
    if (nextUnit === unit) return
    setUnit(nextUnit)
    // Re-express the SAME stored amount in the new unit - never reinterpret
    // the digits already on screen.
    const incoming = valueRial === '' || valueRial == null ? '' : Number(valueRial)
    setText(incoming === '' ? '' : formatForDisplay(fromRial(incoming, nextUnit)))
  }

  const equivalent =
    valueRial === '' || valueRial == null
      ? null
      : unit === 'rial'
        ? formatTomanEquivalent(Number(valueRial))
        : formatRialEquivalent(Number(valueRial))

  return (
    <div className="money-input">
      <div className="money-input-row">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          value={text}
          onChange={handleTextChange}
        />
        <div className="money-input-unit" role="group" aria-label="واحد پول">
          <button
            type="button"
            className={unit === 'rial' ? 'active' : ''}
            onClick={() => handleUnitChange('rial')}
          >
            ریال
          </button>
          <button
            type="button"
            className={unit === 'toman' ? 'active' : ''}
            onClick={() => handleUnitChange('toman')}
          >
            تومان
          </button>
        </div>
      </div>
      {equivalent && <p className="money-input-equivalent">{equivalent}</p>}
    </div>
  )
}
