/**
 * Shared domain types for Hermes Virtual Office.
 *
 * These are provider-agnostic: every driver (API, mock) must map its raw
 * payloads into these shapes so the UI never learns about a specific backend.
 */

/** Every status the CLI can emit; the UI groups them into its columns. */
export type TaskStatus =
  | 'todo'
  | 'triage'
  | 'ready'
  | 'scheduled'
  | 'running'
  | 'review'
  | 'blocked'
  | 'done'
  | 'archived'
/** Only one mode is implemented; the meeting route rejects anything else. */
export type MeetingMode = 'auto'
export type MeetingState = 'queued' | 'running' | 'done' | 'error' | 'idle'

/**
 * Where a task came from.
 *
 * The board is one shared surface that every other menu writes to: a meeting
 * produces follow-ups, a cron job produces checks. Without a recorded origin the
 * board is a flat pile and you cannot tell which meeting asked for what, or get
 * back to it. `created_by` is a free-text field on the CLI, so the marker lives
 * there and is parsed back out — no schema change needed.
 *
 * Format: `kind:ref`, e.g. `meeting:m1759...`, `cron:daily-report`, `agent:jun`.
 */
export type TaskOrigin = {
  kind: 'meeting' | 'cron' | 'agent' | 'manual'
  /** Meeting id, cron job id, or agent name. Absent for `manual`. */
  ref?: string
  /** Raw `created_by` value, for display when it does not parse. */
  raw?: string
}

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
  /** Kapan task menjadi `done`, dari `completed_at` CLI. Kosong bila belum/tak diketahui. */
  completedAt?: string
  /** Where this task came from, when it is known. */
  origin?: TaskOrigin
  /** Model pinned to this task's worker; null/undefined means the profile default. */
  model?: string | null
  /** Provider that owns `model`, when one was pinned with it. */
  provider?: string | null
  /**
   * Ids of the tasks this one waits for, from `kanban show`.
   *
   * The board has a real dependency edge: `auto-decomposer` splits a task into
   * children and parks the parent until every child is `done`. Without the ids in
   * the payload the UI can only say "waiting for prerequisites", which names
   * nothing — the one thing the reader needs to act.
   */
  parents?: string[]
}

/**
 * One follow-up item parsed out of a meeting's minutes, or supplied by a cron job.
 * This is the unit the UI offers as "make this a task".
 */
export type ActionItem = {
  /** Who the minutes named as owner, or '' when unspecified. */
  owner: string
  /** The deliverable, as written. */
  text: string
  /** Deadline, when the minutes gave one. */
  due?: string
}

/** An agent profile available to staff the office. */
export type Agent = {
  name: string
  displayName: string
  role: AgentRole
  /** Division the agent belongs to; null when unknown (old profile, no soul). */
  division: AgentDivision | null
  /** True when the profile has its own SOUL.md on disk. */
  soulExists?: boolean
  /** Desk slot, or null when the agent has no station. */
  deskIndex: number | null
  status: AgentStatus
  currentTaskId?: string | null
  /** The profile's default model — what its workers and chats run. */
  model?: string | null
}

/**
 * Division grouping above roles:
 * - exec: CEO/orchestrator — keputusan & orkestrasi
 * - tech: Developer & Infrastructure — backend/frontend/qa/researcher/devops
 * - growth: Marketing & SEO
 * - content: Content Creator & Affiliator
 */
export type AgentDivision = 'exec' | 'tech' | 'growth' | 'content'

export const DIVISION_LABEL: Record<AgentDivision, string> = {
  exec: 'Eksekutif',
  tech: 'Developer & Infrastructure',
  growth: 'Marketing & SEO',
  content: 'Content Creator & Affiliator',
}

export type AgentRole =
  | 'ceo'
  | 'orchestrator'
  /** Division lead. Every staff member reports to one (poin 3). */
  | 'manager'
  | 'backend'
  | 'frontend'
  | 'qa'
  | 'researcher'
  | 'devops'
  | 'marketing'
  | 'seo'
  | 'content'
  | 'affiliator'

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

/** A meeting transcript stored on disk (see lib/hermes/meeting.ts listArchived). */
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

/**
 * A proposed task, offered by a source panel before anything is written.
 *
 * Shared by the meeting panel (follow-ups from the minutes) and the cron panel (a
 * job's failure), and by the routes that produce them — which is why it lives here
 * rather than in a component: a server route importing from a 'use client' module
 * drags the component into the server bundle.
 */
export type Candidate = {
  /** Deliverable text — becomes the task title. */
  text: string
  /** Owner as written in the source; may be '' or unrecognised. */
  owner: string
  /** Resolved profile name, when the source named one we know. */
  suggested?: string | null
  /** Deadline as written; goes into the body, not the title. */
  due?: string
  /** Extra context for the task body. */
  body?: string
}

export type NewTaskInput = {
  title: string
  assignee: string
  body?: string
  priority?: number
  /** Where this task came from; written to `created_by` as a marker. */
  origin?: TaskOrigin
}
