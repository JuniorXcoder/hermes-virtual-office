/**
 * Membaca keadaan sistem yang SEBENARNYA, untuk command control.
 *
 * Tiga sumber, dan kenapa masing-masing:
 *
 *   state.db             — token, biaya, model, sesi. SQLite, dibaca READ-ONLY.
 *   models_dev_cache     — tabel harga dari model.dev, 11.186 kunci. Tarif yang kita pakai ada
 *                          di situ, tapi lewat provider lain (empiriolabs), sedangkan kita
 *                          mengaksesnya lewat 9router.
 *   logs/errors.log      — kegagalan nyata. Ini satu-satunya tempat di mana "ada yang rusak"
 *                          terlihat sama sekali.
 *
 * KENAPA BIAYA HARUS DIHITUNG SENDIRI. `agent/usage_pricing.py:361` mematikan anggaran untuk
 * provider bernama `custom*` atau ber-host privat — dan 9router kena dua-duanya. Jadi Hermes
 * menyimpan `cost_status = 'unknown'` dan `estimated_cost_usd = 0` untuk SETIAP sesi, padahal
 * tokennya lengkap. Yang dihitung di sini bukan tebakan: tarif datang dari cache model.dev,
 * dan satuannya per juta token.
 *
 * ATURAN YANG TIDAK BOLEH DILANGGAR: model yang tidak ada tarifnya TIDAK boleh dihitung 0.
 * Nol palsu lebih berbahaya daripada tidak ada angka — operator akan mengira gratis.
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HERMES = process.env.HERMES_HOME || join(homedir(), '.hermes')
const STATE_DB = join(HERMES, 'state.db')
const PRICING_CACHE = join(HERMES, 'models_dev_cache.json')
const ERROR_LOG = join(HERMES, 'logs', 'errors.log')

/**
 * Buka read-only: panel ini melapor, tidak boleh bisa merusak apa pun.
 *
 * Pakai `node:sqlite`, sama seperti `office/db.ts` — proyek ini tidak punya driver SQLite
 * lain, dan menambah `better-sqlite3` berarti satu langkah build native hanya untuk membaca.
 */
function openState(): DatabaseSync | null {
  if (!existsSync(STATE_DB)) return null
  try {
    return new DatabaseSync(STATE_DB, { readOnly: true })
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------- harga -- */

type Price = { in: number; out: number; cache: number }
let priceCache: Map<string, Price> | null = null

/**
 * Tabel harga, dibangun dari cache model.dev.
 *
 * Tiap model didaftarkan dengan BEBERAPA kunci (provider/model, model saja, id) supaya model
 * kita yang ditulis bermacam-macam — `naturaline/muse-spark-1.3`, `muse-spark-1.3`, dan
 * `ky/deepseek-ai/deepseek-v4.1-flash` — tetap ketemu. Pencocokan dilakukan dari segmen
 * BELAKANG, karena bagian depan itu nama reseller dan tidak menentukan tarif.
 */
function loadPrices(): Map<string, Price> {
  if (priceCache) return priceCache
  const out = new Map<string, Price>()
  try {
    const raw = JSON.parse(readFileSync(PRICING_CACHE, 'utf8')) as Record<string, unknown>
    for (const [prov, pv] of Object.entries(raw)) {
      const models = (pv as { models?: Record<string, { cost?: Record<string, number>; id?: string }> })?.models
      if (!models) continue
      for (const [m, info] of Object.entries(models)) {
        const c = info?.cost
        if (!c || c.input == null) continue
        const price: Price = { in: c.input, out: c.output ?? 0, cache: c.cache_read ?? c.input }
        for (const key of [`${prov}/${m}`, m, info.id ?? '']) {
          const k = String(key).toLowerCase()
          if (k) out.set(k, price)
        }
      }
    }
  } catch {
    // Cache harga hilang itu bukan alasan untuk gagal: panelnya cukup bilang harga belum diisi.
  }
  priceCache = out
  return out
}

/** Cari tarif sebuah model dengan mencocokkan dari segmen belakang. */
function priceFor(model: string): Price | null {
  const prices = loadPrices()
  const parts = String(model).toLowerCase().split('/')
  for (const n of [2, 1, 4, 3]) {
    if (parts.length >= n) {
      const p = prices.get(parts.slice(-n).join('/'))
      if (p) return p
    }
  }
  return null
}

/**
 * Biaya satu model, dalam dolar.
 *
 * `null` berarti HARGA TIDAK DIKETAHUI — dan itu bukan nol. Pemanggil wajib membedakannya.
 */
function costOf(model: string, inp: number, outTok: number, cacheRead: number): number | null {
  const p = priceFor(model)
  if (!p) return null
  return (inp * p.in + outTok * p.out + cacheRead * p.cache) / 1_000_000
}

/* ------------------------------------------------------------------- sehat -- */

export type UsageRow = {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** Berapa panggilan API. Pembeda antara "model mahal" dan "model sering dipakai". */
  apiCalls: number
  /** null = tarif tidak diketahui. JANGAN ditampilkan sebagai 0. */
  costUsd: number | null
}

export type UsageReport = {
  /** Kapan data ini dibaca. Setiap angka di panel ini punya umur. */
  readAt: string
  /** Jendela yang BENAR-BENAR diterapkan. Ditampilkan supaya tidak ada jendela yang diam-diam diabaikan. */
  windowDays: number
  /** Umur file DB dalam detik — dasar untuk bilang "basi". */
  ageSeconds: number
  totalTokens: number
  totalInput: number
  totalOutput: number
  totalCache: number
  /** Jumlah hanya dari model yang TARIFNYA DIKETAHUI. */
  knownCostUsd: number
  /** Berapa model yang tidak punya tarif, dan berapa tokennya. */
  unpricedModels: string[]
  unpricedTokens: number
  rows: UsageRow[]
  /** Diisi kalau pembacaan GAGAL. Panel wajib menampilkannya, bukan menampilkan nol. */
  failure?: string
  recentSessions: {
    id: string
    model: string
    inputTokens: number
    outputTokens: number
    costUsd: number | null
    startedAt: string | null
  }[]
}

export function readUsage(days = 30): UsageReport {
  const now = new Date()
  const empty: UsageReport = {
    readAt: now.toISOString(),
    ageSeconds: -1,
    windowDays: days,
    totalTokens: 0,
    totalInput: 0,
    totalOutput: 0,
    totalCache: 0,
    knownCostUsd: 0,
    unpricedModels: [],
    unpricedTokens: 0,
    rows: [],
    recentSessions: [],
  }
  const db = openState()
  if (!db) return { ...empty, failure: 'state.db tidak ditemukan atau tidak bisa dibuka' }

  try {
    // BATAS WAKTUNYA DARI `last_seen`, DAN INI PERNAH SALAH.
    //
    // Versi pertama fungsi ini menghitung `since` lalu MEMBUANGNYA — filter tanggalnya tidak
    // pernah diterapkan, jadi dropdown "1 hari / 7 hari / 30 hari" menampilkan angka yang SAMA
    // untuk ketiganya. Kolom yang bisa diklik tapi tidak mengubah apa pun lebih buruk daripada
    // tidak ada kolom: ia membuat orang mengira sudah memilih.
    //
    // `session_model_usage` TIDAK punya kolom waktu sendiri, tapi ia punya `last_seen` (unix
    // detik) — waktu terakhir model itu dipakai di sesi itu. Itu yang dipakai.
    const cutoff = days >= 365 ? 0 : now.getTime() / 1000 - days * 86_400

    const rows = db
      .prepare(
        `SELECT model,
                COALESCE(billing_provider, '') AS provider,
                COALESCE(SUM(input_tokens), 0) AS inp,
                COALESCE(SUM(output_tokens), 0) AS out,
                COALESCE(SUM(cache_read_tokens), 0) AS cache,
                COALESCE(SUM(api_call_count), 0) AS calls,
                MAX(COALESCE(last_seen, 0)) AS latest
         FROM session_model_usage
         WHERE ? = 0 OR COALESCE(last_seen, 0) >= ?
         GROUP BY model, provider
         ORDER BY SUM(input_tokens) DESC`,
      )
      .all(cutoff, cutoff) as {
      model: string
      provider: string
      inp: number
      out: number
      cache: number
      calls: number
      latest: number
    }[]

    const out: UsageRow[] = []
    let knownCost = 0
    let totalIn = 0
    let totalOut = 0
    let totalCache = 0
    const unpriced = new Set<string>()
    let unpricedTokens = 0

    for (const r of rows) {
      if (!r.model) continue
      const cost = costOf(r.model, r.inp, r.out, r.cache)
      totalIn += r.inp
      totalOut += r.out
      totalCache += r.cache
      if (cost == null) {
        unpriced.add(r.model)
        unpricedTokens += r.inp + r.out
      } else {
        knownCost += cost
      }
      out.push({
        model: r.model,
        provider: r.provider,
        inputTokens: r.inp,
        outputTokens: r.out,
        cacheReadTokens: r.cache,
        apiCalls: r.calls,
        costUsd: cost,
      })
    }

    const cols = new Set(
      (db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]).map((c) => c.name),
    )
    // Nama kolom id berbeda antar versi skema. Skema yang salah TIDAK BOLEH menjatuhkan seluruh
    // pembacaan — bagian pemakaian sudah terbaca, dan itu bagian yang penting.
    const idCol = ['session_id', 'id', 'sid'].find((c) => cols.has(c))
    const startedCol = ['started_at', 'created_at', 'start_time'].find((c) => cols.has(c))
    let recent: {
      sid: string
      model: string
      inp: number
      out: number
      cache: number
      started_at: string | null
    }[] = []
    if (cols.has('model')) {
      try {
        recent = db
          .prepare(
            `SELECT ${idCol ? idCol : "''"} AS sid, model,
                    COALESCE(input_tokens, 0) AS inp,
                    COALESCE(output_tokens, 0) AS out,
                    COALESCE(cache_read_tokens, 0) AS cache,
                    ${startedCol ? startedCol : 'NULL'} AS started_at
             FROM sessions
             WHERE model IS NOT NULL AND model != ''
             ORDER BY rowid DESC LIMIT 12`,
          )
          .all() as typeof recent
      } catch {
        recent = []
      }
    }

    const stat = (() => {
      try {
        return statSync(STATE_DB).mtimeMs
      } catch {
        return 0
      }
    })()

    return {
      readAt: now.toISOString(),
      windowDays: days,
      ageSeconds: stat ? Math.round((now.getTime() - stat) / 1000) : -1,
      totalTokens: totalIn + totalOut,
      totalInput: totalIn,
      totalOutput: totalOut,
      totalCache,
      knownCostUsd: Math.round(knownCost * 10000) / 10000,
      unpricedModels: [...unpriced].sort(),
      unpricedTokens,
      rows: out,
      recentSessions: recent.map((s) => ({
        id: s.sid,
        model: s.model,
        inputTokens: s.inp,
        outputTokens: s.out,
        costUsd: costOf(s.model, s.inp, s.out, s.cache),
        startedAt: s.started_at ?? null,
      })),
    }
  } catch (err) {
    // JANGAN telan errornya. Versi pertama fungsi ini menelan dan mengembalikan nol, dan
    // hasilnya panel yang menampilkan "$0.00" dengan yakin padahal pembacaannya GAGAL —
    // persis kebohongan yang modul ini ada untuk mencegahnya. Sekarang alasannya diteruskan
    // supaya panel bisa bilang "tidak bisa membaca", bukan "biayanya nol".
    return { ...empty, failure: (err as Error).message }
  } finally {
    db.close()
  }
}

/* ------------------------------------------------------------------- error -- */

export type ErrorBucket = {
  /** Jenis masalahnya, diturunkan dari isi baris log. */
  kind: string
  count: number
  /** Contoh baris pertama, dipotong supaya muat di panel. */
  sample: string
}

export type ErrorReport = {
  readAt: string
  ageSeconds: number
  total: number
  buckets: ErrorBucket[]
  /** Empat baris terakhir apa adanya, untuk yang mau lihat mentahnya. */
  recent: string[]
}

/**
 * Baca errors.log dan KELOMPOKKAN, jangan dump.
 *
 * Log mentah tidak menjawab pertanyaan apa pun. Yang menjawab adalah: "provider mana yang
 * gagal, berapa kali, sejak kapan". Jadi tiap baris dipetakan ke jenis masalah.
 */
export function readErrors(sinceHours = 24, max = 400): ErrorReport {
  const now = new Date()
  const base: ErrorReport = { readAt: now.toISOString(), ageSeconds: -1, total: 0, buckets: [], recent: [] }
  if (!existsSync(ERROR_LOG)) return base

  try {
    const age = Math.round((now.getTime() - statSync(ERROR_LOG).mtimeMs) / 1000)
    const raw = readFileSync(ERROR_LOG, 'utf8').split('\n')

    // Baris log diawali timestamp; baris lanjutan (stack trace, HTML dari Cloudflare) tidak.
    // Yang dihitung hanya baris ber-timestamp, supaya satu kegagalan tidak dihitung 40 kali
    // hanya karena stack trace-nya panjang.
    const stamp = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/
    const cutoff = now.getTime() - sinceHours * 3_600_000
    const picked: string[] = []
    for (const line of raw) {
      const m = stamp.exec(line)
      if (!m) continue
      const t = new Date(`${m[1]}T${m[2]}Z`).getTime()
      if (!Number.isFinite(t) || t < cutoff) continue
      picked.push(line)
    }

    const classify = (line: string): string => {
      const l = line.toLowerCase()
      if (/http 5\d\d|error code: 5\d\d|internal server error|<html/.test(l)) return 'provider 5xx'
      if (/rate.?limit|429/.test(l)) return 'kena rate limit'
      if (/timeout|timed out/.test(l)) return 'timeout'
      if (/unauthorized|401|403|invalid api key|\bno api key\b/.test(l)) return 'kredensial ditolak'
      if (/context.{0,12}(length|window)|too many tokens/.test(l)) return 'context penuh'
      if (/\bunknown\b|not found|404/.test(l)) return 'model/endpoint tidak dikenal'
      if (/traceback|exception|error\b/.test(l)) return 'error lain'
      return 'warning'
    }

    const counts = new Map<string, { count: number; sample: string }>()
    for (const line of picked) {
      const k = classify(line)
      const cur = counts.get(k)
      const clean = line.replace(/\s+/g, ' ').slice(0, 220)
      if (cur) cur.count++
      else counts.set(k, { count: 1, sample: clean })
    }

    return {
      readAt: now.toISOString(),
      ageSeconds: age,
      total: picked.length,
      buckets: [...counts.entries()]
        .map(([kind, v]) => ({ kind, count: v.count, sample: v.sample }))
        .sort((a, b) => b.count - a.count),
      recent: picked.slice(-4).map((l) => l.replace(/\s+/g, ' ').slice(0, 300)),
    }
  } catch {
    return base
  }
}

/* ------------------------------------------------------------------ status -- */

export type StatusReport = {
  readAt: string
  stateDbFound: boolean
  pricingCacheFound: boolean
  pricingModels: number
  errorLogFound: boolean
  /** Umur tiap sumber, dalam detik. Ini yang membuat panel bisa bilang "basi". */
  sources: { name: string; path: string; found: boolean; ageSeconds: number | null }[]
}

export function readStatus(): StatusReport {
  const now = Date.now()
  const one = (name: string, path: string) => {
    const found = existsSync(path)
    return {
      name,
      path,
      found,
      ageSeconds: found ? Math.round((now - statSync(path).mtimeMs) / 1000) : null,
    }
  }
  const sources = [
    one('state.db', STATE_DB),
    one('models_dev_cache.json', PRICING_CACHE),
    one('logs/errors.log', ERROR_LOG),
  ]
  return {
    readAt: new Date(now).toISOString(),
    stateDbFound: sources[0].found,
    pricingCacheFound: sources[1].found,
    pricingModels: loadPrices().size,
    errorLogFound: sources[2].found,
    sources,
  }
}
