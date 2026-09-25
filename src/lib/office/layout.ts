/**
 * Office layout constants.
 *
 * Kept in one place because the 3D scene, the furniture builders and the test
 * harness all need the same numbers. Units: 1 = 1 meter.
 */
import type { AgentRole } from '@/types/hermes'

export const FLOOR = { width: 32, depth: 24 }
export const HALF_W = FLOOR.width / 2
export const HALF_D = FLOOR.depth / 2

/** Walls stop the camera clipping into the void; height is cosmetic. */
export const WALL_H = 7

/** Desks: 4 columns x 2 rows, rows facing each other across the aisle. */
export const DESK_COLUMNS = [-4.5, -1.5, 1.5, 4.5] as const
export const DESK_ROW_Z = { near: 1.0, far: -2.6 } as const

export type Desk = {
  index: number
  x: number
  z: number
  /** Direction the occupant faces (radians on the Y axis). */
  facing: number
  column: number
  side: 'near' | 'far'
}

/** 8 stations: index 0..3 = near row, 4..7 = far row. */
export const DESKS: Desk[] = DESK_COLUMNS.flatMap((x, column) => [
  {
    index: column,
    x,
    z: DESK_ROW_Z.near,
    facing: 0,
    column,
    side: 'near' as const,
  },
  {
    index: column + 4,
    x,
    z: DESK_ROW_Z.far,
    facing: Math.PI,
    column,
    side: 'far' as const,
  },
])

/** Room rectangles. Partitions and per-zone flooring both read from here. */
export const ROOMS = {
  /** Meeting room: the whole west third, floor to ceiling glass on its east side. */
  meeting: { x1: -HALF_W + 0.4, x2: -5.4, z1: -HALF_D + 0.4, z2: 9.0 },
  /** Lounge: the whole east third, same treatment mirrored. */
  lounge: { x1: 5.4, x2: HALF_W - 0.4, z1: -HALF_D + 0.4, z2: 9.0 },
  /** Open-plan work area filling the middle third (cubicle dividers, no walls). */
  work: { x1: -5.4, x2: 5.4, z1: -HALF_D + 0.4, z2: 9.0 },
  /** Corridor along the south wall linking the entrance to both rooms. */
  corridor: { z1: 9.0, z2: HALF_D - 0.4 },
} as const

export const KANBAN_BOARD = { x: 0, y: 3.6, z: -HALF_D + 1.2, w: 15, h: 5.4 }
export const CONFERENCE = { x: -9.6, z: 4.0, radius: 2.3 }
export const LOUNGE = { x: 9.6, z: 4.2 }
export const DART = { x: HALF_W - 1.6, z: -HALF_D + 4.0 }
export const DOOR = { x: 0, z: HALF_D - 1.0 }

/** Where an agent stands while being "peeked at" / steered at a desk. */
export function visitorSpot(desk: Desk) {
  const off = desk.side === 'near' ? 1.15 : -1.15
  return { x: desk.x + 1.05, z: desk.z + off }
}

export type Palette = {
  floor: number
  wall: number
  deskTop: number
  deskLeg: number
  screen: number
  chair: number
  rug: number
  sofa: number
  wood: number
}

export const DAY_PALETTE: Palette = {
  floor: 0xe8dcc2,
  wall: 0xf7fafc,
  deskTop: 0xf2f6f8,
  deskLeg: 0xa8b6c0,
  screen: 0x24343c,
  chair: 0x8195a2,
  rug: 0x9ebfa8,
  sofa: 0x7fa3c9,
  wood: 0xc39a69,
}

/**
 * Evening styling. Deliberately NOT a dark scene: an occupied office at 19:00 is
 * lit by ceiling strips and desk lamps. Only the sky outside the windows dims.
 */
export const NIGHT_PALETTE: Palette = {
  floor: 0xdcd2bc,
  wall: 0xe9eef3,
  deskTop: 0xe8eef2,
  deskLeg: 0x9aa7b1,
  screen: 0x1e2f38,
  chair: 0x7b8e9a,
  rug: 0x93b49c,
  sofa: 0x7899bd,
  wood: 0xbb9366,
}

export function paletteFor(hour: number): Palette {
  return hour >= 6 && hour < 18 ? DAY_PALETTE : NIGHT_PALETTE
}

export const ROLE_COLORS: Record<AgentRole, number> = {
  orchestrator: 0xf2b544,
  backend: 0x4fa3d1,
  frontend: 0x8f7ae5,
  qa: 0xe5799c,
  researcher: 0x4fc99a,
  devops: 0xd98b5a,
}
