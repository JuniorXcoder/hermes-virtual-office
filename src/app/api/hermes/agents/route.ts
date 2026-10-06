import { NextRequest, NextResponse } from 'next/server'
import {
  createProfile,
  deleteProfile,
  listAgents,
  listAssignees,
  listProfiles,
  listTasks,
  profileModel,
  purgeTasks,
  setProfileModel,
  tasksForAssignee,
} from '@/lib/hermes/kanban'
import { BUILTIN_HIDDEN, hiddenNames, isHidden, hide, show } from '@/lib/hermes/office-membership'
import { assertLocalWriteRequest } from '@/lib/local-guard'
import type { AgentDivision, AgentRole } from '@/types/hermes'
import { ROLE_LABEL, soulFor } from '@/lib/hermes/soul'

export const dynamic = 'force-dynamic'

/**
 * The spawn/hide/kill menu.
 *
 * `available` is every Hermes profile; `inOffice` is the subset currently shown
 * in the 3D room. `hide` and `spawn` toggle office membership only — they never
 * touch the profile or its tasks. `kill` is the destructive one: it deletes the
 * profile and purges its tasks.
 */
export async function GET() {
  try {
    const [assignees, tasks, profiles] = await Promise.all([
      listAssignees(),
      listTasks({ includeArchived: true }),
      listProfiles(),
    ])
    // Pass the assignees already fetched: listAgents() would spawn the same CLI
    // read a second time.
    const agents = await listAgents(tasks, assignees)
    const inOffice = new Set(agents.filter((a) => !isHidden(a.name)).map((a) => a.name))
    // Union of assignees and on-disk profiles: a profile with no tasks is still a
    // profile, and must be listed or creating one looks like it failed.
    const counts = new Map(assignees.map((a) => [a.name, a.total]))
    // `default` and any runtime-hidden profile must not appear in the spawn panel:
    // it is not a colleague, it is the install's own orchestrator profile.
    const roster = [...new Set([...counts.keys(), ...profiles])].filter((n) => !isHidden(n)).sort()
    // Each profile's default model costs one CLI read (`-p <name> config get
    // model`), so they run in parallel and only for profiles that exist on disk —
    // an assignee left over from a deleted profile has no config to read.
    const models = await Promise.all(
      roster.map(async (name) =>
        profiles.includes(name) ? (await profileModel(name)).model : null,
      ),
    )
    // role/division/soul dari listAgents (baca SOUL.md + fallback keyword).
    const agentMeta = new Map(agents.map((a) => [a.name, a]))
    return NextResponse.json({
      available: roster.map((name, i) => ({
        name,
        total: counts.get(name) ?? 0,
        /** True when the profile exists on disk (not just as a task assignee). */
        profile: profiles.includes(name),
        inOffice: inOffice.has(name),
        /** The profile's default model, when it has one. */
        model: models[i],
        /** Role + divisi (dari SOUL.md, fallback keyword nama). */
        role: agentMeta.get(name)?.role ?? null,
        division: agentMeta.get(name)?.division ?? null,
        soulExists: agentMeta.get(name)?.soulExists ?? false,
        /** Why it is absent, when it is. */
        reason: inOffice.has(name)
          ? null
          : isHidden(name)
            ? 'hidden'
            : profiles.includes(name)
              ? 'unknown'
              : 'no_profile',
      })),
      hidden: hiddenNames(),
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
  const denied = assertLocalWriteRequest(req)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '')
  const name = String(body?.name || '').trim()

  if (
    action !== 'spawn' &&
    action !== 'hide' &&
    action !== 'kill' &&
    action !== 'create' &&
    action !== 'set-model'
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: "action must be 'spawn', 'hide', 'kill', 'create' or 'set-model'",
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

  // The profile's default model: what its workers and chat turns run unless a task
  // pins its own (`hermes kanban set-model`).
  if (action === 'set-model') {
    const model = body?.model == null ? '' : String(body.model).trim()
    const provider = body?.provider == null ? null : String(body.provider).trim() || null
    if (!model) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: 'model is required', status: 400 } },
        { status: 400 },
      )
    }
    try {
      await setProfileModel(name, model, provider)
      return NextResponse.json({ success: true, action, name, model, provider })
    } catch (err) {
      return NextResponse.json(
        { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
        { status: 502 },
      )
    }
  }

  // Creating a profile is a different operation: it makes the profile, writes
  // its SOUL.md (1 prompt dari form, atau template per role), walks the
  // agent in, and returns a distinct shape so the UI can report what happened.
  if (action === 'create') {
    const role = (typeof body?.role === 'string' && body.role.trim() ? body.role.trim() : 'backend') as AgentRole
    const division = (
      typeof body?.division === 'string' && body.division.trim() ? body.division.trim() : undefined
    ) as AgentDivision | undefined
    const soul = typeof body?.soul === 'string' ? body.soul : ''
    try {
      const created = await createProfile(name, {
        description: String(body?.description || ''),
        role,
        division,
        soul,
      })
      // A brand-new profile carries no kill-list entry, so it appears on the next
      // poll — no need to touch membership.
      return NextResponse.json(
        {
          success: true,
          action,
          name: created.name,
          description: created.description,
          role: created.role,
          division: created.division,
          /** Preview soul yang tertulis (template atau prompt Jun). */
          soulPreview: soul.trim() || soulFor(created.role, created.name, created.division),
        },
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
    // `spawn` and `hide` accept anything the install knows, otherwise a typo would
    // create a hide-list entry matching nothing. `kill` must NOT go through this
    // check: a name with tasks but no profile is exactly the case it needs to
    // handle (the tasks still have to be removed), and the guard rejected it as
    // "tidak dikenal".
    if (action === 'spawn' || action === 'hide') {
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

    /* -------------------------------------------------------------- hide --- */
    // Membership only: the avatar leaves, the profile and its tasks are untouched.
    // This is the safe path, and the ONLY one offered for a name that has no
    // profile on disk but still owns tasks.
    if (action === 'hide') {
      const changed = hide(name)
      return NextResponse.json({
        success: true,
        action,
        name,
        /** false when the name was already hidden. */
        changed,
        hidden: hiddenNames(),
      })
    }

    /* -------------------------------------------------------------- kill --- */
    // `kill` DELETES the profile and purges its tasks. It is the destructive one;
    // hiding is the membership toggle above.
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
      show(name)
      return NextResponse.json({
        success: true,
        action,
        name,
        /** The profile no longer exists (false when it was already gone). */
        deleted: hasProfile,
        /** How many of its tasks were removed from the board. */
        purged,
        hidden: hiddenNames(),
      })
    }

    /* ------------------------------------------------------------- spawn --- */
    // A built-in exclusion cannot be undone. Answer honestly instead of reporting
    // `success: true, changed: false` — the caller would think the click worked.
    if (BUILTIN_HIDDEN.has(name)) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: `profil "${name}" adalah profil bawaan Hermes dan tidak bisa dimunculkan di kantor`,
            status: 400,
          },
        },
        { status: 400 },
      )
    }
    const changed = show(name)
    return NextResponse.json({
      success: true,
      action,
      name,
      /** false when the profile was already visible. */
      changed,
      hidden: hiddenNames(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
