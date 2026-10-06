import type { Activity } from './anim'
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

/**
 * Which room a meeting uses, from its participant list and their divisions.
 *
 * One division → that division's own room. An exec-heavy small meeting (the CEO
 * with the three managers) → Merapi. Anything spanning divisions → Rinjani, the
 * ten-seat room.
 *
 * This lives here, next to the room table, rather than in the 3D scene: BOTH views
 * need it (the sprite map seats people too), and the scene imports three.js, which
 * a 2D component must not pull in.
 */
export function meetingRoomFor(
  participants: string[],
  divisions: Map<string, AgentDivision>,
): MeetingRoomId {
  const divs = new Set(participants.map((p) => divisions.get(p) ?? 'tech'))
  if (divs.size === 1) {
    const only = [...divs][0]
    if (only !== 'exec') return DIVISION_MEETING_ROOM[only]
  }
  if (participants.length <= 4 && divs.has('exec')) return 'merapi'
  return 'rinjani'
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
 * The stair to the executive floor — an EXTERNAL stair standing in the courtyard.
 *
 * WHY HERE, and why the two earlier positions were wrong:
 *
 *   1. Level 1 exists ONLY over the north bar, so the stair must serve the north
 *      bar — there is no other floor for it to reach.
 *   2. The north bar's ground floor (the terrace) is COMPLETELY covered by the
 *      level-1 slab. A stair standing there sits underneath the marble: invisible
 *      from every camera angle. Both earlier positions put it there, which is
 *      exactly why it never looked right — it could not be seen at all.
 *   3. So the flight stands in the COURTYARD (z > -9), in open air, climbing the
 *      north bar's south face, and its top landing passes through a notch cut in
 *      the slab edge onto the corridor. A real external feature stair: you see it
 *      from the pool deck, you walk to it, and it lands by the CEO suite — which
 *      is who uses that floor.
 *
 * Geometry: the flight runs along Z and rises NORTHWARD. Bottom step at z2 (out in
 * the courtyard), top landing at z1 (inside the building line, at corridor level).
 * 5.5 m of run for 3.4 m of rise ≈ 32°, which is a normal stair pitch.
 */
export const STAIRS = {
  x1: -10.0,
  x2: -8.6,
  z1: -10.4,
  z2: -3.2,
  /** The flight runs along Z (north-south), not X. */
  axis: 'z' as const,
  /** Which end is the BOTTOM: the courtyard end (+Z) is. */
  lowEnd: 'z2' as const,
  /**
   * Depth of the flat landing at the top.
   *
   * The landing has to be deep enough to STAND on. `blocked()` refuses level-1
   * ground south of z=-9.47 (the floor edge minus the wall band), so only the part
   * of the landing north of that line is usable — with a 1.4 m landing that is
   * ~0.9 m, which fits a body. A 1.0 m landing left ~0.5 m and the stair
   * dead-ended in mid-air.
   */
  landing: 1.4,
  fromLevel: 0 as const,
  toLevel: 1 as const,
}

/**
 * The two ends of the stair, as nav waypoints.
 *
 * `routeBetween()` walks to the FOOT on the lower level, hands over, then walks
 * from the TOP on the upper level. Two separate points are required — not one
 * shared "shaft centre" — because the stair is no longer a hole in the floor that
 * is walkable on both levels: it is a real object in the courtyard, so the foot is
 * level-0 ground and the top is level-1 floor, and those are different places.
 */
export const STAIR_FOOT = { x: (STAIRS.x1 + STAIRS.x2) / 2, z: STAIRS.z2 + 0.7 }
/**
 * The hand-over point, ON THE LANDING.
 *
 * Both directions switch floors HERE, not at the foot. Handing over at the foot
 * stranded a descending body: at level 1 it cannot step south past z=-9.47 (the
 * floor edge), so it could never reach the flight. Switching on the landing works
 * both ways — up you climb first and switch at the top, down you switch at the top
 * and then descend.
 */
export const STAIR_TOP = { x: (STAIRS.x1 + STAIRS.x2) / 2, z: STAIRS.z1 + 0.3 }

/** Where the flight itself ends and the flat landing begins. */
export const STAIR_FLIGHT_TOP = STAIRS.z1 + STAIRS.landing

/**
 * How far the handrail continues LEVEL past the top nosing, before it stops.
 *
 * A real handrail runs about one tread (≈300 mm) past the top riser and then ends —
 * that is the whole point of the extension: your hand has somewhere to go as you
 * step off. It must NOT run the full depth of the landing. This was 1.4 m (the whole
 * landing), so a bar sat at waist height right across the corridor.
 */
export const STAIR_RAIL_EXTENSION = 0.35

/**
 * Height of the walking surface at a point, for the climb animation.
 *
 * A body on the stair should rise as it walks, not teleport 3.4 m at the top. The
 * stair is a ramp in world space, so its height is a pure function of z: 0 at the
 * bottom step, LEVEL_H at the landing. Returns null when (x,z) is not on the
 * stair, so the caller can leave the body alone.
 */
export function stairHeightAt(x: number, z: number): number | null {
  if (x < STAIRS.x1 || x > STAIRS.x2) return null
  if (z > STAIRS.z2 || z < STAIRS.z1) return null
  if (z <= STAIR_FLIGHT_TOP) return LEVEL_H
  const t = (z - STAIRS.z2) / (STAIR_FLIGHT_TOP - STAIRS.z2)
  return LEVEL_H * Math.min(1, Math.max(0, t))
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

/**
 * Where the water SURFACE actually is, as drawn.
 *
 * The mesh offsets the plane below `POOL.waterY`, and the swim pose has to float a body at
 * exactly this height. Two copies of the number is how the body ended up hovering above the
 * water: the pose was solved against `waterY` while the plane sat 0.06 lower.
 */
export const WATER_Y = POOL.waterY - 0.06

/* ------------------------------------------------------- courtyard zones -- */

/**
 * The courtyard is organised as FOUR named zones around the pool.
 *
 * These are the single source of truth: the meshes, the collision footprints and
 * the idle spots all read them, so a bench can never again end up drawn in one
 * place and walked to in another.
 *
 *   NORTH  (z -9.3 .. -2.3)  the GYM      — big green mat, weights, pull-up rig
 *   EAST   (x  6.8 .. 10.1)  the BBQ      — grill counter, north end of the strip
 *   WEST   (x -12.0 .. -7.4) the SUNBEDS  — timber daybeds facing the water
 *   SOUTH  (z  8.2 .. 10.4)  the LOUNGE   — plain wooden seats facing the water
 *   plus a PLANTING band between the gym and the pool (z -2.6 .. -0.7).
 *
 * All of it is inside the courtyard bounds (x -14..14, z -9..16), clear of the
 * pool (x -6..6, z 0.5..7.5) and clear of the stair foot (z -3.2).
 */

/** The gym: a green rubber mat with weights under it and a pull-up rig on it. */
export const GYM = {
  /** Mat rectangle — 13 x 7 m of open courtyard north of the pool. */
  x1: -6.5, x2: 6.5, z1: -9.0, z2: -2.4,
  /** The barbell rack, on the mat's west half. `barY` is where the bar rests. */
  /**
   * The barbell rack. `barY` is where the bar rests; `benchTop` is the surface of the pad
   * underneath it, which the bench-press pose lies on. Both are data because the pose has
   * to agree with the mesh, and the self-test compares them.
   */
  rack: { x: -4.2, z: -5.6, barY: 1.32, benchTop: 0.52 },
  /** Dumbbell rack, on the mat's east half. */
  dumbbells: { x: 4.2, z: -5.6 },
  /**
   * Pull-up rig: two posts and a bar, across the mat's north edge.
   *
   * `barY` is the height of the bar you hang from. It is DATA because the pull-up
   * pose has to solve the body's height so the fists land ON this bar — if the mesh
   * and the animation each carried their own copy of 2.39, a change to one would
   * silently leave the avatar hanging in mid-air beside the bar.
   *
   * `crossBarY` is the lower rail. It is data for the same reason: a body hanging from
   * `barY` sweeps its head through 1.62..1.97, so a rail at 1.70 passes THROUGH the
   * head. The value is chosen to clear that band, and the self-test asserts it.
   */
  rig: { x: 0, z: -7.6, span: 3.0, barY: 2.39, crossBarY: 1.4 },
}

/**
 * The planting band between the gym and the pool's north edge.
 *
 * `z1` must be >= the gym's `z2`, or the band overlaps the mat. It was -2.6 while
 * the gym ended at -2.4, so the two interpenetrated by 0.2 m.
 */
export const PLANTING = { x1: -6.0, x2: 6.2, z1: -2.4, z2: -0.8, count: 9 }

/** Timber daybeds on the pool's west side, facing the water (east). */
export const SUNBEDS: { x: number; z: number; facing: number }[] = [
  // facing +PI/2 turns the lounger's head (local -z) to point WEST (-x), so the
  // body lies looking EAST across the pool. The daybeds are west of the pool, so
  // this is "head away from the water, looking at it".
  { x: -9.6, z: 1.4, facing: Math.PI / 2 },
  { x: -9.6, z: 4.0, facing: Math.PI / 2 },
  { x: -9.6, z: 6.6, facing: Math.PI / 2 },
]

/** Plain wooden seats on the pool's south side, facing the water (north). */
export const POOL_BENCHES: { x: number; z: number; facing: number }[] = [
  // Rotation 0 already faces NORTH (-z), because the bench mesh puts its back
  // slats at local +z. These sit SOUTH of the pool, so rotation 0 looks across the
  // water. `Math.PI` swung them to face away from it — the self-test caught it.
  { x: -3.6, z: 9.3, facing: 0 },
  { x: 0.0, z: 9.3, facing: 0 },
  { x: 3.6, z: 9.3, facing: 0 },
]

/** The BBQ: a grill counter at the north end of the east strip. */
export const BBQ = { x: 8.4, z: -6.4 }

/**
 * Decorative planting, replacing the old free-standing planter box.
 *
 * The old GARDEN was a 2.4 x 1.8 m raised bed that read as a stray object. These
 * are low beds tucked along the courtyard edges, so the greenery frames the space
 * instead of standing in it.
 */
export const GARDEN_BEDS: { x: number; z: number; w: number; d: number }[] = [
  { x: 8.4, z: 12.6, w: 3.0, d: 1.6 },
  { x: -8.4, z: 12.6, w: 3.0, d: 1.6 },
]

/** The poolside daybeds, kept as a named export for the model and the self-test. */
export const POOL_LOUNGERS = SUNBEDS

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
/**
 * The leisure room's seating group.
 *
 * ONE definition, read by the model, the collision footprints AND the idle spots.
 * They used to disagree: the TV hung 5.4 m out from any wall (floating in the
 * middle of the room), the coffee table's footprint sat 2 m west of the table
 * itself, and the sofa's idle spot was off the sofa entirely — so avatars were
 * blocked by empty air and sat on nothing.
 *
 * The sofa faces NORTH (-z) with its back to the south, looking at the TV on the
 * north wall. Rotation 0 already faces -z, because the sofa mesh puts its back
 * rest at local +z.
 */
export const LOUNGE = { x: 22.5, z: -18.2 }
/** The TV, flat against the leisure room's north wall (inner face z = -20.85). */
export const LOUNGE_TV = { x: 22.5, z: -20.78, y: 1.5 }
/** Coffee table, between the sofa and the TV. */
export const LOUNGE_TABLE = { x: 22.5, z: -19.6 }

/* -------------------------------------------------------- dining tables -- */

/**
 * A dining set: one table, four chairs.
 *
 * ONE definition read by the mesh, the collision footprints and the idle spots — the
 * same rule as the courtyard zones, and for the same reason: when the model and the
 * spots disagree, an avatar sits on nothing and walks into empty air.
 *
 * `facing` is the direction the whole set looks — the long axis of the table. The four
 * chairs are placed on the two long sides and the two ends, and EACH ONE's facing is
 * derived from its own offset to the table centre, never from a constant: that is the
 * bug that once left half the meeting chairs with their backs to the table.
 */
export type DiningSet = {
  /** Table centre. */
  x: number
  z: number
  /** Which way the table's long axis runs, in radians (0 = along +z). */
  facing: number
  /** Table top size. */
  w: number
  d: number
}

export const DINING_SETS: DiningSet[] = [
  // SIX tables in the PANTRY / DAPUR, in a deliberate grid — not scattered.
  //
  // The room runs x 14.2..27.9, z 2.0..20.9, with the counter on the far east wall
  // (x 25.15..26.05) and the water cooler at its south end. Two columns of three:
  //
  //   column A  x = 17.0    column B  x = 21.6
  //   rows      z = 6.0, 10.6, 15.2
  //
  // A 2.2 m gap between columns and 4.6 m between rows, so every set has room for its four
  // chairs and a body can walk between them. All six are clear of the counter and the
  // partition at z = 2.
  { x: 17.0, z: 6.0, facing: Math.PI / 2, w: 1.8, d: 0.9 },
  { x: 17.0, z: 10.6, facing: Math.PI / 2, w: 1.8, d: 0.9 },
  { x: 17.0, z: 15.2, facing: Math.PI / 2, w: 1.8, d: 0.9 },
  { x: 21.6, z: 6.0, facing: Math.PI / 2, w: 1.8, d: 0.9 },
  { x: 21.6, z: 10.6, facing: Math.PI / 2, w: 1.8, d: 0.9 },
  { x: 21.6, z: 15.2, facing: Math.PI / 2, w: 1.8, d: 0.9 },
]

/** Seat height of a dining chair — matches SEATS.chair, so the pose is unchanged. */
export const DINING_CHAIR_OFFSET = 0.78

/**
 * The four chair positions of one set.
 *
 * The chairs sit on the two long sides (at `+-halfD` across the table) and the two ends
 * (at `+-halfW` along it). The long-axis unit vector is (sin facing, cos facing) and the
 * across vector is (cos facing, -sin facing), so a set at any angle still gets four
 * chairs in the right places.
 */
export function diningChairs(set: DiningSet): { x: number; z: number }[] {
  const ax = Math.sin(set.facing)
  const az = Math.cos(set.facing)
  // across the table
  const bx = Math.cos(set.facing)
  const bz = -Math.sin(set.facing)
  const halfW = set.w / 2 + 0.42
  const halfD = set.d / 2 + 0.42
  return [
    { x: set.x + ax * halfW, z: set.z + az * halfW },
    { x: set.x - ax * halfW, z: set.z - az * halfW },
    { x: set.x + bx * halfD, z: set.z + bz * halfD },
    { x: set.x - bx * halfD, z: set.z - bz * halfD },
  ]
}


/* ------------------------------------------------------------- access -- */

/**
 * THE facing convention, in one place.
 *
 * `face` is the direction a BODY LOOKS. Every avatar mesh in this project carries its face
 * on local -z, so a body rotated by `f` looks along `(-sin f, -cos f)`.
 *
 * Therefore, to look AT a point:
 *
 *     look = (target - from) / |target - from|
 *     -sin f = dx, -cos f = dz
 *     f = atan2(-dx, -dz)
 *
 * Almost every spot in this file used `atan2(dx, dz)` instead — the exact opposite — which
 * is why chairs had their backs to their tables, the pantry stools faced away from the
 * counter, the gardener turned his back on the plants and the cooks faced away from the
 * grill. One helper, used everywhere, is what stops that recurring: the convention is
 * written down once and every caller reads it.
 */
export function faceToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ))
}

/** The world direction a body with this facing LOOKS. */
export function lookVector(face: number): { x: number; z: number } {
  return { x: -Math.sin(face), z: -Math.cos(face) }
}

/**
 * Which way a body sitting at a desk's chair LOOKS: at the desk.
 *
 * Lives here, beside `faceToward`, so the self-test can call it. It used to be a private
 * function inside `scene.ts` with a hand-rolled `atan2(dx, dz)` — the opposite sign from the
 * convention — which put every typing agent's back to its own desk.
 */
export function deskSeatFacing(desk: Desk): number {
  const chair = deskSeatWorld(desk)
  return faceToward(chair.x, chair.z, desk.x, desk.z)
}

/**
 * Who may enter the CEO suite.
 *
 * The room is the CEO's, so the door is not a free-for-all: only a CEO and the division
 * managers go in. Everyone else is turned away — including the `orchestrator` role, which
 * is the default for an `exec` profile with no explicit role, because "exec" is a
 * DIVISION (which floor you report to) and not a rank.
 *
 * Kept as data because two places read it: `retarget` refuses to send an agent in, and
 * the self-test checks that the refusal actually happens rather than trusting a comment.
 */
export const CEO_ROOM_ROLES: readonly AgentRole[] = ['ceo', 'manager']

/** May this role go into the CEO suite? */
export function mayEnterCeoRoom(role: AgentRole): boolean {
  return CEO_ROOM_ROLES.includes(role)
}

/**
 * Is this point inside the CEO suite? `pad` widens the test, so a caller can ask
 * "would standing here be inside the room".
 */
export function insideCeoRoom(x: number, z: number, pad = 0): boolean {
  const r = ROOMS.find((room) => room.id === 'ceo')
  if (!r) return false
  return x > r.x1 - pad && x < r.x2 + pad && z > r.z1 - pad && z < r.z2 + pad
}

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

/**
 * The courtyard-facing wall of the west and east bars, SPLIT AT EACH DOORWAY.
 *
 * Both the collision footprints AND the 3D model are built from this one list, so
 * a doorway cannot be a gap in one and a solid wall in the other. That mismatch is
 * exactly what sealed every ground-floor room: the model drew a full wall from
 * z=-9 to z=21 and the door jambs were then added ON TOP of it, filling the
 * openings back in. The rooms were walkable in the nav grid and solid in the
 * render — the worst of both worlds.
 */
export function courtyardWallSegments(): { id: string; x1: number; z1: number; x2: number; z2: number }[] {
  const out: { id: string; x1: number; z1: number; x2: number; z2: number }[] = []
  // The rooms that actually HAVE a courtyard-facing wall. `courtyard` and
  // `terrace` carry a stray `door` field (a copy of dev's) but are not enclosed,
  // so including them would build walls that belong to nobody.
  const ENCLOSED = ['dev', 'mkt', 'content', 'leisure', 'pantry']
  for (const r of ROOMS.filter((x) => x.level === 0 && x.door && ENCLOSED.includes(x.id))) {
    const d = r.door!
    const xw = d.x < 0 ? -14 : 14
    if (d.z - d.hd > r.z1 + 0.1) out.push({ id: `${r.id}-wall-a`, x1: xw, z1: r.z1, x2: xw, z2: d.z - d.hd })
    if (d.z + d.hd < r.z2 - 0.1) out.push({ id: `${r.id}-wall-b`, x1: xw, z1: d.z + d.hd, x2: xw, z2: r.z2 })
  }
  return out
}

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
  // Split at every doorway, from the shared list above — see courtyardWallSegments.
  ...courtyardWallSegments().map((s) => wallSeg(s.id, s.x1, s.z1, s.x2, s.z2)),
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
  // The shaft itself is NOT a footprint: `nav.ts` treats the whole region as
  // walkable on both levels, which is what makes it a portal rather than a wall.
  // The railings are drawn in `build.ts` as pure decoration — putting them here
  // as blocking props would fence off the very opening a walker has to enter
  // through, since the shaft region and the rail strip overlap by design.

  /* --------------------------------------------------------------- pool --- */
  // The basin is solid: you cannot walk on water. Height is above the blocker
  // threshold (0.5) on purpose — at exactly 0.5 it slipped through the filter and
  // the pool was walkable.
  fp('pool-basin', POOL.x, POOL.z, POOL.w / 2, POOL.d / 2, 0.62, 'prop'),

  /* ---------------------------------------------------------- courtyard --- */
  // BBQ counter, north end of the east strip.
  fp('bbq', BBQ.x, BBQ.z, 0.95, 0.62, 0.95),
  // Decorative planting beds, low enough to be walked around, not through.
  ...GARDEN_BEDS.map((g, i) => fp(`garden-bed-${i}`, g.x, g.z, g.w / 2, g.d / 2, 0.5)),
  // The planting band along the pool's north edge.
  fp(
    'planting-band',
    (PLANTING.x1 + PLANTING.x2) / 2,
    (PLANTING.z1 + PLANTING.z2) / 2,
    (PLANTING.x2 - PLANTING.x1) / 2,
    (PLANTING.z2 - PLANTING.z1) / 2,
    // 0.62, not 0.45: `blockingFootprints()` keeps only h > 0.5, so at 0.45 the
    // band was invisible to collision and avatars walked through the shrubs.
    0.62,
  ),
  // The gym: the mat is a RUG (not a blocker — you stand on it), but the equipment
  // on it is solid.
  fp('gym-rack', GYM.rack.x, GYM.rack.z, 0.7, 0.9, 1.25),
  fp('gym-dumbbells', GYM.dumbbells.x, GYM.dumbbells.z, 1.1, 0.45, 0.95),
  // the pull-up rig: two posts, so a body can walk between them
  fp('gym-rig-w', GYM.rig.x - GYM.rig.span / 2, GYM.rig.z, 0.12, 0.12, 2.45),
  fp('gym-rig-e', GYM.rig.x + GYM.rig.span / 2, GYM.rig.z, 0.12, 0.12, 2.45),
  // Benches and daybeds.
  ...POOL_BENCHES.map((b, i) => fp(`bench-${i}`, b.x, b.z, 0.55, 0.22, 0.5, 'seat')),
  ...POOL_LOUNGERS.map((l, i) => fp(`lounger-${i}`, l.x, l.z, 0.45, 0.85, 0.5, 'seat')),

  /* --------------------------------------------------------- lobby/rooms -- */
  fp('reception', RECEPTION.x, RECEPTION.z, 1.8, 0.45, 1.05, 'desk'),
  fp('reception-chair', RECEPTION.x, RECEPTION.z - 1.15, 0.32, 0.32, 0.5, 'seat'),

  /* -------------------------------------------------------------- pantry -- */
  fp('pantry-counter', PANTRY.x, PANTRY.z, 0.45, 3.2, 0.95),
  ...PANTRY_STOOLS.map((z, i) => fp(`stool-${i}`, PANTRY.x + PANTRY_STOOL_GAP, z, 0.24, 0.24, 0.62, 'seat')),
  // The water cooler stands clear of the counter's south end; the coffee machine sits ON
  // the counter, so it needs no footprint of its own (the counter already blocks there).
  fp('pantry-water-cooler', PANTRY.x - 0.1, PANTRY.z + 3.6, 0.24, 0.24, 1.6),

  /* --------------------------------------------------------- dining sets -- */
  // Each set contributes a table (solid, `desk` so a body cannot stand in it) and four
  // chairs (`seat`, so the settling exemption can step onto them). Every chair's own
  // facing is derived from its offset, which is what keeps all four looking at the table.
  ...DINING_SETS.flatMap((s, si) => [
    fp(`dining-${si}-table`, s.x, s.z, s.d / 2 + 0.1, s.w / 2 + 0.1, 0.75, 'desk'),
    ...diningChairs(s).map((c, ci) => fp(`dining-${si}-chair-${ci}`, c.x, c.z, 0.32, 0.32, 0.5, 'seat')),
  ]),

  /* -------------------------------------------------------------- leisure -- */
  fp('lounge-sofa', LOUNGE.x, LOUNGE.z, 1.5, 0.55, 0.85, 'seat'),
  fp('lounge-table', LOUNGE_TABLE.x, LOUNGE_TABLE.z, 0.6, 0.3, 0.44, 'desk'),

  /* ------------------------------------------------------------ ceo suite -- */
  fp('ceo-desk', roomCentre('ceo').x, roomCentre('ceo').z - 1.5, 1.1, 0.6, 0.75, 'desk', 1),
  fp('ceo-chair', roomCentre('ceo').x, roomCentre('ceo').z - 0.4, 0.32, 0.32, 0.5, 'seat', 1),
  fp('ceo-sofa', roomCentre('ceo').x, roomCentre('ceo').z + 2.6, 1.3, 0.5, 0.85, 'seat', 1),
]

/* ------------------------------------------------------------------ spots -- */

/**
 * Activities an idle spot may hold.
 *
 * DERIVED from the pose table, not a second copy of it. The two lists were separate
 * and drifted: a spot named a pose the animator did not implement, and adding a pose
 * did not make it available to a spot. `Exclude` names only the poses that belong to
 * WORK rather than to a place — a body is 'typing' because it has a desk and 'walking'
 * because it is en route, and neither is somewhere you can send an idle agent.
 */
export type IdleActivity = Exclude<Activity, 'walking' | 'typing' | 'gaming' | 'dart'>

export type IdleSpot = {
  x: number
  z: number
  act: IdleActivity
  seated?: boolean
  /**
   * This spot is LYING ON equipment that is itself solid.
   *
   * A bench press is done lying on the bench, and the bench is inside the rack's own
   * footprint — so the destination is inside a solid by construction, exactly like a
   * chair tucked under a desk. This flag is what tells the mover to allow the final step.
   */
  bench?: boolean
  /**
   * This spot is IN the pool.
   *
   * A swimmer has to enter the water, and the basin is a solid for everyone on foot —
   * otherwise avatars stroll across the surface. The mover reads this to let the body
   * in, exactly as `seated` lets it step onto a chair.
   */
  water?: boolean
  face: number
  level: 0 | 1
}

/**
 * Every place an idle body can go — one spot per piece of usable furniture, plus
 * open standing room.
 *
 * The rule: if the office built it, somebody should be able to enjoy it. A dummy
 * that has not been spawned yet and an agent with no task both wander this list,
 * so the courtyard, the gym, the BBQ, the pantry and the executive floor all see
 * traffic instead of only the desks.
 *
 * `seated` marks a spot ON a seat: the mover then ignores seat footprints so the
 * body can actually step onto the chair (see `goingToSeat` in scene.ts).
 */
export const IDLE_SPOTS: IdleSpot[] = [
  /* ---- poolside: the south benches, and the west daybeds to LIE on ------- */
  // `face` is computed to LOOK AT THE WATER, not copied from the mesh rotation. The mesh's
  // `facing` is a build-time rotation and the body's facing is a look direction: they are
  // different quantities, and reusing one for the other is what turned the two outer benches
  // 34 degrees off the pool.
  ...POOL_BENCHES.map((b) => ({
    x: b.x, z: b.z, act: 'pool' as const, seated: true,
    face: faceToward(b.x, b.z, POOL.x, POOL.z), level: 0 as const,
  })),
  // The daybeds are for LYING, not sitting: they have a raised back rest, and a seated
  // pose on one reads as somebody perched on the edge of a bed. `act: 'recline'` is what
  // selects the lying pose — the activity picks the pose, exactly as 'barbell' does.
  // The daybed lies with its head AWAY from the water so the body looks across it, which is
  // the same look direction the bench uses.
  ...SUNBEDS.map((b) => ({
    x: b.x, z: b.z, act: 'recline' as const, seated: true,
    face: faceToward(b.x, b.z, POOL.x, POOL.z), level: 0 as const,
  })),

  /* ---- IN the water: swimming ------------------------------------------- */
  // Four lanes across the pool. `water` lets the mover in; without it the basin is a
  // solid and nobody ever swims. The face points along the lane, so a swimmer is
  // already looking where it is going.
  { x: -4.0, z: 4.0, act: 'swim', water: true, face: -Math.PI / 2, level: 0 },
  { x: -1.5, z: 4.0, act: 'swim', water: true, face: -Math.PI / 2, level: 0 },
  { x: 1.5, z: 4.0, act: 'swim', water: true, face: Math.PI / 2, level: 0 },
  { x: 4.0, z: 4.0, act: 'swim', water: true, face: Math.PI / 2, level: 0 },

  /* ---- the gym: one spot per station, and each station's pose uses it ----- */
  // The pose is chosen by the SPOT, not by the room: a body at the barbell rack holds
  // the barbell, a body under the rig hangs from it, a body at the dumbbell rack curls
  // them. Standing on the mat doing an air-press was the old behaviour, and it is why
  // the weights looked like scenery nobody touched.
  //
  // `face` points AT the equipment in every case, because a body exercising away from
  // the thing it is using looks broken (poin 8 and 9).
  { x: GYM.rack.x + 1.15, z: GYM.rack.z + 0.75, act: 'barbell', face: faceToward(GYM.rack.x + 1.15, GYM.rack.z + 0.75, GYM.rack.x, GYM.rack.z), level: 0 },
  // BENCH PRESS: ON the bench, not beside it. The bench pad is at the rack's own centre
  // (x -4.2, z -5.6), so the spot is the pad itself. The first version reused the
  // standing-press offset and put the body 1.37 m away, lying on the floor next to the
  // bench — measured, not guessed.
  // The bench press LIES on the rack, so there is no direction to look "at" — the body is
  // supine. Its facing is the rack's own axis: feet toward the rack's south side.
  { x: GYM.rack.x, z: GYM.rack.z, act: 'benchpress', bench: true, face: 0, level: 0 },
  // In FRONT of the dumbbell rack (the rack's own footprint spans x 3.1..5.3,
  // z -6.05..-5.15, so a spot at its centre is inside it). Facing north to the rack.
  { x: GYM.dumbbells.x - 0.6, z: GYM.dumbbells.z + 0.9, act: 'dumbbell', face: faceToward(GYM.dumbbells.x - 0.6, GYM.dumbbells.z + 0.9, GYM.dumbbells.x, GYM.dumbbells.z), level: 0 },
  { x: GYM.dumbbells.x + 0.2, z: GYM.dumbbells.z + 1.5, act: 'dumbbell', face: faceToward(GYM.dumbbells.x + 0.2, GYM.dumbbells.z + 1.5, GYM.dumbbells.x, GYM.dumbbells.z), level: 0 },
  // directly under the bar: the pull-up pose solves its own height, so the body hangs
  // with its feet off the mat rather than standing beside the rig.
  // Hanging from the bar: the body faces the bar, which is directly overhead at the same
  // x/z, so any facing is "at" it. North, so the face is toward the bar's far side.
  { x: GYM.rig.x, z: GYM.rig.z, act: 'pullup', face: Math.PI, level: 0 },
  // Muscle-up: on the SAME bar as the pull-up, at the other end of the span. It used to
  // sit at `rig.x + span/2 + 0.55` — 0.55 m PAST the end post — so the body hung off the
  // side of the bar with nothing to grip.
  //
  // x +0.85 is the far end of the safe band: the end post is at 1.5, and a body needs
  // 0.46 m of clearance from it (post half-width 0.12 + body radius 0.34), which rules out
  // anything past 1.04. It is also 0.85 m from the pull-up spot, so the two stations are
  // visibly separate.
  { x: GYM.rig.x + 0.85, z: GYM.rig.z, act: 'muscleup', face: Math.PI, level: 0 },

  /* ---- the BBQ: stand AT the grill, looking at it (poin 8) -------------- */
  // The grill counter's footprint is x 7.45..9.35, z -7.02..-5.78. Every spot stands
  // clear of it and its `face` is SOLVED to point at the counter centre: the cook pose
  // leans along local +z, so the look vector is (sin f, cos f) and f = atan2(dx, dz).
  //
  // Two of these three used to be wrong — a fixed `Math.PI` and `0` left them facing
  // away from the grill, which the self-test caught as dot = -0.97 and -0.53.
  { x: BBQ.x - 1.55, z: BBQ.z, act: 'bbq', face: faceToward(BBQ.x - 1.55, BBQ.z, BBQ.x, BBQ.z), level: 0 },
  { x: BBQ.x - 0.35, z: BBQ.z + 1.45, act: 'bbq', face: faceToward(BBQ.x - 0.35, BBQ.z + 1.45, BBQ.x, BBQ.z), level: 0 },
  { x: BBQ.x + 1.45, z: BBQ.z - 0.9, act: 'bbq', face: faceToward(BBQ.x + 1.45, BBQ.z - 0.9, BBQ.x, BBQ.z), level: 0 },

  /* ---- the planting band: LOOK AT THE FLOWERS (poin 5) ------------------ */
  // The band runs x -6..6.2 at z -2.4..-0.8. A body stands SOUTH of it and faces NORTH
  // into the greenery: rotation PI turns the local +z look to -z. The old spots stood
  // south but faced `Math.PI` from the wrong side, so they looked away from the beds.
  { x: PLANTING.x1 + 1.6, z: PLANTING.z2 + 0.75, act: 'garden', face: faceToward(PLANTING.x1 + 1.6, PLANTING.z2 + 0.75, PLANTING.x1 + 1.6, (PLANTING.z1 + PLANTING.z2) / 2), level: 0 },
  { x: (PLANTING.x1 + PLANTING.x2) / 2, z: PLANTING.z2 + 0.75, act: 'garden', face: faceToward((PLANTING.x1 + PLANTING.x2) / 2, PLANTING.z2 + 0.75, (PLANTING.x1 + PLANTING.x2) / 2, (PLANTING.z1 + PLANTING.z2) / 2), level: 0 },
  { x: PLANTING.x2 - 1.6, z: PLANTING.z2 + 0.75, act: 'garden', face: faceToward(PLANTING.x2 - 1.6, PLANTING.z2 + 0.75, PLANTING.x2 - 1.6, (PLANTING.z1 + PLANTING.z2) / 2), level: 0 },

  /* ---- pantry: the three stools ---------------------------------------- */
  ...PANTRY_STOOLS.map((z) => ({
    x: PANTRY.x + PANTRY_STOOL_GAP,
    z,
    act: 'coffee' as const,
    seated: true,
    // Look EAST into the counter (x 25.6) from the stool's own position.
    face: faceToward(PANTRY.x + PANTRY_STOOL_GAP, z, PANTRY.x, z),
    level: 0 as const,
  })),

  /* ---- the dining sets: four chairs each (poin 1 & 2) ------------------- */
  // Each chair gets its own facing, derived from its offset to its table — never a
  // constant. `eat` is the pose: seated, holding a burger or a pizza.
  ...DINING_SETS.flatMap((s) =>
    diningChairs(s).map((c) => ({
      x: c.x,
      z: c.z,
      act: 'eat' as const,
      seated: true,
      face: faceToward(c.x, c.z, s.x, s.z),
      level: 0 as const,
    })),
  ),

  /* ---- the leisure room: the sofa, facing the TV ------------------------- */
  { x: LOUNGE.x, z: LOUNGE.z, act: 'sofa', seated: true, face: faceToward(LOUNGE.x, LOUNGE.z, LOUNGE_TV.x, LOUNGE_TV.z), level: 0 },

  /* ---- open standing room in the courtyard and the lobby ---------------- */
  { x: 0, z: 12.5, act: 'idle', face: Math.PI, level: 0 },
  { x: 10, z: 12.6, act: 'idle', face: -Math.PI / 2, level: 0 },
  { x: -10, z: 12.6, act: 'idle', face: Math.PI / 2, level: 0 },
  { x: 0, z: -8.2, act: 'idle', face: Math.PI, level: 0 },
  { x: -4, z: 18.5, act: 'idle', face: 0, level: 0 },
  { x: 4, z: 18.5, act: 'idle', face: 0, level: 0 },

  /* ---- the executive floor: the corridor and every meeting room ---------- */
  // The meeting chairs are real furniture on a floor that used to have no idle
  // spots at all, so an agent with nothing to do never went upstairs. The seats
  // are only used when no meeting is live (a live meeting claims them first).
  { x: roomCentre('corridor1').x - 6, z: roomCentre('corridor1').z, act: 'idle', face: 0, level: 1 },
  { x: roomCentre('corridor1').x + 6, z: roomCentre('corridor1').z, act: 'idle', face: 0, level: 1 },
  ...MEETING_ROOM_IDS.flatMap((id) =>
    MEETING_ROOMS[id].seats.slice(0, 2).map((s) => ({
      x: s.x,
      z: s.z,
      act: 'meeting' as const,
      seated: true,
      // LOOK AT THE TABLE, computed from this seat's own position.
      face: faceToward(s.x, s.z, MEETING_TABLES[id].x, MEETING_TABLES[id].z),
      level: 1 as const,
    })),
  ),
  // The CEO suite: the chair at the desk and the sofa facing the window. Both were
  // furniture an idle body could see but never use — the coverage assert in the
  // self-test compares every enjoyable seat against this list.
  { x: roomCentre('ceo').x, z: roomCentre('ceo').z - 0.4, act: 'idle', seated: true, face: 0, level: 1 },
  { x: roomCentre('ceo').x, z: roomCentre('ceo').z + 2.6, act: 'idle', seated: true, face: Math.PI, level: 1 },
]

/*
 * The old single-floor idle list lived here. It was replaced by the list above,
 * which covers the same furniture plus the gym, the BBQ, the planting band and the
 * executive floor — so an idle body now uses the whole building.
 */

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
