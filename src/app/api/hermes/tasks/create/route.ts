import { NextRequest, NextResponse } from 'next/server'
import { createTask } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

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
    })
    return NextResponse.json({ success: true, task }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'dispatch_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
