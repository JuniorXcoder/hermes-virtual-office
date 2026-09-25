'use client'

import { useState } from 'react'
import { useOffice } from '@/lib/store'

/** Meeting control + live transcript + downloadable minutes. */
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
  const refresh = useOffice((s) => s.refreshMeeting)

  const [topic, setTopic] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [moderator, setModerator] = useState('')
  const [mode, setMode] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!open) return null

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
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const live = meeting && (meeting.state === 'queued' || meeting.state === 'running')

  return (
    <aside className="vp-panel left-0">
      <header className="vp-panel-head">
        <h2>Ruang rapat</h2>
        <button className="vp-x" onClick={onClose} aria-label="Tutup">×</button>
      </header>

      <div className="vp-pad flex flex-col gap-3">
        {!configured && (
          <div className="vp-note">
            LLM belum dikonfigurasi. Isi <code>AI_BASE_URL</code> dan <code>AI_API_KEY</code> di
            <code> .env.local</code>.
          </div>
        )}

        <label className="vp-sub">TOPIK</label>
        <textarea
          className="vp-input"
          rows={2}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="mis. Rencana rilis endpoint refund minggu ini"
        />

        <label className="vp-sub">PESERTA (2–4)</label>
        <div className="flex flex-wrap gap-2">
          {agents.map((a) => (
            <button
              key={a.name}
              className={`vp-chip-btn ${picked.includes(a.name) ? 'on' : ''}`}
              onClick={() => toggle(a.name)}
            >
              {a.displayName}
            </button>
          ))}
          {!agents.length && <span className="vp-muted">belum ada agent</span>}
        </div>

        <label className="vp-sub">PEMBAWA ACARA</label>
        <select className="vp-input" value={moderator} onChange={(e) => setModerator(e.target.value)}>
          {picked.map((p) => (
            <option key={p} value={p}>{p}</option>
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
        {err && <div className="vp-err">{err}</div>}

        {meeting && (
          <>
            <div className="vp-kv">
              <span>status</span>
              <b>{meeting.state} · {meeting.phase}</b>
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
                  className={`vp-turn ${t.speaker === meeting.currentSpeaker && live ? 'talk' : ''}`}
                >
                  <div className="vp-turn-who">
                    {t.speaker}
                    <i>{t.kind}{t.round ? ` · r${t.round}` : ''}</i>
                  </div>
                  <div className="vp-turn-body">{t.text}</div>
                </div>
              ))}
            </div>

            {meeting.minutes && (
              <>
                <div className="vp-sub">NOTULEN</div>
                <pre className="vp-pre">{meeting.minutes}</pre>
                <button
                  className="vp-btn vp-btn-ghost"
                  onClick={() => {
                    const blob = new Blob([meeting.minutes], { type: 'text/markdown' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `notulen-${meeting.id}.md`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Unduh notulen
                </button>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
