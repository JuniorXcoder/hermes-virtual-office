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

/**
 * Chair and sitter share these numbers. The chair group sits at z = +1.0 with its
 * back at +0.28, so the seated centre of mass is ~0.26 further back; placing the
 * avatar at the chair's anchor left it perched 8 cm forward of the cushion.
 */
export const DESK_CHAIR = { x: 0, z: 1.0 }
/**
 * The task chair's backrest sits at local +0.28 from the chair anchor, so a
 * sitter's centre of mass is just IN FRONT of the anchor (toward the desk) —
 * placing the avatar behind the anchor left it straddling the backrest.
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

/* ------------------------------------------------------- landmarks / props -- */

// Sized so the card grid has real screen area: at 4.0 tall the projected board
// was only ~60px high and the cards overflowed it.
// z: the board's BACK face must touch the wall's inner surface. The surface is at
// -HALF_D + WALL_T/2; the board is BOARD_D deep, so its centre sits half a depth
// further in. The previous value left it hovering 24 cm off the wall.
export const BOARD_D = 0.14
/**
 * The board must FIT the wall it hangs on, AND the room it is in.
 *
 * Two bugs live here. The first: a 7.6 m height on a 4.6 m wall drove its lower
 * edge 0.9 m through the floor and put its top 2.1 m above the wall line.
 *
 * The second, found later: 13.6 m of width inside a 12.0 m work bay, so the board
 * passed clean through both partitions at x = +-6. Width is now 11.2 m, which
 * with the 0.24 m frame leaves ~0.28 m clear of each partition face.
 */
/* ------------------------------------------------------------------ roof -- */

/**
 * The building has no roof at all: a single-storey slab whose perimeter stops
 * dead at the wall top, which is why it reads as an open box rather than a
 * building. The lobby bay carries a real roof deck with plant on it; the three
 * work rooms stay open so the interior — and the Kanban board — stay readable
 * from outside.
 */
export const PARAPET_H = 0.55
export const PARAPET_T = 0.34
export const ROOF_DECK_T = 0.22
/**
 * Roofed bay: a 4.2 m strip along the street facade, i.e. the entrance zone.
 * Deliberately NOT the whole lobby: a 34 x 9.6 m slab would hide half the
 * interior in the default view, and the point of the cutaway is that the office
 * and its Kanban board stay readable.
 */
export const ROOF_BAY_D = 4.2
export const ROOF_BAY = {
  x1: -HALF_W,
  x2: HALF_W,
  z1: HALF_D - ROOF_BAY_D,
  z2: HALF_D,
}

/**
 * The ceiling must sit at the wall TOP. At 4.3 m it was 0.3 m BELOW the 4.6 m wall
 * line, so the ceiling plane sliced across the upper wall and read as a beam
 * cutting through the Kanban board. Flush with the wall, it cannot.
 */
export const CEILING_Y = WALL_H
export const BOARD_REVEAL = 0.35
export const KANBAN_BOARD = {
  x: 0,
  y: (CEILING_Y - BOARD_REVEAL * 2) / 2 + BOARD_REVEAL,
  z: -HALF_D + WALL_T / 2 + BOARD_D / 2 + 0.01,
  w: 11.2,
  h: Math.min(11.2 * 0.62, CEILING_Y - BOARD_REVEAL * 2),
}
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

/**
 * Anchors for the additional idle activities. Each names the PROP an agent uses,
 * not just a coordinate: a pose with nowhere to stand (or nothing to interact
 * with) reads as an agent staring at a wall.
 */
/**
 * The green corner sits in the LOUNGE by the side glazing, not in the work bay:
 * at z = -11.5 in the work bay the planter stood directly in front of the Kanban
 * board and covered its lower edge.
 */
export const GARDEN = { x: 11.6, z: -11.6 }
export const BOOK_NOOK = { x: 0, z: 1.7 }
export const PANTRY = { x: 14.4, z: 1.0 }
/** Stools at the pantry counter, where the coffee activity plays. */
// Both stools sit between the counter's ends (13.15 .. 15.65) so an agent has
// counter in front of it, not a wall.
export const PANTRY_STOOLS = [13.6, 15.2] as const
/** Distance from the counter centre out to the stool centre. */
export const PANTRY_STOOL_GAP = 0.72
export const RECEPTION = { x: -8.4, z: 8.4 }

/**
 * Window openings. `y` is measured from the FLOOR, matching how build.ts cuts the
 * hole — the first version passed a wall-centre-relative value and every cut-out
 * landed above the wall line, so the facade had no windows at all.
 */
/**
 * Windows are laid out from data, not by hand.
 *
 * The north face is glazed in three groups with clear wall between them: the
 * Kanban board occupies the centre 14 m, so no opening may fall inside x = ±7.
 * Side elevations use a regular 4.5 m pitch. `windowConflicts()` proves that no
 * opening overlaps another, the board, or any artwork.
 */
export const WINDOW_Y = 2.7
export const WINDOW_H = 1.9
/** Half-width of the Kanban board plus clearance: no window inside this band. */
export const BOARD_CLEAR_X = 6.2

const northGroup = (centres: number[], w: number) =>
  centres.map((x) => ({ x, y: WINDOW_Y, w, h: WINDOW_H }))

export const NORTH_WINDOWS = [
  // Three per side, clear of the board band. Centres chosen so every pair has
  // >= 0.6 m of solid wall between openings (verified by facadeConflicts()).
  ...northGroup([-15.8, -12.0, -9.0], 2.2),
  ...northGroup([9.0, 12.0, 15.8], 2.2),
]

/**
 * The south elevation faces the street and carries the entrance, yet it had no
 * openings at all: 34 m of blind wall on the most visible side. Three windows
 * per side, clear of the door band (|x| > 1.7).
 */
export const SOUTH_WINDOWS = [
  ...northGroup([-15.8, -12.0, -9.0], 2.2),
  ...northGroup([9.0, 12.0, 15.8], 2.2),
]

/** Coping cap on the parapet: without it the roofline is just a cut edge. */
export const COPING_H = 0.09
export const COPING_LIP = 0.06

export const SIDE_WINDOWS = [-11.2, -6.7, -2.2, 2.3, 6.8, 11.3] as const
export const SIDE_WINDOW_W = 2.4

export const WINDOWS = [
  ...NORTH_WINDOWS,
  ...SIDE_WINDOWS.map((z) => ({ x: z, y: WINDOW_Y, w: SIDE_WINDOW_W, h: WINDOW_H, side: true })),
] as const

/** Every opening on the plan, resolved to a world position, for conflict checks. */
export function windowPlan() {
  const out: { id: string; x: number; z: number; along: 'x' | 'z'; w: number; h: number; y: number }[] = []
  for (const w of NORTH_WINDOWS) {
    out.push({ id: `north@${w.x}`, x: w.x, z: -HALF_D, along: 'x', w: w.w, h: w.h, y: w.y })
  }
  for (const w of SOUTH_WINDOWS) {
    out.push({ id: `south@${w.x}`, x: w.x, z: HALF_D, along: 'x', w: w.w, h: w.h, y: w.y })
  }
  for (const z of SIDE_WINDOWS) {
    out.push({ id: `west@${z}`, x: -HALF_W, z, along: 'z', w: SIDE_WINDOW_W, h: WINDOW_H, y: WINDOW_Y })
    out.push({ id: `east@${z}`, x: HALF_W, z, along: 'z', w: SIDE_WINDOW_W, h: WINDOW_H, y: WINDOW_Y })
  }
  return out
}

/**
 * Openings and wall art must not overlap. Checked in 1-D along each wall, which
 * is all that is needed because both live on the same plane.
 */
export function facadeConflicts(): { kind: string; a: string; b: string }[] {
  const out: { kind: string; a: string; b: string }[] = []
  const wins = windowPlan()
  // Compare in WORLD coordinates. Using each painting's raw `along` mixed two
  // frames of reference and reported overlaps that do not exist.
  const art = PAINTINGS.map((p, i) => {
    const tx = Math.cos(p.wall.ry)
    const tz = -Math.sin(p.wall.ry)
    return {
      id: `art${i}`,
      x: p.wall.x + tx * p.along,
      z: p.wall.z + tz * p.along,
      onX: p.wall.along === 'x',
      w: p.w,
    }
  })
  const overlaps = (a: number, b: number, wa: number, wb: number) => Math.abs(a - b) < (wa + wb) / 2

  for (let i = 0; i < wins.length; i++) {
    for (let j = i + 1; j < wins.length; j++) {
      const A = wins[i]
      const B = wins[j]
      if (A.along !== B.along) continue
      const sameWall =
        A.along === 'x'
          ? Math.abs(A.z - B.z) < 0.5
          : Math.abs(A.x - B.x) < 0.5
      if (!sameWall) continue
      const pa = A.along === 'x' ? A.x : A.z
      const pb = B.along === 'x' ? B.x : B.z
      if (overlaps(pa, pb, A.w, B.w)) out.push({ kind: 'window-window', a: A.id, b: B.id })
    }
    // nothing may sit inside the Kanban board band
    const W = wins[i]
    if (W.along === 'x' && Math.abs(W.z + HALF_D) < 0.5) {
      const pa = W.x
      if (Math.abs(pa) - W.w / 2 < BOARD_CLEAR_X) {
        out.push({ kind: 'window-board', a: W.id, b: 'kanban' })
      }
    }
  }
  for (const A of wins) {
    for (const P of art) {
      // same wall plane?
      const sameWall =
        A.along === 'x'
          ? Math.abs(A.z - P.z) < 0.5 && !P.onX
          : Math.abs(A.x - P.x) < 0.5 && P.onX
      if (!sameWall) continue
      const pa = A.along === 'x' ? A.x : A.z
      const pb = A.along === 'x' ? P.x : P.z
      if (overlaps(pa, pb, A.w, P.w)) {
        out.push({ kind: 'window-art', a: A.id, b: P.id })
      }
    }
  }
  return out
}

/**
 * Artwork is defined by the WALL it hangs on, not by a hand-typed position: the
 * first version placed frames at the wall's centre line (buried inside it) or
 * tens of centimetres off it (floating). Each entry names the wall plane and the
 * outward normal, and `paintingPlacement()` derives frame + canvas coordinates
 * from the wall thickness.
 */
export type WallFace = { x: number; z: number; ry: number; span: number; along: 'x' | 'z' }
export type PaintingSpec = { wall: WallFace; along: number; y: number; w: number; h: number }

const WEST_PART: WallFace = { x: ROOMS.work.x1, z: 1, ry: Math.PI / 2, span: 16, along: 'z' }
const EAST_PART: WallFace = { x: ROOMS.work.x2, z: 1, ry: -Math.PI / 2, span: 16, along: 'z' }
const NORTH: WallFace = { x: 0, z: -HALF_D, ry: 0, span: 34, along: 'x' }
const LOBBY_W: WallFace = { x: -HALF_W, z: 6, ry: Math.PI / 2, span: 12, along: 'z' }
const LOBBY_E: WallFace = { x: HALF_W, z: 6, ry: -Math.PI / 2, span: 12, along: 'z' }

/** Facing an inward normal: `ry` is 0 for a frame facing +Z, ±PI/2 for ±X. */
export const PAINTINGS: PaintingSpec[] = [
  // work bay, on both partitions
  { wall: WEST_PART, along: -6.0, y: 1.9, w: 1.5, h: 1.1 },
  { wall: WEST_PART, along: 1.6, y: 1.9, w: 1.1, h: 1.4 },
  { wall: EAST_PART, along: -4.4, y: 1.9, w: 1.5, h: 1.1 },
  { wall: EAST_PART, along: 1.6, y: 1.9, w: 1.1, h: 1.4 },
  // Lobby side walls only: the north face is fully glazed, so art there collided
  // with window openings. `facadeConflicts()` enforces the separation.
  // lobby side walls, placed in the gaps between side windows
  { wall: LOBBY_W, along: -5.6, y: 1.95, w: 1.3, h: 1.7 },
  { wall: LOBBY_W, along: -9.0, y: 1.95, w: 1.3, h: 1.7 },
  { wall: LOBBY_E, along: -5.6, y: 1.95, w: 1.3, h: 1.7 },
  { wall: LOBBY_E, along: -9.0, y: 1.95, w: 1.3, h: 1.7 },
]

/**
 * Frame + canvas placement, derived from the wall SURFACE.
 *
 * A frame is a box of depth FRAME_D; centring it on the wall's coordinate buried
 * it inside the wall (the wall is WALL_T thick), which is why artwork looked
 * either invisible or z-fighting. Everything is now measured outward from the
 * wall's inner face.
 */
export const FRAME_D = 0.06

export function paintingPlacement(spec: PaintingSpec) {
  const { wall, along, y, w, h } = spec
  const nx = Math.sin(wall.ry)
  const nz = Math.cos(wall.ry)
  // tangent along the wall, pointing in +along direction
  const tx = Math.cos(wall.ry)
  const tz = -Math.sin(wall.ry)

  const surface = WALL_T / 2 // from the wall centre out to its inner face
  const frameOut = surface + FRAME_D / 2 + 0.005
  const matteOut = surface + FRAME_D + 0.01
  const canvasOut = matteOut + 0.012

  const at = (out: number) => ({
    x: wall.x + nx * out + tx * along,
    z: wall.z + nz * out + tz * along,
    y,
  })
  return { frame: at(frameOut), matte: at(matteOut), canvas: at(canvasOut), ry: wall.ry, w, h }
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
  fp('sofa', LOUNGE.x, LOUNGE.z - 1.45, 1.75, 0.55, 0.85, 'seat'),
  fp('tv-unit', LOUNGE.x, LOUNGE.z - 4.9, 1.3, 0.35, 0.55),
  fp('coffee-table', LOUNGE.x, LOUNGE.z - 2.9, 0.62, 0.62, 0.44, 'desk'),
  fp('lounge-chair', LOUNGE.x - 2.3, LOUNGE.z - 0.6, 0.45, 0.45, 0.8, 'seat'),
  fp('floor-lamp', LOUNGE.x + 2.5, LOUNGE.z - 3.2, 0.3, 0.3, 1.8),
  fp('pantry', 14.4, 1.0, 1.25, 0.35, 0.95),
  fp('cooler', 15.6, -1.6, 0.32, 0.32, 1.5),
  fp('plant-lng-a', 6.9, -12.0, 0.4, 0.4, 1.0),
  fp('plant-lng-b', 16.5, 2.9, 0.4, 0.4, 1.0),
  fp('bins', 7.0, 3.0, 0.55, 0.25, 0.7),

  // ---- green corner (garden activity) + book nook (read) + pantry stools ---
  fp('garden-box', GARDEN.x, GARDEN.z, 1.45, 0.28, 0.55),
  fp('garden-pot-a', GARDEN.x - 2.0, GARDEN.z, 0.3, 0.3, 0.5),
  fp('garden-pot-b', GARDEN.x + 2.0, GARDEN.z, 0.3, 0.3, 0.5),
  fp('book-shelf', BOOK_NOOK.x - 1.9, BOOK_NOOK.z, 0.22, 0.95, 2.0),
  fp('book-chair', BOOK_NOOK.x + 0.55, BOOK_NOOK.z, 0.5, 0.5, 0.85, 'seat'),
  fp('book-table', BOOK_NOOK.x + 1.35, BOOK_NOOK.z, 0.32, 0.32, 0.5, 'desk'),
  // In FRONT of the counter, not inside it: the counter occupies z +-0.35 around
  // PANTRY.z, so a stool at the same z was embedded in the cabinet.
  ...PANTRY_STOOLS.map((sx, i) => fp(`stool-${i}`, sx, PANTRY.z + PANTRY_STOOL_GAP, 0.24, 0.24, 0.62, 'seat')),

  // ---- lobby
  fp('reception', RECEPTION.x, RECEPTION.z, 1.5, 0.45, 1.05, 'desk'),
  fp('reception-chair', RECEPTION.x, RECEPTION.z + 1.15, 0.32, 0.32, 0.5, 'seat'),
  fp('wait-sofa-a', -6.4, 9.4, 0.9, 0.5, 0.8, 'seat'),
  fp('wait-sofa-b', 6.4, 9.4, 0.9, 0.5, 0.8, 'seat'),
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
