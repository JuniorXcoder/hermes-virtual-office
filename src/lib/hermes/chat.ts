/**
 * Chat bridge.
 *
 * Talk to an agent directly, with memory, over the Hermes CLI.
 *
 * ## Why the CLI and not a new database
 *
 * Hermes already keeps a per-profile SQLite session store (`state.db`) with full
 * message history — this install has 117 sessions and 41k messages in it. The office
 * had no chat, but the memory layer it needs already exists and is battle-tested.
 * Writing a second store would mean two sources of truth for "what was said".
 *
 * So: `hermes -p <profile> chat -q <message> -Q` answers and prints a `session_id`, and
 * `--resume <session_id>` continues that conversation with its history intact. `-Q`
 * already selects one-shot behavior; do not add the redundant `--oneshot` flag.
 * Measured working:
 *
 *   -p default chat -q "remember the cat is called Bleki" -Q  -> session_id + "Oke."
 *   -p default chat --resume <id> -q "what is my cat called?" -Q -> "Bleki."
 *
 * ## Isolation is per PROFILE, which is why chat gets its own
 *
 * Each profile has its own `state.db`, so conversations with different profiles do
 * not mix. That is exactly what we want, and it also solves a cost problem: the
 * `default` profile carries a ~66,000-character `system_prompt` in its config.yaml,
 * sent on every single message. Chatting through it would mean ~16k tokens per
 * "hello". A profile created with `--no-skills` and no cloned config has a 2 KB
 * config and a short SOUL.md, so a turn costs a fraction of that.
 *
 * ## The session id is the memory
 *
 * There is no separate "memory" to manage: the session id IS the conversation's
 * identity. Storing it is what makes the next message continue the thread. We keep
 * the mapping from an office agent to its session in the office's own data dir.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
/** Generous: an agent turn may run tools before answering. */
const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 180_000)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')

/**
 * Env without the agent-session markers.
 *
 * The CLI refuses to run inside a delegated worker context. The office is a server,
 * not a worker, but it may have been started from inside one — so strip the markers
 * the same way the kanban bridge does.
 */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of [
    'HERMES_DELEGATED_CHILD_CONTEXT',
    'HERMES_SUPERVISED_CHILD',
    'HERMES_SESSION_ID',
    'HERMES_SESSION_PLATFORM',
    'HERMES_SESSION_CHAT_ID',
    'HERMES_SESSION_USER_ID',
    'HERMES_KANBAN_TASK',
    'HERMES_KANBAN_WORKSPACE',
    'HERMES_KANBAN_BRANCH',
  ]) {
    delete env[k]
  }
  return env
}

export function officeChatArgs(profile: string, message: string, sessionId?: string): string[] {
  const args = ['-p', profile, 'chat']
  if (sessionId) args.push('--resume', sessionId)
  args.push('-q', message, '-Q')
  return args
}

/**
 * Run the CLI and return BOTH streams.
 *
 * The `session_id` line is written to **stderr**, while the answer goes to stdout —
 * measured, not assumed. An earlier version read stdout only and every send failed
 * with "tidak bisa membaca session_id", because the id was never in the stream it
 * looked at. The first probe missed it because it merged the streams with `2>&1`.
 *
 * stderr is not an error channel here: the CLI uses it for its banner and session
 * line. Only a non-zero exit or a killed process means failure.
 */
async function cli(args: string[], timeout = CHAT_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(HERMES_BIN, args, {
      env: cleanEnv(),
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { stdout, stderr }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      killed?: boolean
    }
    if (e.code === 'ENOENT') {
      throw new Error(`Hermes CLI tidak ditemukan di "${HERMES_BIN}". Set HERMES_BIN.`)
    }
    // A timeout still carries partial output; an answer may be in there.
    const partial = [e.stdout, e.stderr].filter(Boolean).join('\n').trim()
    if (e.killed || (err as Error).name === 'AbortError') {
      throw new Error(
        `agent tidak menjawab dalam ${Math.round(timeout / 1000)} detik` +
          (partial ? ` (keluaran sebagian: ${partial.slice(0, 200)})` : ''),
      )
    }
    throw new Error(`hermes chat gagal: ${(e.stderr || e.message || '').trim()}`)
  }
}

/* ------------------------------------------------------------------- sessions -- */

export type ChatSession = {
  /** Hermes session id — the memory handle. */
  id: string
  /** Office agent this thread belongs to. */
  agent: string
  /** Profile the CLI actually ran as. */
  profile: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  /** Last few exchanges, for the thread list. */
  preview?: string
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  ts: number
}

/** Where the office keeps its own chat index. */
function storePath(): string {
  return path.join(DATA_DIR, 'chat-sessions.json')
}

/**
 * The office's index of chat sessions.
 *
 * The CLI's session store is the source of truth for MESSAGES; this file only maps
 * an office agent to the session id that holds its thread. Keeping it separate means
 * we never write to Hermes' database directly, and a lost index costs a thread
 * pointer, not the history — which is still in `state.db` and recoverable by
 * `sessions list`.
 */
async function readIndex(): Promise<Record<string, ChatSession>> {
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        if (!value || typeof value !== 'object') return false
        const session = value as Partial<ChatSession>
        return typeof session.id === 'string' && typeof session.agent === 'string' &&
          typeof session.profile === 'string' && typeof session.title === 'string' &&
          typeof session.createdAt === 'string' && typeof session.updatedAt === 'string' &&
          typeof session.messageCount === 'number'
      }),
    ) as Record<string, ChatSession>
  } catch {
    return {}
  }
}

async function writeIndex(index: Record<string, ChatSession>): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true })
  await writeFile(storePath(), JSON.stringify(index, null, 2), 'utf8')
}

/** Every known thread, newest activity first. */
export async function listChatSessions(): Promise<ChatSession[]> {
  const index = await readIndex()
  return Object.values(index).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getChatSession(agent: string): Promise<ChatSession | null> {
  const index = await readIndex()
  return index[agent] ?? null
}

/* --------------------------------------------------------------------- sending -- */

/** `session_id: 20260927_112902_6d5219` — printed by the CLI on every turn. */
const SESSION_RE = /session_id:\s*([A-Za-z0-9_]+)/

/**
 * Strip the CLI's decorations from a reply.
 *
 * With `-Q` the CLI prints only the answer plus a session line, but it also emits
 * notices on stderr-style lines that land in stdout in some versions (an unknown
 * toolset warning, a "Resumed session ..." banner). Those are not part of the
 * answer and must not be shown as if the agent said them.
 */
function cleanReply(stdout: string): string {
  return stdout
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      if (!t) return true
      if (/^session_id:/.test(t)) return false
      if (/^↻\s*Resumed session/.test(t)) return false
      if (/^Warning: Unknown toolsets:/.test(t)) return false
      if (/^Error: Profile .* does not exist/.test(t)) return false
      // Environment notices the CLI prints before the answer. They describe the
      // host, not what the agent said, and showing them as the reply is wrong.
      if (/tirith security scanner/.test(t)) return false
      if (/^⚠/.test(t)) return false
      if (/^↻/.test(t)) return false
      return true
    })
    .join('\n')
    .trim()
}

export type SendResult = {
  session: ChatSession
  /** The agent's reply, cleaned of CLI decoration. */
  reply: string
}

/**
 * Send a message to an agent and return its reply.
 *
 * Resumes the agent's existing thread when there is one, so the conversation keeps
 * its memory; otherwise starts a new session and records it.
 */
export async function sendChatMessage(
  agent: string,
  profile: string,
  message: string,
): Promise<SendResult> {
  const text = message.trim()
  if (!text) throw new Error('pesan kosong')

  const index = await readIndex()
  const existing = index[agent]

  // `--query-file -` would be safer for arbitrary text, but the query is passed as an
  // argv entry, not through a shell, so quotes and $() are already preserved
  // verbatim. argv has a length limit (~128 KB); a longer message is refused rather
  // than silently truncated.
  if (text.length > 60_000) {
    throw new Error('pesan terlalu panjang (maks 60.000 karakter)')
  }

  const args = officeChatArgs(profile, text, existing?.id)

  const { stdout, stderr } = await cli(args)
  const reply = cleanReply(stdout)
  // The session line arrives on stderr; the answer on stdout. Search both so a
  // future CLI version moving the line does not break this again.
  const id = SESSION_RE.exec(stderr)?.[1] || SESSION_RE.exec(stdout)?.[1] || existing?.id
  if (!id) {
    const where = `${stdout}\n${stderr}`.trim().slice(0, 300)
    throw new Error(`tidak bisa membaca session_id dari keluaran CLI: ${where}`)
  }

  const now = new Date().toISOString()
  const session: ChatSession = {
    id,
    agent,
    profile,
    // The CLI names a session from its first message; mirror that so the thread list
    // reads like a chat app rather than a list of opaque ids.
    title: existing?.title || text.slice(0, 60),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    messageCount: (existing?.messageCount ?? 0) + 2,
  }
  index[agent] = session
  await writeIndex(index)

  return { session, reply }
}

/* ------------------------------------------------------------------- history -- */

/**
 * Read a session's messages.
 *
 * `sessions export --format jsonl` writes the whole session (metadata + `messages[]`)
 * as one JSON document. `--session-id <id> -` sends it to stdout.
 *
 * The export is per PROFILE: a session in `office-chat`'s state.db is invisible to a
 * `default`-profile export and vice versa, so `-p <profile>` is required to match the
 * session that was created there.
 */
export async function readChatHistory(
  profile: string,
  sessionId: string,
  limit = 200,
): Promise<ChatMessage[]> {
  let out: string
  try {
    const r = await cli(
      ['-p', profile, 'sessions', 'export', '--format', 'jsonl', '--session-id', sessionId, '-'],
      60_000,
    )
    // The export writes JSON to stdout, but take stderr too in case a version
    // routes notices there.
    out = r.stdout.includes('{') ? r.stdout : r.stdout + '\n' + r.stderr
  } catch {
    return []
  }

  const start = out.indexOf('{')
  if (start < 0) return []
  let doc: { messages?: Record<string, unknown>[] }
  try {
    doc = JSON.parse(out.slice(start))
  } catch {
    return []
  }

  const msgs = Array.isArray(doc.messages) ? doc.messages : []
  const out2: ChatMessage[] = []
  for (const m of msgs) {
    const role = String(m.role ?? '')
    if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') continue
    const content = typeof m.content === 'string' ? m.content.trim() : ''
    // Skip empty assistant turns: those are tool-call frames, and the tool result
    // follows as its own message. Showing them as blank bubbles looks broken.
    if (!content) continue
    if (role === 'tool') continue
    if (role === 'system') continue
    out2.push({
      role,
      content,
      ts: typeof m.timestamp === 'number' ? m.timestamp * 1000 : Date.now(),
    })
  }
  return out2.slice(-limit)
}

/** Forget an agent's thread pointer. The history stays in Hermes' store. */
export async function resetChatSession(agent: string): Promise<void> {
  const index = await readIndex()
  delete index[agent]
  await writeIndex(index)
}
