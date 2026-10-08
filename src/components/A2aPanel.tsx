'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import FullPanel from './FullPanel'
import type { A2aConversation, A2aOutbound, A2aTranscript } from '@/lib/hermes/a2a-transcript'

/**
 * Percakapan agent-to-agent (protokol A2A) — BUKAN rapat scripted.
 *
 * Rapat di Ruang rapat = notulen LLM yang dijadwalkan operator (meeting.ts).
 * Panel ini = panggilan antar-agent yang dijawab sebagai dirinya sendiri
 * (sesi source='a2a' + arsip ctx-*.jsonl). Label "agent-ke-agent" selalu
 * ditampilkan supaya operator tidak mengiranya rapat.
 */

/** Ambang "basi" — sama dengan STALE_LOG di SystemPanel (10 menit untuk log). */
const STALE_SEC = 600

function age(iso: string): number | null {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 1000)) : null
}

function ageText(sec: number): string {
  if (sec < 60) return `${sec} dtk lalu`
  if (sec < 3600) return `${Math.floor(sec / 60)} mnt lalu`
  return `${Math.floor(sec / 3600)} jam lalu`
}

function clock(ts: number | null): string {
  if (ts === null) return ''
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

function Conv({ c }: { c: A2aConversation }) {
  const [open, setOpen] = useState(false)
  const last = c.lastAt !== null ? ageText(Math.max(0, Math.floor((Date.now() - c.lastAt) / 1000))) : 'waktu tak tercatat'
  return (
    <div className="vp-meeting-row" style={{ cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
      <div className="flex items-center justify-between gap-2">
        <b>
          {c.agent} <span className="vp-muted">← {c.caller ?? 'pemanggil tak tercatat'}</span>
        </b>
        <i>
          {open ? '▾' : '▸'} {c.messages.length} pesan · {last}
        </i>
      </div>
      <div className="vp-note">
        agent-ke-agent · {c.ctx} · sumber: {c.origin.join(' + ')}
      </div>
      {open && (
        <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
          {c.messages.map((m, i) => (
            <div key={i} className={`vp-msg ${m.from === 'agent' ? 'assistant' : 'user'}`}>
              <div className="vp-msg-body">
                <b>{m.from === 'agent' ? c.agent : (c.caller ?? 'pemanggil')}:</b> {m.text}
              </div>
              <div className="vp-msg-time">{clock(m.ts)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function A2aPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<A2aTranscript | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    const res = await fetchJson<A2aTranscript>('/api/hermes/a2a/transcript', { cache: 'no-store' })
    if (!res.ok) setErr(res.error || 'gagal memuat transcript A2A')
    else setData(res.data ?? null)
    setLoading(false)
  }

  useEffect(() => {
    if (open) void load()
  }, [open ])

  if (!open) return null

  const sec = data ? age(data.readAt) : null
  const stale = sec !== null && sec > STALE_SEC

  return (
    <FullPanel
      onClose={onClose}
      label="Percakapan agent-ke-agent"
      title="Agent-ke-agent"
      tall
      actions={
        <button className="vp-chip-btn" onClick={() => void load()} disabled={loading}>
          {loading ? '…' : 'Muat ulang'}
        </button>
      }
    >
      {err && <div className="vp-err">{err}</div>}
      {loading && !data && <div className="vp-muted">memuat transcript A2A…</div>}
      {data && (
        <>
          <div className="vp-note">
            BUKAN rapat scripted — ini panggilan antar-agent lewat protokol A2A, dijawab sebagai
            dirinya sendiri.{' '}
            {sec !== null && (
              <span>
                dibaca {ageText(sec)}
                {stale && ' — BASI (lebih dari 10 menit), muat ulang untuk keadaan terbaru'}
              </span>
            )}
          </div>
          {data.unreadable.length > 0 && (
            <div className="vp-err">
              tak terbaca (bukan "tidak ada percakapan"): {data.unreadable.join(', ')}
            </div>
          )}
          {data.ctxDir === 'missing' && (
            <div className="vp-err">arsip a2a_conversations tidak ada — hanya sesi yang tampil</div>
          )}
          {!data.conversations.length && !data.outbound.length && !data.unreadable.length ? (
            <div className="vp-muted">belum ada percakapan agent-ke-agent yang tercatat.</div>
          ) : null}
          {data.conversations.map((c) => (
            <Conv key={`${c.agent}-${c.ctx}`} c={c} />
          ))}
          {data.outbound.length > 0 && (
            <>
              <div className="vp-note" style={{ marginTop: 8 }}>
                <b>Panggilan keluar</b> (agent kantor memanggil peer — jejak tool a2a_call):
              </div>
              {data.outbound.map((o: A2aOutbound, i: number) => (
                <div key={i} className="vp-meeting-row">
                  <b>
                    {o.agent} → {o.peer}
                  </b>
                  <div className="vp-msg-body">{o.task}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </FullPanel>
  )
}
