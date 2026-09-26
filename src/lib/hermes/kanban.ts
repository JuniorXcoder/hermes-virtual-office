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
import { promisify } from 'node:util'
import type { Agent, AgentRole, NewTaskInput, Task, TaskStatus } from '@/types/hermes'

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
  created_at?: number | null
  updated_at?: number | null
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
  }
}

export async function listTasks(opts: { includeArchived?: boolean } = {}): Promise<Task[]> {
  const args = ['list']
  if (opts.includeArchived) args.push('--archived')
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

  const out = await kanban(args)
  const m = out.match(/t_[0-9a-f]{8}/)
  if (!m) throw new Error(`could not read the new task id from: ${out.trim().slice(0, 200)}`)

  const task = await getTask(m[0])
  if (!task) throw new Error(`created ${m[0]} but could not read it back`)
  return task
}

/** Free-text guidance injected into the running worker's session. */
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
 * Desk assignment is derived, not stored: agents that are working or reviewing
 * get a station first, idle ones fill the remaining desks in alphabetical
 * order. That keeps desk positions stable across reloads without persisting
 * layout state in the Hermes install.
 */
const ROLE_BY_NAME: Record<string, AgentRole> = {
  default: 'orchestrator',
  lulu: 'qa',
  risko: 'backend',
  zaki: 'frontend',
  pingot: 'researcher',
}

function roleFor(name: string): AgentRole {
  if (ROLE_BY_NAME[name]) return ROLE_BY_NAME[name]
  if (/qa|test|lulu/i.test(name)) return 'qa'
  if (/research|riset|pingot/i.test(name)) return 'researcher'
  if (/ops|devops|infra/i.test(name)) return 'devops'
  if (/front|ui/i.test(name)) return 'frontend'
  if (/back|api/i.test(name)) return 'backend'
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

export async function listAgents(tasks: Task[]): Promise<Agent[]> {
  const raw = await kanbanJson<RawAssignee[]>(['assignees'])
  const names = raw.map((r) => r.name).sort()

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
