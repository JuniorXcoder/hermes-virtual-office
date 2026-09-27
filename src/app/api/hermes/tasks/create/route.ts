import { NextRequest, NextResponse } from 'next/server'
import { createTask } from '@/lib/hermes/kanban'
import type { TaskOrigin } from '@/types/hermes'

export const dynamic = 'force-dynamic'

/** Accept only the origins the UI is allowed to set, so `created_by` stays parseable. */
function readOrigin(raw: unknown): TaskOrigin | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const kind = String(o.kind ?? '')
  if (kind !== 'meeting' && kind !== 'cron' && kind !== 'agent' && kind !== 'manual') {
    return undefined
  }
  const ref = typeof o.ref === 'string' && o.ref.trim() ? o.ref.trim().slice(0, 120) : undefined
  return { kind, ref }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'title is required', status: 400 } },
      { status: 400 },
    )
  }
  if (typeof body.assignee !== 'string' || !body.assignee.trim()) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'assignee is required', status: 400 } },
      { status: 400 },
    )
  }

  try {
    const task = await createTask({
      title: body.title.trim().slice(0, 300),
      assignee: body.assignee.trim(),
      body: typeof body.body === 'string' ? body.body : undefined,
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : undefined,
      // The cross-menu link. Recorded on `created_by` so the board can say where a
      // task came from and the source panel can list what it produced.
      origin: readOrigin(body.origin),
    })
    return NextResponse.json({ success: true, task }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'dispatch_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
