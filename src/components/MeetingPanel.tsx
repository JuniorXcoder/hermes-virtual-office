'use client'

import { useState } from 'react'
import { useOffice } from '@/lib/store'

/**
 * Meeting room.
 *
 * Two screens behind one panel: a LIST of meetings (live in this process, plus
 * the transcripts on disk from earlier runs) and the CREATE form. The list comes
 * first because starting a meeting is the rarer action — and because a meeting
 * cannot be started at all until you can see which agents exist, which is what
 * the create screen shows once you open it.
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

  function download(name: string, text: string) {
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
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
          <>
            {/* ---- the transcript the user just opened ---- */}
            {archive ? (
              <>
                <button className="vp-chip-btn" onClick={() => setArchive(null)}>
                  ← Daftar rapat
                </button>
                <div className="vp-sub">TRANSKRIP · {archive.id}</div>
                <pre className="vp-pre">{archive.body}</pre>
                <button
                  className="vp-btn vp-btn-ghost"
                  onClick={() => download(`rapat-${archive.id}.md`, archive.body)}
                >
                  Unduh
                </button>
              </>
            ) : (
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

                {/* ---- live in this process ---- */}
                {meeting && (
                  <>
                    <div className="vp-sub">
                      SEDANG BERJALAN {live && <span className="vp-live">●</span>}
                    </div>
                    <button
                      className={`vp-meeting-row ${live ? 'on' : ''}`}
                      onClick={() => setArchive(null)}
                    >
                      <b>{meeting.topic || '(tanpa topik)'}</b>
                      <i>
                        {meeting.state} · {meeting.participants.length} peserta ·{' '}
                        {meeting.turns.length} giliran
                      </i>
                    </button>

                    <div className="vp-sub">GILIRAN</div>
                    <div className="flex flex-col gap-2">
                      {meeting.turns.map((t, i) => (
                        <div
                          key={i}
                          className={`vp-turn ${t.speaker === meeting.currentSpeaker && live ? 'talk' : ''}`}
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
                      {!meeting.turns.length && <span className="vp-muted">belum ada giliran</span>}
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

                {/* ---- on disk, from this or an earlier run ---- */}
                <div className="vp-sub">RAPAT TERDAHULU ({history.length})</div>
                <div className="flex flex-col gap-2">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      className="vp-meeting-row"
                      disabled={archBusy}
                      onClick={() => openArchive(h.id)}
                    >
                      <b>{h.topic}</b>
                      <i>
                        {h.startedAt} · {h.participants.length || '?'} peserta · {h.turnCount} giliran
                      </i>
                    </button>
                  ))}
                  {!history.length && (
                    <span className="vp-muted">belum ada rapat tersimpan</span>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* ---- create form. Agents are listed HERE, so the user can see who
                    is actually available before picking participants. ---- */}
            <label className="vp-sub">TOPIK</label>
            <textarea
              className="vp-input"
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="mis. Rencana rilis endpoint refund minggu ini"
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
            <select className="vp-input" value={moderator} onChange={(e) => setModerator(e.target.value)}>
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
            {picked.length < 2 && (
              <div className="vp-muted">pilih minimal 2 peserta</div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
