/**
 * KESEHATAN PER PROVIDER — provider mana yang layak dipercaya, diukur bukan ditebak.
 *
 * Kenapa ini ada. Panel Sistem melaporkan "provider gagal 15x", tapi tidak menjawab pertanyaan
 * yang sesungguhnya berguna: **provider mana yang harus saya pakai?** Tanpa itu, operatornya
 * cuma tahu ada yang salah, dan tidak bisa berbuat apa-apa.
 *
 * Angkanya datang dari log yang sudah ditulis Hermes: tiap kegagalan API mencantumkan
 * `provider=` dan `model=`. Jadi rasio gagal-sukses per provider bisa dihitung dari catatan
 * yang sudah ada — tidak ada pengukuran baru, tidak ada tebakan.
 *
 * ATURAN YANG DIPEGANG: sampel kecil TIDAK boleh diperlakukan sama dengan sampel besar.
 * 0 gagal dari 3 panggilan bukan bukti apa pun. `confidence` ada supaya UI bisa bilang
 * "belum cukup data" alih-alih menyarankan provider yang kebetulan belum pernah dipakai.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HERMES = process.env.HERMES_HOME || join(homedir(), '.hermes')
const AGENT_LOG = join(HERMES, 'logs', 'agent.log')
const ERROR_LOG = join(HERMES, 'logs', 'errors.log')

/**
 * Di bawah ini, rasionya tidak bermakna.
 *
 * 10 bukan angka bulat yang dipilih enak dilihat: dengan 0 gagal, 10 panggilan memberi batas
 * atas kasar ~26% tingkat gagal (aturan tiga). Di bawah itu, "0 gagal" tidak menyingkirkan
 * apa pun.
 */
export const MIN_SAMPLES = 10

export type ProviderStat = {
  provider: string
  /** Berapa panggilan API yang tercatat. */
  calls: number
  /** Berapa di antaranya gagal. */
  failures: number
  /** failures / calls. */
  failureRate: number
  /** Model yang dipakai lewat provider ini, terbanyak dulu. */
  models: string[]
  /**
   * Apakah angkanya cukup untuk dipercaya. false = jangan dipakai memutuskan apa pun.
   */
  confident: boolean
}

export type ProviderReport = {
  readAt: string
  ageSeconds: number
  /** Terbaik dulu: gagal paling sedikit, lalu paling banyak dipakai. */
  providers: ProviderStat[]
  /** Provider dengan sampel cukup dan NOL gagal — kandidat cadangan yang layak. */
  candidates: ProviderStat[]
  windowHours: number
  failure?: string
}

/** Baris log diawali timestamp; baris lanjutan (stack trace) tidak. Sama seperti pembaca error. */
const STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/

function readLines(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, 'utf8').split('\n')
  } catch {
    return []
  }
}

/**
 * Hitung panggilan dan kegagalan per provider.
 *
 * Panggilan dihitung dari `agent.log` (setiap permintaan API mencatat `provider=` dan
 * `model=`), kegagalan dari `errors.log` (hanya yang gagal yang masuk ke sana). Dua berkas
 * karena memang begitu cara Hermes menulisnya: yang berhasil tidak pernah masuk error log.
 */
export function readProviders(
  windowHours = 6,
  now = Date.now(),
  /**
   * Path log, bisa ditimpa untuk pengujian.
   *
   * Ada supaya tes bisa memakai LOG BUATAN dengan jumlah panggilan yang ditentukan. Menguji
   * ambang sampel dengan log nyata membuat tesnya lulus hanya kalau datanya kebetulan punya
   * kasus itu — dan itu bukan tes.
   */
  paths?: { agentLog?: string; errorLog?: string },
): ProviderReport {
  const agentLog = paths?.agentLog ?? AGENT_LOG
  const errorLog = paths?.errorLog ?? ERROR_LOG
  const cutoff = now - windowHours * 3_600_000
  const inWindow = (line: string): boolean => {
    const m = STAMP.exec(line)
    if (!m) return false
    const t = new Date(`${m[1]}T${m[2]}Z`).getTime()
    return Number.isFinite(t) && t >= cutoff
  }

  try {
    const stats = new Map<string, { calls: number; failures: number; kinds: Map<string, number> }>()
    const bump = (provider: string, model: string, failed: boolean) => {
      if (!provider) return
      let s = stats.get(provider)
      if (!s) {
        s = { calls: 0, failures: 0, kinds: new Map() }
        stats.set(provider, s)
      }
      if (failed) s.failures++
      else s.calls++
      if (model) s.kinds.set(model, (s.kinds.get(model) || 0) + 1)
    }

    // Yang BERHASIL: tidak ada log "sukses", jadi panggilan dihitung dari kemunculan
    // provider+model di agent.log. Baris kegagalan juga muncul di sana DENGAN "API call
    // failed", jadi yang mengandung penanda itu tidak dihitung dua kali di sini.
    for (const line of readLines(agentLog)) {
      if (!inWindow(line)) continue
      const p = /provider=([^\s]+)/.exec(line)?.[1]
      const m = /model=([^\s]+)/.exec(line)?.[1] || ''
      if (!p) continue
      const failed = /API call failed|failed \(|error_type=/.test(line)
      if (failed) continue
      bump(p, m, false)
    }

    // Kegagalan, dari error log, dan hanya baris yang menyebut providernya.
    for (const line of readLines(errorLog)) {
      if (!inWindow(line)) continue
      const p = /provider=([^\s]+)/.exec(line)?.[1]
      const m = /model=([^\s]+)/.exec(line)?.[1] || ''
      if (!p) continue
      bump(p, m, true)
    }

    const providers: ProviderStat[] = [...stats.entries()]
      .map(([provider, s]) => {
        const calls = s.calls + s.failures
        return {
          provider,
          calls,
          failures: s.failures,
          failureRate: calls ? s.failures / calls : 0,
          models: [...s.kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k),
          // Sampel kecil TIDAK boleh dipercaya. 0 gagal dari 3 panggilan bukan bukti apa pun.
          confident: calls >= MIN_SAMPLES,
        }
      })
      .sort((a, b) => a.failureRate - b.failureRate || b.calls - a.calls)

    return {
      readAt: new Date(now).toISOString(),
      ageSeconds: existsSync(agentLog) ? Math.round((now - statSync(agentLog).mtimeMs) / 1000) : -1,
      providers,
      // Kandidat cadangan: cukup terpakai untuk dipercaya, DAN belum pernah gagal.
      candidates: providers.filter((p) => p.confident && p.failures === 0),
      windowHours,
    }
  } catch (err) {
    return {
      readAt: new Date(now).toISOString(),
      ageSeconds: -1,
      providers: [],
      candidates: [],
      windowHours,
      failure: (err as Error).message,
    }
  }
}
