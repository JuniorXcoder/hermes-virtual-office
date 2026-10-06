/**
 * Walkable-space collision and pathfinding, now LEVEL-AWARE.
 *
 * The building is split level: the ground floor holds the lobby, the three
 * division rooms, the pantry and the leisure room; the first floor holds the CEO
 * suite and the five meeting rooms. A walker therefore has a LEVEL as well as a
 * position, and the two floors must not leak into each other:
 *
 *   - each level has its own grid, built from the footprints whose `level` matches,
 *   - the first floor only exists over the north bar, so stepping off it anywhere
 *     else is void, not floor,
 *   - the stair shaft is the ONE place both grids are walkable at the same x/z, so
 *     `routeBetween()` can hand a walker from one floor to the other.
 *
 * The grid is coarse (0.5 m) on purpose: it is built once per level, it keeps A*
 * cheap for a handful of agents, and 0.5 m is finer than any doorway here.
 */
import {
  blockingFootprints,
  FLOOR,
  FOOTPRINTS,
  HALF_D,
  HALF_W,
  LEVEL_BOUNDS,
  OPENINGS,
  STAIR_FLIGHT_TOP,
  STAIR_FOOT,
  STAIR_TOP,
  STAIRS,
  WALL_T,
  type Footprint,
} from './layout'

/** Walkable grid resolution in metres. */
export const CELL = 0.5

/** Body radius used for both collision and grid inflation. */
export const BODY_R = 0.34

const COLS = Math.ceil(FLOOR.width / CELL)
const ROWS = Math.ceil(FLOOR.depth / CELL)

/** Grid coordinate -> world. */
export const worldX = (cx: number) => -HALF_W + (cx + 0.5) * CELL
export const worldZ = (cz: number) => -HALF_D + (cz + 0.5) * CELL
export const gridX = (x: number) => Math.floor((x + HALF_W) / CELL)
export const gridZ = (z: number) => Math.floor((z + HALF_D) / CELL)

export type Level = 0 | 1

const wallsAt = (level: Level): Footprint[] => FOOTPRINTS.filter((f) => f.kind === 'wall' && f.level === level)
const propsAt = (level: Level): Footprint[] =>
  blockingFootprints().filter((f) => f.level === level)

const wallsByLevel: Record<Level, Footprint[]> = { 0: wallsAt(0), 1: wallsAt(1) }
const propsByLevel: Record<Level, Footprint[]> = { 0: propsAt(0), 1: propsAt(1) }

/** True when `p` lies inside a footprint inflated by `pad`. */
function inside(f: Footprint, x: number, z: number, pad: number) {
  return Math.abs(x - f.x) < f.hw + pad && Math.abs(z - f.z) < f.hd + pad
}

/** An opening cuts a wall for anything strictly inside it, on its own level. */
function inOpening(x: number, z: number, pad: number, level: Level) {
  return OPENINGS.some(
    (o) => o.level === level && Math.abs(x - o.x) < o.hw - pad && Math.abs(z - o.z) < o.hd + 0.6,
  )
}

/**
 * The stair is a real object in the courtyard, not a hole in the floor.
 *
 * That changes the portal completely. There is no longer one region that is
 * walkable on both levels; there is a FOOT on the ground and a TOP on the first
 * floor, and they are different places. `nav.ts` therefore:
 *
 *   - blocks the flight itself on level 0 (you cannot walk through a stair),
 *   - keeps the flat landing at the top walkable on level 1,
 *   - hands a walker over between STAIR_FOOT and STAIR_TOP.
 *
 * Z runs south→north as it DECREASES: z2 (-3.2) is the courtyard foot, z1 (-9.7)
 * is the top tucked inside the building line, and STAIR_FLIGHT_TOP (-8.7) is where
 * the ramp stops and the flat landing starts.
 */
export function onStairFlight(x: number, z: number): boolean {
  return (
    x > STAIRS.x1 - 0.15 &&
    x < STAIRS.x2 + 0.15 &&
    z < STAIRS.z2 &&
    z > STAIR_FLIGHT_TOP
  )
}

/** The flat landing at the top of the flight, walkable on the first floor. */
export function onStairLanding(x: number, z: number): boolean {
  return (
    x > STAIRS.x1 - 0.15 &&
    x < STAIRS.x2 + 0.15 &&
    z <= STAIR_FLIGHT_TOP &&
    z > STAIRS.z1 - 0.4
  )
}

/** Kept for callers that just need the stair's x/z centre. */
export const stairCentre = STAIR_FOOT

/**
 * The stair's whole footprint, foot to landing.
 *
 * The mover uses this to decide "this body is walking the stair right now", which
 * lets it through the flight it would otherwise collide with. A* never routes
 * anyone through the flight (the grid marks it solid), so only a body that was
 * explicitly sent up or down the stair can ever be inside this box.
 */
export function onStairArea(x: number, z: number): boolean {
  return (
    x > STAIRS.x1 - 0.3 &&
    x < STAIRS.x2 + 0.3 &&
    z <= STAIRS.z2 + 0.35 &&
    z >= STAIRS.z1 - 0.45
  )
}

/**
 * Point test used by the mover. `pad` is the body radius, so callers get
 * "would my centre at (x,z) put my body inside something".
 *
 * `opts.allowSeat` ignores chair/sofa footprints: a SEATED IDLE SPOT is by
 * definition ON a seat, so validating those with seats solid discarded every
 * sit-down spot.
 */
export function blocked(
  x: number,
  z: number,
  pad = BODY_R,
  opts: { allowSeat?: boolean; level?: Level; onStair?: boolean } = {},
): boolean {
  const level: Level = opts.level ?? 0
  const b = LEVEL_BOUNDS[level]
  // Outside this level's floor plate. Kept inside the wall line (not the wall
  // centre) so the walkable band matches the room the avatar can actually see.
  if (
    x < b.x1 + WALL_T + BODY_R * 0.5 ||
    x > b.x2 - WALL_T - BODY_R * 0.5 ||
    z < b.z1 + WALL_T + BODY_R * 0.5 ||
    z > b.z2 - WALL_T - BODY_R * 0.5
  ) {
    return true
  }
  // The stair is a real object standing in the courtyard. You cannot walk through
  // the flight on the ground floor — it is a solid ramp. The flat LANDING at its
  // top, however, IS floor on level 1: that is where you step off.
  //
  // `opts.onStair` is set by the mover while a body is mid-climb: the flight is
  // solid for everyone else (you cannot shortcut through a stair), but the body
  // walking it must not collide with the very ramp it is standing on.
  if (onStairFlight(x, z) && !opts.onStair) return true
  if (level === 1 && onStairLanding(x, z)) return false

  for (const w of wallsByLevel[level]) {
    if (inside(w, x, z, pad) && !inOpening(x, z, pad, level)) return true
  }
  for (const p of propsByLevel[level]) {
    if (opts.allowSeat && p.kind === 'seat') continue
    if (inside(p, x, z, pad)) return true
  }
  return false
}

/* ------------------------------------------------------------------- grid -- */

const walkable: Record<Level, Uint8Array> = {
  0: new Uint8Array(COLS * ROWS),
  1: new Uint8Array(COLS * ROWS),
}

function buildGrid() {
  for (const level of [0, 1] as Level[]) {
    for (let cz = 0; cz < ROWS; cz++) {
      for (let cx = 0; cx < COLS; cx++) {
        const ok = blocked(worldX(cx), worldZ(cz), BODY_R, { level }) ? 0 : 1
        walkable[level][cz * COLS + cx] = ok
      }
    }
  }
}
buildGrid()

/** True when the cell is free on this level. */
function free(cx: number, cz: number, level: Level) {
  if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS) return false
  return walkable[level][cz * COLS + cx] === 1
}

/**
 * Nearest free cell to a grid coordinate, searched in expanding rings.
 * Targets frequently land on a chair or inside a desk footprint (the seat of a
 * chair IS inside one), so a route has to snap to the closest standing room.
 */
function nearestFree(cx: number, cz: number, level: Level, maxRings = 14): [number, number] | null {
  if (free(cx, cz, level)) return [cx, cz]
  for (let r = 1; r <= maxRings; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (free(cx + dx, cz + dz, level)) return [cx + dx, cz + dz]
      }
    }
  }
  return null
}

/** 8-way step table with corner-cut prevention. */
const STEPS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/** A* on ONE level. Returns [] when no route exists. */
function routeOnLevel(
  from: { x: number; z: number },
  to: { x: number; z: number },
  level: Level,
): { x: number; z: number }[] {
  const start = nearestFree(gridX(from.x), gridZ(from.z), level)
  const goal = nearestFree(gridX(to.x), gridZ(to.z), level)
  if (!start || !goal) return []
  if (start[0] === goal[0] && start[1] === goal[1]) return [{ x: to.x, z: to.z }]

  const n = COLS * ROWS
  const g = new Float32Array(n).fill(Infinity)
  const f = new Float32Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const idx = (cx: number, cz: number) => cz * COLS + cx

  const goalI = idx(goal[0], goal[1])
  const h = (cx: number, cz: number) => Math.hypot(cx - goal[0], cz - goal[1]) * 1.0001

  const startI = idx(start[0], start[1])
  g[startI] = 0
  f[startI] = h(start[0], start[1])

  const heap: number[] = [startI]
  const push = (i: number) => {
    heap.push(i)
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (f[heap[p]] <= f[heap[c]]) break
      ;[heap[p], heap[c]] = [heap[c], heap[p]]
      c = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let p = 0
      for (;;) {
        const l = 2 * p + 1
        const r = l + 1
        let m = p
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r
        if (m === p) break
        ;[heap[p], heap[m]] = [heap[m], heap[p]]
        p = m
      }
    }
    return top
  }

  let guard = 0
  const MAX_EXPAND = 24000
  while (heap.length && guard++ < MAX_EXPAND) {
    const cur = pop()
    if (cur === goalI) break
    if (closed[cur]) continue
    closed[cur] = 1
    const cx = cur % COLS
    const cz = (cur - cx) / COLS
    for (const [dx, dz] of STEPS) {
      const nx = cx + dx
      const nz = cz + dz
      if (!free(nx, nz, level)) continue
      if (dx !== 0 && dz !== 0 && (!free(cx + dx, cz, level) || !free(cx, cz + dz, level))) continue
      const ni = idx(nx, nz)
      if (closed[ni]) continue
      const step = dx !== 0 && dz !== 0 ? 1.4142 : 1
      const ng = g[cur] + step
      if (ng < g[ni]) {
        g[ni] = ng
        f[ni] = ng + h(nx, nz)
        prev[ni] = cur
        push(ni)
      }
    }
  }

  if (prev[goalI] === -1 && goalI !== startI) return []

  const cells: number[] = []
  for (let c = goalI; c !== -1 && cells.length < 4000; c = prev[c]) {
    cells.push(c)
    if (c === startI) break
  }
  if (cells[cells.length - 1] !== startI) return []
  cells.reverse()

  const pts: { x: number; z: number }[] = []
  const dir = (a: number, b: number) => {
    const ax = a % COLS
    const az = (a - ax) / COLS
    const bx = b % COLS
    const bz = (b - bx) / COLS
    return `${Math.sign(bx - ax)},${Math.sign(bz - az)}`
  }
  for (let i = 0; i < cells.length; i++) {
    const isCorner = i === 0 || i === cells.length - 1 || dir(cells[i - 1], cells[i]) !== dir(cells[i], cells[i + 1])
    if (!isCorner) continue
    const cx = cells[i] % COLS
    const cz = (cells[i] - cx) / COLS
    pts.push({ x: worldX(cx), z: worldZ(cz) })
  }
  pts[pts.length - 1] = { x: to.x, z: to.z }
  return pts
}

/**
 * A* between two world points ON THE SAME LEVEL. Kept for callers that already
 * know their level (the sprite view, the self-test). Returns an empty array when
 * no route exists — the caller then falls back to a straight line so an agent
 * never freezes in place.
 */
export function route(
  from: { x: number; z: number },
  to: { x: number; z: number },
  level: Level = 0,
): { x: number; z: number }[] {
  return routeOnLevel(from, to, level)
}

export type Waypoint = { x: number; z: number; level: Level }

/**
 * A* ACROSS levels, via the stair shaft.
 *
 * Same level: one route. Different levels: walk to the stair on the current floor,
 * climb (the shaft is walkable on both grids, so this is the hand-off), then walk
 * from the stair to the destination on the other floor. The stair waypoint is
 * emitted twice with different levels, which is what tells the mover to climb.
 */
export function routeBetween(
  from: { x: number; z: number; level: Level },
  to: { x: number; z: number; level: Level },
): Waypoint[] {
  if (from.level === to.level) {
    return routeOnLevel(from, to, from.level).map((p) => ({ ...p, level: from.level }))
  }
  // The stair is an OBJECT, so the two ends are different places. BOTH directions
  // hand over at the LANDING (the top), and both walk the flight at LEVEL 0 — where
  // the ramp height function lives. Switching at the foot instead stranded a
  // descending body: at level 1 it cannot step south past the floor edge (z=-9.47),
  // so it could never reach the flight.
  //
  //   up   : approach the FOOT on the ground → climb the ramp → switch → leave the
  //          landing upstairs
  //   down : approach the LANDING upstairs → switch → descend the ramp → leave the
  //          foot on the ground
  const up = from.level === 0
  const toStair = up ? routeOnLevel(from, STAIR_FOOT, 0) : routeOnLevel(from, STAIR_TOP, 1)
  const fromStair = up ? routeOnLevel(STAIR_TOP, to, 1) : routeOnLevel(STAIR_FOOT, to, 0)
  if (!toStair.length || !fromStair.length) return []
  if (up) {
    return [
      ...toStair.map((p) => ({ ...p, level: 0 as const })),
      // The hand-off. The mover climbs the ramp on the way here (it is still on
      // level 0), then switches floors on arrival.
      { x: STAIR_TOP.x, z: STAIR_TOP.z, level: 1 as const },
      ...fromStair.map((p) => ({ ...p, level: 1 as const })),
    ]
  }
  return [
    ...toStair.map((p) => ({ ...p, level: 1 as const })),
    // Switch at the landing, then walk DOWN the flight, which is a level-0 walk.
    { x: STAIR_TOP.x, z: STAIR_TOP.z, level: 0 as const },
    { x: STAIR_FOOT.x, z: STAIR_FOOT.z, level: 0 as const },
    ...fromStair.map((p) => ({ ...p, level: 0 as const })),
  ]
}

/** Exposed for the self-check and for debugging the nav grid. */
export const NAV_DEBUG = { COLS, ROWS, walkable }
