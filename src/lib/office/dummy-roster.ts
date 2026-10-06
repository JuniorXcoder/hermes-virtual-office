/**
 * The office's dummy roster.
 *
 * Three avatars per division (1 manager + 2 staff, matching the three desks) plus
 * a receptionist in the lobby. They exist so the office is ALIVE on first load —
 * an empty building with no people reads as a broken render — and they cost
 * nothing: a dummy is a row in `avatar_state` and a mesh in the scene. No model is
 * ever called for one (poin 4 + 10).
 *
 * Clicking a dummy offers to spawn a real agent into that slot; the real agent then
 * takes over the same row (`kind: 'agent'`, `spawned: true`).
 *
 * Positions come from `layout.ts` — the desk seats — so a dummy and the agent that
 * replaces it stand in exactly the same place.
 */
import { DESKS, RECEPTION, deskSeatWorld } from './layout'
import type { AgentDivision } from '@/types/hermes'
import type { DummySpec } from './db'

/** Readable placeholder names, per division, in desk order (manager first). */
const DUMMY_NAMES: Record<AgentDivision, [string, string, string]> = {
  tech: ['Dev Manager', 'Dev Staff 1', 'Dev Staff 2'],
  growth: ['Mkt Manager', 'Mkt Staff 1', 'Mkt Staff 2'],
  content: ['Content Manager', 'Content Staff 1', 'Content Staff 2'],
  exec: ['Exec Manager', 'Exec Staff 1', 'Exec Staff 2'],
}

/** Dummy ids are stable AND unique, so a re-seed can never duplicate or collide.
 * The seat label alone is not enough: a division has TWO staff desks, so
 * `dummy:tech:staff` would be written twice and one dummy would vanish. */
const dummyId = (division: AgentDivision, deskIndex: number) => `dummy:${division}:${deskIndex}`

export function dummyRoster(): DummySpec[] {
  const out: DummySpec[] = []

  for (const division of ['tech', 'growth', 'content'] as AgentDivision[]) {
    const desks = DESKS.filter((d) => d.division === division).sort((a, b) => a.index - b.index)
    const names = DUMMY_NAMES[division]
    desks.forEach((desk, i) => {
      const seat = deskSeatWorld(desk)
      out.push({
        avatarId: dummyId(division, desk.index),
        name: names[Math.min(i, 2)],
        division,
        x: seat.x,
        z: seat.z,
        level: 0,
        // Sitting at a desk is 'typing': a room of idle standers looks abandoned.
        activity: 'typing',
        facing: seat.facing,
      })
    })
  }

  // The receptionist sits BEHIND the counter, facing the entrance (+Z).
  out.push({
    avatarId: 'dummy:lobby:reception',
    name: 'Resepsionis',
    division: 'exec',
    x: RECEPTION.x,
    z: RECEPTION.z - 1.15,
    level: 0,
    activity: 'typing',
    facing: 0,
  })

  return out
}
