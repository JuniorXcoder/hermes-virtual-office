import type { AgentDivision, AgentRole } from '@/types/hermes'

/**
 * Office layout: the single source of truth for every placement.
 *
 * The building is a **U**: a west bar, a north bar and an east bar wrapped around
 * an open-air courtyard that holds the pool. It is **split level** — the ground
 * floor carries the lobby, the three division work rooms, the pantry and the
 * leisure room; the first floor (reached by a stair at the west end of the north
 * bar) carries the CEO suite and the five named meeting rooms.
 *
 * Two rules keep this file honest:
 *
 *   1. Every solid object is declared here as a footprint (an axis-aligned box in
 *      world X/Z with a height and a LEVEL). `layoutConflicts()` proves the plan
 *      is clean; `nav.ts` turns the same list into walkable space so avatars stop
 *      walking through walls and furniture.
 *   2. Anything drawn in `build.ts` and occupied by `scene.ts` is exported from
 *      here so the two cannot drift.
 *
 * Units: 1 = 1 metre. +X east, +Z south, +Y up. Origin at the plot centre.
 */

export const FLOOR = { width: 56, depth: 42 }
export const HALF_W = FLOOR.width / 2
export const HALF_D = FLOOR.depth / 2
/** Floor-to-ceiling height of ONE level. The building is `LEVELS` tall. */
export const WALL_H = 3.4
export const WALL_T = 0.3
export const LEVELS = 2
/** Vertical distance between level 0 and level 1. */
export const LEVEL_H = WALL_H
/** The roof over the first floor. */
export const ROOF_Y = LEVELS * LEVEL_H
/** Ceiling of the ground floor (what a ground-floor room is measured against). */
export const CEILING_Y = LEVEL_H

/** The main entrance, on the south face of the lobby. */
export const DOOR = { x: 0, z: HALF_D - WALL_T / 2 }

/**
 * The floor PLATE of each level. Level 1 exists only over the north bar — the
 * rest of the first floor is void, so `nav.ts` must refuse to walk there rather
 * than letting an agent stroll off the edge.
 */
export const LEVEL_BOUNDS: Record<0 | 1, { x1: number; x2: number; z1: number; z2: number }> = {
  0: { x1: -HALF_W, x2: HALF_W, z1: -HALF_D, z2: HALF_D },
  1: { x1: -HALF_W, x2: HALF_W, z1: -HALF_D, z2: -9 },
}

/* ------------------------------------------------------------------- bars -- */

/**
 * The three bars of the U, plus the courtyard they wrap and the lobby that closes
 * the south side. These are the BUILDING MASSES — rooms are carved out of them.
 *
 *   z=-21  ┌──────────────────────────────────────────────┐
 *          │            NORTH BAR (exec floor)            │   level 1
 *   z=-9   ├──────────────┬────────────────┬──────────────┤
 *          │  WEST BAR    │    COURTYARD   │   EAST BAR   │
 *          │  (divisions) │  (pool, BBQ)   │ (pantry etc) │   level 0
 *   z=+16  │              ├────────────────┤              │
 *          │              │     LOBBY      │              │
 *   z=+21  └──────────────┴───────┬────────┴──────────────┘
 *                            entrance
 */
export const BARS = {
  north: { x1: -HALF_W, x2: HALF_W, z1: -HALF_D, z2: -9 },
  west: { x1: -HALF_W, x2: -14, z1: -9, z2: HALF_D },
  east: { x1: 14, x2: HALF_W, z1: -9, z2: HALF_D },
  courtyard: { x1: -14, x2: 14, z1: -9, z2: 16 },
  lobby: { x1: -14, x2: 14, z1: 16, z2: HALF_D },
} as const

/* ------------------------------------------------------------------ rooms -- */

export type Room = {
  id: string
  label: string
  level: 0 | 1
  x1: number
  x2: number
  z1: number
  z2: number
  /** Doorway, in world coordinates, as an axis-aligned opening. */
  door?: { x: number; z: number; hw: number; hd: number }
  /** Outdoor rooms are open to the sky (the courtyard). */
  outdoor?: boolean
}

const ROOM_W = HALF_W - WALL_T / 2 // inner face of the west/east outer wall
const WORK_X1 = -ROOM_W
const WORK_X2 = -14 - WALL_T / 2

/** The five named meeting rooms live in the north bar, in a row west → east. */
export const MEETING_ROOM_IDS = ['merapi', 'rinjani', 'bromo', 'semeru', 'cikurai'] as const
export type MeetingRoomId = (typeof MEETING_ROOM_IDS)[number]

export const ROOMS: Room[] = [
  /* ------------------------------------------------------------ level 0 -- */
  {
    id: 'lobby',
    label: 'LOBI',
    level: 0,
    ...BARS.lobby,
    door: { x: DOOR.x, z: HALF_D, hw: 2.2, hd: 0.6 },
  },
  {
    id: 'courtyard',
    label: 'COURTYARD',
    level: 0,
    ...BARS.courtyard,
    outdoor: true,
  },
  /* the north bar's ground floor is an open covered terrace — the circulation hub */
  {
    id: 'terrace',
    label: 'TERAS',
    level: 0,
    ...BARS.north,
  },
  {
    id: 'dev',
    label: 'DEVELOPER & INFRASTRUCTURE',
    level: 0,
    x1: WORK_X1,
    x2: WORK_X2,
    z1: -HALF_D + WALL_T / 2,
    z2: -6.9,
    door: { x: -14, z: -13.8, hw: 0.6, hd: 1.4 },
  },
  {
    id: 'mkt',
    label: 'MARKETING & SEO',
    level: 0,
    x1: WORK_X1,
    x2: WORK_X2,
    z1: -6.9,
    z2: 6.9,
    door: { x: -14, z: 0, hw: 0.6, hd: 1.4 },
  },
  {
    id: 'content',
    label: 'CONTENT CREATOR',
    level: 0,
    x1: WORK_X1,
    x2: WORK_X2,
    z1: 6.9,
    z2: HALF_D - WALL_T / 2,
    door: { x: -14, z: 13.8, hw: 0.6, hd: 1.4 },
  },
  {
    id: 'leisure',
    label: 'RUANG SANTAI',
    level: 0,
    x1: 14 + WALL_T / 2,
    x2: ROOM_W,
    z1: -HALF_D + WALL_T / 2,
    z2: 2,
    door: { x: 14, z: -4, hw: 0.6, hd: 1.4 },
  },
  {
    id: 'pantry',
    label: 'PANTRY / DAPUR',
    level: 0,
    x1: 14 + WALL_T / 2,
    x2: ROOM_W,
    z1: 2,
    z2: HALF_D - WALL_T / 2,
    door: { x: 14, z: 8, hw: 0.6, hd: 1.4 },
  },

  /* ------------------------------------------------------------ level 1 -- */
  // The executive floor occupies the north bar. A corridor along its south edge
  // (z -11.5..-9.3) serves all six rooms; the stair lands at its west end.
  {
    id: 'corridor1',
    label: 'KORIDOR EKSEKUTIF',
    level: 1,
    x1: -ROOM_W,
    x2: ROOM_W,
    z1: -11.5,
    z2: -9 + WALL_T / 2,
  },
  {
    id: 'ceo',
    label: 'RUANG CEO',
    level: 1,
    x1: -ROOM_W,
    x2: -19.3,
    z1: -HALF_D + WALL_T / 2,
    z2: -11.5,
    door: { x: -21, z: -11.5, hw: 1.2, hd: 0.6 },
  },
  {
    id: 'rinjani',
    label: 'RINJANI',
    level: 1,
    x1: -19.0,
    x2: -7.0,
    z1: -HALF_D + WALL_T / 2,
    z2: -11.5,
    door: { x: -13.0, z: -11.5, hw: 1.6, hd: 0.6 },
  },
  {
    id: 'merapi',
    label: 'MERAPI',
    level: 1,
    x1: -6.7,
    x2: 1.7,
    z1: -HALF_D + WALL_T / 2,
    z2: -11.5,
    door: { x: -2.5, z: -11.5, hw: 1.2, hd: 0.6 },
  },
  {
    id: 'bromo',
    label: 'BROMO',
    level: 1,
    x1: 2.0,
    x2: 10.4,
    z1: -HALF_D + WALL_T / 2,
    z2: -11.5,
    door: { x: 6.2, z: -11.5, hw: 1.2, hd: 0.6 },
  },
  {
    id: 'semeru',
    label: 'SEMERU',
    level: 1,
    x1: 10.7,
    x2: 19.1,
    z1: -HALF_D + WALL_T / 2,
    z2: -11.5,
    door: { x: 14.9, z: -11.5, hw: 1.2, hd: 0.6 },
  },
  {
    id: 'cikurai',
    label: 'CIKURAI',
    level: 1,
    x1: 19.4,
    x2: ROOM_W,
    z1: -HALF_D + WALL_T / 2,
    z2: -11.5,
    door: { x: 23.5, z: -11.5, hw: 1.2, hd: 0.6 },
  },
]

export const roomById = (id: string): Room | undefined => ROOMS.find((r) => r.id === id)
const room = (id: string): Room => {
  const r = roomById(id)
  if (!r) throw new Error(`unknown room: ${id}`)
  return r
}
export const roomCentre = (id: string) => {
  const r = room(id)
  return { x: (r.x1 + r.x2) / 2, z: (r.z1 + r.z2) / 2 }
}

/**
 * Which meeting room a division uses. Bromo = Developer & Infrastructure,
 * Semeru = Marketing & SEO, Cikurai = Content Creator. Merapi holds the managers
 * plus the CEO; Rinjani is the ten-seat room the CEO also chairs.
 */
export const DIVISION_MEETING_ROOM: Record<AgentDivision, MeetingRoomId> = {
  tech: 'bromo',
  growth: 'semeru',
  content: 'cikurai',
  exec: 'merapi',
}

/* -------------------------------------------------------------- meeting --- */

export type MeetingRoom = {
  id: MeetingRoomId
  /** Displayed on the door sign. */
  label: string
  roomId: string
  seats: { x: number; z: number; facing: number }[]
}

/**
 * Seats are generated from the room's centre and a ring radius, not typed by
 * hand: a room that moves takes its chairs with it, and `facing` is always
 * "toward the table", which is what stops a sitter from facing a wall.
 */
function ringSeats(roomId: string, count: number, radius: number, offset = 0) {
  const c = roomCentre(roomId)
  return Array.from({ length: count }, (_, i) => {
    const a = offset + (i / count) * Math.PI * 2
    const x = c.x + Math.cos(a) * radius
    const z = c.z + Math.sin(a) * radius
    return { x, z, facing: Math.atan2(c.x - x, c.z - z) }
  })
}

export const MEETING_ROOMS: Record<MeetingRoomId, MeetingRoom> = {
  // CEO + the three division managers.
  merapi: { id: 'merapi', label: 'MERAPI', roomId: 'merapi', seats: ringSeats('merapi', 4, 1.5, Math.PI / 4) },
  // The ten-seat room, and the biggest: CEO + everyone.
  rinjani: { id: 'rinjani', label: 'RINJANI', roomId: 'rinjani', seats: ringSeats('rinjani', 10, 2.7) },
  bromo: { id: 'bromo', label: 'BROMO', roomId: 'bromo', seats: ringSeats('bromo', 3, 1.3, Math.PI / 2) },
  semeru: { id: 'semeru', label: 'SEMERU', roomId: 'semeru', seats: ringSeats('semeru', 3, 1.3, Math.PI / 2) },
  cikurai: { id: 'cikurai', label: 'CIKURAI', roomId: 'cikurai', seats: ringSeats('cikurai', 3, 1.3, Math.PI / 2) },
}

/** The table in each meeting room: same centre as the seat ring. */
export const MEETING_TABLES: Record<MeetingRoomId, { x: number; z: number; rx: number; rz: number }> =
  Object.fromEntries(
    MEETING_ROOM_IDS.map((id) => {
      const c = roomCentre(MEETING_ROOMS[id].roomId)
      const r = id === 'rinjani' ? 2.0 : 0.95
      return [id, { x: c.x, z: c.z, rx: r, rz: id === 'rinjani' ? 1.5 : 0.95 }]
    }),
  ) as Record<MeetingRoomId, { x: number; z: number; rx: number; rz: number }>

/**
 * Back-compat: `scene.ts` used a single conference table for every meeting. It now
 * points at Rinjani (the ten-seat room), and the richer per-room API above is what
 * the meeting logic uses once it picks a room by division.
 */
export const CONFERENCE = { x: roomCentre('rinjani').x, z: roomCentre('rinjani').z, radius: 2.0 }
export const CONFERENCE_CHAIRS = { count: 10, offset: 0, ring: 2.7 }

/* ----------------------------------------------------------------- stairs -- */

/**
 * The stair shaft. It occupies the SAME x/z footprint on both levels, so `nav.ts`
 * can treat it as a portal: stepping into the region on either floor moves the
 * walker to the other floor. Modelled as a real flight in `build.ts`.
 */
export const STAIRS = {
  x1: -27.5,
  x2: -23.0,
  z1: -11.5,
  z2: -9 + WALL_T / 2,
  fromLevel: 0 as const,
  toLevel: 1 as const,
}

/* ------------------------------------------------------------------- pool -- */

/**
 * The pool sits in the courtyard, which is the notch of the U and is open to the
 * sky — so this really is an outdoor pool. The walkway is the covered strip that
 * runs along the courtyard's three building sides.
 */
export const COURTYARD = BARS.courtyard
export const WALKWAY_W = 2.5
export const POOL = { x: 0, z: 4, w: 12, d: 7, waterY: 0.05, deck: 1.2 }
export const BBQ = { x: -8.5, z: 11.5 }
export const GARDEN = { x: 8.5, z: 12.5 }
/** Benches along the pool, facing the water. */
export const POOL_BENCHES: { x: number; z: number; facing: number }[] = [
  { x: -7.6, z: 1.5, facing: Math.PI / 2 },
  { x: -7.6, z: 4.0, facing: Math.PI / 2 },
  { x: -7.6, z: 6.5, facing: Math.PI / 2 },
  { x: -2.0, z: 9.0, facing: 0 },
  { x: 2.0, z: 9.0, facing: 0 },
  { x: 6.0, z: 9.0, facing: 0 },
]
export const POOL_LOUNGERS: { x: number; z: number; facing: number }[] = [
  { x: 8.2, z: 1.5, facing: -Math.PI / 2 },
  { x: 8.2, z: 4.0, facing: -Math.PI / 2 },
]

/* ------------------------------------------------------------------ desks -- */

export type Desk = {
  index: number
  x: number
  z: number
  /** Direction the desk opens: the chair sits at +facing, the monitor opposite. */
  facing: number
  column: number
  side: 'near' | 'far'
  /** Divisi pemilik meja — agent duduk di ruang divisinya. */
  division: AgentDivision
  /** Managers own one desk per division; everyone else is staff. */
  seat: 'manager' | 'staff'
}

/**
 * Nine workstations: three per division, in that division's own room on the
 * ground floor of the west bar. Each row is (manager, staff, staff) — the manager
 * sits nearest the door so the room reads as a team with a lead.
 */
function divisionDesks(division: AgentDivision, roomId: string, indexes: [number, number, number]): Desk[] {
  const r = room(roomId)
  const x = r.x1 + 2.4 // against the west wall, facing east into the room
  const zs = [
    (r.z1 + r.z2) / 2 - 3.6,
    (r.z1 + r.z2) / 2,
    (r.z1 + r.z2) / 2 + 3.6,
  ]
  return zs.map((z, i) => ({
    index: indexes[i],
    x,
    z,
    facing: Math.PI / 2,
    column: i,
    side: 'near' as const,
    division,
    seat: i === 0 ? ('manager' as const) : ('staff' as const),
  }))
}

export const DESKS: Desk[] = [
  ...divisionDesks('tech', 'dev', [0, 1, 2]),
  ...divisionDesks('growth', 'mkt', [3, 4, 5]),
  ...divisionDesks('content', 'content', [6, 7, 8]),
]

/** Meja-meja milik satu divisi (label urut). */
export function desksForDivision(div: AgentDivision): Desk[] {
  return DESKS.filter((d) => d.division === div).sort((a, b) => a.index - b.index)
}

/** The desk the division's manager owns. */
export function managerDesk(div: AgentDivision): Desk | undefined {
  return DESKS.find((d) => d.division === div && d.seat === 'manager')
}

export function deskByIndex(index: number): Desk | undefined {
  return DESKS.find((d) => d.index === index)
}

/* ------------------------------------------------------------------ seats -- */

export const HIP_LIFT = 0.011
export const SEATS = {
  /** Desk chair and conference chair: surface 0.505. */
  chair: { hip: 0.516, thigh: -86, knee: 90.75, thickness: 0.07 },
  /** Lounge sofa: a low seat, surface 0.449. */
  sofa: { hip: 0.46, thigh: -88, knee: 66, thickness: 0.34 },
  /** Poolside bench: surface 0.505. */
  bench: { hip: 0.516, thigh: -86, knee: 90.75, thickness: 0.3 },
  /** Pantry bar stool: surface 0.644, feet rest on the foot ring at 0.24. */
  stool: { hip: 0.655, thigh: -92, knee: 64, thickness: 0.07, footY: 0.24 },
} as const
export type SeatName = keyof typeof SEATS
export const seatTop = (s: SeatName) => SEATS[s].hip - HIP_LIFT

export const DESK_CHAIR = { x: 0, z: 1.0 }
export const SEAT_BACK_OFFSET = -0.06
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

/* --------------------------------------------------------- board / pantry -- */

export const BOARD_D = 0.14
export const BOARD_REVEAL = 0.35
/**
 * The green whiteboard on Rinjani's north wall — the office Kanban.
 *
 * `z` must clear the WALL, not the room's nominal edge: the wall is WALL_T thick
 * and its inner face sits at `z1 + WALL_T`. Placing the board at `z1 + WALL_T/2`
 * buried it inside the wall — it existed, but the camera only ever saw plaster.
 */
export const KANBAN_BOARD = {
  x: roomCentre('rinjani').x,
  y: LEVEL_H + 1.55,
  z: room('rinjani').z1 + WALL_T + BOARD_D / 2 + 0.02,
  w: 6.0,
  h: 2.4,
}
export const BOARD_COLUMNS = ['TODO', 'JALAN', 'REVIEW', 'SELESAI'] as const

/** Reception counter in the lobby, facing the entrance. Kept OFF the centre axis
 * (which must stay clear from the door into the courtyard) — a visitor walks in,
 * sees the counter to their left, and the middle of the lobby stays a thoroughfare. */
export const RECEPTION = { x: -7.0, z: 18.6 }
/** Pantry counter, against the east bar's outer wall. */
export const PANTRY = { x: 25.6, z: 8 }
export const PANTRY_STOOLS = [6.4, 8.0, 9.6] as const
export const PANTRY_STOOL_GAP = -1.05
/** The leisure room's sofa, facing the courtyard through the glass. */
export const LOUNGE = { x: 22.5, z: -12 }

/* ------------------------------------------------------------- footprints -- */

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
  /** 'wall' | 'prop' | 'desk' | 'seat' — walls are never passable. */
  kind: 'wall' | 'prop' | 'desk' | 'seat'
  /** Which floor this sits on. Walkers only collide with their own level. */
  level: 0 | 1
}

const fp = (
  id: string,
  x: number,
  z: number,
  hw: number,
  hd: number,
  h: number,
  kind: Footprint['kind'] = 'prop',
  level: 0 | 1 = 0,
): Footprint => ({ id, x, z, hw, hd, h, kind, level })

/** A wall from (x1,z1) to (x2,z2), axis-aligned, as one footprint. */
function wallSeg(id: string, x1: number, z1: number, x2: number, z2: number, level: 0 | 1 = 0): Footprint {
  const x = (x1 + x2) / 2
  const z = (z1 + z2) / 2
  const hw = Math.abs(x2 - x1) / 2 || WALL_T / 2
  const hd = Math.abs(z2 - z1) / 2 || WALL_T / 2
  return fp(id, x, z, hw, hd, WALL_H, 'wall', level)
}

const W = (v: number) => (v > 0 ? v - WALL_T / 2 : v + WALL_T / 2) // inner face helper
const OUT = WALL_T / 2

export const FOOTPRINTS: Footprint[] = [
  /* ------------------------------------------------- outer walls, level 0 -- */
  wallSeg('out-n', -HALF_W, -HALF_D, HALF_W, -HALF_D),
  wallSeg('out-w', -HALF_W, -HALF_D, -HALF_W, HALF_D),
  wallSeg('out-e', HALF_W, -HALF_D, HALF_W, HALF_D),
  // the U's two south ends
  wallSeg('out-sw', -HALF_W, HALF_D, -14, HALF_D),
  wallSeg('out-se', 14, HALF_D, HALF_W, HALF_D),
  // the lobby closes the gap between them, with the entrance cut in it
  wallSeg('lobby-s-w', -14, HALF_D, -2.2, HALF_D),
  wallSeg('lobby-s-e', 2.2, HALF_D, 14, HALF_D),

  /* --------------------------------- walls facing the courtyard, level 0 -- */
  wallSeg('in-w', -14, -9, -14, HALF_D),
  wallSeg('in-e', 14, -9, 14, HALF_D),
  // the north bar's ground floor is an open terrace, so its courtyard side is
  // COLUMNS rather than a wall — that is what makes the circulation obvious.
  ...[
    [-12.5, -9], [-7.5, -9], [-2.5, -9], [2.5, -9], [7.5, -9], [12.5, -9],
  ].map(([x, z], i) => fp(`terrace-col-${i}`, x, z, 0.28, 0.28, WALL_H, 'wall')),

  /* ------------------------------------------- lobby / courtyard, level 0 -- */
  // the lobby's courtyard side is mostly open: two short returns and a wide gap
  wallSeg('lobby-n-w', -14, 16, -4, 16),
  wallSeg('lobby-n-e', 4, 16, 14, 16),

  /* -------------------------------------- division partitions, level 0 --- */
  wallSeg('part-dev-mkt', WORK_X1, -6.9, WORK_X2, -6.9),
  wallSeg('part-mkt-content', WORK_X1, 6.9, WORK_X2, 6.9),
  wallSeg('part-leisure-pantry', 14 + WALL_T, 2, ROOM_W, 2),

  /* ------------------------------------------ exec-floor partitions, L1 --- */
  // The corridor runs along z -11.5..-9.3; these are the walls BETWEEN the rooms
  // and the corridor, with a door gap per room, plus the walls between rooms.
  ...(() => {
    const out: Footprint[] = []
    const zWall = -11.5
    const rooms = ROOMS.filter((r) => r.level === 1 && r.id !== 'corridor1')
    // Sort by x so consecutive rooms share an edge we can wall off.
    const sorted = [...rooms].sort((a, b) => a.x1 - b.x1)
    for (const r of sorted) {
      // the room's south wall, split around its door
      const d = r.door!
      if (d.x - d.hw > r.x1 + 0.05) {
        out.push(wallSeg(`l1-${r.id}-s-w`, r.x1, zWall, d.x - d.hw, zWall, 1))
      }
      if (d.x + d.hw < r.x2 - 0.05) {
        out.push(wallSeg(`l1-${r.id}-s-e`, d.x + d.hw, zWall, r.x2, zWall, 1))
      }
      // the wall between this room and the next one east
      const next = sorted.find((o) => Math.abs(o.x1 - r.x2) < 0.6)
      if (next) {
        out.push(wallSeg(`l1-${r.id}-e`, r.x2, r.z1, r.x2, r.z2, 1))
      }
    }
    // the corridor's own north wall is the room walls above; its west end is the
    // outer wall, its east end too. Nothing else is needed.
    return out
  })(),

  /* ------------------------------------------------------- desks + chairs -- */
  ...DESKS.flatMap((d) => {
    const s = Math.sin(d.facing)
    const c = Math.cos(d.facing)
    const chair = { x: d.x + DESK_CHAIR.z * s, z: d.z + DESK_CHAIR.z * c }
    return [
      fp(`desk-${d.index}`, d.x, d.z, 0.85, 0.5, 0.72, 'desk'),
      fp(`chair-${d.index}`, chair.x, chair.z, 0.32, 0.32, 0.5, 'seat'),
    ]
  }),

  /* ---------------------------------------------------------- meeting rooms */
  // tables, as one footprint each, on level 1
  ...MEETING_ROOM_IDS.map((id) => {
    const t = MEETING_TABLES[id]
    return fp(`mtable-${id}`, t.x, t.z, t.rx, t.rz, 0.72, 'desk', 1)
  }),
  // chairs
  ...MEETING_ROOM_IDS.flatMap((id) =>
    MEETING_ROOMS[id].seats.map((s, i) => fp(`mchair-${id}-${i}`, s.x, s.z, 0.3, 0.3, 0.5, 'seat', 1)),
  ),
  // the executive corridor is on level 1; nothing blocks it
  /* ------------------------------------------------------------- stairs --- */
  // The shaft itself is walkable (nav treats it as the level portal); the railing
  // is a thin prop either side so it reads as a stair, not a hole.
  fp('stair-rail-n', (STAIRS.x1 + STAIRS.x2) / 2, STAIRS.z1 - 0.1, (STAIRS.x2 - STAIRS.x1) / 2, 0.08, 1.0, 'prop', 0),
  fp('stair-rail-s', (STAIRS.x1 + STAIRS.x2) / 2, STAIRS.z2 + 0.1, (STAIRS.x2 - STAIRS.x1) / 2, 0.08, 1.0, 'prop', 0),
  fp('stair-rail-n1', (STAIRS.x1 + STAIRS.x2) / 2, STAIRS.z1 - 0.1, (STAIRS.x2 - STAIRS.x1) / 2, 0.08, 1.0, 'prop', 1),
  fp('stair-rail-s1', (STAIRS.x1 + STAIRS.x2) / 2, STAIRS.z2 + 0.1, (STAIRS.x2 - STAIRS.x1) / 2, 0.08, 1.0, 'prop', 1),

  /* --------------------------------------------------------------- pool --- */
  // The basin is solid: you cannot walk on water. Height is above the blocker
  // threshold (0.5) on purpose — at exactly 0.5 it slipped through the filter and
  // the pool was walkable.
  fp('pool-basin', POOL.x, POOL.z, POOL.w / 2, POOL.d / 2, 0.62, 'prop'),

  /* ---------------------------------------------------------- courtyard --- */
  fp('bbq', BBQ.x, BBQ.z, 0.9, 0.6, 0.95),
  fp('garden-bed', GARDEN.x, GARDEN.z, 1.2, 0.9, 0.5),
  ...POOL_BENCHES.map((b, i) => fp(`bench-${i}`, b.x, b.z, 0.55, 0.22, 0.5, 'seat')),
  ...POOL_LOUNGERS.map((l, i) => fp(`lounger-${i}`, l.x, l.z, 0.22, 0.55, 0.5, 'seat')),

  /* --------------------------------------------------------- lobby/rooms -- */
  fp('reception', RECEPTION.x, RECEPTION.z, 1.8, 0.45, 1.05, 'desk'),
  fp('reception-chair', RECEPTION.x, RECEPTION.z - 1.15, 0.32, 0.32, 0.5, 'seat'),

  /* -------------------------------------------------------------- pantry -- */
  fp('pantry-counter', PANTRY.x, PANTRY.z, 0.45, 3.2, 0.95),
  ...PANTRY_STOOLS.map((z, i) => fp(`stool-${i}`, PANTRY.x + PANTRY_STOOL_GAP, z, 0.24, 0.24, 0.62, 'seat')),

  /* -------------------------------------------------------------- leisure -- */
  fp('lounge-sofa', LOUNGE.x, LOUNGE.z, 1.5, 0.5, 0.85, 'seat'),
  fp('lounge-table', LOUNGE.x - 2.0, LOUNGE.z, 0.5, 0.5, 0.44, 'desk'),

  /* ------------------------------------------------------------ ceo suite -- */
  fp('ceo-desk', roomCentre('ceo').x, roomCentre('ceo').z - 1.5, 1.1, 0.6, 0.75, 'desk', 1),
  fp('ceo-chair', roomCentre('ceo').x, roomCentre('ceo').z - 0.4, 0.32, 0.32, 0.5, 'seat', 1),
  fp('ceo-sofa', roomCentre('ceo').x, roomCentre('ceo').z + 2.6, 1.3, 0.5, 0.85, 'seat', 1),
]

/* ------------------------------------------------------------------ spots -- */

export type IdleSpot = {
  x: number
  z: number
  act: 'idle' | 'sofa' | 'garden' | 'read' | 'coffee' | 'pool'
  seated?: boolean
  face: number
  level: 0 | 1
}

/**
 * Where an idle agent goes, and which way it faces on arrival. With the pool, the
 * BBQ, the pantry and the leisure room there are enough distinct spots that a
 * handful of agents spread out — and idle agents WALK between them rather than
 * standing still, which is what keeps the office alive without spending a token.
 */
export const IDLE_SPOTS: IdleSpot[] = [
  ...POOL_BENCHES.map((b) => ({ x: b.x, z: b.z, act: 'pool' as const, seated: true, face: b.facing, level: 0 as const })),
  ...POOL_LOUNGERS.map((l) => ({ x: l.x, z: l.z, act: 'pool' as const, seated: true, face: l.facing, level: 0 as const })),
  { x: BBQ.x + 1.6, z: BBQ.z, act: 'idle', face: -Math.PI / 2, level: 0 },
  { x: GARDEN.x, z: GARDEN.z + 1.6, act: 'garden', face: Math.PI, level: 0 },
  { x: GARDEN.x - 1.8, z: GARDEN.z + 1.2, act: 'garden', face: Math.PI, level: 0 },
  { x: PANTRY.x + PANTRY_STOOL_GAP, z: PANTRY_STOOLS[0], act: 'coffee', seated: true, face: -Math.PI / 2, level: 0 },
  { x: PANTRY.x + PANTRY_STOOL_GAP, z: PANTRY_STOOLS[1], act: 'coffee', seated: true, face: -Math.PI / 2, level: 0 },
  { x: PANTRY.x + PANTRY_STOOL_GAP, z: PANTRY_STOOLS[2], act: 'coffee', seated: true, face: -Math.PI / 2, level: 0 },
  { x: LOUNGE.x - 1.4, z: LOUNGE.z + 1.6, act: 'sofa', seated: true, face: 0, level: 0 },
  { x: 0, z: 12.5, act: 'idle', face: Math.PI, level: 0 },
  { x: -10, z: -5, act: 'idle', face: Math.PI / 2, level: 0 },
  { x: 10, z: -5, act: 'idle', face: -Math.PI / 2, level: 0 },
  { x: -20, z: -12, act: 'idle', face: 0, level: 0 },
  { x: 20, z: -12, act: 'idle', face: 0, level: 0 },
  { x: -4, z: 18.5, act: 'idle', face: 0, level: 0 },
]

/* -------------------------------------------------------------- openings -- */

/** Doorways. `nav.ts` cuts these out of the wall grid so a walker can pass. */
export const OPENINGS: { x: number; z: number; hw: number; hd: number; level: 0 | 1 }[] = [
  { x: DOOR.x, z: HALF_D, hw: 2.2, hd: 0.6, level: 0 },
  ...ROOMS.filter((r) => r.door).map((r) => ({ ...r.door!, level: r.level })),
  // the stair shaft is open on both floors
  { x: (STAIRS.x1 + STAIRS.x2) / 2, z: (STAIRS.z1 + STAIRS.z2) / 2, hw: (STAIRS.x2 - STAIRS.x1) / 2, hd: (STAIRS.z2 - STAIRS.z1) / 2, level: 0 },
  { x: (STAIRS.x1 + STAIRS.x2) / 2, z: (STAIRS.z1 + STAIRS.z2) / 2, hw: (STAIRS.x2 - STAIRS.x1) / 2, hd: (STAIRS.z2 - STAIRS.z1) / 2, level: 1 },
]

/* --------------------------------------------------------------- signs ---- */

export const ROOM_SIGNS: { text: string; x: number; z: number; level: 0 | 1 }[] = ROOMS.filter(
  (r) => r.id !== 'corridor1' && r.id !== 'terrace',
).map((r) => ({
  text: r.label,
  x: (r.x1 + r.x2) / 2,
  z: r.id === 'lobby' ? r.z1 + 0.4 : r.z2 - 0.4,
  level: r.level,
}))

/* -------------------------------------------------------------- validation -- */

export type Conflict = { a: string; b: string; overlapX: number; overlapZ: number }

/**
 * Proves no two solid props occupy the same ground on the SAME level. Walls and
 * seats are ignored (seats may tuck under a desk), and so are the pool benches
 * against the deck.
 */
export function layoutConflicts(list: Footprint[] = FOOTPRINTS): Conflict[] {
  const solid = list.filter((f) => f.kind !== 'wall' && f.kind !== 'seat' && f.h > 0.05)
  const out: Conflict[] = []
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i]
      const b = solid[j]
      if (a.level !== b.level) continue
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
  manager: 0xe8a33d,
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
