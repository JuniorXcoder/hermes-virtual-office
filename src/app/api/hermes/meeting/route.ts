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
import { listServedAgents } from '@/lib/hermes/a2a-served'
import { visibleNames } from '@/lib/hermes/office-membership'
import { assertLocalWriteRequest } from '@/lib/local-guard'

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
 *
 * Modes (RAPAT-A2A-1): `a2a` = real agents via the A2A protocol (rejects when a
 * participant is not served, naming who + the fix); anything else = `simulasi`,
 * the old LLM-voices-everyone behavior, labelled honestly in the archive.
 */
export async function POST(req: NextRequest) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const mode = body?.mode === 'a2a' ? 'a2a' : 'simulasi'
  try {
    const tasks = await listTasks()
    const agentList = await listAgents(tasks)
    // Nama dikenal = profil ada di office ATAU terdaftar served-A2A. Peserta
    // rapat A2A (budi/sari/tono) tidak selalu punya agent di lantai kantor,
    // tapi mereka agent A2A nyata — menolak mereka di sini = cabang tolak
    // startMeeting tak pernah tercapai. Dummy tetap ditolak di sini.
    const served = await listServedAgents().catch(() => [])
    const servedNames = new Set(served.flatMap((s) => [s.profile.toLowerCase(), s.slug.toLowerCase()]))
    const known = new Set([
      ...visibleNames(agentList.map((a) => a.name)),
      ...servedNames,
    ])
    const rawPicked: string[] = (Array.isArray(body?.participants) ? body.participants : [])
      .map((p: unknown) => String(p))
    const unknown = rawPicked.filter((p: string) => !known.has(p.toLowerCase()))
    const knownPicked = [...new Set(rawPicked.filter((p: string) => known.has(p.toLowerCase())))]
    // Jujur duluan: nama tak dikenal disebut persis (cabang tolak rapat A2A
    // harus bisa menyebut SIAPA, bukan "pilih yang dikenal").
    if (unknown.length) {
      const { formatReject } = await import('@/lib/hermes/meeting-a2a')
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: mode === 'a2a' ? formatReject([...new Set(unknown)]) : `peserta tak dikenal: ${[...new Set(unknown)].join(', ')}`,
            status: 400,
          },
        },
        { status: 400 },
      )
    }
    if (knownPicked.length < 2) {
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
      participants: knownPicked.slice(0, 4),
      moderator: body?.moderator ? String(body.moderator) : undefined,
      mode,
    })
    return NextResponse.json({ meeting })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'meeting_failed', message: (err as Error).message, status: 409 } },
      { status: 409 },
    )
  }
}
