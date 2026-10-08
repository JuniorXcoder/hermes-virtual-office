/**
 * Apa yang sedang jadi KEWAJIBAN sebuah badan di kantor: rapat, kerja di meja, review, atau bebas.
 *
 * Dipisah dari scene.ts karena scene butuh WebGL dan self-test tidak punya. Keputusan "harus ke
 * meja atau boleh jalan-jalan" adalah inti keluhan pemilik — agent yang ada kerjaan malah tetap
 * duduk di tepi kolam — jadi keputusannya harus bisa diuji tanpa merender apa pun.
 *
 * Modul ini murni (tanpa node:fs, tanpa three): dipakai server (route), klien (store/scene) dan
 * self-test.
 */
import type { AgentStatus } from '@/types/hermes'

/**
 * Urutan prioritas: rapat > a2a > kerja di meja > review > bebas.
 *
 * Rapat paling atas karena rapat mengikat beberapa orang sekaligus di satu ruang. A2A di
 * atas kerja-di-meja: agent yang sedang dalam percakapan agent-ke-agent harus BERHENTI dari
 * aktivitasnya dan menuju lawan bicaranya — seperti aturan "kerja mengalahkan istirahat".
 * Kerja di meja di atas review karena agent yang sedang diajak chat sedang BEKERJA, walau
 * papan masih menulis task-nya `review`.
 */
export type Duty = 'meeting' | 'a2a' | 'desk' | 'review' | 'idle'

/**
 * Percakapan dianggap masih hidup selama ini setelah balasan terakhir.
 *
 * `updatedAt` sesi baru ditulis SETELAH balasan datang, dan orang yang sedang chat biasanya
 * membalas dalam satu-dua menit. Tanpa jendela ini agent akan berdiri dan pergi ke kolam di
 * antara dua pesan, lalu balik lagi — bolak-balik yang terlihat seperti glitch.
 */
export const CHAT_LIVE_MS = 120_000

/** Cron yang jalan dalam jendela ini membuat kantor berada dalam keadaan "ada kerja cron". */
export const CRON_WINDOW_MS = 120_000

export type DutyInput = {
  /** Peserta rapat yang sedang `queued`/`running`. */
  inMeeting: boolean
  status: AgentStatus
  /** Punya meja (deskIndex bukan null dan mejanya ada). */
  hasDesk: boolean
  /** Badan dummy tidak pernah bekerja — mereka hiasan, bukan agent. */
  isDummy: boolean
  /** Ada percakapan hidup dengan agent INI (turn berjalan atau baru saja dibalas). */
  chatLive: boolean
  /**
   * Nama agent yang sedang diajak bicara agent INI lewat A2A (sesi source='a2a'
   * yang masih hidup). Null/undefined = tidak ada. Rapat tetap menang di atas ini.
   */
  a2aPeer?: string | null
  /** Kantor sedang dalam keadaan "ada kerja cron" (lihat `cronPulse` — ini KEBIJAKAN). */
  cronLive: boolean
}

export function dutyOf(i: DutyInput): Duty {
  if (i.inMeeting) return 'meeting'
  if (i.isDummy || !i.hasDesk) return 'idle'
  if (i.a2aPeer) return 'a2a'
  if (i.status === 'working' || i.status === 'blocked') return 'desk'
  if (i.chatLive) return 'desk'
  if (i.status === 'review') return 'review'
  // KEBIJAKAN, bukan fakta: lihat `cronPulse`. Hanya yang sedang bebas yang dipanggil kembali —
  // agent yang sudah punya task kanban sudah diurus di atas.
  if (i.cronLive && i.status === 'idle') return 'desk'
  return 'idle'
}

/**
 * Agent yang punya percakapan hidup: turn yang sedang berjalan di server, atau sesi yang
 * dibalas dalam `CHAT_LIVE_MS` terakhir. Chat bisa diatribusikan karena dijalankan per profil
 * (`hermes -p <agent> chat`), dan nama agent = nama profil.
 */
export function chatLiveAgents(
  sessions: { agent: string; updatedAt: string }[],
  inFlight: string[],
  now: number,
): string[] {
  const out = new Set(inFlight)
  for (const s of sessions) {
    const at = Date.parse(s.updatedAt)
    if (Number.isFinite(at) && now - at >= 0 && now - at < CHAT_LIVE_MS) out.add(s.agent)
  }
  return [...out].sort()
}

export type CronPulse = {
  /** Nama job yang paling baru jalan. */
  name: string
  /** `lastRunAt` job itu, apa adanya dari jobs.json. */
  at: string
  agoSec: number
}

/**
 * Cron yang BARU jalan, kalau ada.
 *
 * ── KENAPA INI KEBIJAKAN, BUKAN FAKTA ──
 * Cron TIDAK BISA diatribusikan ke satu agent: `hermes cron create` tidak punya `--profile`, dan
 * jobs.json tidak menyimpan pemilik (field yang ada: id, name, prompt, schedule, … model — dan
 * `model` pun kosong). Jadi kantor TIDAK TAHU siapa yang mengerjakan cron. Nama job seperti
 * "watchdog-infra-jun" hanya teks pilihan manusia; menebak pemilik dari situ adalah mengarang.
 *
 * Yang jujur: "ada cron yang baru jalan" adalah fakta; "karena itu agent yang sedang bebas kembali
 * ke mejanya" adalah KEBIJAKAN kantor. Job `noAgent` dilewati — itu skrip tanpa agent, tidak ada
 * yang perlu duduk untuknya.
 */
export function cronPulse(
  jobs: { name: string; noAgent: boolean; lastRunAt: string | null }[],
  now: number,
): CronPulse | null {
  let best: CronPulse | null = null
  for (const j of jobs) {
    if (j.noAgent || !j.lastRunAt) continue
    const at = Date.parse(j.lastRunAt)
    if (!Number.isFinite(at)) continue
    const ago = now - at
    // Masa depan = jam tidak sinkron atau data aneh; jangan dihitung sebagai "baru jalan".
    if (ago < 0 || ago >= CRON_WINDOW_MS) continue
    if (!best || ago / 1000 < best.agoSec) best = { name: j.name, at: j.lastRunAt, agoSec: Math.floor(ago / 1000) }
  }
  return best
}

/** Sinyal kerja yang dibawa dari server ke scene. */
export type WorkSignals = {
  /** Agent dengan percakapan hidup. */
  chatLive: string[]
  /** Cron agent yang baru jalan, atau null. */
  cron: CronPulse | null
  /** Agent dalam percakapan A2A yang masih hidup + meja lawan bicaranya. */
  a2a: A2aPair[]
}

/**
 * Satu pasangan A2A yang masih hidup: agent kantor yang sedang bercakap dan
 * meja lawan bicaranya. `peerDesk` null = lawan bicara eksternal / tak
 * dikenal / tanpa meja → perjalanannya DIBATALKAN (lihat `a2aTarget`), dan
 * agent mengambil panggilan di mejanya sendiri.
 */
export type A2aPair = {
  agent: string
  /** Nama peer dari framing inbound, null bila tak tercatat. */
  peer: string | null
  /** deskIndex meja peer bila peer = agent kantor yang punya meja. */
  peerDesk: number | null
}

/**
 * Ke mana avatar yang duty-nya `a2a` harus pergi.
 *
 * - peer punya meja dan bukan diri sendiri → BERDIRI di meja peer (visit).
 * - selain itu tapi agent punya meja sendiri → DUDUK di meja sendiri,
 *   mengambil panggilan di sana (kasus inbound dari peer eksternal).
 * - tidak ada meja sama sekali → null: BATALKAN perjalanan, jangan kirim
 *   avatar ke tempat yang tidak ada.
 */
export function a2aTarget(
  ownDesk: number | null,
  peerDesk: number | null,
  peerIsSelf: boolean,
): { deskIndex: number; visit: boolean } | null {
  if (peerDesk !== null && !peerIsSelf) return { deskIndex: peerDesk, visit: true }
  if (ownDesk !== null) return { deskIndex: ownDesk, visit: false }
  return null
}
