'use client'

import { useOffice } from '@/lib/store'

const COLUMNS = [
  { label: 'TODO', statuses: ['todo', 'triage', 'ready', 'scheduled'] },
  { label: 'DIKERJAKAN', statuses: ['running'] },
  { label: 'REVIEW', statuses: ['review'] },
  { label: 'SELESAI', statuses: ['done'] },
  { label: 'TERHAMBAT', statuses: ['blocked'] },
  { label: 'ARSIP', statuses: ['archived'] },
]
const KNOWN = COLUMNS.flatMap((column) => column.statuses)

export default function Kanban2D() {
  const tasks = useOffice((s) => s.tasks)
  const openTask = useOffice((s) => s.openTask)
  const columns = [
    ...COLUMNS.map((column) => ({ ...column, items: tasks.filter((task) => column.statuses.includes(task.status)) })),
    { label: 'STATUS LAIN', statuses: [], items: tasks.filter((task) => !KNOWN.includes(task.status)) },
  ]

  return (
    <div className="absolute inset-0 overflow-auto p-4 pt-20">
      <div className="grid min-w-[1050px] grid-cols-7 gap-3">
        {columns.map((column) => (
          <section key={column.label} className="vp-col">
            <header className="vp-col-head">
              <span>{column.label}</span>
              <span className="vp-count">{column.items.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {column.items.map((task) => (
                <article key={task.id} className="vp-card" onClick={() => openTask(task.id)}>
                  <div className="vp-card-title">{task.title}</div>
                  <div className="vp-card-meta">
                    <span className="vp-chip">{column.label === 'STATUS LAIN' ? task.status : task.assignee || '—'}</span>
                    {task.origin && task.origin.kind !== 'manual' && (
                      <span className={`vp-chip vp-chip-${task.origin.kind}`}>{task.origin.kind}</span>
                    )}
                    <code>{task.id}</code>
                  </div>
                </article>
              ))}
              {!column.items.length && <div className="vp-empty">kosong</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
