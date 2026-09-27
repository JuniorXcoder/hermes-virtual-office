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
import { access, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Agent, AgentRole, NewTaskInput, Task, TaskOrigin, TaskStatus } from '@/types/hermes'

const run = promisify(execFile)

const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const BOARD = process.env.HERMES_KANBAN_BOARD || ''
const TIMEOUT_MS = Number(process.env.KANBAN_TIMEOUT_MS || 20_000)

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

async function kanban(args: string[]): Promise<string> {
  const full = BOARD ? ['kanban', '--board', BOARD, ...args] : ['kanban', ...args]
  try {
    const { stdout } = await run(HERMES_BIN, full, {
      env: cleanEnv(),
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
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

async function kanbanJson<T>(args: string[]): Promise<T> {
  const out = await kanban([...args, '--json'])
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
    origin: parseOrigin(r.created_by),
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
export async function listTasks(opts: { includeArchived?: boolean } = {}): Promise<Task[]> {
  const args = opts.includeArchived ? ['list', '--archived'] : ['list']
  const rows = await kanbanJson<RawTask[]>(args)
  return rows.map(toTask)
}

export async function getTask(id: string): Promise<Task | null> {
  const out = await kanban(['show', id, '--json']).catch(() => '')
  const start = out.search(/[[{]/)
  if (start < 0) return null
  const parsed = JSON.parse(out.slice(start)) as RawTask | { task?: RawTask }
  const raw = 'task' in parsed && parsed.task ? parsed.task : (parsed as RawTask)
  return raw?.id ? toTask(raw) : null
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
 * `default` is special-cased because it is the install's own profile, not a person.
 */
const ROLE_KEYWORDS: [RegExp, AgentRole][] = [
  [/qa|test|verif/i, 'qa'],
  [/research|riset|analyst/i, 'researcher'],
  [/ops|devops|infra|deploy|sre/i, 'devops'],
  [/front|ui|web|design/i, 'frontend'],
  [/back|api|server|data|db/i, 'backend'],
]

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
function hermesHome(): string {
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
export async function createProfile(
  name: string,
  description?: string,
): Promise<{ name: string; description: string }> {
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
  const desc = (description || `Office worker ${clean}`).trim().slice(0, 200)
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
  return { name: clean, description: desc }
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

export async function listAgents(tasks: Task[]): Promise<Agent[]> {
  const raw = await kanbanJson<RawAssignee[]>(['assignees'])
  // Profiles AND assignees. Reading only `assignees` meant a freshly created
  // profile stayed invisible until it was given a task, so "create a profile"
  // looked like it had done nothing.
  const names = [...new Set([...raw.map((r) => r.name), ...(await listProfiles())])].sort()

  const active = new Map<string, Task>()
  for (const t of tasks) {
    if (!t.assignee) continue
    if (t.status === 'running' || t.status === 'review') active.set(t.assignee, t)
  }

  // Working agents first so they hold the desks nearest the Kanban board.
  const ordered = [...names].sort((a, b) => {
    const av = active.has(a) ? 0 : 1
    const bv = active.has(b) ? 0 : 1
    return av - bv || a.localeCompare(b)
  })

  return names.map((name) => {
    const task = active.get(name)
    const status: Agent['status'] = task
      ? task.status === 'review'
        ? 'review'
        : 'working'
      : 'idle'
    return {
      name,
      displayName: name,
      role: roleFor(name),
      deskIndex: ordered.indexOf(name) < 8 ? ordered.indexOf(name) : null,
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
  }))
}

/** Raw log tail for a task, used as the terminal-peeker body. */
export async function taskLog(taskId: string, bytes = 16_000): Promise<string> {
  return kanban(['log', taskId, '--tail', String(bytes)]).catch(() => '')
}
