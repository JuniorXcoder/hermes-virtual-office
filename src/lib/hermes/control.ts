/**
 * KENDALI — satu-satunya berkas di office ini yang MENGUBAH keadaan Hermes.
 *
 * Semua yang lain melapor. Berkas ini menekan tombol, dan itu berarti tiga aturan yang tidak
 * berlaku di tempat lain:
 *
 *   1. SETIAP aksi harus bisa dijawab "apa yang barusan terjadi". Aksi yang tidak bisa
 *      dilaporkan hasilnya lebih buruk daripada tidak ada tombol — operator akan menekannya
 *      lagi, dan lagi.
 *
 *   2. TIDAK ADA AKSI YANG DIJALANKAN SENDIRI. Semua di sini dipicu manusia, tidak ada
 *      pemanggilan otomatis dari polling. Menekan tombol yang menghentikan kerja harus
 *      keputusan, bukan efek samping.
 *
 *   3. BAHAYA DINYATAKAN SEBELUM DIJALANKAN. `describeAction` ada supaya UI bisa bilang
 *      "ini akan menghentikan SEMUA kerja baru" DULU, bukan sesudahnya.
 *
 * ESTOP: `hermes pause` menulis sentinel `$HERMES_HOME/ESTOP`; `hermes resume` menghapusnya.
 * Yang dihentikan hanya KERJA BARU — cron, dispatch kanban, dan turn gateway baru. Kerja yang
 * sedang jalan TIDAK dibunuh (dari dokumentasi `agent/estop.py`: "in-flight work is never
 * killed"). EFEK INI DIBACA DARI SENTINEL, bukan dari menjalankan perintah: membaca berkas
 * tidak bisa mengubah apa pun, jadi membuka panel tidak pernah bisa menjeda sistem.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HERMES = process.env.HERMES_HOME || join(homedir(), '.hermes')
const ESTOP = join(HERMES, 'ESTOP')

/** Aksi yang boleh diminta dari UI. Daftar tertutup — bukan string bebas. */
export type ActionKind =
  /** Hentikan SEMUA kerja baru. Cron, dispatch kanban, turn gateway baru. */
  | 'pauseAll'
  /** Jalankan lagi. */
  | 'resumeAll'
  /** Buka blokir satu task, dengan alasan yang diketik operator. */
  | 'unblock'
  /** Kembalikan task ke ready supaya dispatcher bisa mengambilnya. */
  | 'promote'
  /** Lepaskan worker yang memegang task — untuk worker yang sudah mati. */
  | 'release'

export type ActionRequest = {
  action: ActionKind
  /** Task id, untuk aksi yang menyasar satu task. */
  taskId?: string
  /** Alasan, untuk aksi yang membutuhkannya. Yang menghentikan kerja WAJIB memberi alasan. */
  reason?: string
}

/* ------------------------------------------------------------------ izin -- */

/**
 * Apakah sebuah permintaan boleh dijalankan, dan kalau tidak, kenapa.
 *
 * Dipisah dari pelaksanaannya supaya bisa diuji tanpa menjalankan apa pun — dan itu penting
 * untuk berkas yang menekan tombol berbahaya: aturannya harus bisa diperiksa tanpa risikonya.
 */
export type Verdict = { allowed: true } | { allowed: false; why: string }

export function checkAction(req: ActionRequest): Verdict {
  const needsTask: ActionKind[] = ['unblock', 'promote', 'release']
  if (needsTask.includes(req.action)) {
    if (!req.taskId || !/^t_[0-9a-f]{8}$/.test(req.taskId)) {
      return { allowed: false, why: `${req.action} butuh id task yang sah` }
    }
  }
  // Menghentikan kerja SELURUH SISTEM wajib punya alasan. Tanpa itu, catatannya cuma
  // "seseorang menjeda semuanya" — dan di situlah orang berdebat nanti.
  if (req.action === 'pauseAll') {
    const r = (req.reason || '').trim()
    if (r.length < 3) return { allowed: false, why: 'menghentikan seluruh kerja wajib disertai alasan' }
  }
  // Membuka blokir juga wajib beralasan: itu catatan kenapa blokirnya dicabut, dan di papan
  // ia muncul sebagai komentar yang bisa dibaca ulang.
  if (req.action === 'unblock') {
    const r = (req.reason || '').trim()
    if (r.length < 3) return { allowed: false, why: 'membuka blokir wajib disertai alasan' }
  }
  return { allowed: true }
}

/**
 * Apa yang akan terjadi kalau aksi ini dijalankan — untuk ditampilkan SEBELUM tombolnya ditekan.
 *
 * `danger: true` berarti UI wajib memakai konfirmasi dua langkah (pola yang sudah dipakai
 * CronPanel). Tombol yang mengubah keadaan tidak boleh selesai dalam satu klik nyasar.
 */
export type ActionEffect = {
  label: string
  /** Apa yang terjadi pada kerja yang SEDANG jalan. Ini yang paling sering disalahpahami. */
  effect: string
  danger: boolean
}

export const ACTION_EFFECT: Record<ActionKind, ActionEffect> = {
  pauseAll: {
    label: 'Jeda semua',
    effect: 'Kerja BARU berhenti: cron, dispatch kanban, turn gateway baru. Kerja yang sedang jalan TIDAK dibunuh.',
    danger: true,
  },
  resumeAll: {
    label: 'Lanjutkan',
    effect: 'Dispatch jalan lagi pada tick berikutnya.',
    danger: false,
  },
  unblock: {
    label: 'Buka blokir',
    effect: 'Task kembali ke papan dan alasannya dicatat sebagai komentar.',
    danger: false,
  },
  promote: {
    label: 'Dorong ke siap',
    effect: 'Task kembali ke ready, dispatcher bisa mengambilnya.',
    danger: false,
  },
  release: {
    label: 'Lepas worker',
    effect: 'Worker yang memegang task dilepas. Pakai ini kalau worker-nya sudah mati tapi task masih tercatat berjalan.',
    danger: true,
  },
}

/* ------------------------------------------------------------------ ESTOP -- */

export type PauseState = {
  paused: boolean
  reason: string | null
  engagedAt: string | null
}

/**
 * Apakah sistem sedang dijeda.
 *
 * Dibaca dari BERKAS, bukan dari perintah. Dua alasan: membaca tidak bisa mengubah apa pun
 * (jadi panel yang memanggil ini tidak mungkin menjeda sistem), dan berkas yang rusak/ kosong
 * tetap dihitung JEDA — perilaku yang sama dengan Hermes, "fail safe".
 */
export function readPause(): PauseState {
  if (!existsSync(ESTOP)) return { paused: false, reason: null, engagedAt: null }
  try {
    const raw = readFileSync(ESTOP, 'utf8').trim()
    if (!raw) return { paused: true, reason: null, engagedAt: null }
    const j = JSON.parse(raw) as { reason?: string; engaged_at?: string }
    return { paused: true, reason: j.reason ?? null, engagedAt: j.engaged_at ?? null }
  } catch {
    // Berkas tidak terbaca atau bukan JSON: tetap JEDA. Kesalahan membaca tidak boleh
    // mengubah "berhenti" jadi "jalan".
    return { paused: true, reason: null, engagedAt: null }
  }
}

export const ESTOP_PATH = ESTOP
