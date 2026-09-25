'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'
import type { Agent, Task } from '@/types/hermes'

type RunInfo = {
  id: number
  profile: string
  status: string
  outcome?: string | null
  summary?: string | null
  error?: string | null
}

/** "Intip layar": live log + steer/cancel for whoever occupies a desk. */
export default function PeekPanel() {
  const desk = useOffice((s) => s.peekDesk)
  const setPeek = useOffice((s) => s.setPeek)
  const agents = useOffice((s) => s.agents)
  const tasks = useOffice((s) => s.tasks)
  const load = useOffice((s) => s.load)

  const [log, setLog] = useState('')
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const agent: Agent | undefined = agents.find((a) => a.deskIndex === desk)
  const task: Task | undefined = tasks.find((t) => t.id === agent?.currentTaskId)

  useEffect(() => {
    if (!task) {
      setLog('')
      setRuns([])
      return
    }
    let alive = true
    const pull = async () => {
      try {
        const r = await fetch(`/api/hermes/tasks/${task.id}`, { cache: 'no-store' })
        const d = await r.json()
        if (!alive) return
        setLog(d.log || '')
        setRuns(d.runs || [])
      } catch {
        /* transient */
      }
    }
    pull()
    const id = setInterval(pull, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [task?.id])

  if (desk == null) return null

  async function act(action: 'steer' | 'cancel') {
    if (!task) return
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch(`/api/hermes/tasks/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, message: msg }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      setNote(action === 'steer' ? 'Arahan terkirim ke worker.' : 'Worker claim dilepas.')
      setMsg('')
      void load()
    } catch (e) {
      setNote(`Gagal: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="vp-panel right-0">
      <header className="vp-panel-head">
        <h2>Meja {desk + 1} · {agent?.displayName || 'kosong'}</h2>
        <button className="vp-x" onClick={() => setPeek(null)} aria-label="Tutup">×</button>
      </header>

      {!agent && <div className="vp-pad vp-muted">Tidak ada agent di meja ini.</div>}

      {agent && (
        <div className="vp-pad flex flex-col gap-3">
          <div className="vp-kv">
            <span>status</span><b>{agent.status}</b>
          </div>
          <div className="vp-kv">
            <span>tugas</span><b>{task?.title || '— tidak ada tugas aktif —'}</b>
          </div>
          {task && <code className="vp-code-block">{task.id}</code>}

          {task && (
            <>
              <div className="vp-sub">LOG TERAKHIR</div>
              <pre className="vp-pre">{log.trim() || '(log masih kosong)'}</pre>

              <div className="vp-sub">RIWAYAT RUN</div>
              <div className="flex flex-col gap-1">
                {runs.slice(-4).reverse().map((r) => (
                  <div key={r.id} className="vp-run">
                    <b>{r.status}</b>
                    {r.outcome ? <span> · {r.outcome}</span> : null}
                    {r.summary ? <div className="vp-muted">{r.summary}</div> : null}
                    {r.error ? <div className="vp-err">{r.error}</div> : null}
                  </div>
                ))}
                {!runs.length && <div className="vp-muted">belum ada run</div>}
              </div>

              <div className="vp-sub">ARAHKAN / HENTIKAN</div>
              <textarea
                className="vp-input"
                rows={3}
                placeholder="mis. fokus ke test postgres saja, lewati integrasi"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
              />
              <div className="flex gap-2">
                <button className="vp-btn" disabled={busy || !msg.trim()} onClick={() => act('steer')}>
                  Steer
                </button>
                <button className="vp-btn vp-btn-warn" disabled={busy} onClick={() => act('cancel')}>
                  Hentikan
                </button>
              </div>
              {note && <div className="vp-note">{note}</div>}
            </>
          )}
        </div>
      )}
    </aside>
  )
}
