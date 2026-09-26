/**
 * Walkable-space collision and pathfinding.
 *
 * Avatars used to walk straight through desks and sofas because movement was
 * plain "move toward the target". Two pieces fix that, and both read the same
 * footprint table the furniture is built from:
 *
 *   - `blocked()` is a point test against inflated prop boxes, so a walker with
 *     a radius can slide along a desk instead of entering it.
 *   - `route()` is A* over a uniform grid with corner-cut prevention. Every leg
 *     therefore bends around furniture instead of through it.
 *
 * The grid is coarse (0.5 m) on purpose: it is built once, it keeps A* cheap for
 * a handful of agents, and 0.5 m is finer than any doorway here.
 */
import {
  blockingFootprints,
  FLOOR,
  FOOTPRINTS,
  HALF_D,
  HALF_W,
  OPENINGS,
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

const solidWalls: Footprint[] = FOOTPRINTS.filter((f) => f.kind === 'wall')
const solidProps = blockingFootprints()

/** True when `p` lies inside a footprint inflated by `pad`. */
function inside(f: Footprint, x: number, z: number, pad: number) {
  return Math.abs(x - f.x) < f.hw + pad && Math.abs(z - f.z) < f.hd + pad
}

/** An opening cuts a wall for anything strictly inside it. */
function inOpening(x: number, z: number, pad: number) {
  return OPENINGS.some((o) => Math.abs(x - o.x) < o.hw - pad && Math.abs(z - o.z) < o.hd + 0.6)
}

/**
 * Point test used by the mover. `pad` is the body radius, so callers get
 * "would my centre at (x,z) put my body inside something".
 *
 * `opts.allowSeat` ignores chair/sofa footprints. Walking must respect them (you
 * cannot walk through a sofa) but a SEATED IDLE SPOT is by definition ON a seat,
 * so validating those with seats solid discarded every sit-down spot — including
 * the `sofa` spot that had been silently absent long before this change.
 */
export function blocked(
  x: number,
  z: number,
  pad = BODY_R,
  opts: { allowSeat?: boolean } = {},
): boolean {
  // Outside the building. Kept inside the wall line (not the wall centre) so the
  // walkable band matches the room the avatar can actually see.
  if (Math.abs(x) > HALF_W - WALL_T - BODY_R * 0.5 || Math.abs(z) > HALF_D - WALL_T - BODY_R * 0.5) return true
  for (const w of solidWalls) {
    if (inside(w, x, z, pad) && !inOpening(x, z, pad)) return true
  }
  for (const p of solidProps) {
    if (opts.allowSeat && p.kind === 'seat') continue
    if (inside(p, x, z, pad)) return true
  }
  return false
}

/* ------------------------------------------------------------------- grid -- */

const walkable = new Uint8Array(COLS * ROWS)

function buildGrid() {
  for (let cz = 0; cz < ROWS; cz++) {
    for (let cx = 0; cx < COLS; cx++) {
      const ok = blocked(worldX(cx), worldZ(cz), BODY_R) ? 0 : 1
      walkable[cz * COLS + cx] = ok
    }
  }
}
buildGrid()

/** True when the cell is free. Diagonal moves additionally require both orthogonal neighbours. */
function free(cx: number, cz: number) {
  if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS) return false
  return walkable[cz * COLS + cx] === 1
}

/**
 * Nearest free cell to a grid coordinate, searched in expanding rings.
 * Targets frequently land on a chair or inside a desk footprint (the seat of a
 * chair IS inside one), so a route has to snap to the closest standing room.
 */
function nearestFree(cx: number, cz: number, maxRings = 14): [number, number] | null {
  if (free(cx, cz)) return [cx, cz]
  for (let r = 1; r <= maxRings; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (free(cx + dx, cz + dz)) return [cx + dx, cz + dz]
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

/**
 * A* between two world points. Returns waypoints in world space, or an empty
 * array when no route exists (caller then falls back to a straight line so an
 * agent never freezes in place).
 */
export function route(
  from: { x: number; z: number },
  to: { x: number; z: number },
): { x: number; z: number }[] {
  const start = nearestFree(gridX(from.x), gridZ(from.z))
  const goal = nearestFree(gridX(to.x), gridZ(to.z))
  if (!start || !goal) return []
  if (start[0] === goal[0] && start[1] === goal[1]) return [{ x: to.x, z: to.z }]

  const n = COLS * ROWS
  const g = new Float32Array(n).fill(Infinity)
  const f = new Float32Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const idx = (cx: number, cz: number) => cz * COLS + cx

  const goalI = idx(goal[0], goal[1])
  const h = (cx: number, cz: number) =>
    Math.hypot(cx - goal[0], cz - goal[1]) * 1.0001 // tiny tie-break

  const startI = idx(start[0], start[1])
  g[startI] = 0
  f[startI] = h(start[0], start[1])

  // binary heap keyed on f
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
      if (!free(nx, nz)) continue
      // no cutting: both orthogonal neighbours must be free for a diagonal
      if (dx !== 0 && dz !== 0 && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue
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

  // walk back
  const cells: number[] = []
  for (let c = goalI; c !== -1 && cells.length < 4000; c = prev[c]) {
    cells.push(c)
    if (c === startI) break
  }
  if (cells[cells.length - 1] !== startI) return []
  cells.reverse()

  // collapse collinear runs, then append the true destination
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
  // snap the final waypoint onto the real target
  pts[pts.length - 1] = { x: to.x, z: to.z }
  return pts
}

/** Exposed for the self-check and for debugging the nav grid. */
