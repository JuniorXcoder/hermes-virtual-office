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
   * There is deliberately NO lower cross-bar. One was there as a decorative rail, and it
   * cannot fit: measured across the two hanging poses, heads occupy 1.46..2.22, hips
   * 0.95..1.41, and the swinging feet reach 0.03 — the bodies fill the whole span between
   * the mat and the bar, so any rail at any height intersects one of them.
   */
  rig: { x: 0, z: -7.6, span: 3.0, barY: 2.39 },
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

/* ------------------------------------------------- three division rooms -- */

/**
 * THE THREE DIVISION ROOMS ARE DELIBERATELY DIFFERENT.
 *
 * They were identical: three desks in a single column against the west wall, the same
 * furniture stamped three times. The user asked for the layout to be "distinct for each
 * division", and for the rooms not to look empty.
 *
 * Each division now has its own arrangement, chosen to match how that kind of work is
 * actually done, and its own extra furniture. All three rooms are ~13.7 x 13.9 m.
 *
 *   DEV / INFRASTRUCTURE   "the lab"      an inward-facing CLUSTER of four desks (a pod),
 *                                         with a server rack, a whiteboard and a bench.
 *   MARKETING / SEO        "the war room" one LONG SHARED BENCH down the middle, a wall of
 *                                         screens, and a soft discussion nook.
 *   CONTENT CREATOR        "the studio"   two PAIRED PODS facing each other, plus a shoot
 *                                         corner (backdrop, tripod, lighting).
 */

/** A desk built from an explicit position and facing. */
function mkDesk(
  index: number,
  division: AgentDivision,
  seat: 'manager' | 'staff',
  column: number,
  x: number,
  z: number,
  facing: number,
  side: 'near' | 'far' = 'near',
): Desk {
  return { index, x, z, facing, column, side, division, seat }
}

/**
 * DEV / INFRASTRUCTURE — "the lab".
 *
 * A four-desk CLUSTER: two desks face east, two face west, so four programmers sit in a pod
 * looking at each other across a gap. That is how a dev team actually sits, and it reads
 * completely differently from a row. The manager takes the first west-facing desk.
 *
 * Facing is +pi/2 for east, -pi/2 for west; the chair sits at +facing, so a west-facing
 * desk has its chair to its west and its monitor to its east.
 */
function devDesks(): Desk[] {
  const r = room('dev')
  const cx = (r.x1 + r.x2) / 2
  const cz = (r.z1 + r.z2) / 2
  // THREE desks in a wide TRIANGLE pointing at the room's centre, all facing INWARD: the
  // manager sits at the back (west), the two staff ahead of them angled toward each other.
  // A pod, not a row — and unlike the old single column this leaves the middle of the room
  // open, which is where the shared bench and the whiteboard go.
  //
  // CHAIR CLEARANCE: each chair sits 1.0 m along its desk's own facing, so what matters is
  // the distance between the CHAIRS. The manager chair and each staff chair are ~3.4 m
  // apart here; measured, the closest pair in this room is 3.4 m. (The earlier pod put two
  // inward-facing desks 1.9 m apart, which left the two chairs 0.2 m apart — two bodies in
  // one seat.)
  return [
    mkDesk(0, 'tech', 'manager', 0, cx - 3.4, cz, Math.PI / 2),
    mkDesk(1, 'tech', 'staff', 1, cx + 2.0, cz - 2.6, -Math.PI / 2),
    mkDesk(2, 'tech', 'staff', 2, cx + 2.0, cz + 2.6, -Math.PI / 2),
  ]
}

/**
 * MARKETING / SEO — "the war room".
 *
 * ONE long bench down the middle, all three working along the SAME side, so it reads as a
 * single campaign desk. The manager sits at the north end.
 */
function mktDesks(): Desk[] {
  const r = room('mkt')
  const cx = (r.x1 + r.x2) / 2
  const cz = (r.z1 + r.z2) / 2
  return [
    mkDesk(3, 'growth', 'manager', 0, cx, cz - 3.4, Math.PI / 2),
    mkDesk(4, 'growth', 'staff', 1, cx, cz, Math.PI / 2),
    mkDesk(5, 'growth', 'staff', 2, cx, cz + 3.4, Math.PI / 2),
  ]
}

/**
 * CONTENT CREATOR — "the studio".
 *
 * TWO PAIRED PODS. Each pod is two desks facing each other (a shooter and an editor), and
 * the pods sit one behind the other. Content work is collaborative and edit-heavy, so pairs
 * rather than a row.
 */
function contentDesks(): Desk[] {
  const r = room('content')
  const cx = (r.x1 + r.x2) / 2
  // THREE desks in a SHALLOW ARC, all facing SOUTH at the shooting set (the backdrop now
  // stands FLAT on the south wall), so the room reads as a studio looking at its own set.
  //
  // The arc sits at z ~14, which puts it between the door (east wall, z 13.8) and the set,
  // and leaves the whole north half of the room for the shelves and the edit bench. Chairs
  // are ~4.0 m apart.
  const arcZ = r.z1 + 7.6
  return [
    mkDesk(6, 'content', 'manager', 0, cx - 4.0, arcZ + 1.4, Math.PI),
    mkDesk(7, 'content', 'staff', 1, cx, arcZ + 2.2, Math.PI),
    mkDesk(8, 'content', 'staff', 2, cx + 4.0, arcZ + 1.4, Math.PI),
  ]
}

export const DESKS: Desk[] = [...devDesks(), ...mktDesks(), ...contentDesks()]

/**
 * THE EXTRA FURNITURE THAT MAKES EACH ROOM ITS OWN.
 *
 * Declared here so the mesh, the footprints and the self-test all read one definition.
 * Each is an axis-aligned box in x/z with a height, exactly like a footprint.
 */
export type RoomProp = {
  id: string
  /** Which division room it stands in. */
  room: 'dev' | 'mkt' | 'content'
  kind:
    | 'rack'
    | 'whiteboard'
    | 'bench'
    | 'shelf'
    | 'screenwall'
    | 'nook'
    | 'backdrop'
    | 'tripod'
    | 'lightstand'
    | 'plant'
  x: number
  z: number
  /** Half-extents in x and z, and the height. Same convention as Footprint. */
  hw: number
  hd: number
  h: number
  /**
   * Which way the piece POINTS, for the props that aim at something (the studio camera and
   * light). A look direction in the body convention: 0 rad points +z.
   */
  facing?: number
}

/**
 * Where the room props stand.
 *
 * Positions are chosen against each room's desk layout so nothing overlaps AND nothing
 * blocks the door. All three rooms have their door on the EAST wall (x = -14) at the room's
 * centre z, so the east edge is left clear; the props line the WEST wall and the far ends.
 */
export const ROOM_PROPS: RoomProp[] = (() => {
  const out: RoomProp[] = []
  const dev = room('dev')
  const mkt = room('mkt')
  const content = room('content')

  // ---- DEV: a server rack, a whiteboard, and a parts bench, all along the WEST wall ----
  // The pod sits in the middle (cx +- 0.95). The west wall (x -27.85) is free.
  // Against the wall means against the INNER FACE, which is WALL_T/2 in from the room's
  // nominal edge — not `x1 + 0.6`. Measured before the fix: the whiteboard floated 0.48 m
  // off the west wall, and the bench was 0.05 m INSIDE it.
  const devInnerW = dev.x1 + 0.15
  out.push({ id: 'dev-rack', room: 'dev', kind: 'rack', x: devInnerW + 0.45, z: dev.z1 + 2.2, hw: 0.45, hd: 0.6, h: 2.1 })
  out.push({ id: 'dev-whiteboard', room: 'dev', kind: 'whiteboard', x: devInnerW + 0.12, z: (dev.z1 + dev.z2) / 2, hw: 0.12, hd: 1.6, h: 2.2 })
  out.push({ id: 'dev-bench', room: 'dev', kind: 'bench', x: devInnerW + 0.5, z: dev.z2 - 2.4, hw: 0.5, hd: 1.1, h: 0.92 })
  // a shelf unit on the far (north) wall
  out.push({ id: 'dev-shelf', room: 'dev', kind: 'shelf', x: (dev.x1 + dev.x2) / 2 + 3.6, z: dev.z1 + 0.4, hw: 1.2, hd: 0.22, h: 1.9 })
  // a plant in the south-west corner, so the room is not all metal
  out.push({ id: 'dev-plant', room: 'dev', kind: 'plant', x: dev.x2 - 1.2, z: dev.z2 - 1.2, hw: 0.32, hd: 0.32, h: 1.1 })

  // ---- MKT: a wall of screens at the NORTH end + a soft nook in the SOUTH-WEST ----
  // The bench runs down the middle facing east. Keep the east approach clear.
  out.push({ id: 'mkt-screenwall', room: 'mkt', kind: 'screenwall', x: (mkt.x1 + mkt.x2) / 2, z: mkt.z1 + 0.45, hw: 2.4, hd: 0.22, h: 2.0 })
  out.push({ id: 'mkt-shelf', room: 'mkt', kind: 'shelf', x: mkt.x1 + 0.55, z: mkt.z2 - 3.0, hw: 0.3, hd: 1.6, h: 1.7 })
  // the nook: a low table with two soft chairs, in the south-west, clear of the bench
  out.push({ id: 'mkt-nook', room: 'mkt', kind: 'nook', x: mkt.x1 + 2.2, z: mkt.z2 - 2.0, hw: 0.55, hd: 0.55, h: 0.42 })
  out.push({ id: 'mkt-plant', room: 'mkt', kind: 'plant', x: mkt.x2 - 1.2, z: mkt.z1 + 1.2, hw: 0.32, hd: 0.32, h: 1.1 })

  // ---- CONTENT: a real SHOOTING STUDIO ------------------------------------------
  // The set is at the SOUTH end and the desks look at it. Every prop is placed against a
  // WALL FACE, not near one: the wall is WALL_T (0.30) thick, so a prop "at the edge" in
  // room coordinates can easily be half-inside the plaster or floating in the middle of the
  // floor. Measured before and after:
  //
  //   backdrop   was z 19.63..19.87, i.e. 0.83 m off the south wall — a photo backdrop
  //              standing in mid-air. Now flat against it.
  //   plant      was 0.73 m off the east wall. Now in the corner.
  //   shelves    only ONE existed; a studio needs storage on both sides.
  const innerS = content.z2 - 0.15 // inner face of the south wall
  const innerN = content.z1 + 0.15
  const innerW = content.x1 + 0.15
  const innerE = content.x2 - 0.15
  const cx = (content.x1 + content.x2) / 2
  // the backdrop: hd is its HALF depth, so its face lands exactly on the wall
  out.push({ id: 'content-backdrop', room: 'content', kind: 'backdrop', x: cx, z: innerS - 0.12, hw: 2.4, hd: 0.12, h: 2.4 })
  // THE CAMERA, CENTRED ON THE BACKDROP AND POINTING AT IT.
  //
  // It was at `cx + 2.0` — 2 m off the backdrop's centre line — and it faced the same way
  // the mesh is modelled, which is -z: NORTH, away from the backdrop, because the backdrop
  // is SOUTH of the camera. Reported as "kamera masih membelakangi background" and "kamera
  // tidak di tengah background".
  //
  // `facing` is the direction the CAMERA POINTS, in the body convention (a look direction,
  // +z at 0 rad). The backdrop is south, so the camera faces +z, i.e. facing = 0.
  out.push({
    id: 'content-tripod',
    room: 'content',
    kind: 'tripod',
    x: cx,
    z: innerS - 2.4,
    hw: 0.25,
    hd: 0.25,
    h: 1.55,
    facing: 0,
  })
  // THE LIGHT, at the side of the set, TURNED TO THROW AT THE BACKDROP.
  //
  // Reported: "lightning tidak menghadap background". Same cause as the camera — it faced
  // north, away from the panel it is meant to light. A key light sits off to one side and
  // is angled across the set, so this one is placed west of centre and turned south-east.
  out.push({
    id: 'content-light',
    room: 'content',
    kind: 'lightstand',
    x: cx - 2.6,
    z: innerS - 2.0,
    hw: 0.25,
    hd: 0.25,
    h: 1.9,
    // AIMED AT THE BACKDROP'S CENTRE, computed from the two positions rather than typed in.
    //
    // Reported: "lightning masih salah menghadapnya masih keluar". It was -0.7 rad, which
    // threw the beam SOUTH-WEST, off the set. Simply adding 45 degrees was not enough either:
    // the light stands 2.60 m WEST of the backdrop centre, so an extra 45 degrees left the
    // beam landing 2.44 m off centre against a panel only 2.40 m half-wide — it missed by
    // 4 cm. The beam has to come back east as well as south, which is 54.1 degrees, not 5.
    //
    // Computing it means this cannot drift: move the light or the backdrop and the aim follows.
    facing: Math.atan2(cx - (cx - 2.6), innerS - 0.12 - (innerS - 2.0)),
  })
  // storage on BOTH side walls, clear of the door (east wall, z 13.8)
  out.push({ id: 'content-shelf-w', room: 'content', kind: 'shelf', x: innerW + 0.3, z: innerN + 1.7, hw: 0.3, hd: 1.5, h: 1.9 })
  out.push({ id: 'content-shelf-e', room: 'content', kind: 'shelf', x: innerE - 0.3, z: innerN + 1.7, hw: 0.3, hd: 1.5, h: 1.9 })
  // an edit bench along the north wall, between the shelves
  out.push({ id: 'content-bench', room: 'content', kind: 'bench', x: cx, z: innerN + 0.7, hw: 1.7, hd: 0.5, h: 0.92 })
  // plants in the two free corners
  out.push({ id: 'content-plant-w', room: 'content', kind: 'plant', x: innerW + 0.55, z: innerS - 0.8, hw: 0.3, hd: 0.3, h: 1.1 })
  out.push({ id: 'content-plant-e', room: 'content', kind: 'plant', x: innerE - 0.55, z: innerS - 0.8, hw: 0.3, hd: 0.3, h: 1.1 })

  return out
})()

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
  stool: { hip: 0.655, thigh: -95, knee: 110, thickness: 0.07, footY: 0.24 },
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
 * The pantry's fixed appliances, placed once and read by the mesh, the footprints and
 * the self-test.
 *
 * The counter used to be 6.4 m of slab centred on `PANTRY.z`, i.e. z 4.8..11.2 — and the
 * FRIDGE stood at z 4.6..5.4, 1.9 m tall against a 0.9 m counter. The two overlapped by
 * 0.6 m and the fridge was buried in the counter run. Reported as "the fridge seems to be
 * clashing with the counter".
 *
 * These four boxes are disjoint BY CONSTRUCTION and `layoutConflicts()` proves it:
 *
 *   fridge          z 4.60 .. 5.40     (north end, 1.9 m tall, stands alone)
 *   gap             z 5.40 .. 6.00     (0.6 m — a body can walk past, and it reads as a gap)
 *   counter         z 6.00 .. 11.20    (sink and coffee live ON this)
 *   water cooler    z 11.60 .. 12.04   (south of the counter's end, clear of the wall)
 */
export const FRIDGE = { x: PANTRY.x, z: 5.0, w: 0.85, d: 0.8, h: 1.9 }
/** The counter run. `z1..z2` is its length along the wall; it is `d` deep in x. */
export const PANTRY_COUNTER = { z1: 6.0, z2: 11.2, d: 0.9, h: 0.9 }
/** Centre of the coffee machine, ON the counter top. */
export const PANTRY_COFFEE_Z = 10.2
/** Centre of the sink, ON the counter top. */
export const PANTRY_SINK_Z = 7.0
/** The water dispenser, south of the counter. */
export const WATER_COOLER = { x: PANTRY.x - 0.1, z: 11.8, w: 0.42, d: 0.42, h: 1.6 }
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

/* ---------------------------------------------------- the lounge rec gear -- */

/**
 * The rec area in the leisure room, so the lounge is a place to BE, not just a sofa
 * facing a television.
 *
 * Placed once, read by the mesh, the footprints AND the idle spots — the same rule as
 * everything else here, and for the same reason: when the model and the spots disagree an
 * avatar drives a rig that is not there.
 *
 * The room is x 14.15..27.85, z -20.85..2. The sofa group takes the north end (z -20.8..
 * -17.2), so the rec stations live in the SOUTH half, clear of each other and of the door
 * on the west wall at z -5.4..-2.6:
 *
 *   dartboard   x 27.7, z -13.0    board on the EAST wall (inner face x 27.85), the
 *                                  thrower stands ~2.4 m west of it
 *   racing bay  x 18..24, z -14    FOUR simulators in a row, each facing NORTH — they
 *                                  stand where the ping-pong table used to be
 */
export const DARTBOARD = {
  /** Board centre, flat on the east wall (inner face x = 27.85). */
  x: 27.7,
  z: -13.0,
  /** Bullseye height — regulation is 1.73 m. */
  y: 1.73,
  r: 0.225,
}
/** Where the thrower stands, and how far back from the board. */
export const DART_THROW = { x: 25.3, z: -13.0 }

/**
 * The FOUR racing simulators — a bucket seat, a wheel on a column, a pedal box and a screen
 * for each.
 *
 * Every rig faces NORTH (into the room, away from the south wall) so the bay reads as an
 * arcade pointed into the space rather than at a wall. `facing` is BOTH the mesh's rotation
 * AND the rig's look direction: the seat mesh is built with its wheel and screen at local
 * -z, so at `facing: 0` the driver looks north with the wheel ahead of them — an avatar
 * seated here uses `facing + PI` for its body, because a body's `face` is the direction its
 * CHEST points (see IDLE_SPOTS).
 *
 * The x pitch of 2.0 m leaves 0.6 m between neighbouring footprints (each 1.4 m wide), which
 * is what keeps four rigs in a 6 m bay from overlapping.
 */
export const RACING_RIGS = [
  { x: 18.0, z: -14.0, facing: 0 },
  { x: 20.0, z: -14.0, facing: 0 },
  { x: 22.0, z: -14.0, facing: 0 },
  { x: 24.0, z: -14.0, facing: 0 },
] as const
/** Seat surface height — from SEATS.chair, so the seated pose is unchanged. */
export const RACING_SEAT_H = 0.46

/* --------------------------------------------------------------- bowling -- */

/**
 * The bowling lane: one shortened arcade lane in the lounge's south half, aimed EAST.
 *
 * Measured, not guessed. The lounge is x 14.15..27.85, z -20.85..2, but its free run is only
 * z -11.0 .. 1.5: the sofa group takes the north end and the racing bay occupies z
 * -15.8..-13.2. That gives 11.2 m from foul line to pin deck rather than the regulation
 * 18.3 m, which is what an arcade lane is anyway.
 *
 * It runs ALONG X — the bowler stands at the WEST end and throws EAST. The room is 13.7 m
 * wide and a lane needs 11.2 m plus a 1.4 m approach, so the width is the tight axis and the
 * lane fits it with 0.85 m to spare at the east end.
 *
 * ONE definition, read by the mesh, the footprints and the idle spot — the same rule as
 * everything else here, for the same reason.
 */
export const BOWLING = {
  /**
   * The lane's centre LINE, across its width — the z coordinate of the whole lane.
   *
   * Pushed flush against the pantry wall. That wall (`part-leisure-pantry`) sits on the room
   * line z = 2 with WALL_T of thickness, so the leisure room's inner face is at z = 1.85. The
   * lane plus its two gutters is 1.54 m across, so its centre lands half that inside the face:
   * 1.85 − 0.77 = 1.08. Nothing here may drift without a matching change to the wall, which is
   * why the self-test measures the gap off both.
   */
  z: 1.08,
  /** The playing surface, across. A real lane is 1.05 m; the gutters sit outside it. */
  w: 1.06,
  /** Gutter width, each side. */
  gutter: 0.24,
  /** The foul line (west, where the bowler stands) and the far end of the surface (east). */
  xFoul: 15.9,
  xEnd: 27.1,
  /** The lane surface rides this far above the floor slab it is laid on. */
  y: 0.05,
  /** The head pin's centre, and the spacing that builds the other nine behind it. */
  headPinX: 26.1,
  pinSpacing: 0.305,
} as const
/** A pin: 0.121 m across the belly and 0.38 m tall, regulation. */
export const PIN_R = 0.06
export const PIN_H = 0.38
/** 0.218 m across — the regulation ball, and what the fingers wrap. */
export const BALL_R = 0.109
/** Where the bowler stands: on the approach, this far BEHIND the foul line (−x is behind). */
export const BOWLING_STAND_X = BOWLING.xFoul - 0.75
/**
 * The nine pins behind the head pin, as (across, back) offsets in PIN SPACING units.
 *
 * `across` is a z offset, `back` runs east away from the bowler. Rows are spaced by
 * `sin(60°)` of the pin spacing, which is what makes the triangle equilateral rather than a
 * grid — a square grid is the classic tell that a lane was laid out by eye.
 */
export const PIN_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.5, 0.866], [0.5, 0.866],
  [-1, 1.732], [0, 1.732], [1, 1.732],
  [-1.5, 2.598], [-0.5, 2.598], [0.5, 2.598], [1.5, 2.598],
] as const

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

/* ------------------------------------------- under the second floor (terrace) -- */

/**
 * THE GROUND FLOOR DIRECTLY BENEATH THE SECOND FLOOR.
 *
 * Level 1 exists only over the NORTH BAR (`LEVEL_BOUNDS[1].z2 = -9`), so the ground floor
 * under that slab is the strip z -21..-9, x -28..28 — the covered TERRACE. It is open to the
 * courtyard on its south side (columns, not a wall) and roofed by the executive slab.
 *
 * WHICH PART OF THAT STRIP IS ACTUALLY FREE, at ground level, was the first thing to check —
 * and the answer is not the whole strip:
 *
 *     x -27.85 .. -14.15   the DEV room          (already furnished)
 *     x -14.15 ..  14.15   the covered terrace   <-- the free, roofed floor
 *     x  14.15 ..  27.85   the LOUNGE            (already furnished)
 *
 * So the moonlit strip the user means — "directly beneath the second floor, not elsewhere" —
 * is the MIDDLE: x -14..14, z -20.4..-9.6. The stair shaft (x -10..-8.6) cuts through it, so
 * the zone is split either side of the stairs.
 *
 * Because it is a thoroughfare as well as a place to sit, everything is pushed to the EDGES:
 *
 *   NORTH EDGE  (z -19.6)  a long work bar with stools, and a coffee point
 *   SOUTH EDGE  (z -10.4)  two lounge pairs facing the pool, and a low table
 *   WEST SIDE   (x -13)    the communal table, clear of the stairs at x -10
 *   EAST SIDE   (x 12)     lockers
 *
 * Every box is axis-aligned in x/z with a height, exactly like a footprint.
 */
export type TerraceProp = {
  id: string
  kind: 'sofa' | 'lowtable' | 'longtable' | 'tbench' | 'workbar' | 'stool' | 'locker' | 'coffee' | 'plant' | 'shelf'
  x: number
  z: number
  /** Half-extents in x and z, and the height. */
  hw: number
  hd: number
  h: number
  /** Which way the piece faces (used by the seats, ignored by the rest). */
  facing?: number
}

/** Seat surface of the terrace stools and benches. */
export const TERRACE_SEAT_H = 0.5

/** The strip of covered floor under the slab that is not already a room. */
export const TERRACE_BOUNDS = { x1: -14.0, x2: 14.0, z1: -20.4, z2: -9.6 }

export const TERRACE_PROPS: TerraceProp[] = (() => {
  const out: TerraceProp[] = []
  const zN = -19.3 // along the north wall of the strip
  const zS = -10.7 // along the courtyard edge

  // ---- NORTH EDGE: a work bar with stools, and a coffee point ----------------------
  // x from -13.6 to +2.2 sits west of the stairs' east side, so it does not cross the shaft
  // (the shaft is x -10..-8.6, but the bar is against the north wall at z -19.3, and the
  // shaft's own z span is -10.4..-3.2 — it does not reach the north wall at all).
  out.push({ id: 'terr-workbar', kind: 'workbar', x: -4.0, z: zN, hw: 5.6, hd: 0.42, h: 0.95 })
  for (let i = 0; i < 5; i++) {
    const bx = -4.0 - 5.6 + 1.0 + i * 2.3
    out.push({
      id: `terr-stool-${i}`,
      kind: 'stool',
      x: bx,
      z: zN + 0.95,
      hw: 0.22,
      hd: 0.22,
      h: TERRACE_SEAT_H + 0.14,
      facing: Math.PI,
    })
  }
  out.push({ id: 'terr-coffee', kind: 'coffee', x: 3.6, z: zN + 0.4, hw: 0.3, hd: 0.3, h: 1.6 })
  out.push({ id: 'terr-shelf', kind: 'shelf', x: -13.2, z: zN + 0.6, hw: 0.3, hd: 1.2, h: 1.7 })

  // ---- SOUTH EDGE: two lounge pairs facing the pool, and a low table ---------------
  // Facing NORTH means facing the courtyard (-z is toward the north wall, so to look at the
  // pool to the south the sofa faces +z: facing = 0 puts its back at +z, so we use PI to
  // turn it around and look south over the water).
  // FACING = PI, so the BACKREST is on the NORTH side (against the wall) and the sitter
  // looks SOUTH over the pool. The sofa mesh puts its backrest at local +z, so a mesh built
  // at rotation 0 has its back to the south — with `facing: 0` the backrest landed BETWEEN
  // the sitter and the water, i.e. the sofa faced its own backrest (measured backrest dot
  // +1.00). This is the same convention the lounge sofa uses: back at +z, so it faces -z.
  out.push({ id: 'terr-sofa-a', kind: 'sofa', x: -11.0, z: zS, hw: 1.3, hd: 0.5, h: 0.8, facing: Math.PI })
  out.push({ id: 'terr-sofa-b', kind: 'sofa', x: -4.0, z: zS, hw: 1.3, hd: 0.5, h: 0.8, facing: Math.PI })
  out.push({ id: 'terr-lowtable', kind: 'lowtable', x: -7.5, z: zS - 0.2, hw: 0.9, hd: 0.45, h: 0.4 })

  // ---- WEST SIDE: the communal table, clear of the stairs (x -10..-8.6) ------------
  // It runs along z, tucked against the west end of the strip, west of the shaft.



  // ---- EAST SIDE: lockers, and a plant to soften it --------------------------------
  out.push({ id: 'terr-locker', kind: 'locker', x: 12.0, z: -15.0, hw: 0.42, hd: 2.2, h: 1.8 })
  out.push({ id: 'terr-plant-e', kind: 'plant', x: 12.6, z: zN + 1.0, hw: 0.3, hd: 0.3, h: 1.1 })
  out.push({ id: 'terr-plant-w', kind: 'plant', x: -13.4, z: zS - 0.4, hw: 0.3, hd: 0.3, h: 1.1 })

  return out
})()

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

/** Facing for a chair at (cx,cz) so it LOOKS at the table centre. */
export function diningChairFacing(set: DiningSet, cx: number, cz: number): number {
  // The chair mesh carries its back rest at local +z, so it looks along local -z, i.e.
  // the look vector is (-sin f, -cos f). We want that to point at the table, so
  // f = atan2(-(tx-cx), -(tz-cz)).
  return Math.atan2(-(set.x - cx), -(set.z - cz))
}

/* ------------------------------------------------------------- access -- */

/**
 * WHICH WAY A BODY LOOKS. The one place this convention is written down.
 *
 * `face` is a BODY's look direction, and a body looks along its own local +z. Two
 * independent measurements of the rig say so:
 *
 *   1. The `sit` pose bends the hips so the legs extend FORWARD. Sampling the rig with the
 *      group unrotated puts both feet at z = +0.43 relative to the hips — a seated body's
 *      feet point the way it faces, so front is +z.
 *   2. `scene.ts` sets `a.face = Math.atan2(tmp.x, tmp.z)` from the direction of travel and
 *      writes it straight to `group.rotation.y`. A walking body faces where it walks, so
 *      rotation.y = atan2(dx, dz) means look = (sin f, cos f).
 *
 * Therefore, to LOOK AT a point:
 *
 *     face = atan2(targetX - x, targetZ - z)
 *
 * A FURNITURE MESH USES THE OPPOSITE SIGN, and that mismatch is the whole bug this helper
 * exists to kill. A chair mesh carries its back rest at local +z (see build.ts), so the mesh
 * looks along local -z: mesh_look = (-sin r, -cos r). Setting a body's `face` to a mesh's
 * rotation therefore spins the body 180 degrees — it sits down with its back to the table and
 * its face to the chair's own back rest. Measured on the dining chairs: dot = -1.00, all 24.
 */
export function faceToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z)
}

/**
 * Fold any angle into (-PI, PI]. Same orientation, smallest representation.
 *
 * Needed because an angle that is only ever INCREMENTED drifts without bound. `g.rotation.y`
 * was smoothed by a wrapped delta but never wrapped itself, so a body that crossed the +-PI
 * boundary repeatedly accumulated a fraction of a turn per crossing — 447 turns in the live
 * database, for a body that renders as pointing at 0.79 rad. sin/cos are periodic so the mesh
 * looked right and nobody noticed; the persisted number was nonsense, and any code that
 * compared two facings numerically would read 447 turns where there were none.
 */
export function wrapAngle(a: number): number {
  const TAU = Math.PI * 2
  let r = a - Math.floor((a + Math.PI) / TAU) * TAU
  // -PI is the same orientation as +PI; keep exactly one of them.
  if (r <= -Math.PI) r += TAU
  return r
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

/**
 * Isi RUANG CEO (level 1), dari gambar bertanda yang dikirim pemilik aplikasi.
 *
 * Satu tabel dipakai tiga tempat — mesh di `build.ts`, FOOTPRINTS (tabrakan) dan IDLE_SPOTS
 * (anchor duduk) — karena dulu ketiganya menulis `roomCentre('ceo') ± angka` sendiri-sendiri,
 * dan begitu satu dipindah, agent duduk di udara di tempat sofa lama.
 *
 * Ruangnya x -27.85..-19.30, z -20.85..-11.65 (permukaan dalam; -11.5 adalah garis tengah
 * dinding selatan). PINTU di dinding selatan x -22.2..-19.8, jadi pojok tenggara dan jalur
 * pintu→tengah sengaja kosong. `facing` memakai konvensi badan: 0 = selatan (+z),
 * π/2 = timur, π = utara, -π/2 = barat; mesh kursi diputar `facing + π` (sandaran di lokal +z).
 */
export const CEO_SUITE = {
  /** Meja eksekutif — acuan "belakang meja" untuk kursi bos. w di x, d di z. */
  desk: { x: -23.6, z: -17.7, w: 2.4, d: 1.1, h: 0.74 },
  /** Kursi bos: membelakangi dinding utara, menghadap pintu di selatan. */
  bossChair: { x: -23.6, z: -19.1, facing: 0, w: 0.72, d: 0.72 },
  /** Dua kursi tamu di seberang meja, menghadap kursi bos. */
  guestChairs: [
    { x: -24.45, z: -16.35, facing: Math.PI },
    { x: -22.75, z: -16.35, facing: Math.PI },
  ],
  guestChair: { w: 0.62, d: 0.6 },
  /** Empat tanaman sudut. Sudut tenggara kosong karena di situ pintu. */
  plants: [
    { x: -27.3, z: -20.45 },
    { x: -19.8, z: -20.45 },
    { x: -27.3, z: -12.3 },
    { x: -19.75, z: -13.4 },
  ],
  /** Jari-jari daun terbesar. 0.34 supaya tanaman di z -20.45 tidak menembus dinding utara. */
  plantR: 0.34,
  coffeeTable: { x: -25.9, z: -14.5, w: 1.2, d: 0.7, h: 0.4 },
  /**
   * Sofa 3-seat di dinding barat (menghadap timur): `len` sepanjang sofa, `depth` ke depan.
   *
   * z -14.5 menaruh ujung SELATAN sofa di -12.95, yaitu 0.31 m dari tepi utara tanaman sudut
   * barat-daya (-12.64) — pemilik meminta sofa panjang hampir menyentuh tanaman itu, jadi
   * jaraknya sengaja dibuat kecil. Rentangnya kini z -16.05..-12.95.
   *
   * Meja sofa digeser bersamanya ke z -14.5: kalau dibiarkan di tempat lama, ia berakhir di
   * samping ujung utara sofa, bukan di depannya lagi.
   */
  sofa3: { x: -27.35, z: -14.5, facing: Math.PI / 2, len: 3.1, depth: 0.9 },
  /** Sofa 1-seat di dinding selatan (menghadap utara), membentuk L dengan sofa 3-seat. */
  sofa1: { x: -25.6, z: -12.1, facing: Math.PI, len: 1.1, depth: 0.9 },
  /** TV di partisi timur (ke Rinjani), menghadap barat. `t` tebal di x, `len` di z. */
  tv: { x: -19.36, z: -15.8, t: 0.12, len: 1.8, y0: 1.0, y1: 2.1 },
  /**
   * Papan tulis di dinding utara, menghadap selatan. Gambar meminta pusat z -20.78, tapi
   * dengan tebal 0.16 sisi belakangnya jadi -20.86 — 1 cm di dalam dinding. Digeser ke
   * -20.76 supaya punggungnya rata di permukaan dinding (-20.84), bukan tertanam.
   */
  whiteboard: { x: -24.6, z: -20.76, len: 3.4, t: 0.16, y0: 0.6, y1: 2.1 },
} as const

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
  // WALL_T / 2, not WALL_T: this partition runs from the FACE of the wall at x = 14 (which is
  // WALL_T thick and centred on 14, so its east face is 14.15) — the same convention
  // part-dev-mkt uses at the other end of the building. At 14 + WALL_T it stopped 0.15 m short
  // and left a hole straight through into the pantry, right where the bowling lane now butts
  // against this wall.
  wallSeg('part-leisure-pantry', 14 + WALL_T / 2, 2, ROOM_W, 2),

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
        // THE WALL SPANS THE WHOLE GAP BETWEEN THE ROOMS, r.x2 .. next.x1 — it does not sit on
        // r.x2. Rooms are declared 0.3 m apart so a WALL_T partition fits exactly between them;
        // centring on r.x2 put only the WEST half of that partition in the gap and left 0.15 m
        // of open air at every room's east corner, where the south wall stops at r.x2 and the
        // partition stops at r.x2 + 0.15.
        //
        // It also runs THROUGH the south wall, to that wall's far face (r.z2 + WALL_T / 2)
        // rather than stopping on its centre line. Ending at r.z2 sealed the north half of the
        // junction and left a 0.3 m wide notch in the corridor-side half — the hole moved
        // instead of closing.
        out.push(wallSeg(`l1-${r.id}-e`, r.x2, r.z1, next.x1, r.z2 + WALL_T / 2, 1))
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
    // THE DESK FOOTPRINT TURNS WITH THE DESK. A desk top is 1.7 long and 1.0 deep; as an
    // axis-aligned box that is 0.85 x 0.5 only while the desk faces along z. A desk facing
    // east/west (which is most of them) lies the other way — its 1.7 m runs along Z and its
    // 1.0 m along X — so a fixed 0.85 x 0.5 box was half a metre wrong in each direction.
    // That is what made the self-test report "sits at a chair with no desk" for a desk that
    // was in fact 1.0 m away: the chair is 1.0 along the desk's own facing, and the box has
    // to cover it whichever way the desk points.
    // THE DESK BOX MUST COVER THE CHAIR, whichever way the desk points.
    //
    // The box has to include the chair's tucked position, because "sitting at your desk" is
    // legitimately inside both the chair and the desk. The chair sits 1.0 m along the desk's
    // own FACING, so the box needs a half-extent of 0.85 along the facing axis and 0.5
    // across it — not a fixed 0.85 x 0.5, which was only right while every desk faced east.
    //
    // `s = sin(facing)` is the facing direction's x component, `c` its z component, so this
    // picks the axis the desk actually points down.
    const facesAlongX = Math.abs(s) > 0.5
    const hw = facesAlongX ? 0.85 : 0.5
    const hd = facesAlongX ? 0.5 : 0.85
    return [
      fp(`desk-${d.index}`, d.x, d.z, hw, hd, 0.72, 'desk'),
      fp(`chair-${d.index}`, chair.x, chair.z, 0.32, 0.32, 0.5, 'seat'),
    ]
  }),

  /* --------------------------------------------- the division rooms' props -- */
  // Each room's extra furniture. The bench and the nook are 'desk'/'seat' so the mover
  // treats them as usable; the rest are plain solids.
  ...ROOM_PROPS.map((p) => fp(p.id, p.x, p.z, p.hw, p.hd, p.h, p.kind === 'nook' ? 'desk' : undefined)),

  /* --------------------------------- ground floor under the second floor --- */
  // The covered terrace, z -20.4..-9.6. Seats and the low table are 'seat'/'desk' so the
  // mover treats them as usable; the rest are plain solids.
  ...TERRACE_PROPS.map((p) =>
    fp(
      p.id,
      p.x,
      p.z,
      p.hw,
      p.hd,
      p.h,
      p.kind === 'sofa' || p.kind === 'tbench' || p.kind === 'stool'
        ? 'seat'
        : p.kind === 'lowtable' || p.kind === 'longtable' || p.kind === 'workbar'
          ? 'desk'
          : undefined,
    ),
  ),

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
  // The counter is the run PANTRY_COUNTER.z1..z2, NOT a slab centred on PANTRY.z — that
  // is what let the fridge stand inside it.
  fp(
    'pantry-counter',
    PANTRY.x,
    (PANTRY_COUNTER.z1 + PANTRY_COUNTER.z2) / 2,
    PANTRY_COUNTER.d / 2,
    (PANTRY_COUNTER.z2 - PANTRY_COUNTER.z1) / 2,
    PANTRY_COUNTER.h,
  ),
  fp('pantry-fridge', FRIDGE.x, FRIDGE.z, FRIDGE.w / 2, FRIDGE.d / 2, FRIDGE.h),
  ...PANTRY_STOOLS.map((z, i) => fp(`stool-${i}`, PANTRY.x + PANTRY_STOOL_GAP, z, 0.24, 0.24, 0.62, 'seat')),
  // The water cooler stands clear of the counter's south end; the coffee machine sits ON
  // the counter, so it needs no footprint of its own (the counter already blocks there).
  fp('pantry-water-cooler', WATER_COOLER.x, WATER_COOLER.z, WATER_COOLER.w / 2, WATER_COOLER.d / 2, WATER_COOLER.h),

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
  // The rec gear. The racing bay blocks; the dartboard is ON the wall, so its footprint is
  // the small area its surround occupies, not the throw position — a footprint at the
  // thrower's feet would fence off the very spot they stand on.
  ...RACING_RIGS.map((r, i) => fp(`lounge-racing-${i}`, r.x, r.z - 0.5, 0.7, 1.3, 0.9)),
  fp('lounge-dartboard', DARTBOARD.x, DARTBOARD.z, 0.08, DARTBOARD.r * 1.2, DARTBOARD.y + DARTBOARD.r),
  // The bowling lane and its ball return. The lane footprint is the LANE (pins and surface),
  // not the approach — fencing off the approach would wall in the very spot the bowler
  // stands on, which is the mistake the dartboard comment above records.
  fp(
    'lounge-bowling',
    (BOWLING.xFoul + BOWLING.xEnd) / 2,
    BOWLING.z,
    (BOWLING.xEnd - BOWLING.xFoul) / 2,
    BOWLING.w / 2 + BOWLING.gutter,
    BOWLING.y + PIN_H,
  ),
  fp(
    'lounge-bowling-return',
    BOWLING.xFoul - 0.1,
    BOWLING.z - (BOWLING.w / 2 + BOWLING.gutter + 0.36),
    0.95,
    0.17,
    BOWLING.y + 0.95,
  ),

  /* ------------------------------------------------------------ ceo suite -- */
  // Semua dari CEO_SUITE, tabel yang sama yang dibaca mesh-nya — supaya agent tidak
  // berjalan menembus sofa, TV, atau papan tulis yang terlihat.
  fp('ceo-desk', CEO_SUITE.desk.x, CEO_SUITE.desk.z, CEO_SUITE.desk.w / 2, CEO_SUITE.desk.d / 2, 0.75, 'desk', 1),
  fp(
    'ceo-chair',
    CEO_SUITE.bossChair.x,
    CEO_SUITE.bossChair.z,
    CEO_SUITE.bossChair.w / 2,
    CEO_SUITE.bossChair.d / 2,
    0.5,
    'seat',
    1,
  ),
  ...CEO_SUITE.guestChairs.map((g, i) =>
    fp(`ceo-guest-${i}`, g.x, g.z, CEO_SUITE.guestChair.w / 2, CEO_SUITE.guestChair.d / 2, 0.5, 'seat', 1),
  ),
  fp(
    'ceo-coffee-table',
    CEO_SUITE.coffeeTable.x,
    CEO_SUITE.coffeeTable.z,
    CEO_SUITE.coffeeTable.w / 2,
    CEO_SUITE.coffeeTable.d / 2,
    CEO_SUITE.coffeeTable.h,
    'desk',
    1,
  ),
  // sofa 3-seat berdiri memanjang di z (menempel dinding barat), jadi hw = dalam, hd = panjang
  fp('ceo-sofa', CEO_SUITE.sofa3.x, CEO_SUITE.sofa3.z, CEO_SUITE.sofa3.depth / 2, CEO_SUITE.sofa3.len / 2, 0.85, 'seat', 1),
  // sofa 1-seat memanjang di x (menempel dinding selatan)
  fp('ceo-sofa-1', CEO_SUITE.sofa1.x, CEO_SUITE.sofa1.z, CEO_SUITE.sofa1.len / 2, CEO_SUITE.sofa1.depth / 2, 0.85, 'seat', 1),
  fp('ceo-tv', CEO_SUITE.tv.x, CEO_SUITE.tv.z, CEO_SUITE.tv.t / 2, CEO_SUITE.tv.len / 2, CEO_SUITE.tv.y1, 'prop', 1),
  fp(
    'ceo-whiteboard',
    CEO_SUITE.whiteboard.x,
    CEO_SUITE.whiteboard.z,
    CEO_SUITE.whiteboard.len / 2,
    CEO_SUITE.whiteboard.t / 2,
    CEO_SUITE.whiteboard.y1,
    'prop',
    1,
  ),
  ...CEO_SUITE.plants.map((p, i) => fp(`ceo-plant-${i}`, p.x, p.z, 0.3, 0.3, 1.4, 'prop', 1)),
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
/**
 * Activities an idle body may be assigned.
 *
 * `walking` is not a pose you can be left in, and `typing` / `gaming` are only ever
 * triggered by an agent's real work state (a desk, a live session) rather than by standing
 * somewhere. `dart` USED to be excluded too, back when there was no dartboard; the board
 * now exists in the lounge, so darts is an idle spot like any other.
 */
export type IdleActivity = Exclude<Activity, 'walking' | 'typing' | 'gaming'>

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
  // LOOK AT THE WATER. `b.facing` is the MESH rotation, and a bench mesh looks along its own
  // local -z, so copying it into a body's `face` spun the sitters 180 degrees: dot -1.00 on
  // the centre bench, -0.83 on the outer two. A body's facing is a look direction, computed
  // from where the body actually is.
  ...POOL_BENCHES.map((b) => ({
    x: b.x, z: b.z, act: 'pool' as const, seated: true,
    face: faceToward(b.x, b.z, POOL.x, POOL.z), level: 0 as const,
  })),
  // The daybeds are for LYING, not sitting: they have a raised back rest, and a seated
  // pose on one reads as somebody perched on the edge of a bed. `act: 'recline'` is what
  // selects the lying pose — the activity picks the pose, exactly as 'barbell' does.
  // LYING: the one place the mesh rotation IS the right answer for the body.
  //
  // The recline pose lays the head at local -z, and the bed mesh puts its raised head rest at
  // local -z too, so body rotation = mesh rotation lands the head exactly on the rest
  // (measured: 0.08 m) and keeps the body parallel to the bed's long axis. Computing a
  // look-at instead tilts the body 15 degrees across its own mattress — the recline pose has
  // no "look" direction to aim, because a supine body's chest faces the sky.
  ...SUNBEDS.map((b) => ({
    x: b.x, z: b.z, act: 'recline' as const, seated: true,
    face: b.facing, level: 0 as const,
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
  // The standing-press spot stands off the rack's corner, so a fixed -PI/2 pointed 33 degrees
  // wide of it (dot 0.84). Computed from the spot's own position instead.
  { x: GYM.rack.x + 1.15, z: GYM.rack.z + 0.75, act: 'barbell', face: faceToward(GYM.rack.x + 1.15, GYM.rack.z + 0.75, GYM.rack.x, GYM.rack.z), level: 0 },
  // BENCH PRESS: ON the bench, not beside it. The bench pad is at the rack's own centre
  // (x -4.2, z -5.6), so the spot is the pad itself. The first version reused the
  // standing-press offset and put the body 1.37 m away, lying on the floor next to the
  // bench — measured, not guessed.
  //
  // face = PI, not -PI/2. The pad runs along Z (0.36 wide in x, 1.25 long in z) and the
  // pose lays the torso along the body's own Z, so only face 0 or PI puts the body ALONG
  // the pad. -PI/2 laid it ACROSS: body-axis dot pad-axis measured 0.00, head hanging off
  // the pad's east edge. PI (head north, feet south) fits inside the pad footprint;
  // face 0 hangs the head 9 cm off the south end. The press reads correctly either way:
  // hands spread along X (the bar's own axis) and travel upward.
  { x: GYM.rack.x, z: GYM.rack.z, act: 'benchpress', bench: true, face: Math.PI, level: 0 },
  // In FRONT of the dumbbell rack (the rack's own footprint spans x 3.1..5.3,
  // z -6.05..-5.15, so a spot at its centre is inside it). Facing north to the rack.
  // Both stand SOUTH of the rack, so a fixed PI faced north and missed by up to 34 degrees
  // (dot 0.83) — the "ga menghadap objectnya" case. Computed from each spot's own position.
  { x: GYM.dumbbells.x - 0.6, z: GYM.dumbbells.z + 0.9, act: 'dumbbell', face: faceToward(GYM.dumbbells.x - 0.6, GYM.dumbbells.z + 0.9, GYM.dumbbells.x, GYM.dumbbells.z), level: 0 },
  { x: GYM.dumbbells.x + 0.2, z: GYM.dumbbells.z + 1.5, act: 'dumbbell', face: faceToward(GYM.dumbbells.x + 0.2, GYM.dumbbells.z + 1.5, GYM.dumbbells.x, GYM.dumbbells.z), level: 0 },
  // directly under the bar: the pull-up pose solves its own height, so the body hangs
  // with its feet off the mat rather than standing beside the rig.
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
  // Each spot aims at the grill through the ONE helper, instead of three hand-computed
  // atan2 values that happened to be right. Same numbers, one source of truth.
  { x: BBQ.x - 1.55, z: BBQ.z, act: 'bbq', face: faceToward(BBQ.x - 1.55, BBQ.z, BBQ.x, BBQ.z), level: 0 },
  { x: BBQ.x - 0.35, z: BBQ.z + 1.45, act: 'bbq', face: faceToward(BBQ.x - 0.35, BBQ.z + 1.45, BBQ.x, BBQ.z), level: 0 },
  { x: BBQ.x + 1.45, z: BBQ.z - 0.9, act: 'bbq', face: faceToward(BBQ.x + 1.45, BBQ.z - 0.9, BBQ.x, BBQ.z), level: 0 },

  /* ---- the planting band: LOOK AT THE FLOWERS (poin 5) ------------------ */
  // The band runs x -6..6.2 at z -2.4..-0.8. A body stands SOUTH of it and faces NORTH
  // into the greenery: rotation PI turns the local +z look to -z. The old spots stood
  // south but faced `Math.PI` from the wrong side, so they looked away from the beds.
  // Aimed at the middle of the band through the helper: the band is NORTH of every spot, and
  // a hardcoded PI only stayed correct while that remained true.
  { x: PLANTING.x1 + 1.6, z: PLANTING.z2 + 0.75, act: 'garden', face: faceToward(PLANTING.x1 + 1.6, PLANTING.z2 + 0.75, PLANTING.x1 + 1.6, (PLANTING.z1 + PLANTING.z2) / 2), level: 0 },
  { x: (PLANTING.x1 + PLANTING.x2) / 2, z: PLANTING.z2 + 0.75, act: 'garden', face: faceToward((PLANTING.x1 + PLANTING.x2) / 2, PLANTING.z2 + 0.75, (PLANTING.x1 + PLANTING.x2) / 2, (PLANTING.z1 + PLANTING.z2) / 2), level: 0 },
  { x: PLANTING.x2 - 1.6, z: PLANTING.z2 + 0.75, act: 'garden', face: faceToward(PLANTING.x2 - 1.6, PLANTING.z2 + 0.75, PLANTING.x2 - 1.6, (PLANTING.z1 + PLANTING.z2) / 2), level: 0 },

  /* ---- pantry: the three stools ---------------------------------------- */
  ...PANTRY_STOOLS.map((z) => ({
    x: PANTRY.x + PANTRY_STOOL_GAP,
    z,
    act: 'coffee' as const,
    seated: true,
    // The stools are WEST of the counter (x 25.6), so the body faces EAST into it.
    // Computed rather than hardcoded, so moving the counter moves the facing with it.
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
      // LOOK AT THE TABLE. `diningChairFacing` is the CHAIR MESH's rotation (the mesh looks
      // along -z), so using it for a body turned all 24 diners to face the back of their own
      // chair: measured dot -1.00, every single one. This is the "ngebelakangin kursi" bug.
      face: faceToward(c.x, c.z, s.x, s.z),
      level: 0 as const,
    })),
  ),

  /* ---- the leisure room: the sofa, facing the TV ------------------------- */
  // LOOK AT THE TV. `face: 0` faces north, and the TV is SOUTH of the sofa, so the sitter
  // had its back to the screen: dot -1.00. This is the "ngebelakangin sofa" bug.
  { x: LOUNGE.x, z: LOUNGE.z, act: 'sofa', seated: true, face: faceToward(LOUNGE.x, LOUNGE.z, LOUNGE_TV.x, LOUNGE_TV.z), level: 0 },
  /* ---- the lounge rec gear: darts and the four racing sims --------------- */
  // The marketing nook: its two soft chairs were built as furniture but had NO idle spot, so
  // nobody could ever sit in them. Each chair faces the low table between them, computed from
  // its own position rather than a fixed angle (the two chairs are on opposite sides).
  ...ROOM_PROPS.filter((p) => p.kind === 'nook').flatMap((n) => [
    { x: n.x - 0.95, z: n.z, act: 'sofa' as const, seated: true, face: faceToward(n.x - 0.95, n.z, n.x, n.z), level: 0 as const },
    { x: n.x + 0.95, z: n.z, act: 'sofa' as const, seated: true, face: faceToward(n.x + 0.95, n.z, n.x, n.z), level: 0 as const },
  ]),
  // One thrower at the oche, facing the board on the east wall.
  { x: DART_THROW.x, z: DART_THROW.z, act: 'dart', face: faceToward(DART_THROW.x, DART_THROW.z, DARTBOARD.x, DARTBOARD.z), level: 0 },
  // One driver per rig — four of them, read from RACING_RIGS so a rig can never be drawn in
  // one place and driven in another. `seated` arms the settling exemption, so the body may
  // tuck into a seat the footprint would otherwise block.
  // The DRIVER faces the WHEEL, which the rig puts on its local -z (the rig mesh is built
  // with the wheel and screen ahead of the seat at negative local z, so a rig's `facing` is
  // also its mesh rotation). Copying `facing` into the body's `face` was wrong: a BODY looks
  // along its own local +z, the opposite of the mesh convention, so the driver sat facing
  // due south with its back to its own wheel — measured head-dot -1.00.
  ...RACING_RIGS.map((r) => ({
    x: r.x, z: r.z, act: 'racing' as const, seated: true, face: r.facing + Math.PI, level: 0 as const,
  })),
  // One bowler on the approach, aiming east at the pins. The face is DERIVED from the lane,
  // so moving or turning the lane moves the aim with it instead of leaving the bowler
  // throwing at a wall.
  {
    x: BOWLING_STAND_X,
    z: BOWLING.z,
    act: 'bowling',
    face: faceToward(BOWLING_STAND_X, BOWLING.z, BOWLING.headPinX, BOWLING.z),
    level: 0,
  },

  /* ---- under the second floor: the covered terrace ------------------------ */
  // The work bar: a body perched on each stool, facing the bar (north, toward the counter).
  // The bar is at the north edge of the strip, so a sitter looks NORTH (-z) at it.
  ...TERRACE_PROPS.filter((p) => p.kind === 'stool').map((p) => ({
    x: p.x,
    z: p.z,
    act: 'coffee' as const,
    seated: true,
    face: Math.PI,
    level: 0 as const,
  })),
  // The two sofas face SOUTH over the courtyard — they look at the pool, which is the point
  // of sitting there. `face` is computed from the body's own position toward the pool.
  ...TERRACE_PROPS.filter((p) => p.kind === 'sofa').map((p) => ({
    x: p.x,
    z: p.z,
    act: 'sofa' as const,
    seated: true,
    face: faceToward(p.x, p.z, POOL.x, POOL.z),
    level: 0 as const,
  })),
  // The communal bench along the long table, looking east at the table.
  ...TERRACE_PROPS.filter((p) => p.kind === 'tbench').map((p) => ({
    x: p.x,
    z: p.z,
    act: 'eat' as const,
    seated: true,
    face: faceToward(p.x, p.z, p.x + 1.6, p.z),
    level: 0 as const,
  })),

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
      // LOOK AT THE TABLE, computed from the seat's own position. `ringSeats` happens to
      // store atan2(dx, dz) already, so this is the same number — but stating it as a
      // look-at keeps the convention in ONE place instead of relying on that coincidence.
      face: faceToward(s.x, s.z, MEETING_TABLES[id].x, MEETING_TABLES[id].z),
      level: 1 as const,
    })),
  ),
  // The CEO suite: the chair at the desk and the sofa facing the window. Both were
  // furniture an idle body could see but never use — the coverage assert in the
  // self-test compares every enjoyable seat against this list.
  //
  // Dibaca dari CEO_SUITE, bukan ditulis ulang: anchor yang tertinggal saat sofa dipindah
  // membuat agent duduk di udara. `face` = `facing` furniturnya — kursi bos menghadap pintu
  // (0), kursi tamu menghadap kursi bos (π), sofa 3-seat menghadap timur (π/2), sofa 1-seat
  // menghadap utara (π). Sofa 3-seat punya tiga dudukan, jadi tiga anchor sepanjang z.
  { x: CEO_SUITE.bossChair.x, z: CEO_SUITE.bossChair.z, act: 'idle', seated: true, face: CEO_SUITE.bossChair.facing, level: 1 },
  ...CEO_SUITE.guestChairs.map((g) => ({
    x: g.x,
    z: g.z,
    act: 'idle' as const,
    seated: true,
    face: g.facing,
    level: 1 as const,
  })),
  ...[-1, 0, 1].map((k) => ({
    x: CEO_SUITE.sofa3.x,
    z: CEO_SUITE.sofa3.z + k * (CEO_SUITE.sofa3.len / 3),
    act: 'idle' as const,
    seated: true,
    face: CEO_SUITE.sofa3.facing,
    level: 1 as const,
  })),
  { x: CEO_SUITE.sofa1.x, z: CEO_SUITE.sofa1.z, act: 'idle', seated: true, face: CEO_SUITE.sofa1.facing, level: 1 },
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

/**
 * The room name plaques, and the SURFACE each one is attached to.
 *
 * Reported once as "banyak banget kotak melayang ... hapus aja": the old placards hung at
 * 2.55 m on each room's EDGE, in open air with nothing above or behind them, so from anywhere
 * in the building they read as black boxes at head height. The names were never the problem —
 * hanging them on nothing was. Every entry here therefore names a WALL SEGMENT to be screwed
 * to and the yaw that turns the plate out of that wall, so a plaque cannot be airborne.
 *
 * Which rooms get one, per the operator: the three work rooms, the five meeting rooms, the
 * pantry with the lounge beside it, and the CEO room. The lobby, courtyard, terrace and
 * corridor are circulation space and stay unmarked.
 *
 * Names come from `ROOMS`, so a renamed room renames its plaque. Meeting rooms take the
 * operator's `R. MEETING <gunung>` form.
 *
 * PLACEMENT, measured off the wall list rather than eyeballed:
 *
 *   WEST WING (dev, mkt, content) — the corridor side is EAST, so the plate goes on the east
 *   face of the x = -14 wall (face at -13.85) and faces +x. Each sits on the wall segment
 *   beside its door: dev's door is z -15.2..-12.4, mkt's z -1.4..1.4, content's z 12.4..15.2.
 *
 *   EAST WING (lounge, pantry) — the corridor side is WEST, so the plate goes on the west face
 *   of the x = 14 wall (face at 13.85) and faces -x. The lounge's door is z -5.4..-2.6 and its
 *   plate sits on z -2.6..2.0; the pantry's door is z 6.6..9.4 and its plate on z 2.0..6.6.
 *
 *   MEETING ROOMS (level 1) — the corridor runs along their SOUTH side, so the plate goes on
 *   the south face of the z = -11.5 wall (face at -11.35) and faces +z. Each sits on the
 *   segment WEST of its door.
 *
 * `y` is absolute: 1.70 m above its own floor.
 */
const PLAQUE_Y = 1.7
/** Half the plate's depth, so the slab's back sits just inside the wall face it is fixed to. */
export const PLAQUE_T = 0.03
/** The plate itself, and the backing slab that carries it. */
export const PLAQUE_W = 1.9
export const PLAQUE_H = 0.475
const MEETING_SET = new Set<string>(MEETING_ROOM_IDS)

const PLAQUE_AT: Record<string, { x: number; z: number; face: number }> = {
  // west wing, on the east face of the x = -14 wall
  dev: { x: -13.85 + PLAQUE_T / 2, z: -9.65, face: Math.PI / 2 },
  mkt: { x: -13.85 + PLAQUE_T / 2, z: 4.15, face: Math.PI / 2 },
  content: { x: -13.85 + PLAQUE_T / 2, z: 18.03, face: Math.PI / 2 },
  // east wing, on the west face of the x = 14 wall
  leisure: { x: 13.85 - PLAQUE_T / 2, z: -0.3, face: -Math.PI / 2 },
  pantry: { x: 13.85 - PLAQUE_T / 2, z: 4.3, face: -Math.PI / 2 },
  // the exec floor, on the south face of the corridor wall
  // The CEO's door is x -22.2..-19.8, which leaves a 5.65 m segment to the west and only
  // 0.5 m to the east — so the plate goes on the west segment, centred.
  ceo: { x: -25.03, z: -11.35 + PLAQUE_T / 2, face: 0 },
  rinjani: { x: -16.8, z: -11.35 + PLAQUE_T / 2, face: 0 },
  merapi: { x: -5.2, z: -11.35 + PLAQUE_T / 2, face: 0 },
  bromo: { x: 3.5, z: -11.35 + PLAQUE_T / 2, face: 0 },
  semeru: { x: 12.2, z: -11.35 + PLAQUE_T / 2, face: 0 },
  cikurai: { x: 20.85, z: -11.35 + PLAQUE_T / 2, face: 0 },
}

export const ROOM_PLAQUES: {
  id: string
  text: string
  x: number
  y: number
  z: number
  face: number
  level: 0 | 1
}[] = Object.keys(PLAQUE_AT).map((id) => {
  const r = room(id)
  const at = PLAQUE_AT[id]
  return {
    id,
    text: MEETING_SET.has(id) ? `R. MEETING ${r.label}` : r.label,
    x: at.x,
    y: r.level * LEVEL_H + PLAQUE_Y,
    z: at.z,
    face: at.face,
    level: r.level,
  }
})

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
