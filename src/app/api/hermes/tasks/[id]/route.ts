import { NextRequest, NextResponse } from 'next/server'
import { commentOnTask, listRuns, releaseWorker, taskLog } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

/** Screen peeker payload: run history + raw log tail for a task. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const [runs, log] = await Promise.all([listRuns(id), taskLog(id)])
    return NextResponse.json({ taskId: id, runs, log })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'peek_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}

/** Desk intervention: steer (comment) or reclaim (release the worker claim). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')
  try {
    if (action === 'steer') {
      const message = String(body?.message || '').trim()
      if (!message) {
        return NextResponse.json(
          { error: { code: 'invalid_request', message: 'message is required', status: 400 } },
          { status: 400 },
        )
      }
      return NextResponse.json({ success: true, steered: await commentOnTask(id, message) })
    }
    if (action === 'cancel') {
      try {
        return NextResponse.json({ success: true, released: await releaseWorker(id) })
      } catch (err) {
        // The CLI refuses to reclaim a task that is not running. That is correct
        // behaviour, not a server fault, so report it as a conflict.
        const msg = (err as Error).message
        const notRunning = /cannot reclaim|not running|unknown id/i.test(msg)
        return NextResponse.json(
          {
            error: notRunning
              ? { code: 'not_running', message: 'Tugas ini tidak sedang berjalan.', status: 409 }
              : { code: 'action_failed', message: msg, status: 502 },
          },
          { status: notRunning ? 409 : 502 },
        )
      }
    }
    return NextResponse.json(
      { error: { code: 'invalid_request', message: "action must be 'steer' or 'cancel'", status: 400 } },
      { status: 400 },
    )
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
