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
  apiCalls: number
  costUsd: number | null
}

type ProviderStat = {
  provider: string
  calls: number
  failures: number
  failureRate: number
  models: string[]
  confident: boolean
}

type FallbackPlan =
  | { kind: 'empty'; current: { provider: string; model: string }[] }
  | { kind: 'propose'; current: unknown[]; proposed: { provider: string; model: string }[]; why: string }
  | { kind: 'none'; current: unknown[]; why: string }

type Observability = {
  providers?: { providers: ProviderStat[]; candidates: ProviderStat[]; windowHours: number; failure?: string }
  fallback?: FallbackPlan
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
    windowDays: number
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

type Approvals = {
  policy: { mode: string | null; timeoutSec: number | null; denyCount: number; ageSeconds: number; failure?: string }
  patterns: {
    count: number
    windowDays: number
    proposals: { pattern: string; kind: string; count: number }[]
    ageSeconds: number
    failure?: string
  }
  pending: { id: string; title: string; reason: { kind: string; reason: string } }[]
  blockedAgents: string[]
  notRead?: number
}

/** Ambang "basi". Bukan angka ajaib: 10 menit untuk log, 1 jam untuk basis data pemakaian. */
const STALE_LOG = 600
const STALE_DB = 3600
/** 5 menit untuk persetujuan — sama dengan APPROVAL_STALE_SEC di lib/hermes/approvals.ts. */
const STALE_APPROVAL = 300

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
  const [notice, setNotice] = useState<string | null>(null)
  const [appr, setAppr] = useState<Approvals | null>(null)
  const [apprErr, setApprErr] = useState<string | null>(null)

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

  // Dipisah dari `load`: pembacaan pola (`approvals suggest`) bisa makan 25 detik, dan itu tidak
  // boleh menahan angka biaya dan error yang sudah siap.
  const loadApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes/approvals', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'gagal membaca persetujuan')
      setAppr(json)
      setApprErr(null)
    } catch (e) {
      // Sama dengan `load`: gagal = bilang tidak tahu, bukan menampilkan daftar tunggu lama.
      setApprErr((e as Error).message)
      setAppr(null)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    load()
    loadApprovals()
    const t = setInterval(() => {
      load()
      loadApprovals()
    }, 30_000)
    return () => clearInterval(t)
  }, [open, load, loadApprovals])

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
            <button
              onClick={() => {
                load()
                loadApprovals()
              }}
              disabled={busy} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">
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

        {notice && <div className="mb-4 rounded border border-slate-600 bg-slate-800/60 p-2 text-xs">{notice}</div>}

        {/* ---------- persetujuan ---------- */}
        <section className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Persetujuan
            {appr && (
              <span className={`ml-2 ${appr.pending.length > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                · {appr.pending.length} menunggu
              </span>
            )}
          </h3>
          {apprErr ? (
            <div className="rounded border border-red-800 bg-red-950/50 p-2 text-xs">
              <b>Tidak bisa membaca keadaan persetujuan.</b>
              <div className="mt-1 text-red-300">{apprErr}</div>
            </div>
          ) : !appr ? (
            <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">membaca…</div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                {appr.policy.failure ? (
                  <span className="text-red-300">Kebijakan tidak terbaca: {appr.policy.failure}</span>
                ) : (
                  <>
                    kebijakan <span className="font-mono">{appr.policy.mode}</span>
                    <span className="text-slate-400">
                      {' '}
                      · tunggu {appr.policy.timeoutSec ?? '—'} dtk · {appr.policy.denyCount} aturan deny
                    </span>
                    {appr.policy.ageSeconds > STALE_APPROVAL && (
                      <span className="ml-2 text-amber-400">· BASI ({age(appr.policy.ageSeconds)})</span>
                    )}
                  </>
                )}
              </div>

              {appr.pending.length === 0 ? (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-slate-400">
                  Tidak ada yang menunggu keputusan kamu.
                </div>
              ) : (
                <div className="space-y-1">
                  {appr.pending.map((w) => (
                    <div key={w.id} className="rounded border border-red-800 bg-red-950/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-red-300">{w.title}</span>
                        <span className="font-mono text-[11px] text-slate-400">{w.id}</span>
                      </div>
                      <div className="mt-1 text-red-200/80">{w.reason.reason}</div>
                    </div>
                  ))}
                  {appr.blockedAgents.length > 0 && (
                    <div className="text-[11px] text-red-400/80">
                      agent berhenti: {appr.blockedAgents.join(' · ')}
                    </div>
                  )}
                </div>
              )}
              {(appr.notRead ?? 0) > 0 && (
                <div className="text-[11px] text-amber-400">{appr.notRead} task tidak dibaca detailnya — daftar ini mungkin kurang</div>
              )}

              <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-slate-400">
                {appr.patterns.failure ? (
                  <span className="text-amber-300">Pola approval tidak terbaca: {appr.patterns.failure}</span>
                ) : appr.patterns.ageSeconds > STALE_APPROVAL ? (
                  <span className="text-amber-400">Pola approval BASI ({age(appr.patterns.ageSeconds)})</span>
                ) : appr.patterns.count === 0 ? (
                  `Pola approval ${appr.patterns.windowDays} hari: belum ada data.`
                ) : (
                  <>
                    {appr.patterns.count} pola sering disetujui ({appr.patterns.windowDays} hari):{' '}
                    <span className="font-mono text-slate-300">
                      {appr.patterns.proposals
                        .slice(0, 5)
                        .map((p) => `${p.pattern} ×${p.count}`)
                        .join(' · ')}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </section>

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
                Pemakaian & biaya{' '}
                <span className="text-slate-500">
                  ({u!.windowDays >= 365 ? 'seumur hidup' : `${u!.windowDays} hari terakhir`})
                </span>
                {dbStale && <span className="ml-2 text-amber-400">· DATA BASI ({age(u!.ageSeconds)})</span>}
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
                      <th className="text-right font-normal">panggilan</th>
                      <th className="text-right font-normal">biaya</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={`${r.model}|${r.provider}`} className="border-t border-slate-800">
                        <td className="py-1 pr-2 font-mono text-[11px]">{r.model}</td>
                        <td className="py-1 text-right text-slate-400">{tok(r.inputTokens)}</td>
                        <td className="py-1 text-right text-slate-400">{tok(r.outputTokens)}</td>
                        <td className="py-1 text-right text-slate-400">{nfmt(r.apiCalls)}</td>
                        <td className="py-1 text-right font-semibold text-emerald-400">
                          {r.costUsd == null ? <span className="text-amber-500">belum ada harga</span> : usd(r.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ---------- provider ---------- */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Provider {data.providers?.windowHours ? `(${data.providers.windowHours} jam)` : ''}
              </h3>
              {!data.providers || data.providers.providers.length === 0 ? (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                  {data.providers?.failure
                    ? `Tidak bisa membaca statistik provider: ${data.providers.failure}`
                    : 'Belum ada panggilan API tercatat di jendela ini.'}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="text-left font-normal">provider</th>
                      <th className="text-right font-normal">panggilan</th>
                      <th className="text-right font-normal">gagal</th>
                      <th className="text-right font-normal">rasio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providers.providers.map((p) => (
                      <tr key={p.provider} className="border-t border-slate-800">
                        <td className="py-1 pr-2">
                          <span className={p.failures > 0 ? 'text-red-300' : 'text-emerald-300'}>{p.provider}</span>
                          {!p.confident && (
                            <span className="ml-2 text-[10px] text-slate-500" title={`kurang dari 10 panggilan — rasionya belum bisa dipercaya`}>
                              sampel kecil
                            </span>
                          )}
                        </td>
                        <td className="py-1 text-right text-slate-400">{nfmt(p.calls)}</td>
                        <td className={`py-1 text-right ${p.failures > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                          {nfmt(p.failures)}
                        </td>
                        <td className="py-1 text-right font-mono">
                          {p.failures === 0 ? '—' : `${(p.failureRate * 100).toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ---------- cadangan provider ---------- */}
            {data.fallback && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Cadangan provider</h3>
                {data.fallback.kind === 'empty' && (
                  <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                    Sudah terisi.
                  </div>
                )}
                {data.fallback.kind === 'none' && (
                  <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                    Belum ada usulan: {data.fallback.why}
                  </div>
                )}
                {data.fallback.kind === 'propose' && (
                  <div className="rounded border border-slate-600 bg-slate-800/50 p-2 text-xs">
                    <div className="text-slate-300">
                      Usulan: <span className="font-mono">{data.fallback.proposed[0]?.model}</span> lewat{' '}
                      <span className="font-mono">{data.fallback.proposed[0]?.provider}</span>
                    </div>
                    <div className="mt-1 text-slate-400">{data.fallback.why}</div>
                    <button
                      onClick={async () => {
                        setNotice(null)
                        const res = await fetch('/api/hermes/control', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'setFallback' }),
                        })
                        const j = await res.json()
                        setNotice(res.ok ? j.did : `GAGAL: ${j?.error?.message}`)
                        load()
                      }}
                      className="mt-2 rounded border border-red-700 px-3 py-1 text-red-300 hover:bg-red-950/40"
                      title="Mengubah provider yang dipakai SELURUH instalasi. Cadangan berkas dibuat dulu."
                    >
                      pasang cadangan ini
                    </button>
                    <div className="mt-1 text-[10px] text-amber-400/80">
                      Ini mengubah provider yang dipakai SELURUH instalasi, termasuk agent yang sedang bekerja.
                    </div>
                  </div>
                )}
              </section>
            )}

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
