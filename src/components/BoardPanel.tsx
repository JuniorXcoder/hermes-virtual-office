'use client'

/**
 * Panel PAPAN — "apa yang menunggu saya".
 *
 * Kenapa panel ini ada, padahal papan kanban 3D dan 2D sudah ada. Keduanya menunjukkan KOLOM,
 * dan kolom tidak pernah memberi tahu HAL YANG PALING PENTING: task mana yang menunggu
 * MANUSIA. Sebuah task `blocked` karena "tunggu task lain" akan selesai sendiri; yang
 * `blocked` karena "tunggu keputusan" akan menunggu SELAMANYA sampai ada orang bergerak.
 * Papan yang tidak membedakan keduanya membuat operator memeriksa hal yang tidak perlu.
 *
 * Dua aturan yang dipegang di sini:
 *
 *   1. AKSI YANG MENGUBAH KEADAAN BUTUH DUA KLIK. Tombolnya berubah jadi "Yakin?" di tempat,
 *      dan klik di tempat lain membatalkannya. Satu klik nyasar tidak boleh menjeda sistem.
 *      Pola ini sama dengan CronPanel — bukan konvensi baru.
 *
 *   2. YANG DIJELASKAN ADALAH AKIBATNYA, SEBELUM DIJALANKAN. "Kerja BARU berhenti; yang
 *      sedang jalan tidak dibunuh." Itu kalimat yang mencegah orang mengira tombolnya
 *      membunuh pekerjaan mereka, dan itu memang bedanya.
 */

import { useCallback, useEffect, useState } from 'react'

type BlockReason = {
  kind: string
  reason: string
  recurrences: number
  looping: boolean
}

type StuckInfo = { minutes: number; threshold: number; why: string }

type BoardReadout = {
  total: number
  byStatus: Record<string, number>
  waitingOnHuman: { id: string; title: string; reason: BlockReason }[]
  looping: { id: string; title: string; reason: BlockReason }[]
  stuck: { id: string; title: string; info: StuckInfo }[]
  calm: boolean
}

type ActionEffect = { label: string; effect: string; danger: boolean }

type AuditEntry = { at: string; action: string; taskId?: string; reason?: string; result?: string; ok?: boolean }

type Payload = {
  board: BoardReadout
  pause: { paused: boolean; reason: string | null; engagedAt: string | null }
  notRead: number
  actions?: Record<string, ActionEffect>
}

export default function BoardPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Aksi yang menunggu klik kedua. Satu id saja — dua konfirmasi sekaligus itu tidak sengaja. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [steerFor, setSteerFor] = useState<string | null>(null)
  const [steerText, setSteerText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [actions, setActions] = useState<Record<string, ActionEffect>>({})
  const [audit, setAudit] = useState<AuditEntry[]>([])

  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([
        fetch('/api/hermes/board', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/hermes/control', { cache: 'no-store' }).then((r) => r.json()),
      ])
      if (b?.error) throw new Error(b.error.message)
      setData(b)
      setActions(c?.actions || {})
      setAudit(c?.audit || [])
      setErr(null)
    } catch (e) {
      setErr((e as Error).message)
      setData(null)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [open, load])

  const act = useCallback(
    async (action: string, taskId?: string, why?: string, steer?: string) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch('/api/hermes/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, taskId, reason: why, steer }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error?.message || 'aksi gagal')
        // Yang dilaporkan adalah APA YANG TERJADI, bukan "ok". Aksi yang tidak bisa dilaporkan
        // hasilnya akan ditekan lagi oleh operator.
        setNotice(json.did || 'selesai')
      } catch (e) {
        setNotice(`GAGAL: ${(e as Error).message}`)
      } finally {
        setConfirming(null)
        setSteerFor(null)
        setReason('')
        setSteerText('')
        setBusy(false)
        load()
      }
    },
    [load],
  )

  if (!open) return null

  const b = data?.board
  const paused = data?.pause?.paused

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-200 shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Papan
            {paused && <span className="ml-3 rounded bg-amber-900/60 px-2 py-0.5 text-xs text-amber-300">DIJEDA</span>}
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={load} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">
              muat ulang
            </button>
            <button onClick={onClose} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">
              tutup
            </button>
          </div>
        </div>

        {err && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
            Tidak bisa membaca papan: {err}
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded border border-slate-600 bg-slate-800/60 p-2 text-xs">{notice}</div>
        )}

        {paused && (
          <div className="mb-4 rounded border border-amber-800 bg-amber-950/40 p-3 text-xs">
            <b className="text-amber-300">Seluruh kerja baru sedang dijeda.</b>
            <div className="mt-1 text-amber-200/80">
              {data?.pause?.reason || '(tanpa alasan)'}
              {data?.pause?.engagedAt ? ` · sejak ${data.pause.engagedAt}` : ''}
            </div>
            <div className="mt-1 text-amber-200/60">
              Kerja yang sedang jalan tidak dibunuh — hanya kerja BARU yang tidak dimulai.
            </div>
          </div>
        )}

        {!data && !err && <div className="py-8 text-center text-sm text-slate-400">membaca…</div>}

        {data && (
          <div className="space-y-5">
            {/* ---------- jeda global ---------- */}
            <section className="flex items-center gap-2">
              {!paused ? (
                <>
                  {confirming === 'pauseAll' ? (
                    <>
                      <input
                        autoFocus
                        value={reason}
                        onChange={(ev) => setReason(ev.target.value)}
                        placeholder="alasan (wajib) — kenapa dijeda?"
                        className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
                      />
                      <button
                        disabled={busy || reason.trim().length < 3}
                        onClick={() => act('pauseAll', undefined, reason)}
                        className="rounded bg-red-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        Yakin?
                      </button>
                      <button onClick={() => setConfirming(null)} className="rounded border border-slate-600 px-2 py-1 text-xs">
                        batal
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirming('pauseAll')}
                      className="rounded border border-red-700 px-3 py-1 text-xs text-red-300 hover:bg-red-950/40"
                    >
                      {actions.pauseAll?.label || 'Jeda semua'}
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => act('resumeAll')}
                  disabled={busy}
                  className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {actions.resumeAll?.label || 'Lanjutkan'}
                </button>
              )}
            </section>

            {/* ---------- menunggu manusia ---------- */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Menunggu kamu {b!.waitingOnHuman.length > 0 && <span className="text-red-400">({b!.waitingOnHuman.length})</span>}
              </h3>
              {b!.waitingOnHuman.length === 0 ? (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                  Tidak ada yang menunggu keputusanmu.
                </div>
              ) : (
                <div className="space-y-2">
                  {b!.waitingOnHuman.map((t) => (
                    <div key={t.id} className="rounded border border-red-800 bg-red-950/30 p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{t.title}</div>
                          <div className="mt-0.5 text-red-300/80">
                            {t.reason.kind === 'needs_input' ? 'menunggu keputusan' : 'tidak bisa dikerjakan'}
                            {' — '}
                            {t.reason.reason}
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500">{t.id}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={confirming === t.id ? reason : ''}
                          onChange={(ev) => {
                            setConfirming(t.id)
                            setReason(ev.target.value)
                          }}
                          placeholder="alasan membuka blokir"
                          className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                        />
                        <button
                          disabled={busy || (confirming === t.id && reason.trim().length < 3)}
                          onClick={() => act('unblock', t.id, reason || 'dibuka dari office')}
                          className="rounded bg-slate-700 px-2 py-1 text-[11px] hover:bg-slate-600 disabled:opacity-40"
                        >
                          buka blokir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ---------- macet ---------- */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Macet {b!.stuck.length > 0 && <span className="text-amber-400">({b!.stuck.length})</span>}
              </h3>
              {b!.stuck.length === 0 ? (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-2 text-xs text-slate-400">
                  Semua task bergerak sesuai kolomnya.
                </div>
              ) : (
                <div className="space-y-1">
                  {b!.stuck.map((t) => (
                    <div key={t.id} className="rounded border border-amber-800 bg-amber-950/30 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{t.title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500">{t.id}</span>
                      </div>
                      <div className="mt-0.5 text-amber-300/80">{t.info.why}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          disabled={busy}
                          onClick={() => act('release', t.id)}
                          className="rounded bg-slate-700 px-2 py-1 text-[11px] hover:bg-slate-600 disabled:opacity-40"
                          title="Lepas worker yang memegang task. Pakai kalau worker-nya sudah mati."
                        >
                          lepas worker
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ---------- berputar di tempat ---------- */}
            {b!.looping.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Berputar di tempat ({b!.looping.length})
                </h3>
                <div className="space-y-1">
                  {b!.looping.map((t) => (
                    <div key={t.id} className="rounded border border-slate-600 bg-slate-800/50 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{t.title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500">
                          {t.reason.recurrences}×
                        </span>
                      </div>
                      <div className="mt-0.5 text-slate-400">
                        diblokir-dibuka-diblokir {t.reason.recurrences} kali: {t.reason.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ---------- arahkan ---------- */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Kirim arahan ke task yang sedang jalan
              </h3>
              {steerFor ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={steerText}
                    onChange={(ev) => setSteerText(ev.target.value)}
                    placeholder="arahan untuk worker — tidak menghentikannya"
                    className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
                  />
                  <button
                    disabled={busy || steerText.trim().length < 3}
                    onClick={() => act('unblock', steerFor, undefined, steerText)}
                    className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600 disabled:opacity-40"
                  >
                    kirim
                  </button>
                  <button onClick={() => setSteerFor(null)} className="rounded border border-slate-600 px-2 py-1 text-xs">
                    batal
                  </button>
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  Papan ini tidak menghentikan worker untuk memberi arahan — arahan dikirim sebagai catatan
                  pada task, dan worker yang sedang jalan membacanya.
                </div>
              )}
            </section>

            {/* ---------- catatan aksi ---------- */}
            {audit.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Yang pernah ditekan
                </h3>
                <div className="space-y-1">
                  {audit.slice(0, 8).map((a, i) => (
                    <div key={i} className="rounded border border-slate-700 bg-slate-800/40 p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className={a.ok === false ? 'text-red-300' : 'text-slate-300'}>
                          {a.action}
                          {a.taskId ? ` · ${a.taskId}` : ''}
                        </span>
                        <span className="shrink-0 text-slate-500">{a.at.slice(11, 19)}</span>
                      </div>
                      {a.reason && <div className="mt-0.5 text-slate-400">alasan: {a.reason}</div>}
                      {a.result && (
                        <div className={a.ok === false ? 'mt-0.5 text-red-400' : 'mt-0.5 text-slate-500'}>
                          {a.result}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="text-[11px] text-slate-500">
              {b!.total} task · {Object.entries(b!.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}
              {data.notRead > 0 && ` · ${data.notRead} task tidak dibaca detailnya (terlalu banyak)`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
