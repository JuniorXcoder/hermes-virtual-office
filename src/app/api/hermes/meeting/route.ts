import { NextRequest, NextResponse } from 'next/server'
import { isConfigured, listMeetings, startMeeting } from '@/lib/meeting-engine'
import { listAgents, listTasks } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    configured: isConfigured(),
    meetings: listMeetings(),
  })
}

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
        { error: { code: 'invalid_request', message: 'pilih minimal 2 peserta yang dikenal', status: 400 } },
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
