import type { AgentDivision, AgentRole } from '@/types/hermes'

/**
 * Office layout — DEMOLISHED SHELL.
 *
 * The interior that used to live here (outer walls, the oval aula, the four
 * division pods, every desk and chair, the conference table, the lounge, the
 * pantry, reception, the pool, the garden, the book nook, the windows, the
 * artwork, the roof) has been removed ON PURPOSE — and so have the floor and the
 * ceiling. What is left is an EMPTY OPEN PLOT with nothing but a Kanban board
 * standing on it. The office is being rebuilt from scratch.
 *
 * What survives is only the CONTRACT the rest of the app reads:
 *
 *   - the plot extents (nav.ts derives its walkable grid from these, and the
 *     self-test asserts them),
 *   - the seat heights the avatar rig is solved against (anim.ts, self-test),
 *   - the Kanban board (the task wall, a core feature — not furniture),
 *   - the division seat pools (now empty → agents simply idle on the plot),
 *   - the palette.
 *
 * No walls are drawn, but `WALL_T` stays: nav.ts uses it as the inset from the
 * plot edge that keeps walkers inside, and the self-test asserts that inset.
 *
 * Units: 1 = 1 metre. +X east, +Z south, +Y up. Origin at the plot centre.
 */

export const FLOOR = { width: 34, depth: 26 }
export const HALF_W = FLOOR.width / 2
export const HALF_D = FLOOR.depth / 2
/**
 * Kept as the notional shell height. Nothing is drawn at it any more — there is
 * no ceiling — but the Kanban board and the camera are measured against it.
 */
export const WALL_H = 4.6
/** Wall thickness. Nothing is drawn with it, but nav/selftest still use it as the inset. */
export const WALL_T = 0.3

/** The doorway. Nothing is built there; agents still enter and leave through it. */
export const DOOR = { x: 0, z: HALF_D - WALL_T }

/* ------------------------------------------------------------------ desks -- */

export type Desk = {
  index: number
  x: number
  z: number
  /** Direction the occupant faces (radians on the Y axis). */
  facing: number
  column: number
  side: 'near' | 'far'
  /** Divisi pemilik meja — agent duduk di ruang divisinya. */
  division: AgentDivision
}

/**
 * NO DESKS. The workstations were furniture and were demolished with everything
 * else. The array stays (and stays exported) because kanban.ts assigns seats
 * through `desksForDivision()`: an empty pool simply means every agent gets
 * `deskIndex: null` and idles on the open floor instead of sitting down. The
 * rebuild re-populates this list.
 */
export const DESKS: Desk[] = []

/** Meja-meja milik satu divisi (kosong selama gedung dibongkar). */
export function desksForDivision(div: AgentDivision): Desk[] {
  return DESKS.filter((d) => d.division === div).sort((a, b) => a.index - b.index)
}

/**
 * Look up a desk by its LABEL, not by its position in the array. Kept so callers
 * do not have to change; returns `undefined` while `DESKS` is empty.
 */
export function deskByIndex(index: number): Desk | undefined {
  return DESKS.find((d) => d.index === index)
}

/**
 * Seats: the single source of truth for seat height.
 *
 * The numbers are solved against the actual avatar rig (sampled, not guessed), so
 * the self-test can rebuild the avatar and assert the feet land exactly on each
 * seat. They are kept even though the furniture is gone: the meeting pose still
 * uses `chair`, and the rebuild will place real furniture against these numbers.
 */
export const HIP_LIFT = 0.011
export const SEATS = {
  /** Desk chair and conference chair: surface 0.505. */
  chair: { hip: 0.516, thigh: -86, knee: 90.75, thickness: 0.07 },
  /** Lounge sofa: a low seat, surface 0.449. */
  sofa: { hip: 0.46, thigh: -88, knee: 66, thickness: 0.34 },
  /** Book-nook armchair: surface 0.505. */
  nook: { hip: 0.516, thigh: -86, knee: 90.75, thickness: 0.3 },
  /** Pantry bar stool: surface 0.644, feet rest on the foot ring at 0.24. */
  stool: { hip: 0.655, thigh: -92, knee: 64, thickness: 0.07, footY: 0.24 },
} as const
export type SeatName = keyof typeof SEATS
/** Top surface of a seat, from the pose that sits on it. */
export const seatTop = (s: SeatName) => SEATS[s].hip - HIP_LIFT

export const DESK_CHAIR = { x: 0, z: 1.0 }
/**
 * The task chair's backrest sits at local +0.28 from the chair anchor, so a
 * sitter's centre of mass is just IN FRONT of the anchor (toward the desk).
 */
export const SEAT_BACK_OFFSET = -0.06
/** Local offset where the occupant's root sits. */
export const DESK_SEAT = { x: 0, z: DESK_CHAIR.z + SEAT_BACK_OFFSET }

export function deskSeatWorld(desk: Desk) {
  const s = Math.sin(desk.facing)
  const c = Math.cos(desk.facing)
  return {
    x: desk.x + DESK_SEAT.x * c + DESK_SEAT.z * s,
    z: desk.z - DESK_SEAT.x * s + DESK_SEAT.z * c,
    facing: desk.facing + Math.PI,
  }
}

export function deskVisitorWorld(desk: Desk) {
  const v = visitorSpot(desk)
  return { x: v.x, z: v.z, facing: Math.atan2(desk.x - v.x, desk.z - v.z) }
}

/** Where someone stands to talk at a desk (reviewer, peeker). */
export function visitorSpot(desk: Desk) {
  const off = desk.side === 'near' ? 1.35 : -1.35
  return { x: desk.x + 1.15, z: desk.z + off }
}

/* ------------------------------------------------------- board / landmarks -- */

export const BOARD_D = 0.14
/** Notional shell top — there is no ceiling drawn; the board is measured against it. */
export const CEILING_Y = WALL_H
export const BOARD_REVEAL = 0.35

/**
 * Kanban board. It used to curve along the north wall of the aula; with the walls
 * gone it now stands FREE on the open floor as a display board, held up by two
 * posts (drawn in build.ts). Same footprint, same columns, same click handling.
 */
export const KANBAN_BOARD = {
  x: 0,
  y: (CEILING_Y - BOARD_REVEAL * 2) / 2 + BOARD_REVEAL,
  z: -7.3,
  w: 5.6,
  h: Math.min(5.6 * 0.62, CEILING_Y - BOARD_REVEAL * 2),
}
export const BOARD_COLUMNS = ['TODO', 'JALAN', 'REVIEW', 'SELESAI'] as const

/**
 * Meeting ring on the open floor. There is no table yet — participants sit in a
 * circle where the rebuild will put one. The constants are kept so scene.ts keeps
 * seating meetings without a change.
 */
export const CONFERENCE = { x: 0, z: -4, radius: 1.8 }
export const CONFERENCE_CHAIRS = {
  count: 6,
  offset: 0,
  ring: CONFERENCE.radius + 1.0,
}

/* -------------------------------------------------------------- footprints -- */

export type Footprint = {
  /** Stable id, also used as the obstacle key. */
  id: string
  /** Centre and half-extents on X/Z. */
  x: number
  z: number
  hw: number
  hd: number
  /** Blocking height: below this a walker is stopped. 0 = decorative only. */
  h: number
  /** 'wall' | 'prop' | 'desk' — walls are never passable, desks are. */
  kind: 'wall' | 'prop' | 'desk' | 'seat'
}

/**
 * NO FOOTPRINTS. Every solid object in the building is gone, so nothing blocks a
 * walker: the floor is one open space bounded only by the floor edge (nav.ts).
 */
export const FOOTPRINTS: Footprint[] = []

/* ------------------------------------------------------------------ spots -- */

/**
 * Where an idle agent goes, and which way it faces on arrival.
 *
 * With no furniture left, these are simply even points across the open floor, so
 * a handful of agents spread out instead of clumping. All are reachable — the
 * self-test asserts it, and on an empty floor that is the only failure mode left.
 */
export type IdleSpot = {
  x: number
  z: number
  act: 'idle' | 'sofa' | 'dart' | 'garden' | 'read' | 'coffee'
  seated?: boolean
  face: number
}

export const IDLE_SPOTS: IdleSpot[] = [
  { x: -12.0, z: 0.0, act: 'idle', face: Math.PI / 2 },
  { x: -8.0, z: -5.0, act: 'idle', face: 0 },
  { x: -6.0, z: 8.0, act: 'idle', face: 0 },
  { x: -4.0, z: -1.0, act: 'idle', face: 0 },
  { x: 0.0, z: 3.0, act: 'idle', face: Math.PI },
  { x: 0.0, z: 9.0, act: 'idle', face: Math.PI },
  { x: 4.0, z: -1.0, act: 'idle', face: 0 },
  { x: 6.0, z: 8.0, act: 'idle', face: 0 },
  { x: 8.0, z: -5.0, act: 'idle', face: 0 },
  { x: 12.0, z: 0.0, act: 'idle', face: -Math.PI / 2 },
  { x: 10.0, z: 6.0, act: 'idle', face: -Math.PI / 2 },
  { x: -10.0, z: 6.0, act: 'idle', face: Math.PI / 2 },
]

/** Doorway openings. None while the shell is open; nav.ts reads this list. */
export const OPENINGS: { x: number; z: number; hw: number; hd: number }[] = []

/* -------------------------------------------------------------- validation -- */

export type Conflict = { a: string; b: string; overlapX: number; overlapZ: number }

/**
 * Proves no two solid props occupy the same ground. Trivially clean while the
 * plan is empty; the rebuild's furniture will be checked by this again.
 */
export function layoutConflicts(list: Footprint[] = FOOTPRINTS): Conflict[] {
  const solid = list.filter((f) => f.kind !== 'wall' && f.kind !== 'seat' && f.h > 0.05)
  const out: Conflict[] = []
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i]
      const b = solid[j]
      const ox = a.hw + b.hw - Math.abs(a.x - b.x)
      const oz = a.hd + b.hd - Math.abs(a.z - b.z)
      if (ox > 0.02 && oz > 0.02) out.push({ a: a.id, b: b.id, overlapX: ox, overlapZ: oz })
    }
  }
  return out
}

/** Props that block a walking avatar (everything solid except wall/seat). */
export function blockingFootprints(list: Footprint[] = FOOTPRINTS): Footprint[] {
  return list.filter((f) => f.kind !== 'wall' && f.h > 0.5)
}

/* ---------------------------------------------------------------- palettes -- */

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
  floor: 0xe9deca,
  wall: 0xf8fbfd,
  deskTop: 0xf3f7f9,
  deskLeg: 0xa9b7c1,
  screen: 0x24343c,
  chair: 0x8397a4,
  rug: 0xa3c2ab,
  sofa: 0x83a7cc,
  wood: 0xc49b6c,
}

export const NIGHT_PALETTE: Palette = {
  floor: 0xdcd2bc,
  wall: 0xeaf0f5,
  deskTop: 0xe9eff3,
  deskLeg: 0x9ba8b2,
  screen: 0x1e2f38,
  chair: 0x7d909c,
  rug: 0x96b7a0,
  sofa: 0x7a9dc0,
  wood: 0xbc9468,
}

export function paletteFor(hour: number): Palette {
  return hour >= 6 && hour < 18 ? DAY_PALETTE : NIGHT_PALETTE
}

export const ROLE_COLORS: Record<AgentRole, number> = {
  ceo: 0xffd700,
  orchestrator: 0xf2b544,
  backend: 0x4fa3d1,
  frontend: 0x8f7ae5,
  qa: 0xe5799c,
  researcher: 0x4fc99a,
  devops: 0xd98b5a,
  marketing: 0xe05a5a,
  seo: 0x5ac8e0,
  content: 0xa5e05a,
  affiliator: 0xc05ae0,
}
