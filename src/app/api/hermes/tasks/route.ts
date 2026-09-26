import { NextResponse } from 'next/server'
import { listAgents, listTasks } from '@/lib/hermes/kanban'
import { visible } from '@/lib/hermes/office-membership'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const tasks = await listTasks()
    // Apply the spawn/kill list: a killed profile is absent from the office but
    // its tasks stay on the board, so the work is never hidden, only the avatar.
    const agents = visible(await listAgents(tasks))
    return NextResponse.json({ tasks, agents })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'hermes_unavailable', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
