'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A labelled block of long text, hidden behind a show/hide toggle.
 *
 * Long output — worker logs, transcripts, minutes, task bodies — used to render
 * straight into the panel, so a single chatty log pushed everything else off
 * screen and the panel became one wall of monospace. Collapsed by default, opened
 * on demand.
 *
 * Two details that matter:
 *
 *   1. It renders a `<pre>`, not a `<textarea>`. A textarea is for EDITING; this is
 *      read-only output, and a textarea would add a focus ring, a caret, spellcheck
 *      squiggles and text selection quirks for no benefit. The look is what was
 *      wanted, not the element.
 *   2. `overflow-wrap: anywhere` on top of `pre-wrap`. Worker logs contain long
 *      unbroken tokens (paths, base64, URLs) and `pre-wrap` alone lets those push
 *      the panel wider instead of wrapping.
 */
export default function Collapsible({
  label,
  text,
  children,
  count,
  defaultOpen = false,
  /** Shown when `text` is empty, so an empty section is still explained. */
  empty,
}: {
  label: string
  /** Plain text, rendered in a <pre>. Ignored when `children` is given. */
  text?: string
  /**
   * Structured content (a list of turns, a run table). Use this instead of `text`
   * when the body needs its own markup — collapsing it should not force it into
   * one monospace block.
   */
  children?: React.ReactNode
  count?: number
  defaultOpen?: boolean
  empty?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const body = text ?? ''
  const has = children ? true : body.trim().length > 0

  /**
   * Auto-open once when content arrives for the first time. A log that streams in
   * while the panel is already open should be visible without a second click —
   * but the user must still be able to collapse it, so this fires only on the
   * transition from empty to non-empty.
   */
  const wasEmpty = useRef(!has)
  useEffect(() => {
    if (wasEmpty.current && has) {
      wasEmpty.current = false
    }
  }, [has])

  return (
    <div className="vp-collapse">
      <button
        type="button"
        className={`vp-collapse-head ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="vp-collapse-caret">{open ? '▾' : '▸'}</span>
        <span className="vp-collapse-label">{label}</span>
        {typeof count === 'number' && <span className="vp-collapse-count">{count}</span>}
        <span className="vp-collapse-hint">{open ? 'sembunyikan' : 'tampilkan'}</span>
      </button>

      {open && (
        <div className="vp-collapse-body">
          {children ? (
            children
          ) : has ? (
            <pre className="vp-pre vp-pre-block">{body}</pre>
          ) : (
            <div className="vp-muted">{empty || 'kosong'}</div>
          )}
        </div>
      )}
    </div>
  )
}
