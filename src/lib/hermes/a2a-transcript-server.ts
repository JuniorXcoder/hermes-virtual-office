/**
 * Pembaca transcript A2A — SERVER ONLY (CLI + node:fs).
 *
 * Tiga sumber NYATA (terukur 2026-10-08, bukan dugaan):
 * 1. Export sesi inbound: `hermes -p <profil> sessions export --format jsonl
 *    --source a2a --newer-than <N>s -`. Penjawab = profil = agent kantor.
 *    Pemanggil = framing "[A2A inbound — peer named 'X']". Fakta: `content`
 *    terisi, `api_content` NULL — yang dibaca `content`.
 * 2. Arsip ctx: `<hermesHome>/a2a_conversations/ctx-<hash>.jsonl`
 *    `{ts, role, text, task_id}` — tiap baris ganda (dua task_id), didedupe.
 *    Dihubungkan ke sesi via title `a2a-<agent>-ctx-<hash>`.
 * 3. Outbound: di jejak tool_call sesi profil itu — tool `a2a_call` /
 *    `a2a_orchestrate`. Argumen JSON: {agent|agents, task|message, context_id}.
 *
 * SENGAJA tidak dibaca: sesi kanban/telegram yang memanggil a2a_call — itu
 * konteks OPERATOR (manusia), bukan percakapan antar-agent. Menampilkannya
 * sebagai "agent-to-agent" = mengira manusia sebagai agent.
 */
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { hermesHome } from './kanban'
import {
  dedupeCtxMessages,
  parseCaller,
  parseCtxId,
  stripFraming,
  type A2aConversation,
  type A2aMessage,
  type A2aOutbound,
  type A2aTranscript,
} from './a2a-transcript'

const run = promisify(execFile)

const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
/** Export per profil bisa puluhan detik kalau sesi besar; UI menunggu panel. */
const EXPORT_TIMEOUT_MS = Number(process.env.A2A_EXPORT_TIMEOUT_MS || 60_000)
/** Hanya percakapan 24 jam terakhir — transcript lama ada di arsip ctx. */
const EXPORT_WINDOW = process.env.A2A_EXPORT_WINDOW || '24h'
const MAX_TEXT = 4000
/** Jejak outbound dicari di N pesan terakhir tiap export — cukup untuk tool_call. */
const OUTBOUND_SCAN = 400

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

type ExportMsg = {
  role?: unknown
  content?: unknown
  api_content?: unknown
  timestamp?: unknown
  tool_name?: unknown
  tool_calls?: unknown
}

type ExportDoc = {
  id?: unknown
  title?: unknown
  source?: unknown
  last_activity_at?: unknown
  started_at?: unknown
  messages?: unknown
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const ms = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v * 1000 : null

/** Baris tool_call hermes ditulis sebagai string JSON di kolom `tool_calls`. */
function toolCallsOf(m: ExportMsg): { name: string; args: string }[] {
  const raw = m.tool_calls
  if (!raw || typeof raw !== 'string') return []
  try {
    const arr = JSON.parse(raw) as { function?: { name?: string; arguments?: string } }[]
    if (!Array.isArray(arr)) return []
    return arr.map((c) => ({ name: s(c.function?.name), args: s(c.function?.arguments) }))
  } catch {
    return []
  }
}

function argOf(args: string, ...keys: string[]): string {
  try {
    const o = JSON.parse(args) as Record<string, unknown>
    for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string
  } catch {
    // argumen bukan JSON — abaikan, bukan bukti
  }
  return ''
}

/** Isi pesan: `content` dulu (terisi di A2A), fallback `api_content`. */
function bodyOf(m: ExportMsg): string {
  const t = s(m.content).trim() || s(m.api_content).trim()
  return t.slice(0, MAX_TEXT)
}

function short(t: string, n: number): string {
  return t.length > n ? `${t.slice(0, n)}…` : t
}

async function exportA2a(profile: string): Promise<{ docs: ExportDoc[]; error: string | null }> {
  try {
    const { stdout } = await run(
      HERMES_BIN,
      ['-p', profile, 'sessions', 'export', '--format', 'jsonl', '--source', 'a2a', '--newer-than', EXPORT_WINDOW, '-'],
      { env: cleanEnv(), timeout: EXPORT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    )
    const docs: ExportDoc[] = []
    for (const line of stdout.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('{')) continue
      try {
        docs.push(JSON.parse(t) as ExportDoc)
      } catch {
        // satu baris rusak tidak boleh membuang seluruh export
      }
    }
    return { docs, error: null }
  } catch (err) {
    return { docs: [], error: (err as Error).message || String(err) }
  }
}

type CtxRow = { ts?: unknown; role?: unknown; text?: unknown }

/** Arsip ctx-<hash>.jsonl → pesan, didedupe (tiap baris tertulis ganda). */
async function readCtxFile(ctx: string): Promise<{ messages: A2aMessage[]; ok: boolean }> {
  const file = path.join(hermesHome(), 'a2a_conversations', `${ctx}.jsonl`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return { messages: [], ok: false }
  }
  const msgs: A2aMessage[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const r = JSON.parse(t) as CtxRow
      const text = s(r.text).trim()
      if (!text) continue
      msgs.push({
        from: r.role === 'agent' ? 'agent' : 'caller',
        text: text.slice(0, MAX_TEXT),
        ts: ms(r.ts),
      })
    } catch {
      // baris rusak dilewati
    }
  }
  return { messages: dedupeCtxMessages(msgs), ok: true }
}

function lastTs(msgs: A2aMessage[]): number | null {
  let best: number | null = null
  for (const m of msgs) if (m.ts !== null && (best === null || m.ts > best)) best = m.ts
  return best
}

/** Sesi inbound (source='a2a') → percakapan + outbound tool_call di dalamnya. */
function fromSession(agent: string, doc: ExportDoc): { conv: A2aConversation | null; outbound: A2aOutbound[] } {
  const raw = Array.isArray(doc.messages) ? (doc.messages as ExportMsg[]) : []
  const ctx = parseCtxId(s(doc.title))
  const msgs: A2aMessage[] = []
  const outbound: A2aOutbound[] = []
  let caller: string | null = null

  for (const m of raw.slice(-OUTBOUND_SCAN)) {
    for (const c of toolCallsOf(m)) {
      if (c.name !== 'a2a_call' && c.name !== 'a2a_orchestrate') continue
      const peer = argOf(c.args, 'agent', 'agents', 'peer') || '(tak tercatat)'
      const task = argOf(c.args, 'task', 'message', 'prompt') || '(tak tercatat)'
      outbound.push({ agent, peer, task: short(task, 300), result: '', at: null })
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const body = bodyOf(m)
    if (!body) continue // frame tool-call kosong — bukan bubble
    if (m.role === 'user') {
      caller = caller ?? parseCaller(body)
      const text = stripFraming(body)
      if (text) msgs.push({ from: 'caller', text, ts: ms(m.timestamp) })
    } else {
      msgs.push({ from: 'agent', text: short(body, MAX_TEXT), ts: ms(m.timestamp) })
    }
  }

  if (!msgs.length) return { conv: null, outbound }
  const conv: A2aConversation = {
    ctx: ctx ?? `sesi-${s(doc.id) || '(tak tercatat)'}`,
    agent,
    caller,
    messages: msgs,
    lastAt: lastTs(msgs) ?? ms(doc.last_activity_at) ?? ms(doc.started_at),
    origin: ['session'],
  }
  return { conv, outbound }
}

export async function readA2aTranscript(profiles: string[]): Promise<A2aTranscript> {
  const conversations: A2aConversation[] = []
  const outbound: A2aOutbound[] = []
  const unreadable: string[] = []

  for (const profile of profiles) {
    const { docs, error } = await exportA2a(profile)
    if (error) {
      unreadable.push(profile)
      continue
    }
    for (const doc of docs) {
      const { conv, outbound: ob } = fromSession(profile, doc)
      outbound.push(...ob)
      if (!conv) continue
      // Perkaya dari arsip ctx bila sesi menunjuk ke sana.
      const ctx = parseCtxId(s(doc.title))
      if (ctx) {
        const { messages, ok } = await readCtxFile(ctx)
        if (ok && messages.length) {
          conv.messages = dedupeCtxMessages([...messages])
          conv.lastAt = lastTs(conv.messages) ?? conv.lastAt
          conv.origin = ['ctx-file', 'session']
        }
      }
      conversations.push(conv)
    }
  }

  let ctxDir: A2aTranscript['ctxDir'] = 'ok'
  try {
    await readdir(path.join(hermesHome(), 'a2a_conversations'))
  } catch {
    ctxDir = 'missing'
  }

  conversations.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  return { conversations, outbound, readAt: new Date().toISOString(), unreadable, ctxDir }
}
