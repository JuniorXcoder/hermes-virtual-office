'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import { VERIFICATION_BATCH_CAP, VERIFICATION_MARK_LABEL, type VerificationMark } from '@/lib/hermes/verification'
import type { Task } from '@/types/hermes'

type MarkRow = { id: string; mark: VerificationMark }

/** Penanda lebih tua dari ini dibaca ulang. Satu batch = sampai 40 proses `hermes`, jadi tidak tiap poll. */
export const STALE_VERIFICATION = 300

export type VerificationMarks = {
  /** null = belum terbaca atau gagal; kartu harus netral, bukan memakai penanda lama. */
  byId: Record<string, VerificationMark> | null
  readAt: number | null
  error: string | null
  busy: boolean
}

/**
 * Penanda verifikasi RINGKAS untuk kartu (POST /api/hermes/tasks/verification).
 *
 * Yang dikirim hanya task `done` dan `review` — task lain tidak dinilai (verdict `open` tak punya
 * penanda). Diurut terbaru dulu, maksimal VERIFICATION_BATCH_CAP; sisanya tampil netral seperti
 * `unchecked`. Dibaca ulang saat himpunan id berubah atau saat penandanya sudah basi — bukan
 * pada tiap poll papan.
 */
export function useVerificationMarks(tasks: Task[]): VerificationMarks {
  const ids = tasks
    .filter((t) => t.status === 'done' || t.status === 'review')
    .sort((a, b) => (Date.parse(b.completedAt || b.updatedAt || '') || 0) - (Date.parse(a.completedAt || a.updatedAt || '') || 0))
    .slice(0, VERIFICATION_BATCH_CAP)
    .map((t) => t.id)
  const signature = ids.join(',')

  const [state, setState] = useState<VerificationMarks>({ byId: null, readAt: null, error: null, busy: false })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), STALE_VERIFICATION * 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!signature) {
      setState({ byId: {}, readAt: Date.now(), error: null, busy: false })
      return
    }
    let alive = true
    setState((s) => ({ ...s, busy: true }))
    fetchJson<{ marks?: MarkRow[] }>('/api/hermes/tasks/verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: signature.split(',') }),
      cache: 'no-store',
    }).then((res) => {
      if (!alive) return
      if (!res.ok || !Array.isArray(res.data?.marks)) {
        // Gagal = tidak tahu. Penanda lama dibuang, bukan dipajang.
        setState({ byId: null, readAt: null, error: res.error || 'gagal membaca verifikasi', busy: false })
        return
      }
      const byId: Record<string, VerificationMark> = {}
      for (const m of res.data.marks) byId[m.id] = m.mark
      setState({ byId, readAt: Date.now(), error: null, busy: false })
    })
    return () => {
      alive = false
    }
  }, [signature, tick])

  return state
}

/** Penanda satu kartu. Task di luar batch atau saat gagal membaca = `unchecked` (netral). */
export function verificationMarkOf(marks: VerificationMarks, task: Task): VerificationMark | null {
  if (task.status !== 'done' && task.status !== 'review') return null
  if (!marks.byId) return marks.error ? 'failed' : 'unchecked'
  return marks.byId[task.id] ?? 'unchecked'
}

/** Kelas .vp-* yang sudah ada: hijau HANYA untuk terverifikasi, kuning untuk klaim, sisanya redup. */
export function verificationMarkClass(mark: VerificationMark): string {
  if (mark === 'verified') return 'vp-chip'
  if (mark === 'claim') return 'vp-chip vp-chip-warn'
  return 'vp-muted'
}

export { VERIFICATION_MARK_LABEL }
