'use client'

import { useEffect, useState } from 'react'

/**
 * Spawn / kill control.
 *
 * An agent exists in the office when its Hermes profile is an assignee, so this
 * panel toggles office MEMBERSHIP (src/lib/hermes/office-membership.ts) rather
 * than deleting anything: killing a profile removes its avatar, not its work. Its
 * tasks stay on the board.
 *
 * Spawn and kill both animate through the front door — the agent walks in, or
 * walks out and despawns on arrival — which is why the button does not need to
 * say "this takes a second".
 */

type Row = {
  name: string
  total: number
  /** The profile exists on disk, not only as a task assignee. */
  profile: boolean
  inOffice: boolean
  reason: string | null
}

export default function AgentSpawnPanel({
  open,
  onClose,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch('/api/hermes/agents', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      setRows(d.available || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  async function act(action: 'spawn' | 'kill', name: string) {
    setBusy(name)
    setErr(null)
    setNote(null)
    try {
      const r = await fetch('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function create() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setErr(null)
    setNote(null)
    try {
      const r = await fetch('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, description: newDesc.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      setNewName('')
      setNewDesc('')
      setNote(`profil "${d.name}" dibuat — agent berjalan masuk lewat pintu utama`)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  const inOffice = rows.filter((r) => r.inOffice)
  const out = rows.filter((r) => !r.inOffice)

  return (
    <aside className="vp-panel right-0">
      <header className="vp-panel-head">
        <h2>Agent</h2>
        <button className="vp-x" onClick={onClose} aria-label="Tutup">
          ×
        </button>
      </header>

      <div className="vp-pad flex flex-col gap-3">
        <div className="vp-kv">
          <span>di kantor</span>
          <b>{inOffice.length}</b>
        </div>
        <div className="vp-kv">
          <span>profil tersedia</span>
          <b>{rows.length}</b>
        </div>

        {err && <div className="vp-err">{err}</div>}
        {note && <div className="vp-ok">{note}</div>}
        {loading && <div className="vp-muted">memuat…</div>}

        <div className="vp-sub">BUAT PROFIL BARU</div>
        <input
          className="vp-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="budi"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />
        <input
          className="vp-input"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="deskripsi"
        />
        <button
          className="vp-btn"
          disabled={creating || !newName.trim()}
          onClick={create}
        >
          {creating ? 'Membuat…' : '+ Buat profil'}
        </button>

        <button className="vp-btn vp-btn-rosy" disabled={!!busy} onClick={load}>
          Segarkan
        </button>

        <div className="vp-sub">DI KANTOR ({inOffice.length})</div>
        <div className="flex flex-col gap-2">
          {inOffice.map((r) => (
            <div key={r.name} className="vp-agent-row">
              <div className="vp-agent-meta">
                <b>
                  {r.name}
                  {!r.profile && <span className="vp-tag-warn">tanpa profil</span>}
                </b>
                <i>{r.total} tugas</i>
              </div>
              <button
                className="vp-btn vp-btn-danger"
                disabled={busy === r.name}
                onClick={() => act('kill', r.name)}
                title="Agent berjalan keluar lewat pintu utama, lalu menghilang"
              >
                {busy === r.name ? '…' : 'Kill'}
              </button>
            </div>
          ))}
          {!inOffice.length && <span className="vp-muted">kosong</span>}
        </div>

        {out.length > 0 && (
          <>
            <div className="vp-sub">DI LUAR ({out.length})</div>
            <div className="flex flex-col gap-2">
              {out.map((r) => (
                <div key={r.name} className="vp-agent-row off">
                  <div className="vp-agent-meta">
                    <b>
                      {r.name}
                      {!r.profile && <span className="vp-tag-warn">tanpa profil</span>}
                    </b>
                    <i>{r.reason === 'killed' ? 'dimatikan' : 'tanpa tugas'}</i>
                  </div>
                  <button
                    className="vp-btn"
                    disabled={busy === r.name}
                    onClick={() => act('spawn', r.name)}
                    title="Agent masuk lewat pintu utama dan berjalan ke mejanya"
                  >
                    {busy === r.name ? '…' : 'Spawn'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
