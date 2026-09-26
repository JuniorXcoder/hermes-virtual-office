import { NextRequest, NextResponse } from 'next/server'
import { activeMeeting, isConfigured, listArchived, listMeetings, readArchived } from '@/lib/meeting-engine'

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
