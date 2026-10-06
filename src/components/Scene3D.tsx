'use client'

import { useEffect, useRef } from 'react'
import { createScene, type OfficeScene } from '@/lib/office/scene'
import { useOffice } from '@/lib/store'
import type { AgentDivision } from '@/types/hermes'

type Props = {
  onScene: (s: OfficeScene | null) => void
  /** A dummy avatar was clicked — the panel offers to spawn a real agent. */
  onDummy: (avatarId: string, division: AgentDivision) => void
  /** The green whiteboard was clicked — open the full Kanban modal. */
  onBoard: () => void
  /** The office name plate was clicked — open the rename field. */
  onName: () => void
}

export default function Scene3D({ onScene, onDummy, onBoard, onName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<OfficeScene | null>(null)

  const agents = useOffice((s) => s.agents)
  const avatars = useOffice((s) => s.avatars)
  const tasks = useOffice((s) => s.tasks)
  const meeting = useOffice((s) => s.meeting)
  const view = useOffice((s) => s.view)
  const setPeek = useOffice((s) => s.setPeek)
  const select = useOffice((s) => s.select)
  const openTask = useOffice((s) => s.openTask)
  const saveAvatars = useOffice((s) => s.saveAvatars)

  // Handlers live in a ref so the scene is created ONCE but always calls the
  // latest callback — recreating the WebGL context on every render is not an
  // option, and a stale closure here means a click that does nothing.
  const cb = useRef({ onDummy, onBoard, onName, openTask, setPeek, select, saveAvatars })
  cb.current = { onDummy, onBoard, onName, openTask, setPeek, select, saveAvatars }

  useEffect(() => {
    if (!canvasRef.current || !labelRef.current) return
    const scene = createScene(canvasRef.current, labelRef.current, {
      onMonitorClick: (desk) => cb.current.setPeek(desk),
      onAvatarClick: (name) => cb.current.select(name),
      onTaskClick: (taskId) => cb.current.openTask(taskId),
      onDummyClick: (avatarId, division) => cb.current.onDummy(avatarId, division),
      onBoardClick: () => cb.current.onBoard(),
      onNameClick: () => cb.current.onName(),
      onSaveAvatars: (list) => void cb.current.saveAvatars(list),
    })
    sceneRef.current = scene
    onScene(scene)
    if (process.env.NEXT_PUBLIC_E2E_HOOK === '1') {
      ;(window as unknown as { __office?: OfficeScene }).__office = scene
    }
    scene.start()

    const parent = canvasRef.current.parentElement!
    const ro = new ResizeObserver(() => scene.resize(parent.clientWidth, parent.clientHeight))
    ro.observe(parent)
    scene.resize(parent.clientWidth, parent.clientHeight)

    return () => {
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
      onScene(null)
    }
    // deliberately once: the scene outlives individual state updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Avatars come from the DB (dummies included) and the roster decides which of
  // them are real agents. Both feed one reconcile so a name can never be drawn
  // twice.
  useEffect(() => {
    sceneRef.current?.syncAvatars(avatars, agents)
  }, [avatars, agents])

  useEffect(() => {
    sceneRef.current?.setTasks(tasks)
  }, [tasks])

  useEffect(() => {
    sceneRef.current?.setMeeting(meeting)
  }, [meeting])

  useEffect(() => {
    if (view === '3d') sceneRef.current?.start()
    else sceneRef.current?.stop()
  }, [view])

  // relay new meeting turns into speech bubbles
  const said = useRef(0)
  useEffect(() => {
    const s = sceneRef.current
    if (!s || !meeting) return
    const turns = meeting.turns || []
    for (let i = said.current; i < turns.length; i++) {
      const t = turns[i]
      if (t.kind === 'minutes') {
        s.say(meeting.moderator, 'notulen siap — lihat panel')
      } else {
        const label = t.kind === 'opening' ? 'membuka rapat' : t.text.slice(0, 140)
        s.say(t.speaker, label, 9000)
      }
    }
    said.current = turns.length
    if (!turns.length) said.current = 0
  }, [meeting])

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div ref={labelRef} className="pointer-events-none absolute inset-0" />
    </div>
  )
}
