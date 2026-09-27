import { NextRequest, NextResponse } from 'next/server'
import { createTask } from '@/lib/hermes/kanban'
import type { TaskOrigin } from '@/types/hermes'

export const dynamic = 'force-dynamic'

/**
 * Create several tasks at once, all carrying the same origin.
 *
 * This is the write half of every cross-menu link (meeting → board, cron → board).
 * One endpoint rather than one per source, because the only thing that differs is
 * the origin marker — the creation path is identical, and duplicating it would let
 * the two drift.
 *
 * Partial success is the normal case: one row with no assignee must not lose the
 * others, so the response reports both lists.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'body tidak valid', status: 400 } },
      { status: 400 },
    )
  }

  const o = (body.origin ?? {}) as Record<string, unknown>
  const kind = String(o.kind ?? '')
  if (kind !== 'meeting' && kind !== 'cron' && kind !== 'agent' && kind !== 'manual') {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'origin.kind tidak dikenal', status: 400 } },
      { status: 400 },
    )
  }
  const origin: TaskOrigin = {
    kind,
    ref: typeof o.ref === 'string' && o.ref.trim() ? o.ref.trim().slice(0, 120) : undefined,
  }

  const raw = Array.isArray(body.items) ? body.items : []
  if (!raw.length) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'tidak ada item', status: 400 } },
      { status: 400 },
    )
  }

  const created: { id: string; title: string; assignee: string }[] = []
  const failed: { title: string; error: string }[] = []

  // Bounded: a runaway source must not create hundreds of tasks in one request.
  for (const it of raw.slice(0, 25)) {
    const title = String(it?.title ?? it?.text ?? '').trim().slice(0, 300)
    const assignee = String(it?.assignee ?? '').trim()
    if (!title) continue
    if (!assignee) {
      failed.push({ title, error: 'penanggung belum dipilih' })
      continue
    }
    try {
      const task = await createTask({
        title,
        assignee,
        body: typeof it?.body === 'string' && it.body.trim() ? it.body : undefined,
        priority: Number.isFinite(Number(it?.priority)) ? Number(it.priority) : undefined,
        origin,
      })
      created.push({ id: task.id, title: task.title, assignee })
    } catch (err) {
      failed.push({ title, error: (err as Error).message })
    }
  }

  return NextResponse.json(
    { success: created.length > 0, created, failed, origin },
    { status: created.length ? 201 : 502 },
  )
}
