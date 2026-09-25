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
  floor: 0xb9a67f,
  wall: 0xdfe3e8,
  deskTop: 0xcfd8dc,
  deskLeg: 0x8d9aa5,
  screen: 0x1b2a30,
  chair: 0x5b6b74,
  rug: 0x5d7a63,
  sofa: 0x4f6d86,
  wood: 0x8b6b45,
}

export const NIGHT_PALETTE: Palette = {
  floor: 0x6f6450,
  wall: 0x3c4048,
  deskTop: 0x8b959c,
  deskLeg: 0x5c666e,
  screen: 0x0d1418,
  chair: 0x3e4a52,
  rug: 0x3b4f40,
  sofa: 0x33475a,
  wood: 0x5a4630,
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
