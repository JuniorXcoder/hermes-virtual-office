import { NextRequest, NextResponse } from 'next/server'
import {
  createProfile,
  deleteProfile,
  listAgents,
  listAssignees,
  listProfiles,
  listTasks,
  purgeTasks,
  tasksForAssignee,
} from '@/lib/hermes/kanban'
import { isKilled, killedNames, spawn } from '@/lib/hermes/office-membership'

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
        reason: inOffice.has(name)
          ? null
          : isKilled(name)
            ? 'killed'
            : profiles.includes(name)
              ? 'unknown'
              : 'no_profile',
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
    // `spawn` accepts anything the install knows, otherwise a typo would create a
    // kill-list entry matching nothing. `kill` must NOT go through this check: a
    // name with tasks but no profile is exactly the case it needs to handle (the
    // tasks still have to be removed), and the guard rejected it as "tidak dikenal".
    if (action === 'spawn') {
      const known = new Set([
        ...(await listAssignees()).map((a) => a.name),
        ...(await listProfiles()),
      ])
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
    }

    /* -------------------------------------------------------------- kill --- */
    // `kill` DELETES the profile. It used to only hide it from the office; that
    // is now `spawn`/membership, and this is the destructive one.
    if (action === 'kill') {
      // `default` lives at ~/.hermes itself, not under profiles/, so the disk
      // check below would refuse it with a misleading "tidak ada di disk".
      if (name === 'default') {
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request',
              message: 'profil "default" tidak bisa dihapus',
              status: 400,
            },
          },
          { status: 400 },
        )
      }

      /* ---- 1. the tasks ---- */
      // Killing an agent deletes its work too, which is what "kill" should mean —
      // otherwise the board fills with tasks belonging to nobody.
      const owned = await tasksForAssignee(name)
      // Refuse while any of them is live. Archiving a running task abandons the
      // worker mid-flight and the CLI will do it without complaint.
      const active = owned.filter((t) => t.status === 'running' || t.status === 'review')
      if (active.length) {
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request',
              message:
                `${name} punya ${active.length} tugas yang masih berjalan ` +
                `(${active.map((t) => t.id).join(', ')}). Hentikan dulu sebelum dihapus.`,
              status: 409,
            },
          },
          { status: 409 },
        )
      }

      /* ---- 2. the profile ---- */
      const hasProfile = (await listProfiles()).includes(name)
      if (!hasProfile && !owned.length) {
        // Nothing at all: no profile, no tasks. Explain rather than report a
        // failed delete.
        return NextResponse.json(
          {
            error: {
              code: 'no_profile',
              message: `"${name}" tidak punya profil maupun tugas — tidak ada yang bisa dihapus.`,
              status: 409,
            },
          },
          { status: 409 },
        )
      }

      let purged = 0
      try {
        if (owned.length) {
          const r = await purgeTasks(owned.map((t) => t.id))
          purged = r.purged
        }
        if (hasProfile) await deleteProfile(name)
      } catch (err) {
        const msg = (err as Error).message
        // Refusals (default, gateway running) are the caller's, not a server fault.
        const refused = /tidak bisa dihapus|sedang berjalan|wajib diisi/.test(msg)
        return NextResponse.json(
          {
            error: {
              code: refused ? 'invalid_request' : 'action_failed',
              message:
                purged > 0
                  ? `${purged} tugas sudah dihapus, tapi profilnya gagal: ${msg}`
                  : msg,
              status: refused ? 400 : 502,
            },
          },
          { status: refused ? 400 : 502 },
        )
      }

      // Clear any membership entry: a stale entry would block a future profile
      // that reuses the name.
      spawn(name)
      return NextResponse.json({
        success: true,
        action,
        name,
        /** The profile no longer exists (false when it was already gone). */
        deleted: hasProfile,
        /** How many of its tasks were removed from the board. */
        purged,
        killed: killedNames(),
      })
    }

    /* ------------------------------------------------------------- spawn --- */
    const changed = spawn(name)
    return NextResponse.json({
      success: true,
      action,
      name,
      /** false when the profile was already visible. */
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
