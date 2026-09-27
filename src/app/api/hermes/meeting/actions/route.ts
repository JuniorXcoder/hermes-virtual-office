import { NextRequest, NextResponse } from 'next/server'
import { matchOwner, parseActionItems } from '@/lib/hermes/action-items'
import { listAgents, listTasks } from '@/lib/hermes/kanban'
import { listMeetings, readArchived } from '@/lib/hermes/meeting'

export const dynamic = 'force-dynamic'

/**
 * Read a meeting's follow-ups as candidate tasks.
 *
 * `GET ?from=<meetingId>` parses the `## TINDAK LANJUT` section of that meeting's
 * minutes into action items and resolves each owner against the live roster.
 *
 * This is a PROPOSAL — nothing is written. Minutes routinely contain items nobody
 * agreed to action, so the user picks. Creating them is
 * `POST /api/hermes/tasks`, which is shared with every other source
 * rather than duplicated here.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from')
  if (!from) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'from=<meetingId> wajib', status: 400 } },
      { status: 400 },
    )
  }

  // A live meeting or an archived transcript — both are legitimate sources.
  const live = listMeetings().find((m) => m.id === from)
  let minutes = live?.minutes || ''
  let topic = live?.topic || ''
  if (!live) {
    const body = await readArchived(from)
    if (body === null) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: `rapat "${from}" tidak ditemukan`,
            status: 404,
          },
        },
        { status: 404 },
      )
    }
    // The archived file is the whole markdown — heading, metadata, transcript, then
    // the minutes. The parser seeks the TINDAK LANJUT heading, so handing it the
    // full body is correct; it finds the section wherever it sits.
    minutes = body
    topic = (body.match(/^#\s+(.+)$/m)?.[1] || '').trim()
  }

  const items = parseActionItems(minutes)
  const roster = (await listAgents(await listTasks())).map((a) => a.name)

  return NextResponse.json({
    meeting: { id: from, topic },
    /** Empty when the minutes agreed nothing, which is a normal outcome. */
    items: items.map((it) => ({
      ...it,
      /** Resolved profile name, or null when the minutes named nobody we know. */
      suggested: matchOwner(it.owner, roster),
    })),
    roster,
  })
}
