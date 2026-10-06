import { NextRequest, NextResponse } from 'next/server'
import {
  answerQuestion,
  askQuestion,
  getOfficeName,
  listAvatars,
  listQa,
  openQaCounts,
  saveAvatars,
  setOfficeName,
  type AvatarWrite,
} from '@/lib/office/db'
import { assertLocalWriteRequest } from '@/lib/local-guard'
import type { AgentDivision } from '@/types/hermes'

export const dynamic = 'force-dynamic'

/**
 * The office's own store: name, avatar positions/activities, and agent Q&A.
 *
 * This is deliberately separate from `/api/hermes/*` (tasks, agents, cron,
 * meeting). Those read the Hermes CLI; this reads `data/office.db`, which belongs
 * to the office itself. Keeping them apart means a broken Hermes install still
 * lets the room render, and the office's own tables never risk the CLI's schema.
 */
export async function GET() {
  try {
    return NextResponse.json({
      name: getOfficeName(),
      avatars: listAvatars(),
      qa: listQa(),
      /** Open thread count per responsible — the badge the UI shows. */
      qaOpen: openQaCounts(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'office_db_failed', message: (err as Error).message, status: 500 } },
      { status: 500 },
    )
  }
}

type Body = {
  action?: string
  name?: string
  list?: AvatarWrite[]
  asker?: string
  responsible?: string
  question?: string
  id?: number
  answer?: string
}

const DIVISIONS: AgentDivision[] = ['exec', 'tech', 'growth', 'content']

/** Clamp a raw avatar write so a malformed client cannot poison the table. */
function cleanAvatar(raw: unknown): AvatarWrite | null {
  const a = raw as Partial<AvatarWrite>
  if (!a?.avatarId || !a?.name) return null
  const division = DIVISIONS.includes(a.division as AgentDivision) ? (a.division as AgentDivision) : 'tech'
  return {
    avatarId: String(a.avatarId),
    name: String(a.name),
    division,
    kind: a.kind === 'agent' ? 'agent' : 'dummy',
    x: Number(a.x) || 0,
    z: Number(a.z) || 0,
    level: Number(a.level) || 0,
    activity: String(a.activity || 'idle'),
    facing: Number(a.facing) || 0,
    spawned: !!a.spawned,
  }
}

export async function POST(req: NextRequest) {
  // Same-origin write guard, exactly like the other mutating routes: this server
  // is exposed on a public port, and these actions write to disk.
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as Body
  try {
    switch (body.action) {
      case 'setName': {
        return NextResponse.json({ name: setOfficeName(String(body.name ?? '')) })
      }
      case 'saveAvatars': {
        const list = (Array.isArray(body.list) ? body.list : [])
          .map(cleanAvatar)
          .filter((a): a is AvatarWrite => a !== null)
        return NextResponse.json({ saved: saveAvatars(list) })
      }
      case 'askQuestion': {
        const asker = String(body.asker ?? '').trim()
        const responsible = String(body.responsible ?? '').trim()
        const question = String(body.question ?? '').trim()
        if (!asker || !responsible || !question) {
          return NextResponse.json(
            { error: { code: 'invalid_request', message: 'asker, responsible, question wajib', status: 400 } },
            { status: 400 },
          )
        }
        return NextResponse.json({ thread: askQuestion(asker, responsible, question) })
      }
      case 'answerQuestion': {
        const id = Number(body.id)
        const answer = String(body.answer ?? '').trim()
        if (!Number.isFinite(id) || !answer) {
          return NextResponse.json(
            { error: { code: 'invalid_request', message: 'id dan answer wajib', status: 400 } },
            { status: 400 },
          )
        }
        const thread = answerQuestion(id, answer)
        if (!thread) {
          return NextResponse.json(
            { error: { code: 'not_found', message: `thread ${id} tidak ada`, status: 404 } },
            { status: 404 },
          )
        }
        return NextResponse.json({ thread })
      }
      default:
        return NextResponse.json(
          { error: { code: 'invalid_request', message: `action tidak dikenal: ${body.action}`, status: 400 } },
          { status: 400 },
        )
    }
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'office_write_failed', message: (err as Error).message, status: 500 } },
      { status: 500 },
    )
  }
}
