'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import { EVIDENCE_BATCH_CAP, EVIDENCE_MARK_LABEL, type EvidenceMark } from '@/lib/hermes/evidence'
import type { Task } from '@/types/hermes'

type MarkRow = { id: string; mark: EvidenceMark; completedAgeSeconds?: number | null }

/** Penanda lebih tua dari ini dibaca ulang. Satu batch = sampai 40 proses `hermes`, jadi tidak tiap poll. */
export const STALE_EVIDENCE = 300

export type EvidenceMarks = {
  /** null = belum terbaca atau gagal; kartu harus netral, bukan memakai penanda lama. */
  byId: Record<string, EvidenceMark> | null
  readAt: number | null
  error: string | null
  busy: boolean
}

/**
 * Penanda bukti RINGKAS untuk kartu `done` (POST /api/hermes/tasks/evidence).
 *
 * Yang dikirim hanya task `done`, terbaru dulu, maksimal EVIDENCE_BATCH_CAP; sisanya tidak
 * dikirim dan tampil netral seperti `unchecked`. Dibaca ulang saat himpunan task `done`
 * berubah atau saat penandanya sudah basi — bukan pada tiap poll papan.
 */
export function useEvidenceMarks(tasks: Task[]): EvidenceMarks {
  const ids = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => (Date.parse(b.completedAt || b.updatedAt || '') || 0) - (Date.parse(a.completedAt || a.updatedAt || '') || 0))
    .slice(0, EVIDENCE_BATCH_CAP)
    .map((t) => t.id)
  const signature = ids.join(',')

  const [state, setState] = useState<EvidenceMarks>({ byId: null, readAt: null, error: null, busy: false })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), STALE_EVIDENCE * 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!signature) {
      setState({ byId: {}, readAt: Date.now(), error: null, busy: false })
      return
    }
    let alive = true
    setState((s) => ({ ...s, busy: true }))
    fetchJson<{ marks?: MarkRow[] }>('/api/hermes/tasks/evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: signature.split(',') }),
      cache: 'no-store',
    }).then((res) => {
      if (!alive) return
      if (!res.ok || !Array.isArray(res.data?.marks)) {
        // Gagal = tidak tahu. Penanda lama dibuang, bukan dipajang.
        setState({ byId: null, readAt: null, error: res.error || 'gagal membaca bukti', busy: false })
        return
      }
      const byId: Record<string, EvidenceMark> = {}
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
export function markOf(marks: EvidenceMarks, task: Task): EvidenceMark | null {
  if (task.status !== 'done') return null
  if (!marks.byId) return marks.error ? 'failed' : 'unchecked'
  return marks.byId[task.id] ?? 'unchecked'
}

/** Kelas .vp-* yang sudah ada: hijau HANYA untuk terbukti, kuning untuk tanpa bukti, sisanya redup. */
export function markClass(mark: EvidenceMark): string {
  if (mark === 'proven') return 'vp-chip'
  if (mark === 'unproven') return 'vp-chip vp-chip-warn'
  return 'vp-muted'
}

export { EVIDENCE_MARK_LABEL }
