'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type ModelChoice = { model: string; provider: string; label: string }

/**
 * Filter for the picker's suggestion list.
 *
 * Type three characters and the list narrows to matching labels; fewer than three
 * shows everything (there are ~400 models, so the list is capped and says how many
 * were left out rather than silently dropping them).
 *
 * Pure and exported because it is the one piece of logic here worth pinning in the
 * self-test — the rest is DOM wiring.
 */
export function filterModels(models: ModelChoice[], query: string, limit = 80): { shown: ModelChoice[]; total: number } {
  const needle = query.trim().toLowerCase()
  const hit = needle.length >= 3 ? models.filter((m) => m.label.toLowerCase().includes(needle)) : models
  return { shown: hit.slice(0, limit), total: hit.length }
}

/**
 * Model chooser: a text field that suggests, over a LIGHT menu.
 *
 * A native `<select>` was the first version and it could not be themed — the popup
 * is browser chrome, so the list stayed dark on a dark panel and every row read as
 * a smudge. A menu we draw ourselves can be light with black text, and it can also
 * be typed into, which is the only way to find one of ~400 models by name.
 *
 * The value is still a model id and can be typed by hand: a suggestion list is a
 * convenience, not a gate.
 */
export default function ModelPicker({
  value,
  onChange,
  models,
  emptyLabel,
  disabled,
  title,
}: {
  value: string
  onChange: (model: string) => void
  models: ModelChoice[]
  emptyLabel: string
  disabled?: boolean
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  const hit = models.find((m) => m.model === value)
  const { shown, total } = useMemo(() => filterModels(models, query), [models, query])
  const text = open ? query : hit?.label ?? emptyLabel

  useEffect(() => {
    if (!open) return
    // Close on an outside click. `mousedown`, not `click`: the input blurs first on
    // some browsers and a click-outside listener then never sees the event.
    const onDoc = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function choose(model: string) {
    onChange(model)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      // Menu yang terbuka "memakan" ESC ini; tanpa preventDefault panel di
      // belakangnya ikut tertutup dan pilihan yang sedang diketik hilang.
      if (open) event.preventDefault()
      return setOpen(false)
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return setOpen(true)
      const next = active + (event.key === 'ArrowDown' ? 1 : -1)
      setActive(Math.max(0, Math.min(shown.length - 1, next)))
      return
    }
    if (event.key === 'Enter' && open && shown[active]) {
      event.preventDefault()
      choose(shown[active].model)
    }
  }

  return (
    <div className="vp-model" ref={box}>
      <input
        className="vp-input"
        value={text}
        disabled={disabled}
        title={title}
        placeholder={emptyLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls="vp-model-menu"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          if (!open) setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="vp-model-menu" id="vp-model-menu" role="listbox">
          <button
            type="button"
            className="vp-model-item"
            data-active={active === -1}
            onMouseDown={(e) => {
              e.preventDefault()
              choose('')
            }}
          >
            {emptyLabel}
          </button>
          {shown.map((m, i) => (
            <button
              key={`${m.provider}/${m.model}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className="vp-model-item"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(m.model)
              }}
            >
              {m.label}
            </button>
          ))}
          {!shown.length && <div className="vp-model-empty">tidak ada model yang cocok</div>}
          {total > shown.length && (
            <div className="vp-model-empty">…{total - shown.length} lainnya, ketik untuk mempersempit</div>
          )}
        </div>
      )}
    </div>
  )
}
