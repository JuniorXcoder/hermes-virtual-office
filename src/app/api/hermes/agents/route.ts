import { NextRequest, NextResponse } from 'next/server'
import { createProfile, listAgents, listAssignees, listProfiles, listTasks } from '@/lib/hermes/kanban'
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
    const [assignees, tasks, profiles] = await Promise.all([
      listAssignees(),
      listTasks(),
      listProfiles(),
    ])
    const agents = await listAgents(tasks)
    const inOffice = new Set(agents.filter((a) => !isKilled(a.name)).map((a) => a.name))
    // Union of assignees and on-disk profiles: a profile with no tasks is still a
    // profile, and must be listed or creating one looks like it failed.
    const counts = new Map(assignees.map((a) => [a.name, a.total]))
    const roster = [...new Set([...counts.keys(), ...profiles])].sort()
    return NextResponse.json({
      available: roster.map((name) => ({
        name,
        total: counts.get(name) ?? 0,
        /** True when the profile exists on disk (not just as a task assignee). */
        profile: profiles.includes(name),
        inOffice: inOffice.has(name),
        /** Why it is absent, when it is. */
        reason: inOffice.has(name) ? null : isKilled(name) ? 'killed' : 'unknown',
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

  if (action !== 'spawn' && action !== 'kill' && action !== 'create') {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: "action must be 'spawn', 'kill' or 'create'",
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

  // Creating a profile is a different operation: it makes the profile, walks the
  // agent in, and returns a distinct shape so the UI can report what happened.
  if (action === 'create') {
    try {
      const created = await createProfile(name, String(body?.description || ''))
      // A brand-new profile carries no kill-list entry, so it appears on the next
      // poll — no need to touch membership.
      return NextResponse.json(
        { success: true, action, name: created.name, description: created.description },
        { status: 201 },
      )
    } catch (err) {
      const msg = (err as Error).message
      // "sudah ada" and the name-format error are the caller's fault, not a fault.
      const isUserError = /sudah ada|nama profil harus/.test(msg)
      return NextResponse.json(
        {
          error: {
            code: isUserError ? 'invalid_request' : 'action_failed',
            message: msg,
            status: isUserError ? 400 : 502,
          },
        },
        { status: isUserError ? 400 : 502 },
      )
    }
  }

  try {
    // Only profiles the install actually knows may be toggled, otherwise a typo
    // would silently create a kill-list entry that matches nothing.
    const known = new Set([...(await listAssignees()).map((a) => a.name), ...(await listProfiles())])
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
