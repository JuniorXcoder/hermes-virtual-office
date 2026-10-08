/**
 * Served-agent A2A: baca/tulis `platforms.a2a.agents` di config gateway.
 *
 * Server-side saja ('node:...'). Ditulis TANPA dep YAML: entri hanya berisi
 * string/boolean/array-string sederhana, jadi serialisasi manual cukup dan
 * tidak ada parser pihak ketiga yang bisa merusak kunci lain.
 *
 * Aturan tulis:
 * - Backup file config dulu (timestamp), baru tulis.
 * - Blok `platforms:` lain + SELURUH kunci top-level lain dipertahankan
 *   byte-per-byte (file dipotong hanya di dalam blok daftar a2a agents).
 * - Toggle mati = jangan sentuh config sama sekali (pemanggil yang menjamin).
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hermesHome } from './kanban'
import { buildServedAgentEntry, type ServedAgentEntry } from './a2a'

/** Override utk selftest: baca/tulis file lain, bukan config gateway asli. */
let configPathOverride: string | null = null
export function setServedAgentsConfigPath(p: string | null) {
  configPathOverride = p
}
function configPath(): string {
  return configPathOverride ?? path.join(hermesHome(), 'config.yaml')
}

function yamlScalar(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function yamlLine(indent: number, key: string, v: string | string[] | boolean): string {
  const pad = ' '.repeat(indent)
  if (typeof v === 'boolean') return `${pad}${key}: ${v ? 'true' : 'false'}`
  if (Array.isArray(v)) {
    if (!v.length) return `${pad}${key}: []`
    // Item list 2 spasi lebih dalam dari kunci (sesuai `hermes config set`).
    return `${pad}${key}:\n` + v.map((s) => `${pad}  - ${yamlScalar(s)}`).join('\n')
  }
  return `${pad}${key}: ${yamlScalar(v)}`
}

function entryToYaml(e: ServedAgentEntry): string {
  return [
    `      - ${`slug: ${yamlScalar(e.slug)}`}`,
    yamlLine(8, 'path', e.path),
    yamlLine(8, 'profile', e.profile),
    yamlLine(8, 'name', e.name),
    yamlLine(8, 'description', e.description),
    yamlLine(8, 'tenant', e.tenant),
    yamlLine(8, 'local', e.local),
    yamlLine(8, 'advertised_toolsets', e.advertised_toolsets),
  ].join('\n')
}

/**
 * Daftar served-agent yang sekarang terdaftar (`platforms.a2a.agents`).
 * Kosong bila belum ada — BUKAN error: "belum terdaftar" adalah jawaban jujur.
 */
export async function listServedAgents(): Promise<ServedAgentEntry[]> {
  const raw = await readFile(configPath(), 'utf8')
  const m = /^([ ]{4})agents:\s*(.*)$/m.exec(raw)
  if (!m) return []
  const rest = m[2].trim()
  if (rest === '[]') return []
  const out: ServedAgentEntry[] = []
  // Bentuk slug dikutip (`- slug: 'x'`, tulisan office) maupun polos
  // (`- slug: x`, tulisan `hermes config set`) — dua-duanya dibaca.
  const itemRe = /^      - slug: (?:'(.*)'|(\S+))$/gm
  let hit: RegExpExecArray | null
  while ((hit = itemRe.exec(raw))) {
    const slug = (hit[1] ?? hit[2]).replace(/''/g, "'")
    const nextAt = raw.indexOf('\n      - slug:', hit.index + 1)
    const block = raw.slice(hit.index, nextAt < 0 ? undefined : nextAt)
    const get = (k: string) => {
      const r = new RegExp(`^        ${k}: (.*)$`, 'm').exec(block)
      if (!r) return ''
      const v = r[1].trim()
      if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'")
      return v
    }
    const tools: string[] = []
    const tLine = /^        advertised_toolsets:(.*)$/m.exec(block)
    if (tLine) {
      const inline = tLine[1].trim()
      if (inline === '[]') {
        // kosong — tidak ada toolset yang dibatasi = umumkan semua
      } else if (inline.startsWith('[')) {
        for (const part of inline.slice(1, inline.lastIndexOf(']')).split(',')) {
          const v = part.trim().replace(/^'(.*)'$/, '$1').replace(/''/g, "'")
          if (v) tools.push(v)
        }
      } else {
        // Baris kunci tanpa nilai inline = daftar multi-baris di bawahnya
        // (indent 10 spasi — 8 key + 2 list, sesuai tulisan `hermes config set`).
        // Bentuk `- terminal` polos maupun `- 'terminal'` dikutip dibaca.
        const tBlock = /advertised_toolsets:\n((?:          - .*\n?)*)/.exec(block)
        if (tBlock) {
          for (const line of tBlock[1].split('\n')) {
            const tm = /^          - (?:'(.*)'|(\S+))$/.exec(line.trimEnd())
            if (tm) tools.push((tm[1] ?? tm[2]).replace(/''/g, "'"))
          }
        }
      }
    }
    out.push({
      slug,
      path: get('path'),
      profile: get('profile'),
      name: get('name'),
      description: get('description'),
      tenant: get('tenant'),
      local: get('local') === 'true' || get('local') === 'True',
      advertised_toolsets: tools,
    })
  }
  void rest
  return out
}

/**
 * Tulis (atau perbarui) SATU entri served-agent. Mengembalikan path backup.
 *
 * - `local` SELALU false (lihat buildServedAgentEntry).
 * - Entri dengan slug sama ditimpa; yang lain dipertahankan apa adanya.
 */
export async function upsertServedAgent(opts: {
  slug: string
  description: string
  advertisedToolsets?: string[]
}): Promise<{ backupPath: string; entry: ServedAgentEntry }> {
  const cfgPath = configPath()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${cfgPath}.bak-a2a3-${stamp}`
  await copyFile(cfgPath, backupPath)
  const entry = buildServedAgentEntry(opts)
  const raw = await readFile(cfgPath, 'utf8')
  const lines = raw.split('\n')
  // Cari blok daftar di bawah `    agents:` dalam konteks `platforms:` → `a2a:`.
  let agentsIdx = -1
  let inPlatforms = false
  let inA2a = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^platforms:\s*$/.test(line)) {
      inPlatforms = true
      inA2a = false
      continue
    }
    if (inPlatforms && /^[a-z_]+:\s*(.*)$/.test(line) && !/^\s/.test(line)) {
      inPlatforms = false
      inA2a = false
      continue
    }
    if (inPlatforms && /^  a2a:\s*$/.test(line)) {
      inA2a = true
      continue
    }
    if (inA2a && /^  [a-z_]+:\s*$/.test(line)) {
      inA2a = false
      continue
    }
    if (inA2a && /^    agents:\s*(\[\])?\s*$/.test(line)) {
      agentsIdx = i
      break
    }
  }
  const entryLines = entryToYaml(entry).split('\n')
  if (agentsIdx < 0) {
    // Belum ada blok agents: sisipkan di bawah `  a2a:` bila ada, kalau tidak
    // tambahkan blok platforms/a2a baru di akhir (tanpa menyentuh yang lain).
    const a2aIdx = lines.findIndex((l) => /^  a2a:\s*$/.test(l))
    if (a2aIdx >= 0) {
      lines.splice(a2aIdx + 1, 0, '    agents:', ...entryLines)
    } else {
      const platIdx = lines.findIndex((l) => /^platforms:\s*$/.test(l))
      if (platIdx >= 0) {
        lines.splice(platIdx + 1, 0, '  a2a:', '    agents:', ...entryLines)
      } else {
        lines.push('platforms:', '  a2a:', '    agents:', ...entryLines)
      }
    }
  } else {
    // Ganti entri slug-sama bila ada, selain itu sisipkan di akhir daftar.
    const headerLine = lines[agentsIdx]
    if (/\[\]/.test(headerLine)) {
      lines.splice(agentsIdx + 1, 0, ...entryLines)
    } else {
      let insertAt = agentsIdx + 1
      let foundAt = -1
      let foundEnd = -1
      let i = agentsIdx + 1
      while (i < lines.length && (/^      - slug:/.test(lines[i]) || /^        /.test(lines[i]) || lines[i].trim() === '')) {
        if (lines[i].startsWith('      - slug:')) {
          const slugM = /^      - slug: '(.*)'$/.exec(lines[i])
          let j = i + 1
          while (j < lines.length && /^        /.test(lines[j])) j++
          if (slugM && slugM[1].replace(/''/g, "'") === entry.slug) {
            foundAt = i
            foundEnd = j
            break
          }
          i = j
          insertAt = j
          continue
        }
        i++
      }
      if (foundAt >= 0) {
        lines.splice(foundAt, foundEnd - foundAt, ...entryLines)
      } else {
        lines.splice(insertAt, 0, ...entryLines)
      }
    }
  }
  await writeFile(cfgPath, lines.join('\n'), 'utf8')
  return { backupPath, entry }
}

/**
 * Cabut SATU entri served-agent dari `platforms.a2a.agents`.
 *
 * Aturan tulis SAMA dengan upsert: backup dulu, blok lain byte-per-byte.
 * Nama yang tidak terdaftar = bukan error: mengembalikan removed:false
 * (""tidak ada yang dicabut"" adalah hasil yang sah).
 *
 * Serupa upsert, pencocokan slug menerima bentuk dikutip (`- slug: 'x'`,
 * tulisan office) maupun polos (`- slug: x`, tulisan `hermes config set`).
 */
export async function removeServedAgent(slug: string): Promise<{ backupPath: string; removed: boolean }> {
  const clean = slug.trim().toLowerCase()
  const cfgPath = configPath()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${cfgPath}.bak-a2a3-${stamp}`
  await copyFile(cfgPath, backupPath)
  const raw = await readFile(cfgPath, 'utf8')
  const lines = raw.split('\n')
  // Blok daftar yang sama dengan upsert: di bawah `    agents:` dalam
  // konteks `platforms:` → `a2a:`.
  let agentsIdx = -1
  let inPlatforms = false
  let inA2a = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^platforms:\s*$/.test(line)) {
      inPlatforms = true
      inA2a = false
      continue
    }
    if (inPlatforms && /^[a-z_]+:\s*(.*)$/.test(line) && !/^\s/.test(line)) {
      inPlatforms = false
      inA2a = false
      continue
    }
    if (inPlatforms && /^  a2a:\s*$/.test(line)) {
      inA2a = true
      continue
    }
    if (inA2a && /^  [a-z_]+:\s*$/.test(line)) {
      inA2a = false
      continue
    }
    if (inA2a && /^    agents:\s*(\[\])?\s*$/.test(line)) {
      agentsIdx = i
      break
    }
  }
  if (agentsIdx < 0) return { backupPath, removed: false }
  const headerLine = lines[agentsIdx]
  if (/\[\]/.test(headerLine)) return { backupPath, removed: false }
  let at = -1
  let end = -1
  let i = agentsIdx + 1
  while (i < lines.length && (/^      - slug:/.test(lines[i]) || /^        /.test(lines[i]) || lines[i].trim() === '')) {
    if (lines[i].startsWith('      - slug:')) {
      const slugM = /^      - slug: (?:'(.*)'|(\S+))$/.exec(lines[i])
      const got = slugM ? (slugM[1] ?? slugM[2]).replace(/''/g, "'") : null
      let j = i + 1
      while (j < lines.length && /^        /.test(lines[j])) j++
      if (got === clean) {
        at = i
        end = j
        break
      }
      i = j
      continue
    }
    i++
  }
  if (at < 0) return { backupPath, removed: false }
  lines.splice(at, end - at)
  await writeFile(cfgPath, lines.join('\n'), 'utf8')
  return { backupPath, removed: true }
}
