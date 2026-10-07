'use client'

/**
 * Panel "SISTEM" — keadaan Hermes yang sebenarnya.
 *
 * Kenapa panel ini ada: kantor 3D-nya bagus, tapi BUTA. Provider bisa balas 520 beruntun,
 * agent bisa diam, dan kantornya tetap terlihat baik-baik saja. Panel ini membuat kegagalan
 * terlihat.
 *
 * Prinsip yang dipegang di sini:
 *
 *   1. SETIAP ANGKA PUNYA UMUR. Kalau data terakhir lebih tua dari ambangnya, panel bilang
 *      BASI — bukan menampilkan angka lama seolah-olah sekarang. Panel yang menampilkan
 *      keadaan lama tanpa memberi tahu adalah panel yang berbohong.
 *
 *   2. MODEL TANPA HARGA BUKAN $0. Nol palsu lebih berbahaya daripada tidak ada angka,
 *      karena operator akan mengira gratis. Jadi yang tidak diketahui ditulis "harga belum
 *      diisi", dan jumlahnya dipisahkan dari total.
 *
 *   3. YANG DILAPORKAN ADALAH SEBABNYA, BUKAN DAFTARNYA. Error dikelompokkan jadi
 *      "provider 5xx: 12x", bukan 400 baris log.
 */

import { useCallback, useEffect, useState } from 'react'

type UsageRow = {
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  costUsd: number | null
}

type Observability = {
  status: {
    pricingModels: number
    sources: { name: string; found: boolean; ageSeconds: number | null }[]
  }
  usage: {
    readAt: string
    ageSeconds: number
    totalTokens: number
    totalInput: number
    totalOutput: number
    totalCache: number
    knownCostUsd: number
    unpricedModels: string[]
    unpricedTokens: number
    rows: UsageRow[]
    recentSessions: { id: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null }[]
  }
  errors: {
    ageSeconds: number
    total: number
    buckets: { kind: string; count: number; sample: string }[]
    recent: string[]
  }
}

/** Ambang "basi". Bukan angka ajaib: 10 menit untuk log, 1 jam untuk basis data pemakaian. */
const STALE_LOG = 600
const STALE_DB = 3600

const nfmt = (n: number) => n.toLocaleString('id-ID')
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`
const tok = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} M` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} jt` : nfmt(n))

function age(sec: number | null): string {
  if (sec == null || sec < 0) return '—'
  if (sec < 60) return `${sec} dtk`
  if (sec < 3600) return `${Math.floor(sec / 60)} mnt`
  if (sec < 86400) return `${Math.floor(sec / 3600)} jam`
  return `${Math.floor(sec / 86400)} hari`
}

export default function SystemPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Observability | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState(30)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/hermes/observability?days=${days}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'gagal membaca keadaan sistem')
      setData(json)
      setErr(null)
    } catch (e) {
      // Gagal membaca BUKAN alasan menampilkan angka lama. Panelnya harus bilang dia tidak tahu.
      setErr((e as Error).message)
      setData(null)
    } finally {
      setBusy(false)
    }
  }, [days])

  useEffect(() => {
    if (!open) return
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [open, load])

  if (!open) return null

  const u = data?.usage
  const e = data?.errors
  const s = data?.status
  const logStale = !!e && e.ageSeconds > STALE_LOG
  const dbStale = !!u && u.ageSeconds > STALE_DB
  const top = (u?.rows || []).filter((r) => (r.costUsd ?? 0) > 0.005).slice(0, 8)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-200 shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sistem</h2>
          <div className="flex items-center gap-2 text-xs">
            <select
              value={days}
              onChange={(ev) => setDays(Number(ev.target.value))}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1"
            >
              <option value={1}>1 hari</option>
              <option value={7}>7 hari</option>
              <option value={30}>30 hari</option>
              <option value={365}>semua</option>
            </select>
            <button onClick={load} disabled={busy} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">
              {busy ? '...' : 'muat ulang'}
            </button>
            <button onClick={onClose} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">
              tutup
            </button>
          </div>
        </div>

        {err && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-sm">
            <b>Tidak bisa membaca keadaan sistem.</b>
            <div className="mt-1 text-red-300">{err}</div>
            <div className="mt-1 text-xs text-red-400/80">
              Angka lama sengaja TIDAK ditampilkan. Lebih baik tidak tahu daripada salah tahu.
            </div>
          </div>
        )}

        {!data && !err && <div className="py-8 text-center text-sm text-slate-400">membaca…</div>}

        {data && (
          <div className="space-y-5">
            {/* ---------- sumber & umur ---------- */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sumber data</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(s?.sources || []).map((src) => (
                  <div key={src.name} className="rounded border border-slate-700 bg-slate-800/50 p-2">
                    <div className="flex items-center gap-1">
                      <span className={src.found ? 'text-green-400' : 'text-red-400'}>{src.found ? '●' : '○'}</span>
                      <span className="truncate font-mono">{src.name}</span>
                    </div>
                    <div className="mt-1 text-slate-400">umur {age(src.ageSeconds)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {s?.pricingModels ?? 0} tarif model tersedia dari cache model.dev
              </div>
            </section>

            {/* ---------- biaya ---------- */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Pemakaian & biaya {dbStale && <span className="ml-2 text-amber-400">· DATA BASI ({age(u!.ageSeconds)})</span>}
              </h3>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                  <div className="text-slate-400">biaya terhitung</div>
                  <div className="text-lg font-semibold text-emerald-400">{usd(u!.knownCostUsd)}</div>
                </div>
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                  <div className="text-slate-400">token masuk</div>
                  <div className="text-lg font-semibold">{tok(u!.totalInput)}</div>
                </div>
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                  <div className="text-slate-400">token keluar</div>
                  <div className="text-lg font-semibold">{tok(u!.totalOutput)}</div>
                </div>
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                  <div className="text-slate-400">cache dibaca</div>
                  <div className="text-lg font-semibold">{tok(u!.totalCache)}</div>
                </div>
              </div>

              {u!.unpricedModels.length > 0 && (
                <div className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-xs">
                  <b className="text-amber-300">{u!.unpricedModels.length} model harganya belum diisi</b>
                  <span className="text-amber-200/80">
                    {' '}
                    — {tok(u!.unpricedTokens)} token tidak ikut dihitung. Angka di atas adalah batas bawah,
                    bukan total.
                  </span>
                  <div className="mt-1 font-mono text-[11px] text-amber-300/70">{u!.unpricedModels.join(' · ')}</div>
                </div>
              )}

              {top.length > 0 && (
                <table className="mt-2 w-full text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left font-normal">model</th>
                      <th className="text-right font-normal">masuk</th>
                      <th className="text-right font-normal">keluar</th>
                      <th className="text-right font-normal">biaya</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={`${r.model}|${r.provider}`} className="border-t border-slate-800">
                        <td className="py-1 pr-2 font-mono text-[11px]">{r.model}</td>
                        <td className="py-1 text-right text-slate-400">{tok(r.inputTokens)}</td>
                        <td className="py-1 text-right text-slate-400">{tok(r.outputTokens)}</td>
                        <td className="py-1 text-right font-semibold text-emerald-400">
                          {r.costUsd == null ? <span className="text-amber-500">belum ada harga</span> : usd(r.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ---------- error ---------- */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Kegagalan 24 jam terakhir
                {logStale && <span className="ml-2 text-amber-400">· LOG BASI ({age(e!.ageSeconds)})</span>}
              </h3>
              {e!.total === 0 ? (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
                  Tidak ada kegagalan tercatat dalam 24 jam terakhir.
                </div>
              ) : (
                <>
                  <div className="mb-2 text-xs text-slate-400">{nfmt(e!.total)} baris bermasalah</div>
                  <div className="space-y-1">
                    {e!.buckets.map((b) => {
                      const critical = /5xx|rate|ditolak|context/.test(b.kind)
                      return (
                        <div
                          key={b.kind}
                          className={`rounded border p-2 text-xs ${
                            critical ? 'border-red-800 bg-red-950/40' : 'border-slate-700 bg-slate-800/50'
                          }`}
                          title={b.sample}
                        >
                          <div className="flex items-center justify-between">
                            <span className={critical ? 'font-semibold text-red-300' : ''}>{b.kind}</span>
                            <span className="font-mono">{nfmt(b.count)}×</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
