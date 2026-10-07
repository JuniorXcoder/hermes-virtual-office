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
import type { AgentRole } from '@/types/hermes'

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
  /** Pasang chain cadangan provider. Mengubah perilaku SELURUH instalasi. */
  | 'setFallback'

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

/* -------------------------------------------------------- izin per agent -- */

/**
 * Aksi yang bisa diminta ATAS NAMA sebuah agent. Daftar tertutup, sama seperti `ActionKind`.
 *
 *   pauseAll — hentikan seluruh kerja baru (ESTOP).
 *   spawn    — ubah siapa yang ada di kantor (spawn / sembunyikan).
 *   kill     — hapus profil agent beserta tugasnya.
 *   create   — buat profil agent baru.
 *   setModel — ganti model bawaan profil agent.
 *   steer    — kirim arahan ke worker yang memegang satu task.
 *   advance  — gerakkan satu task: unblock / promote / release.
 */
export type AgentActionKind = 'pauseAll' | 'spawn' | 'kill' | 'create' | 'setModel' | 'steer' | 'advance'

export const AGENT_ACTIONS: AgentActionKind[] = ['pauseAll', 'spawn', 'kill', 'create', 'setModel', 'steer', 'advance']

export const AGENT_ACTION_LABEL: Record<AgentActionKind, string> = {
  pauseAll: 'jeda semua',
  spawn: 'spawn/sembunyikan',
  kill: 'kill',
  create: 'buat profil',
  setModel: 'ganti model',
  steer: 'arahkan task',
  advance: 'gerakkan task',
}

export type AgentPermission = {
  /** Aksi yang boleh. Yang tidak ada di sini dan tidak ada di `deny` tetap DITOLAK. */
  allow: AgentActionKind[]
  /** Aksi yang ditolak, masing-masing dengan alasannya sendiri — bukan pesan generik. */
  deny: Partial<Record<AgentActionKind, string>>
  /** false = steer/advance hanya untuk task milik agent itu sendiri. */
  anyTask: boolean
}

const STAFF: AgentPermission = {
  allow: ['steer', 'advance'],
  deny: {
    pauseAll: 'agent staff tidak boleh menghentikan seluruh sistem — jeda semua adalah keputusan operator atau orkestrasi',
    spawn: 'agent staff tidak boleh mengubah siapa yang ada di kantor — memunculkan/menyembunyikan rekan adalah tugas orkestrasi',
    kill: 'agent staff tidak boleh menghapus agent lain — kill menghapus profil dan seluruh tugasnya permanen',
    create: 'agent staff tidak boleh membuat profil agent baru — menambah anggota tim adalah keputusan orkestrasi',
    setModel: 'agent staff tidak boleh mengganti model profil — itu mengubah biaya dan perilaku agent lain',
  },
  anyTask: false,
}

/**
 * TABEL IZIN PER ROLE — satu-satunya tempat aturan ini hidup. Route dan UI membaca dari sini.
 *
 * Orkestrasi (ceo/orchestrator) boleh semua aksi dan boleh menyentuh task siapa pun, karena
 * membagi dan menggerakkan kerja orang lain memang tugasnya. Manager memimpin satu divisi:
 * boleh mengatur anggota dan task, tapi tidak menghentikan SELURUH sistem dan tidak menghapus
 * agent. Jeda semua tetap tunduk pada `checkAction` (wajib beralasan) — tabel ini tidak
 * pernah melonggarkannya.
 */
export const AGENT_PERMISSIONS: Record<AgentRole, AgentPermission> = {
  ceo: { allow: [...AGENT_ACTIONS], deny: {}, anyTask: true },
  orchestrator: { allow: [...AGENT_ACTIONS], deny: {}, anyTask: true },
  manager: {
    allow: ['spawn', 'create', 'setModel', 'steer', 'advance'],
    deny: {
      pauseAll: 'manager memimpin satu divisi — menghentikan SELURUH sistem adalah keputusan ceo/orchestrator',
      kill: 'manager tidak boleh menghapus agent — kill menghapus profil dan tugasnya permanen, minta ceo/orchestrator',
    },
    anyTask: true,
  },
  backend: STAFF,
  frontend: STAFF,
  qa: STAFF,
  researcher: STAFF,
  devops: STAFF,
  marketing: STAFF,
  seo: STAFF,
  content: STAFF,
  affiliator: STAFF,
}

export type AgentActionRequest = {
  agent: string
  role: AgentRole
  action: AgentActionKind
  taskId?: string
  /** Pemilik task yang disasar; null = task tanpa pemilik, undefined = tidak diketahui. */
  taskAssignee?: string | null
  reason?: string
}

/**
 * Apakah sebuah agent boleh meminta aksi ini. Fungsi MURNI, sama seperti `checkAction`.
 *
 * Urutannya: identitas → tabel role → kepemilikan task → aturan operator lama (`checkAction`).
 * Aturan lama SELALU ikut dinilai di ujung, jadi izin per agent hanya bisa MENAMBAH larangan.
 */
export function checkAgentAction(req: AgentActionRequest): Verdict {
  const agent = (req.agent || '').trim()
  if (!agent) return { allowed: false, why: 'aksi atas nama agent butuh nama agent' }
  const perm = (AGENT_PERMISSIONS as Record<string, AgentPermission | undefined>)[req.role]
  if (!perm) return { allowed: false, why: `role "${req.role}" tidak dikenal — tidak ada izin untuknya` }
  if (!AGENT_ACTIONS.includes(req.action)) {
    return { allowed: false, why: `aksi "${req.action}" tidak dikenal` }
  }
  const denied = perm.deny[req.action]
  if (denied) return { allowed: false, why: `${agent}: ${denied}` }
  if (!perm.allow.includes(req.action)) {
    return { allowed: false, why: `${agent}: aksi "${req.action}" tidak ada di daftar izin role ${req.role}` }
  }

  if (req.action === 'steer' || req.action === 'advance') {
    if (!req.taskId || !/^t_[0-9a-f]{8}$/.test(req.taskId)) {
      return { allowed: false, why: `${req.action} butuh id task yang sah` }
    }
    if (!perm.anyTask) {
      if (req.taskAssignee === undefined) {
        return { allowed: false, why: `${agent}: pemilik ${req.taskId} tidak diketahui — hanya boleh menyentuh task miliknya sendiri` }
      }
      if (req.taskAssignee !== agent) {
        const owner = req.taskAssignee ? `milik ${req.taskAssignee}` : 'tidak punya pemilik'
        return { allowed: false, why: `${agent}: ${req.taskId} ${owner}, bukan milik ${agent} — role ${req.role} hanya boleh menyentuh task miliknya sendiri` }
      }
    }
  }

  // Aturan operator lama tetap berlaku untuk agent: jeda semua wajib beralasan.
  if (req.action === 'pauseAll') return checkAction({ action: 'pauseAll', reason: req.reason })
  return { allowed: true }
}

/** Ringkasan tabel untuk UI: label "boleh" dan "tidak boleh" per role. */
export function agentPermissionSummary(): Record<AgentRole, { allow: string[]; deny: string[]; anyTask: boolean }> {
  const out = {} as Record<AgentRole, { allow: string[]; deny: string[]; anyTask: boolean }>
  for (const [role, p] of Object.entries(AGENT_PERMISSIONS) as [AgentRole, AgentPermission][]) {
    out[role] = {
      allow: p.allow.map((a) => AGENT_ACTION_LABEL[a]),
      deny: AGENT_ACTIONS.filter((a) => !p.allow.includes(a)).map((a) => AGENT_ACTION_LABEL[a]),
      anyTask: p.anyTask,
    }
  }
  return out
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
  setFallback: {
    label: 'Pasang cadangan provider',
    effect:
      'Chain cadangan ditulis ke config.yaml, dengan cadangan berkas dulu. Ini mengubah provider yang dipakai SELURUH instalasi, termasuk agent yang sedang bekerja.',
    danger: true,
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
