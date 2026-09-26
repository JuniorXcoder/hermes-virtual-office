'use client'

import { create } from 'zustand'
import type { Agent, ArchivedMeeting, Meeting, Task } from '@/types/hermes'

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_MS || 4000)

type State = {
  tasks: Task[]
  agents: Agent[]
  meeting: Meeting | null
  meetingConfigured: boolean
  /** Archived meetings on disk, newest first. */
  meetingHistory: ArchivedMeeting[]
  /** Id of the archived transcript currently open, if any. */
  meetingArchive: { id: string; body: string } | null
  loading: boolean
  error: string | null
  view: '3d' | '2d'
  peekDesk: number | null
  selectedAgent: string | null
  /** Task opened from the 3D board or the 2D board. */
  openTaskId: string | null
  newTaskOpen: boolean

  load: () => Promise<void>
  setView: (v: '3d' | '2d') => void
  setPeek: (desk: number | null) => void
  openTask: (taskId: string | null) => void
  select: (name: string | null) => void
  setNewTaskOpen: (v: boolean) => void
  refreshMeeting: () => Promise<void>
}

export const useOffice = create<State>((set, get) => ({
  tasks: [],
  agents: [],
  meeting: null,
  meetingConfigured: false,
  meetingHistory: [],
  meetingArchive: null,
  loading: true,
  error: null,
  view: '3d',
  peekDesk: null,
  selectedAgent: null,
  openTaskId: null,
  newTaskOpen: false,

  async load() {
    try {
      const r = await fetch('/api/hermes/tasks', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `HTTP ${r.status}`)
      set({ tasks: d.tasks || [], agents: d.agents || [], error: null, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  async refreshMeeting() {
    try {
      const r = await fetch('/api/hermes/meeting', { cache: 'no-store' })
      const d = await r.json()
      // `live` are meetings in this process; `archived` are the transcripts on
      // disk from this and earlier runs. The picker needs both.
      const list: Meeting[] = d.live || []
      // Only a live meeting may pin agents to the conference table. A finished or
      // failed one still belongs in the panel for its transcript, but the office
      // floor must let those avatars go.
      const active = list.find((m) => m.state === 'queued' || m.state === 'running') ?? null
      set({
        meeting: active ?? list[0] ?? null,
        meetingConfigured: !!d.configured,
        meetingHistory: d.archived || [],
      })
    } catch {
      /* keep the last known meeting on a blip */
    }
  },

  setView: (view) => set({ view }),
  setPeek: (peekDesk) => set({ peekDesk }),
  openTask: (openTaskId) => set({ openTaskId }),
  select: (selectedAgent) => set({ selectedAgent }),
  setNewTaskOpen: (newTaskOpen) => set({ newTaskOpen }),
}))

/** Poll the board; returns a stop function. */
export function startPolling() {
  const tick = () => {
    void useOffice.getState().load()
    void useOffice.getState().refreshMeeting()
  }
  tick()
  const id = setInterval(tick, POLL_MS)
  return () => clearInterval(id)
}
