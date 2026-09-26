/**
 * Invariant self-test.
 *
 * These are the checks that caught real bugs in this codebase — a board 0.9 m
 * through the floor, 13.6 m of board inside a 12 m room, window cut-outs above
 * the wall line, paintings buried inside walls, idle spots dropped without
 * notice. Every one of them was a MEASURABLE contradiction between two numbers
 * that nobody had compared, so they are assertions now rather than screenshots.
 *
 * Run: npm run selftest
 */
import {
  CEILING_Y,
  FOOTPRINTS,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  PAINTINGS,
  ROOMS,
  WALL_H,
  WALL_T,
  WINDOW_H,
  WINDOW_Y,
  SIDE_WINDOWS,
  SIDE_WINDOW_W,
  facadeConflicts,
  paintingPlacement,
  windowPlan,
} from '../src/lib/office/layout'
import { BODY_R, blocked } from '../src/lib/office/nav'

let failures = 0
let checks = 0

function check(label: string, ok: boolean, detail = '') {
  checks++
  if (ok) {
    console.log(`  ok    ${label}${detail ? '  — ' + detail : ''}`)
  } else {
    failures++
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`)
  }
}

const f2 = (n: number) => n.toFixed(2)

console.log('\nhermes-virtual-office — invariant self-test\n')

/* ---------------------------------------------------------------- geometry -- */
console.log('geometry')

// The board must fit the surface it hangs on AND the room it is in.
{
  const left = KANBAN_BOARD.x - KANBAN_BOARD.w / 2
  const right = KANBAN_BOARD.x + KANBAN_BOARD.w / 2
  const bottom = KANBAN_BOARD.y - KANBAN_BOARD.h / 2
  const top = KANBAN_BOARD.y + KANBAN_BOARD.h / 2
  check(
    'kanban board is inside the work bay (not through the partitions)',
    left > ROOMS.work.x1 && right < ROOMS.work.x2,
    `x ${f2(left)}..${f2(right)} vs room ${ROOMS.work.x1}..${ROOMS.work.x2}`,
  )
  check(
    'kanban board is above the floor and below the ceiling',
    bottom > 0 && top < CEILING_Y,
    `y ${f2(bottom)}..${f2(top)} vs ceiling ${CEILING_Y}`,
  )
}

// Every window cut-out must lie within its wall, or the wall is cut in two.
{
  const wins = windowPlan()
  const outside = wins.filter((w) => w.y - w.h / 2 <= 0 || w.y + w.h / 2 >= WALL_H)
  check('all window cut-outs fall inside the wall as built', outside.length === 0, `${wins.length} openings`)
}

// Openings and artwork share wall planes; nothing may overlap.
{
  const conflicts = facadeConflicts()
  check('no facade conflicts (window/window, window/art, window/board)', conflicts.length === 0,
    conflicts.length ? conflicts.map((c) => `${c.a}<->${c.b}`).join(', ') : '0 conflicts')
}

// A frame centred on the wall's coordinate would be buried inside the wall.
{
  const buried = PAINTINGS.filter((p) => {
    const at = paintingPlacement(p)
    return Math.hypot(at.frame.x - p.wall.x, at.frame.z - p.wall.z) <= WALL_T / 2
  })
  check('no artwork buried inside a wall', buried.length === 0, `${PAINTINGS.length} pieces`)
}

// Artwork must fit the wall it names AND land in the room, not outside it.
//
// The first version of this check compared `wall.from + along` against
// `wall.from..wall.to` — the same numbers on both sides, so it passed while half
// the paintings hung outside their wall in world space. It has to be checked in
// WORLD coordinates against the ROOM, which is what actually exists.
{
  const rooms: Record<string, { lo: number; hi: number }> = {
    '-6': { lo: -13 + 0.3, hi: 3.4 }, // west partition, world z
    '6': { lo: -13 + 0.3, hi: 3.4 },
    '-17': { lo: 3.4, hi: 13 - 0.3 }, // lobby side wall, world z
    '17': { lo: 3.4, hi: 13 - 0.3 },
  }
  const off: string[] = []
  for (const [i, p] of PAINTINGS.entries()) {
    const at = paintingPlacement(p)
    const b = rooms[String(p.wall.x)]
    if (!b) {
      off.push(`art${i} has no room bound for wall x=${p.wall.x}`)
      continue
    }
    const lo = at.frame.z - p.w / 2
    const hi = at.frame.z + p.w / 2
    if (lo < b.lo || hi > b.hi) {
      off.push(`art${i} z ${lo.toFixed(2)}..${hi.toFixed(2)} outside ${b.lo.toFixed(1)}..${b.hi.toFixed(1)}`)
    }
  }
  check('every painting lands inside its room (world space)', off.length === 0, off.join(' | '))

  // ...and must not sit on a side window. The side elevations carry six windows
  // spanning several rooms, so "is the art inside the lobby" is not enough.
  const win = SIDE_WINDOWS.map((z) => ({ z, lo: z - SIDE_WINDOW_W / 2, hi: z + SIDE_WINDOW_W / 2 }))
  const onGlass: string[] = []
  for (const [i, p] of PAINTINGS.entries()) {
    if (Math.abs(p.wall.x) !== HALF_W) continue
    const at = paintingPlacement(p)
    const lo = at.frame.z - p.w / 2
    const hi = at.frame.z + p.w / 2
    const hit = win.filter((w) => hi > w.lo && lo < w.hi)
    if (hit.length) onGlass.push(`art${i} z ${lo.toFixed(2)}..${hi.toFixed(2)} on window ${hit[0].z}`)
  }
  check('no painting covers a side window', onGlass.length === 0, onGlass.join(' | '))
}

// Footprints must not sit on top of one another (corners of walls excepted).
{
  const bad: string[] = []
  for (let i = 0; i < FOOTPRINTS.length; i++) {
    for (let j = i + 1; j < FOOTPRINTS.length; j++) {
      const a = FOOTPRINTS[i]
      const b = FOOTPRINTS[j]
      const ox = Math.min(a.x + a.hw, b.x + b.hw) - Math.max(a.x - a.hw, b.x - b.hw)
      const oz = Math.min(a.z + a.hd, b.z + b.hd) - Math.max(a.z - a.hd, b.z - b.hd)
      if (ox <= 0.02 || oz <= 0.02) continue
      // walls meeting at a corner, and a chair tucked under its own desk, are fine
      const bothWall = a.kind === 'wall' && b.kind === 'wall'
      const seatAndDesk =
        (a.kind === 'seat' && b.kind === 'desk') || (b.kind === 'seat' && a.kind === 'desk')
      const plantOnWall = a.id.startsWith('plant-') || b.id.startsWith('plant-')
      if (!bothWall && !seatAndDesk && !plantOnWall) bad.push(`${a.id}<->${b.id}`)
    }
  }
  check('no furniture overlaps furniture', bad.length === 0, bad.slice(0, 4).join(', '))
}

/* ---------------------------------------------------------------- movement -- */
console.log('\nmovement')

// Nothing may be reachable outside the building.
{
  const outside = [
    [HALF_W + 1, 0],
    [-HALF_W - 1, 0],
    [0, HALF_D + 1],
    [0, -HALF_D - 1],
  ].filter(([x, z]) => blocked(x, z, BODY_R))
  check('outside the building is not walkable', outside.length === 4, `${outside.length}/4 points blocked`)
}

// Walls must not be walkable through.
{
  const throughWall = [
    [0, -HALF_D],
    [0, HALF_D],
    [-HALF_W, 0],
    [HALF_W, 0],
  ].filter(([x, z]) => blocked(x, z, BODY_R))
  check('wall centrelines are not walkable', throughWall.length === 4, `${throughWall.length}/4 blocked`)
}

/* ------------------------------------------------------------- transitions -- */
console.log('\nwindow/board constants')

check('window band fits under the wall top', WINDOW_Y + WINDOW_H / 2 < WALL_H,
  `${WINDOW_Y} + ${WINDOW_H}/2 vs ${WALL_H}`)
check('ceiling sits at the wall top (no beam across the board)', CEILING_Y === WALL_H,
  `${CEILING_Y} vs ${WALL_H}`)

/* ------------------------------------------------------------------ result -- */
console.log(`\n${checks - failures}/${checks} checks passed\n`)
if (failures) {
  console.error(`${failures} FAILED\n`)
  process.exit(1)
}
