'use client'

import { useEffect, useState } from 'react'
import { useOffice } from '@/lib/store'
import { fetchJson } from '@/lib/api'
import ModelPicker, { type ModelChoice } from './ModelPicker'
import RestartNotice from './RestartNotice'
import { DIVISION_LABEL, type AgentDivision, type AgentRole } from '@/types/hermes'

/**
 * Spawn prompt for a DUMMY avatar.
 *
 * A dummy is decoration: a row in `avatar_state` with `kind: 'dummy'` and no model
 * behind it. Clicking one offers to replace it with a REAL Hermes agent — that is
 * the only way an avatar in this office ever starts costing tokens (poin 4 + 10).
 *
 * Tiga hal yang DIPASTIKAN di sini (SPAWN-A2A-1):
 * - A2A OTOMATIS: pendaftaran served-agent default di SISI SERVER (route
 *   `agents` mendaftarkan kecuali serveA2a:false eksplisit) — jalur ini tidak
 *   perlu mengirim flag, dan TIDAK BOLEH mematikan.
 * - SATU BADAN: klaim slot lewat aksi server `claimAvatar` — baris kanonik
 *   `agent:<nama>` dipindah ke posisi slot, bukan dibuatkan baris kedua.
 * - Role mengikuti slot: manager = manager, staff = keahlian divisinya
 *   (tech→backend, growth→marketing, content→content, exec→manager).
 */

function roleForSlot(avatarId: string, division: AgentDivision): AgentRole {
  void avatarId
  if (division === 'tech') return 'backend'
  if (division === 'growth') return 'marketing'
  if (division === 'content') return 'content'
  return 'manager'
}

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
  /** Pop up "silahkan restart server" — Tampil setelah pendaftaran A2A sukses. */
  const [restartFor, setRestartFor] = useState<string | null>(null)

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
          // Role mengikuti slot (bukan hardcode 'manager' untuk semua).
          role: roleForSlot(avatarId, division),
          model: model || undefined,
          provider: model ? models.find((m) => m.model === model)?.provider : undefined,
          // A2A: TIDAK dikirim = server default NYALA (SPAWN-A2A-1).
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string }
        model?: string | null
        modelError?: string | null
        a2aRegistered?: boolean | null
        a2aError?: string | null
      }
      if (!res.ok) {
        setNote(body?.error?.message || 'gagal membuat profile')
        setBusy(false)
        return
      }
      // Daftarkan A2A GAGAL = katakan gagal — jangan tampilkan pop up sukses.
      // Profilnya tetap ada (server tidak membatalkan create), tapi operator
      // harus tahu dia belum terdaftar.
      if (body.a2aRegistered === false) {
        setNote(
          `Profil "${clean}" dibuat, tapi GAGAL didaftarkan A2A (${body.a2aError ?? 'sebab tak terbaca'}) — ` +
            `profilnya ada tapi belum terdaftar. Nyalakan manual lewat panel Agent.`,
        )
        setBusy(false)
        return
      }
      // Klaim slot lewat server: satu agent = satu baris kanonik. Gagal klaim
      // = laporkan jujur (profil sudah jadi, badan belum pindah).
      const claim = await fetch('/api/hermes/office', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'claimAvatar', avatarId, name: clean }),
      })
      const claimBody = (await claim.json().catch(() => ({}))) as {
        error?: { message?: string }
      }
      await loadOffice()
      if (!claim.ok) {
        setNote(
          `Profil "${clean}" dibuat dan terdaftar A2A, tapi badannya GAGAL pindah ke slot ` +
            `(${claimBody?.error?.message ?? 'sebab tak terbaca'}) — segarkan halaman; agent masuk lewat pintu utama.`,
        )
        setBusy(false)
        return
      }
      // Dari balasan server, bukan dari pilihan form: set-model bisa gagal walau
      // profilnya sudah jadi.
      setDone(
        body.model
          ? `Agent "${clean}" di-spawn dengan model ${body.model}.`
          : body.modelError
            ? `Agent "${clean}" di-spawn, tapi model GAGAL diset (${body.modelError}) — sementara pakai bawaan Hermes. Ganti lewat panel Agent.`
            : `Agent "${clean}" di-spawn dengan model bawaan Hermes.`,
      )
      // Pendaftaran A2A sukses (default NYALA) → pop up restart.
      if (body.a2aRegistered === true) setRestartFor(clean)
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (restartFor) return <RestartNotice agentName={restartFor} onClose={() => { setRestartFor(null); onClose() }} />

  return (
    <div className="vp-modal-backdrop" onClick={onClose}>
      <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Spawn agent di slot ini</h3>
        <p className="vp-sub">
          Slot ini masih avatar dummy (gratis, tidak pakai token). Kalau di-spawn, dia jadi agent
          Hermes asli dengan SOUL.md dan mulai bisa mengerjakan tugas — dan mulai pakai token.
        </p>
        <p className="vp-note">
          Otomatis terdaftar A2A; berlaku setelah gateway restart. Role slot ini: {roleForSlot(avatarId, division)}.
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
