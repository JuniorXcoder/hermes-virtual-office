'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'
import Collapsible from './Collapsible'
import type { Task } from '@/types/hermes'

type RunInfo = {
  id: number
  profile: string
  status: string
  outcome?: string | null
  summary?: string | null
  error?: string | null
}

/**
 * How an origin reads in the panel.
 *
 * Returns null for anything that is not a cross-menu link. The CLI writes
 * `created_by` itself for ordinary tasks ('worker', 'user'), and showing "asal:
 * worker" on every task is noise — the line only earns its space when it names the
 * meeting or job the work came from.
 */
function originLabel(o?: { kind: string; ref?: string }): string | null {
  if (!o) return null
  switch (o.kind) {
    case 'meeting':
      return o.ref ? `rapat ${o.ref}` : 'rapat'
    case 'cron':
      return o.ref ? `cron ${o.ref}` : 'cron'
    case 'agent':
      return o.ref ? `agent ${o.ref}` : 'agent'
    default:
      return null
  }
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'Belum dikerjakan',
  triage: 'Perlu dispesifikasi',
  ready: 'Siap diambil worker',
  scheduled: 'Terjadwal',
  running: 'Sedang dikerjakan',
  review: 'Menunggu review',
  blocked: 'Terhambat',
  done: 'Selesai',
  archived: 'Diarsipkan',
}

/**
 * Task detail panel. Opened from a card on the 3D wall board or from the 2D
 * board — including tasks that are already `done`, which is why it reads the
 * run history rather than live output only.
 */
export default function TaskPanel() {
  const taskId = useOffice((s) => s.openTaskId)
  const openTask = useOffice((s) => s.openTask)
  const tasks = useOffice((s) => s.tasks)
  const agents = useOffice((s) => s.agents)

  const [runs, setRuns] = useState<RunInfo[]>([])
  const [log, setLog] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const task: Task | undefined = tasks.find((t) => t.id === taskId)
  const agent = agents.find((a) => a.name === task?.assignee)

  useEffect(() => {
    if (!taskId) return
    let alive = true
    setLoading(true)
    setErr(null)
    fetch(`/api/hermes/tasks/${taskId}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
        if (!alive) return
        setRuns(d.runs || [])
        setLog(d.log || '')
      })
      .catch((e) => alive && setErr((e as Error).message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [taskId])

  if (!taskId) return null

  return (
    <aside className="vp-panel left-0">
      <header className="vp-panel-head">
        <h2>Detail tugas</h2>
        <button className="vp-x" onClick={() => openTask(null)} aria-label="Tutup">
          ×
        </button>
      </header>

      <div className="vp-pad flex flex-col gap-3">
        {!task && <div className="vp-muted">Tugas {taskId} tidak ada di board aktif.</div>}

        {task && (
          <>
            <div className="vp-kv">
              <span>judul</span>
              <b>{task.title}</b>
            </div>
            <div className="vp-kv">
              <span>status</span>
              <b>{STATUS_LABEL[task.status] || task.status}</b>
            </div>
            <div className="vp-kv">
              <span>penanggung</span>
              <b>{task.assignee || '—'}{agent ? ` (${agent.role})` : ''}</b>
            </div>
            <div className="vp-kv">
              <span>prioritas</span>
              <b>{task.priority}</b>
            </div>
            {task.updatedAt && (
              <div className="vp-kv">
                <span>diubah</span>
                <b>{new Date(task.updatedAt).toLocaleString('id-ID')}</b>
              </div>
            )}
            {originLabel(task.origin) && (
              <div className="vp-kv">
                <span>asal</span>
                <b>{originLabel(task.origin)}</b>
              </div>
            )}
            <code className="vp-code-block">{task.id}</code>

            {task.body && <Collapsible label="Uraian" text={task.body} />}

            <div className="vp-sub">RIWAYAT RUN ({runs.length})</div>
            {loading && <div className="vp-muted">memuat…</div>}
            {err && <div className="vp-err">{err}</div>}
            <div className="flex flex-col gap-2">
              {runs
                .slice()
                .reverse()
                .map((r) => (
                  <div key={r.id} className="vp-run">
                    <b>{r.status}</b>
                    {r.outcome ? <span> · {r.outcome}</span> : null}
                    {r.profile ? <span className="vp-muted"> · {r.profile}</span> : null}
                    {r.summary && <div className="vp-muted">{r.summary}</div>}
                    {r.error && <div className="vp-err">{r.error}</div>}
                  </div>
                ))}
              {!loading && !runs.length && <div className="vp-muted">belum ada run</div>}
            </div>

            <Collapsible
              label="Log worker"
              text={log}
              count={log.trim() ? log.trim().split('\n').length : undefined}
              empty="belum ada log"
            />
          </>
        )}
      </div>
    </aside>
  )
}
