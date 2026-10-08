import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/hermes/cron'
import { listAgents, listTasks } from '@/lib/hermes/kanban'
import { visibleNames } from '@/lib/hermes/office-membership'
import type { Candidate } from '@/types/hermes'

export const dynamic = 'force-dynamic'

/**
 * Read a cron job's failure as a candidate task.
 *
 * A job that has failed repeatedly is a task waiting to be written: something is
 * broken and someone should look. This turns the job's own error text into a
 * proposal rather than inventing one, so the task carries the real message.
 *
 * `GET ?from=<jobId>` — nothing is written; creating goes through the shared
 * `/api/hermes/tasks`.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from')
  if (!from) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'from=<jobId> wajib', status: 400 } },
      { status: 400 },
    )
  }

  // getJob/listAgents/listTasks melempar saat CLI mati — tanpa try/catch route
  // menjawab 500 tanpa badan (bukan error JSON seragam seperti route lain).
  try {
  const job = await getJob(from)
  if (!job) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: `job "${from}" tidak ditemukan`, status: 404 } },
      { status: 404 },
    )
  }

  const roster = visibleNames((await listAgents(await listTasks())).map((a) => a.name))
  const items: Candidate[] = []

  // Only a job that is actually in trouble has something to hand over. A healthy
  // job has no work to create, and offering one would be noise.
  if (job.failureStreak > 0) {
    items.push({
      text: `Perbaiki cron "${job.name}" (gagal ${job.failureStreak}×)`,
      owner: '',
      due: undefined,
      body: [
        `Job: ${job.id} — ${job.name}`,
        `Jadwal: ${job.schedule}`,
        job.lastRunAt ? `Terakhir jalan: ${job.lastRunAt}` : '',
        job.lastError ? `Error terakhir:\n${job.lastError}` : '',
        job.prompt ? `Prompt:\n${job.prompt}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    })
  }

  return NextResponse.json({ job: { id: job.id, name: job.name }, items, roster })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'cron_actions_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
