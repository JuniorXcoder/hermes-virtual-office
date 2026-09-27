import { NextRequest, NextResponse } from 'next/server'
import {
  activeMeeting,
  isConfigured,
  listArchived,
  listMeetings,
  readArchived,
  startMeeting,
} from '@/lib/hermes/meeting'
import { listAgents, listTasks } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/**
 * Meeting history.
 *
 * The picker needs three things before the user can start anything: whether the
 * provider is configured, which meetings are live right now, and the previous
 * meetings on disk. All three come from here so the UI makes one request.
 *
 * `GET /api/hermes/meeting?id=<meetingId>` returns one archived transcript.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const body = await readArchived(id)
    if (body === null) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: `rapat "${id}" tidak ditemukan`, status: 404 } },
        { status: 404 },
      )
    }
    return NextResponse.json({ id, body })
  }

  return NextResponse.json({
    configured: isConfigured(),
    /** Live in this process: running, queued, or just-finished with minutes. */
    live: listMeetings(),
    /** Held by one meeting at a time; a second start queues behind it. */
    active: activeMeeting()?.id ?? null,
    /** Written by this or an earlier server run. */
    archived: await listArchived(),
  })
}

/**
 * Start a meeting.
 *
 * This handler was lost once already: the route was rewritten to add the history
 * GET and only the GET was written, so every start answered 405 with an empty
 * body — which the browser reports as "Unexpected end of JSON input". There is a
 * self-test for the method list now.
 *
 * Participants are validated against the live agent list so a stale name from an
 * old page cannot start a meeting with a non-existent agent.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  try {
    const tasks = await listTasks()
    const known = new Set((await listAgents(tasks)).map((a) => a.name))
    const participants = (Array.isArray(body?.participants) ? body.participants : [])
      .map((p: unknown) => String(p))
      .filter((p: string) => known.has(p))
    if (participants.length < 2) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: 'pilih minimal 2 peserta yang dikenal',
            status: 400,
          },
        },
        { status: 400 },
      )
    }
    const meeting = await startMeeting({
      topic: String(body?.topic || ''),
      participants,
      moderator: body?.moderator ? String(body.moderator) : undefined,
      mode: body?.mode,
    })
    return NextResponse.json({ meeting })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'meeting_failed', message: (err as Error).message, status: 409 } },
      { status: 409 },
    )
  }
}
