/**
 * KENAPA SEBUAH TASK BERHENTI — sebabnya, umurnya, dan apakah dia macet.
 *
 * Kenapa ini dipisah dari `kanban.ts`. `kanban.ts` menjembatani CLI; berkas ini MEMUTUSKAN
 * sesuatu dari data itu. Pemisahannya sama dengan `health.ts`: keputusan yang dipakai di lebih
 * dari satu tempat harus tinggal di satu tempat, atau tempat-tempat itu akan berbeda pendapat.
 *
 * MASALAH YANG DIPECAHKAN. Papan kanban cuma menunjukkan KOLOM — "blocked". Kolom tidak
 * memberi tahu kenapa, sejak kapan, atau apakah seseorang sedang menunggu. Operator lalu harus
 * membuka tiap task satu per satu untuk tahu mana yang butuh dia, dan itulah bedanya papan
 * yang MELAPOR dengan papan yang MENJAWAB.
 *
 * Datanya sudah ada, dan tidak satu pun dibaca: `hermes kanban show <id> --json` mengembalikan
 * `events[]` (termasuk `blocked` dengan kind dan recurrences), `last_failure_error`,
 * `parents[]`, dan `comments[]`.
 */

import type { Task } from '@/types/hermes'

/* ---------------------------------------------------------------- umur --- */

/**
 * Umur task dalam menit, dihitung dari kapan dia TERAKHIR bergerak.
 *
 * `updated_at` tidak selalu ada, dan `started_at` tidak ada untuk task yang belum pernah
 * dijalankan. Jadi urutannya: updated_at, lalu started_at, lalu created_at. Memakai created_at
 * sendirian akan membuat task lama yang baru dijalankan terlihat menua selama berhari-hari.
 */
export function taskAgeMinutes(t: Task, now = Date.now()): number | null {
  const stamp = t.updatedAt || undefined
  const iso = stamp || undefined
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.round((now - ms) / 60_000))
}

/* --------------------------------------------------------------- sebab --- */

/**
 * Jenis sebab sebuah task berhenti, dalam bahasa yang berguna bagi operator.
 *
 * `kind` dari CLI dinormalisasi ke sini, dengan satu aturan yang penting: APAKAH INI URUSAN
 * MANUSIA. Itu pemisahan yang sesungguhnya berguna — "tunggu task lain selesai" akan selesai
 * sendiri, "tunggu keputusan" tidak akan pernah selesai sampai ada orang bergerak. Papan yang
 * tidak membedakan keduanya akan membuat operator memeriksa hal yang tidak perlu diperiksa.
 */
export type BlockKind =
  /** Menunggu task lain. Selesai SENDIRI, manusia tidak perlu apa-apa. */
  | 'dependency'
  /** Menunggu keputusan manusia. Butuh orang, dan akan menunggu selamanya tanpa itu. */
  | 'needs_input'
  /** Tidak bisa dikerjakan: tidak ada akses/kredensial/kemampuan. */
  | 'capability'
  /** Gagal sementara, mungkin berhasil kalau diulang. */
  | 'transient'
  /** Diblokir tanpa jenis. Sebabnya tetap ditampilkan; cuma tidak diklasifikasi. */
  | 'unspecified'

/** Apakah jenis ini menunggu MANUSIA? Hanya yang `true` yang perlu masuk daftar kerja operator. */
export function needsHuman(k: BlockKind): boolean {
  return k === 'needs_input' || k === 'capability'
}

/** Label Indonesia untuk tiap jenis, dipakai UI dan tes dari sumber yang sama. */
export const BLOCK_LABEL: Record<BlockKind, string> = {
  dependency: 'menunggu task lain',
  needs_input: 'menunggu keputusan kamu',
  capability: 'tidak bisa dikerjakan',
  transient: 'gagal sementara',
  unspecified: 'diblokir',
}

/**
 * Sebab satu task, dibaca dari peristiwa dan komentar.
 *
 * `events` diperiksa TERAKHIR ke PERTAMA dan yang pertama ketemu yang dipakai, karena sebuah
 * task bisa diblokir berkali-kali: yang berlaku adalah yang terakhir, bukan yang pertama.
 */
export type BlockReason = {
  kind: BlockKind
  /** Teks sebabnya apa adanya dari CLI. */
  reason: string
  /** Berapa kali task ini sudah diblokir dengan jenis yang sama. Dari CLI, bukan dihitung di sini. */
  recurrences: number
  /** Ambang: 3 kali diblokir-dibuka-diblokir lagi berarti lingkaran, bukan pekerjaan. */
  looping: boolean
}

/**
 * Ambang "lingkaran". Tiga bukan angka bulat yang dipilih enak: dua kali itu wajar (salah
 * paham lalu diperbaiki), tiga kali dengan JENIS yang sama berarti unblock tidak mengubah apa
 * pun — dan CLI-nya sendiri sudah punya aturan ini (dokumentasi `block --kind` menyebut
 * "repeated same-kind re-blocks route the task to triage").
 */
export const LOOP_THRESHOLD = 3

export function readBlock(
  events: { kind: string; payload?: Record<string, unknown>; created_at?: number }[],
): BlockReason | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind !== 'blocked') continue
    const p = (e.payload || {}) as { reason?: unknown; kind?: unknown; recurrences?: unknown }
    const raw = String(p.kind ?? '')
    const kind: BlockKind =
      raw === 'dependency' || raw === 'needs_input' || raw === 'capability' || raw === 'transient'
        ? raw
        : 'unspecified'
    const recurrences = Number(p.recurrences ?? 1)
    return {
      kind,
      reason: String(p.reason ?? '').trim() || '(tanpa alasan tertulis)',
      recurrences: Number.isFinite(recurrences) ? recurrences : 1,
      looping: Number.isFinite(recurrences) && recurrences >= LOOP_THRESHOLD,
    }
  }
  return null
}

/* --------------------------------------------------------------- macet --- */

/**
 * MACET — task yang tidak bergerak dan tidak ada yang menunggunya.
 *
 * Ini yang tidak ada di papan mana pun: kolom `running` yang isinya task yang sudah berhenti
 * bergerak. Sebuah task bisa berada di `running` berjam-jam tanpa satu pun proses
 * mengerjakannya — worker-nya mati, gateway-nya berhenti, atau providernya gagal — dan papan
 * tetap menggambarnya sebagai "sedang dikerjakan".
 *
 * AMBANGNYA BEDA PER KOLOM, dan itu bukan selera: task `running` yang diam 30 menit itu
 * mencurigakan (satu putaran agent jarang selama itu), sedangkan `ready` yang diam 30 menit
 * hanya berarti belum ada yang mengambilnya. Menyamakan keduanya akan menandai seluruh
 * backlog sebagai macet.
 */
export const STUCK_MINUTES: Record<string, number> = {
  running: 30,
  review: 180,
  ready: 1440,
  todo: 1440,
}

export type StuckInfo = {
  /** Sudah diam berapa menit. */
  minutes: number
  /** Ambang yang berlaku untuk kolomnya. */
  threshold: number
  /** Kenapa ini dianggap macet, in Indonesian, siap ditampilkan. */
  why: string
}

export function readStuck(t: Task, ageMinutes: number | null): StuckInfo | null {
  if (ageMinutes == null) return null
  const threshold = STUCK_MINUTES[t.status]
  if (threshold == null || ageMinutes < threshold) return null
  const jam = (ageMinutes / 60).toFixed(1)
  const why =
    t.status === 'running'
      ? `berjalan tapi tidak bergerak ${jam} jam — worker mungkin sudah mati`
      : t.status === 'review'
        ? `menunggu review ${jam} jam — mungkin tidak ada yang diberi tahu`
        : `menganggur ${jam} jam di kolom ${t.status}`
  return { minutes: ageMinutes, threshold, why }
}

/* ---------------------------------------------------------------- hasil -- */

/**
 * RINGKASAN SATU PAPAN, siap ditampilkan.
 *
 * Yang dihitung di sini bukan jumlah per kolom — itu sudah ada di papan. Yang dihitung adalah
 * hal-hal yang operator BUTUH TAHU dan tidak bisa dilihat: berapa yang menunggu dia, berapa
 * yang macet, dan berapa yang berputar di tempat.
 */
export type BoardReadout = {
  total: number
  byStatus: Record<string, number>
  /** Task yang menunggu MANUSIA. Ini yang paling penting: dia tidak akan selesai sendiri. */
  waitingOnHuman: { id: string; title: string; reason: BlockReason }[]
  /** Berputar di tempat: diblokir-dibuka-diblokir dengan jenis yang sama. */
  looping: { id: string; title: string; reason: BlockReason }[]
  /** Diam terlalu lama untuk kolomnya. */
  stuck: { id: string; title: string; info: StuckInfo }[]
  /** Tidak ada satu pun yang butuh perhatian. Kalau true, operator boleh diam. */
  calm: boolean
}

export function readBoard(
  tasks: Task[],
  detail: Map<string, { events: { kind: string; payload?: Record<string, unknown> }[] }>,
  now = Date.now(),
): BoardReadout {
  const byStatus: Record<string, number> = {}
  const waitingOnHuman: BoardReadout['waitingOnHuman'] = []
  const looping: BoardReadout['looping'] = []
  const stuck: BoardReadout['stuck'] = []

  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1
    if (t.status === 'archived') continue
    const reason = readBlock(detail.get(t.id)?.events || [])
    if (reason) {
      if (needsHuman(reason.kind)) waitingOnHuman.push({ id: t.id, title: t.title, reason })
      else if (reason.looping) looping.push({ id: t.id, title: t.title, reason })
    }
    const s = readStuck(t, taskAgeMinutes(t, now))
    if (s) stuck.push({ id: t.id, title: t.title, info: s })
  }

  return {
    total: tasks.length,
    byStatus,
    waitingOnHuman,
    looping,
    stuck,
    calm: waitingOnHuman.length === 0 && looping.length === 0 && stuck.length === 0,
  }
}
