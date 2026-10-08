'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'
import { fetchJson } from '@/lib/api'
import ModelPicker, { type ModelChoice } from './ModelPicker'
import { DIVISION_LABEL, type AgentDivision } from '@/types/hermes'

/**
 * Spawn prompt for a DUMMY avatar.
 *
 * A dummy is decoration: a row in `avatar_state` with `kind: 'dummy'` and no model
 * behind it. Clicking one offers to replace it with a REAL Hermes agent — that is
 * the only way an avatar in this office ever starts costing tokens (poin 4 + 10).
 *
 * The agent keeps the dummy's id, so the DB row (and therefore the seat) carries
 * over instead of spawning a second body.
 */
export default function DummySpawnDialog({
  avatarId,
  division,
  onClose,
}: {
  avatarId: string
  division: AgentDivision
  onClose: () => void
}) {
  const agents = useOffice((s) => s.agents)
  const loadOffice = useOffice((s) => s.loadOffice)

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [models, setModels] = useState<ModelChoice[]>([])
  /** '' = bawaan Hermes: tidak memilih berarti tidak memaksa model apa pun. */
  const [model, setModel] = useState('')
  /** Laporan hasil spawn. Dialog sengaja TIDAK langsung tertutup supaya operator
   *  melihat model yang benar-benar dipakai, bukan sekadar avatar yang berubah. */
  const [done, setDone] = useState<string | null>(null)

  // Katalog model = config Hermes, bukan daftar hardcode; dimuat sekali per dialog.
  useEffect(() => {
    let alive = true
    fetchJson<{ models?: ModelChoice[] }>('/api/hermes/models', { cache: 'no-store' }).then((res) => {
      if (alive && res.ok) setModels(res.data?.models || [])
    })
    return () => {
      alive = false
    }
  }, [])

  // Default the name to a free profile in this division, so the common case is
  // one click.
  useEffect(() => {
    // Setelah spawn, loadOffice() memperbarui `agents`; tanpa penjaga ini nama di
    // field melompat ke slot bebas berikutnya tepat saat laporan ditampilkan.
    if (done) return
    const taken = new Set(agents.map((a) => a.name))
    const base = division === 'tech' ? 'dev' : division === 'growth' ? 'mkt' : 'content'
    for (let i = 1; i < 50; i++) {
      const cand = `${base}-${i}`
      if (!taken.has(cand)) {
        setName(cand)
        return
      }
    }
  }, [agents, division, done])

  async function spawn() {
    if (done) return
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!clean) {
      setNote('Nama agent wajib diisi.')
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/hermes/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: clean,
          division,
          role: 'manager',
          model: model || undefined,
          provider: model ? models.find((m) => m.model === model)?.provider : undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string }
        model?: string | null
        modelError?: string | null
      }
      if (!res.ok) {
        setNote(body?.error?.message || 'gagal membuat profile')
        setBusy(false)
        return
      }
      // Claim the dummy's row: same id, now a real agent. The scene re-renders it
      // as an agent on the next poll.
      await fetch('/api/hermes/office', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'saveAvatars',
          list: [{ avatarId, name: clean, division, kind: 'agent', x: 0, z: 0, level: 0, activity: 'idle', facing: 0, spawned: true }],
        }),
      })
      await loadOffice()
      // Dari balasan server, bukan dari pilihan form: set-model bisa gagal walau
      // profilnya sudah jadi.
      setDone(
        body.model
          ? `Agent "${clean}" di-spawn dengan model ${body.model}.`
          : body.modelError
            ? `Agent "${clean}" di-spawn, tapi model GAGAL diset (${body.modelError}) — sementara pakai bawaan Hermes. Ganti lewat panel Agent.`
            : `Agent "${clean}" di-spawn dengan model bawaan Hermes.`,
      )
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Spawn agent di slot ini</h3>
        <p className="vp-sub">
          Slot ini masih avatar dummy (gratis, tidak pakai token). Kalau di-spawn, dia jadi agent
          Hermes asli dengan SOUL.md dan mulai bisa mengerjakan tugas — dan mulai pakai token.
        </p>
        <label className="vp-field">
          <span>Nama agent</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="dev-1"
            disabled={busy || !!done}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void spawn()
            }}
          />
        </label>
        <label className="vp-field">
          <span>Model AI</span>
          <ModelPicker
            value={model}
            onChange={setModel}
            models={models}
            disabled={busy || !!done}
            emptyLabel="bawaan Hermes"
            title="Model untuk agent ini (kosong = bawaan Hermes)"
          />
        </label>
        <p className="vp-muted">Divisi: {DIVISION_LABEL[division]}</p>
        {note && <p className="vp-error">{note}</p>}
        {done && <div className="vp-ok">{done}</div>}
        <div className="vp-modal-actions">
          {done ? (
            <button className="vp-btn primary" onClick={onClose} autoFocus>
              Tutup
            </button>
          ) : (
            <>
              <button className="vp-btn" onClick={onClose} disabled={busy}>
                Batal
              </button>
              <button className="vp-btn primary" onClick={() => void spawn()} disabled={busy}>
                {busy ? 'Membuat…' : 'Spawn agent'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
