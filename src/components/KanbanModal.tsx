'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'

/**
 * Full Kanban modal, opened by clicking the green whiteboard in Rinjani (poin 13).
 *
 * The board itself is a plain green board — NO pop-up cards stuck to it. The full
 * board lives here: four columns, each scrolling on its own, and the whole grid
 * scrolls sideways when the window is narrow.
 */
export default function KanbanModal({ onClose }: { onClose: () => void }) {
  const tasks = useOffice((s) => s.tasks)
  const openTask = useOffice((s) => s.openTask)
  const [q, setQ] = useState('')

  // ESC closes, and the page behind must not scroll while the modal is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const cols: { key: string; label: string; match: (s: string) => boolean }[] = [
    { key: 'todo', label: 'TODO', match: (s) => s === 'todo' || s === 'triage' || s === 'ready' || s === 'scheduled' },
    { key: 'running', label: 'JALAN', match: (s) => s === 'running' },
    { key: 'review', label: 'REVIEW', match: (s) => s === 'review' },
    { key: 'done', label: 'SELESAI', match: (s) => s === 'done' || s === 'archived' },
  ]
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? tasks.filter((t) => t.title.toLowerCase().includes(needle) || (t.assignee ?? '').toLowerCase().includes(needle))
    : tasks

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div className="vp-kanban-modal" onClick={(e) => e.stopPropagation()}>
        <header className="vp-kanban-head">
          <div>
            <h3>Papan Kanban</h3>
            <p className="vp-sub">
              {tasks.length} tugas · klik kartu untuk membuka detail
            </p>
          </div>
          <input
            className="vp-kanban-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="cari judul / assignee…"
          />
          <button className="vp-btn" onClick={onClose}>
            Tutup
          </button>
        </header>
        <div className="vp-kanban-scroll">
          {cols.map((c) => {
            const list = shown.filter((t) => c.match(t.status))
            return (
              <section key={c.key} className="vp-kanban-col">
                <div className="vp-kanban-col-head">
                  {c.label} <b>{list.length}</b>
                </div>
                <div className="vp-kanban-col-body">
                  {list.map((t) => (
                    <button
                      key={t.id}
                      className="vp-kanban-card"
                      onClick={() => {
                        openTask(t.id)
                        onClose()
                      }}
                    >
                      <span className="vp-kanban-card-title">{t.title}</span>
                      <span className="vp-kanban-card-meta">
                        {t.assignee ?? 'tanpa assignee'}
                        {t.status !== c.key ? ` · ${t.status}` : ''}
                      </span>
                    </button>
                  ))}
                  {!list.length && <span className="vp-muted">kosong</span>}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
