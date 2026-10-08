'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import ModelPicker, { type ModelChoice } from './ModelPicker'
import type { AgentDivision, AgentRole } from '@/types/hermes'
import { DIVISION_LABEL } from '@/types/hermes'
import { ROLE_LABEL } from '@/lib/hermes/soul'
import FullPanel from './FullPanel'

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
  /** Role dari route agents GET; null/undefined bila backend lama. */
  role?: AgentRole | string | null
  /** Divisi dari route agents GET; null/undefined bila backend lama. */
  division?: AgentDivision | string | null
  /** True bila profil punya SOUL.md sendiri. */
  soulExists?: boolean | null
  /** Keahlian/domain (dipakai office, bukan A2A). */
  domains?: string[]
  /**
   * Status A2A jujur: 'served' = terdaftar di platforms.a2a.agents,
   * 'unlisted' = belum didaftarkan. Bukan "aktif" — berlaku pasca-restart.
   */
  a2a?: 'served' | 'unlisted' | null
}

/** Batas izin per role dari route agents GET (tabel tunggal di control.ts). */
type Permissions = Record<string, { allow: string[]; deny: string[]; anyTask: boolean }>

const ROLE_OPTIONS = Object.entries(ROLE_LABEL) as [AgentRole, string][]
const DIVISION_OPTIONS = Object.entries(DIVISION_LABEL) as [AgentDivision, string][]

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
  const [perms, setPerms] = useState<Permissions>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newRole, setNewRole] = useState<AgentRole>('backend')
  const [newDivision, setNewDivision] = useState<AgentDivision>('tech')
  const [newSoul, setNewSoul] = useState('')
  /**
   * Keahlian/domain: freetext koma ("meta-ads, reporting"). Disimpan di
   * marker SOUL.md (pemetaan office), TIDAK diumumkan ke A2A — skills di
   * agent card hanya bisa berisi toolset Hermes yang nyata.
   */
  const [newDomains, setNewDomains] = useState('')
  /**
   * Toolset yang diumumkan di agent card. Kosong = semua toolset.
   * Hanya nama toolset nyata (dari /api/hermes/toolsets), bukan tag bebas.
   */
  const [newToolsets, setNewToolsets] = useState<string[]>([])
  const [toolsetCatalog, setToolsetCatalog] = useState<{ name: string; enabled: boolean }[]>([])
  /**
   * Toggle A2A: default MATI. Hidup = daftarkan served-agent (local:false).
   * Berlaku setelah gateway di-restart — form tidak janji "langsung aktif".
   */
  const [newServeA2a, setNewServeA2a] = useState(false)
  /** Domain yang tidak punya pemilik: dinyatakan apa adanya, bukan diarang. */
  const [domainOwners, setDomainOwners] = useState<Record<string, string | null>>({})
  /** Model untuk profil yang SEDANG dibuat; '' = bawaan Hermes. Terpisah dari `pick`
   *  (ganti model profil yang sudah ada) supaya dua alur itu tidak saling menimpa. */
  const [newModel, setNewModel] = useState('')
  const [soulPreview, setSoulPreview] = useState<string | null>(null)
  const [divFilter, setDivFilter] = useState<'all' | AgentDivision>('all')
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
      const res = await fetchJson<{ available?: Row[]; permissions?: Permissions; domainOwners?: Record<string, string | null> }>('/api/hermes/agents', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(res.error || 'gagal memuat daftar agent')
      setRows(res.data?.available || [])
      setPerms(res.data?.permissions || {})
      setDomainOwners(res.data?.domainOwners || {})
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  // Katalog toolset + model: config, bukan roster — fetch sekali per buka.
  useEffect(() => {
    if (!open) return
    if (!models.length) {
      let alive = true
      fetchJson<{ models?: ModelChoice[] }>('/api/hermes/models', { cache: 'no-store' }).then((res) => {
        if (alive && res.ok) setModels(res.data?.models || [])
      })
      return () => {
        alive = false
      }
    }
  }, [open, models.length])
  useEffect(() => {
    if (!open || toolsetCatalog.length) return
    let alive = true
    fetchJson<{ toolsets?: { name: string; enabled: boolean }[] }>('/api/hermes/toolsets', { cache: 'no-store' }).then((res) => {
      if (alive && res.ok) setToolsetCatalog(res.data?.toolsets || [])
    })
    return () => {
      alive = false
    }
  }, [open, toolsetCatalog.length])

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
    setSoulPreview(null)
    try {
      const hit = models.find((m) => m.model === newModel)
      const res = await fetchJson<{
        name: string
        soulPreview?: string
        model?: string | null
        modelError?: string | null
        domains?: string[]
        a2aRegistered?: boolean | null
        a2aError?: string | null
        a2aNote?: string | null
      }>('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name,
          description: newDesc.trim(),
          role: newRole,
          division: newDivision,
          soul: newSoul.trim(),
          domains: newDomains.trim(),
          advertisedToolsets: newToolsets,
          serveA2a: newServeA2a,
          model: newModel || undefined,
          provider: newModel ? hit?.provider : undefined,
        }),
      })
      if (!res.ok || !res.data) throw new Error(res.error || 'gagal membuat profil')
      setNewName('')
      setNewDesc('')
      setNewSoul('')
      setNewDomains('')
      setNewToolsets([])
      setNewServeA2a(false)
      setNewModel('')
      setSoulPreview(res.data.soulPreview ?? null)
      // Laporkan model dari BALASAN server, bukan dari pilihan di form: kalau set-model
      // gagal, operator harus tahu agent ini jalan dengan bawaan Hermes.
      const modelNote = res.data.model
        ? `model ${res.data.model}`
        : res.data.modelError
          ? `model GAGAL diset (${res.data.modelError}) — sementara pakai bawaan Hermes`
          : 'model bawaan Hermes'
      const domNote = res.data.domains?.length ? `keahlian: ${res.data.domains.join(', ')} (pemetaan office, bukan A2A). ` : ''
      const a2aNote = res.data.a2aRegistered === true
        ? `${res.data.a2aNote ?? 'Tersimpan. Berlaku setelah gateway di-restart.'} `
        : res.data.a2aRegistered === false
          ? `GAGAL didaftarkan A2A (${res.data.a2aError}) — profilnya ada tapi belum terdaftar. `
          : ''
      setNote(`profil "${res.data.name}" dibuat, ${modelNote} — agent berjalan masuk lewat pintu utama. ${domNote}${a2aNote}`)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  const matchDiv = (r: Row) => divFilter === 'all' || r.division === divFilter
  const inOffice = rows.filter((r) => r.inOffice && matchDiv(r))
  const out = rows.filter((r) => !r.inOffice && matchDiv(r))

  /** Badge role + divisi + indikator soul + status A2A. Aman bila field null (backend lama). */
  function badges(r: Row) {
    const roleLabel = r.role ? (ROLE_LABEL as Record<string, string>)[r.role] ?? r.role : null
    const divLabel = r.division ? (DIVISION_LABEL as Record<string, string>)[r.division] ?? null : null
    return (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
        {roleLabel && (
          <span className="vp-chip" title={`role: ${r.role}`}>
            {roleLabel}
          </span>
        )}
        {divLabel && (
          <span className="vp-chip" title={`divisi: ${r.division}`}>
            {divLabel}
          </span>
        )}
        {(r.domains?.length ?? 0) > 0 && (
          <span className="vp-chip" title={`keahlian (pemetaan office, bukan A2A): ${(r.domains ?? []).join(', ')}`}>
            {(r.domains ?? []).join(', ')}
          </span>
        )}
        {r.soulExists === true && (
          <span className="vp-chip" title="Profil ini punya SOUL.md sendiri">
            soul ✓
          </span>
        )}
        {r.soulExists === false && <span className="vp-tag-warn">tanpa soul</span>}
        {r.a2a === 'served' && (
          <span className="vp-chip" title="Terdaftar di platforms.a2a.agents — berlaku setelah gateway di-restart">
            A2A terdaftar
          </span>
        )}
        {r.a2a === 'unlisted' && (
          <span className="vp-tag-warn" title="Profil ada tapi belum didaftarkan di platforms.a2a.agents">
            belum terdaftar A2A
          </span>
        )}
      </span>
    )
  }

  /** Satu baris batas izin untuk role agent ini. Kosong bila role/tabel tidak ada. */
  function limits(r: Row) {
    const p = r.role ? perms[r.role] : undefined
    if (!p) return null
    const allow = p.allow.length
      ? p.allow.join(', ') + (p.anyTask ? '' : ' (task sendiri)')
      : '—'
    return (
      <span className="vp-muted" style={{ fontSize: 11 }} title="Batas izin bila aksi diminta atas nama agent ini">
        boleh: {allow} · tidak boleh: {p.deny.length ? p.deny.join(', ') : '—'}
      </span>
    )
  }

  return (
    <FullPanel onClose={onClose} label="Agent" title="Agent" bodyClassName="vp-pad flex flex-col gap-3">
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
      {soulPreview && (
        <div className="vp-ok">
          <b>Soul tersimpan:</b>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 11 }}>{soulPreview}</pre>
        </div>
      )}
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
      {/*
        Deskripsi = `description` di agent card A2A: teks yang dibaca agent
        pemanggil untuk memutuskan "ini orangnya". Tulis BUAT DIBACA AGENT
        LAIN (kosakata domain yang akan dicari), bukan sekadar label manusia.
      */}
      <textarea
        className="vp-input"
        value={newDesc}
        onChange={(e) => setNewDesc(e.target.value)}
        placeholder="Deskripsi agent card — DIBACA AGENT LAIN saat discovery. Tulis kosakata domain yang akan dicari, cth: Menangani iklan Meta & Google: budget, CPA, laporan performa mingguan. Hubungi kalau butuh angka spend atau hasil kampanye."
        rows={2}
      />
      {/*
        Keahlian/domain: daftar koma ("meta-ads, reporting"). Dipakai OFFICE
        untuk pemetaan domain→pemilik — TIDAK diumumkan ke A2A (skills di card
        hanya bisa berisi toolset Hermes yang nyata, lihat pilihan di bawah).
      */}
      <input
        className="vp-input"
        value={newDomains}
        onChange={(e) => setNewDomains(e.target.value)}
        placeholder="Keahlian/domain, pisah koma — cth: meta-ads, reporting, budget (pemetaan office, bukan A2A)"
      />
      <div className="flex gap-2">
        <select
          className="vp-input"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as AgentRole)}
          title="Role agent"
        >
          {ROLE_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="vp-input"
          value={newDivision}
          onChange={(e) => setNewDivision(e.target.value as AgentDivision)}
          title="Divisi agent"
        >
          {DIVISION_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="vp-input"
        value={newSoul}
        onChange={(e) => setNewSoul(e.target.value)}
        placeholder="cth: Budi adalah CEO visioner — ambil keputusan akhir, bagi tugas ke tiap divisi, jaga visi perusahaan. Gaya: tegas, ringkas, eksekusi langsung. (opsional)"
        rows={3}
      />
      <ModelPicker
        value={newModel}
        onChange={setNewModel}
        models={models}
        disabled={creating}
        emptyLabel="bawaan Hermes"
        title="Model untuk agent baru ini (kosong = bawaan Hermes)"
      />
      {/*
        Toolset yang DIUMUMKAN di agent card (`advertised_toolsets`). Hanya
        nama toolset nyata Hermes — skills di card diturunkan dari registry,
        bukan tag bebas. Kosong = umumkan semua toolset.
      */}
      <div className="vp-sub" title="Toolset nyata yang diumumkan di agent card A2A. Kosong = semua.">
        UMUMKAN DI AGENT CARD (KOSONG = SEMUA)
      </div>
      <div className="flex flex-wrap gap-1" style={{ maxHeight: 120, overflowY: 'auto' }}>
        {toolsetCatalog.map((t) => {
          const on = newToolsets.includes(t.name)
          return (
            <button
              key={t.name}
              type="button"
              className={`vp-chip-btn${on ? ' on' : ''}`}
              disabled={creating}
              onClick={() =>
                setNewToolsets((prev) => (prev.includes(t.name) ? prev.filter((x) => x !== t.name) : [...prev, t.name]))
              }
              title={`${t.name}${t.enabled ? '' : ' (nonaktif di install ini)'}`}
              style={{ opacity: t.enabled ? 1 : 0.55 }}
            >
              {on ? '✓ ' : ''}{t.name}
            </button>
          )
        })}
        {!toolsetCatalog.length && <span className="vp-muted">memuat daftar toolset…</span>}
      </div>
      {/*
        Toggle A2A: default MATI. Hidup = tulis entri served-agent
        (local:false, dijawab profil ini sendiri). BERLAKU SETELAH GATEWAY
        DI-RESTART — form tidak menampilkan "aktif" sebelum itu.
      */}
      <label className="flex items-center gap-2" style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={newServeA2a}
          disabled={creating}
          onChange={(e) => setNewServeA2a(e.target.checked)}
        />
        <span title="Daftarkan profil ini di platforms.a2a.agents (local:false). Berlaku setelah gateway di-restart.">
          Bisa dihubungi agent lain (A2A) — tersimpan, berlaku setelah gateway di-restart
        </span>
      </label>
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

      {/*
        Pemetaan domain→pemilik (dipakai office, bukan A2A). Domain tanpa
        pemilik = null → TAMPILKAN "tidak ada pemilik", jangan mengarang.
      */}
      {Object.keys(domainOwners).length > 0 && (
        <>
          <div className="vp-sub">SIAPA PEGANG APA (OFFICE, BUKAN A2A)</div>
          <div className="flex flex-col gap-1">
            {Object.entries(domainOwners).map(([d, owner]) => (
              <div key={d} className="vp-kv">
                <span>{d}</span>
                <b>{owner ?? 'tidak ada pemilik'}</b>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="vp-sub">FILTER DIVISI</div>
      <select
        className="vp-input"
        value={divFilter}
        onChange={(e) => setDivFilter(e.target.value as 'all' | AgentDivision)}
        title="Filter daftar agent per divisi"
      >
        <option value="all">Semua</option>
        {DIVISION_OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>

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
              {badges(r)}
              {limits(r)}
            </div>
            {/* The profile's default model: what its workers and chats run.
                Saving here writes `model.default` for that profile, so it
                applies to every future spawn — not just one task. */}
            {r.profile && (
              <div className="vp-agent-model">
                <ModelPicker
                  value={pick[r.name] ?? r.model ?? ''}
                  onChange={(model) => setPick((p) => ({ ...p, [r.name]: model }))}
                  models={models}
                  disabled={busy === r.name}
                  emptyLabel="bawaan Hermes"
                  title="Model bawaan profil ini"
                />
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
                  {badges(r)}
                  {limits(r)}
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
    </FullPanel>
  )
}
