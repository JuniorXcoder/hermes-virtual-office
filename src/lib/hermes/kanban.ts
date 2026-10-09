/**
 * Server-side Kanban bridge.
 *
 * Talks to the official `hermes kanban ... --json` CLI rather than reading
 * kanban.db directly: the CLI is the stable public surface (it handles board
 * selection, schema migrations and workspace rules for us), while a raw SQL
 * reader would silently break on any schema change.
 *
 * IMPORTANT: the CLI refuses to run inside a delegated/in-session agent context
 * ("delegate_task child contexts cannot mutate Kanban tasks"). Every call here
 * strips those markers so the office UI can drive the board from a web request.
 */
import { execFile } from 'node:child_process'
import { access, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Agent, NewTaskInput, Task, TaskOrigin, TaskStatus, AgentDivision, AgentRole } from '@/types/hermes'
import { parseSoulMarker, soulFor } from './soul'
import { a2aEndpoint, peerBaseUrl } from './meeting-a2a'
import { parseDomains } from './a2a'
import { readEvidence, splitEvidenceBatch, type EvidenceInput, type EvidenceMark, type EvidenceReading } from './evidence'
import type { RunningCard, RunningReadout } from './restart-guard'
import { readVerification, splitVerificationBatch, type VerificationMark, type VerificationReading, type VerifyEvent } from './verification'

const run = promisify(execFile)

const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const BOARD = process.env.HERMES_KANBAN_BOARD || ''
const TIMEOUT_MS = Number(process.env.KANBAN_TIMEOUT_MS || 20_000)

/**
 * Short TTL memo for CLI READS.
 *
 * Each CLI call is a fresh Python process: measured ~1.4 s here, and the UI polls
 * every 4 s with two endpoints, so a small laptop spent most of a core spawning
 * `hermes`. Reads repeat constantly and change slowly, so they are memoised for a
 * few seconds; any WRITE clears the whole memo, so the next poll cannot show a
 * board older than the write that changed it.
 *
 * ponytail: one global memo, 3 s. Upgrade path: per-key TTLs or an event-driven
 * push if the board ever grows past a few hundred tasks.
 */
const READ_VERBS = new Set(['list', 'show', 'runs', 'log', 'assignees', 'attachments'])
const READ_TTL_MS = 3000
const readCache = new Map<string, { at: number; out: string }>()

/** Env without the agent-session markers the CLI treats as "inside a worker". */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of [
    'HERMES_DELEGATED_CHILD_CONTEXT',
    'HERMES_SUPERVISED_CHILD',
    'HERMES_SESSION_ID',
    'HERMES_SESSION_PLATFORM',
    'HERMES_SESSION_CHAT_ID',
    'HERMES_SESSION_USER_ID',
  ]) {
    delete env[k]
  }
  return env
}

async function kanban(args: string[], board?: string): Promise<string> {
  const useBoard = board ?? BOARD
  const full = useBoard ? ['kanban', '--board', useBoard, ...args] : ['kanban', ...args]
  const cacheable = READ_VERBS.has(args[0])
  const key = full.join(' ')
  if (cacheable) {
    const hit = readCache.get(key)
    if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.out
  } else {
    // A write invalidates every memo: the next read must see it.
    readCache.clear()
  }
  try {
    const { stdout } = await run(HERMES_BIN, full, {
      env: cleanEnv(),
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (cacheable) readCache.set(key, { at: Date.now(), out: stdout })
    return stdout
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    if (e.code === 'ENOENT') {
      throw new Error(
        `Hermes CLI not found at "${HERMES_BIN}". Set HERMES_BIN to the hermes executable.`,
      )
    }
    throw new Error(`hermes ${full.join(' ')} failed: ${(e.stderr || e.message || '').trim()}`)
  }
}

async function kanbanJson<T>(args: string[], board?: string): Promise<T> {
  const out = await kanban([...args, '--json'], board)
  // The CLI prints a single JSON document, but be defensive about leading notices.
  const start = out.search(/[[{]/)
  if (start < 0) throw new Error(`expected JSON from: hermes kanban ${args.join(' ')}`)
  return JSON.parse(out.slice(start)) as T
}

/* ------------------------------------------------------------------ tasks -- */

type RawTask = {
  id: string
  title: string
  body?: string | null
  assignee?: string | null
  status: string
  priority?: number | null
  created_by?: string | null
  created_at?: number | null
  updated_at?: number | null
  completed_at?: number | null
  model_override?: string | null
  provider_override?: string | null
}

/**
 * Parse the origin marker out of `created_by`.
 *
 * The CLI stores this field as free text, so it carries the cross-menu link. It is
 * deliberately forgiving: anything unrecognised is kept as `raw` rather than
 * dropped, because the value is set by the CLI (`worker`, `user`) as well as by us.
 */
/** The inverse of parseOrigin: the string stored in `created_by`. */
export function originMarker(o: TaskOrigin): string {
  return o.ref ? `${o.kind}:${o.ref}` : o.kind
}

export function parseOrigin(createdBy?: string | null): TaskOrigin | undefined {
  if (!createdBy) return undefined
  const m = /^(meeting|cron|agent|manual):?(.*)$/.exec(createdBy.trim())
  if (!m) return { kind: 'manual', raw: createdBy }
  const kind = m[1] as TaskOrigin['kind']
  return { kind, ref: m[2] || undefined, raw: createdBy }
}

/** The CLI emits unix seconds; the UI wants ISO. */
function iso(ts?: number | null): string | undefined {
  return typeof ts === 'number' && ts > 0 ? new Date(ts * 1000).toISOString() : undefined
}

function toTask(r: RawTask): Task {
  return {
    id: r.id,
    title: r.title,
    body: r.body ?? undefined,
    assignee: r.assignee ?? null,
    status: r.status as TaskStatus,
    priority: r.priority ?? 0,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    completedAt: iso(r.completed_at),
    origin: parseOrigin(r.created_by),
    model: r.model_override ?? null,
    provider: r.provider_override ?? null,
  }
}

/**
 * Tasks on the office's board.
 *
 * `--archived` is INCLUSIVE: it returns the live rows plus the archived ones.
 * Measured on one board — `list` gave 11 rows, `list --archived` gave 17, and every
 * live id was in the second set.
 *
 * (An earlier note here claimed the opposite, that `--archived` filtered to ONLY
 * archived rows, and cited a 16-vs-0 measurement. That measurement does not
 * reproduce and the conclusion was wrong. The lesson is the flag's semantics were
 * asserted from one reading instead of being checked, which is exactly the mistake
 * the rest of this file keeps paying for.)
 */
export async function listTasks(opts: { includeArchived?: boolean; board?: string } = {}): Promise<Task[]> {
  const args = opts.includeArchived ? ['list', '--archived'] : ['list']
  const rows = await kanbanJson<RawTask[]>(args, opts.board)
  return rows.map(toTask)
}

/**
 * Satu task DENGAN DETAILNYA — peristiwa, komentar, induk, dan error terakhir.
 *
 * `detail` ditambahkan karena `list --json` tidak membawanya: kolom papan memberi tahu SEBUAH
 * task diblokir, tapi hanya peristiwa `blocked` yang memberi tahu KENAPA. Versi sebelumnya
 * mengambil `show --json` lalu membuang empat bidang yang paling berguna di dalamnya
 * (`events`, `comments`, `latest_summary`, `last_failure_error`), jadi UI-nya hanya bisa
 * menampilkan kolom — dan itulah kenapa sebuah papan bisa penuh tanpa satu pun sebab.
 */
export type TaskDetail = {
  events: { kind: string; payload?: Record<string, unknown>; created_at?: number }[]
  comments: { author?: string; body?: string; created_at?: number }[]
  latestSummary: string | null
  lastFailureError: string | null
  children: string[]
}

export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  const out = await kanban(['show', id, '--json']).catch(() => '')
  const start = out.search(/[[{]/)
  if (start < 0) return null
  try {
    const parsed = JSON.parse(out.slice(start)) as {
      task?: { last_failure_error?: string | null }
      events?: { kind: string; payload?: Record<string, unknown>; created_at?: number }[]
      comments?: { author?: string; body?: string; created_at?: number }[]
      latest_summary?: string | null
      children?: unknown
    }
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      latestSummary: parsed.latest_summary ?? null,
      lastFailureError: parsed.task?.last_failure_error ?? null,
      children: Array.isArray(parsed.children)
        ? parsed.children.filter((c): c is string => typeof c === 'string')
        : [],
    }
  } catch {
    return null
  }
}

export async function getTask(id: string): Promise<Task | null> {
  const out = await kanban(['show', id, '--json']).catch(() => '')
  const start = out.search(/[[{]/)
  if (start < 0) return null
  const parsed = JSON.parse(out.slice(start)) as RawTask | { task?: RawTask; parents?: unknown }
  const raw = 'task' in parsed && parsed.task ? parsed.task : (parsed as RawTask)
  if (!raw?.id) return null
  // `show --json` carries the dependency edges; `list --json` does not.
  const parents = 'parents' in parsed && Array.isArray(parsed.parents)
    ? parsed.parents.filter((p): p is string => typeof p === 'string')
    : []
  return { ...toTask(raw), parents }
}

export async function createTask(input: NewTaskInput): Promise<Task> {
  const args = ['create', input.title, '--assignee', input.assignee]
  if (input.body) args.push('--body', input.body)
  if (typeof input.priority === 'number') args.push('--priority', String(input.priority))
  // The origin marker rides on `created_by`, which the CLI accepts as free text.
  // Verified: `create --created-by meeting:m_test123` stores it verbatim and it
  // comes back on `list --json`, so no schema change is needed for the link.
  if (input.origin) args.push('--created-by', originMarker(input.origin))

  const out = await kanban(args)
  const m = out.match(/t_[0-9a-f]{8}/)
  if (!m) throw new Error(`could not read the new task id from: ${out.trim().slice(0, 200)}`)

  const task = await getTask(m[0])
  if (!task) throw new Error(`created ${m[0]} but could not read it back`)
  return task
}

/**
 * Card yang sedang berjalan — sumber jujur untuk penjaga restart gateway
 * (RESTART-SAFE-1).
 *
 * Dibaca dari board lewat CLI (`listTasks`, perintah yang SAMA dipakai papan —
 * saluran yang sudah ada), BUKAN dari tebakan daftar proses. `running` saja:
 * `review` sudah di tangan reviewer, worker-nya tidak lagi dibunuh restart.
 * Gagal baca (CLI mati/timeout) = `{ state: 'unknown' }` — pemanggil JANGAN
 * diam-diam mengizinkan; biarkan operator memutuskan.
 *
 * `board` opsional = harness probe (a): board KOSONG → schedule. Board dipilih
 * per-panggilan (BUKAN const module-load) supaya override per-request berfungsi.
 */
export async function readRunningKanbanCards(board?: string): Promise<RunningReadout> {
  let tasks: Awaited<ReturnType<typeof listTasks>>
  try {
    tasks = await listTasks(board ? { board } : {})
  } catch (err) {
    return { state: 'unknown', error: (err as Error).message.slice(0, 400) }
  }
  const cards: RunningCard[] = tasks
    .filter((t) => t.status === 'running')
    .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return { state: 'ok', cards }
}

/** Free-text guidance injected into the running worker's session. */
/**
 * Every task assigned to a profile.
 *
 * Reads the board the office is bound to (`HERMES_KANBAN_BOARD` or the CLI's
 * active board), which is the same board `listTasks()` shows — so "the tasks this
 * agent owns" means the tasks visible on the wall.
 */
export async function tasksForAssignee(name: string): Promise<Task[]> {
  const all = await listTasks({ includeArchived: true })
  return all.filter((t) => t.assignee === name)
}

/**
 * Delete tasks permanently.
 *
 * `hermes kanban archive --rm` only purges ids that are ALREADY archived, so this
 * is two passes: archive, then purge. Sending ids straight to `--rm` fails with a
 * complaint that they are not archived.
 *
 * Running tasks are refused by the caller, not here — the CLI will archive a
 * running task and that would abandon a live worker.
 */
export async function purgeTasks(ids: string[]): Promise<{ archived: number; purged: number }> {
  if (!ids.length) return { archived: 0, purged: 0 }
  // Chunked: a long argv on a big backlog can exceed the exec limit.
  const CHUNK = 40
  let purged = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    // The archive pass is TOLERANT. The CLI answers "cannot archive <id>" for a
    // task that is already terminal (done/archived) — measured: it exits 0, prints
    // that line, and `--rm` still deletes the task. Treating it as fatal made a
    // successful purge report failure, and the board showed the tasks gone while
    // the UI showed an error.
    await kanban(['archive', ...slice]).catch(() => '')
    // The purge pass is NOT tolerant: if this fails the tasks are still there.
    await kanban(['archive', '--rm', ...slice])
    purged += slice.length
  }
  return { archived: purged, purged }
}

export async function commentOnTask(taskId: string, body: string): Promise<boolean> {
  await kanban(['comment', taskId, body])
  return true
}

export async function releaseWorker(taskId: string): Promise<boolean> {
  await kanban(['reclaim', taskId])
  return true
}

/* ------------------------------------------------------------------ runner -- */

/**
 * Wake the dispatcher now.
 *
 * The board has no runner of its own: `ready` only means "a worker may take
 * this". Spawning is done by the dispatcher, which lives in the gateway — so on a
 * host whose gateway is stopped a task sits in `ready` forever and the UI has no
 * way to say why. This runs ONE dispatch pass, which spawns a detached worker and
 * returns immediately, so the office can offer a "Jalankan" button that works
 * whether or not a gateway happens to be up.
 *
 * `--max 1` keeps one click from spawning the whole backlog. The write path also
 * clears the read memo, so the next poll shows the task as `running`.
 */
export async function dispatchTask(): Promise<{ spawned: string[] }> {
  const out = await kanban(['dispatch', '--max', '1', '--json'])
  const start = out.search(/[[{]/)
  const parsed = start >= 0 ? (JSON.parse(out.slice(start)) as { spawned?: unknown }) : {}
  const spawned = Array.isArray(parsed.spawned)
    ? parsed.spawned.map((s) => (typeof s === 'string' ? s : String((s as { task_id?: string })?.task_id || '')))
    : []
  return { spawned: spawned.filter(Boolean) }
}

/** Move a blocked/scheduled task back to `ready` so the dispatcher will take it. */
export async function promoteTask(taskId: string, reason: string): Promise<boolean> {
  await kanban(['promote', taskId, reason])
  return true
}

/**
 * Return a blocked/scheduled task to the board.
 *
 * `promote` and `unblock` are NOT interchangeable: promote only accepts `todo` or
 * `blocked` and refuses `scheduled` outright, while unblock accepts
 * `blocked`/`scheduled` and lands in `todo` when a parent is still open. The UI
 * has one button, so the caller picks by status.
 */
export async function unblockTask(taskId: string, reason: string): Promise<boolean> {
  await kanban(['unblock', taskId, '--reason', reason])
  return true
}

/** Pin (or clear) the model a task's worker is spawned with. */
export async function setTaskModel(
  taskId: string,
  model: string | null,
  provider?: string | null,
): Promise<boolean> {
  const args = ['set-model', taskId, model || 'none']
  if (model && provider) args.push('--provider', provider)
  await kanban(args)
  return true
}

/**
 * Model catalogue for the picker: every configured provider with its known model
 * ids, read from `hermes config get custom_providers --json` (the CLI masks
 * api_key, so no credential reaches the browser).
 *
 * A provider entry's `models` map is written by the model picker when it probes
 * /v1/models; an entry with none still appears with its default model so it can
 * be picked at all. Deduped by model id, first provider wins.
 */
export type ModelChoice = { model: string; provider: string; label: string }

/**
 * Pure half of the catalogue, split out so it can be tested without spawning the
 * CLI: providers -> deduped model choices.
 */
export function providersToModels(raw: RawProvider[]): ModelChoice[] {
  const out: ModelChoice[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    const name = String(p?.name || '').trim()
    const base = String(p?.base_url || '').trim()
    if (!name || !base) continue
    const ids = [...new Set([...(p?.model ? [p.model] : []), ...Object.keys(p?.models || {})])]
    for (const id of ids) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({ model: id, provider: name, label: `${id} · ${name}` })
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

export async function listModels(): Promise<ModelChoice[]> {
  return providersToModels(await kanbanConfig<RawProvider[]>('custom_providers'))
}

export type RawProvider = {
  name?: string
  base_url?: string
  model?: string
  models?: Record<string, unknown>
}

/** `hermes config get <key> --json` — a TOP-LEVEL command, so it cannot go through
 * `kanban()` (which prefixes the `kanban` subcommand). It shares the read memo
 * under its own key: the provider list changes when the operator edits
 * config.yaml, not between polls.
 */
async function hermesJson<T>(args: string[]): Promise<T> {
  const cacheKey = args.join(' ')
  const hit = readCache.get(cacheKey)
  const out =
    hit && Date.now() - hit.at < READ_TTL_MS
      ? hit.out
      : await run(HERMES_BIN, args, { env: cleanEnv(), timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })
          .then(({ stdout }) => {
            readCache.set(cacheKey, { at: Date.now(), out: stdout })
            return stdout
          })
  const start = out.search(/[[{]/)
  if (start < 0) return [] as unknown as T
  return JSON.parse(out.slice(start)) as T
}

async function kanbanConfig<T>(key: string): Promise<T> {
  return hermesJson<T>(['config', 'get', key, '--json'])
}

/* --------------------------------------------------------- agent (profile) -- */

/**
 * The model a profile runs by default.
 *
 * This is the model a worker is spawned with when its task carries no override
 * (`hermes kanban set-model`), and the one its chat turns use. Read per profile
 * through `-p <name>`, memoised like every other read.
 */
export async function profileModel(name: string): Promise<{ model: string | null; provider: string | null }> {
  try {
    const raw = await hermesJson<{ default?: string; provider?: string } | string>([
      '-p',
      name,
      'config',
      'get',
      'model',
      '--json',
    ])
    if (typeof raw === 'string') return { model: raw || null, provider: null }
    return { model: raw?.default || null, provider: raw?.provider || null }
  } catch {
    return { model: null, provider: null }
  }
}

/** Definitions of OpenAI-compatible providers in scope (global or `-p <name>`).
 * The CLI masks `api_key`, so this is safe to read. Returns null when the
 * key cannot be read at all (as opposed to legitimately empty). */
export async function profileCustomProviders(name: string): Promise<RawProvider[] | null> {
  try {
    const raw = await hermesJson<RawProvider[]>([
      '-p',
      name,
      'config',
      'get',
      'custom_providers',
      '--json',
    ])
    return Array.isArray(raw) ? raw : []
  } catch {
    return null
  }
}

/** Set a profile's default model (and provider). Affects its next spawn/chat turn.
 *
 * When the provider is a `custom:<name>` slug, the matching `custom_providers`
 * DEFINITION is copied from the global config (the same source the model picker
 * reads via `listModels()`) into the profile's own config, then read back to
 * prove it landed. A profile-scoped `model.provider` without a profile-scoped
 * definition is rejected by the CLI as "Unknown provider", so a dangling write
 * is worse than a refusal: resolve first, throw honestly, never half-write.
 */
export async function setProfileModel(
  name: string,
  model: string | null,
  provider?: string | null,
): Promise<void> {
  if (!model) throw new Error('model wajib diisi')
  // The picker's providers all come from `custom_providers`, and a profile's
  // `model.provider` has to be the QUALIFIED slug (`custom:9router`) — that is
  // what `hermes model` itself writes. A bare name is accepted by
  // `kanban set-model` (its own resolver) but not here, so qualify it.
  const qualified = provider
    ? provider.includes(':')
      ? provider
      : `custom:${provider.trim().toLowerCase()}`
    : null
  const customName =
    qualified && qualified.trim().toLowerCase().startsWith('custom:')
      ? qualified.trim().slice('custom:'.length).trim().toLowerCase()
      : null
  // Resolve the definition BEFORE touching the profile: never leave a
  // half-written config behind.
  let defJson: string | null = null
  if (customName) {
    const global = await kanbanConfig<RawProvider[]>('custom_providers').catch(
      () => [] as RawProvider[],
    )
    const list = Array.isArray(global) ? global : []
    const match = list.find((p) => String(p?.name || '').trim().toLowerCase() === customName)
    if (!match || !String(match.base_url || '').trim()) {
      throw new Error(
        `provider "${qualified}" tidak dikenal — tidak ada definisi custom_providers bernama "${customName}" di config global; model profil "${name}" tidak diubah`,
      )
    }
    defJson = JSON.stringify([match])
  }
  // Definition first, then model+provider: a crash between writes leaves the
  // harmless case (unused definition) rather than the fatal one (dangling provider).
  if (defJson) {
    await hermesWrite(['-p', name, 'config', 'set', 'custom_providers', defJson])
  }
  await hermesWrite(['-p', name, 'config', 'set', 'model.default', model])
  if (qualified) {
    await hermesWrite(['-p', name, 'config', 'set', 'model.provider', qualified])
  }
  if (customName && defJson) {
    // Read back: prove the definition actually landed in profile scope.
    const landed = await hermesJson<RawProvider[]>([
      '-p',
      name,
      'config',
      'get',
      'custom_providers',
      '--json',
    ]).catch(() => [] as RawProvider[])
    const ok =
      Array.isArray(landed) &&
      landed.some((p) => String(p?.name || '').trim().toLowerCase() === customName)
    if (!ok) {
      throw new Error(
        `definisi provider "${qualified}" gagal terverifikasi di profil "${name}" — model.default/model.provider sudah tertulis tapi chat bisa gagal ("Unknown provider"); salin manual: hermes -p ${name} config set custom_providers '<json definisi ${customName} dari config global>'`,
      )
    }
  }
}

/** Toolset CLI satu profil (`platform_toolsets.cli`).
 *
 * Tiga keadaan dibedakan (A2A-CALL-1 + koreksi operator):
 * - `[]` = kunci tidak ada / kosong — TERBACA, artinya TIDAK BISA MEMANGGIL
 *   (FAIL di doctor, direncanakan di selfrepair). Semua agent buatan kantor
 *   lahir tanpa kunci ini, jadi ini kasus paling umum — bukan "tak pasti".
 * - `null` = baca BENAR-BENAR gagal (CLI error/timeout, keluaran tak terurai)
 *   — hanya ini yang "tidak bisa dipastikan" (unknown).
 * - daftar berisi = terbaca apa adanya.
 */
export async function profileToolsets(name: string): Promise<string[] | null> {
  try {
    const raw = await hermesJson<{ cli?: unknown } | string[]>([
      '-p',
      name,
      'config',
      'get',
      'platform_toolsets',
      '--json',
    ])
    if (Array.isArray(raw)) return raw.map(String)
    const cli = (raw as { cli?: unknown })?.cli
    if (cli === undefined) return []
    if (!Array.isArray(cli)) return []
    return cli.map((t) => String(t))
  } catch (err) {
    // "Config key not set" = kunci memang tidak ada → TERBACA kosong (FAIL,
    // bukan unknown). Gagal nyata (timeout, executable hilang) = null.
    if (/not set|no such|tidak ada/i.test((err as Error)?.message ?? '')) return []
    return null
  }
}

/**
 * Gabung murni: daftar lama + `a2a`, tanpa duplikat (banding case-insensitive,
 * urutan pertama dipertahankan). Dipisah supaya selftest menguji tanpa CLI.
 */
export function mergeToolsetList(existing: string[] | null): { merged: string[]; added: boolean } {
  const base = [...(existing ?? [])]
  if (base.some((t) => String(t).trim().toLowerCase() === 'a2a')) {
    return { merged: base, added: false }
  }
  return { merged: [...base, 'a2a'], added: true }
}

/**
 * Pastikan profil punya toolset `a2a` (A2A-CALL-1 + SELFREPAIR-1).
 *
 * GABUNG, bukan timpa: toolset lama dipertahankan + `a2a` ditambah.
 * Jalur resmi CLI (`hermes -p <nama> config set platform_toolsets.cli '<json>'`),
 * lalu verifikasi baca-balik. Idempoten: sudah ada = {added:false}, tanpa tulis.
 */
export async function ensureA2aToolset(name: string): Promise<{ added: boolean; toolsets: string[] }> {
  const before = await profileToolsets(name)
  const { merged, added } = mergeToolsetList(before)
  if (!added) return { added: false, toolsets: before ?? [] }
  await hermesWrite(['-p', name, 'config', 'set', 'platform_toolsets.cli', JSON.stringify(merged)])
  const after = await profileToolsets(name)
  if (!after || !after.some((t) => t.trim().toLowerCase() === 'a2a')) {
    throw new Error(`toolset a2a gagal terverifikasi di profil "${name}" — tulis tidak mendarat`)
  }
  return { added: true, toolsets: after }
}

/**
 * Peer A2A global untuk satu agent (`a2a_agents.<slug>-local`).
 *
 * Sebab-2 RAPAT-A2A-2: `a2a_call("mkt-1")` menjawab `unknown agent` karena
 * daftar peer hanya berisi `jun-local` — hop yang "berhasil" kemarin cuma
 * kebetulan model jatuh ke URL penuh. Peer terdaftar = nama SELALU resolvable.
 */
export function peerKeyFor(slug: string): string {
  return `${slug.trim().toLowerCase()}-local`
}

/** URL penuh peer satu agent (basis SAMA dengan message/send kantor). */
export function peerEntryUrl(slug: string): string {
  return a2aEndpoint(peerBaseUrl(), slug)
}

/** Banding URL peer: abaikan garis miring akhir (tulisan CLI vs office). */
export function samePeerUrl(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '')
}

export type A2aPeerEntry = { url?: string; timeout?: number }

/**
 * Daftar peer A2A satu profil (`hermes -p <nama> config get a2a_agents`).
 *
 * Gate tool Hermes (`_a2a_tools_available`) membaca config SCOPE PROFIL sesi
 * itu — bukan global. Profil tanpa `a2a_agents` = tool a2a_call TAK MUNCUL di
 * sesi profil itu meski peer global ada (terbukti: mkt-1 "TOOL A2A_CALL TIDAK
 * ADA" sebelum peer profil ditulis, gate terbuka sesudahnya). Null = baca
 * gagal (unknown); {} = tak ada peer (gate tutup = FAIL, bukan unknown).
 */
export async function listProfilePeers(name: string): Promise<Record<string, A2aPeerEntry> | null> {
  try {
    const raw = await hermesJson<Record<string, A2aPeerEntry> | null>([
      '-p', name, 'config', 'get', 'a2a_agents', '--json',
    ])
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return raw
  } catch (err) {
    if (/not set|no such|tidak ada/i.test((err as Error)?.message ?? '')) return {}
    return null
  }
}

/**
 * Daftar peer A2A global (`a2a_agents`). Null = tak terbaca (unknown),
 * bukan kosong — bedakan seperti profileToolsets.
 */
export async function listA2aPeers(): Promise<Record<string, A2aPeerEntry> | null> {
  try {
    const raw = await kanbanConfig<Record<string, A2aPeerEntry> | null>('a2a_agents')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return raw
  } catch {
    return null
  }
}

/**
 * Pastikan peer `<slug>-local` terdaftar menunjuk path served agent itu.
 *
 * Ditulis di DUA scope (A2A-CALL-1 bukti live 2026-10-09):
 * - global: supaya `a2a_call("nama")` resolvable dari sesi mana pun;
 * - profil TIAP agent yang di-serve (kecuali dirinya): supaya gate tool Hermes
 *   (`_a2a_tools_available`, baca scope profil) TERBUKA dan tool a2a_call
 *   muncul di sesi profil itu. Tanpa peer profil, agent "bisa dipanggil tapi
 *   tak bisa memanggil" meski toolset a2a ada.
 *
 * GABUNG, bukan timpa: `hermes config set` nested hanya menyentuh kunci itu,
 * entri peer lain dipertahankan. Verifikasi baca-balik; throw jujur bila tak
 * mendarat. Idempoten: sudah benar = {added:false}, tanpa tulis.
 */
export async function ensureA2aPeer(
  slug: string,
  callerProfiles: string[] = [],
): Promise<{ added: boolean; key: string; url: string; profileAdded: string[] }> {
  const clean = slug.trim().toLowerCase()
  const key = peerKeyFor(clean)
  const url = peerEntryUrl(clean)
  const peers = await listA2aPeers()
  if (peers === null) {
    throw new Error(`daftar peer a2a_agents tak terbaca — peer \"${key}\" tidak bisa dipastikan`)
  }
  let added = false
  if (!(peers[key] && samePeerUrl(String(peers[key]?.url ?? ''), url))) {
    await hermesWrite(['config', 'set', `a2a_agents.${key}`, JSON.stringify({ url, timeout: 120 }), '--force'])
    const after = await listA2aPeers()
    if (!after?.[key] || !samePeerUrl(String(after[key]?.url ?? ''), url)) {
      throw new Error(`peer \"${key}\" gagal terverifikasi — tulis tidak mendarat`)
    }
    added = true
  }
  // Peer di scope profil tiap pemanggil (gate tool baca scope profil).
  const profileAdded: string[] = []
  for (const caller of [...new Set(callerProfiles.map((c) => c.trim().toLowerCase()))]) {
    if (!caller || caller === clean) continue
    const mine = await listProfilePeers(caller)
    if (mine === null) {
      throw new Error(`peer profil \"${caller}\" tak terbaca — peer \"${key}\" tidak bisa dipastikan`)
    }
    if (mine[key] && samePeerUrl(String(mine[key]?.url ?? ''), url)) continue
    await hermesWrite(['-p', caller, 'config', 'set', `a2a_agents.${key}`, JSON.stringify({ url, timeout: 120 }), '--force'])
    const re = await listProfilePeers(caller)
    if (!re?.[key] || !samePeerUrl(String(re[key]?.url ?? ''), url)) {
      throw new Error(`peer \"${key}\" gagal terverifikasi di profil \"${caller}\" — tulis tidak mendarat`)
    }
    profileAdded.push(caller)
  }
  return { added, key, url, profileAdded }
}

/**
 * Cabut peer `<slug>-local` dari global DAN scope profil pemanggil supaya tak
 * tinggal peer basi di kedua scope. Tak terdaftar = {removed:false} (hasil
 * sah, bukan error) — idempoten. Dipakai jalur kill/unserve.
 */
export async function removeA2aPeer(
  slug: string,
  callerProfiles: string[] = [],
): Promise<{ removed: boolean; key: string; profileRemoved: string[] }> {
  const key = peerKeyFor(slug)
  let removed = false
  try {
    await hermesWrite(['config', 'unset', `a2a_agents.${key}`])
    removed = true
  } catch (err) {
    if (!/not set|no such|tidak ada/i.test((err as Error)?.message ?? '')) {
      throw err
    }
  }
  const profileRemoved: string[] = []
  for (const caller of [...new Set(callerProfiles.map((c) => c.trim().toLowerCase()))]) {
    if (!caller || caller === slug.trim().toLowerCase()) continue
    try {
      await hermesWrite(['-p', caller, 'config', 'unset', `a2a_agents.${key}`])
      profileRemoved.push(caller)
    } catch (err) {
      if (!/not set|no such|tidak ada/i.test((err as Error)?.message ?? '')) {
        throw err
      }
    }
  }
  return { removed, key, profileRemoved }
}
/**
 * Tambal definisi provider menggantung di scope profil (SELFREPAIR-1).
 *
 * Menyalin definisi `custom_providers` bernama `<nama>` dari config global ke
 * scope profil — langkah yang SAMA dengan setProfileModel (MODEL-PROVIDER-1),
 * tapi untuk profil yang providernya menggantung TANPA ganti model.
 * Verifikasi baca-balik; throw jujur bila definisi tak dikenal di global.
 */
export async function ensureProviderDef(name: string, provider: string): Promise<{ copied: boolean }> {
  const need = provider.trim().slice('custom:'.length).trim().toLowerCase()
  const global = await kanbanConfig<RawProvider[]>('custom_providers').catch(
    () => [] as RawProvider[],
  )
  const list = Array.isArray(global) ? global : []
  const match = list.find((p) => String(p?.name || '').trim().toLowerCase() === need)
  if (!match || !String(match.base_url || '').trim()) {
    throw new Error(
      `provider "${provider.trim()}" tidak dikenal — tidak ada definisi custom_providers bernama "${need}" di config global; profil "${name}" tidak diubah`,
    )
  }
  await hermesWrite(['-p', name, 'config', 'set', 'custom_providers', JSON.stringify([match])])
  const landed = await profileCustomProviders(name).catch(() => null)
  const ok =
    Array.isArray(landed) &&
    landed.some((p) => String(p?.name || '').trim().toLowerCase() === need)
  if (!ok) {
    throw new Error(`definisi provider "${provider.trim()}" gagal terverifikasi di profil "${name}"`)
  }
  return { copied: true }
}

/** A TOP-LEVEL write: same cleanEnv contract, no `kanban` prefix. */
async function hermesWrite(args: string[]): Promise<string> {
  readCache.clear()
  try {
    const { stdout } = await run(HERMES_BIN, args, {
      env: cleanEnv(),
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    throw new Error(`hermes ${args.join(' ')} failed: ${(e.stderr || e.message || '').trim()}`)
  }
}

/* ----------------------------------------------------------------- agents -- */

type RawAssignee = { name: string; on_disk?: boolean; counts?: Record<string, number> }

/**
 * Desk assignment is derived, not stored: agents that are working or reviewing get a
 * station first, idle ones fill the remaining desks in alphabetical order. That keeps
 * desk positions stable across reloads without persisting layout state in the Hermes
 * install.
 *
 * Roles are guessed from the profile NAME, which is all the board gives us. The
 * mapping is deliberately generic — a keyword in the name, not a list of people.
 * It used to carry a table of specific profiles ('lulu', 'risko', 'zaki', 'pingot')
 * which was one install's roster hardcoded into a program meant to ship to anyone;
 * an operator here would get roles assigned by somebody else's naming.
 *
 * `default` is special-cased because it is the install's own orchestrator profile,
 * and is included in the office roster like the Hermes assignee list.
 */
const ROLE_KEYWORDS: [RegExp, AgentRole][] = [
  [/ceo|direktur|boss|chief/i, 'ceo'],
  [/qa|test|verif/i, 'qa'],
  [/research|riset|analyst/i, 'researcher'],
  [/ops|devops|infra|deploy|sre/i, 'devops'],
  [/affiliat/i, 'affiliator'],
  [/market|promo|growth/i, 'marketing'],
  [/seo|keyword|ranking/i, 'seo'],
  [/content|konten|creator|video|script|tulis/i, 'content'],
  [/front|ui|web|design/i, 'frontend'],
  [/back|api|server|data|db/i, 'backend'],
]

/** Role → divisi. CEO/orchestrator = exec, tech roles = tech, dst. */
const ROLE_DIVISION: Record<AgentRole, AgentDivision> = {
  ceo: 'exec',
  orchestrator: 'exec',
  // A manager's division comes from its SOUL marker, not from the role alone; this
  // is only the fallback for a manager profile with no marker on disk.
  manager: 'tech',
  backend: 'tech',
  frontend: 'tech',
  qa: 'tech',
  researcher: 'tech',
  devops: 'tech',
  marketing: 'growth',
  seo: 'growth',
  content: 'content',
  affiliator: 'content',
}

/** Divisi untuk sebuah role. */
export function divisionFor(role: AgentRole): AgentDivision {
  return ROLE_DIVISION[role] ?? 'tech'
}

/** Divisi untuk sebuah nama profil (via role keyword). */
export function divisionForName(name: string): AgentDivision {
  return divisionFor(roleFor(name))
}

export function roleFor(name: string): AgentRole {
  if (name === 'default') return 'orchestrator'
  for (const [re, role] of ROLE_KEYWORDS) {
    if (re.test(name)) return role
  }
  // A name that says nothing about its job still needs a desk; backend is the
  // least surprising default for an autonomous engineering office.
  return 'backend'
}

/**
 * Every profile the Hermes install knows about, with how many tasks each holds.
 * This is the spawn menu: an assignee that exists here can be given work, and
 * assigning it work is what brings it into the office.
 */
export async function listAssignees(): Promise<{ name: string; onDisk: boolean; total: number }[]> {
  const raw = await kanbanJson<RawAssignee[]>(['assignees'])
  return raw
    .map((r) => ({
      name: r.name,
      onDisk: r.on_disk ?? true,
      total: Object.values(r.counts ?? {}).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/* ----------------------------------------------------------------- profiles -- */

/** Where Hermes keeps its state. `HERMES_HOME` wins if the operator set it. */
export function hermesHome(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

/**
 * Profiles on disk.
 *
 * Read from the filesystem rather than `hermes profile list`, because that
 * command has no `--json` mode: parsing its table would break on a column
 * reorder or a long model name, and the office would silently show the wrong
 * roster. A directory containing `config.yaml` is a profile — that is the same
 * thing `hermes profile list` counts.
 */
export async function listProfiles(): Promise<string[]> {
  const out: string[] = []

  // `default` is the install's own profile and lives at the Hermes root
  // (~/.hermes/config.yaml), NOT under profiles/. Reading only the profiles/
  // directory left it out, so it appeared as an agent on the floor (assignees include
  // it) while `listProfiles().includes('default')` was false — which made the chat
  // panel list it and then refuse to send to it.
  try {
    await access(path.join(hermesHome(), 'config.yaml'))
    out.push('default')
  } catch {
    // no root config: a profiles-only install
  }

  const dir = path.join(hermesHome(), 'profiles')
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      try {
        await access(path.join(dir, e.name, 'config.yaml'))
        out.push(e.name)
      } catch {
        // a directory without config.yaml is not a profile
      }
    }
  } catch {
    // no profiles/ directory yet
  }
  return out.sort()
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

/**
 * Create a profile.
 *
 * Deliberately NOT `--clone`: cloning copies the active profile's config.yaml,
 * which carries its model, provider and API keys. Spawning an office worker must
 * not hand it someone else's credentials. The new profile starts empty and
 * inherits from the shell environment, exactly as `hermes profile create` does
 * without flags.
 *
 * `--no-alias` skips wrapper-script creation; the office drives the profile
 * through the kanban CLI, which does not need a shell alias.
 */
/**
 * Create a profile — with soul.
 *
 * `soul`: 1 prompt teks bebas dari form create. Ditulis utuh sebagai SOUL.md
 * profil tersebut (jadi identitas + role agent itu). Kosong → pakai template
 * soulFor(role, division).
 *
 * `role`/`division`: dicatat di marker SOUL.md + `hermes profile describe`,
 * supaya route agents GET bisa baca tanpa menebak dari nama.
 */
export async function createProfile(
  name: string,
  opts?: { description?: string; role?: AgentRole; division?: AgentDivision; soul?: string; domains?: string[] },
): Promise<{ name: string; description: string; role: AgentRole; division: AgentDivision; domains: string[] }> {
  const clean = name.trim().toLowerCase()
  if (!PROFILE_NAME.test(clean)) {
    throw new Error(
      'nama profil harus huruf kecil/angka (boleh - dan _), maksimal 64 karakter',
    )
  }
  const existing = await listProfiles()
  if (existing.includes(clean)) {
    throw new Error(`profil "${clean}" sudah ada`)
  }
  const role: AgentRole = opts?.role ?? roleFor(clean)
  const division: AgentDivision = opts?.division ?? divisionFor(role)
  const domains = parseDomains(opts?.domains?.join(','))
  const desc = (opts?.description || `${clean} — ${role}, divisi ${division}`).trim().slice(0, 200)
  const args = ['profile', 'create', clean, '--no-alias', '--description', desc]
  try {
    await run(HERMES_BIN, args, { env: cleanEnv(), timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    if (e.code === 'ENOENT') {
      throw new Error(`Hermes CLI not found at "${HERMES_BIN}".`)
    }
    throw new Error(`hermes profile create ${clean} failed: ${(e.stderr || e.message || '').trim()}`)
  }
  // Soul: 1 prompt dari form → SOUL.md profil. Kosong → template per role.
  // Marker ikut menyimpan domains (pemetaan office, bukan A2A). Soul kustom
  // tanpa marker tetap diberi marker — role/divisi/domains harus terbaca mesin.
  const soulText = (opts?.soul || '').trim() || soulFor(role, clean, division, domains)
  const soulWithMarker = /office:\s*role=/i.test(soulText)
    ? soulText
    : `${soulText}\n<!-- office: role=${role} division=${division}${domains.length ? ` domains=${domains.join(',')}` : ''} -->`
  const dir = path.join(hermesHome(), 'profiles', clean)
  await writeFile(path.join(dir, 'SOUL.md'), soulWithMarker, 'utf8')
  // describe: catat role/divisi supaya terbaca tanpa buka SOUL.md
  await hermesWrite(['profile', 'describe', clean, `${desc} [${role}/${division}]`]).catch(() => {})
  return { name: clean, description: desc, role, division, domains }
}

/**
 * Is this profile's gateway currently running?
 *
 * Two signals, because a profile can be served either way:
 *
 *   1. Its own `gateway.pid` — a JSON blob, NOT a bare number, and the PID has to
 *      be checked against the process table because a stale file outlives a crash.
 *   2. The default gateway's `served_profiles` list. A multiplexed profile has no
 *      `gateway.pid` of its own, so signal 1 alone reports it stopped.
 *
 * Read from files rather than `hermes gateway status`, which reports only the
 * active profile.
 */
async function gatewayRunning(name: string): Promise<boolean> {
  const home = hermesHome()
  const dir = name === 'default' ? home : path.join(home, 'profiles', name)
  try {
    const raw = await readFile(path.join(dir, 'gateway.pid'), 'utf8')
    const pid = Number(JSON.parse(raw)?.pid)
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0) // signal 0 = liveness probe, sends nothing
        return true
      } catch {
        // stale file from a process that has exited
      }
    }
  } catch {
    // no pid file: either stopped, or served by the multiplexer (checked below)
  }
  try {
    const state = JSON.parse(await readFile(path.join(home, 'gateway_state.json'), 'utf8'))
    const served = Array.isArray(state?.served_profiles) ? state.served_profiles : []
    if (served.includes(name)) return true
  } catch {
    // no state file
  }
  return false
}

/**
 * Delete a profile for real.
 *
 * This is destructive: `hermes profile delete` removes the profile directory,
 * its sessions, its memory store and its wrapper script. The only thing left is a
 * one-line tombstone in `profiles/.deleted/<name>`, which is a marker for the
 * gateway, NOT a backup — nothing can restore from it.
 *
 * Refused for a profile whose gateway is running. `hermes profile delete` stops
 * that gateway itself, so deleting a served profile would take down whatever
 * messaging it handles — a bot going silent is not an acceptable side effect of a
 * button in a 3D office. The CLI already refuses `default`; this refuses more.
 *
 * `--yes` skips the CLI's interactive "type the name to confirm" prompt; the UI
 * owns confirmation and the API is not a terminal.
 */
export async function deleteProfile(name: string): Promise<void> {
  const clean = name.trim().toLowerCase()
  if (!clean) throw new Error('nama profil wajib diisi')
  if (clean === 'default') {
    throw new Error('profil "default" tidak bisa dihapus')
  }
  const profiles = await listProfiles()
  if (!profiles.includes(clean)) {
    throw new Error(`profil "${clean}" tidak ada di disk`)
  }
  if (await gatewayRunning(clean)) {
    throw new Error(
      `gateway profil "${clean}" sedang berjalan — hentikan dulu sebelum dihapus`,
    )
  }
  try {
    await run(HERMES_BIN, ['profile', 'delete', clean, '--yes'], {
      env: cleanEnv(),
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    if (e.code === 'ENOENT') {
      throw new Error(`Hermes CLI not found at "${HERMES_BIN}".`)
    }
    throw new Error(`hermes profile delete ${clean} failed: ${(e.stderr || e.message || '').trim()}`)
  }
}

/**
 * Baca SOUL.md satu profil. Null bila tidak ada (profil lama / default).
 * `default` tinggal di root Hermes, bukan di profiles/.
 */
async function readSoul(name: string): Promise<string | null> {
  const home = hermesHome()
  const p = name === 'default' ? path.join(home, 'SOUL.md') : path.join(home, 'profiles', name, 'SOUL.md')
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

/**
 * Task AKTIF per assignee (running/review). Diekspor supaya `approvals.ts` memakai peta yang
 * SAMA dengan `listAgents` — kalau dua tempat menghitung "task aktif" sendiri-sendiri, cepat
 * atau lambat agent yang dianggap terhambat bukan agent yang duduk di meja.
 */
export function activeTaskByAssignee(tasks: Task[]): Map<string, Task> {
  const active = new Map<string, Task>()
  for (const t of tasks) {
    if (!t.assignee) continue
    if (t.status === 'running' || t.status === 'review') active.set(t.assignee, t)
  }
  return active
}

export async function listAgents(
  tasks: Task[],
  prefetchedAssignees?: { name: string; onDisk: boolean; total: number }[],
  /** Assignee yang task aktifnya menunggu manusia (lihat `approvals.ts`). Tampil 'blocked'. */
  blockedAssignees?: Set<string>,
): Promise<Agent[]> {
  const raw = prefetchedAssignees ?? (await listAssignees())
  // Profiles AND assignees. Reading only `assignees` meant a freshly created
  // profile stayed invisible until it was given a task, so "create a profile"
  // looked like it had done nothing.
  const names = [...new Set([...raw.map((r) => r.name), ...(await listProfiles())])].sort()

  const active = activeTaskByAssignee(tasks)

  // Soul per agent: baca marker office (role/divisi/domains). Fallback ke keyword nama.
  const souls = await Promise.all(names.map((n) => readSoul(n)))
  const meta = names.map((name, i) => {
    const soul = souls[i]
    const parsed = soul ? parseSoulMarker(soul) : {}
    const role = parsed.role ?? roleFor(name)
    const division = parsed.division ?? divisionFor(role)
    return { name, soul, role, division, domains: parsed.domains ?? [] as string[] }
  })

  // Meja PER DIVISI dulu, lalu meja KOSONG divisi lain (lihat `assignDesks`): yang punya
  // kerja didahulukan, lalu abjad. `null` hanya kalau tidak ada meja kosong yang boleh dipakai —
  // dulu divisi exec (nol meja) membuat CEO selalu `null` dan tidak pernah duduk kerja.
  const { assignDesks } = await import('../office/layout')
  const seatOf = assignDesks(
    meta.map((m) => ({ name: m.name, division: m.division, role: m.role, busy: active.has(m.name) })),
  )

  return meta.map(({ name, soul, role, division, domains }) => {
    const task = active.get(name)
    // Menunggu manusia MENGALAHKAN working/review: agent yang berhenti menunggu keputusan
    // tidak boleh tampil sedang bekerja. Kursinya tetap — dia masih memegang task itu.
    const status: Agent['status'] = task
      ? blockedAssignees?.has(name)
        ? 'blocked'
        : task.status === 'review'
        ? 'review'
        : 'working'
      : 'idle'
    return {
      name,
      displayName: name,
      role,
      division,
      soulExists: soul != null,
      domains,
      deskIndex: seatOf.get(name) ?? null,
      status,
      currentTaskId: task?.id ?? null,
    }
  })
}

/* --------------------------------------------------------------- activity -- */

export type RunInfo = {
  id: number
  profile: string
  status: string
  outcome?: string | null
  startedAt?: number
  endedAt?: number | null
  summary?: string | null
  error?: string | null
  /** Bebas dari worker, mis. `{branch, commit, selftest}`. Diukur pada `runs --json`. */
  metadata?: Record<string, unknown> | null
}

type RawRun = {
  id: number
  profile?: string
  status: string
  outcome?: string | null
  started_at?: number
  ended_at?: number | null
  summary?: string | null
  error?: string | null
  metadata?: Record<string, unknown> | null
}

/** Run history for a task — powers the screen-peeker modal. */
export async function listRuns(taskId: string): Promise<RunInfo[]> {
  const rows = await kanbanJson<RawRun[]>(['runs', taskId]).catch(() => [])
  return rows.map((r) => ({
    id: r.id,
    profile: r.profile ?? '',
    status: r.status,
    outcome: r.outcome ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
    summary: r.summary ?? null,
    error: r.error ?? null,
    metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : null,
  }))
}

/** Raw log tail for a task, used as the terminal-peeker body. */
export async function taskLog(taskId: string, bytes = 16_000): Promise<string> {
  return kanban(['log', taskId, '--tail', String(bytes)]).catch(() => '')
}

/* --------------------------------------------------------------- evidence -- */

/**
 * Lampiran sebuah task. Field dari `_ATTACHMENT_FIELDS` CLI (hermes_cli/kanban_output.py):
 * id, filename, content_type, size, uploaded_by, stored_path, created_at. CLI hanya bisa
 * MENDAFTAR — tidak ada perintah untuk membaca isinya, jadi office hanya menampilkan nama.
 */
export type AttachmentInfo = {
  id: number
  filename: string
  contentType: string | null
  size: number
  uploadedBy: string | null
  createdAt?: string
}

type RawAttachment = {
  id: number
  filename?: string
  content_type?: string | null
  size?: number | null
  uploaded_by?: string | null
  created_at?: number | null
}

/** Toleran: gagal membaca = tidak ada lampiran yang bisa ditunjukkan. */
export async function listAttachments(taskId: string): Promise<AttachmentInfo[]> {
  const rows = await kanbanJson<RawAttachment[]>(['attachments', taskId]).catch(() => [])
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r && typeof r.filename === 'string')
    .map((r) => ({
      id: r.id,
      filename: r.filename as string,
      contentType: r.content_type ?? null,
      size: r.size ?? 0,
      uploadedBy: r.uploaded_by ?? null,
      createdAt: iso(r.created_at),
    }))
}

type RawShow = {
  task?: RawTask
  latest_summary?: string | null
  runs?: (RawRun & { metadata?: Record<string, unknown> | null })[]
}

/** Run terakhir = id terbesar; urutan array tidak dijanjikan CLI. */
function lastRunOf<T extends { id: number }>(runs: T[] | undefined): T | null {
  if (!Array.isArray(runs) || !runs.length) return null
  return runs.reduce((a, b) => (b.id > a.id ? b : a))
}

/**
 * `show --json` yang TIDAK toleran: gagal membaca harus terlihat sebagai gagal, bukan sebagai
 * task tanpa bukti. Satu panggilan ini sudah membawa `runs[]` lengkap dengan metadata.
 */
async function showStrict(id: string): Promise<RawShow & { task: RawTask }> {
  const parsed = await kanbanJson<RawShow>(['show', id])
  if (!parsed?.task?.id) throw new Error(`tugas "${id}" tidak terbaca dari kanban show`)
  return parsed as RawShow & { task: RawTask }
}

export type TaskEvidence = EvidenceReading & {
  taskId: string
  status: string
  attachments: AttachmentInfo[]
  /** Detik sejak `completed_at`, dihitung saat dibaca. */
  completedAgeSeconds: number | null
  /** Detik sejak bukti ini dibaca dari CLI (0 saat dikirim). */
  ageSeconds: number
  readAt: string
}

/**
 * Bukti LENGKAP untuk SATU task (TaskPanel): show + runs + log + lampiran, paralel.
 * `show` wajib terbaca (melempar bila tidak); runs/log/lampiran boleh kosong.
 */
export async function getTaskEvidence(id: string): Promise<TaskEvidence> {
  const [shown, runs, log, attachments] = await Promise.all([
    showStrict(id),
    listRuns(id),
    taskLog(id, 2000),
    listAttachments(id),
  ])
  const task = toTask(shown.task)
  // `runs --json` bisa kosong saat gagal (listRuns toleran); `show` membawa run yang sama.
  type RunEvidence = Pick<RunInfo, 'id' | 'outcome' | 'summary' | 'metadata'>
  const last = lastRunOf<RunEvidence>(runs.length ? runs : (shown.runs ?? []).map((r) => ({
    id: r.id,
    outcome: r.outcome ?? null,
    summary: r.summary ?? null,
    metadata: r.metadata ?? null,
  })))
  const reading = readEvidence(task, {
    latestSummary: shown.latest_summary ?? null,
    lastRunSummary: last?.summary ?? null,
    lastRunOutcome: last?.outcome ?? null,
    lastRunMeta: last?.metadata ?? null,
    hasLog: log.trim().length > 0,
    attachmentNames: attachments.map((a) => a.filename),
  })
  return {
    ...reading,
    taskId: id,
    status: task.status,
    attachments,
    completedAgeSeconds: secondsSince(task.completedAt),
    ageSeconds: 0,
    readAt: new Date().toISOString(),
  }
}

function secondsSince(isoAt?: string): number | null {
  if (!isoAt) return null
  const t = Date.parse(isoAt)
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null
}

export type EvidenceMarkRow = { id: string; mark: EvidenceMark; completedAgeSeconds?: number | null; error?: string }

/**
 * Penanda RINGKAS untuk banyak task (daftar/papan): hanya `show --json` (yang sudah membawa
 * `latest_summary` dan `runs[]`) — TANPA log dan lampiran, karena dua sumber itu berarti dua
 * proses lagi per id. Karena itu task yang buktinya HANYA log/lampiran akan terbaca
 * `unproven` di sini; panel detail yang membaca keempat sumber adalah penentu akhirnya.
 *
 * Id ke-41 dst. -> `unchecked` (netral). Show gagal -> `failed` (netral). Status diambil
 * dari CLI, bukan dari klien.
 */
export async function evidenceMarks(ids: string[]): Promise<EvidenceMarkRow[]> {
  const { checked, unchecked: rest } = splitEvidenceBatch(ids)

  // Paralel terbatas: 40 proses Python sekaligus akan menelan satu laptop kecil.
  const LIMIT = 6
  const out: EvidenceMarkRow[] = new Array(checked.length)
  let next = 0
  async function worker() {
    while (next < checked.length) {
      const i = next++
      const id = checked[i]
      try {
        const shown = await showStrict(id)
        const task = toTask(shown.task)
        const last = lastRunOf(shown.runs)
        const input: EvidenceInput = {
          latestSummary: shown.latest_summary ?? null,
          lastRunSummary: last?.summary ?? null,
          lastRunOutcome: last?.outcome ?? null,
          lastRunMeta: last?.metadata ?? null,
          hasLog: false,
          attachmentNames: [],
        }
        out[i] = {
          id,
          mark: readEvidence(task, input).verdict,
          completedAgeSeconds: secondsSince(task.completedAt),
        }
      } catch (err) {
        out[i] = { id, mark: 'failed', error: (err as Error).message }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, checked.length) }, worker))
  return [...out, ...rest.map((id) => ({ id, mark: 'unchecked' as const }))]
}

/* ------------------------------------------------------------ verification -- */

/**
 * Status verifikasi SATU task (TaskPanel): `show --json` membawa task + `events[]` sekaligus,
 * jadi satu panggilan cukup. Office tidak menjalankan kode task — hanya membaca jejak.
 * `show` wajib terbaca (melempar bila tidak); gagal = 502, bukan "klaim".
 */
export type TaskVerification = VerificationReading & {
  taskId: string
  status: string
  /** Detik sejak dibaca dari CLI (0 saat dikirim). */
  ageSeconds: number
  readAt: string
}

export async function getTaskVerification(id: string): Promise<TaskVerification> {
  const parsed = await kanbanJson<{ task?: RawTask; events?: VerifyEvent[] }>(['show', id])
  if (!parsed?.task?.id) throw new Error(`tugas "${id}" tidak terbaca dari kanban show`)
  const task = toTask(parsed.task)
  const reading = readVerification(task, Array.isArray(parsed.events) ? parsed.events : [])
  return {
    ...reading,
    taskId: id,
    status: task.status,
    ageSeconds: 0,
    readAt: new Date().toISOString(),
  }
}

export type VerificationMarkRow = { id: string; mark: VerificationMark; error?: string }

/**
 * Penanda RINGKAS untuk banyak task (daftar/papan): hanya `show --json` per id (task + events).
 * Id ke-41 dst. -> `unchecked` (netral). Show gagal -> `failed` (netral).
 */
export async function verificationMarks(ids: string[]): Promise<VerificationMarkRow[]> {
  const { checked, unchecked: rest } = splitVerificationBatch(ids)

  // Paralel terbatas: 40 proses Python sekaligus akan menelan satu laptop kecil.
  const LIMIT = 6
  const out: VerificationMarkRow[] = new Array(checked.length)
  let next = 0
  async function worker() {
    while (next < checked.length) {
      const i = next++
      const id = checked[i]
      try {
        const shown = await kanbanJson<{ task?: RawTask; events?: VerifyEvent[] }>(['show', id])
        if (!shown?.task?.id) throw new Error(`tugas "${id}" tidak terbaca dari kanban show`)
        const task = toTask(shown.task)
        out[i] = {
          id,
          mark: readVerification(task, Array.isArray(shown.events) ? shown.events : []).verdict,
        }
      } catch (err) {
        out[i] = { id, mark: 'failed', error: (err as Error).message }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, checked.length) }, worker))
  return [...out, ...rest.map((id) => ({ id, mark: 'unchecked' as const }))]
}

/* ------------------------------------------------------------------ ESTOP -- */

/**
 * Jeda / lanjutkan SELURUH sistem.
 *
 * `hermes pause` menulis sentinel `$HERMES_HOME/ESTOP`; `hermes resume` menghapusnya. Ini
 * SATU-SATUNYA aksi di office yang memengaruhi seluruh instalasi, bukan satu task — jadi
 * hanya berjalan kalau manusia memintanya, dan alasannya wajib (`checkAction` yang memutuskan,
 * bukan berkas ini).
 */
export async function pauseAll(reason: string): Promise<string> {
  return hermesWrite(['pause', '--reason', reason])
}

export async function resumeAll(): Promise<string> {
  return hermesWrite(['resume'])
}

/** Buka blokir dengan jenis yang dipilih manusia. Lihat `control.ts` untuk arti tiap jenis. */
export async function advanceTask(
  action: 'unblock' | 'promote' | 'release',
  taskId: string,
  reason?: string,
): Promise<string> {
  switch (action) {
    case 'unblock':
      return kanban(['unblock', taskId, '--reason', reason || 'dibuka dari office'])
    case 'promote':
      return kanban(['promote', taskId, reason || 'didorong dari office'])
    case 'release':
      return kanban(['reclaim', taskId])
  }
}

/**
 * Kirim instruksi ke worker yang sedang jalan, TANPA menghentikannya.
 *
 * Ini yang disebut "steer": agent yang sedang bekerja diberi arahan baru di tengah jalan.
 * Dasarnya adalah `hermes kanban comment`, yang oleh CLI diteruskan ke sesi worker — jadi
 * tidak ada mekanisme baru yang diciptakan di sini, dan tidak ada worker yang perlu dibunuh.
 */
export async function steerTask(taskId: string, instruction: string): Promise<boolean> {
  await kanban(['comment', taskId, instruction])
  return true
}
