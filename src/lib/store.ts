'use client'

import { create } from 'zustand'
import type { Agent, ArchivedMeeting, Meeting, Task } from '@/types/hermes'
import type { AvatarState, QaThread } from './office/types'
import { fetchJson } from './api'

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
  view: '3d' | '2d' | 'sprite'
  peekDesk: number | null
  selectedAgent: string | null
  /** Task opened from the 3D board or the 2D board. */
  openTaskId: string | null
  newTaskOpen: boolean

  /** The office's own store (data/office.db), separate from the Hermes CLI data. */
  officeName: string
  avatars: AvatarState[]
  qa: QaThread[]
  /** Open Q&A thread count per responsible — the badge. */
  qaOpen: Record<string, number>

  load: () => Promise<void>
  loadOffice: () => Promise<void>
  setOfficeName: (name: string) => Promise<void>
  setView: (v: '3d' | '2d' | 'sprite') => void
  setPeek: (desk: number | null) => void
  openTask: (taskId: string | null) => void
  select: (name: string | null) => void
  setNewTaskOpen: (v: boolean) => void
  refreshMeeting: () => Promise<void>
}

export const useOffice = create<State>((set) => ({
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

  officeName: 'Hermes Office',
  avatars: [],
  qa: [],
  qaOpen: {},

  async load() {
    const res = await fetchJson<{ tasks?: Task[]; agents?: Agent[] }>('/api/hermes/tasks', {
      cache: 'no-store',
    })
    if (!res.ok || !res.data) {
      set({ error: res.error || 'gagal memuat papan', loading: false })
      return
    }
    set({ tasks: res.data.tasks || [], agents: res.data.agents || [], error: null, loading: false })
  },

  /**
   * The office's own store. Kept separate from `load()` on purpose: a broken
   * Hermes install (tasks/agents failing) must not stop the room from rendering,
   * and this endpoint reads data/office.db, not the CLI.
   */
  async loadOffice() {
    const res = await fetchJson<{
      name?: string
      avatars?: AvatarState[]
      qa?: QaThread[]
      qaOpen?: Record<string, number>
    }>('/api/hermes/office', { cache: 'no-store' })
    if (!res.ok || !res.data) return
    set({
      officeName: res.data.name || 'Hermes Office',
      avatars: res.data.avatars || [],
      qa: res.data.qa || [],
      qaOpen: res.data.qaOpen || {},
    })
  },

  async setOfficeName(name: string) {
    const res = await fetchJson<{ name?: string }>('/api/hermes/office', {
      method: 'POST',
      body: JSON.stringify({ action: 'setName', name }),
    })
    if (res.ok && res.data?.name) set({ officeName: res.data.name })
  },

  async refreshMeeting() {
    // A blip here must not clear the panel: keep the last known meeting and say
    // nothing, because this polls every few seconds and an error banner that
    // flickers on every dropped packet is worse than silence.
    const res = await fetchJson<{
      configured?: boolean
      live?: Meeting[]
      archived?: ArchivedMeeting[]
    }>('/api/hermes/meeting', { cache: 'no-store' })
    if (!res.ok || !res.data) return
    const d = res.data
    // `live` are meetings in this process; `archived` are the transcripts on disk
    // from this and earlier runs. The picker needs both.
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
  },

  setView: (view) => set({ view }),
  setPeek: (peekDesk) => set({ peekDesk }),
  openTask: (openTaskId) => set({ openTaskId }),
  select: (selectedAgent) => set({ selectedAgent }),
  setNewTaskOpen: (newTaskOpen) => set({ newTaskOpen }),
}))

/** Poll the board; returns a stop function. */
export function startPolling() {
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    if (stopped || running) return
    if (document.hidden) return schedule()
    running = true
    try {
      await Promise.all([
        useOffice.getState().load(),
        useOffice.getState().refreshMeeting(),
        useOffice.getState().loadOffice(),
      ])
    } finally {
      running = false
      schedule()
    }
  }
  const schedule = () => {
    if (!stopped) timer = setTimeout(tick, POLL_MS)
  }
  const onVisibility = () => {
    if (!document.hidden) {
      clearTimeout(timer)
      void tick()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  void tick()
  return () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
