'use client'

import { useEffect, useRef } from 'react'
import { createScene, type OfficeScene } from '@/lib/office/scene'
import { useOffice } from '@/lib/store'

type Props = { onScene: (s: OfficeScene | null) => void }

export default function Scene3D({ onScene }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<OfficeScene | null>(null)

  const agents = useOffice((s) => s.agents)
  const tasks = useOffice((s) => s.tasks)
  const meeting = useOffice((s) => s.meeting)
  const setPeek = useOffice((s) => s.setPeek)
  const select = useOffice((s) => s.select)
  const openTask = useOffice((s) => s.openTask)

  useEffect(() => {
    if (!canvasRef.current || !labelRef.current) return
    const scene = createScene(canvasRef.current, labelRef.current, {
      onMonitorClick: (desk) => setPeek(desk),
      onAvatarClick: (name) => select(name),
      onTaskClick: (taskId) => openTask(taskId),
    })
    sceneRef.current = scene
    onScene(scene)
    // E2E/debug handle: lets tests drive picking and read avatar state without
    // guessing canvas pixels. Opt-in so production pages stay clean.
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

  // push new rosters in without rebuilding the world
  useEffect(() => {
    sceneRef.current?.syncAgents(agents)
  }, [agents])

  useEffect(() => {
    sceneRef.current?.setTasks(tasks)
  }, [tasks])

  useEffect(() => {
    sceneRef.current?.setMeeting(meeting)
  }, [meeting])

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
