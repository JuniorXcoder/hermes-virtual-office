import type { AgentRole } from '@/types/hermes'

/**
 * Office layout: the single source of truth for every placement.
 *
 * Two rules keep this file honest, because both were violated in earlier
 * revisions and produced furniture buried in furniture:
 *
 *   1. Every solid object is declared here as a footprint (an axis-aligned box
 *      in world X/Z with a height). `layoutConflicts()` proves the plan is clean;
 *      `obstacles.ts` turns the same list into walkable-space collision so
 *      avatars stop walking through desks.
 *   2. Anything that is drawn in `build.ts` and occupied by `scene.ts` (desks,
 *      chairs, desks seats) is exported from here so the two cannot drift.
 *
 * Units: 1 = 1 metre. +X east, +Z south, +Y up. Origin at the office centre.
 */

export const FLOOR = { width: 34, depth: 26 }
export const HALF_W = FLOOR.width / 2
export const HALF_D = FLOOR.depth / 2
// 4.6 m: the window bands sit at y 2.65-4.55, so a 3.4 m wall left the cut-out
// ABOVE the wall line and no opening was ever formed.
export const WALL_H = 4.6
/** Wall thickness, shared by walls and partitions. */
export const WALL_T = 0.3

/* ------------------------------------------------------------------ rooms -- */

/**
 * The floor is divided into three rooms plus a lobby corridor:
 *
 *   +-------------------------------------------+
 *   |  RUANG RAPAT   |    OPEN WORK    | LOUNGE |   north (z = -13)
 *   |                |  8 desks + pods |        |
 *   +----------------+-----------------+--------+
 *   |                L O B I           O R      |   south (z = +13)
 *   |          pintu masuk, resepsionis         |
 *   +-------------------------------------------+
 */
export const ROOMS = {
  meeting: { x1: -HALF_W + WALL_T, x2: -6.0, z1: -HALF_D + WALL_T, z2: 3.4 },
  work: { x1: -6.0, x2: 6.0, z1: -HALF_D + WALL_T, z2: 3.4 },
  lounge: { x1: 6.0, x2: HALF_W - WALL_T, z1: -HALF_D + WALL_T, z2: 3.4 },
  lobby: { x1: -HALF_W + WALL_T, x2: HALF_W - WALL_T, z1: 3.4, z2: HALF_D - WALL_T },
} as const

/** Doorway openings in the south wall of each room, facing the lobby. */
export const ROOM_DOORS = {
  meeting: { x: -11.0, width: 2.2 },
  work: { x: 0, width: 3.4 },
  lounge: { x: 11.0, width: 2.2 },
} as const

/* ------------------------------------------------------------------ desks -- */

export const DESK_COLUMNS = [-4.6, -1.55, 1.55, 4.6] as const
export const DESK_ROW_Z = { far: -8.2, near: -4.8 } as const

export type Desk = {
  index: number
  x: number
  z: number
  /** Direction the occupant faces (radians on the Y axis). */
  facing: number
  column: number
  side: 'near' | 'far'
}

/** 8 stations. Rows face each other across the aisle at z = -6.5. */
export const DESKS: Desk[] = DESK_COLUMNS.flatMap((x, column) => [
  { index: column + 4, x, z: DESK_ROW_Z.far, facing: Math.PI, column, side: 'far' as const },
  { index: column, x, z: DESK_ROW_Z.near, facing: 0, column, side: 'near' as const },
])

/** Local offset (in desk space) where the occupant's root sits. z = +0.92 is the chair. */
export const DESK_SEAT = { x: 0, z: 0.92 }
/** Local offset of the task chair, so chairs and sitters agree. */
export const DESK_CHAIR = { x: 0, z: 1.0 }

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

/* ------------------------------------------------------- landmarks / props -- */

// Sized so the card grid has real screen area: at 4.0 tall the projected board
// was only ~60px high and the cards overflowed it.
export const KANBAN_BOARD = { x: 0, y: 2.6, z: -HALF_D + WALL_T + 0.16, w: 13.6, h: 8.4 }
export const BOARD_COLUMNS = ['TODO', 'JALAN', 'REVIEW', 'SELESAI'] as const

export const CONFERENCE = { x: -11.4, z: -4.6, radius: 2.4 }
export const CONFERENCE_CHAIRS = {
  count: 6,
  offset: Math.PI / 6,
  ring: CONFERENCE.radius + 1.05,
}

export const LOUNGE = { x: 11.6, z: -4.6 }
export const DART = { x: HALF_W - WALL_T - 0.2, z: -9.4 }
export const DOOR = { x: 0, z: HALF_D - WALL_T }
export const RECEPTION = { x: -8.4, z: 8.4 }

/**
 * Window openings. `y` is measured from the FLOOR, matching how build.ts cuts the
 * hole — the first version passed a wall-centre-relative value and every cut-out
 * landed above the wall line, so the facade had no windows at all.
 */
export const WINDOWS = [
  { x: -12.4, y: 2.7, w: 4.6, h: 1.9 },
  { x: 12.4, y: 2.7, w: 4.6, h: 1.9 },
  { x: -16.2, y: 2.7, w: 1.6, h: 1.9, west: true },
  { x: 16.2, y: 2.7, w: 1.6, h: 1.9, east: true },
] as const

/** Artwork on the interior walls: [x, y, z, w, h, facing]. */
export const PAINTINGS = [
  { x: -6.0, y: 1.9, z: -6.0, w: 1.5, h: 1.1, ry: Math.PI / 2 },
  { x: -6.0, y: 1.9, z: 1.6, w: 1.1, h: 1.4, ry: Math.PI / 2 },
  { x: 6.0, y: 1.9, z: -6.0, w: 1.5, h: 1.1, ry: -Math.PI / 2 },
  { x: 6.0, y: 1.9, z: 1.6, w: 1.1, h: 1.4, ry: -Math.PI / 2 },
  { x: -9.0, y: 1.95, z: -12.6, w: 1.8, h: 1.2, ry: 0 },
  { x: 9.0, y: 1.95, z: -12.6, w: 1.8, h: 1.2, ry: 0 },
  { x: -13.5, y: 1.9, z: 4.8, w: 1.3, h: 1.7, ry: Math.PI / 2 },
  { x: 13.5, y: 1.9, z: 4.8, w: 1.3, h: 1.7, ry: -Math.PI / 2 },
] as const

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

const fp = (id: string, x: number, z: number, hw: number, hd: number, h: number, kind: Footprint['kind'] = 'prop'): Footprint =>
  ({ id, x, z, hw, hd, h, kind })

/** Every solid placed in build.ts. Kept here so the plan can be validated. */
export const FOOTPRINTS: Footprint[] = [
  // ---- outer walls (as four slabs)
  fp('wall-n', 0, -HALF_D, HALF_W, WALL_T / 2, WALL_H, 'wall'),
  fp('wall-s', 0, HALF_D, HALF_W, WALL_T / 2, WALL_H, 'wall'),
  fp('wall-w', -HALF_W, 0, WALL_T / 2, HALF_D, WALL_H, 'wall'),
  fp('wall-e', HALF_W, 0, WALL_T / 2, HALF_D, WALL_H, 'wall'),

  // ---- interior partitions, each split around its doorway
  fp('part-mtg-n', ROOMS.meeting.x2 - 0.075, (-13 + ROOMS.meeting.z2) / 2, 0.075, (ROOMS.meeting.z2 + 13) / 2, WALL_H, 'wall'),
  fp('part-lng-n', ROOMS.lounge.x1 + 0.075, (-13 + ROOMS.lounge.z2) / 2, 0.075, (ROOMS.lounge.z2 + 13) / 2, WALL_H, 'wall'),
  fp('part-mtg-s-a', -16.6, ROOMS.meeting.z2, 0.8, 0.075, WALL_H, 'wall'),
  fp('part-mtg-s-b', -9.6, ROOMS.meeting.z2, 2.4, 0.075, WALL_H, 'wall'),
  fp('part-wrk-s-a', -3.4, ROOMS.work.z2, 2.9, 0.075, WALL_H, 'wall'),
  fp('part-wrk-s-b', 3.4, ROOMS.work.z2, 2.9, 0.075, WALL_H, 'wall'),
  fp('part-lng-s-a', 9.6, ROOMS.lounge.z2, 2.4, 0.075, WALL_H, 'wall'),
  fp('part-lng-s-b', 16.6, ROOMS.lounge.z2, 0.8, 0.075, WALL_H, 'wall'),

  // ---- desks: 2.0 x 1.0 tops, plus the chair behind each
  ...DESKS.flatMap((d) => {
    const s = Math.sin(d.facing)
    const c = Math.cos(d.facing)
    const chair = { x: d.x + DESK_CHAIR.z * s, z: d.z + DESK_CHAIR.z * c }
    return [
      fp(`desk-${d.index}`, d.x, d.z, 1.0, 0.5, 0.72, 'desk'),
      // the chair blocks walking but is low: the sitter stands above it
      fp(`chair-${d.index}`, chair.x, chair.z, 0.32, 0.32, 0.5, 'seat'),
    ]
  }),

  // ---- conference furniture
  fp('conf-table', CONFERENCE.x, CONFERENCE.z, CONFERENCE.radius, CONFERENCE.radius, 0.72, 'desk'),
  ...Array.from({ length: CONFERENCE_CHAIRS.count }, (_, i) => {
    const a = CONFERENCE_CHAIRS.offset + (i / CONFERENCE_CHAIRS.count) * Math.PI * 2
    return fp(
      `conf-chair-${i}`,
      CONFERENCE.x + Math.cos(a) * CONFERENCE_CHAIRS.ring,
      CONFERENCE.z + Math.sin(a) * CONFERENCE_CHAIRS.ring,
      0.3,
      0.3,
      0.5,
      'seat',
    )
  }),

  // ---- meeting room extras
  fp('cred-list', -13.4, -12.4, 1.3, 0.35, 0.8),
  fp('plant-mtg-a', -6.9, -12.0, 0.4, 0.4, 1.0),
  fp('plant-mtg-b', -16.2, 2.4, 0.4, 0.4, 1.0),
  fp('board-stand', -16.3, -9.2, 0.35, 0.9, 1.9),

  // ---- work bay extras
  fp('pod-a', -4.3, 0.5, 1.5, 0.75, 0.72, 'desk'),
  fp('pod-b', 4.3, 0.5, 1.5, 0.75, 0.72, 'desk'),
  fp('printer', -5.2, 2.5, 0.42, 0.35, 0.95),
  fp('lockers', 3.9, 2.6, 0.92, 0.25, 1.75),
  fp('shelf-w', -5.6, -10.6, 0.2, 1.2, 1.9),
  fp('plant-work-a', -5.7, -12.2, 0.4, 0.4, 1.0),
  fp('plant-work-b', 5.7, -12.2, 0.4, 0.4, 1.0),

  // ---- lounge
  fp('sofa', LOUNGE.x, LOUNGE.z - 1.45, 1.75, 0.55, 0.85),
  fp('tv-unit', LOUNGE.x, LOUNGE.z - 4.9, 1.3, 0.35, 0.55),
  fp('coffee-table', LOUNGE.x, LOUNGE.z - 2.9, 0.62, 0.62, 0.44, 'desk'),
  fp('lounge-chair', LOUNGE.x - 2.3, LOUNGE.z - 0.6, 0.45, 0.45, 0.8),
  fp('floor-lamp', LOUNGE.x + 2.5, LOUNGE.z - 3.2, 0.3, 0.3, 1.8),
  fp('pantry', 14.4, 1.0, 1.25, 0.35, 0.95),
  fp('cooler', 15.6, -1.6, 0.32, 0.32, 1.5),
  fp('plant-lng-a', 6.9, -12.0, 0.4, 0.4, 1.0),
  fp('plant-lng-b', 15.9, 2.4, 0.4, 0.4, 1.0),
  fp('bins', 7.0, 3.0, 0.55, 0.25, 0.7),

  // ---- lobby
  fp('reception', RECEPTION.x, RECEPTION.z, 1.5, 0.45, 1.05, 'desk'),
  fp('reception-chair', RECEPTION.x, RECEPTION.z + 1.15, 0.32, 0.32, 0.5, 'seat'),
  fp('wait-sofa-a', -6.4, 9.4, 0.9, 0.5, 0.8),
  fp('wait-sofa-b', 6.4, 9.4, 0.9, 0.5, 0.8),
  fp('wait-table', -9.6, 9.6, 0.45, 0.45, 0.45, 'desk'),
  fp('plant-lobby-a', -16.0, 5.4, 0.4, 0.4, 1.0),
  fp('plant-lobby-b', 16.0, 5.4, 0.4, 0.4, 1.0),
  fp('coat-rack', -11.0, 11.4, 0.35, 0.35, 1.75),
  fp('doormat', 0, HALF_D - WALL_T - 0.9, 1.5, 0.7, 0, 'prop'),
]

/** Doorway openings so the walkable graph knows where it may pass. */
export const OPENINGS: { x: number; z: number; hw: number; hd: number }[] = [
  { x: ROOM_DOORS.meeting.x, z: ROOMS.meeting.z2, hw: ROOM_DOORS.meeting.width / 2, hd: 0.3 },
  { x: ROOM_DOORS.work.x, z: ROOMS.work.z2, hw: ROOM_DOORS.work.width / 2, hd: 0.3 },
  { x: ROOM_DOORS.lounge.x, z: ROOMS.lounge.z2, hw: ROOM_DOORS.lounge.width / 2, hd: 0.3 },
  { x: DOOR.x, z: DOOR.z, hw: 1.7, hd: 0.3 },
]

/* -------------------------------------------------------------- validation -- */

export type Conflict = { a: string; b: string; overlapX: number; overlapZ: number }

/**
 * Proves no two solid props occupy the same ground. Walls and openings are
 * ignored by design (openings cut walls), and seats may sit under a desk's
 * nominal footprint because a chair tucks beneath the top.
 */
export function layoutConflicts(list: Footprint[] = FOOTPRINTS): Conflict[] {
  const solid = list.filter(
    (f) => f.kind !== 'wall' && f.kind !== 'seat' && f.h > 0.05 && f.id !== 'doormat',
  )
  const out: Conflict[] = []
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i]
      const b = solid[j]
      const ox = a.hw + b.hw - Math.abs(a.x - b.x)
      const oz = a.hd + b.hd - Math.abs(a.z - b.z)
      // a hair of tolerance: touching edges is fine, overlapping is not
      if (ox > 0.02 && oz > 0.02) out.push({ a: a.id, b: b.id, overlapX: ox, overlapZ: oz })
    }
  }
  return out
}

/** Props that block a walking avatar (everything solid except wall/seat). */
export function blockingFootprints(list: Footprint[] = FOOTPRINTS): Footprint[] {
  return list.filter((f) => f.kind !== 'wall' && f.h > 0.5 && f.id !== 'doormat')
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
  orchestrator: 0xf2b544,
  backend: 0x4fa3d1,
  frontend: 0x8f7ae5,
  qa: 0xe5799c,
  researcher: 0x4fc99a,
  devops: 0xd98b5a,
}
