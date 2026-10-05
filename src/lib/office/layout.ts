import type { AgentDivision, AgentRole } from '@/types/hermes'

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
export const WALL_H = 4.6
/** Wall thickness, shared by walls and partitions. */
export const WALL_T = 0.3

/* ------------------------------------------------------------------ rooms -- */

/**
 * Denah ORGANIK MELENGKUNG (bukan kotak):
 *
 *   - Aula tengah = oval di (0,-4), radius ~4.5. Kanban board melengkung
 *     mengikuti dinding utara aula (chord di z=-8.35, lebar 8).
 *   - 4 pods divisi melengkung mengelilingi aula: exec (NW), tech (W),
 *     growth (NE), content (E). Tiap pod = bbox zona + 2 sekat lengkung.
 *   - Koridor = cincin terbuka antara dinding aula (r 4.5) dan pods.
 *   - Lounge di SW, kolam GINJAL di SE (9,6), lobby = pita selatan.
 *
 *   Sketsa ASCII (x -17..17, z -13..13):
 *
 *     z=-13 |==== DINDING LUAR (tetap kotak, kulit gedung) ====|
 *     z=-9   (exec pod)    [BOARD chord]    (growth pod)
 *     z=-4   (tech pod)   (( AULA OVAL ))   (content pod)
 *     z=+3   - - - - koridor cincin - - - - - - - - - - -
 *     z=+6   [LOUNGE sw]      lobby       ((KOLAM ginjal se))
 *     z=+13 |==== pintu masuk (0,13) ====|
 *
 *   `ROOMS` = zona bbox (boleh overlap, hanya untuk check & SpriteOffice).
 *   Dinding lengkung nyata = se/themes/dinding-aula + sekat pod di FOOTPRINTS
 *   (aproksimasi kurva dgn box kecil) + digambar di build.ts.
 */
export const AULA = { x: 0, z: -4, r: 4.5 }
export const ROOMS = {
  meeting: { x1: -4.5, x2: 4.5, z1: -8.5, z2: 0.5 },
  work: { x1: -HALF_W + WALL_T, x2: HALF_W - WALL_T, z1: -HALF_D + WALL_T, z2: 3.4 },
  lounge: { x1: -HALF_W + WALL_T, x2: -2.0, z1: 3.4, z2: HALF_D - WALL_T },
  lobby: { x1: -HALF_W + WALL_T, x2: HALF_W - WALL_T, z1: 3.4, z2: HALF_D - WALL_T },
} as const

/** Celah pintu di dinding aula (4 arah mata angin) + pintu lounge. */
export const ROOM_DOORS = {
  meeting: { x: 0, width: 2.4 },
  work: { x: 0, width: 3.4 },
  lounge: { x: -9.0, width: 2.2 },
} as const
/** Titik celah dinding aula (E,S,W,N) — juga dipakai OPENINGS. */
export const AULA_GAPS = {
  north: { x: 0, z: -8.5 },
  east: { x: 4.5, z: -4 },
  south: { x: 0, z: 0.5 },
  west: { x: -4.5, z: -4 },
} as const

/* ------------------------------------------------------------------ desks -- */

export const DESK_COLUMNS = [-9.5, -8.0, 8.0, 9.5] as const
export const DESK_ROW_Z = { far: -8.5, near: -2.0 } as const

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
 * 12 stations, 4 pods melengkung mengelilingi aula (facing = hadap pusat aula):
 * - exec 2: NW pod (-5.5,-8.2) & NE pod (5.5,-8.2), hadap aula
 * - tech 4: W pod (-7.5,-5.5) (-8.5,-3.5) + NW cadangan
 * - growth 3: NE/E pod (7.5,-5.5) (8.5,-3.5) (6.0,-2.0)
 * - content 3: E pod (7.0,0.0) (5.0,1.5) (9.0,-1.0)
 */
export const DESKS: Desk[] = [
  { index: 0, x: -5.5, z: -8.2, facing: Math.atan2(-5.5 - 0, -8.2 - -4), column: 0, side: 'far' as const, division: 'exec' },
  { index: 1, x: 5.5, z: -8.2, facing: Math.atan2(5.5 - 0, -8.2 - -4), column: 3, side: 'far' as const, division: 'exec' },
  { index: 2, x: -7.5, z: -5.5, facing: Math.atan2(-7.5 - 0, -5.5 - -4), column: 0, side: 'near' as const, division: 'tech' },
  { index: 3, x: -8.5, z: -3.5, facing: Math.atan2(-8.5 - 0, -3.5 - -4), column: 1, side: 'near' as const, division: 'tech' },
  { index: 4, x: -7.0, z: -2.0, facing: Math.atan2(-7.0 - 0, -2.0 - -4), column: 1, side: 'near' as const, division: 'tech' },
  { index: 5, x: -6.0, z: -6.8, facing: Math.atan2(-6.0 - 0, -6.8 - -4), column: 0, side: 'far' as const, division: 'tech' },
  { index: 6, x: 7.5, z: -5.5, facing: Math.atan2(7.5 - 0, -5.5 - -4), column: 2, side: 'near' as const, division: 'growth' },
  { index: 7, x: 8.5, z: -3.5, facing: Math.atan2(8.5 - 0, -3.5 - -4), column: 2, side: 'near' as const, division: 'growth' },
  { index: 8, x: 6.0, z: -2.0, facing: Math.atan2(6.0 - 0, -2.0 - -4), column: 2, side: 'near' as const, division: 'growth' },
  { index: 9, x: 7.0, z: 0.0, facing: Math.atan2(7.0 - 0, 0.0 - -4), column: 3, side: 'near' as const, division: 'content' },
  { index: 10, x: 5.0, z: 1.5, facing: Math.atan2(5.0 - 0, 1.5 - -4), column: 3, side: 'near' as const, division: 'content' },
  { index: 11, x: 9.0, z: -1.0, facing: Math.atan2(9.0 - 0, -1.0 - -4), column: 3, side: 'far' as const, division: 'content' },
]

/** Meja-meja milik satu divisi (label urut). */
export function desksForDivision(div: AgentDivision): Desk[] {
  return DESKS.filter((d) => d.division === div).sort((a, b) => a.index - b.index)
}

/**
 * Chair and sitter share these numbers. The chair group sits at z = +1.0 with its
 * back at +0.28, so the seated centre of mass is ~0.26 further back; placing the
 * avatar at the chair's anchor left it perched 8 cm forward of the cushion.
 */
/**
 * Look up a desk by its LABEL, not by its position in the array.
 *
 * `DESKS` is built by flat-mapping the columns, so the array order is
 * far,near,far,near… and `DESKS[n]` is NOT the desk labelled `n`:
 *
 *   DESKS[0] = desk 4    DESKS[1] = desk 0
 *   DESKS[2] = desk 5    DESKS[3] = desk 1   …
 *
 * Every caller that wants "desk number n" must come through here. Using
 * `DESKS[deskIndex]` put an agent whose UI card said "Meja 1" at the station
 * labelled 5.
 */
export function deskByIndex(index: number): Desk | undefined {
  return DESKS.find((d) => d.index === index)
}

/**
 * Seats: the single source of truth for seat height.
 *
 * These numbers used to live in two places — the furniture in build.ts and the
 * pose in anim.ts — and they drifted. The sofa was modelled with its surface at
 * 0.59 while the avatar's legs reach only 0.46 below the hip, so the feet could
 * not touch the floor and every sitter hovered. Nothing compared the two numbers.
 *
 * Each entry is one seat, and the two halves are derived from it:
 *
 *   surface Y (build.ts) = hip - HIP_LIFT - thickness / 2
 *   pose (anim.ts)       = hip, thigh, knee
 *
 * `hip`/`thigh`/`knee` were solved against the actual rig — sampled, not guessed —
 * so the feet land exactly on `footY` (0 = the floor). The self-test rebuilds the
 * avatar and asserts it, which is the check that was missing.
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
export const PARAPET_H = 0.55
export const PARAPET_T = 0.34
export const ROOF_DECK_T = 0.22
export const ROOF_BAY_D = 4.2
export const ROOF_BAY = {
  x1: -HALF_W,
  x2: HALF_W,
  z1: HALF_D - ROOF_BAY_D,
  z2: HALF_D,
}
export const CEILING_Y = WALL_H
export const BOARD_REVEAL = 0.35
/**
 * Kanban board MELENGKUNG mengikuti dinding aula: chord datar di sisi utara
 * aula (z=-8.35), lebar 8, pusat x=0. build.ts menggambar 5 panel segi
 * mengikuti busur r=4.7; footprint = 3 box aproksimasi.
 */
export const KANBAN_BOARD = {
  x: 0,
  y: (CEILING_Y - BOARD_REVEAL * 2) / 2 + BOARD_REVEAL,
  z: -7.3,
  w: 5.6,
  h: Math.min(5.6 * 0.62, CEILING_Y - BOARD_REVEAL * 2),
}
export const BOARD_COLUMNS = ['TODO', 'JALAN', 'REVIEW', 'SELESAI'] as const

/** Meja bundar di pusat aula (ganti conference kotak di meeting room). */
export const CONFERENCE = { x: 0, z: -4, radius: 1.8 }
export const CONFERENCE_CHAIRS = {
  count: 6,
  offset: 0,
  ring: CONFERENCE.radius + 1.0,
}

/**
 * 4 pods divisi melengkung mengelilingi aula (zona bbox utk SpriteOffice):
 * exec NW, tech W, growth NE, content E.
 */
export const DIV_ROOMS = {
  exec: { x1: -8.0, x2: -3.0, z1: -11.0, z2: -6.5 },
  tech: { x1: -11.0, x2: -5.0, z1: -6.5, z2: 0.5 },
  growth: { x1: 5.0, x2: 11.0, z1: -8.0, z2: -1.0 },
  content: { x1: 3.0, x2: 11.0, z1: -1.0, z2: 3.0 },
} as const

export type DivisionRoomKey = keyof typeof DIV_ROOMS

/** Papan nama tiap ruang (teks + posisi di atas pintu). */
export const ROOM_SIGNS: { text: string; x: number; z: number }[] = [
  { text: 'EXEC', x: -3.2, z: -6.0 },
  { text: 'TECH', x: -6.0, z: -2.2 },
  { text: 'GROWTH', x: 6.5, z: -3.2 },
  { text: 'CONTENT', x: 6.5, z: 1.8 },
  { text: 'AULA', x: 0, z: 0.8 },
  { text: 'LOUNGE + POOL', x: -9.0, z: 3.7 },
]

export const LOUNGE = { x: -11.0, z: 8.0 }
export const DART = { x: -16.5, z: -9.4 }
export const DOOR = { x: 0, z: HALF_D - WALL_T }

/**
 * Kolam renang ORGANIK (ginjal) di area santai SE dalam gedung (9,6).
 * Aproksimasi: 3 box (lobus kiri, tengah, lobus kanan yg digeser).
 */
export const POOL = {
  x: 9,
  z: 6,
  w: 5.0,
  d: 3.4,
  waterY: 0.06,
  deckW: 7.0,
  deckD: 5.0,
  organic: true as const,
}
/** Kursi santai melengkung di sisi barat kolam (menghadap air, +X). */
export const POOL_LOUNGERS: { x: number; z: number; facing: number }[] = [
  { x: 5.2, z: 4.6, facing: Math.PI / 2 },
  { x: 5.0, z: 6.0, facing: Math.PI / 2 },
  { x: 5.2, z: 7.4, facing: Math.PI / 2 },
]
export const POOL_GATE = { x: 5.8, z: 6.0, width: 1.2 }
/** Pintu lounge barat menuju kolam sudah dalam gedung — tak perlu pintu luar. */
export const POOL_DOOR = { z: 6.0, width: 2.0 } as const

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
/**
 * The green corner sat at z = -11.6, which is behind the TV unit (TV at z = -9.5)
 * — an agent assigned there stood with its back to a screen, in a corner nobody
 * can see. Moved to the lounge's east wall, beside the side glazing.
 */
export const GARDEN = { x: 13.5, z: -6.6 }
export const BOOK_NOOK = { x: -13.5, z: 8.0 }
export const PANTRY = { x: -6.0, z: 8.5 }
/** Stools at the pantry counter, where the coffee activity plays. */
export const PANTRY_STOOLS = [-6.8, -5.2] as const
/** Distance from the counter centre out to the stool centre. */
export const PANTRY_STOOL_GAP = 0.72
/** Reception counter: faces the entrance (+z), staff chair behind it (-z). */
export const RECEPTION = { x: -4.0, z: 10.4 }

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
const northGroup = (centres: number[], w: number) =>
  centres.map((x) => ({ x, y: WINDOW_Y, w, h: WINDOW_H }))

/** Utara: board pindah ke aula, jadi 5 jendela penuh (-13..13, pitch 5.2). */
export const NORTH_WINDOWS = [...northGroup([-13.0, -7.8, -2.6, 2.6, 7.8, 13.0], 2.6)]

export const SOUTH_WINDOWS = [
  ...northGroup([-15.8, -12.0, -9.0, -5.2], 2.2),
  ...northGroup([5.2, 9.0, 12.0, 15.8], 2.2),
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
  // Side windows sit at world z = the listed offset, because build.ts negates the
  // same values when cutting the holes. Keeping both sides in agreement is the
  // point: when they disagreed, the checker passed and the wall was wrong.
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
  // World placement comes from paintingPlacement() — the single function that
  // knows how `along` maps to world space. Deriving it here by hand is what let
  // this checker report "0 conflicts" while two paintings sat on a window: the
  // hand-rolled version used the wall CENTRE while the real placement uses the
  // wall's START, so the two disagreed by a whole offset.
  const art = PAINTINGS.map((p, i) => {
    const at = paintingPlacement(p)
    return {
      id: `art${i}`,
      x: at.frame.x,
      z: at.frame.z,
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
/** `along` is an offset along the wall's tangent, measured from `wall.from`. */
export type PaintingSpec = { wall: WallFace; along: number; y: number; w: number; h: number }

/**
 * Every `WallFace` carries the wall's real extent (`from`/`to` along the tangent),
 * because the painting list is only as correct as this geometry. Getting it wrong
 * is how four of eight paintings ended up hanging in mid-air: the lobby walls were
 * declared as a 12 m span centred on z=6 (i.e. 0..12) when the partition actually
 * runs from the room boundary to the inside of the south wall.
 *
 * `wallFace()` derives the extent from the room constants, so it cannot drift.
 */
export type WallFace = {
  x: number
  z: number
  ry: number
  /** Wall centre along the tangent axis (for reference only). */
  span: number
  along: 'x' | 'z'
  /** Extent along the tangent, in world coordinates. */
  from: number
  to: number
}

/**
 * Build a wall face from its WORLD extent (`lo`..`hi`), converting to tangent
 * coordinates.
 *
 * This conversion is the whole point. For `ry = +PI/2` the tangent points toward
 * -Z (tz = -sin(ry) = -1), so a wall occupying world z 3.4..12.7 has tangent
 * coordinates -6.7..2.6, not 3.4..12.7. Storing world bounds here while
 * `paintingPlacement` adds `along` in tangent space put half the artwork outside
 * its wall — and the self-test agreed, because it compared the same two wrong
 * numbers against each other.
 */
const wallFace = (
  x: number,
  z: number,
  ry: number,
  along: 'x' | 'z',
  lo: number,
  hi: number,
): WallFace => {
  const t = along === 'z' ? -Math.sin(ry) : Math.cos(ry)
  const centre = along === 'z' ? z : x
  // tangent = (world - centre) / t  when t > 0, reversed when t < 0
  const a = (lo - centre) * t
  const b = (hi - centre) * t
  return { x, z, ry, along, from: Math.min(a, b), to: Math.max(a, b), span: Math.abs(b - a) }
}

// Dinding lengkung digambar sbg busur box di build.ts; lukisan di dinding LUAR.
const WEST_OUT = wallFace(-HALF_W, 0, Math.PI / 2, 'z', -HALF_D + WALL_T, HALF_D - WALL_T)
const EAST_OUT = wallFace(HALF_W, 0, -Math.PI / 2, 'z', -HALF_D + WALL_T, HALF_D - WALL_T)

/**
 * World Z of a point `along` the lobby side walls.
 *
 * The two walls have OPPOSITE tangent directions (ry = ±PI/2), so the same
 * `along` value lands on mirrored positions. Writing the offsets by eye is what
 * put paintings on windows on one side only; this makes the world position the
 * input instead.
 */
export function lobbySideZ(wall: WallFace, along: number): number {
  const tz = -Math.sin(wall.ry)
  return wall.z + tz * along
}

/**
 * The `along` offset that puts a piece of art at world Z `z` on a side wall.
 *
 * Two conversions, and getting either one wrong is silent:
 *   1. world Z -> absolute tangent  =  (z - wall.z) / tz
 *   2. absolute tangent -> `along`  =  tangent - wall.from
 *
 * `paintingPlacement()` adds `along` to `wall.from`, so skipping step 2 lands the
 * art a whole wall-length away — which is exactly what happened, and why the
 * paintings appeared to be on walls they were nowhere near.
 */
export function lobbyAlongForWorldZ(wall: WallFace, z: number): number {
  const tz = -Math.sin(wall.ry)
  return (z - wall.z) / tz - wall.from
}
// NORTH is unused by the artwork list (that elevation is fully glazed) but kept so
// the helper is exercised on the X axis too.
void wallFace(0, -HALF_D, 0, 'x', -HALF_W, HALF_W)

/** Facing an inward normal: `ry` is 0 for a frame facing +Z, ±PI/2 for ±X. */
export const PAINTINGS: PaintingSpec[] = [
  { wall: WEST_OUT, along: lobbyAlongForWorldZ(WEST_OUT, -4.45), y: 1.9, w: 1.5, h: 1.1 },
  { wall: WEST_OUT, along: lobbyAlongForWorldZ(WEST_OUT, 0.0), y: 1.9, w: 1.1, h: 1.4 },
  { wall: EAST_OUT, along: lobbyAlongForWorldZ(EAST_OUT, -4.45), y: 1.9, w: 1.5, h: 1.1 },
  { wall: EAST_OUT, along: lobbyAlongForWorldZ(EAST_OUT, 0.0), y: 1.9, w: 1.1, h: 1.4 },
  { wall: WEST_OUT, along: lobbyAlongForWorldZ(WEST_OUT, 4.55), y: 1.95, w: 1.3, h: 1.7 },
  { wall: EAST_OUT, along: lobbyAlongForWorldZ(EAST_OUT, 9.05), y: 1.95, w: 1.3, h: 1.7 },
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

/**
 * Convert an absolute position ALONG a wall (tangent coordinates, the same space
 * as `wall.from`/`wall.to`) into the `along` offset that `paintingPlacement()`
 * expects. Using this instead of hand-arithmetic is what keeps the list readable:
 * `alongFor(WALL, 4.5)` says "4.5 units along the wall" without the caller needing
 * to know whether the tangent points toward +Z or -Z.
 */
export function alongFor(wall: WallFace, tangent: number): number {
  return tangent - wall.from
}

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

  // `along` is measured from the wall's start, so the tangent coordinate is
  // from + along. The previous version added it to the wall's CENTRE, which put
  // art past the end of short walls.
  const tangent = wall.from + along
  const at = (out: number) => ({
    x: wall.x + nx * out + tx * tangent,
    z: wall.z + nz * out + tz * tangent,
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

/** Every solid placed in build.ts. Kurva didekati box kecil (aproksimasi). */
export const FOOTPRINTS: Footprint[] = [
  // ---- outer walls (as four slabs)
  fp('wall-n', 0, -HALF_D, HALF_W, WALL_T / 2, WALL_H, 'wall'),
  fp('wall-s', 0, HALF_D, HALF_W, WALL_T / 2, WALL_H, 'wall'),
  fp('wall-w', -HALF_W, 0, WALL_T / 2, HALF_D, WALL_H, 'wall'),
  fp('wall-e', HALF_W, 0, WALL_T / 2, HALF_D, WALL_H, 'wall'),

  // ---- dinding AULA oval (0,-4) r=4.5: 16 segmen, 4 celah (N/E/S/W)
  ...(() => {
    const out: Footprint[] = []
    const cx = 0, cz = -4, r = 4.5, n = 16
    const gaps = [Math.PI, Math.PI / 2, 0, -Math.PI / 2]
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      if (gaps.some((g) => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.22)) continue
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      const seg = (2 * Math.PI * r) / n
      const alongX = Math.abs(Math.sin(a)) > Math.abs(Math.cos(a))
      out.push(fp(`aula-w${i}`, x, z, alongX ? seg / 2 : 0.12, alongX ? 0.12 : seg / 2, WALL_H, 'wall'))
    }
    return out
  })(),

  // ---- sekat pods melengkung (busur pendek, box kecil)
  ...(() => {
    const out: Footprint[] = []
    const arc = (id: string, cx: number, cz: number, r: number, a0: number, a1: number, k: number) => {
      for (let i = 0; i < k; i++) {
        const a = a0 + ((a1 - a0) * (i + 0.5)) / k
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
        out.push(fp(`${id}${i}`, x, z, 0.55, 0.12, 2.2, 'wall'))
      }
    }
    arc('sek-exec-', -5.5, -9.5, 2.6, Math.PI * 0.9, Math.PI * 1.7, 3)
    arc('sek-tech-', -9.0, -4.0, 2.6, Math.PI * 0.4, Math.PI * 1.1, 3)
    arc('sek-growth-', 9.0, -4.5, 2.6, -Math.PI * 0.6, Math.PI * 0.3, 3)
    arc('sek-content-', 10.5, 0.0, 2.2, -Math.PI * 0.3, Math.PI * 0.45, 3)
    return out
  })(),

  // ---- desks: 1.7 x 1.0 tops, plus chair
  ...DESKS.flatMap((d) => {
    const s = Math.sin(d.facing)
    const c = Math.cos(d.facing)
    const chair = { x: d.x + DESK_CHAIR.z * s, z: d.z + DESK_CHAIR.z * c }
    return [
      fp(`desk-${d.index}`, d.x, d.z, 0.85, 0.5, 0.72, 'desk'),
      fp(`chair-${d.index}`, chair.x, chair.z, 0.32, 0.32, 0.5, 'seat'),
    ]
  }),

  // ---- board melengkung: 3 box aproksimasi di chord z=-8.35
  fp('board-c', 0, -7.3, 1.05, 0.15, 2.6, 'prop'),
  fp('board-l', -2.05, -7.1, 0.95, 0.15, 2.6, 'prop'),
  fp('board-r', 2.05, -7.1, 0.95, 0.15, 2.6, 'prop'),

  // ---- meja bundar aula + 6 kursi
  fp('conf-table', CONFERENCE.x, CONFERENCE.z, CONFERENCE.radius, CONFERENCE.radius, 0.72, 'desk'),
  ...Array.from({ length: CONFERENCE_CHAIRS.count }, (_, i) => {
    const a = CONFERENCE_CHAIRS.offset + (i / CONFERENCE_CHAIRS.count) * Math.PI * 2
    return fp(
      `conf-chair-${i}`,
      CONFERENCE.x + Math.cos(a) * CONFERENCE_CHAIRS.ring,
      CONFERENCE.z + Math.sin(a) * CONFERENCE_CHAIRS.ring,
      0.3, 0.3, 0.5, 'seat',
    )
  }),

  // ---- lounge SW: sofa melengkung (3 box) + meja + rak buku
  fp('sofa-a', LOUNGE.x - 1.6, LOUNGE.z - 0.4, 0.7, 0.5, 0.85, 'seat'),
  fp('sofa-b', LOUNGE.x, LOUNGE.z + 0.9, 0.7, 0.5, 0.85, 'seat'),
  fp('sofa-c', LOUNGE.x + 1.6, LOUNGE.z - 0.4, 0.7, 0.5, 0.85, 'seat'),
  fp('coffee-table', LOUNGE.x, LOUNGE.z - 1.2, 0.62, 0.62, 0.44, 'desk'),
  fp('book-shelf', BOOK_NOOK.x, BOOK_NOOK.z - 1.3, 1.3, 0.22, 2.0),
  fp('book-chair', BOOK_NOOK.x, BOOK_NOOK.z + 0.75, 0.5, 0.5, 0.85, 'seat'),
  fp('book-table', BOOK_NOOK.x - 1.15, BOOK_NOOK.z + 0.75, 0.32, 0.32, 0.5, 'desk'),

  // ---- garden + pantry + reception
  fp('garden-box', GARDEN.x, GARDEN.z, 0.28, 1.45, 0.55),
  fp('garden-pot-a', GARDEN.x, GARDEN.z - 2.0, 0.3, 0.3, 0.5),
  fp('garden-pot-b', GARDEN.x, GARDEN.z + 2.0, 0.3, 0.3, 0.5),
  fp('pantry', PANTRY.x, PANTRY.z, 1.25, 0.35, 0.95),
  ...PANTRY_STOOLS.map((sx, i) => fp(`stool-${i}`, sx, PANTRY.z + PANTRY_STOOL_GAP, 0.24, 0.24, 0.62, 'seat')),
  fp('doormat', 0, 11.8, 1.5, 0.7, 0, 'prop'),
  fp('reception', RECEPTION.x, RECEPTION.z, 1.6, 0.45, 1.05, 'desk'),
  fp('reception-chair', RECEPTION.x, RECEPTION.z - 1.15, 0.32, 0.32, 0.5, 'seat'),
  fp('coat-rack', -4.4, 12.0, 0.35, 0.35, 1.75),
  fp('lobby-plant-w', -2.8, 12.0, 0.4, 0.4, 1.1),
  fp('lobby-plant-e', 2.8, 12.0, 0.4, 0.4, 1.1),
  fp('lobby-planter-w', -15.6, 6.0, 0.5, 0.5, 1.1),
  fp('lobby-planter-e', 15.6, 6.0, 0.5, 0.5, 1.1),

  // ---- kolam GINJAL (9,6): 3 box organik + pagar lengkung pendek
  fp('pool-l', 7.6, 6.0, 1.3, 1.7, 0.5, 'prop'),
  fp('pool-c', 9.2, 6.2, 1.5, 1.4, 0.5, 'prop'),
  fp('pool-r', 10.8, 5.6, 1.1, 1.2, 0.5, 'prop'),
  fp('pool-fence-n', 8.4, 4.0, 2.0, 0.08, 1.0, 'prop'),
  fp('pool-fence-s', 9.0, 8.0, 2.6, 0.08, 1.0, 'prop'),
  ...POOL_LOUNGERS.map((l, i) => fp(`lounger-${i}`, l.x, l.z, 0.4, 0.4, 0.6, 'seat')),
]

/* ------------------------------------------------------------------ spots -- */

/**
 * Where an idle agent goes, and which way it faces on arrival.
 *
 * Each entry names a POSITION and the POSE that belongs there, and the prop at that
 * position exists in build.ts. `face` is the heading held once the agent arrives
 * (the avatar's forward is local +Z, so `atan2(dx, dz)` aims it at (dx, dz)).
 *
 * These live here rather than inside scene.ts because they are DATA that must agree
 * with the furniture, and the self-test needs to check that agreement. Two of them
 * were silently dead: one sat inside `floor-lamp`, another inside `lng-planter`, and
 * the filter that drops unreachable spots hid it — so only one agent could ever tend
 * the planter and the "by the water cooler" spot never existed at all.
 *
 * `seated: true` marks a spot ON a seat, which the collision check must allow.
 */
export type IdleSpot = {
  x: number
  z: number
  act: 'idle' | 'sofa' | 'dart' | 'garden' | 'read' | 'coffee'
  seated?: boolean
  face: number
}

export const IDLE_SPOTS: IdleSpot[] = [
  { x: LOUNGE.x, z: LOUNGE.z + 0.9, act: 'sofa', seated: true, face: 0 },
  { x: DART.x + 2.6, z: DART.z, act: 'dart', face: -Math.PI / 2 },
  { x: GARDEN.x - 0.95, z: GARDEN.z, act: 'garden', face: Math.PI / 2 },
  { x: GARDEN.x - 0.95, z: GARDEN.z + 0.5, act: 'garden', face: Math.PI / 2 },
  { x: BOOK_NOOK.x, z: BOOK_NOOK.z + 0.75, act: 'read', seated: true, face: Math.PI },
  { x: PANTRY_STOOLS[0], z: PANTRY.z + PANTRY_STOOL_GAP, act: 'coffee', seated: true, face: Math.PI },
  { x: PANTRY_STOOLS[1], z: PANTRY.z + PANTRY_STOOL_GAP, act: 'coffee', seated: true, face: Math.PI },
  { x: 5.2, z: 4.6, act: 'sofa', seated: true, face: Math.PI / 2 },
  { x: 5.0, z: 6.0, act: 'sofa', seated: true, face: Math.PI / 2 },
  { x: 5.2, z: 7.4, act: 'sofa', seated: true, face: Math.PI / 2 },
  { x: 12.5, z: 6.0, act: 'idle', face: -Math.PI / 2 },
  { x: 0, z: 2.2, act: 'idle', face: Math.PI },
  { x: -3.0, z: 4.6, act: 'idle', face: 0 },
  { x: 3.0, z: 4.6, act: 'idle', face: 0 },
  { x: 2.2, z: 10.4, act: 'idle', face: -Math.PI / 2 },
  { x: 0, z: -1.5, act: 'idle', face: 0 },
]

/** Doorway openings: celah aula (N/E/S/W) + pintu luar + lounge. */
export const OPENINGS: { x: number; z: number; hw: number; hd: number }[] = [
  { x: AULA_GAPS.north.x, z: AULA_GAPS.north.z, hw: 1.2, hd: 0.6 },
  { x: AULA_GAPS.east.x, z: AULA_GAPS.east.z, hw: 0.6, hd: 1.2 },
  { x: AULA_GAPS.south.x, z: AULA_GAPS.south.z, hw: 1.2, hd: 0.6 },
  { x: AULA_GAPS.west.x, z: AULA_GAPS.west.z, hw: 0.6, hd: 1.2 },
  { x: DOOR.x, z: DOOR.z, hw: 1.7, hd: 0.3 },
  { x: ROOM_DOORS.lounge.x, z: ROOMS.lounge.z1, hw: ROOM_DOORS.lounge.width / 2, hd: 0.3 },
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
    (f) => f.kind !== 'wall' && f.kind !== 'seat' && f.h > 0.05 && f.id !== 'doormat' && !f.id.startsWith('pool-'),
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
