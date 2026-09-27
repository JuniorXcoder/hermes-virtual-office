'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchJson } from '@/lib/api'

/**
 * Chat with an agent.
 *
 * The conversation lives in Hermes' own session store, so memory is real and
 * survives a restart of this app: sending resumes the agent's existing session.
 * This panel is a view over that — it does not keep its own copy of the history,
 * because two copies of "what was said" would drift.
 *
 * One thread per agent, which is what "one session per agent" means in practice:
 * `agent` is the key, and its session id is the memory handle.
 */

type Message = {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  ts: number
}

type Session = {
  id: string
  agent: string
  profile: string
  title: string
  updatedAt: string
  messageCount: number
}

/** Same human-readable relative time the cron panel uses. */
function when(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'baru saja'
  if (mins < 60) return `${mins} mnt lalu`
  if (diff < 86_400_000) return `${Math.round(mins / 60)} jam lalu`
  return `${Math.round(diff / 86_400_000)} hari lalu`
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [profiles, setProfiles] = useState<string[]>([])

  /** null = the thread list; a name = that agent's conversation. */
  const [openAgent, setOpenAgent] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [session, setSession] = useState<Session | null>(null)

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [profile, setProfile] = useState('')

  const scroller = useRef<HTMLDivElement | null>(null)

  async function loadList() {
    setLoading(true)
    setErr(null)
    const res = await fetchJson<{
      sessions?: Session[]
      agents?: string[]
      profiles?: string[]
    }>('/api/hermes/chat', { cache: 'no-store' })
    if (!res.ok) {
      setErr(res.error || 'gagal memuat daftar percakapan')
      setLoading(false)
      return
    }
    setSessions(res.data?.sessions || [])
    setAgents(res.data?.agents || [])
    setProfiles(res.data?.profiles || [])
    setLoading(false)
  }

  useEffect(() => {
    if (open) void loadList()
  }, [open])

  // Load a thread when one is opened. This is the only place history enters the
  // panel: it comes from the CLI, not from local state.
  useEffect(() => {
    if (!openAgent) {
      setMessages([])
      setSession(null)
      return
    }
    let alive = true
    setLoading(true)
    setErr(null)
    fetchJson<{ session: Session | null; messages?: Message[] }>(
      `/api/hermes/chat?agent=${encodeURIComponent(openAgent)}`,
      { cache: 'no-store' },
    )
      .then((res) => {
        if (!alive) return
        if (!res.ok) {
          setErr(res.error || 'gagal memuat percakapan')
          return
        }
        setSession(res.data?.session ?? null)
        setMessages(res.data?.messages || [])
        setProfile(res.data?.session?.profile || '')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [openAgent])

  // Keep the newest message in view.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  async function send() {
    const text = draft.trim()
    if (!text || !openAgent || busy) return
    setBusy(true)
    setErr(null)
    // Show the message immediately: the reply can take many seconds because the
    // agent may run tools, and an input that looks frozen reads as broken.
    setMessages((m) => [...m, { role: 'user', content: text, ts: Date.now() }])
    setDraft('')
    try {
      const res = await fetchJson<{ session: Session; reply: string }>('/api/hermes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: openAgent, message: text, profile: profile || undefined }),
      })
      if (!res.ok || !res.data) {
        setErr(res.error || 'agent tidak menjawab')
        // Roll the optimistic bubble back, so the transcript matches what the agent
        // actually received.
        setMessages((m) => m.slice(0, -1))
        setDraft(text)
        return
      }
      setSession(res.data.session)
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.data!.reply || '(kosong)', ts: Date.now() },
      ])
      setProfile(res.data.session.profile)
      void loadList()
    } finally {
      setBusy(false)
    }
  }

  async function resetThread() {
    if (!openAgent) return
    setBusy(true)
    setErr(null)
    const res = await fetchJson(`/api/hermes/chat?agent=${encodeURIComponent(openAgent)}`, {
      method: 'DELETE',
    })
    if (!res.ok) setErr(res.error || 'gagal menghapus thread')
    setMessages([])
    setSession(null)
    setBusy(false)
    void loadList()
  }

  if (!open) return null

  /** Agents with a thread, plus the ones that could start one. */
  const started = new Set(sessions.map((s) => s.agent))
  const notStarted = agents.filter((a) => !started.has(a))

  return (
    <aside className="vp-panel right-0 vp-chat">
      <header className="vp-panel-head">
        <h2>{openAgent ? `Chat · ${openAgent}` : 'Chat'}</h2>
        <div className="flex items-center gap-2">
          {openAgent && (
            <button className="vp-chip-btn" onClick={() => setOpenAgent(null)}>
              ← Semua
            </button>
          )}
          <button className="vp-x" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
      </header>

      <div className="vp-pad flex flex-col gap-3 vp-chat-body">
        {err && <div className="vp-err">{err}</div>}

        {!openAgent ? (
          /* ------------------------------------------------- the thread list -- */
          <>
            {loading && <div className="vp-muted">memuat…</div>}

            <div className="vp-sub">PERCAKAPAN ({sessions.length})</div>
            <div className="flex flex-col gap-2">
              {sessions.map((s) => (
                <button key={s.agent} className="vp-chat-card" onClick={() => setOpenAgent(s.agent)}>
                  <div className="vp-chat-card-top">
                    <b>{s.agent}</b>
                    <span className="vp-muted">{when(s.updatedAt)}</span>
                  </div>
                  <div className="vp-chat-card-title">{s.title}</div>
                  <div className="vp-card-meta">
                    <span className="vp-chip">{s.profile}</span>
                    <span className="vp-muted">{s.messageCount} pesan</span>
                  </div>
                </button>
              ))}
              {!loading && !sessions.length && (
                <div className="vp-muted">belum ada percakapan</div>
              )}
            </div>

            {notStarted.length > 0 && (
              <>
                <div className="vp-sub">MULAI DENGAN</div>
                <div className="flex flex-wrap gap-2">
                  {notStarted.map((a) => (
                    <button key={a} className="vp-chip-btn" onClick={() => setOpenAgent(a)}>
                      {a}
                    </button>
                  ))}
                </div>
              </>
            )}

            {profiles.length > 0 && (
              <>
                <div className="vp-sub">PROFIL UNTUK CHAT BARU</div>
                <select
                  className="vp-input"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  {profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                      {p === 'office-chat' ? ' (ringkas)' : ''}
                    </option>
                  ))}
                </select>
                <div className="vp-note">
                  Percakapan disimpan di session store Hermes — memory-nya nyata dan
                  bertahan setelah aplikasi ini restart. Satu thread per agent.
                </div>
              </>
            )}
          </>
        ) : (
          /* ------------------------------------------------- the conversation -- */
          <>
            <div className="vp-chat-meta">
              {session ? (
                <>
                  <span className="vp-chip">{session.profile}</span>
                  <code>{session.id}</code>
                  <button className="vp-chip-btn" disabled={busy} onClick={resetThread}>
                    Hapus thread
                  </button>
                </>
              ) : (
                <span className="vp-muted">percakapan baru — pesan pertama akan membuatnya</span>
              )}
            </div>

            <div className="vp-chat-scroll" ref={scroller}>
              {loading && <div className="vp-muted">memuat riwayat…</div>}
              {!loading && !messages.length && (
                <div className="vp-muted">belum ada pesan</div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`vp-msg ${m.role}`}>
                  <div className="vp-msg-body">{m.content}</div>
                  <div className="vp-msg-time">{clock(m.ts)}</div>
                </div>
              ))}
              {busy && (
                <div className="vp-msg assistant">
                  <div className="vp-msg-body vp-muted">sedang bekerja…</div>
                </div>
              )}
            </div>

            <div className="vp-chat-input">
              <textarea
                className="vp-input"
                rows={2}
                value={draft}
                placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <button className="vp-btn" disabled={busy || !draft.trim()} onClick={send}>
                {busy ? '…' : 'Kirim'}
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
