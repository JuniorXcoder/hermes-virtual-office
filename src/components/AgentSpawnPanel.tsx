'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'

/**
 * Spawn / hide / kill control.
 *
 * "Sembunyikan" and "Spawn" toggle office MEMBERSHIP
 * (src/lib/hermes/office-membership.ts): the avatar leaves or enters, the profile
 * and its tasks are untouched. "Kill" is the destructive one — it deletes the
 * profile and purges its tasks — so it is only offered when a profile exists and
 * asks for a second click.
 */

type Row = {
  name: string
  total: number
  /** The profile exists on disk, not only as a task assignee. */
  profile: boolean
  inOffice: boolean
  reason: string | null
  /** The profile's default model, when it has one. */
  model?: string | null
}

type ModelChoice = { model: string; provider: string; label: string }

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
  /** id awaiting the second click before a destructive delete. */
  const [confirmKill, setConfirmKill] = useState<string | null>(null)
  const [models, setModels] = useState<ModelChoice[]>([])
  /** name -> model being picked but not yet saved. */
  const [pick, setPick] = useState<Record<string, string>>({})

  // A click anywhere else cancels a pending delete.
  useEffect(() => {
    if (!confirmKill) return
    const cancel = () => setConfirmKill(null)
    window.addEventListener('click', cancel)
    return () => window.removeEventListener('click', cancel)
  }, [confirmKill])

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetchJson<{ available?: Row[] }>('/api/hermes/agents', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(res.error || 'gagal memuat daftar agent')
      setRows(res.data?.available || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  // The catalogue is config, not roster state — fetch it once per opening.
  useEffect(() => {
    if (!open || models.length) return
    let alive = true
    fetchJson<{ models?: ModelChoice[] }>('/api/hermes/models', { cache: 'no-store' }).then((res) => {
      if (alive && res.ok) setModels(res.data?.models || [])
    })
    return () => {
      alive = false
    }
  }, [open, models.length])

  async function setModel(name: string, model: string) {
    setBusy(name)
    setErr(null)
    setNote(null)
    try {
      const hit = models.find((m) => m.model === model)
      const res = await fetchJson('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-model', name, model, provider: hit?.provider }),
      })
      if (!res.ok) throw new Error(res.error || 'gagal menyimpan model')
      setNote(`Model "${name}" diset ke ${model} — berlaku pada spawn/chat berikutnya.`)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function act(action: 'spawn' | 'hide' | 'kill', name: string) {
    setBusy(name)
    setErr(null)
    setNote(null)
    try {
      const res = await fetchJson<{ purged?: number }>('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      })
      if (!res.ok) throw new Error(res.error || 'aksi gagal')
      const d = res.data
      if (action === 'kill') {
        const n = Number(d?.purged ?? 0)
        setNote(
          n > 0
            ? `"${name}" dihapus permanen bersama ${n} tugasnya`
            : `"${name}" dihapus permanen`,
        )
      } else if (action === 'hide') {
        setNote(`"${name}" disembunyikan — tugasnya tetap di papan`)
      }
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
      const res = await fetchJson<{ name: string }>('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, description: newDesc.trim() }),
      })
      if (!res.ok || !res.data) throw new Error(res.error || 'gagal membuat profil')
      setNewName('')
      setNewDesc('')
      setNote(`profil "${res.data.name}" dibuat — agent berjalan masuk lewat pintu utama`)
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
              {/* The profile's default model: what its workers and chats run.
                  Saving here writes `model.default` for that profile, so it
                  applies to every future spawn — not just one task. */}
              {r.profile && (
                <div className="vp-agent-model">
                  <select
                    className="vp-input"
                    value={pick[r.name] ?? r.model ?? ''}
                    disabled={busy === r.name}
                    onChange={(e) => setPick((p) => ({ ...p, [r.name]: e.target.value }))}
                    title="Model bawaan profil ini"
                  >
                    <option value="">bawaan Hermes</option>
                    {models.map((m) => (
                      <option key={`${m.provider}/${m.model}`} value={m.model}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="vp-btn"
                    disabled={busy === r.name || (pick[r.name] ?? r.model ?? '') === (r.model ?? '')}
                    onClick={(e) => {
                      e.stopPropagation()
                      void setModel(r.name, pick[r.name] ?? '')
                    }}
                  >
                    {busy === r.name ? '…' : 'Set'}
                  </button>
                </div>
              )}
              {/* Two different things, so two different buttons, and now two
                  different actions. A name with no profile on disk is an assignee
                  left behind by a task whose profile was deleted — there is
                  nothing to delete, and hiding it is the ONLY safe operation:
                  sending it to `kill` purged its tasks permanently while the
                  button said "tanpa menghapus apa pun". */}
              <div className="flex gap-2">
                <button
                  className="vp-btn"
                  disabled={busy === r.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    void act('hide', r.name)
                  }}
                  title="Keluarkan nama ini dari kantor tanpa menghapus apa pun"
                >
                  {busy === r.name ? '…' : 'Sembunyikan'}
                </button>
                {r.profile && (
                  <button
                    className={`vp-btn vp-btn-danger ${confirmKill === r.name ? 'vp-btn-armed' : ''}`}
                    disabled={busy === r.name}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirmKill !== r.name) {
                        setConfirmKill(r.name)
                        return
                      }
                      void act('kill', r.name)
                    }}
                    title="Menghapus profil ini permanen, termasuk sesi dan kuncinya"
                  >
                    {busy === r.name ? '…' : confirmKill === r.name ? 'Yakin hapus?' : 'Kill'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {confirmKill && (
            <div className="vp-cron-err">
              Menghapus <b>{confirmKill}</b> permanen — profil, sesi, memori, kunci,
              <b> dan {inOffice.find((x) => x.name === confirmKill)?.total ?? 0} tugasnya</b>.
              Klik di tempat lain untuk batal.
            </div>
          )}
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
                    <i>
                      {r.reason === 'hidden'
                        ? 'disembunyikan'
                        : r.reason === 'no_profile'
                          ? 'tanpa profil di disk'
                          : 'tanpa tugas'}
                    </i>
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
