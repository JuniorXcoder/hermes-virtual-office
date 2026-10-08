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

  async function load() {
    setLoading(true)
    setErr(null)
    const res = await fetchJson<DoctorReport>('/api/hermes/doctor', { cache: 'no-store' })
    if (!res.ok) setErr(res.error || 'gagal menjalankan pemeriksaan')
    else setData(res.data ?? null)
    setLoading(false)
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
        <button className="vp-chip-btn" onClick={() => void load()} disabled={loading}>
          {loading ? '…' : 'Periksa lagi'}
        </button>
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
          <div className="vp-note" style={{ marginTop: 8 }}>
            Rapat simulasi butuh AI_BASE_URL+AI_API_KEY · rapat a2a tidak butuh itu, tapi butuh ≥2 agent
            di-serve · daftar served dibaca sekali saat gateway boot (ubah → restart).
          </div>
        </>
      )}
    </FullPanel>
  )
}
