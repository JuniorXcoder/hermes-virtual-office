/**
 * Bukti hasil kerja (TAHAP 5.2).
 *
 * Status `done` di papan hanya berarti seorang worker MENYATAKAN selesai. Itu bukan bukti.
 * Bukti adalah sesuatu yang bisa dibuka dan dibaca manusia: ringkasan run terakhir, ringkasan
 * dan metadata run (branch/commit/selftest), log worker, atau lampiran. Office tidak mengarang
 * jenis bukti lain — empat sumber ini persis yang dikeluarkan CLI:
 *
 *   - `kanban show <id> --json`    -> `latest_summary`, `runs[].summary|outcome|metadata`
 *   - `kanban log <id>`            -> log worker (bisa kosong)
 *   - `kanban attachments <id> --json` -> daftar metadata lampiran (isi tidak bisa dibaca CLI)
 *
 * Berkas ini PURE: tanpa CLI, tanpa fs, sehingga bisa diuji di selftest dan dipakai di klien.
 */

export type EvidenceItem = {
  kind: 'summary' | 'run' | 'log' | 'attachment'
  label: string
  body?: string
}

/** Penilaian satu task. `open` = belum done, tidak dinilai. */
export type EvidenceVerdict = 'proven' | 'unproven' | 'open'

/**
 * Penanda di daftar (batch). `unchecked` = di luar batas pemeriksaan, `failed` = sumbernya tidak
 * terbaca. Keduanya NETRAL: tidak boleh tampil sebagai terbukti maupun tanpa bukti.
 */
export type EvidenceMark = EvidenceVerdict | 'unchecked' | 'failed'

export type EvidenceInput = {
  latestSummary: string | null
  lastRunSummary: string | null
  lastRunOutcome: string | null
  lastRunMeta: Record<string, unknown> | null
  hasLog: boolean
  attachmentNames: string[]
}

export type EvidenceReading = {
  verdict: EvidenceVerdict
  items: EvidenceItem[]
  /** ISO, dari `task.completed_at`. Hanya bila CLI memberikannya. */
  completedAt?: string
}

/** Batas id per panggilan batch: tiap id = satu proses `hermes` (~1,4 dtk). */
export const EVIDENCE_BATCH_CAP = 40

/**
 * Bagi daftar id batch: id unik bentuk `t_…`, maksimal EVIDENCE_BATCH_CAP diperiksa, sisanya
 * `unchecked` — netral, tidak pernah dinilai proven/unproven.
 */
export function splitEvidenceBatch(ids: unknown[]): { checked: string[]; unchecked: string[] } {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^t_[0-9a-z]+$/i.test(x)))]
  return { checked: unique.slice(0, EVIDENCE_BATCH_CAP), unchecked: unique.slice(EVIDENCE_BATCH_CAP) }
}

const text = (s: string | null | undefined) => (typeof s === 'string' ? s.trim() : '')

function metaLines(meta: Record<string, unknown> | null): string[] {
  if (!meta || typeof meta !== 'object') return []
  return Object.entries(meta)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
}

/**
 * Baca bukti satu task.
 *
 * `outcome` saja ("completed") BUKAN bukti — itu hanya nama lain untuk "selesai". Sebuah run
 * baru dihitung bila ia membawa ringkasan atau metadata. Ringkasan run yang sama persis dengan
 * `latest_summary` tidak dihitung dua kali.
 */
export function readEvidence(
  task: { status: string; completedAt?: string },
  input: EvidenceInput,
): EvidenceReading {
  const items: EvidenceItem[] = []

  const latest = text(input.latestSummary)
  if (latest) items.push({ kind: 'summary', label: 'ringkasan terakhir', body: latest })

  const runSummary = text(input.lastRunSummary)
  const meta = metaLines(input.lastRunMeta)
  const runBody = [runSummary && runSummary !== latest ? runSummary : '', ...meta].filter(Boolean)
  if (runBody.length) {
    const outcome = text(input.lastRunOutcome)
    items.push({
      kind: 'run',
      label: outcome ? `run terakhir · ${outcome}` : 'run terakhir',
      body: runBody.join('\n'),
    })
  }

  if (input.hasLog) items.push({ kind: 'log', label: 'log worker tersedia' })

  for (const name of input.attachmentNames) {
    const n = text(name)
    if (n) items.push({ kind: 'attachment', label: n })
  }

  const verdict: EvidenceVerdict =
    task.status !== 'done' ? 'open' : items.length ? 'proven' : 'unproven'
  return task.completedAt ? { verdict, items, completedAt: task.completedAt } : { verdict, items }
}

/** Label penanda untuk kartu. Netral untuk yang tidak dinilai. */
export const EVIDENCE_MARK_LABEL: Record<EvidenceMark, string> = {
  proven: 'terbukti',
  unproven: 'tanpa bukti',
  open: '',
  unchecked: 'bukti tak diperiksa',
  failed: 'bukti gagal dibaca',
}
