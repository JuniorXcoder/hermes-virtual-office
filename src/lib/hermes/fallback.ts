/**
 * CADANGAN PROVIDER — menyiapkan, TIDAK menyalakan.
 *
 * MASALAHNYA NYATA: chain cadangan kosong (`hermes fallback list` -> "No fallback providers
 * configured"), dan satu-satunya provider terdaftar adalah 9router — yang sedang balas 520
 * berulang. Jadi ketika 9router gagal, tidak ada yang menggantikannya, dan kerja yang sedang
 * jalan cuma mati.
 *
 * KENAPA BERKAS INI HANYA MENYIAPKAN. Mengubah chain cadangan berarti mengubah provider yang
 * dipakai agent yang sedang bekerja — seluruh instalasi. Itu keputusan pemilik, bukan efek
 * samping dari sebuah tombol di kantor 3D. Jadi di sini ada:
 *
 *   - `planFallback()`  menghitung APA yang sebaiknya ditulis, dan dari mana angkanya
 *   - `applyFallback()` menulisnya, TAPI hanya dipanggil manusia lewat endpoint kendali
 *
 * dan tidak ada satu pun jalur otomatis di antaranya.
 *
 * SAMPEL KECIL TIDAK BOLEH JADI DASAR. Kandidat diambil dari `providers.ts`, yang menandai
 * `confident: false` untuk provider dengan < 10 panggilan. Provider yang belum pernah gagal
 * KARENA BELUM PERNAH DIPAKAI bukan provider yang baik — dan menyarankannya justru berbahaya:
 * kegagalannya baru ketahuan saat dibutuhkan.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderStat } from './providers'
import { MIN_SAMPLES } from './providers'

const HERMES = process.env.HERMES_HOME || join(homedir(), '.hermes')
const CONFIG = join(HERMES, 'config.yaml')

export type FallbackEntry = { provider: string; model: string }

export type FallbackPlan =
  /** Apa yang sekarang tertulis di config. */
  | { kind: 'empty'; current: FallbackEntry[] }
  /** Ada usulan, dan usulan itu punya alasan yang bisa dibaca. */
  | { kind: 'propose'; current: FallbackEntry[]; proposed: FallbackEntry[]; why: string }
  /** Tidak ada usulan, dan ini alasannya — bukan diam-diam tidak melakukan apa pun. */
  | { kind: 'none'; current: FallbackEntry[]; why: string }

/**
 * Chain cadangan yang sekarang, dibaca dari config.yaml.
 *
 * Dibaca sebagai TEKS, bukan di-parse sebagai YAML: berkas ini ditulis Hermes dan berisi
 * komentar serta struktur bersarang yang tidak boleh hilang kalau ditulis ulang oleh parser
 * yang belum paham seluruh isinya. Untuk MEMBACA satu daftar, regex sudah cukup dan tidak
 * berisiko merusak apa pun.
 */
export function readFallback(): FallbackEntry[] {
  if (!existsSync(CONFIG)) return []
  try {
    const text = readFileSync(CONFIG, 'utf8')
    const lines = text.split('\n')
    const start = lines.findIndex((l) => /^fallback_providers\s*:/.test(l))
    if (start < 0) return []
    const out: FallbackEntry[] = []
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i]
      // Item daftar YAML: diawali "-" pada indentasi lebih dalam dari kuncinya.
      if (/^\S/.test(l)) break
      const pm = /provider\s*:\s*["']?([^\s"']+)/.exec(l)
      const mm = /model\s*:\s*["']?([^\s"']+)/.exec(l)
      if (pm && mm) out.push({ provider: pm[1], model: mm[1] })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Usulkan chain cadangan, dari data yang sudah diukur.
 *
 * Aturannya, dan tiap satunya punya alasan:
 *
 *   1. Kandidat harus `confident` — sampelnya cukup. Belum pernah gagal karena belum pernah
 *      dipakai BUKAN bukti kestabilan.
 *   2. Provider yang sedang gagal TIDAK diusulkan jadi cadangan untuk dirinya sendiri.
 *   3. Model cadangan diambil dari model yang BENAR-BENAR pernah dipakai lewat provider itu,
 *      bukan dikarang — model yang tidak ada hanya akan gagal saat dibutuhkan.
 */
export function planFallback(providers: ProviderStat[], primary = 'custom:9router'): FallbackPlan {
  const current = readFallback()
  if (current.length > 0) return { kind: 'empty', current }

  // PEMBANDINGNYA ADALAH PROVIDER UTAMA, bukan angka nol.
  //
  // Versi pertama berkas ini menyaratkan `failures === 0`, dan itu MENYESATKAN: pada data
  // nyata, tidak ada provider dengan nol gagal sama sekali, jadi tidak ada usulan apa pun —
  // padahal ada provider yang jelas LEBIH BAIK dari yang sedang dipakai. Syarat yang benar
  // adalah "lebih jarang gagal daripada yang sekarang", diukur dari sampel yang cukup.
  const primaryStat = providers.find((p) => normalize(p.provider) === normalize(primary))
  const floor = primaryStat ? primaryStat.failureRate : 0

  const healthy = providers.filter(
    (p) =>
      p.confident &&
      p.models.length > 0 &&
      normalize(p.provider) !== normalize(primary) &&
      p.failureRate < floor,
  )

  if (healthy.length === 0) {
    // Yang BELUM TERTENTU di sini tidak boleh disamarkan jadi "tidak ada masalah".
    const almost = providers.filter((p) => p.failures === 0 && p.calls > 0 && p.calls < MIN_SAMPLES)
    const why =
      almost.length > 0
        ? `belum ada provider dengan sampel cukup (minimal ${MIN_SAMPLES} panggilan). Yang mendekati: ${almost
            .map((p) => `${p.provider} (${p.calls})`)
            .join(', ')}`
        : 'tidak ada provider lain yang pernah dipakai sama sekali — cadangan tidak bisa disusun dari data yang tidak ada'
    return { kind: 'none', current, why }
  }

  const best = healthy[0]
  return {
    kind: 'propose',
    current,
    proposed: [{ provider: normalize(best.provider), model: best.models[0] }],
    why: `${best.provider}: ${best.calls} panggilan, ${best.failures} gagal (${(best.failureRate * 100).toFixed(1)}%) — lebih jarang gagal daripada ${primary}${primaryStat ? ` (${(primaryStat.failureRate * 100).toFixed(1)}%)` : ''}. Model dari yang benar-benar dipakai lewat provider itu.`,
  }
}

/**
 * `custom:9router` -> `9router`. Hermes menulis provider cadangan sebagai nama pendek, dan
 * `custom:` yang ikut tertulis akan membuat resolver-nya gagal menemukan providernya.
 */
function normalize(p: string): string {
  return p.startsWith('custom:') ? p.slice('custom:'.length) : p
}

/**
 * Tulis chain cadangan. HANYA dipanggil dari endpoint kendali, atas permintaan manusia.
 *
 * Ada cadangan berkas sebelum menulis: berkas yang salah tulis berarti seluruh instalasi
 * kehilangan konfigurasinya, dan itu bukan harga yang pantas untuk sebuah tombol.
 */
export function applyFallback(entries: FallbackEntry[]): { backup: string } {
  if (!existsSync(CONFIG)) throw new Error(`config.yaml tidak ditemukan di ${CONFIG}`)
  const backup = `${CONFIG}.bak-sebelum-fallback-${Date.now()}`
  const original = readFileSync(CONFIG, 'utf8')
  writeFileSync(backup, original, 'utf8')

  const lines = original.split('\n')
  const start = lines.findIndex((l) => /^fallback_providers\s*:/.test(l))
  const block = ['fallback_providers:', ...entries.map((e) => `  - provider: ${e.provider}\n    model: ${e.model}`)]

  if (start < 0) {
    // Belum ada kuncinya: tambahkan di akhir, jangan menyisipkan di tengah struktur bersarang.
    writeFileSync(CONFIG, `${original.trimEnd()}\n\n${block.join('\n')}\n`, 'utf8')
    return { backup }
  }

  // Ganti blok lamanya utuh: dari baris kunci sampai item terakhir daftarnya.
  let end = start + 1
  while (end < lines.length && !/^\S/.test(lines[end])) end++
  const next = [...lines.slice(0, start), ...block, ...lines.slice(end)]
  writeFileSync(CONFIG, next.join('\n'), 'utf8')
  return { backup }
}

export { CONFIG as CONFIG_PATH }

/** Dipakai tes: hapus berkas cadangan yang dibuat `applyFallback`. */
export function dropBackup(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}
