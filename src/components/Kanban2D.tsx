'use client'

import { useOffice } from '@/lib/store'

const COLUMNS: { key: string; label: string }[] = [
  { key: 'todo', label: 'TODO' },
  { key: 'ready', label: 'SIAP' },
  { key: 'running', label: 'DIKERJAKAN' },
  { key: 'review', label: 'REVIEW' },
  { key: 'blocked', label: 'TERHAMBAT' },
  { key: 'done', label: 'SELESAI' },
]

export default function Kanban2D() {
  const tasks = useOffice((s) => s.tasks)
  const openTask = useOffice((s) => s.openTask)

  return (
    <div className="absolute inset-0 overflow-auto p-4 pt-20">
      <div className="grid min-w-[900px] grid-cols-6 gap-3">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.key)
          return (
            <section key={col.key} className="vp-col">
              <header className="vp-col-head">
                <span>{col.label}</span>
                <span className="vp-count">{items.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {items.map((t) => (
                  <article
                    key={t.id}
                    className="vp-card"
                    onClick={() => openTask(t.id)}
                  >
                    <div className="vp-card-title">{t.title}</div>
                    <div className="vp-card-meta">
                      <span className="vp-chip">{t.assignee || '—'}</span>
                      {/* Where the task came from. Without it the board is a flat
                          pile and you cannot tell which meeting asked for what. */}
                      {t.origin && t.origin.kind !== 'manual' && (
                        <span className={`vp-chip vp-chip-${t.origin.kind}`}>
                          {t.origin.kind}
                        </span>
                      )}
                      <code>{t.id}</code>
                    </div>
                  </article>
                ))}
                {!items.length && <div className="vp-empty">kosong</div>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
