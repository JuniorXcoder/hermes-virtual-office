/**
 * A2A helpers MURNI (tanpa node API) — boleh diimpor komponen client, route
 * server, dan selftest.
 *
 * Fakta produksi yang mendasari desain ini (bukan dugaan):
 * - `skills` di agent card 100% diturunkan dari NAMA TOOLSET + NAMA TOOL
 *   (`skills_from_toolsets` di plugins/platforms/a2a/protocol.py). Tidak ada
 *   tempat untuk tag bebas — jadi field "Keahlian/domain" TIDAK ditulis ke
 *   `skills`, melainkan disimpan di marker SOUL.md dan dipakai office untuk
 *   pemetaan domain→pemilik di sisi office sendiri.
 * - `description` di card adalah satu-satunya tempat kosakata domain hidup
 *   untuk discovery antar-agent.
 * - served-agent HARUS `local: false` supaya request dijawab profil itu
 *   sendiri, bukan sesi gateway umum (adapter.py `_prepare_task`).
 * - daftar served-agent cuma dibaca saat gateway boot → perubahan butuh
 *   restart gateway.
 */

/** Satu entri served-agent seperti yang dibaca `_load_served_agents`. */
export type ServedAgentEntry = {
  slug: string
  path: string
  profile: string
  name: string
  description: string
  tenant: string
  local: boolean
  advertised_toolsets: string[]
}

/** Normalisasi satu domain: kecil, spasi jadi `-`, buang karakter aneh. */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Pecah input freetext koma ("meta-ads, reporting, budget") jadi daftar
 * domain bersih. Duplikat dibuang, urutan pertama dipertahankan.
 */
export function parseDomains(raw: string | null | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of String(raw).split(',')) {
    const d = normalizeDomain(part)
    if (d && !seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }
  return out
}

/**
 * Pemilik sebuah domain: agent pertama (abjad) yang domainnya cocok persis
 * ATAU yang deskripsi agent-card-nya menyebut domain itu sebagai kata.
 * Null = tidak ada pemilik — pemanggil WAJIB menampilkan itu apa adanya,
 * jangan mengarang pemilik.
 */
export function ownerForDomain(
  domain: string,
  agents: { name: string; domains?: string[] | null; description?: string | null }[],
): string | null {
  const d = normalizeDomain(domain)
  if (!d) return null
  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name))
  for (const a of sorted) {
    if ((a.domains ?? []).map(normalizeDomain).includes(d)) return a.name
  }
  // Fallback: deskripsi card menyebut domain sebagai kata utuh.
  const word = new RegExp(`(^|[^a-z0-9-])${d.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9-]|$)`, 'i')
  for (const a of sorted) {
    if (a.description && word.test(a.description)) return a.name
  }
  return null
}

/** Peta domain→pemilik untuk sekumpulan domain. */
export function ownersForDomains(
  domains: string[],
  agents: { name: string; domains?: string[] | null; description?: string | null }[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const d of domains) out[d] = ownerForDomain(d, agents)
  return out
}

/**
 * Bangun entri served-agent untuk `platforms.a2a.agents`.
 * `local` SELALU false: true berarti request dijawab sesi gateway umum
 * (profil yang salah), bukan profil agent ini.
 */
export function buildServedAgentEntry(opts: {
  slug: string
  description: string
  advertisedToolsets?: string[]
}): ServedAgentEntry {
  const slug = opts.slug.trim().toLowerCase()
  return {
    slug,
    path: `/${slug}`,
    profile: slug,
    name: `Hermes ${slug}`,
    description: opts.description.trim().slice(0, 500) || `Hermes profile '${slug}' exposed over A2A.`,
    tenant: slug,
    local: false,
    advertised_toolsets: (opts.advertisedToolsets ?? []).map((t) => t.trim()).filter(Boolean),
  }
}
