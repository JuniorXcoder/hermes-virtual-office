'use client'

/**
 * Panel "SIAP PAKAI?" (doctor) — tiap periksa tampil lulus/gagal/tidak-pasti
 * + langkah perbaikan yang bisa disalin.
 *
 * Aturan jujur: 'unknown' tampil ABU ("tidak bisa dipastikan"), bukan hijau.
 * Hijau hanya untuk yang benar-benar terverifikasi.
 */

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import FullPanel from './FullPanel'
import type { DoctorReport, DoctorStatus } from '@/lib/hermes/doctor'
import type { RepairPreview, RepairResult } from '@/lib/hermes/selfrepair'

function dot(s: DoctorStatus): string {
  if (s === 'pass') return 'ok'
  if (s === 'fail') return 'bad'
  return 'warn'
}

function word(s: DoctorStatus): string {
  if (s === 'pass') return 'LULUS'
  if (s === 'fail') return 'GAGAL'
  return 'TAK PASTI'
}

function Row({ id, label, status, detail, fix }: { id: string; label: string; status: DoctorStatus; detail: string; fix: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(fix)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard ditolak browser: teksnya tetap terlihat, bisa disalin manual
    }
  }
  return (
    <div className="vp-meeting-row" data-doctor-id={id}>
      <div className="flex items-center justify-between gap-2">
        <b>
          <span className={`vp-dot ${dot(status)}`} /> {label}
        </b>
        <i data-doctor-status={status}>{word(status)}</i>
      </div>
      <div className="vp-note">{detail}</div>
      {fix && (
        <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
          <textarea rows={2} readOnly value={fix} aria-label={`Perbaikan: ${label}`} style={{ width: '100%' }} />
          <div>
            <button className="vp-chip-btn" onClick={() => void copy()}>
              {copied ? 'tersalin ✓' : 'salin perbaikan'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DoctorPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<DoctorReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // SELFREPAIR-1 Celah 2: pratinjau dulu (GET), jalankan (POST), lalu tampilkan
  // doctor SESUDAH — bukan klaim "beres".
  const [preview, setPreview] = useState<RepairPreview | null>(null)
  const [repairing, setRepairing] = useState(false)
  const [repair, setRepair] = useState<RepairResult | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    const res = await fetchJson<DoctorReport>('/api/hermes/doctor', { cache: 'no-store' })
    if (!res.ok) setErr(res.error || 'gagal menjalankan pemeriksaan')
    else setData(res.data ?? null)
    setLoading(false)
  }

  /** Pratinjau perbaikan: apa yang akan diubah + apa yang tak bisa. */
  async function loadPreview() {
    setRepairing(true)
    setErr(null)
    try {
      const res = await fetchJson<RepairPreview>('/api/hermes/selfrepair', { cache: 'no-store' })
      if (!res.ok || !res.data) throw new Error(res.error || 'gagal memuat pratinjau perbaikan')
      setPreview(res.data)
      setRepair(null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRepairing(false)
    }
  }

  /** Jalankan perbaikan, lalu tampilkan doctor SESUDAH (dari balasan server). */
  async function runRepair() {
    setRepairing(true)
    setErr(null)
    try {
      const res = await fetchJson<{ result?: RepairResult; doctor?: DoctorReport }>('/api/hermes/selfrepair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok || !res.data?.result) throw new Error(res.error || 'gagal menjalankan perbaikan')
      setRepair(res.data.result)
      if (res.data.doctor) setData(res.data.doctor)
      setPreview(null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRepairing(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  if (!open) return null

  const bad = data?.checks.filter((c) => c.status === 'fail').length ?? 0
  const unknown = data?.checks.filter((c) => c.status === 'unknown').length ?? 0

  return (
    <FullPanel
      onClose={onClose}
      label="Siap pakai?"
      title="Siap pakai?"
      tall
      actions={
        <>
          <button className="vp-chip-btn" onClick={() => void load()} disabled={loading}>
            {loading ? '…' : 'Periksa lagi'}
          </button>
          <button className="vp-chip-btn" onClick={() => void loadPreview()} disabled={repairing}>
            {repairing ? '…' : 'pratinjau perbaikan'}
          </button>
        </>
      }
    >
      {err && <div className="vp-err">{err}</div>}
      {loading && !data && <div className="vp-muted">memeriksa…</div>}
      {data && (
        <>
          <div className="vp-note">
            {bad === 0 && unknown === 0
              ? `semua ${data.checks.length} periksa lulus.`
              : `${bad} gagal · ${unknown} tak pasti · dari ${data.checks.length} periksa.`}{' '}
            Tak pasti = tidak bisa dipastikan, bukan lulus.
          </div>
          {data.checks.map((c) => (
            <Row key={c.id} id={c.id} label={c.label} status={c.status} detail={c.detail} fix={c.fix} />
          ))}
          {/* SELFREPAIR-1 Celah 2: pratinjau → jalankan → laporan + doctor sesudah. */}
          {preview && (
            <div className="vp-meeting-row" data-doctor-id="selfrepair-preview">
              <div className="flex items-center justify-between gap-2">
                <b>Pratinjau perbaikan</b>
                <i>{preview.planned.length} akan diubah · {preview.unfixable.length} tak bisa</i>
              </div>
              {preview.planned.length > 0 ? (
                <div className="vp-note">
                  {preview.planned.map((p, i) => (
                    <div key={i}>• {p.what}</div>
                  ))}
                </div>
              ) : (
                <div className="vp-note">tidak ada yang perlu diperbaiki — keadaan sudah sehat.</div>
              )}
              {preview.unfixable.length > 0 && (
                <div className="vp-note">
                  tak bisa diperbaiki otomatis:
                  {preview.unfixable.map((u, i) => (
                    <div key={i}>• {u.target}: {u.why}</div>
                  ))}
                </div>
              )}
              {preview.planned.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button className="vp-chip-btn" onClick={() => void runRepair()} disabled={repairing}>
                    {repairing ? '…' : `jalankan ${preview.planned.length} perbaikan`}
                  </button>
                </div>
              )}
            </div>
          )}
          {repair && (
            <div className="vp-meeting-row" data-doctor-id="selfrepair-result">
              <div className="flex items-center justify-between gap-2">
                <b>Hasil perbaikan</b>
                <i>{repair.failed.length ? `${repair.failed.length} gagal` : 'selesai'}</i>
              </div>
              <div className="vp-note">
                {repair.a2aRemoved.length > 0 && <div>entri served dicabut: {repair.a2aRemoved.join(', ')}</div>}
                {repair.avatarRemoved.length > 0 && <div>baris avatar dihapus: {repair.avatarRemoved.join(', ')}</div>}
                {repair.avatarMerged.map((m, i) => (
                  <div key={i}>baris {m.agent} digabung → {m.kept} (buang: {m.dropped.join(', ')})</div>
                ))}
                {repair.toolsetAdded.length > 0 && <div>toolset a2a ditambah ke: {repair.toolsetAdded.join(', ')}</div>}
                {repair.peerAdded.length > 0 && <div>peer a2a_agents didaftarkan untuk: {repair.peerAdded.join(', ')}</div>}
                {repair.providerFixed.length > 0 && <div>definisi provider disalin ke: {repair.providerFixed.join(', ')}</div>}
                {repair.dirsRemoved.length > 0 && <div>sisa direktori dibersihkan: {repair.dirsRemoved.join(', ')}</div>}
                {!repair.a2aRemoved.length && !repair.avatarRemoved.length && !repair.avatarMerged.length &&
                  !repair.toolsetAdded.length && !repair.peerAdded.length && !repair.providerFixed.length && !repair.dirsRemoved.length &&
                  !repair.failed.length && <div>tidak ada yang berubah — keadaan sudah sehat (idempoten).</div>}
                {repair.failed.map((f, i) => (
                  <div key={`f${i}`}>GAGAL {f.target}: {f.why}</div>
                ))}
                {repair.unfixable.length > 0 && (
                  <div>tak bisa diperbaiki otomatis: {repair.unfixable.map((u) => `${u.target} (${u.why})`).join('; ')}</div>
                )}
              </div>
              <div className="vp-note" style={{ marginTop: 4 }}>
                Doctor di atas adalah keadaan SESUDAH perbaikan (diperiksa ulang server) — bukan klaim.
              </div>
            </div>
          )}
          <div className="vp-note" style={{ marginTop: 8 }}>
            Rapat simulasi butuh AI_BASE_URL+AI_API_KEY · rapat a2a tidak butuh itu, tapi butuh ≥2 agent
            di-serve · daftar served dibaca sekali saat gateway boot (ubah → restart).
          </div>
        </>
      )}
    </FullPanel>
  )
}
