/**
 * Shared domain types for Hermes Virtual Office.
 *
 * These are provider-agnostic: every driver (API, mock) must map its raw
 * payloads into these shapes so the UI never learns about a specific backend.
 */

export type TaskStatus = 'todo' | 'ready' | 'running' | 'review' | 'blocked' | 'done'
export type MeetingMode = 'auto' | 'directed' | 'manual'
export type MeetingState = 'queued' | 'running' | 'done' | 'error' | 'idle'

/** A Kanban task as rendered on the office floor. */
export type Task = {
  id: string
  title: string
  status: TaskStatus
  assignee: string | null
  priority: number
  body?: string
  createdAt?: string
  updatedAt?: string
}

/** An agent profile available to staff the office. */
export type Agent = {
  name: string
  displayName: string
  role: AgentRole
  /** Desk slot 0-7, or null when the agent has no station. */
  deskIndex: number | null
  status: AgentStatus
  currentTaskId?: string | null
}

export type AgentRole =
  | 'orchestrator'
  | 'backend'
  | 'frontend'
  | 'qa'
  | 'researcher'
  | 'devops'

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'review'
  | 'blocked'
  | 'meeting'
  | 'done'

export type MeetingTurn = {
  round: number
  speaker: string
  kind: 'opening' | 'speech' | 'minutes'
  text: string
  ts: number
}

export type Meeting = {
  id: string
  topic: string
  participants: string[]
  moderator: string
  mode: MeetingMode
  state: MeetingState
  phase: string
  currentSpeaker: string | null
  turns: MeetingTurn[]
  minutes: string
  file?: string | null
}

/** A meeting transcript stored on disk (see meeting-engine.listArchived). */
export type ArchivedMeeting = {
  id: string
  topic: string
  file: string
  /** YYYY-MM-DD, taken from the filename. */
  startedAt: string
  participants: string[]
  moderator: string
  mode: MeetingMode
  turnCount: number
  /** First transcript line, for the list. */
  preview: string
  archived: true
}

/** A single line of live agent telemetry, shown in the screen-peeker modal. */
export type AgentActivity = {
  agent: string
  taskId?: string | null
  kind: 'command' | 'tool' | 'message' | 'diff'
  detail: string
  ts: number
}

export type NewTaskInput = {
  title: string
  assignee: string
  body?: string
  priority?: number
}

/**
 * The single seam between the office UI and a Hermes installation.
 * Add a new driver by implementing this; nothing else has to change.
 */
export interface HermesDriver {
  readonly kind: 'api' | 'mock'
  listTasks(): Promise<Task[]>
  listAgents(): Promise<Agent[]>
  createTask(input: NewTaskInput): Promise<Task>
  steerTask(taskId: string, message: string): Promise<boolean>
  cancelTask(taskId: string): Promise<boolean>
  /** Recent output for a running task, newest last. */
  taskActivity(taskId: string, limit?: number): Promise<AgentActivity[]>
  startMeeting(input: {
    topic: string
    participants: string[]
    moderator?: string
    mode?: MeetingMode
  }): Promise<Meeting>
  getMeeting(id: string): Promise<Meeting | null>
}
