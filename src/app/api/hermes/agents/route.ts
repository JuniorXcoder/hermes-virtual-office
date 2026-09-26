import { NextRequest, NextResponse } from 'next/server'
import { listAgents, listAssignees, listTasks } from '@/lib/hermes/kanban'
import { isKilled, killedNames, kill, spawn } from '@/lib/hermes/office-membership'

export const dynamic = 'force-dynamic'

/**
 * The spawn/kill menu.
 *
 * `available` is every Hermes profile; `inOffice` is the subset currently shown
 * in the 3D room. A profile can be spawned (brought back) or killed (walked out)
 * without touching its tasks — this changes office membership only.
 */
export async function GET() {
  try {
    const [assignees, tasks] = await Promise.all([listAssignees(), listTasks()])
    const agents = await listAgents(tasks)
    const inOffice = new Set(agents.filter((a) => !isKilled(a.name)).map((a) => a.name))
    return NextResponse.json({
      available: assignees.map((a) => ({
        name: a.name,
        total: a.total,
        inOffice: inOffice.has(a.name),
        /** Why it is absent, when it is. */
        reason: inOffice.has(a.name) ? null : isKilled(a.name) ? 'killed' : 'unknown',
      })),
      killed: killedNames(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'hermes_unavailable', message: (err as Error).message, status: 503 } },
      { status: 503 },
    )
  }
}

/**
 * Spawn or kill a profile.
 *
 * `action: "spawn"` brings a profile into the office; it walks in through the
 * front door. `action: "kill"` removes it; the avatar walks out of the door and
 * despawns on arrival, rather than vanishing at its desk.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')
  const name = String(body?.name || '').trim()

  if (action !== 'spawn' && action !== 'kill') {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: "action must be 'spawn' or 'kill'",
          status: 400,
        },
      },
      { status: 400 },
    )
  }
  if (!name) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'name is required', status: 400 } },
      { status: 400 },
    )
  }

  try {
    // Only profiles the install actually knows may be toggled, otherwise a typo
    // would silently create a kill-list entry that matches nothing.
    const known = new Set((await listAssignees()).map((a) => a.name))
    if (!known.has(name)) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: `profil "${name}" tidak dikenal`,
            status: 400,
          },
        },
        { status: 400 },
      )
    }

    const changed = action === 'spawn' ? spawn(name) : kill(name)
    return NextResponse.json({
      success: true,
      action,
      name,
      /** false when the profile was already in the requested state. */
      changed,
      killed: killedNames(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
