/**
 * SELFREPAIR-1 — aplikasi memperbaiki keadaan rusaknya sendiri.
 *
 * Prinsip operator: setiap perbaikan yang harus dilakukan manual di host
 * (config gateway, DB kantor, config profil) adalah SATU bug yang ditinggal
 * di kode. Modul ini mengumpulkan semua perbaikan itu di satu tempat:
 * pratinjau dulu (apa yang akan diubah + apa yang tak bisa), jalankan
 * (pakai penulis yang sudah ada, backup sebelum menulis), laporkan
 * (apa yang berubah + apa yang tak bisa beserta sebabnya).
 *
 * Aturan jujur: null bila tak ada pemilik · "tak terbaca" bila gagal dibaca ·
 * "tidak bisa dipastikan" bila tak bisa dipastikan · label BASI. Tak ada jalur
 * yang menelan error jadi sukses. Idempoten: dua kali jalan tak merusak apa pun.
 */

import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  classifyProviderScope,
} from './doctor'
import {
  ensureA2aPeer,
  ensureA2aToolset,
  ensureProviderDef,
  hermesHome,
  listA2aPeers,
  listProfiles,
  peerEntryUrl,
  peerKeyFor,
  profileCustomProviders,
  profileModel,
  profileToolsets,
} from './kanban'
import { listServedAgents, removeServedAgent } from './a2a-served'
import { deleteAvatar, listAvatars } from '../office/db'

export type RepairKind =
  | 'staleServed'
  | 'deadAvatar'
  | 'dupAvatar'
  | 'strayProfileDir'
  | 'danglingProvider'
  | 'missingA2aToolset'
  | 'missingA2aPeer'

export type RepairPreviewItem = {
  kind: RepairKind
  /** Nama profil/agent yang disasar. */
  target: string
  /** Kalimat jujur: apa yang akan dilakukan. */
  what: string
}

export type RepairPreview = {
  /** Yang akan diubah bila operator menekan jalankan. */
  planned: RepairPreviewItem[]
  /** Yang rusak tapi modul ini tak bisa memperbaiki + sebabnya. */
  unfixable: { target: string; why: string }[]
}

export type RepairResult = {
  a2aRemoved: string[]
  avatarRemoved: string[]
  /** Baris avatar dobel yang digabung → id kanonik yang tersisa. */
  avatarMerged: { agent: string; kept: string; dropped: string[] }[]
  /** Toolset a2a ditambahkan ke profil yang sudah ada. */
  toolsetAdded: string[]
  /** Peer `<nama>-local` didaftarkan ke a2a_agents. */
  peerAdded: string[]
  /** Definisi provider disalin ke scope profil. */
  providerFixed: string[]
  /** Sisa direktori profiles/<nama>/ yang dibersihkan. */
  dirsRemoved: string[]
  /** Yang gagal + sebab nyata (bukan "gagal" polos). */
  failed: { target: string; why: string }[]
  /** Yang rusak tapi tak bisa diperbaiki modul ini + sebabnya. */
  unfixable: { target: string; why: string }[]
}

/**
 * Baris avatar ganda untuk satu agent: nama yang sama muncul di >1 baris.
 * Kembalikan peta nama → daftar baris (hanya yang ganda).
 */
export function findDuplicateAvatars(
  rows: { avatarId: string; name: string }[],
): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const r of rows) {
    const key = r.name.trim().toLowerCase()
    if (!key) continue
    const list = byName.get(key) ?? []
    list.push(r.avatarId)
    byName.set(key, list)
  }
  const out = new Map<string, string[]>()
  for (const [name, ids] of byName) {
    if (ids.length > 1) out.set(name, ids)
  }
  return out
}

/**
 * Pilih baris yang dipertahankan dari grup ganda: id kanonik agent menang
 * (itu yang dihapus aksi kill); bila tak ada, baris pertama (stabil).
 */
export function pickCanonicalAvatar(agent: string, ids: string[]): { kept: string; dropped: string[] } {
  const canon = `agent:${agent.trim().toLowerCase()}`
  if (ids.includes(canon)) {
    return { kept: canon, dropped: ids.filter((i) => i !== canon) }
  }
  return { kept: ids[0], dropped: ids.slice(1) }
}

/**
 * Slot dummy SAH milik roster kantor (bukan mayat): id pola roster
 * (`dummy:<divisi>:<index>` / `dummy:lobby:reception`, lihat dummy-roster.ts).
 * Tanpa filter ini, SELURUH kursi kosong kantor disapu sebagai "mayat" —
 * kind=dummy + spawned=false juga berlaku untuk slot sah.
 */
export function isRosterSlotId(avatarId: string): boolean {
  const id = avatarId.trim()
  if (id === 'dummy:lobby:reception') return true
  return /^dummy:(tech|growth|content|exec):\d+$/.test(id)
}

/** Nama placeholder roster (kursi kosong, bukan agent): Dev Manager, dst. */
const ROSTER_PLACEHOLDER_NAMES = new Set(
  [
    'dev manager',
    'dev staff 1',
    'dev staff 2',
    'mkt manager',
    'mkt staff 1',
    'mkt staff 2',
    'content manager',
    'content staff 1',
    'content staff 2',
    'exec manager',
    'exec staff 1',
    'exec staff 2',
    'resepsionis',
  ],
)

/**
 * Kursi kosong yang hidup: id pola roster + nama placeholder + dummy + belum
 * spawn. Mayat = dummy tak-spawn yang BUKAN ini (nama mirip agent tapi profilnya
 * sudah tiada) — mis. sisa dialog spawn yang bikin baris baru.
 */
export function isLiveSlot(row: { avatarId: string; name: string; kind: string; spawned: boolean }): boolean {
  return (
    row.kind === 'dummy' &&
    !row.spawned &&
    isRosterSlotId(row.avatarId) &&
    ROSTER_PLACEHOLDER_NAMES.has(row.name.trim().toLowerCase())
  )
}

/** Keadaan rusak saat ini: baca saja, tanpa mengubah apa pun. */
export async function previewRepairs(): Promise<RepairPreview> {
  const planned: RepairPreviewItem[] = []
  const unfixable: { target: string; why: string }[] = []

  const profiles = await listProfiles().catch(() => null)
  if (profiles === null) {
    return { planned, unfixable: [{ target: '(daftar profil)', why: 'tidak bisa dipastikan — daftar profil gagal dibaca' }] }
  }
  const have = new Set(profiles.map((p) => p.trim().toLowerCase()))

  // 1. Entri served basi (profilnya sudah tiada).
  try {
    const served = await listServedAgents()
    for (const s of served) {
      if (!have.has(s.profile.trim().toLowerCase())) {
        planned.push({
          kind: 'staleServed',
          target: s.profile,
          what: `cabut entri served BASI "${s.profile}" (profil hilang)`,
        })
      }
    }
  } catch {
    unfixable.push({ target: '(daftar served)', why: 'tak terbaca — entri basi tidak bisa dipastikan' })
  }

  // 2+3. Baris avatar mayat + ganda (DB kantor sendiri — selalu terbaca lokal).
  // Mayat = dummy tak-spawn yang BUKAN kursi roster hidup: nama tanpa profil
  // TAPI id/nama pola roster + placeholder = kursi kosong sah, JANGAN disapu.
  try {
    const rows = listAvatars()
    for (const r of rows) {
      const key = r.name.trim().toLowerCase()
      if (key && !have.has(key) && r.kind === 'dummy' && !r.spawned && !isLiveSlot(r)) {
        planned.push({
          kind: 'deadAvatar',
          target: r.avatarId,
          what: `hapus baris avatar mayat "${r.avatarId}" (agent "${r.name}" tanpa profil)`,
        })
      }
    }
    for (const [name, ids] of findDuplicateAvatars(rows.map((r) => ({ avatarId: r.avatarId, name: r.name })))) {
      // Baris mayat yang ikut terencana hapus jangan dihitung ganda juga.
      const live = ids.filter((id) => !planned.some((p) => p.kind === 'deadAvatar' && p.target === id))
      if (live.length > 1) {
        const { kept } = pickCanonicalAvatar(name, live)
        planned.push({
          kind: 'dupAvatar',
          target: name,
          what: `gabung ${live.length} baris "${name}" → sisakan "${kept}"`,
        })
      }
    }
  } catch (err) {
    unfixable.push({ target: '(avatar kantor)', why: `tak terbaca — ${(err as Error).message.slice(0, 160)}` })
  }

  // 4. Sisa direktori profiles/<nama>/ tanpa profil. Syarat KETAT (kriteria
  // listProfiles = direktori berisi config.yaml): `.deleted` = tombstone resmi
  // Hermes — JANGAN disentuh; direktori yang MASIH berisi config.yaml = profil
  // (walau listProfiles gagal membacanya) — JANGAN disapu, laporkan unfixable.
  try {
    const dir = path.join(hermesHome(), 'profiles')
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries) {
      for (const e of entries) {
        if (!e.isDirectory()) continue
        if (e.name === '.deleted') continue
        if (have.has(e.name.trim().toLowerCase())) continue
        const { access } = await import('node:fs/promises')
        let hasConfig = false
        try {
          await access(path.join(dir, e.name, 'config.yaml'))
          hasConfig = true
        } catch {
          hasConfig = false
        }
        if (hasConfig) {
          unfixable.push({ target: e.name, why: 'direktori masih berisi config.yaml — bukan sisa, tak dibersihkan' })
          continue
        }
        planned.push({
          kind: 'strayProfileDir',
          target: e.name,
          what: `bersihkan sisa direktori profiles/${e.name}/ (tanpa profil, tanpa config.yaml)`,
        })
      }
    }
  } catch (err) {
    unfixable.push({ target: '(direktori profil)', why: `tak terbaca — ${(err as Error).message.slice(0, 160)}` })
  }

  // 5+6+7. Per profil: provider menggantung + toolset a2a hilang + peer hilang.
  // Klasifikasi A2A-CALL-1 (koreksi operator): tools=[] (kunci tak ada/kosong)
  // = TERBACA tak-bisa-memanggil → planned; tools=null (baca gagal) = unknown.
  const checks = await Promise.all(
    profiles.map(async (p) => ({
      p,
      model: await profileModel(p).catch(() => null),
      defs: await profileCustomProviders(p).catch(() => null),
      tools: await profileToolsets(p).catch(() => null),
    })),
  )
  for (const c of checks) {
    if (c.model && c.model.provider) {
      const verdict = classifyProviderScope(c.model.provider, c.defs ?? null)
      if (verdict === 'dangling') {
        planned.push({
          kind: 'danglingProvider',
          target: c.p,
          what: `salin definisi provider "${c.model.provider.trim()}" dari config global ke profil "${c.p}"`,
        })
      } else if (verdict === 'unknown') {
        unfixable.push({ target: c.p, why: 'tidak bisa dipastikan — definisi provider tak terbaca' })
      }
    }
    if (c.tools !== null && !c.tools.some((t) => String(t).trim().toLowerCase() === 'a2a')) {
      planned.push({
        kind: 'missingA2aToolset',
        target: c.p,
        what:
          c.tools.length === 0
            ? `tambahkan toolset "a2a" ke profil "${c.p}" (kunci platform_toolsets tidak ada — bisa dipanggil, tak bisa memanggil)`
            : `tambahkan toolset "a2a" ke platform_toolsets.cli profil "${c.p}" (bisa dipanggil, tak bisa memanggil)`,
      })
    } else if (c.tools === null) {
      unfixable.push({ target: c.p, why: 'tidak bisa dipastikan — platform_toolsets gagal dibaca (bukan sekadar tak ada)' })
    }
  }

  // 7. Peer hilang: tiap profil yang di-serve WAJIB punya
  // `a2a_agents.<slug>-local` supaya namanya resolvable (sebab-2 RAPAT-A2A-2).
  // Daftar peer tak terbaca = unfixable (unknown), bukan planned.
  try {
    const served = await listServedAgents()
    const peers = await listA2aPeers()
    if (peers === null) {
      unfixable.push({ target: '(daftar peer a2a_agents)', why: 'tak terbaca — peer hilang tidak bisa dipastikan' })
    } else {
      const { samePeerUrl, listProfilePeers } = await import('./kanban')
      for (const s of served) {
        const key = peerKeyFor(s.profile)
        const want = peerEntryUrl(s.profile)
        const got = peers[key]?.url ? String(peers[key].url) : ''
        if (!got || !samePeerUrl(got, want)) {
          planned.push({
            kind: 'missingA2aPeer',
            target: s.profile,
            what: `daftarkan peer "${key}" → ${want} (nama agent bisa diresolusi a2a_call)`,
          })
        }
      }
      // 7b. Peer PROFIL: tiap served WAJIB ada di scope profil served LAIN —
      // gate tool Hermes baca scope profil (mkt-1 tanpa peer profil = tool
      // a2a_call tak muncul meski toolset a2a ada + peer global ada).
      const profPeers = await Promise.all(
        served.map(async (s) => ({ s, mine: await listProfilePeers(s.profile).catch(() => null) })),
      )
      for (const pp of profPeers) {
        if (pp.mine === null) {
          unfixable.push({ target: pp.s.profile, why: 'tidak bisa dipastikan — peer profil gagal dibaca (bukan sekadar tak ada)' })
          continue
        }
        for (const t of served) {
          if (t.profile.toLowerCase() === pp.s.profile.toLowerCase()) continue
          const key = peerKeyFor(t.profile)
          const want = peerEntryUrl(t.profile)
          const got = pp.mine[key]?.url ? String(pp.mine[key].url) : ''
          if (!got || !samePeerUrl(got, want)) {
            planned.push({
              kind: 'missingA2aPeer',
              target: `${pp.s.profile}→${t.profile}`,
              what: `tulis peer "${key}" → ${want} di profil "${pp.s.profile}" (gate tool a2a_call scope-profil)`,
            })
          }
        }
      }
    }
  } catch {
    unfixable.push({ target: '(daftar peer a2a_agents)', why: 'tak terbaca — peer hilang tidak bisa dipastikan' })
  }

  return { planned, unfixable }
}

/**
 * Jalankan semua perbaikan yang terpratinjau. Tiap langkah pakai penulis yang
 * sudah ada (removeServedAgent, deleteAvatar, ensureA2aToolset, rm) dan dilaporkan jujur.
 * Idempoten: keadaan sehat → tak ada yang berubah.
 */
export async function runRepairs(): Promise<RepairResult> {
  const res: RepairResult = {
    a2aRemoved: [],
    avatarRemoved: [],
    avatarMerged: [],
    toolsetAdded: [],
    peerAdded: [],
    providerFixed: [],
    dirsRemoved: [],
    failed: [],
    unfixable: [],
  }
  const preview = await previewRepairs()
  res.unfixable = preview.unfixable

  for (const item of preview.planned) {
    try {
      switch (item.kind) {
        case 'staleServed': {
          const r = await removeServedAgent(item.target)
          if (r.removed) res.a2aRemoved.push(item.target)
          break
        }
        case 'deadAvatar': {
          if (deleteAvatar(item.target)) res.avatarRemoved.push(item.target)
          break
        }
        case 'dupAvatar': {
          // Baca ulang: baris mayat mungkin sudah terhapus di iterasi sebelumnya.
          const rows = listAvatars().filter(
            (r) => r.name.trim().toLowerCase() === item.target.trim().toLowerCase(),
          )
          const ids = rows.map((r) => r.avatarId)
          if (ids.length < 2) break // sudah sehat (mayatnya yang ganda)
          const { kept, dropped } = pickCanonicalAvatar(item.target, ids)
          // Adopsi posisi baris lain: pindahkan kanonik ke posisi baris pertama
          // yang dibuang (posisi terlihat operator), lalu buang sisanya.
          const { officeDb } = await import('../office/db')
          const donor = rows.find((r) => r.avatarId === dropped[0])
          if (donor) {
            officeDb()
              .prepare(`UPDATE avatar_state SET x = ?, z = ?, level = ? WHERE avatar_id = ?`)
              .run(donor.x, donor.z, donor.level, kept)
          }
          for (const d of dropped) {
            if (deleteAvatar(d)) res.avatarRemoved.push(d)
          }
          res.avatarMerged.push({ agent: item.target, kept, dropped })
          break
        }
        case 'strayProfileDir': {
          // Verifikasi ulang SEBELUM rm: direktori + tanpa config.yaml harus
          // masih benar saat eksekusi (bukan saat pratinjau). `.deleted`
          // dan yang berisi config.yaml = JANGAN sentuh (lewati diam-diam —
          // keadaan berubah di tengah jalan, bukan kegagalan).
          if (item.target === '.deleted') break
          const dir = path.join(hermesHome(), 'profiles', item.target)
          const { access } = await import('node:fs/promises')
          try {
            await access(path.join(dir, 'config.yaml'))
            break // config.yaml muncul di tengah jalan = profil, jangan sapu
          } catch {
            // memang tanpa config.yaml — lanjut
          }
          const entries = await readdir(dir).catch(() => null)
          if (entries === null) break // sudah hilang di tengah jalan
          await rm(dir, { recursive: true, force: true })
          res.dirsRemoved.push(item.target)
          break
        }
        case 'danglingProvider': {
          const m = await profileModel(item.target).catch(() => null)
          if (!m?.provider) break
          if (classifyProviderScope(m.provider, await profileCustomProviders(item.target).catch(() => null)) !== 'dangling') break
          await ensureProviderDef(item.target, m.provider)
          res.providerFixed.push(item.target)
          break
        }
        case 'missingA2aToolset': {
          const r = await ensureA2aToolset(item.target)
          if (r.added) res.toolsetAdded.push(item.target)
          break
        }
        case 'missingA2aPeer': {
          // Target "a→b" = peer profil; target polos = peer global (+ profil served lain).
          const arrow = item.target.indexOf('→')
          if (arrow > 0) {
            const caller = item.target.slice(0, arrow)
            const tgt = item.target.slice(arrow + 1)
            const r = await ensureA2aPeer(tgt, [caller])
            if (r.profileAdded.length) res.peerAdded.push(item.target)
          } else {
            const servedNow = await listServedAgents().catch(() => [])
            const others = servedNow.map((s) => s.profile).filter((p) => p.toLowerCase() !== item.target.toLowerCase())
            const r = await ensureA2aPeer(item.target, others)
            if (r.added || r.profileAdded.length) res.peerAdded.push(item.target)
          }
          break
        }
      }
    } catch (err) {
      res.failed.push({ target: item.target, why: (err as Error).message.slice(0, 300) })
    }
  }
  return res
}
