'use client'

import { useState } from 'react'
import { useOffice } from '@/lib/store'

/**
 * Meeting room.
 *
 * Two screens: a LIST of meeting cards and the CREATE form.
 *
 * Every meeting is a CARD, including the one running right now. Nothing expands
 * inline — a live meeting used to render its whole transcript straight into the
 * list, so the list was dominated by the newest meeting and the older ones were
 * pushed off screen. A card opens on click, live or archived.
 */
export default function MeetingPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const agents = useOffice((s) => s.agents)
  const meeting = useOffice((s) => s.meeting)
  const configured = useOffice((s) => s.meetingConfigured)
  const history = useOffice((s) => s.meetingHistory)
  const refresh = useOffice((s) => s.refreshMeeting)

  const [screen, setScreen] = useState<'list' | 'new'>('list')
  const [topic, setTopic] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [moderator, setModerator] = useState('')
  const [mode, setMode] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /**
   * Which card is open. A live meeting reads from its in-memory record; an
   * archived one is fetched by id. `kind` decides which.
   */
  const [opened, setOpened] = useState<{ kind: 'live' | 'archive'; id: string } | null>(null)
  const [archive, setArchive] = useState<{ id: string; body: string } | null>(null)
  const [archBusy, setArchBusy] = useState(false)

  if (!open) return null

  const live = meeting && (meeting.state === 'queued' || meeting.state === 'running')

  const toggle = (name: string) => {
    setPicked((p) => {
      if (p.includes(name)) {
        const next = p.filter((x) => x !== name)
        if (moderator === name) setModerator(next[0] || '')
        return next
      }
      if (p.length >= 4) return p
      const next = [...p, name]
      if (!moderator) setModerator(name)
      return next
    })
  }

  async function start() {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/hermes/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, participants: picked, moderator, mode }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      await refresh()
      setTopic('')
      setPicked([])
      setModerator('')
      setScreen('list')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function openArchive(id: string) {
    setArchBusy(true)
    setErr(null)
    setOpened({ kind: 'archive', id })
    setArchive(null)
    try {
      const r = await fetch(`/api/hermes/meeting?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      setArchive({ id: d.id, body: d.body })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setArchBusy(false)
    }
  }

  function closeCard() {
    setOpened(null)
    setArchive(null)
  }

  function download(name: string, text: string) {
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  /** One card in the list. */
  function Card({
    title,
    meta,
    highlight,
    onClick,
    disabled,
  }: {
    title: string
    meta: string
    highlight?: boolean
    onClick: () => void
    disabled?: boolean
  }) {
    return (
      <button
        className={`vp-meeting-row ${highlight ? 'on' : ''}`}
        onClick={onClick}
        disabled={disabled}
      >
        <b>{title}</b>
        <i>{meta}</i>
      </button>
    )
  }

  return (
    <aside className="vp-panel left-0">
      <header className="vp-panel-head">
        <h2>{screen === 'new' ? 'Rapat baru' : 'Ruang rapat'}</h2>
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

        {screen === 'list' ? (
          opened ? (
            /* ------------------------------------------------ opened card ---- */
            <>
              <button className="vp-chip-btn" onClick={closeCard}>
                ← Daftar rapat
              </button>

              {opened.kind === 'archive' ? (
                archBusy || !archive ? (
                  <div className="vp-muted">memuat transkrip…</div>
                ) : (
                  <>
                    <div className="vp-sub">TRANSKRIP · {archive.id}</div>
                    <pre className="vp-pre">{archive.body}</pre>
                    <button
                      className="vp-btn vp-btn-ghost"
                      onClick={() => download(`rapat-${archive.id}.md`, archive.body)}
                    >
                      Unduh
                    </button>
                  </>
                )
              ) : !meeting ? (
                <div className="vp-muted">rapat ini sudah tidak ada di memori</div>
              ) : (
                <>
                  <div className="vp-kv">
                    <span>topik</span>
                    <b>{meeting.topic || '(tanpa topik)'}</b>
                  </div>
                  <div className="vp-kv">
                    <span>status</span>
                    <b>
                      {meeting.state} · {meeting.phase}
                      {live && <span className="vp-live"> ●</span>}
                    </b>
                  </div>
                  <div className="vp-kv">
                    <span>peserta</span>
                    <b>{meeting.participants.join(', ') || '—'}</b>
                  </div>
                  <div className="vp-kv">
                    <span>giliran</span>
                    <b>{meeting.currentSpeaker || '—'}</b>
                  </div>

                  <div className="vp-sub">TRANSKRIP ({meeting.turns.length})</div>
                  <div className="flex flex-col gap-2">
                    {meeting.turns.map((t, i) => (
                      <div
                        key={i}
                        className={`vp-turn ${
                          t.speaker === meeting.currentSpeaker && live ? 'talk' : ''
                        }`}
                      >
                        <div className="vp-turn-who">
                          {t.speaker}
                          <i>
                            {t.kind}
                            {t.round ? ` · r${t.round}` : ''}
                          </i>
                        </div>
                        <div className="vp-turn-body">{t.text}</div>
                      </div>
                    ))}
                    {!meeting.turns.length && (
                      <span className="vp-muted">belum ada giliran</span>
                    )}
                  </div>

                  {meeting.minutes && (
                    <>
                      <div className="vp-sub">NOTULEN</div>
                      <pre className="vp-pre">{meeting.minutes}</pre>
                      <button
                        className="vp-btn vp-btn-ghost"
                        onClick={() => download(`notulen-${meeting.id}.md`, meeting.minutes)}
                      >
                        Unduh notulen
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            /* ------------------------------------------------ the list ------ */
            <>
              <button className="vp-btn" onClick={() => setScreen('new')}>
                + Buat rapat baru
              </button>
              {!configured && (
                <div className="vp-note">
                  LLM belum dikonfigurasi — rapat tidak bisa dimulai. Isi{' '}
                  <code>AI_BASE_URL</code> dan <code>AI_API_KEY</code> di{' '}
                  <code>.env.local</code>.
                </div>
              )}

              {meeting && (
                <>
                  <div className="vp-sub">
                    RAPAT AKTIF {live && <span className="vp-live">●</span>}
                  </div>
                  <Card
                    title={meeting.topic || '(tanpa topik)'}
                    meta={`${meeting.state} · ${meeting.participants.length} peserta · ${meeting.turns.length} giliran`}
                    highlight={!!live}
                    onClick={() => setOpened({ kind: 'live', id: meeting.id })}
                  />
                </>
              )}

              <div className="vp-sub">RAPAT TERDAHULU ({history.length})</div>
              <div className="flex flex-col gap-2">
                {history.map((h) => (
                  <Card
                    key={h.id}
                    title={h.topic}
                    meta={`${h.startedAt} · ${h.participants.length || '?'} peserta · ${h.turnCount} giliran`}
                    disabled={archBusy}
                    onClick={() => openArchive(h.id)}
                  />
                ))}
                {!history.length && (
                  <span className="vp-muted">belum ada rapat tersimpan</span>
                )}
              </div>
            </>
          )
        ) : (
          /* ---------------------------------------------------- create form -- */
          <>
            <label className="vp-sub">TOPIK</label>
            <textarea
              className="vp-input"
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Rencana rilis endpoint refund"
            />

            <label className="vp-sub">PESERTA (2–4) · {agents.length} agent aktif</label>
            <div className="flex flex-wrap gap-2">
              {agents.map((a) => (
                <button
                  key={a.name}
                  className={`vp-chip-btn ${picked.includes(a.name) ? 'on' : ''}`}
                  onClick={() => toggle(a.name)}
                >
                  {a.displayName}
                  <i className="vp-chip-role">{a.status}</i>
                </button>
              ))}
              {!agents.length && <span className="vp-muted">belum ada agent aktif</span>}
            </div>

            <label className="vp-sub">PEMBAWA ACARA</label>
            <select
              className="vp-input"
              value={moderator}
              onChange={(e) => setModerator(e.target.value)}
            >
              {picked.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <label className="vp-sub">MODE</label>
            <select className="vp-input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="auto">auto — semua bicara bergiliran</option>
              <option value="directed">directed — hanya yang ditunjuk</option>
              <option value="manual">manual — hanya yang disebut namanya</option>
            </select>

            <button
              className="vp-btn"
              disabled={busy || !topic.trim() || picked.length < 2 || !configured}
              onClick={start}
            >
              {busy ? 'Memulai…' : 'Mulai rapat'}
            </button>
            {picked.length < 2 && <div className="vp-muted">pilih minimal 2 peserta</div>}
          </>
        )}
      </div>
    </aside>
  )
}
