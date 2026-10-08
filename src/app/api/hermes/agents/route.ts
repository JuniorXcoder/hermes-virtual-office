import { NextRequest, NextResponse } from 'next/server'
import {
  createProfile,
  deleteProfile,
  hermesHome,
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
import { parseDomains, ownersForDomains } from '@/lib/hermes/a2a'
import { listServedAgents, removeServedAgent, upsertServedAgent } from '@/lib/hermes/a2a-served'
import { gatewayStartMs, needsRestart } from '@/lib/hermes/doctor'
import { stat } from 'node:fs/promises'
import { deleteAvatar } from '@/lib/office/db'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { blockedAssigneesFor } from '@/lib/hermes/approvals'
import { agentPermissionSummary, checkAgentAction, type AgentActionKind } from '@/lib/hermes/control'
import { denyAudit } from '@/lib/hermes/audit'

export const dynamic = 'force-dynamic'

/**
 * SATU SUMBER KEBENARAN "butuh restart": mtime config.yaml vs start gateway —
 * pembanding yang SAMA dipakai doctor (SETUP-1), pop up, dan checklist A2A
 * Ready. null = tak bisa dipastikan (bukan "tidak butuh").
 */
async function readNeedsGatewayRestart(): Promise<boolean | null> {
  try {
    const mtime = (await stat(`${hermesHome()}/config.yaml`)).mtimeMs
    return needsRestart(mtime, await gatewayStartMs())
  } catch {
    return null
  }
}

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
    // Agent yang task aktifnya menunggu manusia tampil 'blocked', bukan 'working'.
    const blockedAgentIds = await blockedAssigneesFor(tasks)
    const agents = await listAgents(tasks, assignees, blockedAgentIds)
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
    // role/division/soul/domains dari listAgents (baca SOUL.md + fallback keyword).
    const agentMeta = new Map(agents.map((a) => [a.name, a]))
    const served = await listServedAgents().catch(() => [])
    const servedByProfile = new Map(served.map((s) => [s.profile, s]))
    // SATU SUMBER KEBENARAN "butuh restart" (lihat helper di atas): dipakai
    // pop up + checklist + panel Sistem, jangan hitung ulang di klien.
    let needsGatewayRestart: boolean | null = null
    needsGatewayRestart = await readNeedsGatewayRestart()
    // Peta domain→pemilik untuk jawaban jujur "siapa pegang X".
    const servedDesc = new Map(served.map((s) => [s.profile, s.description]))
    const domainAgents = agents.map((a) => ({
      name: a.name,
      domains: a.domains ?? [],
      description: servedDesc.get(a.name) ?? null,
    }))
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
        /** Keahlian/domain (dari marker SOUL.md; dipakai office, bukan A2A). */
        domains: agentMeta.get(name)?.domains ?? [],
        /**
         * Status A2A jujur: 'served' = terdaftar di platforms.a2a.agents,
         * 'unlisted' = profil ada tapi belum didaftarkan. Bukan "aktif" —
         * daftarnya baru berlaku setelah gateway di-restart.
         */
        a2a: servedByProfile.has(name) ? 'served' : profiles.includes(name) ? 'unlisted' : null,
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
      /** Batas izin per role (TAHAP 5.4), dari tabel tunggal di control.ts. */
      permissions: agentPermissionSummary(),
      /**
       * Pemetaan domain→pemilik (dipakai office, bukan A2A). Domain tanpa
       * pemilik bernilai null — TAMPILKAN apa adanya, jangan mengarang.
       */
      domainOwners: ownersForDomains(
        [...new Set(domainAgents.flatMap((a) => a.domains))],
        domainAgents,
      ),
      /**
       * Butuh restart gateway? boolean | null — SATU sumber kebenaran yang
       * sama dengan doctor (mtime config vs start gateway). null = tak bisa
       * dipastikan (UI tampilkan abu, bukan hijau).
       */
      needsGatewayRestart,
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
    action !== 'set-model' &&
    action !== 'serve' &&
    action !== 'unserve'
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: "action must be 'spawn', 'hide', 'kill', 'create', 'set-model', 'serve' or 'unserve'",
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

  // Atas nama agent (TAHAP 5.4): bila `onBehalfOf` ada, batas izin per role dinilai DULU dan
  // penolakannya dicatat di audit. Tanpa `onBehalfOf` (operator lewat UI), tidak ada yang
  // berubah. SELFREPAIR-1: serve/unserve operator-only (mengubah config gateway) —
  // permintaan atas nama agent DITOLAK eksplisit, bukan dipetakan ke izin lain.
  if (body?.onBehalfOf != null && (action === 'serve' || action === 'unserve')) {
    const ob = body.onBehalfOf as { agent?: unknown; role?: unknown }
    const agent = typeof ob?.agent === 'string' ? ob.agent.trim() : ''
    denyAudit(
      {
        at: new Date().toISOString(),
        action: `agent:${action}`,
        agent: agent || '(tanpa nama)',
        reason: `${action} "${name}" atas nama ${agent || '?'}`,
        effect: `permintaan agent untuk ${action} profil "${name}"`,
      },
      `hanya operator yang boleh ${action === 'serve' ? 'mendaftarkan' : 'mencabut'} entri A2A — mengubah config gateway bukan wewenang agent`,
    )
    return NextResponse.json(
      {
        error: {
          code: 'refused',
          message: `hanya operator yang boleh ${action === 'serve' ? 'mendaftarkan' : 'mencabut'} entri A2A — mengubah config gateway bukan wewenang agent`,
          status: 400,
        },
      },
      { status: 400 },
    )
  }
  if (body?.onBehalfOf != null) {
    const ob = body.onBehalfOf as { agent?: unknown; role?: unknown }
    const kind: AgentActionKind =
      action === 'kill' ? 'kill' : action === 'create' ? 'create' : action === 'set-model' ? 'setModel' : 'spawn'
    const agent = typeof ob?.agent === 'string' ? ob.agent.trim() : ''
    const role = (typeof ob?.role === 'string' ? ob.role.trim() : '') as AgentRole
    const verdict = checkAgentAction({ agent, role, action: kind, reason: body?.reason ? String(body.reason) : undefined })
    if (!verdict.allowed) {
      denyAudit(
        {
          at: new Date().toISOString(),
          action: `agent:${action}`,
          agent: agent || '(tanpa nama)',
          reason: `${action} "${name}" atas nama ${agent || '?'} (${role || '?'})`.slice(0, 300),
          effect: `permintaan agent untuk ${action} profil "${name}"`,
        },
        verdict.why,
      )
      return NextResponse.json(
        { error: { code: 'refused', message: verdict.why, status: 400 } },
        { status: 400 },
      )
    }
  }

  // The profile's default model: what its workers and chat turns run unless a task
  // pins its own (`hermes kanban set-model`).
  // SELFREPAIR-1 Celah 1: `serve` / `unserve` — daftarkan/cabut entri A2A untuk
  // profil yang sudah ada (memakai upsertServedAgent/removeServedAgent: backup
  // dulu, sunting bedah, local:false). Jujur: daftar served dibaca SEKALI saat
  // gateway boot — berlaku SETELAH restart, bukan langsung aktif.
  if (action === 'serve' || action === 'unserve') {
    try {
      const profiles = await listProfiles()
      if (!profiles.includes(name)) {
        return NextResponse.json(
          {
            error: {
              code: 'invalid_request',
              message: `profil "${name}" tidak dikenal — tidak ada profil di disk untuk ${action === 'serve' ? 'didaftarkan' : 'dicabut'}`,
              status: 400,
            },
          },
          { status: 400 },
        )
      }
      if (action === 'serve') {
        // Deskripsi dari entri served SEBELUMNYA bila ada (upsert menimpa).
        // null = profil tanpa entri sebelumnya — fallback generik saja.
        const prev = (await listServedAgents().catch(() => [])).find((s) => s.profile === name)
        await upsertServedAgent({
          slug: name,
          description: prev?.description || `Hermes profile '${name}' exposed over A2A.`,
          advertisedToolsets: prev?.advertised_toolsets ?? [],
        })
      } else {
        await removeServedAgent(name)
      }
      return NextResponse.json({
        success: true,
        action,
        name,
        a2aNote:
          action === 'serve'
            ? 'Terdaftar. Berlaku setelah gateway di-restart — sampai itu, agent belum bisa dipanggil.'
            : 'Tercabut dari config. Berlaku setelah gateway di-restart — sampai itu, path A2A-nya masih dijawab.',
        needsGatewayRestart: await readNeedsGatewayRestart(),
      })
    } catch (err) {
      return NextResponse.json(
        { error: { code: 'action_failed', message: (err as Error).message, status: 502 } },
        { status: 502 },
      )
    }
  }
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
    // Keahlian/domain: freetext koma dari form → ternormalisasi di createProfile.
    // Disimpan di marker SOUL.md (dipakai office), TIDAK diumumkan ke A2A.
    const domains = Array.isArray(body?.domains)
      ? (body.domains as unknown[]).map((d) => String(d ?? '')).filter((d) => d.trim())
      : typeof body?.domains === 'string'
        ? [body.domains]
        : []
    // Toolset yang diumumkan di agent card: HARUS nama toolset nyata Hermes
    // (bukan tag bebas — card hanya bisa berisi itu). Kosong = semua toolset.
    const advertisedToolsets = Array.isArray(body?.advertisedToolsets)
      ? (body.advertisedToolsets as unknown[]).map((t) => String(t ?? '').trim()).filter(Boolean)
      : []
    // Toggle A2A: default NYALA (permintaan operator eksplisit: spawn dari mana
    // pun harus langsung A2A). Mati hanya bila klien mengirim serveA2a:false
    // eksplisit. Default di SISI SERVER supaya jalur baru (avatar, dst) yang
    // lupa mengirim flag tidak mengulangi bug "kok gak masuk".
    // Hidup = daftarkan served-agent (local:false). Mati = jangan sentuh config.
    const serveA2a = body?.serveA2a !== false
    // Model pilihan operator saat membuat. Kosong = jangan sentuh config profil sama
    // sekali, supaya agent baru ikut bawaan Hermes, bukan dipaksa ke satu model.
    const model = body?.model == null ? '' : String(body.model).trim()
    const provider = body?.provider == null ? null : String(body.provider).trim() || null
    try {
      const created = await createProfile(name, {
        description: String(body?.description || ''),
        role,
        division,
        soul,
        domains,
      })
      // Diset SETELAH profil ada (createProfile yang gagal sudah lempar ke catch di bawah,
      // jadi tidak ada model yang tertulis untuk profil yang tidak jadi). Kalau langkah ini
      // gagal, profilnya tetap sudah ada — membatalkan create demi model justru membuang
      // kerja operator. Maka balasannya tetap 201, tapi jujur: model tidak terpasang dan
      // agent berjalan dengan bawaan Hermes sampai di-set ulang dari panel Agent.
      let modelApplied: string | null = null
      let providerApplied: string | null = null
      let modelError: string | null = null
      if (model) {
        try {
          await setProfileModel(created.name, model, provider)
          modelApplied = model
          providerApplied = provider
        } catch (err) {
          modelError = (err as Error).message
        }
      }
      // A brand-new profile carries no kill-list entry, so it appears on the next
      // poll — no need to touch membership.
      // Toggle A2A hidup: daftarkan served-agent (backup config dulu). Gagal di
      // sini TIDAK membatalkan profil — dilaporkan jujur supaya operator tahu
      // profilnya ada tapi belum terdaftar A2A.
      let a2aRegistered: boolean | null = null
      let a2aError: string | null = null
      if (serveA2a) {
        try {
          await upsertServedAgent({
            slug: created.name,
            description: created.description,
            advertisedToolsets,
          })
          a2aRegistered = true
        } catch (err) {
          a2aRegistered = false
          a2aError = (err as Error).message
        }
      }
      return NextResponse.json(
        {
          success: true,
          action,
          name: created.name,
          description: created.description,
          role: created.role,
          division: created.division,
          domains: created.domains,
          /** Preview soul yang tertulis (template atau prompt Jun). */
          soulPreview: soul.trim() || soulFor(created.role, created.name, created.division, created.domains),
          /** Model yang BENAR-BENAR terpasang; null = bawaan Hermes. */
          model: modelApplied,
          provider: providerApplied,
          /** Model yang diminta tapi gagal dipasang (profil tetap dibuat). */
          modelRequested: model || null,
          modelError,
          /**
           * Toggle A2A: null = Mati eksplisit (serveA2a:false — config tidak
           * disentuh). true = terdaftar; false+gagal = pendaftaran gagal.
           */
          a2aRegistered,
          a2aError,
          /**
           * Jujur soal arti "terdaftar": daftar served-agent baru berlaku
           * setelah gateway di-restart — bukan langsung aktif.
           */
          a2aNote:
            a2aRegistered === true
              ? 'Tersimpan. Berlaku setelah gateway di-restart — sampai itu, agent belum bisa dipanggil.'
              : null,
          /**
           * Keadaan "butuh restart" SESUDAH tulis ini — SATU sumber kebenaran
           * yang sama dengan doctor. Pop up memakainya: tidak menghitung ulang.
           */
          needsGatewayRestart: await readNeedsGatewayRestart(),
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
      // KILL-BERSIH-1: kill = hapus juga dari kantor. Tiga pembersihan di
      // bawah ini TIDAK membatalkan kill bila gagal — profilnya sudah
      // terhapus, jadi kegagalan di sini dilaporkan jujur (bukan 502).
      // 1. Cabut entri A2A (tidak terdaftar = hasil sah, bukan error).
      let a2aRemoved: boolean | null = null
      let a2aError: string | null = null
      try {
        a2aRemoved = (await removeServedAgent(name)).removed
      } catch (err) {
        a2aRemoved = false
        a2aError = (err as Error).message
      }
      // 2. Hapus baris avatar `agent:<nama>` — badannya keluar dari kantor
      // (scene menandai yang hilang sebagai leaving, lalu despawn di pintu).
      const avatarRemoved = deleteAvatar(`agent:${name}`)
      // 3. Bersihkan sisa direktori profil yang ditinggalkan
      // `hermes profile delete` (tombstone + cache). deleteProfile di atas
      // sudah menghapus profilnya; yang dibersihkan di sini hanyalah sisa
      // yang membuat direktori `profiles/<nama>/` masih terlihat ada.
      // Jujur: bila direktori sudah tidak ada, tidak ada yang dibersihkan
      // (false), bukan klaim. rm force:true tidak error untuk yang hilang,
      // jadi keberadaan dicek dulu lewat readdir.
      let dirRemoved = false
      let dirError: string | null = null
      try {
        const { hermesHome } = await import('@/lib/hermes/kanban')
        const dir = path.join(hermesHome(), 'profiles', name)
        const entries = await readdir(dir).catch(() => null)
        if (entries !== null) {
          await rm(dir, { recursive: true, force: true })
          dirRemoved = true
        }
      } catch (err) {
        dirError = (err as Error).message
      }
      return NextResponse.json({
        success: true,
        action,
        name,
        /** The profile no longer exists (false when it was already gone). */
        deleted: hasProfile,
        /** How many of its tasks were removed from the board. */
        purged,
        /** Entri A2A tercabut? null = langkah dilewati (profil tak ada dari awal). */
        a2aRemoved: hasProfile ? a2aRemoved : null,
        a2aError,
        /** Baris avatar `agent:<nama>` terhapus dari kantor? */
        avatarRemoved,
        /** Sisa direktori `profiles/<nama>/` dibersihkan? */
        dirRemoved,
        /** Gagal membersihkan sisa direktori (null = tidak ada kegagalan). */
        dirError,
        /**
         * Jujur soal waktu berlaku: daftar served-agent dibaca SEKALI saat
         * gateway boot — pencabutan baru berlaku setelah gateway di-restart.
         * Sampai itu, path A2A-nya masih dijawab server yang sedang jalan.
         */
        a2aNote:
          a2aRemoved === true
            ? 'Tercabut dari config. Berlaku setelah gateway di-restart — sampai itu, path A2A-nya masih dijawab.'
            : null,
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
