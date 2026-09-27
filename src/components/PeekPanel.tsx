'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'
import Collapsible from './Collapsible'
import type { Agent, Task } from '@/types/hermes'
import { fetchJson } from '@/lib/api'

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
      // Polls every 5 s: a dropped packet must leave the last known log on screen
      // rather than clearing it or flashing an error.
      const res = await fetchJson<{ log?: string; runs?: RunInfo[] }>(
        `/api/hermes/tasks/${task.id}`,
        { cache: 'no-store' },
      )
      if (!alive || !res.ok || !res.data) return
      setLog(res.data.log || '')
      setRuns(res.data.runs || [])
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
      const res = await fetchJson(`/api/hermes/tasks/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, message: msg }),
      })
      if (!res.ok) throw new Error(res.error || 'aksi gagal')
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
              <Collapsible
                label="Log terakhir"
                text={log}
                count={log.trim() ? log.trim().split('\n').length : undefined}
                defaultOpen
                empty="log masih kosong"
              />

              <Collapsible
                label="Riwayat run"
                count={runs.length}
                empty="belum ada run"
              >
                <div className="flex flex-col gap-1">
                  {runs.slice(-4).reverse().map((r) => (
                    <div key={r.id} className="vp-run">
                      <b>{r.status}</b>
                      {r.outcome ? <span> · {r.outcome}</span> : null}
                      {r.summary ? <div className="vp-muted">{r.summary}</div> : null}
                      {r.error ? <div className="vp-err">{r.error}</div> : null}
                    </div>
                  ))}
                </div>
              </Collapsible>

              <div className="vp-sub">ARAHKAN / HENTIKAN</div>
              <textarea
                className="vp-input"
                rows={3}
                placeholder="fokus ke test postgres saja"
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
