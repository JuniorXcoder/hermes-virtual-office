/**
 * Cron bridge.
 *
 * Same rule as the Kanban bridge: talk to the CLI's documented surface rather
 * than the state files. `hermes cron create/...` handles validation, schedule
 * parsing and the lock protocol, and the CLI is the stable interface.
 *
 * READ is the exception. `hermes cron list` has no `--json` mode, so parsing its
 * table would break on a column reorder or a long job name and the office would
 * silently show the wrong schedule — which is worse than not showing it. The list
 * is read from `~/.hermes/cron/jobs.json` instead, whose shape is stable and which
 * the CLI itself writes.
 *
 * IMPORTANT: like the kanban bridge, every CLI call strips the agent-session
 * markers, or the CLI refuses to run from inside a worker.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const TIMEOUT_MS = Number(process.env.KANBAN_TIMEOUT_MS || 20_000)

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

async function cli(args: string[], timeout = TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await run(HERMES_BIN, args, {
      env: cleanEnv(),
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    if (e.code === 'ENOENT') {
      throw new Error(`Hermes CLI not found at "${HERMES_BIN}". Set HERMES_BIN.`)
    }
    throw new Error(`hermes ${args.join(' ')} failed: ${(e.stderr || e.message || '').trim()}`)
  }
}

/* -------------------------------------------------------------------- types -- */

export type CronSchedule = {
  kind: string
  expr?: string
  display?: string
}

export type CronJob = {
  id: string
  name: string
  prompt: string
  schedule: string
  /** 'cron' | 'interval' | … as reported by the CLI. */
  scheduleKind: string
  enabled: boolean
  state: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  failureStreak: number
  deliver: string
  noAgent: boolean
  script: string | null
  skills: string[]
  model: string | null
  repeatTimes: number | null
  repeatCompleted: number
}

export type CronRun = {
  id: string
  jobId: string
  status: string
  source: string
  startedAt: string | null
  finishedAt: string | null
}

type RawJob = {
  id: string
  name?: string
  prompt?: string
  schedule?: CronSchedule
  schedule_display?: string
  enabled?: boolean
  state?: string
  next_run_at?: string | null
  last_run_at?: string | null
  last_status?: string | null
  last_error?: string | null
  failure_streak?: number
  deliver?: string
  no_agent?: boolean
  script?: string | null
  skills?: string[]
  skill?: string | null
  model?: string | null
  repeat?: { times?: number | null; completed?: number }
}

function toJob(r: RawJob): CronJob {
  return {
    id: r.id,
    name: r.name || '(tanpa nama)',
    prompt: r.prompt || '',
    schedule: r.schedule_display || r.schedule?.display || r.schedule?.expr || '?',
    scheduleKind: r.schedule?.kind || 'cron',
    enabled: r.enabled ?? false,
    state: r.state || (r.enabled ? 'active' : 'paused'),
    nextRunAt: r.next_run_at ?? null,
    lastRunAt: r.last_run_at ?? null,
    lastStatus: r.last_status ?? null,
    lastError: r.last_error ?? null,
    failureStreak: r.failure_streak ?? 0,
    deliver: r.deliver || 'origin',
    noAgent: r.no_agent ?? false,
    script: r.script ?? null,
    skills: r.skills ?? (r.skill ? [r.skill] : []),
    model: r.model ?? null,
    repeatTimes: r.repeat?.times ?? null,
    repeatCompleted: r.repeat?.completed ?? 0,
  }
}

/* --------------------------------------------------------------------- read -- */

/** Where Hermes keeps its state. `HERMES_HOME` wins if the operator set it. */
function hermesHome(): string {
  return process.env.HERMES_HOME || path.join(os.homedir(), '.hermes')
}

/** Every scheduled job, newest first. Empty when the file does not exist yet. */
export async function listJobs(): Promise<CronJob[]> {
  try {
    const raw = await readFile(path.join(hermesHome(), 'cron', 'jobs.json'), 'utf8')
    const parsed = JSON.parse(raw) as { jobs?: RawJob[] }
    const jobs = (parsed.jobs ?? []).map(toJob)
    // Paused last, then by next run, so the things about to fire are at the top.
    return jobs.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return (a.nextRunAt ?? '~').localeCompare(b.nextRunAt ?? '~')
    })
  } catch {
    return []
  }
}

export async function getJob(id: string): Promise<CronJob | null> {
  return (await listJobs()).find((j) => j.id === id) ?? null
}

/**
 * `?limit=` is user input: junk, zero and negatives fall back to the default
 * instead of reaching the CLI as `--limit NaN`, which exits non-zero and makes
 * the office report the whole install as unavailable.
 */
export function parseLimit(raw: unknown, fallback = 25): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(500, Math.floor(n))
}

/**
 * Recent executions.
 *
 * Read from the CLI (`hermes cron runs`) because the table shape is its business,
 * not ours. `--limit` bounds it so a busy schedule cannot stream unbounded rows.
 */
export async function listRuns(jobId?: string, limit = 25): Promise<CronRun[]> {
  const args = ['cron', 'runs']
  if (jobId) args.push(jobId)
  args.push('--limit', String(parseLimit(limit)))
  const out = await cli(args)
  return parseCronRuns(out)
}

/** Parse the stable fields Hermes prints for a run; IDs are UUID-like strings. */
export function parseCronRuns(out: string): CronRun[] {
  const rows: CronRun[] = []
  for (const line of out.split('\n')) {
    const id = /^([a-f0-9]{32})\s+/i.exec(line)?.[1]
    if (!id) continue
    const field = (name: string) => new RegExp(`(?:^|\\s)${name}=([^\\s]+)`).exec(line)?.[1] ?? null
    rows.push({
      id,
      jobId: field('job') ?? '',
      status: line.match(/\b(completed|failed|running|skipped|queued)\b/)?.[1] ?? 'unknown',
      source: field('source') ?? '',
      startedAt: line.match(/\b\d{4}-\d{2}-\d{2}T[^\s]+/)?.[0] ?? null,
      finishedAt: null,
    })
  }
  return rows
}

/* -------------------------------------------------------------------- write -- */

export type CreateInput = {
  schedule: string
  prompt?: string
  name?: string
  /** Start paused instead of live. */
  paused?: boolean
  /** Delivery target; omit to use the CLI default ('origin'). */
  deliver?: string
  /** A script under ~/.hermes/scripts/ instead of a prompt. */
  script?: string
  /** Skip the LLM entirely (script-only job). */
  noAgent?: boolean
  repeat?: number
}

const SCHEDULE_OK = /^[0-9A-Za-z*/,:\- ]{1,64}$/

/**
 * Create a job.
 *
 * `--paused` is offered because a job that starts live can fire before the
 * operator has looked at it; the UI defaults to creating paused for that reason.
 */
export async function createJob(input: CreateInput): Promise<string> {
  const schedule = input.schedule.trim()
  if (!schedule) throw new Error('jadwal wajib diisi')
  if (!SCHEDULE_OK.test(schedule)) throw new Error('jadwal mengandung karakter tidak valid')
  if (!input.prompt?.trim() && !input.script?.trim()) {
    throw new Error('isi prompt atau script')
  }

  const args = ['cron', 'create', schedule]
  if (input.prompt?.trim()) args.push(input.prompt.trim())
  if (input.name?.trim()) args.push('--name', input.name.trim())
  if (input.paused) args.push('--paused')
  if (input.deliver?.trim()) args.push('--deliver', input.deliver.trim())
  if (input.script?.trim()) args.push('--script', input.script.trim())
  if (input.noAgent) args.push('--no-agent')
  if (input.repeat && input.repeat > 0) args.push('--repeat', String(input.repeat))

  const out = await cli(args, 60_000)
  // "Created job: c6e11310f4c3"
  const m = out.match(/Created job:\s*([0-9a-f]+)/i)
  if (!m) throw new Error(`tidak bisa membaca id job dari keluaran CLI: ${out.trim().slice(0, 200)}`)
  return m[1]
}

/** Actions that change a job's schedule. Each maps to one CLI verb. */
export type JobAction = 'pause' | 'resume' | 'run' | 'remove'

export async function actOnJob(id: string, action: JobAction): Promise<void> {
  const known = await getJob(id)
  if (!known) throw new Error(`job "${id}" tidak ditemukan`)
  await cli(['cron', action, id], 60_000)
}
