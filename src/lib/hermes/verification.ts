/**
 * Verifikasi independen (TAHAP 5.3): klaim worker ≠ terverifikasi.
 *
 * Status `done` di papan hanya berarti seorang worker MENYATAKAN selesai. Itu klaim.
 * Terverifikasi berarti hasil itu sudah lewat tangan KEDUA yang independen: alur review
 * CLI (`request-review` → `complete`), yang meninggalkan jejak di `events[]` dari
 * `kanban show <id> --json`. Office tidak menjalankan kode task — hanya membaca jejak.
 *
 * Bentuk jejak yang nyata (diukur dari `hermes_cli/kanban_db.py`, bukan dugaan):
 *
 *   - `review_requested` payload `{summary, implementer, reviewer}` — implementer
 *     menyerahkan ke reviewer, status task menjadi `review`.
 *   - `changes_requested` payload `{reason, implementer, reviewer}` — reviewer
 *     mengembalikan ke implementer. Review yang ini GUGUR: selesai setelah ini tanpa
 *     review baru = klaim, bukan terverifikasi.
 *   - `review_reopened` — review dibuka kembali. Sama: menggugurkan review sebelumnya.
 *   - `completed` — task menjadi `done`. Terverifikasi HANYA bila `completed` ini
 *     terjadi SETELAH `review_requested` terakhir tanpa penggugur di antaranya.
 *
 * Diukur di board nyata: tidak satu pun task pernah lewat review (event hanya
 * created/claimed/spawned/heartbeat/completed), jadi `done` tanpa `review_requested`
 * — kasus umum — terbaca `claim`, bukan terverifikasi.
 *
 * Berkas ini PURE: tanpa CLI, tanpa fs, sehingga bisa diuji di selftest dan dipakai di klien.
 */

export type VerifyEvent = {
  kind: string
  payload?: Record<string, unknown>
  created_at?: number
}

/** Penilaian satu task. `open` = belum done, tidak dinilai. */
export type VerificationVerdict = 'verified' | 'claim' | 'open'

/**
 * Penanda di daftar (batch). `unchecked` = di luar batas pemeriksaan, `failed` = sumbernya tidak
 * terbaca. Keduanya NETRAL: tidak boleh tampil sebagai terverifikasi maupun klaim.
 */
export type VerificationMark = VerificationVerdict | 'unchecked' | 'failed'

export type VerificationReading = {
  verdict: VerificationVerdict
  /** Siapa yang memverifikasi — dari payload `reviewer` review terakhir. Kosong bila tak tercatat. */
  reviewer?: string
  /** Unix detik event `completed` yang mengesahkan review. */
  verifiedAt?: number
  /** Siapa yang menyerahkan hasil ke review — dari payload `implementer`. */
  implementer?: string
  /** Unix detik `review_requested` terakhir. Ada juga saat status masih `review` (menunggu). */
  requestedAt?: number
  /** Alasannya dalam Bahasa Indonesia, siap ditampilkan. */
  why: string
}

/** Batas id per panggilan batch: tiap id = satu proses `hermes` (~1,4 dtk). Sama dengan bukti 5.2. */
export const VERIFICATION_BATCH_CAP = 40

/**
 * Bagi daftar id batch: id unik bentuk `t_…`, maksimal VERIFICATION_BATCH_CAP diperiksa, sisanya
 * `unchecked` — netral, tidak pernah dinilai verified/claim.
 */
export function splitVerificationBatch(ids: unknown[]): { checked: string[]; unchecked: string[] } {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^t_[0-9a-z]+$/i.test(x)))]
  return { checked: unique.slice(0, VERIFICATION_BATCH_CAP), unchecked: unique.slice(VERIFICATION_BATCH_CAP) }
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Event yang menggugurkan review: hasilnya dikembalikan, review harus diulang dari awal. */
function isInvalidation(kind: string): boolean {
  return kind === 'changes_requested' || kind === 'review_reopened'
}

/**
 * Baca status verifikasi satu task dari jejak event-nya.
 *
 * Urutan dibaca dari INDEKS event, bukan `created_at`: beberapa event bisa lahir dalam detik
 * yang sama, dan urutan array CLI adalah urutan kejadiannya. Yang berlaku selalu jejak
 * TERAKHIR — review lama yang sudah digugurkan tidak mengesahkan penyelesaian baru.
 */
export function readVerification(
  task: { status: string },
  events: VerifyEvent[],
): VerificationReading {
  let lastReviewIdx = -1
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === 'review_requested') lastReviewIdx = i
  }

  if (task.status !== 'done') {
    if (task.status === 'review' && lastReviewIdx >= 0) {
      const p = events[lastReviewIdx].payload ?? {}
      const reviewer = text(p.reviewer)
      const implementer = text(p.implementer)
      return {
        verdict: 'open',
        ...(reviewer ? { reviewer } : {}),
        ...(implementer ? { implementer } : {}),
        ...(typeof events[lastReviewIdx].created_at === 'number'
          ? { requestedAt: events[lastReviewIdx].created_at }
          : {}),
        why: reviewer ? `menunggu review oleh ${reviewer}` : 'menunggu review',
      }
    }
    return { verdict: 'open', why: 'belum selesai — belum dinilai' }
  }

  // Task done: tanpa review yang sah, ini klaim worker — bukan terverifikasi.
  if (lastReviewIdx < 0) {
    return { verdict: 'claim', why: 'selesai tanpa lewat review — klaim worker' }
  }
  const rp = events[lastReviewIdx].payload ?? {}
  const reviewer = text(rp.reviewer)
  const implementer = text(rp.implementer)
  const requestedAt = events[lastReviewIdx].created_at
  const base = {
    ...(reviewer ? { reviewer } : {}),
    ...(implementer ? { implementer } : {}),
    ...(typeof requestedAt === 'number' ? { requestedAt } : {}),
  }

  let completedAfter: VerifyEvent | null = null
  for (let i = lastReviewIdx + 1; i < events.length; i++) {
    const e = events[i]
    if (isInvalidation(e.kind)) {
      return {
        verdict: 'claim',
        ...base,
        why: 'review dikembalikan, selesai tanpa review ulang — klaim worker',
      }
    }
    if (e.kind === 'completed') completedAfter = e
  }

  if (!completedAfter) {
    return { verdict: 'claim', ...base, why: 'catatan penyelesaian setelah review tak ditemukan — klaim worker' }
  }
  return {
    verdict: 'verified',
    ...base,
    ...(typeof completedAfter.created_at === 'number' ? { verifiedAt: completedAfter.created_at } : {}),
    why: reviewer ? `diverifikasi oleh ${reviewer}` : 'diverifikasi (verifier tak tercatat)',
  }
}

/** Label penanda untuk kartu. Netral untuk yang tidak dinilai. */
export const VERIFICATION_MARK_LABEL: Record<VerificationMark, string> = {
  verified: 'terverifikasi',
  claim: 'klaim',
  open: '',
  unchecked: 'verifikasi tak diperiksa',
  failed: 'verifikasi gagal dibaca',
}
