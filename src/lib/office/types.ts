/**
 * Shared office types.
 *
 * These live apart from `db.ts` on purpose: `db.ts` imports `node:sqlite`, which
 * only exists on the server, and the Zustand store (a client module) needs the
 * same shapes. Importing a type is erased at compile time, but keeping the two
 * apart means a stray value import can never drag `node:sqlite` into the browser
 * bundle.
 */
import type { AgentDivision } from '@/types/hermes'

/** A dummy or a real agent. Dummies are decoration until spawned (poin 4). */
export type AvatarKind = 'dummy' | 'agent'

export type AvatarState = {
  avatarId: string
  name: string
  division: AgentDivision
  kind: AvatarKind
  x: number
  z: number
  level: number
  activity: string
  facing: number
  spawned: boolean
  updatedAt: string
}

/** Everything needed to write one avatar back to the DB. */
export type AvatarWrite = Omit<AvatarState, 'updatedAt'>

export type QaThread = {
  id: number
  asker: string
  responsible: string
  question: string
  answer: string | null
  status: 'open' | 'answered'
  createdAt: string
  answeredAt: string | null
}
