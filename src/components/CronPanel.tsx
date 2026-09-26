'use client'

import { useEffect, useState } from 'react'

/**
 * Cron job management.
 *
 * Two safety rules, both deliberate:
 *
 *   1. A new job is created PAUSED. A job created live can fire before anyone has
 *      read it back, and the schedule syntax is easy to get wrong. There is an
 *      explicit "langsung aktif" checkbox for when that is what you want.
 *   2. Every action that changes a schedule needs a SECOND click. The button
 *      turns into "Yakin?" in place, and clicking elsewhere cancels. A single
 *      stray click must not pause the job that keeps something alive.
 */

type Job = {
  id: string
  name: string
  prompt: string
  schedule: string
  scheduleKind: string
  enabled: boolean
  state: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  failureStreak: number
  deliver: string
  noAgent: boolean
  script: string | null
  skills: string[]
  repeatTimes: number | null
  repeatCompleted: number
}

type Run = {
  id: number
  jobId: string
  status: string
  source: string
  startedAt: string | null
  finishedAt: string | null
}

/** Human-readable relative time, or the raw value if it cannot be parsed. */
function when(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = t - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60_000)
  const label =
    abs < 60_000
      ? 'sekarang'
      : mins < 60
        ? `${mins} mnt`
        : abs < 86_400_000
          ? `${Math.round(mins / 60)} jam`
          : `${Math.round(abs / 86_400_000)} hari`
  return diff >= 0 ? `dalam ${label}` : `${label} lalu`
}

export default function CronPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [screen, setScreen] = useState<'list' | 'new'>('list')
  /** id + action awaiting the second click. */
  const [confirm, setConfirm] = useState<{ id: string; action: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // create form
  const [schedule, setSchedule] = useState('')
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [liveNow, setLiveNow] = useState(false)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch('/api/hermes/cron', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      setJobs(d.jobs || [])
      setRuns(d.runs || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  // A click anywhere else cancels a pending confirmation.
  useEffect(() => {
    if (!confirm) return
    const cancel = () => setConfirm(null)
    window.addEventListener('click', cancel)
    return () => window.removeEventListener('click', cancel)
  }, [confirm])

  async function act(id: string, action: string) {
    setBusy(id + action)
    setErr(null)
    setNote(null)
    try {
      const r = await fetch('/api/hermes/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      setNote(
        action === 'remove'
          ? 'job dihapus'
          : action === 'run'
            ? 'job akan jalan pada tick berikutnya'
            : `job ${action === 'pause' ? 'dipause' : 'diaktifkan'}`,
      )
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  async function create() {
    setBusy('create')
    setErr(null)
    setNote(null)
    try {
      const r = await fetch('/api/hermes/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          schedule,
          prompt,
          name,
          paused: !liveNow,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      setNote(
        liveNow
          ? `job dibuat dan langsung aktif (${d.id})`
          : `job dibuat dalam keadaan pause (${d.id}) — aktifkan kalau sudah benar`,
      )
      setSchedule('')
      setPrompt('')
      setName('')
      setLiveNow(false)
      await load()
      setScreen('list')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  /** A button that needs a second click before it fires. */
  function Guarded({
    id,
    action,
    label,
    confirmLabel,
    className,
  }: {
    id: string
    action: string
    label: string
    confirmLabel: string
    className?: string
  }) {
    const armed = confirm?.id === id && confirm.action === action
    return (
      <button
        className={`vp-btn ${className || ''}`}
        disabled={busy === id + action}
        onClick={(e) => {
          e.stopPropagation()
          if (!armed) {
            setConfirm({ id, action })
            return
          }
          void act(id, action)
        }}
      >
        {busy === id + action ? '…' : armed ? confirmLabel : label}
      </button>
    )
  }

  return (
    <aside className="vp-panel right-0">
      <header className="vp-panel-head">
        <h2>{screen === 'new' ? 'Job baru' : 'Cron'}</h2>
        <div className="flex items-center gap-2">
          {screen === 'new' && (
            <button className="vp-chip-btn" onClick={() => setScreen('list')}>
              ← Kembali
            </button>
          )}
          <button className="vp-x" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
      </header>

      <div className="vp-pad flex flex-col gap-3">
        {err && <div className="vp-err">{err}</div>}
        {note && <div className="vp-ok">{note}</div>}
        {loading && <div className="vp-muted">memuat…</div>}

        {screen === 'list' ? (
          <>
            <button className="vp-btn" onClick={() => setScreen('new')}>
              + Buat job
            </button>
            <button className="vp-btn vp-btn-rosy" disabled={loading} onClick={load}>
              Segarkan
            </button>

            <div className="vp-sub">JOB ({jobs.length})</div>
            <div className="flex flex-col gap-2">
              {jobs.map((j) => (
                <div key={j.id} className={`vp-cron-card ${j.enabled ? 'on' : ''}`}>
                  <div className="vp-cron-top">
                    <b>{j.name}</b>
                    <span className={`vp-cron-state ${j.enabled ? 'on' : 'off'}`}>{j.state}</span>
                  </div>
                  <i className="vp-cron-sched">{j.schedule}</i>
                  <div className="vp-cron-meta">
                    <span>{j.enabled ? `jalan ${when(j.nextRunAt)}` : 'dijeda'}</span>
                    {j.lastRunAt && <span>terakhir {when(j.lastRunAt)}</span>}
                    {j.failureStreak > 0 && (
                      <span className="vp-cron-bad">gagal {j.failureStreak}×</span>
                    )}
                  </div>
                  {j.prompt && <div className="vp-cron-prompt">{j.prompt}</div>}
                  {j.lastError && <div className="vp-cron-err">{j.lastError}</div>}
                  <div className="vp-cron-actions">
                    {j.enabled ? (
                      <Guarded
                        id={j.id}
                        action="pause"
                        label="Pause"
                        confirmLabel="Yakin jeda?"
                      />
                    ) : (
                      <Guarded
                        id={j.id}
                        action="resume"
                        label="Aktifkan"
                        confirmLabel="Yakin aktifkan?"
                      />
                    )}
                    <Guarded
                      id={j.id}
                      action="run"
                      label="Jalankan"
                      confirmLabel="Yakin jalan?"
                    />
                    <Guarded
                      id={j.id}
                      action="remove"
                      label="Hapus"
                      confirmLabel="Yakin hapus?"
                      className="vp-btn-danger"
                    />
                  </div>
                </div>
              ))}
              {!jobs.length && <span className="vp-muted">belum ada job terjadwal</span>}
            </div>

            {runs.length > 0 && (
              <>
                <div className="vp-sub">EKSEKUSI TERAKHIR ({runs.length})</div>
                <div className="flex flex-col gap-1">
                  {runs.slice(0, 12).map((r) => (
                    <div key={r.id} className="vp-cron-run">
                      <span className={`vp-cron-state ${r.status === 'success' ? 'on' : 'off'}`}>
                        {r.status}
                      </span>
                      <i>{r.jobId}</i>
                      <span>{when(r.startedAt)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <label className="vp-sub">JADWAL</label>
            <input
              className="vp-input"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="30m  ·  every 2h  ·  0 9 * * *"
            />

            <label className="vp-sub">PROMPT</label>
            <textarea
              className="vp-input"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="perintah"
            />

            <label className="vp-sub">NAMA (opsional)</label>
            <input
              className="vp-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cek rilis harian"
            />

            <label className="vp-check">
              <input
                type="checkbox"
                checked={liveNow}
                onChange={(e) => setLiveNow(e.target.checked)}
              />
              <span>langsung aktif (kalau tidak dicentang, job dibuat pause dulu)</span>
            </label>

            <button
              className="vp-btn"
              disabled={busy === 'create' || !schedule.trim() || !prompt.trim()}
              onClick={create}
            >
              {busy === 'create' ? 'Membuat…' : 'Buat job'}
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
