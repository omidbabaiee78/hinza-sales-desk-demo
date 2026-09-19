import { useState } from 'react'

// Simple free-text tag chips - deliberately no taxonomy/category system, per
// the phase-15B spec ("do not build a complex taxonomy system").
export default function LeadTagsEditor({ tags, onChange }) {
  const [draft, setDraft] = useState('')

  function addTag() {
    const value = draft.trim()
    if (!value) return
    if (!tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      onChange([...tags, value])
    }
    setDraft('')
  }

  function removeTag(tag) {
    onChange(tags.filter((t) => t !== tag))
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
  }

  return (
    <div className="lead-tags-editor">
      {tags.length > 0 && (
        <div className="lead-product-chips">
          {tags.map((tag) => (
            <span key={tag} className="lead-product-chip">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label="حذف">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="lead-tags-input-row">
        <input
          type="text"
          placeholder="تگ را بنویسید و Enter بزنید..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="btn-secondary" onClick={addTag}>
          افزودن
        </button>
      </div>
    </div>
  )
}
