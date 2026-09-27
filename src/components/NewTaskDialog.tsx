'use client'

import { useState } from 'react'
import { useOffice } from '@/lib/store'
import { fetchJson } from '@/lib/api'

/** Dispatch a new task straight into the Hermes board. */
export default function NewTaskDialog() {
  const open = useOffice((s) => s.newTaskOpen)
  const setOpen = useOffice((s) => s.setNewTaskOpen)
  const agents = useOffice((s) => s.agents)
  const load = useOffice((s) => s.load)

  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  if (!open) return null

  async function submit() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetchJson<{ task: { id: string } }>('/api/hermes/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          assignee: assignee || agents[0]?.name,
          body,
          priority,
        }),
      })
      if (!res.ok || !res.data) throw new Error(res.error || 'gagal membuat tugas')
      setNote(`Dibuat: ${res.data.task.id}`)
      setTitle('')
      setBody('')
      await load()
      setTimeout(() => setOpen(false), 900)
    } catch (e) {
      setNote(`Gagal: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vp-modal-backdrop" onClick={() => setOpen(false)}>
      <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
        <header className="vp-panel-head">
          <h2>Tugas baru</h2>
          <button className="vp-x" onClick={() => setOpen(false)} aria-label="Tutup">×</button>
        </header>
        <div className="vp-pad flex flex-col gap-3">
          <label className="vp-sub">JUDUL</label>
          <input
            className="vp-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tambah test idempotensi refund"
          />

          <label className="vp-sub">PENANGGUNG JAWAB</label>
          <select
            className="vp-input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.name} value={a.name}>{a.displayName}</option>
            ))}
          </select>

          <label className="vp-sub">DETAIL (OPSIONAL)</label>
          <textarea
            className="vp-input"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Konteks, kriteria penerimaan"
          />

          <label className="vp-sub">PRIORITAS</label>
          <input
            className="vp-input"
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />

          <button className="vp-btn" disabled={busy || !title.trim()} onClick={submit}>
            {busy ? 'Mengirim…' : 'Kirim ke antrean'}
          </button>
          {note && <div className="vp-note">{note}</div>}
        </div>
      </div>
    </div>
  )
}
