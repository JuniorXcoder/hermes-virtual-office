import { NextResponse } from 'next/server'
import { listAgents, listTasks } from '@/lib/hermes/kanban'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const tasks = await listTasks()
    const agents = await listAgents(tasks)
    return NextResponse.json({ tasks, agents })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'hermes_unavailable', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}
