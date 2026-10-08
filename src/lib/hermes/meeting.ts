/**
 * Meeting orchestrator.
 *
 * Runs a short, strictly-serialized multi-agent discussion and synthesizes
 * structured minutes. Design constraints learned from production:
 *
 * - Turns are sequential, never parallel: fanning prompts out to N agents at
 *   once trips upstream 503s on shared providers.
 * - Hard caps (turns, participants, per-turn timeout) keep a run bounded.
 * - Minutes are produced in a SEPARATE completion, so the debate context never
 *   grows with the summarization prompt.
 * - In-process state only. A meeting is an interactive session; if the server
 *   restarts, the transcript lives on in /data/meetings.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Meeting, MeetingMode, MeetingTurn } from '@/types/hermes'
import {
  buildCrossPrompt,
  buildMinutesPrompt,
  buildOpeningPrompt,
  failedTurnText,
  missingServed,
  normalizeMeetingMode,
  sendA2a,
} from './meeting-a2a'
import { listServedAgents } from './a2a-served'

const MAX_TURNS = Number(process.env.MAX_MEETING_TURNS || 10)
const MAX_PARTICIPANTS = 4
const TURN_TIMEOUT_MS = Number(process.env.MEETING_TURN_TIMEOUT_MS || 120_000)
/** Upstream LLM gateways intermittently answer 503; a turn is worth retrying. */
const RETRIES = Number(process.env.MEETING_TURN_RETRIES || 3)
const BACKOFF_MS = Number(process.env.MEETING_TURN_BACKOFF_MS || 4000)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const AI_KEY = process.env.AI_API_KEY || ''
const AI_URL = (process.env.AI_BASE_URL || '').replace(/\/$/, '')
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'

/** One meeting at a time per server; a second start queues behind it. */
const meetings = new Map<string, Meeting>()
let busy = false

/**
 * Meetings written by earlier server runs, loaded lazily from DATA_DIR.
 *
 * `listMeetings()` used to return only the in-memory map, so a restart wiped the
 * history and the UI could not offer "previous meetings". The files were always
 * being written — nothing was reading them back.
 *
 * Markdown is parsed with a narrow, tolerant reader rather than a full parser:
 * the header fields are read by prefix, the transcript by its `**speaker**` lines,
 * and anything unrecognised is ignored rather than throwing. A hand-edited file
 * therefore degrades to fewer fields instead of breaking the list.
 *
 * Mode jujur (RAPAT-A2A-1): arsip menyimpan mode (`simulasi`/`a2a`) supaya rapat
 * lama bisa dibedakan — simulasi = LLM gateway yang bicara, a2a = agent nyata.
 * File lama tanpa baris mode terbaca sebagai 'auto' (tak diketahui, era teater).
 */
type ArchivedMeeting = {
  id: string
  topic: string
  file: string
  startedAt: string
  participants: string[]
  moderator: string
  mode: MeetingMode
  turnCount: number
  preview: string
  archived: true
  /** ctx-* A2A yang terlibat (rapat mode a2a); kosong untuk simulasi/arsip lama. */
  ctxIds: string[]
}

let archiveCache: ArchivedMeeting[] | null = null

function parseArchive(name: string, text: string): ArchivedMeeting | null {
  const lines = text.split('\n')
  const topic = (lines.find((l) => l.startsWith('# ')) || '').slice(2).trim()
  const field = (key: string) => {
    const l = lines.find((x) => x.startsWith(`- ${key}:`))
    return l ? l.slice(key.length + 3).trim() : ''
  }
  const turnCount = Number(field('giliran')) || 0
  const previewLine = lines.find((l) => l.startsWith('**') && l.includes('): '))
  // ctx A2A: satu atau beberapa `ctx-*` dipisah koma (rapat mode a2a).
  const ctxRaw = field('ctx')
  const ctxIds = ctxRaw ? ctxRaw.split(',').map((x) => x.trim()).filter((x) => x.startsWith('ctx-')) : []
  return {
    // <date>-<id>.md
    id: name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
    topic: topic || '(tanpa topik)',
    file: path.join(DATA_DIR, 'meetings', name),
    startedAt: name.slice(0, 10),
    participants: field('peserta') ? field('peserta').split(',').map((x) => x.trim()).filter(Boolean) : [],
    moderator: field('pembawa acara'),
    mode: (field('mode') || 'auto') as MeetingMode,
    turnCount,
    preview: previewLine ? previewLine.slice(0, 160) : '',
    archived: true,
    ctxIds,
  }
}

export type ArchivedMeetingWithCtx = ArchivedMeeting & { ctxIds: string[] }

/** Archived meetings on disk, newest first. Cached after the first read. */
export async function listArchived(): Promise<ArchivedMeeting[]> {
  if (archiveCache) return archiveCache
  try {
    const dir = path.join(DATA_DIR, 'meetings')
    const names = await readdir(dir)
    const out: ArchivedMeeting[] = []
    for (const n of names) {
      if (!n.endsWith('.md')) continue
      try {
        const text = await readFile(path.join(dir, n), 'utf8')
        const m = parseArchive(n, text)
        if (m) out.push(m)
      } catch {
        // one unreadable file must not empty the whole history
      }
    }
    out.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
    archiveCache = out
    return out
  } catch {
    archiveCache = []
    return []
  }
}

/** Drop the archive cache so a new meeting shows up immediately. */
function invalidateArchive() {
  archiveCache = null
}

/** Read one archived transcript by meeting id. */
export async function readArchived(id: string): Promise<string | null> {
  const all = await listArchived()
  const hit = all.find((m) => m.id === id)
  if (!hit) return null
  try {
    return await readFile(hit.file, 'utf8')
  } catch {
    return null
  }
}

export function isConfigured(): boolean {
  return Boolean(AI_URL && AI_KEY)
}

type ChatChunk = {
  choices?: { delta?: { content?: string }; message?: { content?: string } }[]
}

/**
 * Read assistant text out of a completion response.
 *
 * Compatible gateways answer in three different shapes; all three are seen in
 * the wild, so none of them can be assumed:
 *   1. a plain JSON document
 *   2. Server-Sent-Events frames even though `stream` was never requested
 *      (`data: {...}` lines closed by `data: [DONE]`)
 *   3. a JSON document with `data: [DONE]` glued onto its tail without a newline
 * Using `res.json()` on (2) or (3) throws "Unexpected non-whitespace character
 * after JSON", which silently turned every meeting turn into a failure.
 */
function extractContent(body: string): string {
  const text = body.trim()
  if (!text) return ''

  const leading = parseLeadingJson(text)
  if (leading) {
    const direct = pickContent(leading)
    if (direct) return direct.trim()
  }

  let out = ''
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      out += pickContent(JSON.parse(payload))
    } catch {
      /* keep-alive or malformed frame — ignore */
    }
  }
  return out.trim()
}

function pickContent(json: unknown): string {
  const choice = (json as { choices?: ChatChunk['choices'] })?.choices?.[0]
  return choice?.message?.content ?? choice?.delta?.content ?? ''
}

/** Parse the first complete JSON value, tolerating trailing junk. */
function parseLeadingJson(text: string): unknown | null {
  const first = text[0]
  if (first !== '{' && first !== '[') return null
  try {
    return JSON.parse(text)
  } catch {
    /* probably trailing data — walk to the end of the first value */
  }
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(0, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

async function complete(system: string, user: string): Promise<string> {
  if (!isConfigured()) {
    throw new Error(
      'No LLM configured. Set AI_BASE_URL and AI_API_KEY (see .env.example) to enable meetings.',
    )
  }
  const payload = JSON.stringify({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.6,
    max_tokens: 400,
    // Some gateways stream SSE frames regardless; asking explicitly keeps the
    // body parseable either way because extractContent() handles both.
    stream: false,
  })

  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS)
    try {
      const res = await fetch(`${AI_URL}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
        body: payload,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // 5xx / 429 are transient upstream errors; retry with backoff.
        if (res.status >= 500 || res.status === 429) {
          lastErr = new Error(`provider ${res.status}: ${text.slice(0, 160)}`)
          if (attempt < RETRIES) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt))
            continue
          }
        }
        throw new Error(`provider ${res.status}: ${text.slice(0, 200)}`)
      }
      const text = extractContent(await res.text())
      if (!text && attempt < RETRIES) {
        lastErr = new Error('provider returned an empty reply')
        await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt))
        continue
      }
      return text
    } catch (err) {
      lastErr = err as Error
      const aborted = (err as Error).name === 'AbortError'
      if (!aborted && attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt))
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr || new Error('provider unreachable')
}

function participantSystem(meeting: Meeting, speaker: string): string {
  return [
    `You are ${speaker}, an expert autonomous engineer in a technical meeting.`,
    '',
    `TOPIC: ${meeting.topic}`,
    `PARTICIPANTS: ${meeting.participants.join(', ')}`,
    `ROUND: ${meeting.phase}`,
    '',
    'RULES:',
    '1. Be direct and dense. No greetings, no "I agree with everyone".',
    '2. Focus on technical trade-offs: consistency, failure modes, race conditions, cost.',
    '3. To disagree, name the speaker and their specific argument.',
    '4. Propose concrete primitives: column names, locking, constraints, retry semantics.',
    '5. Under 90 words. Plain prose, no markdown headers.',
  ].join('\n')
}

function transcript(meeting: Meeting): string {
  return meeting.turns
    .filter((t) => t.kind !== 'minutes')
    .map((t) => `[${t.kind} r${t.round}] ${t.speaker}: ${t.text}`)
    .join('\n')
}

const MINUTES_SYSTEM = `Synthesize the meeting transcript into engineering minutes.

Output EXACTLY these three sections in this order, in Indonesian:

## KEPUTUSAN
- What was agreed. If nothing was agreed, say "Belum ada kesepakatan final" and list the competing options with who proposed each.

## TINDAK LANJUT
- One line per item: **Owner**: deliverable yang bisa diverifikasi — tenggat.

## RISIKO
- Technical/operational risks raised, with the mitigation if one was agreed.

Be terse. Never invent a decision that was not in the transcript.`

function newId(): string {
  return `m${Date.now()}`
}

async function persist(meeting: Meeting): Promise<string | null> {
  try {
    const dir = path.join(DATA_DIR, 'meetings')
    await mkdir(dir, { recursive: true })
    const stamp = new Date(meeting.turns[0]?.ts || Date.now()).toISOString().slice(0, 10)
    const file = path.join(dir, `${stamp}-${meeting.id}.md`)
    // Mode jujur: `simulasi` = yang bicara LLM gateway (bukan agent),
    // `a2a` = agent nyata via A2A. ctx menempel supaya bisa diperiksa di panel A2A.
    const modeLabel =
      meeting.mode === 'a2a'
        ? 'a2a (pernyataan dari agent nyata via protokol A2A)'
        : 'simulasi (yang bicara LLM gateway, BUKAN agent — perilaku lama)'
    const body = [
      `# ${meeting.topic}`,
      '',
      `- peserta: ${meeting.participants.join(', ')}`,
      `- pembawa acara: ${meeting.moderator}`,
      `- mode: ${meeting.mode} — ${modeLabel}`,
      `- giliran: ${meeting.turns.filter((t) => t.kind !== 'minutes').length}`,
      `- ctx: ${(meeting.ctxIds ?? []).join(', ') || '(tidak ada — bukan rapat A2A)'}`,
      '',
      '## Transkrip',
      '',
      ...meeting.turns
        .filter((t) => t.kind !== 'minutes')
        .map((t) => {
          // Giliran gagal dicatat apa adanya + ctx bila ada — jejak A2A utuh.
          const fail = t.kind === 'failed' ? ' [GAGAL — bukan karangan LLM]' : ''
          const ctx = t.ctx ? ` [${t.ctx}]` : ''
          return `**${t.speaker}** (${t.kind} r${t.round})${fail}${ctx}: ${t.text}`
        }),
      '',
      meeting.minutes,
      '',
    ].join('\n')
    await writeFile(file, body, 'utf8')
    invalidateArchive()
    return file
  } catch {
    return null
  }
}

function push(meeting: Meeting, turn: MeetingTurn) {
  meeting.turns.push(turn)
}

const A2A_URL = (process.env.A2A_BASE_URL || 'http://127.0.0.1:9900').replace(/\/$/, '')
const A2A_TURN_TIMEOUT_MS = Number(process.env.MEETING_A2A_TIMEOUT_MS || 280_000)

/**
 * Ronde pembuka mode A2A: kantor memanggil tiap peserta lewat A2A (URL /slug)
 * dengan topik rapat; pernyataan pembuka dicatat verbatim + ctx-nya.
 * Gagal = giliran 'failed' + sebab, BUKAN karangan.
 */
async function runA2aOpening(meeting: Meeting): Promise<string[]> {
  meeting.phase = 'opening'
  meeting.currentSpeaker = meeting.moderator
  const order = [meeting.moderator, ...meeting.participants.filter((p) => p !== meeting.moderator)]
  const points = new Map<string, string>()
  for (const speaker of order) {
    meeting.currentSpeaker = speaker
    const prompt = buildOpeningPrompt({ speaker, topic: meeting.topic, participants: meeting.participants })
    try {
      const { text, ctx } = await sendA2a(A2A_URL, speaker, prompt, A2A_TURN_TIMEOUT_MS)
      push(meeting, { round: 0, speaker, kind: 'opening', text, ts: Date.now(), ctx })
      if (ctx) meeting.ctxIds!.push(ctx)
      points.set(speaker, text)
    } catch (err) {
      push(meeting, {
        round: 0,
        speaker,
        kind: 'failed',
        text: failedTurnText((err as Error).message),
        ts: Date.now(),
      })
    }
  }
  return order.map((s) => points.get(s) ?? '').filter(Boolean)
}

/**
 * Ronde silang mode A2A: kantor meminta pembicara S (lewat A2A) mengirim
 * poinnya ke peserta berikutnya T memakai `a2a_call` milik S sendiri, lalu
 * S melaporkan balasan T verbatim. Tiap giliran silang = hop agent→agent
 * nyata, bukan kantor yang memerantarai. Gagal di titik mana pun (S tak bisa
 * dihubungi, S gagal memanggil T, balasan tak terbaca) = 'failed' + sebab.
 */
async function runA2aCross(meeting: Meeting, points: string[]): Promise<void> {
  const turns = meeting.turns.filter((t) => t.kind !== 'minutes').length
  if (turns >= MAX_TURNS) return
  const order = [meeting.moderator, ...meeting.participants.filter((p) => p !== meeting.moderator)]
  meeting.phase = 'round1'
  for (let i = 0; i < order.length; i++) {
    if (meeting.turns.filter((t) => t.kind !== 'minutes').length >= MAX_TURNS) break
    const speaker = order[i]
    const next = order[(i + 1) % order.length]
    const point = points[i] || '(pernyataan pembuka tak tersedia — sampaikan posisimu sendiri)'
    meeting.currentSpeaker = speaker
    const prompt = buildCrossPrompt({ speaker, next, topic: meeting.topic, point })
    try {
      const { text, ctx } = await sendA2a(A2A_URL, speaker, prompt, A2A_TURN_TIMEOUT_MS)
      push(meeting, { round: 1, speaker, kind: 'speech', text, ts: Date.now(), ctx })
      if (ctx) meeting.ctxIds!.push(ctx)
    } catch (err) {
      push(meeting, {
        round: 1,
        speaker,
        kind: 'failed',
        text: failedTurnText((err as Error).message),
        ts: Date.now(),
      })
    }
  }
}

/** Notulen mode A2A: moderator (agent nyata, lewat A2A) menyusun dari transkrip. */
async function runA2aMinutes(meeting: Meeting): Promise<void> {
  meeting.phase = 'minutes'
  meeting.currentSpeaker = meeting.moderator
  try {
    const { text } = await sendA2a(
      A2A_URL,
      meeting.moderator,
      buildMinutesPrompt({
        moderator: meeting.moderator,
        topic: meeting.topic,
        transcript: transcript(meeting),
      }),
      A2A_TURN_TIMEOUT_MS,
    )
    meeting.minutes = text
  } catch (err) {
    meeting.minutes = `## KEPUTUSAN\nBelum ada kesepakatan final — notulen A2A gagal disusun: ${(err as Error).message}\n\n## TINDAK LANJUT\n- (tidak ada — notulen gagal)\n\n## RISIKO\n- Notulen disusun moderator gagal; baca transkrip mentah di atas.`
  }
  push(meeting, {
    round: 2,
    speaker: meeting.moderator,
    kind: 'minutes',
    text: 'Notulen tersimpan.',
    ts: Date.now(),
  })
  meeting.file = await persist(meeting)
  meeting.state = 'done'
  meeting.currentSpeaker = null
  meeting.phase = 'done'
}

/**
 * Rapat mode A2A: ronde pembuka (kantor→tiap peserta) + ronde silang
 * (S→T via a2a_call milik S) + notulen oleh moderator via A2A.
 */
async function runA2a(meeting: Meeting): Promise<void> {
  try {
    const points = await runA2aOpening(meeting)
    await runA2aCross(meeting, points)
    await runA2aMinutes(meeting)
  } catch (err) {
    meeting.state = 'error'
    meeting.phase = 'error'
    meeting.currentSpeaker = null
    meeting.turns.push({
      round: 0,
      speaker: 'sistem',
      kind: 'speech',
      text: `Rapat gagal: ${(err as Error).message}`,
      ts: Date.now(),
    })
  } finally {
    busy = false
  }
}

/**
 * Drive one meeting to completion. Serialized by `busy` so two UI clicks cannot
 * interleave turns into the same provider quota.
 */
async function run(meeting: Meeting): Promise<void> {
  try {
    const speakers = meeting.participants
    const rounds = Math.max(1, Math.min(2, Number(process.env.DEFAULT_MEETING_ROUNDS || 2)))

    meeting.state = 'running'
    meeting.phase = 'opening'
    meeting.currentSpeaker = meeting.moderator
    const opening = await complete(
      participantSystem(meeting, meeting.moderator),
      `Buka rapat ini: nyatakan masalahnya dalam 2 kalimat, lalu lempar pertanyaan pertama ke peserta lain.`,
    )
    push(meeting, {
      round: 0,
      speaker: meeting.moderator,
      kind: 'opening',
      text: opening,
      ts: Date.now(),
    })

    for (let round = 1; round <= rounds; round++) {
      meeting.phase = `round${round}`
      for (const speaker of speakers) {
        if (meeting.turns.filter((t) => t.kind !== 'minutes').length >= MAX_TURNS) break
        meeting.currentSpeaker = speaker
        const ask =
          round === 1
            ? `Berikan posisi teknismu tentang topik ini.`
            : `Tanggapi poin peserta lain secara spesifik (sebut nama) atau pertajam posisimu.`
        const reply = await complete(
          participantSystem(meeting, speaker),
          `${ask}\n\nTRANSCRIPT SO FAR:\n${transcript(meeting)}`,
        )
        push(meeting, { round, speaker, kind: 'speech', text: reply, ts: Date.now() })
      }
      if (meeting.turns.filter((t) => t.kind !== 'minutes').length >= MAX_TURNS) break
    }

    meeting.phase = 'minutes'
    meeting.currentSpeaker = meeting.moderator
    const minutes = await complete(
      MINUTES_SYSTEM,
      `TOPIC: ${meeting.topic}\n\nTRANSCRIPT:\n${transcript(meeting)}`,
    )
    meeting.minutes = minutes
    push(meeting, {
      round: rounds + 1,
      speaker: meeting.moderator,
      kind: 'minutes',
      text: 'Notulen tersimpan.',
      ts: Date.now(),
    })
    meeting.file = await persist(meeting)
    meeting.state = 'done'
    meeting.currentSpeaker = null
    meeting.phase = 'done'
  } catch (err) {
    meeting.state = 'error'
    meeting.phase = 'error'
    meeting.currentSpeaker = null
    meeting.turns.push({
      round: 0,
      speaker: 'sistem',
      kind: 'speech',
      text: `Rapat gagal: ${(err as Error).message}`,
      ts: Date.now(),
    })
  } finally {
    busy = false
  }
}

export async function startMeeting(input: {
  topic: string
  participants: string[]
  moderator?: string
  mode?: MeetingMode
}): Promise<Meeting> {
  const topic = input.topic.trim().slice(0, 300)
  const participants = [...new Set(input.participants.filter(Boolean))].slice(0, MAX_PARTICIPANTS)
  if (!topic) throw new Error('topik wajib diisi')
  if (participants.length < 2) throw new Error('butuh minimal 2 peserta')
  if (busy) throw new Error('masih ada rapat yang berjalan — tunggu sampai selesai')

  const moderator =
    input.moderator && participants.includes(input.moderator) ? input.moderator : participants[0]

  // Mode jujur: 'a2a' = agent nyata via A2A, selainnya = simulasi LLM
  // (perilaku lama) dengan label terus terang di arsip.
  const mode: MeetingMode = normalizeMeetingMode(input.mode)

  if (mode === 'a2a') {
    // Cabang tolak: peserta bukan agent A2A → rapat TIDAK DIMULAI, sebut siapa.
    const served = await listServedAgents().catch(() => [])
    const missing = missingServed(participants, served)
    if (missing.length) {
      const { formatReject } = await import('./meeting-a2a')
      throw new Error(formatReject(missing))
    }
  }

  const meeting: Meeting = {
    id: newId(),
    topic,
    participants,
    moderator,
    mode,
    state: 'queued',
    phase: 'menunggu',
    currentSpeaker: null,
    turns: [],
    minutes: '',
    file: null,
    ctxIds: [],
  }
  meetings.set(meeting.id, meeting)
  busy = true
  void (mode === 'a2a' ? runA2a(meeting) : run(meeting))
  return meeting
}

export function getMeeting(id: string): Meeting | null {
  return meetings.get(id) || null
}

/**
 * Live meetings in this process, newest first. Finished ones stay in the map (so
 * the UI can show the minutes it just generated) but are also on disk, and the
 * history endpoint is what the "previous meetings" list reads.
 */
export function listMeetings(): Meeting[] {
  return [...meetings.values()].sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)))
}

/** A meeting currently holding the single execution slot. */
export function activeMeeting(): Meeting | null {
  return listMeetings().find((m) => m.state === 'running' || m.state === 'queued') ?? null
}
