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
import { readFileSync } from 'node:fs'
import {
  CEILING_Y,
  DESKS,
  deskByIndex,
  FOOTPRINTS,
  HALF_D,
  ROOM_DOORS,
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
import { buildAvatar } from '../src/lib/office/avatar'
import { followUpSection, matchOwner, parseActionItems } from '../src/lib/hermes/action-items'
import { originMarker, parseOrigin } from '../src/lib/hermes/kanban'
import { readJson } from '../src/lib/api'
import { SEATS } from '../src/lib/office/layout'
import * as THREE from 'three'

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

// A desk is addressed by its LABEL. `DESKS` is flat-mapped column by column, so
// `DESKS[n]` is not desk n — an agent whose card said "Meja 1" sat at station 5.
{
  const wrong: string[] = []
  for (let n = 0; n < DESKS.length; n++) {
    const d = deskByIndex(n)
    if (!d || d.index !== n) wrong.push(`${n}->${d?.index ?? 'none'}`)
  }
  check('deskByIndex(n) returns the desk labelled n', wrong.length === 0, wrong.join(', '))
}

// Doorways must stay clear. Three pieces of the old book nook sat in front of the
// work bay's door, which is what read as "a sofa parked in the walkway".
{
  const blocked: string[] = []
  for (const [room, door] of Object.entries(ROOM_DOORS)) {
    const z = room === 'lobby' ? 0 : (ROOMS as Record<string, { z2: number }>)[room].z2
    const half = door.width / 2
    for (const f of FOOTPRINTS) {
      if (f.kind === 'wall' || f.h <= 0.4) continue
      const overlapsX = f.x + f.hw > door.x - half && f.x - f.hw < door.x + half
      const nearDoor = Math.abs(f.z - z) < 1.6
      if (overlapsX && nearDoor) blocked.push(`${f.id} @ ${f.x},${f.z}`)
    }
  }
  check('no furniture blocks a doorway', blocked.length === 0, blocked.join(' | '))
}

// Every destination that has a direction must express it the same way, and the
// pose layer must read it from the DATA rather than from a list of pose names.
//
// This check exists because the same bug shipped twice: first the gate tested
// `activity === 'typing' || 'meeting'`, then a hand-kept SEATED set. Each version
// excluded whatever pose was added next, so `garden` and `dart` agents kept the
// heading they walked in with and stood with their back to the planter. Grepping
// the source is a crude check, but it is the one that would have caught both.
{
  const src = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
  const offenders: string[] = []
  if (/const SEATED\s*=/.test(src)) offenders.push('a hand-kept SEATED set exists again')
  if (/activity === 'typing' \|\| a\.activity === 'meeting'/.test(src)) {
    offenders.push('the pose-name gate is back')
  }
  if (!/a\.seatYaw = undefined/.test(src)) {
    offenders.push('seatYaw is not cleared per retarget (stale heading can persist)')
  }
  check(
    'facing is decided from destination data, not from a list of pose names',
    offenders.length === 0,
    offenders.join(' | '),
  )
}

// Every route must keep the methods the UI calls.
//
// Rewriting a route file to add an endpoint is exactly how the meeting POST was
// lost: the new GET was written and the existing POST was not carried over, so
// starting a meeting answered 405 with an empty body — which the browser reports
// as "Unexpected end of JSON input". A missing method is invisible to typecheck.
{
  // The method each route must export. A route that lost its POST answers 405 with
  // an empty body, which the browser reports as a JSON parse error — so this is
  // checked per file, not just that the file exists.
  const routes: Record<string, string[]> = {
    'src/app/api/hermes/tasks/route.ts': ['GET', 'POST'],
    'src/app/api/hermes/tasks/[id]/route.ts': ['GET', 'POST'],
    'src/app/api/hermes/meeting/route.ts': ['GET', 'POST'],
    'src/app/api/hermes/meeting/actions/route.ts': ['GET'],
    'src/app/api/hermes/agents/route.ts': ['GET', 'POST'],
    'src/app/api/hermes/cron/route.ts': ['GET', 'POST'],
    'src/app/api/hermes/cron/actions/route.ts': ['GET'],
  }
  const missing: string[] = []
  for (const [file, methods] of Object.entries(routes)) {
    const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    for (const m of methods) {
      if (!new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src)) {
        missing.push(`${file} lacks ${m}`)
      }
    }
  }
  check('every API route keeps the methods the UI calls', missing.length === 0, missing.join(' | '))
}

// Every neighbouring block must stand ON the ground, not beyond it. The ground
// used to be a single 60x52 m slab while a block at x=30 was 12 m wide (x 24..36)
// and another sat at z 34.5..43.5 — both outside the slab, so they floated over
// nothing, which is what "hovering above the clouds" described.
{
  const src = readFileSync(new URL('../src/lib/office/build.ts', import.meta.url), 'utf8')
  const problems: string[] = []
  const earth = Number(src.match(/const GROUND_EXTENT = (\d+)/)?.[1] ?? 0)
  if (!earth) {
    problems.push('GROUND_EXTENT not found')
  } else {
    const blocks = [...src.matchAll(/building\((-?[\d.]+),\s*(-?[\d.]+),\s*([\d.]+),\s*([\d.]+)/g)].map(
      (m) => ({ x: Number(m[1]), z: Number(m[2]), w: Number(m[3]), d: Number(m[4]) }),
    )
    if (!blocks.length) problems.push('no buildings found (pattern changed?)')
    for (const b of blocks) {
      const x0 = b.x - b.w / 2
      const x1 = b.x + b.w / 2
      const z0 = b.z - b.d / 2
      const z1 = b.z + b.d / 2
      if (Math.abs(x0) > earth / 2 || Math.abs(x1) > earth / 2 ||
          Math.abs(z0) > earth / 2 || Math.abs(z1) > earth / 2) {
        problems.push(`block at (${b.x},${b.z}) extends past the ground plane`)
      }
    }
  }
  check('every building stands on the ground plane', problems.length === 0, problems.join(' | '))
}

// Every seated pose must put the feet where they belong: on the floor, or on the
// stool's foot ring. This is the check that was missing when the sofa was modelled
// 9 cm higher than the avatar's legs could reach — every sitter hovered with their
// feet dangling and nothing compared the pose against the furniture.
//
// It measures the REAL rig rather than a re-derived formula, so it stays honest if
// the limb lengths in avatar.ts change.
{
  const av = buildAvatar('alice' as never)
  const root = new THREE.Group()
  root.add(av.group)
  const D = Math.PI / 180
  const problems: string[] = []
  for (const [name, seat] of Object.entries(SEATS)) {
    const s = seat as { hip: number; thigh: number; knee: number; footY?: number }
    for (const [leg, sign] of [
      [av.legs[0], -1],
      [av.legs[1], 1],
    ] as const) {
      leg.shoulder.rotation.set(s.thigh * D, sign * 5 * D, 0)
      leg.elbow.rotation.set(s.knee * D, 0, 0)
    }
    av.hips.position.y = s.hip
    root.updateMatrixWorld(true)
    let lowest = Infinity
    for (const leg of av.legs) {
      for (const child of leg.elbow.children) {
        const p = new THREE.Vector3()
        child.getWorldPosition(p)
        const g = (child as THREE.Mesh).geometry as THREE.BoxGeometry
        lowest = Math.min(lowest, p.y - g.parameters.height / 2)
      }
    }
    const want = s.footY ?? 0
    // 2 cm: the foot box is a slab, so the sole is flat and this is tight enough to
    // catch the 9 cm and 13 cm errors that were there before.
    if (Math.abs(lowest - want) > 0.02) {
      problems.push(
        `${name}: feet at ${lowest.toFixed(3)} but must be ${want.toFixed(3)} (${((lowest - want) * 100).toFixed(0)} cm off)`,
      )
    }
  }
  check('every seated pose plants the feet on its seat', problems.length === 0, problems.join(' | '))
}

// The cross-menu link rides on `created_by`, a free-text field, so both halves have
// to round-trip: the marker we write must parse back to the same origin, and a value
// the CLI sets itself (`worker`) must not be mistaken for one of ours.
{
  const problems: string[] = []
  const round: [string, string][] = [
    ['meeting', 'mTESTLINK'],
    ['cron', '4a349bb25d9f'],
    ['agent', 'alice'],
  ]
  for (const [kind, ref] of round) {
    const o = { kind: kind as 'meeting' | 'cron' | 'agent', ref }
    const parsed = parseOrigin(originMarker(o))
    if (parsed?.kind !== kind || parsed?.ref !== ref) {
      problems.push(`${kind}:${ref} -> ${JSON.stringify(parsed)}`)
    }
  }
  // Values the CLI writes itself must not be claimed as a cross-menu link.
  const foreign = parseOrigin('worker')
  if (foreign?.kind !== 'manual') problems.push(`'worker' parsed as ${foreign?.kind}`)
  if (parseOrigin(null) !== undefined) problems.push('null should parse to undefined')
  check('task origin markers round-trip', problems.length === 0, problems.join(' | '))
}

// Reading an API reply must never throw, whatever the body is. The panels used to
// call `await r.json()` directly, so a 502 from a proxy — HTML, not JSON — surfaced
// as "Failed to execute 'json' on 'Response': Unexpected end of JSON input", which
// describes the parser and hides that the backend was down. That exact message was
// reported from production.

// Parsing minutes into follow-ups is what makes the meeting -> board link work, and
// it is a text contract with an LLM, so the shapes it may emit are tested rather
// than assumed. A miss here silently produces no tasks, or a task assigned to a
// name that does not exist.
{
  const problems: string[] = []
  const MD = `## KEPUTUSAN
- Pakai Postgres.

## TINDAK LANJUT
- **alice**: tulis migrasi tabel invoices — 2026-09-30.
- **bob**: tambah test regresi checkout.
- dave: siapkan runbook.

## RISIKO
- Lock lama.`
  const items = parseActionItems(MD)
  if (items.length !== 3) problems.push(`expected 3 items, got ${items.length}`)
  if (items[0]?.owner !== 'alice') problems.push(`owner[0]=${items[0]?.owner}`)
  if (items[0]?.due !== '2026-09-30') problems.push(`due[0]=${items[0]?.due}`)
  // A trailing sentence period must not survive into the title.
  if (items[1]?.text.endsWith('.')) problems.push(`text[1] kept its period: ${items[1]?.text}`)
  // An owner the roster does not know resolves to null rather than a wrong name.
  if (matchOwner('dave', ['default', 'alice', 'bob']) !== null) {
    problems.push('unknown owner matched anyway')
  }
  if (matchOwner('Alice', ['default', 'alice']) !== 'alice') problems.push('case-insensitive match failed')
  // Minutes that agreed nothing must yield nothing, not a placeholder task.
  const none = parseActionItems('## TINDAK LANJUT\n- Belum ada kesepakatan final')
  if (none.length !== 0) problems.push(`empty minutes produced ${none.length} items`)
  check('minutes parse into action items', problems.length === 0, problems.join(' | '))
}

// The heading regex must survive a text rewrite. A history rewrite with a bad
// replacement map once turned every '#' into a placeholder across the repo, which
// silently broke this regex (`/^\s*#{1,6}\s*TINDAK/` became `***REMOVED***{1,6}`)
// and the follow-up parser stopped matching anything. The unit tests above did not
// catch it because they call parseActionItems, and that still returned [] — which is
// also the correct answer for minutes with no follow-ups. So the regex is asserted
// directly.
{
  const problems: string[] = []
  const heading = (n: number) => '#'.repeat(n) + ' TINDAK LANJUT'
  // 1-6 hashes must all be accepted; 7 is not a markdown heading.
  for (let n = 1; n <= 6; n++) {
    if (!followUpSection(`${heading(n)}\n- **a**: x`)) problems.push(`h${n} not recognised`)
  }
  if (followUpSection('####### TINDAK LANJUT\n- x')) problems.push('h7 wrongly accepted')
  // Lowercase and trailing punctuation must still match.
  if (!followUpSection('## tindak lanjut\n- x')) problems.push('lowercase not recognised')
  // The literal must be a hash, not a placeholder that replaced one.
  if (!/^\s*#{1,6}/.test('# TINDAK LANJUT')) problems.push('hash class is broken')
  check('minutes heading regex survives a text rewrite', problems.length === 0, problems.join(' | '))
}

// The street must be layered, not overlapping: building, then sidewalk, then road.
//
// This shipped wrong twice in opposite directions — pedestrians at z 16.4/19.6
// walked through the neighbouring blocks, and the "fix" put them at 11.6/10.2,
// inside our own building. Both were a sign error in the same expression, and both
// were invisible in a screenshot at normal zoom.
{
  const src = readFileSync(new URL('../src/lib/office/build.ts', import.meta.url), 'utf8')
  const problems: string[] = []

  // building: -HALF_D .. HALF_D   sidewalk: HALF_D .. HALF_D+9.5   road: +9.5 .. +18.5
  const walkerZ = [...src.matchAll(/sidewalkZ = HALF_D \+ \(row === 0 \? ([\d.]+) : ([\d.]+)\)/g)]
  if (!walkerZ.length) {
    problems.push('pedestrian sidewalk offset not found (pattern changed?)')
  } else {
    const offs = walkerZ[0].slice(1).map(Number)
    for (const off of offs) {
      const z = HALF_D + off
      if (z <= HALF_D) problems.push(`pedestrian row at z=${z} is inside the building`)
      if (z >= HALF_D + 9.5) problems.push(`pedestrian row at z=${z} is in the road`)
    }
  }

  const lanes = [...src.matchAll(/LANE_(?:NORTH|SOUTH) = HALF_D \+ ([\d.]+)/g)].map((m) => Number(m[1]))
  if (lanes.length === 2) {
    const gap = Math.abs(lanes[1] - lanes[0])
    // The car body is 1.8 m wide, so two lanes closer than that overlap.
    if (gap < 1.8 + 1.0) problems.push(`lane centres only ${gap} m apart (car is 1.8 m wide)`)
    for (const l of lanes) {
      if (l <= 9.5 || l >= 18.5) problems.push(`lane at HALF_D+${l} is outside the road`)
    }
  } else {
    problems.push('lane constants not found (pattern changed?)')
  }

  check('street is layered: sidewalk outside the building, lanes inside the road',
    problems.length === 0, problems.join(' | '))
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

// `readJson` is async and this file compiles to CJS, so the check runs inside an
// async IIFE and records its own result. Everything else here is synchronous.
void (async () => {
  const cases: [string, string, number][] = [
    ['json ok', '{"a":1}', 200],
    ['json error body', '{"error":{"message":"nope"}}', 409],
    ['html 502', '<!DOCTYPE html><html>bad gateway</html>', 502],
    ['html 404', '<html>not found</html>', 404],
    ['empty 200', '', 200],
    ['empty 500', '', 500],
    ['truncated json', '{"a":', 200],
    ['plain text', 'Internal Server Error', 500],
  ]
  const problems: string[] = []
  for (const [name, body, status] of cases) {
    const res = new Response(body, { status })
    try {
      const out = await readJson(res)
      // A failure must always carry a message, or the panel shows nothing at all.
      if (!out.ok && !out.error) problems.push(`${name}: failed with no message`)
      if (out.status !== status) problems.push(`${name}: status ${out.status} != ${status}`)
      // A success with a JSON body must actually be parsed.
      if (out.ok && name === 'json ok' && !out.data) problems.push(`${name}: body not parsed`)
    } catch (e) {
      problems.push(`${name} THREW: ${(e as Error).message}`)
    }
  }
  check('API replies never throw while being read', problems.length === 0, problems.join(' | '))
  /* ------------------------------------------------------------- result -- */
  console.log(`\n${checks - failures}/${checks} checks passed\n`)
  if (failures) {
    console.error(`${failures} FAILED\n`)
    process.exit(1)
  }
})()

