/**
 * PERSETUJUAN — siapa yang menunggu manusia, dan kebijakan apa yang berlaku.
 *
 * YANG PERLU DIKETAHUI DULU. `hermes approvals` TIDAK punya antrean live. Subcommand-nya cuma
 * dua: `suggest` (menambang approval LAMPAU jadi usulan allowlist) dan `test` (verdict satu
 * perintah, dry-run). Tidak ada `list`/`queue`/`pending`. Jadi "antrean persetujuan" di sini
 * BUKAN dibaca dari `hermes approvals` — yang nyata menunggu manusia adalah task kanban yang
 * diblokir dengan jenis needs_input/capability, dan itu sudah dibaca oleh `board.ts`.
 *
 * Tiga sumber, semuanya READ-ONLY dan lewat CLI nyata:
 *
 *   kebijakan  — `hermes config get approvals --json`. Cepat. Mode, timeout, daftar deny.
 *   pola       — `hermes approvals suggest --json`. LAMBAT: memindai seluruh state.db, di mesin
 *                ini >30 detik bahkan untuk 7 hari. Karena itu dibatasi 25 detik, dan timeout
 *                adalah `failure`, bukan hang dan bukan throw.
 *   antrean    — task kanban yang menunggu manusia. TIDAK memanggil CLI baru: datanya diterima
 *                dari pemanggil, sama seperti `readBoard`.
 *
 * Tiap sumber membawa `ageSeconds` dan `failure`, polanya sama dengan `observability.ts`:
 * pembacaan yang gagal harus terlihat gagal, bukan terlihat kosong.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Task } from '@/types/hermes'
import { readBoard, type BoardReadout } from './board'
import { activeTaskByAssignee, getTaskDetail } from './kanban'

const run = promisify(execFile)
const HERMES_BIN = process.env.HERMES_BIN || 'hermes'

/** `config get` itu cepat (<2 dtk). 15 detik sudah berarti CLI-nya bermasalah. */
const POLICY_TIMEOUT_MS = 15_000
/**
 * `suggest` memindai state.db. 25 detik adalah batas yang masih bisa ditunggu sebuah endpoint;
 * di atas itu, lebih jujur bilang "lambat" daripada membuat panelnya menggantung.
 */
const SUGGEST_TIMEOUT_MS = 25_000
/**
 * Hasil `suggest` disimpan 2 menit, BERHASIL ATAU GAGAL. Panel memuat ulang tiap 30 detik; tanpa
 * ini setiap muat ulang menyalakan proses Python 25 detik yang memindai seluruh riwayat sesi.
 * Pola approval berubah dalam hitungan hari, bukan detik.
 */
const SUGGEST_TTL_MS = 120_000

/**
 * Ambang "basi" untuk data persetujuan: 5 menit. Lebih dari dua kali TTL memo di atas — kalau
 * datanya setua ini, berarti penyegarannya sudah gagal lebih dari sekali.
 */
export const APPROVAL_STALE_SEC = 300

/** Apakah data persetujuan ini sudah terlalu tua untuk ditampilkan sebagai keadaan sekarang. */
export function isApprovalsStale(ageSeconds: number): boolean {
  return ageSeconds > APPROVAL_STALE_SEC
}

/** Sama dengan `cleanEnv` di kanban.ts: variabel sesi chat tidak boleh bocor ke proses CLI. */
function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith('HERMES_SESSION_')) delete env[k]
  return env
}

/** Pesan gagal yang bisa dibaca operator, termasuk membedakan TIMEOUT dari gagal biasa. */
function whyFailed(err: unknown, slow: string): string {
  const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string }
  if (e.code === 'ENOENT') return `hermes CLI tidak ditemukan ("${HERMES_BIN}")`
  if (e.killed || e.signal === 'SIGTERM') return slow
  return (e.stderr || e.message || 'gagal tanpa pesan').trim().split('\n').slice(-1)[0]
}

const ageOf = (readAt: string) => Math.max(0, Math.round((Date.now() - Date.parse(readAt)) / 1000))

/* -------------------------------------------------------------- kebijakan -- */

export type ApprovalPolicy = {
  /** `manual` | `smart` | `off` — apa adanya dari config. */
  mode: string | null
  /** Berapa detik sebuah permintaan persetujuan ditunggu sebelum ditolak. */
  timeoutSec: number | null
  /** Jumlah aturan deny eksplisit. */
  denyCount: number
  readAt: string
  ageSeconds: number
  /** Diisi kalau pembacaan GAGAL. Panel wajib menampilkannya, bukan mode kosong. */
  failure?: string
}

export async function readApprovalPolicy(): Promise<ApprovalPolicy> {
  const readAt = new Date().toISOString()
  const empty = { mode: null, timeoutSec: null, denyCount: 0, readAt, ageSeconds: 0 }
  let out: string
  try {
    ;({ stdout: out } = await run(HERMES_BIN, ['config', 'get', 'approvals', '--json'], {
      env: cliEnv(),
      timeout: POLICY_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }))
  } catch (err) {
    return { ...empty, failure: whyFailed(err, `config get lambat (>${POLICY_TIMEOUT_MS / 1000} dtk)`) }
  }
  const start = out.search(/[{]/)
  if (start < 0) return { ...empty, failure: 'kunci "approvals" tidak ada di config' }
  try {
    const raw = JSON.parse(out.slice(start)) as { mode?: unknown; timeout?: unknown; deny?: unknown }
    if (typeof raw.mode !== 'string') return { ...empty, failure: 'config approvals tidak punya "mode"' }
    const timeout = Number(raw.timeout)
    return {
      mode: raw.mode,
      timeoutSec: Number.isFinite(timeout) ? timeout : null,
      denyCount: Array.isArray(raw.deny) ? raw.deny.length : 0,
      readAt,
      ageSeconds: 0,
    }
  } catch {
    return { ...empty, failure: 'keluaran config approvals bukan JSON' }
  }
}

/* -------------------------------------------------------------------- pola -- */

/**
 * Satu usulan allowlist. Bidangnya mengikuti JSON `suggest` apa adanya
 * (`hermes_cli/approvals_suggest.py`): `{n, pattern, kind, count, classes, examples}`.
 */
export type ApprovalProposal = {
  pattern: string
  /** `glob` ("git push *") atau `class` (kelas bahaya). */
  kind: string
  /** Berapa kali pola ini disetujui manusia dalam jendela. */
  count: number
  examples: string[]
}

export type ApprovalPatterns = {
  /** Jumlah usulan. Keluaran kosong = 0, BUKAN error. */
  count: number
  proposals: ApprovalProposal[]
  windowDays: number
  readAt: string
  ageSeconds: number
  failure?: string
}

const PATTERN_DAYS = 7
let patternMemo: { at: number; value: Omit<ApprovalPatterns, 'ageSeconds'> } | null = null
let patternInFlight: Promise<Omit<ApprovalPatterns, 'ageSeconds'>> | null = null

async function scanPatterns(): Promise<Omit<ApprovalPatterns, 'ageSeconds'>> {
  const readAt = new Date().toISOString()
  const empty = { count: 0, proposals: [], windowDays: PATTERN_DAYS, readAt }
  let out: string
  try {
    ;({ stdout: out } = await run(
      HERMES_BIN,
      ['approvals', 'suggest', '--json', '--days', String(PATTERN_DAYS), '--limit', '20'],
      { env: cliEnv(), timeout: SUGGEST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    ))
  } catch (err) {
    return { ...empty, failure: whyFailed(err, `suggest lambat (>${SUGGEST_TIMEOUT_MS / 1000} dtk)`) }
  }
  const start = out.search(/[{]/)
  // Keluar tanpa apa pun = tidak ada pola yang memenuhi syarat. Itu jawaban, bukan kegagalan.
  if (start < 0) return empty
  try {
    const raw = JSON.parse(out.slice(start)) as { proposals?: unknown }
    const list = Array.isArray(raw.proposals) ? raw.proposals : []
    const proposals = list.map((p) => {
      const r = (p || {}) as { pattern?: unknown; kind?: unknown; count?: unknown; examples?: unknown }
      return {
        pattern: String(r.pattern ?? ''),
        kind: String(r.kind ?? ''),
        count: Number(r.count) || 0,
        examples: Array.isArray(r.examples) ? r.examples.map(String) : [],
      }
    })
    return { ...empty, count: proposals.length, proposals }
  } catch {
    return { ...empty, failure: 'keluaran suggest bukan JSON' }
  }
}

export async function readApprovalPatterns(): Promise<ApprovalPatterns> {
  if (!patternMemo || Date.now() - patternMemo.at >= SUGGEST_TTL_MS) {
    // Satu pemindaian sekaligus: dua panel yang terbuka tidak boleh menyalakan dua proses 25 detik.
    patternInFlight ??= scanPatterns().finally(() => {
      patternInFlight = null
    })
    const value = await patternInFlight
    patternMemo = { at: Date.now(), value }
  }
  const v = patternMemo.value
  return { ...v, ageSeconds: ageOf(v.readAt) }
}

/* ----------------------------------------------------------------- antrean -- */

type Events = { kind: string; payload?: Record<string, unknown> }[]

/**
 * Apakah blokir task ini MASIH berlaku. `readBlock` membaca peristiwa `blocked` terakhir, tapi
 * tidak melihat `unblocked` sesudahnya — dan CLI menganggap blokir selesai begitu ada
 * `unblocked` yang lebih baru (`_has_sticky_block` di kanban_db.py). Tanpa ini, task yang sudah
 * dibuka lalu jalan lagi akan membuat agent-nya tampil terhambat selamanya.
 */
function stillBlocked(events: Events): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'unblocked') return false
    if (events[i].kind === 'blocked') return true
  }
  return false
}

export type ApprovalQueue = {
  /** Task yang menunggu manusia — sama dengan `readBoard().waitingOnHuman`, minus blokir yang sudah dibuka. */
  pending: BoardReadout['waitingOnHuman']
  /** Assignee yang task AKTIF-nya (running/review) menunggu manusia. Agent ini BERHENTI. */
  blockedAgentIds: Set<string>
}

export function readApprovalQueue(tasks: Task[], detail: Map<string, { events: Events }>): ApprovalQueue {
  const pending = readBoard(tasks, detail).waitingOnHuman.filter((w) =>
    stillBlocked(detail.get(w.id)?.events || []),
  )
  const waiting = new Set(pending.map((w) => w.id))
  const blockedAgentIds = new Set<string>()
  for (const [name, t] of activeTaskByAssignee(tasks)) {
    if (waiting.has(t.id)) blockedAgentIds.add(name)
  }
  return { pending, blockedAgentIds }
}

/**
 * Set untuk `listAgents(..., blockedAssignees)`: baca detail HANYA task aktif yang punya
 * assignee — tiap `kanban show` satu proses Python, dan task lain tidak bisa membuat agent mana
 * pun berhenti. Dipakai route `agents` dan `tasks` (yang terakhir itu yang memberi makan avatar).
 */
export async function blockedAssigneesFor(tasks: Task[]): Promise<Set<string>> {
  const active = [...activeTaskByAssignee(tasks).values()]
  const details = await Promise.all(active.map((t) => getTaskDetail(t.id)))
  const detail = new Map(active.map((t, i) => [t.id, { events: details[i]?.events || [] }]))
  return readApprovalQueue(active, detail).blockedAgentIds
}
