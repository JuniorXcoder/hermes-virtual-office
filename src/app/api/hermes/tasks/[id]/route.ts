import { NextRequest, NextResponse } from 'next/server'
import {
  commentOnTask,
  dispatchTask,
  getTask,
  listRuns,
  promoteTask,
  releaseWorker,
  setTaskModel,
  taskLog,
  unblockTask,
} from '@/lib/hermes/kanban'
import { assertLocalWriteRequest } from '@/lib/local-guard'

export const dynamic = 'force-dynamic'

/**
 * One task: its run history and log tail, or an intervention.
 *
 * The `id` is checked against the board before anything else. A dynamic segment
 * matches ANY path, so without this check `/api/hermes/tasks/<anything>` answered
 * 200 with an empty payload — a misspelled or deleted task looked like a real task
 * that simply had no runs. A 404 is the honest answer.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const task = await getTask(id)
    if (!task) return notFound(id)
    const [runs, log] = await Promise.all([listRuns(id), taskLog(id)])
    return NextResponse.json({ taskId: id, task, runs, log })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'peek_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}

/**
 * Desk intervention: steer (comment), reclaim (release the worker claim), run
 * (wake the dispatcher), promote (unblock), or set the worker's model.
 *
 * `run` and `promote` exist because the board has no runner of its own. A task
 * sits in `ready` until the gateway's dispatcher spawns a worker for it, so with
 * the gateway down a task is stranded with no visible reason and no way out from
 * the UI. `run` does one dispatch pass (the worker it spawns is detached and
 * outlives this request) and `promote` returns a blocked task to `ready`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')
  try {
    // Same guard as GET: acting on a task that does not exist must say so rather
    // than report a downstream CLI error as a server fault.
    const task = await getTask(id)
    if (!task) return notFound(id)

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
    if (action === 'run') {
      // One button that does the right thing: a parked task is lifted first (the
      // dispatcher ignores blocked/scheduled rows entirely), then one dispatch
      // pass runs. Reported honestly when the board still refuses to move it —
      // e.g. a `todo` task whose parent dependencies are not done yet.
      const parked = task.status === 'blocked' || task.status === 'scheduled'
      if (parked) await unblockTask(id, 'dijalankan dari kantor')

      const { spawned } = await dispatchTask()
      const mine = spawned.includes(id)
      if (mine) {
        return NextResponse.json({
          success: true,
          spawned,
          mine,
          note: 'Worker dijalankan — pantau lewat Intip layar.',
        })
      }
      const after = await getTask(id)
      return NextResponse.json({
        success: true,
        spawned,
        mine,
        note:
          after?.status === 'todo'
            ? 'Tugas masih menunggu subtugas prasyaratnya selesai.'
            : spawned.length
              ? 'Dispatcher menjalankan tugas lain lebih dulu; coba lagi.'
              : 'Belum ada yang bisa dijalankan sekarang.',
      })
    }
    if (action === 'promote') {
      const reason = String(body?.message || '').trim() || 'dijalankan dari kantor'
      // `promote` refuses `scheduled`; `unblock` refuses nothing in that pair.
      const promoted =
        task.status === 'scheduled'
          ? await unblockTask(id, reason)
          : await promoteTask(id, reason)
      return NextResponse.json({ success: true, promoted })
    }
    if (action === 'set-model') {
      const model = body?.model == null ? null : String(body.model).trim() || null
      const provider = body?.provider == null ? null : String(body.provider).trim() || null
      return NextResponse.json({
        success: true,
        model: await setTaskModel(id, model, provider),
      })
    }
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: "action must be 'steer', 'cancel', 'run', 'promote' or 'set-model'",
          status: 400,
        },
      },
      { status: 400 },
    )
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}

function notFound(id: string) {
  return NextResponse.json(
    { error: { code: 'not_found', message: `tugas "${id}" tidak ada di board`, status: 404 } },
    { status: 404 },
  )
}
