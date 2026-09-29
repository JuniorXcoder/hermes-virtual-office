'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'
import Collapsible from './Collapsible'
import ModelPicker, { type ModelChoice } from './ModelPicker'
import type { Task } from '@/types/hermes'
import { fetchJson } from '@/lib/api'

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
  const load = useOffice((s) => s.load)

  const [runs, setRuns] = useState<RunInfo[]>([])
  /** The same task as `/tasks/{id}` reports it — `list` has no dependency edges. */
  const [detail, setDetail] = useState<Task | null>(null)
  const [log, setLog] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [models, setModels] = useState<ModelChoice[]>([])
  const [pick, setPick] = useState('')

  // `detail` first: it is the only payload with `parents`.
  const task: Task | undefined = detail?.id === taskId ? detail : tasks.find((t) => t.id === taskId)
  const agent = agents.find((a) => a.name === task?.assignee)

  useEffect(() => {
    if (!taskId) return
    let alive = true
    setLoading(true)
    setErr(null)
    fetchJson<{ runs?: RunInfo[]; log?: string; task?: Task }>(`/api/hermes/tasks/${taskId}`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (!alive) return
        if (!res.ok) {
          setErr(res.error || 'gagal memuat detail tugas')
          return
        }
        setRuns(res.data?.runs || [])
        setLog(res.data?.log || '')
        setDetail(res.data?.task || null)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [taskId])

  // The model list is config, not board state: fetched once per panel, not on the
  // poll, so opening a task does not spawn a CLI read every 4 seconds.
  useEffect(() => {
    if (!taskId || models.length) return
    let alive = true
    fetchJson<{ models?: ModelChoice[] }>('/api/hermes/models', { cache: 'no-store' }).then((res) => {
      if (alive && res.ok) setModels(res.data?.models || [])
    })
    return () => {
      alive = false
    }
  }, [taskId, models.length])

  // Show what the task is actually pinned to, not a stale pick from another task.
  useEffect(() => {
    setPick(task?.model || '')
    setNote(null)
  }, [taskId, task?.model])

  if (!taskId) return null

  /** run | promote | set-model */
  async function act(action: 'run' | 'promote' | 'set-model', extra: Record<string, unknown> = {}) {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetchJson<{ note?: string; mine?: boolean }>(
        `/api/hermes/tasks/${taskId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        },
      )
      if (!res.ok) throw new Error(res.error || 'aksi gagal')
      setNote(res.data?.note || (action === 'set-model' ? 'Model disimpan.' : 'Selesai.'))
      await load()
      const fresh = await fetchJson<{ runs?: RunInfo[]; log?: string; task?: Task }>(
        `/api/hermes/tasks/${taskId}`,
        { cache: 'no-store' },
      )
      if (fresh.ok) {
        setRuns(fresh.data?.runs || [])
        setLog(fresh.data?.log || '')
        setDetail(fresh.data?.task || null)
      }
    } catch (e) {
      setNote(`Gagal: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const blocked = task?.status === 'blocked' || task?.status === 'scheduled'

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
            <div className="vp-kv">
              <span>model worker</span>
              <b>{task.model || 'bawaan profil'}</b>
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

            {/* The board's own dependency edge. A parent parks its subtasks: the
                dispatcher will not spawn them until every parent is `done`, and
                "menunggu prasyarat" without the ids is unactionable. */}
            {!!task.parents?.length && (
              <>
                <div className="vp-sub">PRASYARAT ({task.parents.length})</div>
                <div className="flex flex-col gap-1">
                  {task.parents.map((id) => {
                    const parent = tasks.find((t) => t.id === id)
                    const state = parent?.status
                    const clear = state === 'done' || state === 'archived'
                    return (
                      <button
                        key={id}
                        className="vp-run text-left"
                        onClick={() => openTask(id)}
                        title="Buka tugas ini"
                      >
                        <b className={clear ? '' : 'vp-warn'}>{clear ? 'selesai' : STATUS_LABEL[state || ''] || state || 'tidak ada di board'}</b>
                        <span className="vp-muted"> · {parent?.title || id}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="vp-muted">
                  Tugas ini baru boleh jalan setelah semua prasyarat di atas selesai. Tombol
                  Jalankan pada tugas ini tidak akan men-spawn worker selama masih ada yang belum selesai.
                </div>
              </>
            )}

            {/* A `ready` task is not running on its own: the dispatcher that spawns
                workers lives in the gateway. Without this button a task just sits
                there whenever the gateway is down. It lifts a parked task first,
                so one click covers blocked/scheduled too. */}
            <div className="vp-sub">JALANKAN</div>
            <div className="flex gap-2">
              <button
                className="vp-btn"
                disabled={busy || task.status === 'running' || task.status === 'review'}
                onClick={() => act('run')}
                title="Buka blokir bila perlu, lalu suruh dispatcher Hermes mengeksekusi tugas ini"
              >
                {busy ? '…' : 'Jalankan'}
              </button>
            </div>
            {blocked && (
              <div className="vp-muted">
                Status <b>{task.status}</b>: tombol Jalankan otomatis membuka blokir dulu.
              </div>
            )}

            <div className="vp-sub">MODEL AGENT UNTUK TUGAS INI</div>
            <ModelPicker
              value={pick}
              onChange={setPick}
              models={models}
              emptyLabel={`bawaan profil${agent ? ` (${agent.name})` : ''}`}
              disabled={busy}
              title="Berlaku pada spawn worker berikutnya"
            />
            <div className="flex gap-2">
              <button
                className="vp-btn"
                disabled={busy || pick === (task.model || '')}
                onClick={() => {
                  const hit = models.find((m) => m.model === pick)
                  void act('set-model', pick ? { model: pick, provider: hit?.provider } : { model: null })
                }}
                title="Berlaku pada spawn worker berikutnya"
              >
                Simpan model
              </button>
            </div>
            {note && <div className="vp-note">{note}</div>}

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
