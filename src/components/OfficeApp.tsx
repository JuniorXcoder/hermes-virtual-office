'use client'

import { useEffect, useRef, useState } from 'react'
import Scene3D from './Scene3D'
import Kanban2D from './Kanban2D'
import PeekPanel from './PeekPanel'
import TaskPanel from './TaskPanel'
import MeetingPanel from './MeetingPanel'
import NewTaskDialog from './NewTaskDialog'
import { startPolling, useOffice } from '@/lib/store'
import type { OfficeScene } from '@/lib/office/scene'

export default function OfficeApp() {
  const view = useOffice((s) => s.view)
  const setView = useOffice((s) => s.setView)
  const setNewTaskOpen = useOffice((s) => s.setNewTaskOpen)
  const tasks = useOffice((s) => s.tasks)
  const agents = useOffice((s) => s.agents)
  const error = useOffice((s) => s.error)
  const meeting = useOffice((s) => s.meeting)
  const select = useOffice((s) => s.select)
  const selected = useOffice((s) => s.selectedAgent)

  const sceneRef = useRef<OfficeScene | null>(null)
  const [meetOpen, setMeetOpen] = useState(false)

  useEffect(() => startPolling(), [])

  // request browser notification permission once, then alert on review/blocked
  const seen = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    for (const t of tasks) {
      const prev = seen.current.get(t.id)
      if (prev && prev !== t.status && (t.status === 'review' || t.status === 'blocked')) {
        new Notification(`Kanban · ${t.status}`, { body: t.title })
      }
      seen.current.set(t.id, t.status)
    }
  }, [tasks])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (e.key === 'm' || e.key === 'M') setMeetOpen((v) => !v)
      if (e.key === 'n' || e.key === 'N') setNewTaskOpen(true)
      if (e.key === '3') setView('3d')
      if (e.key === '2') setView('2d')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setView, setNewTaskOpen])

  const backendOnline = !error
  const activeAgents = agents.filter((a) => a.status !== 'idle').length
  const running = tasks.filter((t) => t.status === 'running').length
  const done = tasks.filter((t) => t.status === 'done').length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0f1418]">
      {view === '3d' ? (
        <Scene3D onScene={(s) => (sceneRef.current = s)} />
      ) : (
        <Kanban2D />
      )}

      {/* ------------------------------------------------------- top bar */}
      <header className="vp-topbar">
        <div className="flex items-center gap-3">
          <span className="vp-logo">Hermes Office</span>
          <span className={`vp-dot ${backendOnline ? 'ok' : 'bad'}`} />
          <span className="vp-muted">
            {backendOnline ? `${agents.length} agent · ${running} jalan · ${pct}% rilis` : 'backend offline'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button className="vp-btn vp-btn-ghost" onClick={() => setNewTaskOpen(true)}>+ Tugas</button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setMeetOpen(true)}>
            Ruang rapat{meeting && meeting.state === 'running' ? ' ●' : ''}
          </button>
          <div className="vp-seg">
            <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>3D</button>
            <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>2D</button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------- agent card */}
      {selected && (() => {
        const a = agents.find((x) => x.name === selected)
        const t = tasks.find((x) => x.id === a?.currentTaskId)
        if (!a) return null
        return (
          <aside className="vp-card-float">
            <div className="flex items-center justify-between">
              <b>{a.displayName}</b>
              <button className="vp-x" onClick={() => select(null)}>×</button>
            </div>
            <div className="vp-kv"><span>peran</span><b>{a.role}</b></div>
            <div className="vp-kv"><span>status</span><b>{a.status}</b></div>
            <div className="vp-kv"><span>tugas</span><b>{t?.title || '—'}</b></div>
          </aside>
        )
      })()}

      {/* ------------------------------------------------------- footer hint */}
      {view === '3d' && (
        <footer className="vp-hint">
          seret = putar · scroll = zoom · klik avatar = detail · klik monitor = intip layar ·
          <kbd>N</kbd> tugas · <kbd>M</kbd> rapat · <kbd>2</kbd>/<kbd>3</kbd> ganti tampilan
        </footer>
      )}

      <TaskPanel />
      <PeekPanel />
      <MeetingPanel open={meetOpen} onClose={() => setMeetOpen(false)} />
      <NewTaskDialog />

      {error && (
        <div className="vp-banner">
          {error}
        </div>
      )}
    </div>
  )
}
