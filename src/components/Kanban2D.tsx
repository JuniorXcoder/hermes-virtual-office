'use client'

import { useOffice } from '@/lib/store'
import { EVIDENCE_MARK_LABEL, markClass, markOf, useEvidenceMarks } from './useEvidenceMarks'
import {
  VERIFICATION_MARK_LABEL,
  verificationMarkClass,
  verificationMarkOf,
  useVerificationMarks,
} from './useVerificationMarks'

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
  // Kolom SELESAI = klaim worker; penanda bukti (ringkas) dibaca terpisah.
  const marks = useEvidenceMarks(tasks)
  // Klaim ≠ terverifikasi: penanda review independen, hanya untuk done/review.
  const vf = useVerificationMarks(tasks)
  const columns = [
    ...COLUMNS.map((column) => ({ ...column, items: tasks.filter((task) => column.statuses.includes(task.status)) })),
    { label: 'STATUS LAIN', statuses: [], items: tasks.filter((task) => !KNOWN.includes(task.status)) },
  ]

  return (
    <div className="vp-k2d absolute inset-0 overflow-auto p-4 pt-20">
      <div className="vp-k2d-grid grid min-w-[1050px] grid-cols-7 gap-3">
        {columns.map((column) => (
          <section key={column.label} className="vp-col">
            <header className="vp-col-head">
              <span>{column.label}</span>
              <span className="vp-count">{column.items.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {column.items.map((task) => {
                const mark = markOf(marks, task)
                const vmark = verificationMarkOf(vf, task)
                return (
                <article key={task.id} className="vp-card" onClick={() => openTask(task.id)}>
                  <div className="vp-card-title">{task.title}</div>
                  <div className="vp-card-meta">
                    <span className="vp-chip">{column.label === 'STATUS LAIN' ? task.status : task.assignee || '—'}</span>
                    {task.origin && task.origin.kind !== 'manual' && (
                      <span className={`vp-chip vp-chip-${task.origin.kind}`}>{task.origin.kind}</span>
                    )}
                    <code>{task.id}</code>
                    {mark && <span className={markClass(mark)}>{EVIDENCE_MARK_LABEL[mark]}</span>}
                    {vmark && (
                      <span className={verificationMarkClass(vmark)}>{VERIFICATION_MARK_LABEL[vmark]}</span>
                    )}
                  </div>
                </article>
                )
              })}
              {!column.items.length && <div className="vp-empty">kosong</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
