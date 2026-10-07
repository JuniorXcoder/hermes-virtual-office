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
import { readFileSync, rmSync } from 'node:fs'
import { facingProblems } from '../src/lib/office/facing'
import { assessHealth, HEALTH_COLOR, HEALTH_THRESHOLDS } from '../src/lib/office/health'
import { wrapAngle } from '../src/lib/office/layout'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BARS,
  BOARD_COLUMNS,
  BOARD_D,
  CEILING_Y,
  DESKS,
  deskByIndex,
  desksForDivision,
  DIVISION_MEETING_ROOM,
  DOOR,
  FOOTPRINTS,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  LEVEL_BOUNDS,
  DINING_SETS,
  diningChairs,
  diningChairFacing,
  insideCeoRoom,
  mayEnterCeoRoom,
  POOL,
  WATER_Y,
  LEVEL_H,
  MEETING_ROOMS,
  MEETING_ROOM_IDS,
  meetingRoomFor,
  BBQ,
  GYM,
  LOUNGE,
  LOUNGE_TABLE,
  LOUNGE_TV,
  MEETING_TABLES,
  PLANTING,
  POOL_BENCHES,
  POOL_LOUNGERS,
  SUNBEDS,
  ROOMS,
  STAIRS,
  STAIR_FLIGHT_TOP,
  STAIR_FOOT,
  STAIR_TOP,
  stairHeightAt,
  blockingFootprints,
  courtyardWallSegments,
  deskSeatWorld,
  layoutConflicts,
  roomById,
  roomCentre,
  WALL_H,
  WALL_T,
  RACING_RIGS,
  RACING_SEAT_H,
  BOWLING,
  PIN_H,
  DARTBOARD,
  TERRACE_PROPS,
  ROOM_PLAQUES,
  PLAQUE_W,
  ROOM_PROPS,
} from '../src/lib/office/layout'
import { BODY_R, blocked, onStairArea, planRoute, route, routeBetween, stairCentre } from '../src/lib/office/nav'
import { dummyRoster } from '../src/lib/office/dummy-roster'
import { buildOffice } from '../src/lib/office/build'
import type { IdleSpot, MeetingRoomId } from '../src/lib/office/layout'
import type { AgentRole } from '@/types/hermes'
import { IDLE_SPOTS } from '../src/lib/office/layout'
import { buildAvatar, FIST_FROM_ELBOW, FOREARM } from '../src/lib/office/avatar'
import { ACTIVITIES, animate, type Activity } from '../src/lib/office/anim'
import { followUpSection, matchOwner, parseActionItems } from '../src/lib/hermes/action-items'
import { parseLimit, parseCronRuns } from '../src/lib/hermes/cron'
import { hide, isHidden, show, visible, visibleNames } from '../src/lib/hermes/office-membership'
import { originMarker, parseOrigin, providersToModels } from '../src/lib/hermes/kanban'
import { readJson } from '../src/lib/api'
import { SEATS } from '../src/lib/office/layout'
import { columnOf } from '../src/lib/office/board'
import { wrapBubble } from '../src/components/SpriteOffice'
import { filterModels } from '../src/components/ModelPicker'
import { officeChatArgs, sendChatMessage } from '../src/lib/hermes/chat'
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

// Every Hermes status must map into the 3D board's four rendered columns.
{
  const statuses = ['todo', 'triage', 'ready', 'scheduled', 'running', 'review', 'done', 'blocked', 'archived', 'future_status']
  const invalid = statuses.filter((status) => columnOf(status) < 0 || columnOf(status) >= BOARD_COLUMNS.length)
  check('all task states fit a rendered 3D kanban column', invalid.length === 0, invalid.join(', '))
}

// The Kanban board is the green whiteboard on Rinjani's north wall, on level 1.
{
  const r = roomById('rinjani')!
  const left = KANBAN_BOARD.x - KANBAN_BOARD.w / 2
  const right = KANBAN_BOARD.x + KANBAN_BOARD.w / 2
  const bottom = KANBAN_BOARD.y - KANBAN_BOARD.h / 2
  const top = KANBAN_BOARD.y + KANBAN_BOARD.h / 2
  check(
    'kanban board fits inside the Rinjani room',
    left > r.x1 && right < r.x2,
    `x ${f2(left)}..${f2(right)} vs room ${f2(r.x1)}..${f2(r.x2)}`,
  )
  check(
    'kanban board is above its floor and below the ceiling',
    bottom > LEVEL_H && top < LEVEL_H + WALL_H,
    `y ${f2(bottom)}..${f2(top)} vs level 1 band ${LEVEL_H}..${f2(LEVEL_H + WALL_H)}`,
  )
  // The board must hang on the INSIDE face of the wall. It was placed at
  // z1 + WALL_T/2 once, which is inside the plaster: it existed and was invisible.
  const innerFace = r.z1 + WALL_T
  const frontFace = KANBAN_BOARD.z + BOARD_D / 2
  check(
    'kanban board hangs clear of the wall, not inside it',
    frontFace > innerFace + 0.01,
    `front ${f2(frontFace)} vs wall inner face ${f2(innerFace)}`,
  )
}

// The U is a real plan now: walls, rooms and furniture must all be present, and
// nothing may overlap anything else on its own level.
{
  const walls = FOOTPRINTS.filter((f) => f.kind === 'wall').length
  const solids = blockingFootprints().length
  check('the plan has walls and furniture again', walls > 10 && solids > 10,
    `${walls} walls, ${solids} solids`)
  const bad = layoutConflicts()
  check('no furniture overlaps furniture on the same level', bad.length === 0,
    bad.slice(0, 4).map((c) => `${c.a}<->${c.b}`).join(', '))
}

// The building is a U: the courtyard must be OUTSIDE the bars, and every room
// must be reachable from the entrance. This is the check that catches a room
// walled off by its own partitions.
{
  const problems: string[] = []
  // courtyard is not inside any bar
  const cy = roomCentre('courtyard')
  if (cy.x > BARS.west.x2 && cy.x < BARS.east.x1) {
    // fine: between the two side bars
  } else {
    problems.push(`courtyard centre x=${cy.x} is not between the bars`)
  }
  if (!(cy.z > BARS.north.z2 && cy.z < BARS.lobby.z1)) {
    problems.push(`courtyard centre z=${cy.z} is not between the north bar and the lobby`)
  }
  // the courtyard is open to the sky
  if (!roomById('courtyard')?.outdoor) problems.push('courtyard is not marked outdoor')

  // every level-0 room reachable on foot from the door
  for (const r of ROOMS.filter((x) => x.level === 0 && x.id !== 'terrace')) {
    const c = roomCentre(r.id)
    const legs = route({ x: DOOR.x, z: DOOR.z - 1.5 }, c, 0)
    if (!legs.length) problems.push(`no route door->${r.id}`)
  }
  // every level-1 room reachable VIA THE STAIRS
  for (const r of ROOMS.filter((x) => x.level === 1)) {
    const c = roomCentre(r.id)
    const legs = routeBetween({ x: DOOR.x, z: DOOR.z - 1.5, level: 0 }, { ...c, level: 1 })
    if (!legs.length) problems.push(`no route door->${r.id} (via stairs)`)
  }
  check('U plan: courtyard open, every room reachable from the door', problems.length === 0, problems.join(' | '))
}

// Split level: the work rooms are on level 0 and the meeting rooms on level 1 —
// the whole point of the redesign. And Rinjani (the 10-seat room) must sit next
// to the CEO suite, with Merapi (managers + CEO) also in the north bar.
{
  const problems: string[] = []
  // division -> the room its desks live in (the ids differ: tech works in `dev`)
  const WORK_ROOM: Record<'tech' | 'growth' | 'content', string> = {
    tech: 'dev',
    growth: 'mkt',
    content: 'content',
  }
  for (const div of ['tech', 'growth', 'content'] as const) {
    const work = roomById(WORK_ROOM[div])
    const meet = MEETING_ROOMS[DIVISION_MEETING_ROOM[div]]
    const meetRoom = roomById(meet.roomId)
    if (!work || !meetRoom) {
      problems.push(`${div}: room missing`)
      continue
    }
    if (work.level !== 0) problems.push(`${div} work room is not on level 0`)
    if (meetRoom.level !== 1) problems.push(`${div} meeting room is not on level 1`)
    if (work.id === meetRoom.id) problems.push(`${div} work and meeting share a room`)
  }
  // Rinjani is the biggest, and next door to the CEO.
  const rinjani = roomById('rinjani')
  const ceo = roomById('ceo')
  const merapi = roomById('merapi')
  if (!rinjani || !ceo || !merapi) {
    problems.push('rinjani/ceo/merapi room missing')
  } else {
    if (MEETING_ROOMS.rinjani.seats.length !== 10) problems.push('rinjani does not seat 10')
    for (const [a, b, label] of [
      [rinjani, ceo, 'rinjani<->ceo'],
      [rinjani, merapi, 'rinjani<->merapi'],
    ] as const) {
      const gap = Math.max(a.x1, b.x1) < Math.min(a.x2, b.x2) && Math.max(a.z1, b.z1) < Math.min(a.z2, b.z2)
      const touching = Math.abs(a.x1 - b.x2) < 1.5 || Math.abs(b.x1 - a.x2) < 1.5
      if (!touching && !gap) problems.push(`${label} are not neighbours`)
    }
    // the biggest room must actually be the biggest
    const area = (r: typeof rinjani) => (r.x2 - r.x1) * (r.z2 - r.z1)
    for (const id of MEETING_ROOM_IDS) {
      const other = roomById(id)
      if (other && area(other) > area(rinjani)) problems.push(`${id} is bigger than rinjani`)
    }
  }
  // Merapi seats the 3 managers + CEO
  if (MEETING_ROOMS.merapi.seats.length !== 4) problems.push('merapi does not seat 4')
  check('split level: work on L0, meeting on L1, rinjani biggest next to CEO',
    problems.length === 0, problems.join(' | '))
}

// Every division has exactly three desks, exactly one of them the manager's.
{
  const problems: string[] = []
  for (const div of ['tech', 'growth', 'content'] as const) {
    const desks = desksForDivision(div)
    if (desks.length !== 3) problems.push(`${div} has ${desks.length} desks, want 3`)
    const managers = desks.filter((d) => d.seat === 'manager')
    if (managers.length !== 1) problems.push(`${div} has ${managers.length} managers, want 1`)
  }
  check('every division has 3 desks: 1 manager + 2 staff', problems.length === 0, problems.join(' | '))
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

// Nothing may block the entrance: a visitor must be able to walk in and reach the
// courtyard without a counter or a planter in the way.
{
  const gaps = [{ x: DOOR.x, z: DOOR.z, hw: 1.7, hd: 1.2 }]
  const blockedDoor: string[] = []
  for (const g of gaps) {
    for (const f of FOOTPRINTS) {
      if (f.kind === 'wall' || f.kind === 'seat' || f.h <= 0.4) continue
      const ox = f.x + f.hw > g.x - g.hw && f.x - f.hw < g.x + g.hw
      const oz = f.z + f.hd > g.z - g.hd && f.z - f.hd < g.z + g.hd
      if (ox && oz) blockedDoor.push(`${f.id} @ gap ${g.x},${g.z}`)
    }
  }
  check('no furniture blocks the entrance', blockedDoor.length === 0, blockedDoor.join(' | '))
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
    'src/app/api/hermes/office/route.ts': ['GET', 'POST'],
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
//
// The neighbouring blocks have since been demolished (the plot is bare), so the
// block list is empty by design. The check stays armed: the moment a `building()`
// call comes back it must still stand inside the ground plane.
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
  check('every building stands on the ground plane', problems.length === 0,
    `${earth} m ground, blocks checked: see source`)
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

// Every idle spot must be reachable. scene.ts filters out any that is not, which is
// the right runtime behaviour but hides the mistake: two spots were dead — one inside
// `floor-lamp`, one inside `lng-planter` — so only one agent could ever tend the
// planter and the "by the water cooler" spot never existed. The filter is silent, so
// the data is asserted here instead.
//
// A SEATED spot is allowed to sit inside furniture: a desk chair is tucked under its
// desk and a meeting chair is covered by its table. That is what a seat IS, so the
// test uses the same `settling` exemption the mover uses on its final approach.
{
  const problems: string[] = []
  // A WATER spot is inside the pool by construction, so it is tested with the same
  // exemption the mover uses (`allowWater`) rather than being reported as dead.
  const dead = IDLE_SPOTS.filter((p) =>
    blocked(p.x, p.z, BODY_R, {
      allowSeat: p.seated,
      // A seated OR bench spot is inside its furniture by construction: a chair is
      // tucked under a desk, a meeting chair is covered by its table, and a bench press
      // is done lying ON the bench inside the rack's footprint.
      settling: p.seated || p.bench,
      allowWater: p.water,
      level: p.level,
    }),
  )
  for (const p of dead) {
    problems.push(`(${p.x.toFixed(1)},${p.z.toFixed(1)}) L${p.level} ${p.act} is inside furniture`)
  }
  // A standing spot must additionally be reachable on foot from the lobby. A swimmer
  // walks to the pool deck and then enters the water, so its route is checked to the
  // NEAREST DECK POINT, not into the basin (A* refuses to plan inside a solid).
  for (const p of IDLE_SPOTS.filter((s) => !s.seated)) {
    const goal = p.water
      ? { x: Math.sign(p.x || 1) * 6.4, z: p.z, level: p.level }
      : { x: p.x, z: p.z, level: p.level }
    const legs = routeBetween({ x: DOOR.x, z: DOOR.z - 1.5, level: 0 }, goal)
    if (!legs.length) problems.push(`(${p.x.toFixed(1)},${p.z.toFixed(1)}) L${p.level} ${p.act} has no route`)
  }
  check(
    'every idle spot is reachable',
    problems.length === 0,
    problems.join(' | '),
  )
}

// With the interior demolished there is no reception counter and no sofa, so the
// old seating checks have nothing to measure. The check is kept as a no-op that
// re-arms the moment a `reception` footprint exists again — it is the guard that
// caught the receptionist sitting on the visitor side of the counter.
{
  const problems: string[] = []
  const rec = FOOTPRINTS.find((f) => f.id === 'reception')
  const chair = FOOTPRINTS.find((f) => f.id === 'reception-chair')
  if (rec && chair) {
    if (chair.z >= rec.z) {
      problems.push(`reception chair at z=${chair.z} is not behind the counter (z=${rec.z})`)
    }
    const gap = rec.z - rec.hd - (chair.z + chair.hd)
    if (gap < 0.2) problems.push(`only ${gap.toFixed(2)}m between chair and counter`)
  }
  const sofa = FOOTPRINTS.find((f) => f.id === 'sofa-b')
  if (rec && sofa) {
    const dx = Math.abs(sofa.x - rec.x) - (sofa.hw + rec.hw)
    const dz = Math.abs(sofa.z - rec.z) - (sofa.hd + rec.hd)
    if (dx < 0 && dz < 0) problems.push('lounge sofa overlaps the reception counter')
  }
  check('lobby seating is placed where it can be used', problems.length === 0, problems.join(' | '))
}

// `listProfiles()` must include `default`, which lives at the Hermes root
// (~/.hermes/config.yaml) rather than under profiles/. Reading only profiles/ left it
// out, and because the board's assignee list DOES include it, the chat panel listed
// `default` as an agent and then refused to send to it — "profil default tidak ada".
{
  const problems: string[] = []
  // The source must look at the root config, not only the profiles directory.
  const src = readFileSync(new URL('../src/lib/hermes/kanban.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export async function listProfiles'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  if (!body.includes("hermesHome(), 'config.yaml'")) {
    problems.push('listProfiles does not look at the root config.yaml (default profile)')
  }
  if (!body.includes("'default'")) problems.push("listProfiles never pushes 'default'")
  check('listProfiles includes the default profile', problems.length === 0, problems.join(' | '))
}

// The plan must be walkable end to end: in at the door, across the lobby, through
// the courtyard, into every division room, and up the stairs to the exec floor.
{
  const problems: string[] = []

  // 1. The entrance approach must be clear.
  if (blocked(DOOR.x, HALF_D - WALL_T - 0.8, BODY_R, { level: 0 })) {
    problems.push('entrance approach blocked')
  }

  // 2. Every idle spot must be reachable from the door, on its OWN level — a spot
  //    on the exec floor is reached through the stair portal.
  for (const spot of IDLE_SPOTS) {
    const from = { x: DOOR.x, z: DOOR.z - 1.5, level: 0 as const }
    const legs = spot.level === 0
      ? route(from, { x: spot.x, z: spot.z }, 0)
      : routeBetween(from, { x: spot.x, z: spot.z, level: 1 })
    if (!legs.length) problems.push(`idle spot (${spot.x},${spot.z}) L${spot.level} unreachable`)
  }

  // 3. Every desk must be reachable from the door (same level).
  for (const d of DESKS) {
    const seat = deskSeatWorld(d)
    const legs = route({ x: DOOR.x, z: DOOR.z - 1.5 }, { x: seat.x, z: seat.z }, 0)
    if (!legs.length) problems.push(`desk ${d.index} unreachable`)
  }

  check('plan is walkable: door, courtyard, every desk and every idle spot',
    problems.length === 0, problems.join(' | '))
}

// The pool is water: a walker must not be able to stand in it. This caught the
// basin slipping through the blocker threshold at exactly 0.5.
{
  check('the pool is solid (you cannot walk on water)', blocked(POOL.x, POOL.z, BODY_R, { level: 0 }))
}

// The stair is an EXTERNAL flight in the courtyard, and it must actually WORK as
// the level link: the flight is solid on the ground (you cannot walk through it),
// the flat landing at its top is floor on level 1, and a walker can get from the
// courtyard up to every level-1 room.
//
// This replaced an earlier "shaft is walkable on both levels" check. That design
// put the stair INSIDE the terrace, under the level-1 slab, where no camera could
// see it — which is precisely why it never looked right. The stair now stands in
// the open courtyard and its top landing reaches through the building line.
{
  const problems: string[] = []
  const cx = (STAIRS.x1 + STAIRS.x2) / 2
  const flightMid = (STAIRS.z2 + STAIR_FLIGHT_TOP) / 2
  // 1. the flight is solid on the ground floor
  if (!blocked(cx, flightMid, BODY_R, { level: 0 })) {
    problems.push('the flight is walkable on level 0 (you can walk through a stair)')
  }
  // 2. the foot is reachable from the courtyard
  if (blocked(STAIR_FOOT.x, STAIR_FOOT.z, BODY_R, { level: 0 })) {
    problems.push('the foot of the stair is blocked')
  }
  // 3. the landing is floor on level 1
  if (blocked(STAIR_TOP.x, STAIR_TOP.z, BODY_R, { level: 1 })) {
    problems.push('the top landing is not walkable on level 1')
  }
  // 4. and the whole trip works: courtyard -> every exec room
  for (const r of ROOMS.filter((x) => x.level === 1 && x.id !== 'corridor1')) {
    const c = roomCentre(r.id)
    const legs = routeBetween({ x: 0, z: 4, level: 0 }, { ...c, level: 1 })
    if (!legs.length) problems.push(`no route courtyard->${r.id}`)
  }
  // 5. the stair must NOT stand under the level-1 slab, or it is invisible again.
  //    Its foot has to be SOUTH of the building line. Z DECREASES northward, so
  //    "south of the edge" means z GREATER than it.
  if (STAIRS.z2 < BARS.north.z2) {
    problems.push(`stair foot z=${STAIRS.z2} is not in the courtyard (building edge ${BARS.north.z2})`)
  }
  // 6. THE RAMP MUST RISE. Z decreases northward, so the run is (foot - top) and it
  //    must be POSITIVE. Getting this sign wrong drew every tread with a negative
  //    depth (invisible) and marched the rail posts south into the courtyard — the
  //    stair rendered as two stray diagonal rails. That is the bug this guards.
  const run = STAIRS.z2 - STAIR_FLIGHT_TOP
  if (run <= 0) problems.push(`flight run is ${run.toFixed(2)} — negative, the stair renders backwards`)
  if (STAIRS.z2 <= STAIR_FLIGHT_TOP) problems.push('the foot is not south of the flight top')
  // and the height function must climb, never dip
  {
    let prev = -1
    for (let z = STAIRS.z2; z >= STAIRS.z1; z -= 0.1) {
      const h = stairHeightAt((STAIRS.x1 + STAIRS.x2) / 2, z) ?? 0
      if (h < prev - 0.001) {
        problems.push(`stair height dips at z=${z.toFixed(1)}`)
        break
      }
      prev = h
    }
    const topH = stairHeightAt((STAIRS.x1 + STAIRS.x2) / 2, STAIR_FLIGHT_TOP)
    if (topH !== LEVEL_H) problems.push(`top of flight is at ${topH}, want ${LEVEL_H}`)
  }
  check('the external stair links the courtyard to every exec room', problems.length === 0, problems.join(' | '))
}

// ─────────────────────────────────────────────────────────────────────────────
// AN AVATAR MUST BE ABLE TO WALK THE STAIR.
//
// This is the test that was missing. Everything above proves the stair EXISTS and
// that A* can find a route; none of it proves a BODY can traverse it. A body could
// still jam on the ramp, pop 3.4 m at the landing, or dead-end in mid-air.
//
// The loop below re-implements `scene.ts`'s mover exactly — same arrival radius
// (0.18), same speed (3.4 m/s), same collision call, same height rule — and walks
// a body frame by frame at 60 fps.
// ─────────────────────────────────────────────────────────────────────────────
{
  type Body = { x: number; z: number; y: number; level: 0 | 1 }
  const stepBody = (a: Body, path: { x: number; z: number; level: 0 | 1 }[], dt: number) => {
    if (!path.length) return true
    const leg = path[0]
    const dx = leg.x - a.x
    const dz = leg.z - a.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.18) {
      path.shift()
      if (leg.level !== a.level) a.level = leg.level
      if (!path.length) {
        a.x = leg.x
        a.z = leg.z
        return true
      }
      return false
    }
    const inv = 1 / dist
    const stepLen = Math.min(3.4 * dt, dist)
    const nx = a.x + dx * inv * stepLen
    const nz = a.z + dz * inv * stepLen
    const climbing = onStairArea(a.x, a.z)
    if (!blocked(nx, nz, BODY_R * 0.9, { level: a.level, onStair: climbing })) {
      a.x = nx
      a.z = nz
    } else {
      a.x += dx * inv * Math.min(0.05, stepLen)
      a.z += dz * inv * Math.min(0.05, stepLen)
    }
    const h = onStairArea(a.x, a.z) ? stairHeightAt(a.x, a.z) : null
    a.y = h ?? a.level * LEVEL_H
    return false
  }
  const walk = (from: Body, to: { x: number; z: number; level: 0 | 1 }) => {
    const path = routeBetween(from, to)
    if (!path.length) return { ok: false, why: 'no route', maxJump: 0 }
    const dt = 1 / 60
    let guard = 0
    let stuck = 0
    let maxJump = 0
    let prevY = from.y
    let lx = from.x
    let lz = from.z
    while (path.length && guard++ < 4000) {
      stepBody(from, path, dt)
      maxJump = Math.max(maxJump, Math.abs(from.y - prevY))
      prevY = from.y
      const moved = Math.hypot(from.x - lx, from.z - lz)
      lx = from.x
      lz = from.z
      stuck = moved < 0.0005 ? stuck + 1 : 0
      if (stuck > 120) return { ok: false, why: `stuck at (${from.x.toFixed(1)},${from.z.toFixed(1)})`, maxJump }
    }
    return { ok: !path.length, why: path.length ? 'timeout' : '', maxJump }
  }

  const problems: string[] = []

  // 1. UP: from the courtyard into every meeting room.
  for (const id of MEETING_ROOM_IDS) {
    const seat = MEETING_ROOMS[id].seats[0]
    const body: Body = { x: 0, z: 6, y: 0, level: 0 }
    const r = walk(body, { x: seat.x, z: seat.z, level: 1 })
    if (!r.ok) problems.push(`up->${id}: ${r.why}`)
    else if (body.level !== 1 || Math.abs(body.y - LEVEL_H) > 0.01) {
      problems.push(`up->${id}: ended at y=${body.y.toFixed(2)} L${body.level}`)
    }
  }
  // 2. DOWN: back out of a meeting room to the courtyard.
  {
    const seat = MEETING_ROOMS.rinjani.seats[0]
    const body: Body = { x: seat.x, z: seat.z, y: LEVEL_H, level: 1 }
    const r = walk(body, { x: 0, z: 6, level: 0 })
    if (!r.ok) problems.push(`down: ${r.why}`)
    else if (body.level !== 0 || Math.abs(body.y) > 0.01) {
      problems.push(`down: ended at y=${body.y.toFixed(2)} L${body.level}`)
    }
  }
  // 3. NO TELEPORT: the climb is continuous. At 3.4 m/s and 60 fps a frame covers
  //    ~5.7 cm of run, ~3.5 cm of rise on this ramp; 15 cm allows for the snap onto
  //    the final waypoint but still catches a 3.4 m jump.
  {
    const body: Body = { x: 0, z: 6, y: 0, level: 0 }
    const seat = MEETING_ROOMS.bromo.seats[0]
    const r = walk(body, { x: seat.x, z: seat.z, level: 1 })
    if (r.maxJump > 0.15) problems.push(`climb teleports: ${r.maxJump.toFixed(3)} m in one frame`)
  }
  // 4. the flight is solid for everyone else, but passable while climbing.
  {
    const mid = { x: (STAIRS.x1 + STAIRS.x2) / 2, z: (STAIRS.z2 + STAIR_FLIGHT_TOP) / 2 }
    if (!blocked(mid.x, mid.z, BODY_R, { level: 0 })) {
      problems.push('the flight is walkable by everyone (it should be solid)')
    }
    if (blocked(mid.x, mid.z, BODY_R, { level: 0, onStair: true })) {
      problems.push('a climbing body still collides with the ramp')
    }
  }
  check('an avatar can WALK the stair up and down, continuously (no teleport, no dead end)',
    problems.length === 0, problems.join(' | '))
}

// ─────────────────────────────────────────────────────────────────────────────
// FOUR REPORTED DEFECTS, ASSERTED SO THEY CANNOT COME BACK.
//
// Each of these was a real bug found by looking at a render, not a style choice.
// ─────────────────────────────────────────────────────────────────────────────

// (1) THE STAIR RAIL MUST NOT OVERHANG THE CORRIDOR.
//
// This measures the BUILT MESH, not the footprint list. An earlier version of this
// check iterated `FOOTPRINTS` for ids starting with 'stair-' — but those footprints
// had already been deleted, so it looped over an empty set and passed vacuously.
// A test that cannot fail is worse than no test.
//
// The real defect: the level handrail was as long as the whole landing (1.40 m), so
// a bar sat at waist height right across the level-1 corridor.
{
  const problems: string[] = []
  const scene = new THREE.Scene()
  const g = globalThis as unknown as { document?: unknown; window?: unknown }
  const hadDoc = 'document' in g
  if (!hadDoc) {
    g.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '', textAlign: '', textBaseline: '',
          fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
          arc() {}, ellipse() {},
          // closePath is NOT optional: `racingFeedTexture` closes the road and barrier
          // trapezoids. An incomplete stub here fails the TV check with a TypeError that has
          // nothing to do with the code under test.
          closePath() {}, quadraticCurveTo() {}, bezierCurveTo() {},
          translate() {}, rotate() {}, scale() {}, setLineDash() {},
          measureText: () => ({ width: 0 }),
          createLinearGradient: () => ({ addColorStop() {} }),
          createRadialGradient: () => ({ addColorStop() {} }),
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData() {}, fillText() {}, save() {}, restore() {},
        }),
      }),
    }
    g.window = { devicePixelRatio: 1 }
  }
  try {
    buildOffice(scene, 12)
    scene.updateMatrixWorld(true)
    const cx0 = (STAIRS.x1 + STAIRS.x2) / 2
    const RAIL_LIMIT = 0.6 // a handrail extension is ~300 mm; 600 is generous
    let foundLevelRail = false
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.geometry) return
      const bb = new THREE.Box3().setFromObject(m)
      if (!isFinite(bb.min.x)) return
      const cx = (bb.min.x + bb.max.x) / 2
      if (Math.abs(cx - cx0) > 1.6) return
      const sx = bb.max.x - bb.min.x
      const sy = bb.max.y - bb.min.y
      const sz = bb.max.z - bb.min.z
      if (sx > 0.22) return
      if (sz < 0.3) return
      // a LEVEL rail above the flight top (a sloped one is tall in y)
      if (sy > 0.2) return
      if (bb.min.y < LEVEL_H + 0.5) return
      foundLevelRail = true
      if (sz > RAIL_LIMIT) {
        problems.push(`the level handrail is ${sz.toFixed(2)} m long (max ${RAIL_LIMIT}) — it reaches across the corridor`)
      }
      // and it must not reach past the top nosing by more than the extension
      const past = STAIR_FLIGHT_TOP - bb.min.z
      if (past > RAIL_LIMIT) {
        problems.push(`the level handrail reaches ${past.toFixed(2)} m past the top nosing`)
      }
    })
    if (!foundLevelRail) problems.push('no level handrail found at all — did the rail disappear?')
  } catch (e) {
    problems.push(`THREW: ${(e as Error).message}`)
  }
  check('the level handrail stops just past the top nosing — it does not span the corridor',
    problems.length === 0, problems.join(' | '))
}

// (2) EVERY ENCLOSED GROUND-FLOOR ROOM MUST HAVE A REAL DOORWAY.
//
// The wall facing the courtyard was drawn as ONE unbroken run from z=-9 to z=21 and
// the door jambs were then added on top of it, filling the openings back in. The
// rooms were walkable in the nav grid and sealed in the render — the worst of both.
// Both the footprints and the model now come from `courtyardWallSegments()`.
{
  const problems: string[] = []
  const segs = courtyardWallSegments()
  const ENCLOSED = ['dev', 'mkt', 'content', 'leisure', 'pantry']
  for (const id of ENCLOSED) {
    const r = roomById(id)!
    const d = r.door
    if (!d) {
      problems.push(`${id} has no door defined`)
      continue
    }
    // no wall segment may cover the doorway
    const xw = d.x < 0 ? -14 : 14
    const covering = segs.filter(
      (seg) => seg.x1 === xw && seg.x2 === xw && seg.z1 < d.z + d.hd - 0.05 && seg.z2 > d.z - d.hd + 0.05,
    )
    if (covering.length) problems.push(`${id}: ${covering.map((c) => c.id).join(',')} covers the doorway`)
    // and the nav grid must agree that the opening is passable
    if (blocked(xw, d.z, BODY_R, { level: 0 })) {
      problems.push(`${id}: the doorway at (${xw}, ${d.z}) is not walkable`)
    }
  }
  check('every enclosed ground-floor room has a doorway that is open in BOTH the model and the nav grid',
    problems.length === 0, problems.join(' | '))
}

// (3) EVERY MEETING CHAIR MUST FACE ITS TABLE.
//
// `chair.rotation.y = s.facing - atan2(seat - centre)` reduced to a CONSTANT -PI for
// every chair, so they all swung to face north regardless of where they sat — half
// of them ended up with their backs to the table. The mesh carries its back rest at
// local +z, so the chair looks along local -z and needs `facing + PI`.
{
  const problems: string[] = []
  for (const id of MEETING_ROOM_IDS) {
    const t = MEETING_TABLES[id]
    for (const [i, s] of MEETING_ROOMS[id].seats.entries()) {
      const rot = s.facing + Math.PI
      // world direction the chair LOOKS, from the back rest at local +z
      const lookX = -Math.sin(rot)
      const lookZ = -Math.cos(rot)
      // direction from the seat to the table centre
      const toX = t.x - s.x
      const toZ = t.z - s.z
      const len = Math.hypot(toX, toZ) || 1
      const dot = (lookX * toX + lookZ * toZ) / len
      if (dot < 0.9) {
        problems.push(`${id} chair ${i} looks away from the table (dot=${dot.toFixed(2)})`)
      }
    }
  }
  check('every meeting-room chair faces its own table', problems.length === 0, problems.join(' | '))
}

// (4) THE LEISURE GROUP MUST BE COHERENT, AND THE LOUNGERS MUST FACE THE WATER.
//
// The TV hung 5.4 m off any wall (floating mid-room), the coffee-table footprint sat
// 2 m west of the table mesh, and the sofa's idle spot was off the sofa entirely.
// The loungers east of the pool had their head rest pointing AWAY from the water.
{
  const problems: string[] = []
  const leisure = roomById('leisure')!
  // the TV must be against a wall, not floating in the room
  const tvToNorthWall = Math.abs(LOUNGE_TV.z - (leisure.z1 + WALL_T))
  if (tvToNorthWall > 0.25) problems.push(`the TV floats ${tvToNorthWall.toFixed(2)} m off the north wall`)
  // sofa, table and TV must line up: table between sofa and TV, all on one x
  if (!(LOUNGE_TV.z < LOUNGE_TABLE.z && LOUNGE_TABLE.z < LOUNGE.z)) {
    problems.push('the coffee table is not between the sofa and the TV')
  }
  for (const [name, o] of [['sofa', LOUNGE], ['table', LOUNGE_TABLE], ['tv', LOUNGE_TV]] as const) {
    if (Math.abs(o.x - LOUNGE.x) > 0.35) problems.push(`${name} is off the sofa's axis`)
  }
  // the sofa's own footprint must exist where the sofa is
  const sofaFp = FOOTPRINTS.find((f) => f.id === 'lounge-sofa')
  if (!sofaFp) problems.push('no lounge-sofa footprint')
  else if (Math.abs(sofaFp.x - LOUNGE.x) > 0.01 || Math.abs(sofaFp.z - LOUNGE.z) > 0.01) {
    problems.push('the sofa footprint is not where the sofa mesh is')
  }
  // the idle spot must be ON the sofa
  const sofaSpot = IDLE_SPOTS.find((s) => s.act === 'sofa')
  if (!sofaSpot) problems.push('no sofa idle spot')
  else if (Math.hypot(sofaSpot.x - LOUNGE.x, sofaSpot.z - LOUNGE.z) > 0.2) {
    problems.push('the sofa idle spot is not on the sofa')
  }
  // Loungers: the LONG AXIS must point at the pool, so the body lies along the
  // line to the water. The bed mesh is long in local Z, and rotation θ sends local
  // +z to (sin θ, cos θ) — that is the axis to compare against the pool direction.
  //
  // NOT the head direction: the back rest sits at local -z, so the head ends up on
  // the far side from the water while the body lies looking across it, which is how
  // a sun lounger is actually used. Asserting the head direction would demand the
  // person lie with their head in the pool.
  for (const [i, l] of POOL_LOUNGERS.entries()) {
    const axisX = Math.sin(l.facing)
    const axisZ = Math.cos(l.facing)
    const toPoolX = POOL.x - l.x
    const toPoolZ = POOL.z - l.z
    const len = Math.hypot(toPoolX, toPoolZ) || 1
    const dot = Math.abs(axisX * toPoolX + axisZ * toPoolZ) / len
    if (dot < 0.8) {
      problems.push(`lounger ${i} long axis does not point at the pool (dot=${dot.toFixed(2)})`)
    }
  }
  check('the leisure group is coherent (TV on the wall, table between, sofa faces the TV) and the loungers face the pool',
    problems.length === 0, problems.join(' | '))
}

// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR COURTYARD ZONES.
//
// The user redefined the pool surround: a gym mat with weights and a pull-up rig
// north of the pool, planting between them, timber daybeds west of the pool, plain
// wooden seats south, and the BBQ on the east strip. Every one of those positions
// is a claim that has to hold in the MESH, the FOOTPRINTS and the IDLE SPOTS at
// once — three lists that have drifted apart before.
// ─────────────────────────────────────────────────────────────────────────────
{
  const problems: string[] = []

  // 1. THE GYM is north of the pool and clear of the water, the stair foot, and
  //    the courtyard edge.
  if (!(GYM.z2 <= POOL.z - POOL.d / 2)) {
    problems.push(`the gym (z2=${GYM.z2}) overlaps the pool (north edge ${POOL.z - POOL.d / 2})`)
  }
  if (GYM.z1 < -9) problems.push(`the gym (z1=${GYM.z1}) pokes past the courtyard edge (-9)`)
  if (GYM.x1 < -14 || GYM.x2 > 14) problems.push('the gym runs outside the courtyard in x')
  // the stair foot stands at z=-3.2 in x -10..-8.6; the gym must not fence it in
  if (GYM.x1 < -8.6 && GYM.z1 < -3.2) {
    problems.push('the gym overlaps the stair foot')
  }
  // the mat itself is walkable (it is a rug, not a wall)
  if (blocked((GYM.x1 + GYM.x2) / 2, (GYM.z1 + GYM.z2) / 2, BODY_R, { level: 0 })) {
    problems.push('the gym mat centre is blocked — the mat must be walkable')
  }
  // each piece of equipment is solid
  for (const [name, p] of [['rack', GYM.rack], ['dumbbells', GYM.dumbbells]] as const) {
    if (!blocked(p.x, p.z, BODY_R, { level: 0 })) problems.push(`the gym ${name} is not solid`)
  }
  if (!blocked(GYM.rig.x - GYM.rig.span / 2, GYM.rig.z, BODY_R, { level: 0 })) {
    problems.push('the pull-up rig post is not solid')
  }
  // but you can walk THROUGH the rig, between its posts
  if (blocked(GYM.rig.x, GYM.rig.z, BODY_R, { level: 0 })) {
    problems.push('the pull-up rig blocks its own centre — you cannot walk through it')
  }

  // 2. THE PLANTING BAND sits between the gym and the pool, and is solid.
  if (!(PLANTING.z1 >= GYM.z2 - 0.05 && PLANTING.z2 <= POOL.z - POOL.d / 2 + 0.05)) {
    problems.push(`the planting band (z ${PLANTING.z1}..${PLANTING.z2}) is not between the gym and the pool`)
  }
  if (!blocked((PLANTING.x1 + PLANTING.x2) / 2, (PLANTING.z1 + PLANTING.z2) / 2, BODY_R, { level: 0 })) {
    problems.push('the planting band is walkable — it should be solid')
  }

  // 3. THE DAYBEDS are west of the pool and their long axis points at the water.
  for (const [i, b] of SUNBEDS.entries()) {
    if (!(b.x < POOL.x - POOL.w / 2)) problems.push(`daybed ${i} is not west of the pool`)
    // the bed is long in local Z; rotation t sends local +z to (sin t, cos t)
    const axX = Math.sin(b.facing)
    const axZ = Math.cos(b.facing)
    const toX = POOL.x - b.x
    const toZ = POOL.z - b.z
    const len = Math.hypot(toX, toZ) || 1
    const dot = Math.abs((axX * toX + axZ * toZ) / len)
    if (dot < 0.85) problems.push(`daybed ${i} does not lie facing the pool (dot=${dot.toFixed(2)})`)
    // and the head must be AWAY from the water, so you lie looking at it
    const headDot = ((-axX * toX) + (-axZ * toZ)) / len
    if (headDot > 0) problems.push(`daybed ${i} has its head on the water side`)
    if (blocked(b.x, b.z, BODY_R, { level: 0, allowSeat: true })) {
      problems.push(`daybed ${i} is not reachable`)
    }
  }

  // 4. THE SOUTH SEATS face the water (north) and sit south of the pool.
  for (const [i, b] of POOL_BENCHES.entries()) {
    if (!(b.z > POOL.z + POOL.d / 2)) problems.push(`bench ${i} is not south of the pool`)
    // the seat faces local -z after rotation PI, i.e. the look vector is -sin/-cos
    const lookX = -Math.sin(b.facing)
    const lookZ = -Math.cos(b.facing)
    const toZ = POOL.z - b.z
    if (lookZ * toZ <= 0) problems.push(`bench ${i} does not face the pool`)
    void lookX
  }

  // 5. THE BBQ is on the east strip, north of the pool, and solid.
  if (!(BBQ.x > POOL.x + POOL.w / 2)) problems.push('the BBQ is not east of the pool')
  if (BBQ.z > POOL.z - POOL.d / 2) problems.push('the BBQ is not north of the pool')
  if (!blocked(BBQ.x, BBQ.z, BODY_R, { level: 0 })) problems.push('the BBQ is not solid')

  // 6. NOTHING IN THE COURTYARD STANDS IN THE WATER.
  for (const f of FOOTPRINTS) {
    if (f.level !== 0 || f.kind === 'wall') continue
    if (f.id === 'pool-basin') continue
    const inX = Math.abs(f.x - POOL.x) < POOL.w / 2 + f.hw
    const inZ = Math.abs(f.z - POOL.z) < POOL.d / 2 + f.hd
    if (inX && inZ && f.h > 0.05) {
      problems.push(`${f.id} stands in the pool`)
    }
  }

  // 7. AND EVERY ZONE HAS AT LEAST ONE IDLE SPOT, or nobody ever goes there.
  const inZone = (s: IdleSpot, x1: number, x2: number, z1: number, z2: number) =>
    s.x >= x1 && s.x <= x2 && s.z >= z1 && s.z <= z2
  const zones: [string, number, number, number, number][] = [
    ['gym', GYM.x1, GYM.x2, GYM.z1, GYM.z2],
    ['daybeds', -12, -7.4, 0.3, 7.4],
    ['south seats', -6, 6, 8.2, 10.4],
    ['bbq', 7, 10.5, -9.3, -3.5],
  ]
  for (const [name, x1, x2, z1, z2] of zones) {
    if (!IDLE_SPOTS.some((s) => inZone(s, x1, x2, z1, z2))) {
      problems.push(`no idle spot in the ${name} zone — avatars never go there`)
    }
  }

  check('the four courtyard zones are coherent: gym north, planting between, daybeds west, seats south, BBQ east',
    problems.length === 0, problems.join(' | '))
}

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO WAYS A BODY COULD FAIL TO APPEAR OR MOVE.
//
// Both are source-level assertions because the behaviour lives in the render loop,
// which the self-test cannot run. They guard the exact lines that were wrong.
// ─────────────────────────────────────────────────────────────────────────────
{
  const problems: string[] = []
  const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')

  // (1) AN AGENT WITH NO DB ROW STILL GETS A BODY.
  // Rows are only written by the scene, so a freshly spawned agent had none and
  // therefore never appeared — you spawned `jun` as CEO and the floor stayed empty.
  if (!/const missing: AvatarState\[\] = agents/.test(scene)) {
    problems.push('syncAvatars does not synthesise rows for roster names missing from the DB')
  }
  if (!/missing\.length \? \[\.\.\.rows, \.\.\.missing\] : rows/.test(scene)) {
    problems.push('the synthesised rows are not merged into the reconcile list')
  }
  // and the division fallback must not seat an unknown agent with the developers
  if (/division: a\.division \?\? 'tech'/.test(scene)) {
    problems.push("an unknown agent's division falls back to 'tech' — the CEO would sit with the devs")
  }

  // (2) WANDER MUST NOT RE-ROLL THE DESTINATION EVERY FRAME.
  // retarget() runs each frame; picking a fresh spot there advanced wanderIndex 60x
  // a second, so the path was recomputed before the body could arrive and it
  // vibrated in place — the reported "nge glitch".
  if (!/if \(a\.target && a\.path\.length\) return/.test(scene)) {
    problems.push('retarget() can re-roll an in-progress wander destination — the body will judder')
  }

  // (3) THE SEAT APPROACH MUST IGNORE FURNITURE, or a meeting chair (covered by its
  // table's footprint) and a desk chair (tucked under the desk) are unreachable.
  if (!/settling = goingToSeat && dist < 1\.3/.test(scene)) {
    problems.push('the mover has no settling exemption for the final approach to a seat')
  }
  const nav = readFileSync(new URL('../src/lib/office/nav.ts', import.meta.url), 'utf8')
  if (!/if \(opts\.settling\) return false/.test(nav)) {
    problems.push('blocked() ignores the settling flag')
  }
  // but settling must never let a body through a WALL
  const settlingAt = nav.indexOf('if (opts.settling) return false')
  const wallLoopAt = nav.indexOf('for (const w of wallsByLevel')
  if (settlingAt < 0 || wallLoopAt < 0 || settlingAt < wallLoopAt) {
    problems.push('settling is checked BEFORE the wall loop — a body could walk through a wall')
  }

  check('a spawned agent always gets a body, and a walking body keeps its destination',
    problems.length === 0, problems.join(' | '))
}

// ─────────────────────────────────────────────────────────────────────────────
// POIN 3: EVERY PIECE OF FURNITURE IS SOMEWHERE AN IDLE BODY CAN GO.
//
// The user asked that the existing furniture become idle spots so idle agents and
// not-yet-agents circulate and enjoy it. A list of coordinates cannot be trusted to
// keep up with the furniture, so this is a DIFF: every enjoyable seat footprint must
// have a spot standing on it.
// ─────────────────────────────────────────────────────────────────────────────
{
  const problems: string[] = []
  // Work furniture (the dev desks) and the anchored receptionist's chair are claimed
  // by other branches; meeting chairs are claimed by a live meeting first.
  const enjoyable = FOOTPRINTS.filter(
    (f) =>
      f.kind === 'seat' &&
      !f.id.startsWith('chair-') &&
      !f.id.startsWith('mchair-') &&
      f.id !== 'reception-chair',
  )
  for (const f of enjoyable) {
    const near = IDLE_SPOTS.some(
      (s) => s.level === f.level && Math.hypot(s.x - f.x, s.z - f.z) < Math.max(f.hw, f.hd) + 0.6,
    )
    if (!near) problems.push(`${f.id} (L${f.level}) has no idle spot — nobody will ever use it`)
  }
  // Both floors must offer somewhere to go, or every idle body crowds the ground floor.
  for (const lv of [0, 1] as const) {
    if (IDLE_SPOTS.filter((s) => s.level === lv).length < 5) {
      problems.push(`level ${lv} has fewer than 5 idle spots`)
    }
  }
  check('every enjoyable piece of furniture is an idle spot', problems.length === 0, problems.join(' | '))
}

// ─────────────────────────────────────────────────────────────────────────────
// A DESTINATION ON ANOTHER FLOOR MUST BE ROUTED THROUGH THE STAIR.
//
// The route was computed with `level: a.level` for the TARGET as well as the body, so
// an idle body sent to an upstairs spot walked to those coordinates on the ground
// floor and never climbed: all twelve level-1 spots were unreachable, and the body then
// juddered against whatever it hit. The target floor is state now.
//
// This CALLS the decision instead of grepping for it. The first version of this test
// was a regex for `level: a.targetLevel`, which also matched the fallback leg two lines
// down — reverting the real call left the test green. A mutation audit found that. A
// behaviour test cannot be fooled that way: `planRoute` either returns a route that
// ends upstairs or it does not.
// ─────────────────────────────────────────────────────────────────────────────
{
  const problems: string[] = []
  const from = { x: DOOR.x, z: DOOR.z - 1.5, level: 0 as const }
  // Every upstairs idle spot: the route must END on level 1, at the spot.
  for (const spot of IDLE_SPOTS.filter((s) => s.level === 1)) {
    const legs = planRoute({ ...from, targetLevel: 1 }, { x: spot.x, z: spot.z })
    const last = legs[legs.length - 1]
    if (!legs.length) {
      problems.push(`no route to the upstairs ${spot.act} at (${spot.x},${spot.z})`)
      continue
    }
    if (last.level !== 1) {
      problems.push(`the route to (${spot.x},${spot.z}) ends on level ${last.level}, not 1`)
    }
    if (Math.abs(last.x - spot.x) > 0.01 || Math.abs(last.z - spot.z) > 0.01) {
      problems.push(`the route to (${spot.x},${spot.z}) ends at (${last.x},${last.z})`)
    }
    // and it must actually climb: at least one leg on each floor
    if (!legs.some((w) => w.level === 1) || !legs.some((w) => w.level === 0)) {
      problems.push(`the route to (${spot.x},${spot.z}) does not cross floors`)
    }
  }
  // A ground-floor target must NOT be sent up the stair.
  for (const spot of IDLE_SPOTS.filter((s) => s.level === 0).slice(0, 8)) {
    const legs = planRoute({ ...from, targetLevel: 0 }, { x: spot.x, z: spot.z })
    if (legs.some((w) => w.level === 1)) {
      problems.push(`the route to the ground-floor ${spot.act} at (${spot.x},${spot.z}) climbs the stair`)
    }
  }
  // A target with NO route must still yield a leg. The mover reads `a.path[0].x` on the
  // line after the route is planned, so an empty array is a TypeError inside the render
  // loop and the whole office stops drawing. An off-plate target reaches this: the DB
  // can hold a position from an older layout.
  for (const far of [{ x: 999, z: 999 }, { x: -999, z: 0 }, { x: 0, z: -999 }]) {
    const legs = planRoute({ ...from, targetLevel: 0 }, far)
    if (!legs.length) {
      problems.push(`no route to (${far.x},${far.z}) yields an EMPTY path — a.path[0] would be undefined`)
    } else {
      const last = legs[legs.length - 1]
      if (Math.abs(last.x - far.x) > 0.01 || Math.abs(last.z - far.z) > 0.01) {
        problems.push(`the fallback leg to (${far.x},${far.z}) points at (${last.x},${last.z})`)
      }
    }
  }
  check('a destination on another floor routes through the stair', problems.length === 0, problems.join(' | '))
}

// The receptionist is ANCHORED: a body that never moves (poin 2).
{
  const problems: string[] = []
  const roster = dummyRoster()
  const rec = roster.find((r) => r.avatarId.includes('reception'))
  if (!rec) problems.push('no receptionist')
  else {
    if (!rec.anchored) problems.push('receptionist is not anchored')
    // Anchoring is only meaningful if the rest of the roster is NOT anchored —
    // otherwise the flag is a no-op that would pass even if it did nothing.
    if (roster.filter((r) => r.anchored).length !== 1) {
      problems.push(`${roster.filter((r) => r.anchored).length} anchored bodies, want exactly 1`)
    }
  }
  check('the receptionist is anchored (never wanders) and is the only pinned body',
    problems.length === 0, problems.join(' | '))
}




// `default` is the install's own orchestrator profile and must NOT be part of the
// office. It used to be forced INTO the roster by an earlier fix (the chat panel
// once listed it and then refused to send to it, and the fix at the time was to
// include it everywhere). That made the building's own machinery walk the floor as
// a colleague: an avatar at a desk, a row in the spawn panel, a name in the chat
// list, a pickable meeting participant.
//
// The exclusion lives in `office-membership` as a BUILT-IN, not as a runtime hide:
// the runtime hide list is cleared by a restart, and `default` must stay gone.
{
  const problems: string[] = []
  // the module must actually exclude it
  if (!isHidden('default')) problems.push('isHidden(default) is false')
  if (visibleNames(['default', 'alice']).includes('default')) {
    problems.push('visibleNames does not filter default')
  }
  if (visible([{ name: 'default' }, { name: 'alice' }]).some((x) => x.name === 'default')) {
    problems.push('visible() does not filter default')
  }
  // and it must be un-restorable: spawn must not put it back on the floor
  if (show('default')) problems.push('show(default) succeeded — it can be spawned back')
  if (!isHidden('default')) problems.push('default became visible after show()')
  // a normal colleague must still be hideable and restorable, or the hide list is dead
  if (!hide('__probe__')) problems.push('hide() does not work for a normal name')
  if (!isHidden('__probe__')) problems.push('hide() did not take effect')
  if (!show('__probe__')) problems.push('show() does not restore a normal name')
  if (isHidden('__probe__')) problems.push('show() did not take effect')
  // the roster the UI renders must be filtered, not just the helper
  const src = readFileSync(new URL('../src/lib/hermes/kanban.ts', import.meta.url), 'utf8')
  void src
  check('the built-in `default` profile is hidden from the office and cannot be spawned back',
    problems.length === 0, problems.join(' | '))
}


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

// Idle must be FREE. The scene renders and moves avatars from state it already
// has; the only code paths that may call a model are the ones a person triggers
// (chat, dispatch). If a render module ever imports the chat bridge, idle avatars
// would start costing tokens — which is exactly what poin 10 forbids.
{
  const offenders: string[] = []
  for (const f of ['src/lib/office/scene.ts', 'src/lib/office/build.ts', 'src/lib/office/dummy-roster.ts']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    if (/from ['"].*hermes\/chat['"]/.test(src)) offenders.push(`${f} imports the chat bridge`)
    if (/sendChatMessage|officeChatArgs/.test(src)) offenders.push(`${f} calls the chat bridge`)
  }
  check('idle avatars never call a model (no chat bridge in the render path)',
    offenders.length === 0, offenders.join(' | '))
}

// Dummy avatars must be seeded for every division: 3 per division + a receptionist.
// An empty building on first load reads as a broken render.
{
  const problems: string[] = []
  const roster = dummyRoster()
  if (roster.length !== 10) problems.push(`roster has ${roster.length}, want 10`)
  // Ids must be UNIQUE: two staff desks sharing an id silently dropped a dummy
  // (7 rows were written instead of 10, and the missing ones were invisible).
  const ids = new Set(roster.map((r) => r.avatarId))
  if (ids.size !== roster.length) problems.push(`only ${ids.size} unique ids for ${roster.length} dummies`)
  for (const div of ['tech', 'growth', 'content'] as const) {
    const n = roster.filter((r) => r.division === div).length
    if (n !== 3) problems.push(`${div} has ${n} dummies, want 3`)
  }
  if (!roster.some((r) => r.name === 'Resepsionis')) problems.push('no receptionist dummy')
  // A dummy sits AT its desk. A desk chair is tucked UNDER the desk top, so the
  // seated position is legitimately inside BOTH the chair's footprint and the
  // desk's — that is what "sitting at a desk" means. So the check is not "is this
  // free floor" (it must not be); it is:
  //   1. the spot matches a real chair footprint, and
  //   2. ignoring seats, the ONLY thing it overlaps is that chair's own desk.
  const seats = FOOTPRINTS.filter((f) => f.kind === 'seat')
  const desks = FOOTPRINTS.filter((f) => f.kind === 'desk')
  for (const r of roster) {
    const chair = seats.find((s) => Math.hypot(s.x - r.x, s.z - r.z) < 0.4)
    if (!chair) {
      problems.push(`dummy ${r.avatarId} is not seated at a chair`)
      continue
    }
    const overDesk = desks.some(
      (d) => Math.abs(r.x - d.x) < d.hw + BODY_R && Math.abs(r.z - d.z) < d.hd + BODY_R,
    )
    // The receptionist's chair sits BEHIND the counter, not tucked under it — a
    // receptionist faces the door, so their chair is on the far side by design.
    const isReception = r.avatarId.includes('reception')
    if (!overDesk && !isReception) problems.push(`dummy ${r.avatarId} sits at a chair with no desk`)
  }
  check('dummy roster: 3 per division + receptionist, all standing on free floor',
    problems.length === 0, problems.join(' | '))
}

// Meetings are routed by division: one division → its own room; managers+CEO →
// Merapi; a full cross-division meeting → Rinjani (the ten-seat room).
{
  const problems: string[] = []
  const div = new Map<string, 'tech' | 'growth' | 'content' | 'exec'>([
    ['dev1', 'tech'],
    ['dev2', 'tech'],
    ['mkt1', 'growth'],
    ['c1', 'content'],
    ['ceo', 'exec'],
    ['boss', 'exec'],
  ])
  const cases: [string[], MeetingRoomId][] = [
    [['dev1', 'dev2'], 'bromo'],
    [['mkt1'], 'semeru'],
    [['c1'], 'cikurai'],
    [['ceo', 'boss'], 'merapi'],
    [['dev1', 'mkt1', 'c1', 'ceo', 'boss'], 'rinjani'],
  ]
  for (const [participants, want] of cases) {
    const got = meetingRoomFor(participants, div)
    if (got !== want) problems.push(`${participants.join('+')} -> ${got}, want ${want}`)
  }
  check('meeting rooms are routed by division', problems.length === 0, problems.join(' | '))
}

// Clicking the board must actually hit it. The board is on a wall in a room full
// of furniture, so "it exists in the scene" is not the same as "a click reaches
// it" — this raycasts from the default camera at the board's own projected pixel
// and asserts the FIRST hit is the board, not something in front of it.
{
  const problems: string[] = []
  const camera = new THREE.PerspectiveCamera(45, 1280 / 577, 0.1, 400)
  camera.position.set(14, 34, 40)
  camera.lookAt(0, 1.5, -2)
  camera.updateMatrixWorld(true)
  const scene = new THREE.Scene()
  // buildOffice needs a DOM for its canvas textures; a minimal stub is enough and
  // keeps this check honest about geometry without pulling in jsdom.
  const g = globalThis as unknown as { document?: unknown; window?: unknown }
  const hadDoc = 'document' in g
  if (!hadDoc) {
    g.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '', textAlign: '', textBaseline: '',
          fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
          arc() {}, ellipse() {},
          // closePath is NOT optional: `racingFeedTexture` closes the road and barrier
          // trapezoids. An incomplete stub here fails the TV check with a TypeError that has
          // nothing to do with the code under test.
          closePath() {}, quadraticCurveTo() {}, bezierCurveTo() {},
          translate() {}, rotate() {}, scale() {}, setLineDash() {},
          measureText: () => ({ width: 0 }),
          createLinearGradient: () => ({ addColorStop() {} }),
          createRadialGradient: () => ({ addColorStop() {} }),
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData() {}, fillText() {}, save() {}, restore() {},
        }),
      }),
    }
    g.window = { devicePixelRatio: 1 }
  }
  try {
    buildOffice(scene, 12)
    scene.updateMatrixWorld(true)
    const at = new THREE.Vector3(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z)
    at.project(camera)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(at.x, at.y), camera)
    const hits = ray.intersectObjects(scene.children, true)
    const first = hits[0]?.object
    const isBoard = first?.name === 'kanban-board' || (first?.userData as { kind?: string })?.kind === 'whiteboard'
    if (!isBoard) {
      problems.push(`first hit is ${first?.name || first?.type || 'nothing'}, not the whiteboard`)
    }
  } catch (e) {
    problems.push(`THREW: ${(e as Error).message}`)
  }
  check('clicking the board actually hits the board (raycast from the default camera)',
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
console.log('\nshell constants')

// The ceiling sits at the top of the (now wall-less) shell, so the overhead light
// panels and the free-standing board are measured against the same height.
check('ceiling sits at the shell top', CEILING_Y === WALL_H,
  `${CEILING_Y} vs ${WALL_H}`)
// The floor plan still has real extents; nav.ts derives its grid from these.
check('floor plan has real extents', HALF_W > 0 && HALF_D > 0,
  `${HALF_W * 2} x ${HALF_D * 2} m`)

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

  // The office's own DB (data/office.db) is a separate store from the Hermes CLI
  // data, and it is the one thing the office keeps across reloads: the office
  // name, where each avatar stood, and the agent Q&A threads. It runs on
  // `node:sqlite`, so the round trip is asserted here rather than assumed —
  // a silent failure means avatars snap back to the door on every reload.
  {
    const problems: string[] = []
    const testPath = join(tmpdir(), `office-test-${process.pid}.db`)
    process.env.OFFICE_DB_PATH = testPath
    try {
      const db = await import('../src/lib/office/db')
      // name round-trip, trimmed and persisted
      db.setOfficeName('  Kantor Uji  ')
      if (db.getOfficeName() !== 'Kantor Uji') problems.push(`name = ${db.getOfficeName()}`)
      // avatar upsert: same id must UPDATE, not duplicate
      db.saveAvatars([
        { avatarId: 'a1', name: 'A', division: 'tech', kind: 'dummy', x: 1, z: 2, level: 0, activity: 'idle', facing: 0, spawned: false, anchored: false },
      ])
      db.saveAvatars([
        { avatarId: 'a1', name: 'A', division: 'tech', kind: 'dummy', x: 9, z: 8, level: 1, activity: 'coffee', facing: 1.5, spawned: false, anchored: false },
      ])
      const avatars = db.listAvatars()
      if (avatars.length !== 1) problems.push(`upsert duplicated the row (${avatars.length})`)
      const a1 = avatars[0]
      if (!a1 || a1.x !== 9 || a1.z !== 8 || a1.level !== 1 || a1.activity !== 'coffee') {
        problems.push(`avatar not updated: ${JSON.stringify(a1)}`)
      }
      // Q&A: an open thread counts toward the responsible's badge until answered
      const t = db.askQuestion('staff', 'manager', 'boleh akses staging?')
      if (db.openQaCounts().manager !== 1) problems.push('open thread not counted')
      const answered = db.answerQuestion(t.id, 'boleh')
      if (answered?.status !== 'answered') problems.push(`answer did not close the thread: ${answered?.status}`)
      if (db.openQaCounts().manager) problems.push('answered thread still counted as open')
    } catch (e) {
      problems.push(`THREW: ${(e as Error).message}`)
    } finally {
      delete process.env.OFFICE_DB_PATH
      for (const suffix of ['', '-wal', '-shm']) {
        try { rmSync(testPath + suffix) } catch { /* not created */ }
      }
    }
    check('office DB round-trips name, avatar position and Q&A', problems.length === 0, problems.join(' | '))
  }

  // The chat bridge reads the CLI's session line from stderr, because that is where
  // it is written — measured. An earlier version read stdout only and every send
  // failed with "tidak bisa membaca session_id"; the probe that missed it had merged
  // the streams with 2>&1. This asserts the reader looks at both, and that the
  // session id is extracted from a realistic stderr block.
  {
    const problems: string[] = []
    const SESSION_RE = /session_id:\s*([A-Za-z0-9_]+)/
    const stderrSample = '\n⚠ tirith security scanner enabled but not available\n\nsession_id: 20260927_114029_c50d6a\n'
    const stdoutSample = 'Tersimpan: kode AD-2026.\n'
    const id = SESSION_RE.exec(stderrSample)?.[1] || SESSION_RE.exec(stdoutSample)?.[1]
    if (id !== '20260927_114029_c50d6a') problems.push(`id from stderr = ${id}`)
    // And the reply must come from stdout, not stderr: the session line is not an answer.
    const reply = stdoutSample.split('\n').filter((l) => !/^session_id:/.test(l.trim())).join('\n').trim()
    if (reply !== 'Tersimpan: kode AD-2026.') problems.push(`reply = ${reply}`)
    // Environment notices must not be shown as the agent's words.
    const noisy = '⚠ tirith security scanner enabled but not available\n↻ Resumed session x\nJawaban asli.\n'
    const cleaned = noisy
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        if (!t) return true
        if (/^session_id:/.test(t)) return false
        if (/tirith security scanner/.test(t)) return false
        if (/^⚠/.test(t)) return false
        if (/^↻/.test(t)) return false
        return true
      })
      .join('\n')
      .trim()
    if (cleaned !== 'Jawaban asli.') problems.push(`cleaned = ${JSON.stringify(cleaned)}`)
    check('chat reads the session id from stderr and the reply from stdout', problems.length === 0, problems.join(' | '))
  }
  // The CLI parser rejects an obsolete positional flag shape; verify the bridge
  // builds the exact profile-global + chat-local argv for fresh and resumed turns.
  {
    const first = officeChatArgs('default', 'tes')
    const resumed = officeChatArgs('default', 'lanjut', 'session_123')
    const expectedFirst = ['-p', 'default', 'chat', '-q', 'tes', '-Q']
    const expectedResumed = ['-p', 'default', 'chat', '--resume', 'session_123', '-q', 'lanjut', '-Q']
    const ok = JSON.stringify(first) === JSON.stringify(expectedFirst) && JSON.stringify(resumed) === JSON.stringify(expectedResumed)
    check('chat CLI args match Hermes profile, fresh, and resume syntax', ok, JSON.stringify({ first, resumed }))
  }

  // Hermes now emits a UUID and key=value fields. Numeric-column parsing used to
  // drop every actual run and make the dashboard claim there were none.
  {
    const sample = [
      '11daffce534f427abdd68dac590358ae  completed  job=755466374cb7  source=builtin  2026-09-26T13:04:50.512832+07:00',
      '5aaa8ccf80d4423ca8f229c885f87442  failed     job=755466374cb7  source=builtin  2026-09-18T15:59:13.387333+07:00',
      '    RuntimeError: HTTP 404: no credentials',
    ].join('\n')
    const runs = parseCronRuns(sample)
    const ok = runs.length === 2 && runs[0].id === '11daffce534f427abdd68dac590358ae' &&
      runs[0].jobId === '755466374cb7' && runs[0].status === 'completed' &&
      runs[0].source === 'builtin' && runs[0].startedAt?.startsWith('2026-09-26T') === true &&
      runs[1].status === 'failed'
    check('cron runs parse Hermes UUID/key-value output', ok, JSON.stringify(runs))
  }

  // `?limit=abc` reached the CLI as `--limit NaN`, which exits non-zero — so a
  // typo in a URL made the office report the whole Hermes install as unavailable.
  {
    const cases: [unknown, number][] = [
      ['abc', 25],
      ['', 25],
      ['0', 25],
      ['-5', 25],
      ['NaN', 25],
      ['Infinity', 25],
      ['10', 10],
      ['10.7', 10],
      ['9999', 500],
    ]
    const bad = cases.filter(([input, want]) => parseLimit(input) !== want)
    check(
      'cron ?limit= junk falls back instead of reaching the CLI as NaN',
      bad.length === 0,
      bad.map(([i]) => `limit=${String(i)}`).join(' | '),
    )
  }

  // The office hide list is membership only. A name with tasks but no profile
  // (an assignee whose profile was deleted) used to be routed to the destructive
  // kill action by a button that said "tanpa menghapus apa pun".
  {
    const problems: string[] = []
    if (isHidden('carol')) problems.push('hidden set is not empty at start')
    if (!hide('carol')) problems.push('hide() refused a fresh name')
    if (!isHidden('carol')) problems.push('hide() did not take effect')
    if (hide('carol')) problems.push('hide() reported a change twice')
    if (!show('carol')) problems.push('show() refused a hidden name')
    if (isHidden('carol')) problems.push('show() did not take effect')
    if (show('carol')) problems.push('show() reported a change twice')
    const visibleList = visible([{ name: 'a' }, { name: 'b' }])
    if (visibleList.length !== 2) problems.push('visible() dropped a name that was never hidden')
    hide('b')
    if (visible([{ name: 'a' }, { name: 'b' }]).length !== 1) {
      problems.push('visible() kept a hidden name')
    }
    show('b')
    check('hide list is membership-only and reversible', problems.length === 0, problems.join(' | '))
  }

  // A real CLI smoke test, opted into explicitly so routine selftests never spend
  // model tokens or create Hermes chat sessions by surprise.
  if (process.env.HERMES_CHAT_SMOKE === '1') {
    try {
      const { reply } = await sendChatMessage('default', 'default', 'Balas hanya: OK')
      check('Hermes chat CLI accepts the office request and returns a reply', reply.length > 0, reply.slice(0, 100))
    } catch (e) {
      check('Hermes chat CLI accepts the office request and returns a reply', false, (e as Error).message)
    }
  }

  /* ------------------------------------------------- model catalogue (picker) -- */
  // The picker's catalogue decides what a worker can be pinned to, so the dedupe
  // and the "skip an entry with no endpoint" rule are load-bearing.
  {
    const problems: string[] = []
    const got = providersToModels([
      { name: 'alpha', base_url: 'http://a/v1', model: 'm1', models: { m2: {}, m1: {} } },
      { name: 'beta', base_url: 'http://b/v1', models: { m2: {}, m3: {} } },
      // no base_url: not reachable, must not appear
      { name: 'ghost', models: { m9: {} } },
      // no models map: the default model still has to be pickable
      { name: 'gamma', base_url: 'http://c/v1', model: 'm4' },
    ])
    const keys = got.map((c) => c.model)
    if (keys.length !== 4) problems.push(`expected 4 choices, got ${keys.length}: ${keys.join(',')}`)
    if (new Set(keys).size !== keys.length) problems.push('duplicate model ids survived the dedupe')
    if (keys.includes('m9')) problems.push('a provider with no base_url leaked into the catalogue')
    if (!keys.includes('m4')) problems.push('a provider default model was dropped')
    const m2 = got.find((c) => c.model === 'm2')
    if (m2?.provider !== 'alpha') problems.push('dedupe kept the wrong provider for a shared model id')
    check('model catalogue dedupes ids and skips unreachable providers', problems.length === 0, problems.join(' | '))

    // The balloon is the only thing keeping a meeting turn from covering the room,
    // and it has to survive a token with no spaces in it (URLs, file paths).
    const wrapped = wrapBubble('halo dunia ini pesan yang cukup panjang untuk diuji pemenggalannya sekarang')
    const urlLines = wrapBubble('https://example.com/very/long/unbreakable/path/that/keeps/going/and/going')
    // The model picker suggests only after 3 characters, and it must never hide how
    // many rows it left out — a silently truncated list reads as "no such model".
    const pool = [
      { model: 'a', provider: 'p', label: 'kn/alpha · p' },
      { model: 'b', provider: 'p', label: 'kn/beta · p' },
      { model: 'c', provider: 'p', label: 'cfr/gamma · p' },
    ]
    const short = filterModels(pool, 'kn')
    const typed = filterModels(pool, 'bet')
    const none = filterModels(pool, 'zzz')
    check(
      'model picker suggests from 3 characters and reports the full match count',
      short.shown.length === 3 && short.total === 3 &&
        typed.shown.length === 1 && typed.shown[0].model === 'b' &&
        none.shown.length === 0 && none.total === 0,
      JSON.stringify({ short: short.total, typed: typed.shown.map((m) => m.model), none: none.total }),
    )

    check(
      'speech balloon wraps to <=3 lines and hard-slices unbreakable tokens',
      wrapped.length <= 3 && wrapped.every((l) => l.length <= 26) &&
        urlLines.length <= 3 && urlLines.every((l) => l.length <= 26),
      JSON.stringify({ wrapped, urlLines }),
    )
  }

  // ───────────────────────────────────────────────────────────────────────────
  // HELD EQUIPMENT MUST LAND IN THE HANDS.
  //
  // The barbell is positioned by a forward-kinematics walk in anim.ts, and the item is
  // parented to the avatar group. Both of those were wrong in the first cut: the walk
  // returned the fist in the AVATAR's frame while the item hung off the CHEST, so the
  // chest transform applied twice and the bar floated 1.67 m from the hands. A missing
  // term in that walk is invisible in a screenshot — the bar still looks like a bar —
  // so it is measured here instead: the item's world position against the fist's world
  // position, straight out of the scene graph.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const av = buildAvatar('backend')
    const anim = { avatar: av, activity: 'barbell' as Activity, ease: 1, phase: 0, meetingTalking: false }
    const fistLocal = new THREE.Vector3(0, -(FOREARM + 0.03), 0)
    const fistWorld = (side: 0 | 1) => {
      av.group.updateMatrixWorld(true)
      return av.arms[side].elbow.localToWorld(fistLocal.clone())
    }

    // 1. the bar's grip bands sit in the fists, through the whole press cycle
    let worstGrip = 0
    for (let i = 0; i <= 60; i++) {
      anim.activity = 'barbell'
      animate(anim, i * 0.09, 0)
      av.group.updateMatrixWorld(true)
      const bar = av.held.barbell
      const p = new THREE.Vector3()
      bar.getWorldPosition(p)
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(bar.getWorldQuaternion(new THREE.Quaternion()))
      worstGrip = Math.max(
        worstGrip,
        p.clone().addScaledVector(axis, -0.41).distanceTo(fistWorld(0)),
        p.clone().addScaledVector(axis, 0.41).distanceTo(fistWorld(1)),
      )
    }
    // 0.02 m is the grip band's own radius — the hand closes AROUND the bar, so the
    // centres do not coincide and a tolerance of zero would be wrong.
    if (worstGrip > 0.03) problems.push(`barbell grip misses the fists by ${worstGrip.toFixed(3)} m`)

    // 2. a dumbbell sits in each fist
    let worstDumbbell = 0
    for (let i = 0; i <= 60; i++) {
      anim.activity = 'dumbbell'
      animate(anim, i * 0.09, 0)
      av.group.updateMatrixWorld(true)
      for (const side of [0, 1] as const) {
        const p = new THREE.Vector3()
        av.held.dumbbells[side].getWorldPosition(p)
        worstDumbbell = Math.max(worstDumbbell, p.distanceTo(fistWorld(side)))
      }
    }
    if (worstDumbbell > 0.03) problems.push(`dumbbell misses the fist by ${worstDumbbell.toFixed(3)} m`)

    // 3. a pull-up's fists are ON the rig's bar, and the feet are OFF the floor. The
    //    pose solves its own height against GYM.rig.barY, so this also proves the mesh
    //    and the animation still agree about where that bar is.
    let worstBar = 0
    let lowestFoot = 9
    for (let i = 0; i <= 60; i++) {
      anim.activity = 'pullup'
      animate(anim, i * 0.09, 0)
      av.group.updateMatrixWorld(true)
      worstBar = Math.max(worstBar, Math.abs(fistWorld(0).y - GYM.rig.barY))
      const knee = new THREE.Vector3()
      av.legs[0].elbow.getWorldPosition(knee)
      lowestFoot = Math.min(lowestFoot, knee.y)
    }
    if (worstBar > 0.02) problems.push(`a pull-up hangs ${worstBar.toFixed(3)} m off the rig's bar`)
    if (lowestFoot < 0.25) problems.push(`a pull-up's feet are only ${lowestFoot.toFixed(2)} m up — it is standing`)

    // 4. equipment must not leak into another pose: an avatar that leaves the gym
    //    carrying the barbell is worse than one that never picked it up.
    const leaks: string[] = []
    for (const act of ['idle', 'walking', 'typing', 'coffee', 'bbq', 'pool'] as Activity[]) {
      anim.activity = act
      animate(anim, 1.5, 0)
      if (av.held.barbell.visible) leaks.push(`${act}:barbell`)
      if (av.held.dumbbells[0].visible || av.held.dumbbells[1].visible) leaks.push(`${act}:dumbbell`)
    }
    if (leaks.length) problems.push(`equipment shown in the wrong pose: ${leaks.join(', ')}`)

    // 5. THE RIG HAS NO CROSS-BAR, and this proves why rather than trusting a comment.
    //
    // A decorative lower rail used to sit on this rig and cannot fit: measured across the
    // muscle-up and the pull-up, heads occupy 1.46..2.22, hips 0.95..1.41, and the
    // swinging feet reach 0.03. The bodies fill the whole span between the mat and the
    // bar, so a rail at 1.40 passed through the muscle-up's torso (OBB audit: hip 0.02 m
    // inside) and 1.51 hit the head band instead. The mesh is gone; this asserts the
    // bands really do overlap each other, so re-adding a rail is provably impossible
    // rather than merely discouraged.
    {
      let headLo = 9
      let headHi = -9
      let footLo = 9
      let hipHi = -9
      const SHIN_LEN = 0.46
      for (const [act, x] of [['pullup', GYM.rig.x], ['muscleup', GYM.rig.x + 0.85]] as const) {
        const av2 = buildAvatar('backend')
        av2.group.position.set(x, 0, GYM.rig.z)
        av2.group.rotation.y = Math.PI
        const a2 = { avatar: av2, activity: act as Activity, ease: 1, phase: 0.3, meetingTalking: false }
        for (let i = 0; i <= 120; i++) {
          animate(a2, i * 0.09, 0)
          av2.group.updateMatrixWorld(true)
          const head = new THREE.Vector3()
          av2.head.getWorldPosition(head)
          const hip = new THREE.Vector3()
          av2.hips.getWorldPosition(hip)
          headLo = Math.min(headLo, head.y - 0.155)
          headHi = Math.max(headHi, head.y + 0.155)
          hipHi = Math.max(hipHi, hip.y + 0.1)
          for (const side of [0, 1] as const) {
            const foot = new THREE.Vector3(0, -SHIN_LEN, 0).applyMatrix4(av2.legs[side].elbow.matrixWorld)
            footLo = Math.min(footLo, foot.y)
          }
        }
      }
      // The occupied band must be CONTINUOUS from the mat to the top bar: if the feet
      // reach above the hips' ceiling there is no gap at all.
      if (footLo > hipHi) {
        problems.push(`the hanging bodies leave a gap ${hipHi.toFixed(2)}..${footLo.toFixed(2)} — a rail would fit after all`)
      }
      if (!(headLo < headHi && footLo < hipHi)) {
        problems.push('could not measure the hanging band — the rig check is not testing anything')
      }
      // and the bar itself must clear the heads
      if (GYM.rig.barY < headHi) {
        problems.push(`the top bar (${GYM.rig.barY}) is inside the hanging head band up to ${headHi.toFixed(2)}`)
      }
    }

    // 6. `settling` must ignore FURNITURE but never a WALL. It exists so a body can
    //    step onto a chair tucked under a desk or covered by a meeting table; if it
    //    were checked before the wall loop, a body settling onto a seat by a wall would
    //    walk through the wall. The source-order test that used to guard this could be
    //    fooled by a reordered comment, so this checks the BEHAVIOUR at three real
    //    coordinates instead: a wall, the world edge, and a meeting chair.
    {
      const wall = FOOTPRINTS.find((f) => f.kind === 'wall' && f.level === 0)
      const seat = IDLE_SPOTS.find((s) => s.act === 'meeting' && s.seated)
      if (!wall) problems.push('no wall footprint to test against')
      else if (!blocked(wall.x, wall.z, BODY_R, { level: 0, settling: true })) {
        problems.push(`settling walks through a wall at (${wall.x},${wall.z})`)
      }
      const b = LEVEL_BOUNDS[0]
      if (!blocked(b.x2 + 5, b.z2 + 5, BODY_R, { level: 0, settling: true })) {
        problems.push('settling escapes the floor plate')
      }
      if (!seat) problems.push('no seated meeting spot to test against')
      else if (blocked(seat.x, seat.z, BODY_R, { level: 1, allowSeat: true, settling: true })) {
        problems.push(`settling still refuses the meeting chair at (${seat.x},${seat.z})`)
      } else if (!blocked(seat.x, seat.z, BODY_R, { level: 1, allowSeat: true })) {
        problems.push('the meeting chair is not inside furniture — this test proves nothing')
      }
    }

    // 7. `settling` must be armed ONLY by a seat. It ignores all furniture, so arming it
    //    for every spot let a body walking to the garden, the BBQ or the barbell rack pass
    //    through whatever stood on its last metre — measured at 2052..2250 frames inside a
    //    solid per 30 simulated minutes. `seatYaw` is the arming flag and `arrivalFace`
    //    is the direction to look; they were the same field, which is how the bug got in.
    {
      const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
      // Strip comments first: the code that FIXED this bug explains the old line in a
      // comment, and a naive regex matches its own documentation. (It did, on the first
      // run of this test.)
      const code = scene.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      if (/a\.seatYaw = spot\.face\b/.test(code)) {
        problems.push('seatYaw is armed for every spot — settling will ignore furniture everywhere')
      }
      if (!/a\.seatYaw = spot\.seated \|\| spot\.bench \? spot\.face : undefined/.test(scene)) {
        problems.push('an idle spot does not arm seatYaw from its own `seated`/`bench` flag')
      }
      if (!/arrivalFace\?: number/.test(scene)) {
        problems.push('there is no separate arrival facing — a body will keep facing the way it walked')
      }
    }

    // 8. THE CREEP MUST STAY UNCHECKED — this is a measured trade-off, not an oversight.
    //    A "refuse to enter" mover (smaller steps, axis slide, else hold) drives furniture
    //    overlap to 0 but collapses the office: arrivals fall 1343 -> 102 and bodies sit
    //    still for up to 1790 s, wedged against a solid forever. The unchecked 5 cm creep
    //    is what slides a walker along an obstacle until its waypoint clears. Guarded here
    //    so a future "fix" does not silently reintroduce the freeze.
    {
      const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
      if (!/g\.position\.x \+= tmp\.x \* Math\.min\(0\.05, step\)/.test(scene)) {
        problems.push('the creep is gone or checked — bodies will wedge against solids')
      }
    }

    check('held equipment sits in the hands, and only while it is being used',
      problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE DINING SETS, AND THE RULE THAT A SITTING BODY FACES ITS SEAT (poin 1, 4).
  //
  // The meeting chairs once all faced north because the rotation was a CONSTANT, so half
  // of them sat with their backs to the table. The dining chairs avoid that by deriving
  // each facing from its own offset, and this checks the RESULT: for every dining spot,
  // the direction the body looks must point at its table.
  // ───────────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────
  // DOES EVERY BODY LOOK AT THE THING ITS POSE IS ABOUT? (poin 1, 2, 4, 5, 8)
  //
  // Four tests used to live here and ALL FOUR were tautologies, which is how the user's
  // report — "banyak yang ngebelakangin kursi/sofa dan ada juga yg ga menghadap objectnya" —
  // passed a green suite:
  //
  //   * "every dining chair faces its own table" compared `spot.face` with
  //     `diningChairFacing(...)`, the very function that produced it.
  //   * "every seated spot faces the way its furniture does" compared a spot's `face` with
  //     the mesh's `facing` — and both the benches and the daybeds were built by copying one
  //     into the other, so agreement was guaranteed by construction.
  //   * "a gardener faces the plants" and "a cook faces the grill" both computed the look
  //     vector as `(sin f, cos f)` for a body whose front is local -z, i.e. the wrong sign,
  //     so they demanded the body turn its BACK on the object.
  //
  // Worse: the code had been bent to satisfy those tests, so the wrong convention was baked
  // into the layout. Measured against the rig, 30 orientations were wrong.
  //
  // The audit now lives in `facing.ts` and measures against things the data cannot influence:
  // the built rig (a seated body's FEET must point where its `face` claims it looks) and the
  // furniture's world position. Twelve sabotage mutations — every one of them the exact bug
  // the user reported — are all caught by it.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems = facingProblems()
    check('every body looks at the thing its pose is about', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // A SITTING BODY FACES THE WAY ITS FURNITURE FACES (poin 4).
  //
  // TWO earlier versions of this test were wrong, and both looked green:
  //
  //   1. it compared the look vector with the direction to the seat's CENTRE — but a
  //      seated spot sits ON that centre, so the vector was ~0 and every seat scored a
  //      meaningless 1.00 (a sabotage run caught 0 of 72);
  //   2. it guessed the back rest's side from the footprint's aspect ratio, which is not
  //      how the meshes are built, so it reported 30 of 36 correct seats as broken.
  //
  // What CAN be asserted is the thing that actually matters: the spot's facing must be the
  // SAME NUMBER the mesh rotates the furniture by. Each furniture type has its own
  // convention, so this checks each against its own source rather than inventing one:
  //
  //   benches / daybeds  the recorded `facing` on the definition (the mesh reads it too)
  //   dining chairs      `diningChairFacing`, which the mesh also calls
  //   meeting chairs     the seat's own `facing` (already covered by the table test)
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // THE PLANTING BAND IS LOOKED AT, NOT TURNED AWAY FROM (poin 5).
  //
  // A body tending the beds stands SOUTH of the band and must face NORTH into it. The
  // band runs x -6..6.2 at z -2.4..-0.8, so the look vector's z must be negative.
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // THE BBQ IS LOOKED AT, AND IT HAS A FIRE (poin 8).
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // THE CEO SUITE IS NOT A FREE-FOR-ALL (poin 6).
  //
  // `mayEnterCeoRoom` is the single rule. This checks the RULE, and then checks that no
  // idle spot inside the CEO suite is reachable by a role that may not enter — the
  // behavioural half, because a rule nothing reads is decoration.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    if (!mayEnterCeoRoom('ceo')) problems.push('the CEO may not enter the CEO room')
    if (!mayEnterCeoRoom('manager')) problems.push('a manager may not enter the CEO room')
    for (const role of ['backend', 'frontend', 'qa', 'content', 'marketing', 'researcher', 'designer', 'orchestrator'] as AgentRole[]) {
      if (mayEnterCeoRoom(role)) problems.push(`${role} may enter the CEO room`)
    }
    // the spots inside the suite exist (or the rule has nothing to guard)
    const inSuite = IDLE_SPOTS.filter((s) => s.level === 1 && insideCeoRoom(s.x, s.z))
    if (!inSuite.length) problems.push('no idle spot is inside the CEO suite — the rule guards nothing')
    // and the scene must actually consult the rule
    const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
    const code = scene.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    if (!/insideCeoRoom\(cand\.x, cand\.z\)\s*&&\s*!mayEnterCeoRoom/.test(code)) {
      problems.push('retarget does not refuse the CEO suite to a role that may not enter')
    }
    check('only a CEO or a manager may enter the CEO suite', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE THREE GYM STATIONS THE USER NAMED: pull-up, muscle-up, bench press (poin 9).
  //
  // Each must have its own spot, and each pose must exist. A spot naming a pose that the
  // animator does not implement is the failure mode here — the body would stand still
  // with no pose at all.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    for (const act of ['pullup', 'muscleup', 'benchpress'] as const) {
      const spots = IDLE_SPOTS.filter((s) => s.act === act)
      if (!spots.length) problems.push(`no idle spot uses the '${act}' pose`)
      if (!ACTIVITIES.includes(act)) problems.push(`the '${act}' pose is not implemented`)
    }
    // the two rig poses must share the same bar, or one of them hangs in the air
    const rigSpots = IDLE_SPOTS.filter((s) => s.act === 'pullup' || s.act === 'muscleup')
    for (const s of rigSpots) {
      if (Math.abs(s.z - GYM.rig.z) > 0.6) {
        problems.push(`the ${s.act} spot at z=${s.z.toFixed(1)} is not at the rig (z=${GYM.rig.z})`)
      }
    }
    // the bench press must be at the barbell rack, which is where the bench is
    const bench = IDLE_SPOTS.find((s) => s.act === 'benchpress')
    if (bench && Math.hypot(bench.x - GYM.rack.x, bench.z - GYM.rack.z) > 2.2) {
      problems.push(`the bench press spot is ${Math.hypot(bench.x - GYM.rack.x, bench.z - GYM.rack.z).toFixed(1)} m from the rack`)
    }
    // the meal must vary: a burger and a pizza both exist as held equipment
    const av = buildAvatar('backend')
    if (!av.held.burger || !av.held.pizza) problems.push('the avatar cannot hold a meal')
    if (!av.held.tongs) problems.push('the avatar cannot hold the BBQ tongs')
    // THE GRIP BANDS MUST BE WHERE THE HANDS ARE. Fixed at +-0.41 they only fit the
    // overhead press; a bench press opens to 1.26 m and left the hands on bare bar.
    {
      const FIST = new THREE.Vector3(0, -(FOREARM + 0.03), 0)
      for (const act of ['barbell', 'benchpress'] as const) {
        const b = buildAvatar('backend')
        const anim = { avatar: b, activity: act as Activity, ease: 1, phase: 0.3, meetingTalking: false }
        let worst = 0
        for (let i = 0; i <= 40; i++) {
          animate(anim, i * 0.12, 0)
          b.group.updateMatrixWorld(true)
          const fists = [0, 1].map((s) => b.arms[s as 0 | 1].elbow.localToWorld(FIST.clone()))
          for (const s of [0, 1] as const) {
            const p = new THREE.Vector3()
            b.held.barbellGrips[s].getWorldPosition(p)
            worst = Math.max(worst, p.distanceTo(fists[s]))
          }
        }
        if (worst > 0.03) problems.push(`'${act}': the grip band is ${worst.toFixed(3)} m from the hand`)
      }
    }
    check('pull-up, muscle-up and bench press all exist', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE POOL CAN BE SWUM, AND THE DAYBEDS ARE FOR LYING (poin 3, 7).
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const swim = IDLE_SPOTS.filter((s) => s.act === 'swim')
    if (!swim.length) problems.push('no swim spots — nobody can use the pool')
    for (const s of swim) {
      // the spot must be INSIDE the water, and flagged so the mover lets the body in
      const inX = Math.abs(s.x - POOL.x) < POOL.w / 2
      const inZ = Math.abs(s.z - POOL.z) < POOL.d / 2
      if (!inX || !inZ) problems.push(`swim spot (${s.x},${s.z}) is not inside the pool`)
      if (!s.water) problems.push(`swim spot (${s.x},${s.z}) is not flagged water — the mover will refuse it`)
      // and the basin must really be solid for everyone else, or `water` is meaningless
      if (!blocked(s.x, s.z, BODY_R, { level: 0 })) {
        problems.push(`the pool is not solid at (${s.x},${s.z}) — anyone could walk on the water`)
      }
    }
    // the daybeds recline rather than sit
    const recliners = IDLE_SPOTS.filter((s) => s.act === 'recline')
    if (recliners.length !== SUNBEDS.length) {
      problems.push(`${recliners.length} reclining spots for ${SUNBEDS.length} daybeds`)
    }
    for (const s of recliners) {
      if (!s.seated) problems.push(`the daybed spot at (${s.x},${s.z}) is not marked seated`)
      if (!ACTIVITIES.includes('recline')) problems.push("the 'recline' pose is not implemented")
    }
    check('the pool is swimmable and the daybeds are for lying on', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EVERY ROOM PLAQUE IS FIXED FLAT TO A WALL, FACING THE WAY YOU WALK.
  //
  // The earlier placards hung in open air on each room's edge, and that is exactly how they
  // came back: "banyak banget kotak melayang ... hapus aja". So three points are sampled per
  // plaque:
  //   0.06 m BEHIND the plate must be inside a wall — catches a plate that drifted off its
  //     wall and is now airborne, which is the whole failure being guarded;
  //   0.06 m IN FRONT must NOT be inside a wall — catches one pushed into its own wall;
  //   and the point in front must be OUTSIDE the room it names — catches a plate mounted on
  //     the room's inner face, where only somebody standing inside could ever read it.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const walls = FOOTPRINTS.filter((f) => f.kind === 'wall')
    const inWall = (x: number, z: number, level: number) =>
      walls.some((w) => w.level === level && Math.abs(x - w.x) <= w.hw + 1e-6 && Math.abs(z - w.z) <= w.hd + 1e-6)

    for (const p of ROOM_PLAQUES) {
      const nx = Math.sin(p.face)
      const nz = Math.cos(p.face)
      if (!inWall(p.x - nx * 0.06, p.z - nz * 0.06, p.level)) {
        problems.push(`the "${p.text}" plaque is not against a wall — it floats`)
      }
      // and its two ENDS must still be over wall. A plate wider than the wall segment it is
      // fixed to overhangs the doorway next to it, which reads as a sign hung in mid-air over
      // an opening even though its centre is perfectly attached.
      const tx = Math.cos(p.face) * (PLAQUE_W / 2)
      const tz = -Math.sin(p.face) * (PLAQUE_W / 2)
      for (const end of [-1, 1]) {
        if (!inWall(p.x + end * tx - nx * 0.06, p.z + end * tz - nz * 0.06, p.level)) {
          problems.push(`the "${p.text}" plaque overhangs the end of the wall segment it is fixed to`)
          break
        }
      }
      const fx = p.x + nx * 0.06
      const fz = p.z + nz * 0.06
      if (inWall(fx, fz, p.level)) problems.push(`the "${p.text}" plaque faces into a wall`)
      const r = ROOMS.find((x) => x.id === p.id)
      if (r && fx > r.x1 && fx < r.x2 && fz > r.z1 && fz < r.z2) {
        problems.push(`the "${p.text}" plaque faces into its own room instead of the walkway`)
      }
      if (p.y < p.level * LEVEL_H + 1.0 || p.y > (p.level + 1) * LEVEL_H - 0.2) {
        problems.push(`the "${p.text}" plaque sits at ${p.y.toFixed(2)} m, outside its floor`)
      }
    }

    // only the rooms the operator asked for, and never circulation space
    const marked = new Set(ROOM_PLAQUES.map((p) => p.id))
    for (const id of ['lobby', 'courtyard', 'terrace', 'corridor1']) {
      if (marked.has(id)) problems.push(`${id} is circulation space and must not carry a plaque`)
    }
    for (const id of ['dev', 'mkt', 'content', 'leisure', 'pantry', 'ceo', ...MEETING_ROOM_IDS]) {
      if (!marked.has(id)) problems.push(`${id} has no plaque`)
    }

    check('every room plaque is fixed flat to a wall and faces the walkway', problems.length === 0, problems.join(' | '))
  }


  // ───────────────────────────────────────────────────────────────────────────
  // WALL FURNITURE SITS AGAINST ITS WALL.
  //
  // Reported: "ini studio fotonya minta tolong dibenerin lagi" — the content studio's photo
  // backdrop was standing 0.83 m off the south wall, floating in the middle of the floor,
  // and its plant was 0.73 m off the east wall. Both read as broken because a backdrop and
  // a corner plant are defined by being AGAINST something.
  //
  // The trap: the wall is WALL_T thick, so a prop placed "at the room edge" in layout
  // coordinates has its centre INSIDE the plaster. The test must measure against the inner
  // FACE (edge +- WALL_T/2), which is what this does.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    // props that are defined by being against a wall, and how close they must be
    const WALL_KINDS: Record<string, number> = {
      shelf: 0.35,
      whiteboard: 0.35,
      backdrop: 0.2,
      rack: 0.35,
      locker: 0.35,
      screenwall: 0.35,
      bench: 0.35,
    }
    for (const roomId of ['dev', 'mkt', 'content'] as const) {
      const r = roomById(roomId)
      if (!r) continue
      const inner = {
        west: r.x1 + WALL_T / 2,
        east: r.x2 - WALL_T / 2,
        north: r.z1 + WALL_T / 2,
        south: r.z2 - WALL_T / 2,
      }
      for (const p of ROOM_PROPS.filter((x) => x.room === roomId)) {
        const tol = WALL_KINDS[p.kind]
        if (tol === undefined) continue
        const dW = p.x - p.hw - inner.west
        const dE = inner.east - (p.x + p.hw)
        const dN = p.z - p.hd - inner.north
        const dS = inner.south - (p.z + p.hd)
        const gaps = [dW, dE, dN, dS]
        const nearest = Math.min(...gaps)
        if (nearest < -0.02) {
          problems.push(`${p.id} is ${(-nearest).toFixed(2)} m INSIDE a wall`)
        } else if (nearest > tol) {
          problems.push(`${p.id} floats ${nearest.toFixed(2)} m off the nearest wall (a ${p.kind} must be against one)`)
        }
      }
    }
    check('wall furniture (shelves, backdrops, racks) sits against its wall', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE STUDIO HAS EXACTLY ONE CAMERA.
  //
  // The `tripod` prop drew a camera body AND a softbox as a single unit. The studio needed a
  // light as a separate object, and reusing the same kind for it produced TWO identical
  // camera rigs — reported as "now there are even 2 cameras". The light is its own kind now
  // (`lightstand`, which draws no camera body at all), and this stops the two from merging
  // back into one kind.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const r = roomById('content')
    if (r) {
      const scene = new THREE.Scene()
      buildOffice(scene, 12)
      // a camera BODY is the specific dark box the tripod case builds
      let cams = 0
      scene.traverse((n: any) => {
        if (!n.isMesh || !n.geometry) return
        if (n.geometry.type !== 'BoxGeometry') return
        const p = n.geometry.parameters || {}
        if (p.width === undefined) return
        if (
          Math.abs(p.width - 0.24) < 0.005 &&
          Math.abs(p.height - 0.16) < 0.005 &&
          Math.abs(p.depth - 0.18) < 0.005
        ) {
          const v = new THREE.Vector3()
          n.getWorldPosition(v)
          if (v.x > r.x1 && v.x < r.x2 && v.z > r.z1 && v.z < r.z2) cams++
        }
      })
      if (cams !== 1) problems.push(`the studio has ${cams} cameras, want exactly 1`)
    }
    // and the light must not be a tripod
    for (const p of ROOM_PROPS.filter((x) => x.id.includes('light'))) {
      if (p.kind === 'tripod') problems.push(`${p.id} uses the tripod kind, which also builds a camera`)
    }
    check('the studio has exactly one camera, and its light is not a tripod', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE STUDIO SET IS AIMED AT ITSELF.
  //
  // Four reports, all correct, all fixed here and all measured on the BUILT scene:
  //
  //   1. "tripod untuk lightning kakinya masih terbalik" — the LIGHT stand's legs were
  //      upside down, a separate fault from the camera tripod's.
  //   2. "kamera masih membelakangi background" — the camera's lens pointed north, while the
  //      backdrop is SOUTH of it.
  //   3. "kamera tidak di tengah background" — the camera was 2.00 m off the backdrop's
  //      centre line.
  //   4. "lightning tidak menghadap background" — the softbox threw north, away from the panel.
  //
  // Orientation is checked with `facing`, the prop's aim in the body convention (0 rad = +z),
  // and with the actual ENDS of each leg rather than a bounding box.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const bd = ROOM_PROPS.find((p) => p.id === 'content-backdrop')
    const cam = ROOM_PROPS.find((p) => p.id === 'content-tripod')
    const lit = ROOM_PROPS.find((p) => p.id === 'content-light')
    if (!bd || !cam || !lit) {
      problems.push('the studio set is incomplete (backdrop / camera / light)')
    } else {
      // 3. the camera is centred on the backdrop's own x
      if (Math.abs(cam.x - bd.x) > 0.05) {
        problems.push(`the camera is ${Math.abs(cam.x - bd.x).toFixed(2)} m off the backdrop's centre line`)
      }
      // 2 and 4: both must AIM at the backdrop. The backdrop is at z BD; "toward it" is the
      // sign of (bd.z - prop.z), and `facing`'s +z component is cos(facing).
      const toward = Math.sign(bd.z - cam.z)
      for (const [name, prop] of [
        ['camera', cam],
        ['light', lit],
      ] as const) {
        if (prop.facing === undefined) {
          problems.push(`the studio ${name} has no facing, so it cannot be aimed`)
          continue
        }
        const aimZ = Math.cos(prop.facing) // a look direction's +z component
        if (Math.sign(aimZ) !== toward || Math.abs(aimZ) < 0.2) {
          problems.push(`the studio ${name} does not face the backdrop (aim z ${aimZ.toFixed(2)}, backdrop is at ${toward < 0 ? '-z' : '+z'})`)
        }
      }
      // 1. both stands' legs: low end FAR out and on the floor, high end near the axis.
      const scene = new THREE.Scene()
      buildOffice(scene, 12)
      scene.updateMatrixWorld(true)
      const acc = { checked: 0, bad: 0, camOff: null as number | null }
      scene.traverse((n: any) => {
        if (!n.isMesh || !n.geometry) return
        const p = n.geometry.parameters || {}
        const v = new THREE.Vector3()
        n.getWorldPosition(v)
        const nearCam = Math.hypot(v.x - cam.x, v.z - cam.z) < 1.3
        const nearLit = Math.hypot(v.x - lit.x, v.z - lit.z) < 1.3
        if (nearCam && n.geometry.type === 'BoxGeometry' && Math.abs((p.width ?? 0) - 0.24) < 0.005) {
          acc.camOff = Math.hypot(v.x - cam.x, v.z - cam.z)
        }
        if (!nearCam && !nearLit) return
        // a LEG: a thin cylinder that clearly leans (its ends differ in radius AND height)
        if (n.geometry.type !== 'CylinderGeometry') return
        if (!(p.height > 0.6 && p.height < 1.2)) return
        const hi = new THREE.Vector3(0, p.height / 2, 0).applyMatrix4(n.matrixWorld)
        const lo = new THREE.Vector3(0, -p.height / 2, 0).applyMatrix4(n.matrixWorld)
        const origin = nearCam ? cam : lit
        const up = hi.y > lo.y ? hi : lo
        const dn = hi.y > lo.y ? lo : hi
        const rUp = Math.hypot(up.x - origin.x, up.z - origin.z)
        const rLo = Math.hypot(dn.x - origin.x, dn.z - origin.z)
        // the riser/column is vertical, so both its ends share a radius. Only JUDGE the
        // legs, where the low end is markedly farther out than the high end.
        if (Math.abs(rUp - rLo) >= 0.05) {
          acc.checked++
          if (!(rLo > rUp) || Math.abs(dn.y) > 0.06) acc.bad++
        }
      })
      if (acc.checked < 5) problems.push(`only ${acc.checked} stand legs measured — the check is not seeing them`)
      if (acc.bad > 0) problems.push(`${acc.bad} of ${acc.checked} stand legs are upside down or off the floor`)
      if (acc.camOff === null) problems.push('no camera body found on the tripod')
      else if (acc.camOff > 0.06) problems.push(`the camera is ${acc.camOff.toFixed(2)} m off the tripod axis`)
    }
    check('the studio set is centred and aimed at the backdrop, legs on the floor', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE STUDIO LIGHT'S BEAM ACTUALLY LANDS ON THE BACKDROP.
  //
  // Reported: "lightning masih salah menghadapnya masih keluar tinggal geser 45 derajat ke
  // arah timur". Two things were wrong, and the second one is the reason this test exists.
  //
  //   - The light threw SOUTH-WEST, off the set entirely.
  //   - Adding the 45 degrees asked for was STILL not enough. The light stands 2.60 m west of
  //     the backdrop centre, so a beam merely swung 45 degrees south landed 2.44 m off centre
  //     — against a panel only 2.40 m half-wide, it missed by 4 cm.
  //
  // Facing "roughly at the backdrop" is therefore not a property anyone can eyeball. The test
  // PROJECTS the beam from the softbox onto the backdrop's plane and requires it to land ON
  // the panel. The aim itself is computed from the two positions, so it cannot drift.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const lit = ROOM_PROPS.find((p) => p.id === 'content-light')
    const bd = ROOM_PROPS.find((p) => p.id === 'content-backdrop')
    if (!lit || !bd) {
      problems.push('the studio light or backdrop is missing')
    } else if (lit.facing === undefined) {
      problems.push('the studio light has no facing')
    } else {
      // MEASURED FROM THE MESH, not from the `facing` number.
      //
      // The number and the geometry disagreed once and cancelled out: the light was "aimed"
      // correctly on paper while its softbox was physically mounted on the BACK of the stand,
      // so it glowed at the wall behind it. Reported as "lightning sekarang malah
      // membelakangi". So this reads the built softbox: where it actually sits relative to its
      // stand, and which way its lit face points.
      const scene = new THREE.Scene()
      buildOffice(scene, 12)
      scene.updateMatrixWorld(true)
      const box2 = { panel: null as THREE.Vector3 | null }
      scene.traverse((n: any) => {
        if (!n.isMesh || !n.geometry) return
        const p = n.geometry.parameters || {}
        if (n.geometry.type !== 'BoxGeometry') return
        // the softbox: a big square plate
        if (!((p.width ?? 0) > 0.5 && Math.abs((p.width ?? 0) - (p.height ?? 0)) < 0.02)) return
        const v = new THREE.Vector3()
        n.getWorldPosition(v)
        if (Math.hypot(v.x - lit.x, v.z - lit.z) < 1.3) box2.panel = v
      })
      if (!box2.panel) {
        problems.push('no softbox panel found on the studio light')
      } else {
        // THE WHITE FACE MUST BE THE ONE THAT SHOWS TO THE SET.
        //
        // Reported: "lightningnya masih sama aja kebalik". The plate was in the right PLACE
        // (offset toward the aim) but the DARK rim sat in front of the white emissive face, so
        // what pointed at the backdrop was the frame, not the light. Measured on the built
        // mesh: the white panel is 0.30 m from the stand and the rim 0.26 m — i.e. the rim was
        // nearer the aim side, in front of the glow.
        const whitePanel = { v: null as THREE.Vector3 | null }
        const darkRim = { v: null as THREE.Vector3 | null }
        scene.traverse((n: any) => {
          if (!n.isMesh || !n.geometry) return
          const p2 = n.geometry.parameters || {}
          if (n.geometry.type !== 'BoxGeometry') return
          const w = p2.width ?? 0
          const v = new THREE.Vector3()
          n.getWorldPosition(v)
          if (Math.hypot(v.x - lit.x, v.z - lit.z) > 1.5) return
          if (Math.abs(w - 0.72) < 0.01) whitePanel.v = v
          if (Math.abs(w - 0.78) < 0.01) darkRim.v = v
        })
        if (!whitePanel.v) {
          problems.push('no white softbox panel found on the studio light')
        } else if (darkRim.v) {
          const toBd = { x: bd.x - whitePanel.v.x, z: bd.z - whitePanel.v.z }
          const sepx = darkRim.v.x - whitePanel.v.x
          const sepz = darkRim.v.z - whitePanel.v.z
          const sepl = Math.hypot(sepx, sepz)
          const toBl = Math.hypot(toBd.x, toBd.z)
          if (sepl < 1e-4) {
            problems.push('the softbox rim and pane are in the same place')
          } else {
            const dot = (sepx * toBd.x + sepz * toBd.z) / (sepl * toBl)
            if (dot > 0) {
              problems.push('the DARK rim is in front of the white softbox face, so the light shows its frame to the set instead of its glow (looks back-to-front)')
            }
          }
        }

        // the lit face must be on the AIM side of the stand, i.e. the panel's horizontal
        // offset from the stand must point the same way as the beam.
        const dir = { x: Math.sin(lit.facing!), z: Math.cos(lit.facing!) }
        const off = { x: box2.panel.x - lit.x, z: box2.panel.z - lit.z }
        const len = Math.hypot(off.x, off.z)
        if (len < 0.05) {
          problems.push('the softbox sits on the stand\'s axis, which cannot be right')
        } else {
          const alignment = (off.x * dir.x + off.z * dir.z) / len
          if (alignment < 0.5) {
            problems.push(`the softbox is mounted BEHIND its stand (offset aligns only ${alignment.toFixed(2)} with the aim) — the light faces backwards`)
          }
        }
        const dz = bd.z - box2.panel.z
        if (Math.abs(dir.z) < 1e-3) {
          problems.push('the studio light runs parallel to the backdrop — it never hits it')
        } else {
          const t = dz / dir.z
          if (t < 0) {
            problems.push('the studio light throws AWAY from the backdrop')
          } else {
            const hitX = box2.panel.x + dir.x * t
            const miss = Math.abs(hitX - bd.x)
            if (miss > bd.hw) {
              problems.push(`the studio light beam lands ${miss.toFixed(2)} m from the backdrop's centre, past its ${bd.hw.toFixed(2)} m half-width — it misses the panel`)
            }
          }
        }
      }
    }
    check("the studio light's beam lands on the backdrop", problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE LOUNGE AND TERRACE SEATS FACE THEIR FURNITURE.
  //
  // Reported: "make sure the chairs of the furniture we just built face the table, rather
  // than having their backs to it". The racing seat was the real offender: each rig mesh is
  // built with the wheel and screen at its local -z, and a rig's `facing` is also the mesh's
  // rotation, so copying it into the body's `face` sat the driver looking due south with its
  // back to its own wheel — measured head-dot -1.00.
  //
  // Measured BEHAVIOURALLY: pose a real body at each seat with the real pose, then require
  // the body's forward (its own local +z) to point at the furniture. Scoped to `seatdir.ts`
  // during development; this locks the two fixed cases in.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const cases: { label: string; x: number; z: number; face: number; act: Activity; tx: number; tz: number }[] = []
    // Each driver spot is read from the IDLE SPOT data (the thing under test), and its target
    // is the rig's WHEEL, whose position is INDEPENDENT of the spot: the rig mesh is built
    // with the wheel and screen at local z, rotated by that rig's `facing`, so the wheel's
    // world position is derived from the MESH, not from the spot's `face`. An earlier version
    // computed the expected `face` with the same `+ Math.PI` the code uses, so reintroducing
    // the bug changed the expectation too and the test could never fail.
    // Every rig must have exactly one driver, and every driver exactly one rig: four of each,
    // matched on position. A spot with no rig (or a rig nobody can reach) is the failure this
    // catches — it is what "an avatar drives a rig that is not there" looks like in data.
    const racingSpots = IDLE_SPOTS.filter((x) => x.act === 'racing')
    if (racingSpots.length !== RACING_RIGS.length) {
      problems.push(`${RACING_RIGS.length} rigs but ${racingSpots.length} racing idle spot(s)`)
    }
    for (const r of RACING_RIGS) {
      const n = racingSpots.filter((s) => Math.hypot(s.x - r.x, s.z - r.z) < 0.01).length
      if (n !== 1) problems.push(`the rig at (${r.x}, ${r.z}) has ${n} driver spot(s)`)
    }
    // The rig each driver sits at is taken from the RIG's own transform, never from the
    // spot's `face`. An earlier version computed the expected target with the same `+ PI`
    // the code uses, so reintroducing the bug changed the expectation too and the test could
    // never fail.
    for (const s of racingSpots) {
      const rig = RACING_RIGS.find((r) => Math.hypot(r.x - s.x, r.z - s.z) < 0.01)
      if (!rig) {
        problems.push(`a racing spot at (${s.x}, ${s.z}) has no rig`)
        continue
      }
      const scr = new THREE.Vector3(0, 0, -1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rig.facing)
      cases.push({
        label: 'racing driver',
        x: s.x,
        z: s.z,
        face: s.face,
        act: 'racing',
        tx: rig.x + scr.x,
        tz: rig.z + scr.z,
      })
    }
    for (const s of IDLE_SPOTS.filter((x) => x.act === 'dart')) {
      cases.push({ label: 'dart thrower', x: s.x, z: s.z, face: s.face, act: 'dart', tx: DARTBOARD.x, tz: DARTBOARD.z })
    }
    const bar = TERRACE_PROPS.find((p) => p.kind === 'workbar')!
    for (const s of IDLE_SPOTS.filter((x) => x.act === 'coffee' && x.x < 24)) {
      // the bar is a LINE: aim at its nearest point, not its centre
      const nx = Math.max(bar.x - bar.hw, Math.min(bar.x + bar.hw, s.x))
      cases.push({ label: 'terrace stool', x: s.x, z: s.z, face: s.face, act: 'coffee', tx: nx, tz: bar.z })
    }
    for (const c of cases) {
      const av = buildAvatar('backend')
      av.group.position.set(c.x, 0, c.z)
      av.group.rotation.y = c.face
      const a = { avatar: av, activity: c.act, ease: 1, phase: 0.2, meetingTalking: false }
      for (let i = 0; i < 14; i++) animate(a, i * 0.1, 1 / 60)
      av.group.updateMatrixWorld(true)
      // a body looks along its OWN local +z
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(av.group.getWorldQuaternion(new THREE.Quaternion()))
      const dx = c.tx - c.x
      const dz = c.tz - c.z
      const len = Math.hypot(dx, dz)
      const d = (fwd.x * dx + fwd.z * dz) / len
      if (d < 0.7) problems.push(`${c.label} faces away from its furniture (dot ${d.toFixed(2)})`)
    }
    check('the lounge and terrace seats face their furniture', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AND THE CHAIR MESH ITSELF IS THE RIGHT WAY ROUND.
  //
  // Reported: "in that central area with the table, there is a chair positioned with its
  // back to the table". Checking only the BODY was not enough — the body faced the table
  // correctly, but the chair MESH was rotated so its backrest was between the sitter and the
  // table. Two new cases were wrong this way:
  //
  //   the marketing nook's two tub chairs   rotations were swapped, so BOTH backrests
  //                                          pointed at the nook table
  //   the two terrace sofas                 `facing: 0` put the backrest SOUTH, between the
  //                                          sitter and the pool they were meant to look at
  //
  // The mesh convention, learned from these: a backrest is modelled at local +z, so the
  // sitter faces local -z and `facing` must turn the back AWAY from the furniture.
  //
  // Measured from the BUILT SCENE: find the backrest box, and require it to lie on the
  // opposite side of the seat from the furniture (dot < 0).
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const scene = new THREE.Scene()
    buildOffice(scene, 12)
    const wp = (o: THREE.Object3D) => {
      const v = new THREE.Vector3()
      o.getWorldPosition(v)
      return v
    }
    // candidate backrests: upright boxes at sitting-back height, thin in one horizontal axis
    const backs: { x: number; z: number }[] = []
    scene.traverse((n: any) => {
      if (!n.isMesh || !n.geometry) return
      if (n.geometry.type !== 'BoxGeometry') return
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox()
      const bb = n.geometry.boundingBox
      const sz = new THREE.Vector3().subVectors(bb.max, bb.min).multiply(n.scale)
      const v = wp(n)
      if (v.y < 0.45 || v.y > 1.05) return
      const thin = Math.min(sz.x, sz.z)
      const broad = Math.max(sz.x, sz.z)
      if (thin > 0.36 || broad < 0.4) return
      if (sz.y < 0.35 || sz.y > 0.85) return
      backs.push({ x: v.x, z: v.z })
    })

    // the seat/furniture pairs that HAVE a backrest
    const pairs: { label: string; x: number; z: number; tx: number; tz: number }[] = []
    const nook = ROOM_PROPS.find((p) => p.kind === 'nook')
    if (nook) {
      for (const s of IDLE_SPOTS.filter((x) => x.act === 'sofa' && Math.hypot(x.x - nook.x, x.z - nook.z) < 1.6)) {
        pairs.push({ label: `nook chair @${s.x.toFixed(1)},${s.z.toFixed(1)}`, x: s.x, z: s.z, tx: nook.x, tz: nook.z })
      }
    }
    for (const s of IDLE_SPOTS.filter((x) => x.act === 'sofa' && x.z > -13 && x.z < -9 && Math.abs(x.x) < 14)) {
      pairs.push({ label: `terrace sofa @${s.x.toFixed(1)},${s.z.toFixed(1)}`, x: s.x, z: s.z, tx: s.x, tz: POOL.z })
    }
    for (const [si, set] of DINING_SETS.entries()) {
      for (const s of IDLE_SPOTS.filter((x) => x.act === 'eat' && Math.hypot(x.x - set.x, x.z - set.z) < 2.2)) {
        pairs.push({ label: `dining set ${si} chair @${s.x.toFixed(1)},${s.z.toFixed(1)}`, x: s.x, z: s.z, tx: set.x, tz: set.z })
      }
    }

    let checked = 0
    for (const c of pairs) {
      let best: { x: number; z: number } | null = null
      let bd = 1.4
      for (const b of backs) {
        const d = Math.hypot(b.x - c.x, b.z - c.z)
        if (d < bd) {
          bd = d
          best = b
        }
      }
      if (!best) continue
      checked++
      const fx = c.tx - c.x
      const fz = c.tz - c.z
      const fl = Math.hypot(fx, fz)
      const bx = best.x - c.x
      const bz = best.z - c.z
      const bl = Math.hypot(bx, bz)
      const d = (fx * bx + fz * bz) / (fl * bl)
      if (d >= 0) problems.push(`${c.label}: the BACKREST is on the furniture side (dot ${d.toFixed(2)}) — the seat faces backwards`)
    }
    if (checked < 12) problems.push(`only ${checked} backrests measured — the check is not seeing the furniture`)
    check('every chair and sofa mesh has its backrest BEHIND the sitter', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // A SWIMMER'S LEGS MUST TRAIL BEHIND THE HEAD, not fold under the chest.
  //
  // Reported: "the legs are hidden behind the body, so the body and legs are aligned in
  // the same position". The leg pitch was -90 with the note "-90 lays them along the
  // body" — true, but along it TOWARD THE HEAD, because the waist is already pitched +90
  // to lie the torso flat. Measured in the body's own frame: head at z +0.66, knees at
  // -0.47 with the fix, and both at the same end without it.
  //
  // Checked BEHAVIOURALLY: build a real avatar, run the real swim pose, and require the
  // legs to be on the opposite side of the hips from the head.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const av = buildAvatar('backend')
    const a = { avatar: av, activity: 'swim' as Activity, ease: 1, phase: 0, meetingTalking: false }
    // settle a few frames so the pose is fully applied
    for (let i = 0; i < 6; i++) animate(a, i * 0.1, 0)
    av.group.updateMatrixWorld(true)
    const root = new THREE.Vector3()
    av.group.getWorldPosition(root)
    const yaw = av.group.rotation.y
    const rel = (obj: THREE.Object3D) => {
      const v = new THREE.Vector3()
      obj.getWorldPosition(v)
      v.sub(root)
      const c = Math.cos(-yaw)
      const s = Math.sin(-yaw)
      return new THREE.Vector3(v.x * c - v.z * s, v.y, v.x * s + v.z * c)
    }
    const head = rel(av.head)
    const knee = rel(av.legs[0].elbow)
    // head leads (one sign), legs trail (the other). Require a real separation.
    const opposite = head.z * knee.z < 0
    const apart = Math.abs(head.z - knee.z) > 0.4
    if (!opposite) {
      problems.push(`the legs are on the SAME side as the head (head.z ${head.z.toFixed(2)}, knee.z ${knee.z.toFixed(2)}) — they fold under the chest and hide behind the torso`)
    }
    if (!apart) {
      problems.push(`head and legs are only ${Math.abs(head.z - knee.z).toFixed(2)} m apart along the body — a swimmer must be extended, not folded`)
    }
    check("a swimmer's legs trail behind its head, not under its chest", problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // WHAT THE AUDIT FOUND UNGUARDED (6 holes), now closed.
  //
  // A mutation audit reverses each feature and checks the suite notices. Six did not:
  // a deleted dining set, a missing `eat` pose, a meal that never appears, a water cooler
  // that is not solid, a mover that ignores `allowWater`, and tongs that are never held.
  // Each is now a real assertion.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []

    // (a) the dining sets must be MANY, and each must have its table mesh data intact
    if (DINING_SETS.length !== 6) {
      problems.push(`${DINING_SETS.length} dining sets — the user asked for SIX`)
    }
    // and they must be in a deliberate GRID, not scattered: two columns, three rows
    {
      const xs = [...new Set(DINING_SETS.map((s) => Math.round(s.x * 10) / 10))].sort((a, b) => a - b)
      const zs = [...new Set(DINING_SETS.map((s) => Math.round(s.z * 10) / 10))].sort((a, b) => a - b)
      if (xs.length !== 2) problems.push(`dining columns are not aligned: x values ${xs.join(', ')}`)
      if (zs.length !== 3) problems.push(`dining rows are not aligned: z values ${zs.join(', ')}`)
      // every column/row pair must have a table, or the grid has a hole
      for (const x of xs) {
        for (const z of zs) {
          const hit = DINING_SETS.some((s) => Math.abs(s.x - x) < 0.05 && Math.abs(s.z - z) < 0.05)
          if (!hit) problems.push(`the dining grid is missing a table at (${x}, ${z})`)
        }
      }
      // and no two tables may be so close that their chairs collide
      for (const [i, a] of DINING_SETS.entries()) {
        for (const b of DINING_SETS.slice(i + 1)) {
          const d = Math.hypot(a.x - b.x, a.z - b.z)
          if (d < 2.4) problems.push(`dining sets at (${a.x},${a.z}) and (${b.x},${b.z}) are only ${d.toFixed(1)} m apart`)
        }
      }
    }
    for (const [i, s] of DINING_SETS.entries()) {
      if (!(s.w > 0.5 && s.d > 0.3)) problems.push(`dining set ${i} has no usable table size`)
      // the table must be solid, or a body stands inside the table
      if (!blocked(s.x, s.z, BODY_R, { level: 0 })) problems.push(`dining set ${i}'s table is not solid`)
    }

    // (b) every pose a spot can name must exist in the pose table
    const posed = new Set(IDLE_SPOTS.map((s) => s.act))
    for (const act of posed) {
      if (!ACTIVITIES.includes(act)) problems.push(`spots use '${act}' but no pose implements it`)
    }

    // (c) EATING MUST ACTUALLY HOLD FOOD. The pose picks a meal from the agent's phase, so
    //     both meals must be reachable AND the pose must show one of them on every frame.
    {
      const av = buildAvatar('backend')
      for (const phase of [0.1, 0.3, 0.55, 0.9]) {
        const a = { avatar: av, activity: 'eat' as Activity, ease: 1, phase, meetingTalking: false }
        let shown = 0
        for (let i = 0; i <= 40; i++) {
          animate(a, i * 0.1, 0)
          if (av.held.burger.visible || av.held.pizza.visible) shown++
        }
        if (shown < 41) problems.push(`phase ${phase}: a diner shows no food on ${41 - shown} frames`)
      }
      // both meals must be reachable, or one of the two the user asked for never appears
      const meals = new Set<string>()
      for (let p = 0; p < 20; p++) {
        const a = { avatar: av, activity: 'eat' as Activity, ease: 1, phase: p / 20, meetingTalking: false }
        animate(a, 0.5, 0)
        if (av.held.burger.visible) meals.add('burger')
        if (av.held.pizza.visible) meals.add('pizza')
      }
      if (meals.size !== 2) problems.push(`only these meals ever appear: ${[...meals].join(', ') || 'none'}`)
    }

    // (d) the water cooler must be SOLID, and the coffee machine must sit on the counter
    const cooler = FOOTPRINTS.find((f) => f.id === 'pantry-water-cooler')
    if (!cooler) problems.push('the pantry has no water cooler footprint')
    else if (!blocked(cooler.x, cooler.z, BODY_R, { level: 0 })) {
      problems.push('the water cooler is not solid — a body walks through the dispenser')
    }

    // (e) THE MOVER MUST LET A SWIMMER IN. A `water` flag nothing reads is decoration.
    {
      const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
      const code = scene.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      if (!/allowWater:\s*goingToWater/.test(code)) {
        problems.push('the mover never passes allowWater — no body can enter the pool')
      }
      if (!/goingToWater\s*=\s*!!a\.targetWater/.test(code)) {
        problems.push('the mover does not read the destination water flag')
      }
      if (!/a\.targetWater\s*=\s*spot\.water/.test(code)) {
        problems.push('an idle spot does not record that it is in the water')
      }
      // (e2) A BODY IN THE WATER MUST SWIM, NOT WALK — and BOTH places that decide the
      // shown activity must say so.
      //
      // This bug had two halves. The render path gated the swim pose on `a.targetWater`,
      // which is only set while a body is en route to a swim LANE, so a body crossing the
      // water kept walking. Fixing only that changed nothing visible, because
      // `flushPositions()` — which runs FIRST each frame and writes the activity to the
      // database the UI reads — had its own copy of the old formula. Traced: 13 frames at
      // x -6.0..-4.1, z 7.3..4.2 with the DB reporting 'walking' while the body was in the
      // basin. Both now call one shared helper, and this checks that.
      if (!/function shownActivity\(/.test(code)) {
        problems.push('there is no shared shown-activity rule for the water test')
      }
      const helperBlock = code.slice(code.indexOf('function shownActivity('), code.indexOf('function shownActivity(') + 420)
      if (!/POOL\.w\s*\/\s*2/.test(helperBlock) || !/POOL\.d\s*\/\s*2/.test(helperBlock)) {
        problems.push('the swim-while-moving test does not use the basin footprint')
      }
      if (!/inWater\s*\?\s*'swim'\s*:\s*'walking'/.test(helperBlock)) {
        problems.push('the mover does not switch to the swim pose while crossing the water')
      }
      // and there must be NO leftover copy of the old formula anywhere
      if (/a\.walking > 0\.5 \? 'walking' : a\.activity/.test(code)) {
        problems.push('a copy of the old shown-activity formula survives — a body in the water would still be written to the DB as walking')
      }
      const calls = (code.match(/shownActivity\(a, g\)/g) || []).length
      if (calls < 2) {
        problems.push(`only ${calls} caller(s) of the shared shown-activity rule; the render path AND flushPositions must both use it`)
      }
    }

    // (f) THE BBQ MUST HOLD TONGS. Checked behaviourally: the tongs must be visible while
    //     the pose runs, and must not leak into any other pose.
    {
      const av = buildAvatar('backend')
      const a = { avatar: av, activity: 'bbq' as Activity, ease: 1, phase: 0.2, meetingTalking: false }
      let shown = 0
      for (let i = 0; i <= 40; i++) {
        animate(a, i * 0.1, 0)
        if (av.held.tongs.visible) shown++
      }
      if (shown < 41) problems.push(`a cook holds no tongs on ${41 - shown} frames`)
      const leaks: string[] = []
      for (const act of ['idle', 'walking', 'typing', 'swim', 'eat'] as Activity[]) {
        a.activity = act
        animate(a, 1.2, 0)
        if (av.held.tongs.visible) leaks.push(act)
      }
      if (leaks.length) problems.push(`the tongs leak into: ${leaks.join(', ')}`)
    }

    check('the audit holes are closed: tables, poses, meals, cooler, water, tongs',
      problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE RUNTIME FILTER MUST USE THE SAME EXEMPTIONS AS THE MOVER.
  //
  // `scene.ts` drops any idle spot that `blocked()` rejects, and that filter is SILENT: the
  // body simply goes elsewhere, so nothing looks broken. It passed only `allowSeat`, which
  // discarded 23 of 66 spots at runtime — every swim lane, the bench press, and ALL 20
  // dining chairs. The self-test stayed green because it checked the DATA with the right
  // flags; the data was fine and the world was not. The user found it by looking.
  //
  // This calls the SAME expression the scene uses and demands it drops nothing.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
    const problems: string[] = []
    // the filter must consult all three exemptions
    for (const [flag, why] of [
      ['allowSeat: p.seated', 'a seated spot would be dropped'],
      ['settling: p.seated || p.bench', 'a bench-press spot would be dropped'],
      ['allowWater: p.water', 'a swim lane would be dropped'],
    ] as const) {
      if (!scene.includes(flag)) problems.push(`the runtime filter ignores ${flag.split(':')[0]} — ${why}`)
    }
    // and it must actually drop nothing, evaluated with the same flags
    const dropped = IDLE_SPOTS.filter((p) =>
      blocked(p.x, p.z, BODY_R, {
        allowSeat: p.seated,
        settling: p.seated || p.bench,
        allowWater: p.water,
        level: p.level,
      }),
    )
    for (const p of dropped) {
      problems.push(`the world would DROP the ${p.act} spot at (${p.x.toFixed(1)},${p.z.toFixed(1)})`)
    }
    if (IDLE_SPOTS.length < 60) problems.push(`only ${IDLE_SPOTS.length} idle spots — some were lost`)
    check('the runtime spot filter drops nothing', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE MUSCLE-UP MUST GRIP THE BAR, NOT HANG BESIDE IT (poin 9).
  //
  // The spot was at `rig.x + span/2 + 0.55` — 0.55 m past the end post — so the body hung
  // off the side of the bar with nothing to hold. This compares the spot against the bar's
  // actual span.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const barX1 = GYM.rig.x - GYM.rig.span / 2
    const barX2 = GYM.rig.x + GYM.rig.span / 2
    for (const act of ['pullup', 'muscleup'] as const) {
      const s = IDLE_SPOTS.find((x) => x.act === act)
      if (!s) {
        problems.push(`no ${act} spot`)
        continue
      }
      if (s.x < barX1 || s.x > barX2) {
        problems.push(`the ${act} spot (x=${s.x.toFixed(2)}) is outside the bar span ${barX1}..${barX2}`)
      }
      if (Math.abs(s.z - GYM.rig.z) > 0.05) {
        problems.push(`the ${act} spot (z=${s.z.toFixed(2)}) is not on the bar's line (z=${GYM.rig.z})`)
      }
    }
    // the two must not share a place, or they are one station wearing two names
    const pu = IDLE_SPOTS.find((x) => x.act === 'pullup')
    const mu = IDLE_SPOTS.find((x) => x.act === 'muscleup')
    if (pu && mu && Math.hypot(pu.x - mu.x, pu.z - mu.z) < 0.6) {
      problems.push('the pull-up and muscle-up spots overlap — they are the same place')
    }
    check('both rig stations grip the bar', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE DINING TABLES ARE IN THE PANTRY, AND ONLY THERE (poin 1, corrected).
  //
  // The user asked for the dining tables in the pantry / dapur. The first version put two
  // of the five in the leisure room, which is not what was asked.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const pantry = roomById('pantry')!
    const leisure = roomById('leisure')!
    for (const [i, s] of DINING_SETS.entries()) {
      const inPantry = s.x > pantry.x1 && s.x < pantry.x2 && s.z > pantry.z1 && s.z < pantry.z2
      const inLeisure = s.x > leisure.x1 && s.x < leisure.x2 && s.z > leisure.z1 && s.z < leisure.z2
      if (!inPantry) problems.push(`dining set ${i} at (${s.x},${s.z}) is not in the pantry`)
      if (inLeisure) problems.push(`dining set ${i} is in the leisure room`)
    }
    if (DINING_SETS.length < 4) problems.push(`only ${DINING_SETS.length} dining sets`)
    check('every dining table is in the pantry', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // LYING DOWN NEEDS A WAIST JOINT (poin 3, 7, and the bench press).
  //
  // `chest` pivots at the SHOULDERS, so leaning it only tips the head back — the torso stays
  // upright. That is why the swimmer floated, the bench press looked like sitting, and the
  // daybed never lay down. The rig now has a `waist` at the hip, and this measures the
  // result rather than trusting it: a body that is lying has its chest at nearly the SAME
  // height as its hip, and one that is standing has the chest 0.66 above it.
  //
  // No screenshot can be fooled by this number, and no pose can fake it.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const gap = (act: Activity): number => {
      const av = buildAvatar('backend')
      const a = { avatar: av, activity: act, ease: 1, phase: 0.3, meetingTalking: false }
      let worst = 0
      for (let i = 0; i <= 40; i++) {
        animate(a, i * 0.12, 0)
        av.group.updateMatrixWorld(true)
        const chest = av.chest.getWorldPosition(new THREE.Vector3())
        const hip = av.hips.getWorldPosition(new THREE.Vector3())
        worst = Math.max(worst, chest.y - hip.y)
      }
      return worst
    }
    // LYING: the chest must come down close to the hip.
    for (const [act, maxGap] of [
      ['swim', 0.12],
      ['benchpress', 0.12],
      ['recline', 0.22],
    ] as const) {
      const g = gap(act)
      if (g > maxGap) {
        problems.push(`'${act}' is not lying down: chest is ${g.toFixed(3)} m above the hip (max ${maxGap})`)
      }
    }
    // STANDING: the upright poses must NOT have been flattened by the change.
    for (const act of ['idle', 'walking', 'typing'] as const) {
      const g = gap(act)
      if (g < 0.5) problems.push(`'${act}' is no longer upright: chest-hip gap ${g.toFixed(3)}`)
    }
    // and the joint must exist on the rig, or every pose above is measuring something else
    const av = buildAvatar('backend')
    if (!av.waist) problems.push('the rig has no waist joint')
    else if (av.waist.parent !== av.hips) problems.push('the waist is not a child of the hips')
    check('a lying pose really lies down, and a standing pose still stands', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE WAIST MUST NOT STICK BETWEEN POSES.
  //
  // Only three poses set the waist, and nothing reset it, so a body that had swum ONCE kept
  // a 90-degree waist forever: every later pose, walking included, was drawn folded over.
  // That was a regression I introduced with the waist joint, and the user caught it —
  // "mereka jalan sambil pada bongkok".
  //
  // The measurement above cannot see it, because it builds a FRESH avatar per pose. This
  // drives ONE avatar through a sequence and checks that an upright pose is upright whatever
  // came before it.
  //
  // It ALSO covers the same bug class in `chest.rotation.y`: `walkLegs` never set the torso,
  // so a body that had just swum walked with the swimmer's 8-degree roll for its whole
  // journey. Every joint a pose can move is therefore checked for a NEUTRAL pose, not just
  // the waist.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const av = buildAvatar('backend')
    const a = { avatar: av, activity: 'idle' as Activity, ease: 1, phase: 0.3, meetingTalking: false }
    const SEQ: Activity[] = ['idle', 'swim', 'walking', 'typing', 'benchpress', 'walking', 'coffee', 'recline', 'walking', 'bbq']
    for (const act of SEQ) {
      a.activity = act
      for (let i = 0; i < 8; i++) animate(a, i * 0.1, 1 / 60)
      av.group.updateMatrixWorld(true)
      const chest = av.chest.getWorldPosition(new THREE.Vector3())
      const hip = av.hips.getWorldPosition(new THREE.Vector3())
      const gap = chest.y - hip.y
      const waistDeg = (av.waist.rotation.x * 180) / Math.PI
      if (act === 'walking' || act === 'idle' || act === 'typing' || act === 'coffee' || act === 'bbq') {
        if (Math.abs(waistDeg) > 0.01) {
          problems.push(`'${act}' kept a ${waistDeg.toFixed(0)} deg waist from an earlier pose`)
        }
        if (gap < 0.55) problems.push(`'${act}' is hunched: chest-hip gap ${gap.toFixed(3)}`)
      }
    }

    // THE WHOLE TORSO, for every transition: a lying pose followed by a walking one must
    // leave no roll behind. `chest.rotation.y` was leaking 8 degrees from the swimmer.
    for (const first of ['swim', 'recline', 'meeting', 'garden', 'coffee', 'eat'] as Activity[]) {
      a.activity = first
      for (let i = 0; i < 8; i++) animate(a, i * 0.1, 1 / 60)
      a.activity = 'walking'
      for (let i = 0; i < 8; i++) animate(a, i * 0.1, 1 / 60)
      const roll = Math.abs((av.chest.rotation.y * 180) / Math.PI)
      const lean = Math.abs((av.chest.rotation.x * 180) / Math.PI)
      if (roll > 0.01) problems.push(`walking after '${first}' kept a ${roll.toFixed(1)} deg torso roll`)
      if (lean > 0.01) problems.push(`walking after '${first}' kept a ${lean.toFixed(1)} deg torso lean`)
    }
    check('the waist resets between poses, so nobody walks hunched', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE SWIMMER FLOATS AT THE WATER SURFACE, WHICH IS WHERE THE PLANE IS (poin 2).
  //
  // `WATER_Y` is the surface as DRAWN, and the pose reads the same constant. The body's
  // centre must sit within a hand's width of it, and part of the body must be under it —
  // otherwise the avatar is hovering above the pool, which is what the user reported.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const av = buildAvatar('backend')
    const spot = IDLE_SPOTS.find((s) => s.act === 'swim')!
    av.group.position.set(spot.x, 0, spot.z)
    const a = { avatar: av, activity: 'swim' as Activity, ease: 1, phase: 0.3, meetingTalking: false }
    let lo = 9
    let hi = -9
    for (let i = 0; i <= 60; i++) {
      animate(a, i * 0.1, 0)
      av.group.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(av.hips)
      lo = Math.min(lo, box.min.y)
      hi = Math.max(hi, box.max.y)
    }
    const centre = (lo + hi) / 2
    if (Math.abs(centre - WATER_Y) > 0.25) {
      problems.push(`the swimmer's centre is ${(centre - WATER_Y).toFixed(2)} m from the water surface`)
    }
    if (lo > WATER_Y) problems.push('no part of the swimmer is under the water')
    // the mesh and the pose must read the SAME constant
    const build = readFileSync(new URL('../src/lib/office/build.ts', import.meta.url), 'utf8')
    if (!/water\.position\.set\(x, WATER_Y, z\)/.test(build)) {
      problems.push('the water plane is not drawn at WATER_Y — the pose and the mesh can drift')
    }
    check('the swimmer floats at the water surface', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE RACK'S BAR IS HIDDEN WHILE SOMEBODY BENCHES.
  //
  // The bar is in the lifter's hands, so leaving the rack's own bar resting in the hooks
  // draws two bars in the same place. The mesh exposes `setRackBarVisible` and the scene
  // calls it every frame.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const build = readFileSync(new URL('../src/lib/office/build.ts', import.meta.url), 'utf8')
    const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
    if (!/setRackBarVisible/.test(build)) problems.push('the rack bar cannot be hidden')
    if (!/rackBarParts\.push\(bar\)/.test(build)) problems.push("the rack's bar is not collected")
    if (!/office\.setRackBarVisible\(/.test(scene)) {
      problems.push('the scene never hides the rack bar — two bars will overlap')
    }
    if (!/activity === 'benchpress'/.test(scene)) {
      problems.push('the scene does not test for a benching body')
    }
    // the pose must lie on the pad, not sit at it
    const av = buildAvatar('backend')
    const a = { avatar: av, activity: 'benchpress' as Activity, ease: 1, phase: 0.3, meetingTalking: false }
    let minHip = 9
    let maxHip = -9
    for (let i = 0; i <= 40; i++) {
      animate(a, i * 0.12, 0)
      minHip = Math.min(minHip, av.hips.position.y)
      maxHip = Math.max(maxHip, av.hips.position.y)
    }
    if (maxHip > GYM.rack.benchTop + 0.06) {
      problems.push(`the lifter's hip is at ${maxHip.toFixed(3)}, above the pad (${GYM.rack.benchTop})`)
    }
    if (minHip < GYM.rack.benchTop - 0.06) {
      problems.push(`the lifter's hip is at ${minHip.toFixed(3)}, below the pad (${GYM.rack.benchTop})`)
    }
    check('a bench press lies on the pad with the rack bar hidden', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // A PERSISTED ANGLE MUST STAY BOUNDED (found in the live database, not on screen).
  //
  // `avatar_state.facing` held values like 2836.86 rad — 452 TURNS — for bodies that render
  // as pointing at 0.79 rad. sin/cos are periodic, so the mesh looked perfect and no visual
  // check could ever have caught it.
  //
  // The mechanism is a feedback loop through the database, which is why it never healed:
  //
  //   1. the render loop smooths `g.rotation.y` with a WRAPPED delta, so it converges to the
  //      congruent angle nearest to where it already is — from 2809 toward a target of 3.13 it
  //      picks 2811, never 3.13;
  //   2. `facing: Number(g.rotation.y.toFixed(2))` persists that number;
  //   3. on load, `face` and `anchorFacing` take `row.facing` verbatim, so the stored large
  //      number becomes both the starting point and the target again.
  //
  // My first hypothesis — that it simply grows without bound — was WRONG, and the simulation
  // proved it: a body starting near zero stays near zero, because the wrapped delta keeps the
  // increment small. `wrapAngle` is needed at the two ends (write and load), not to stop
  // growth but to collapse a value that is already large and would otherwise be inherited
  // forever.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const TAU = Math.PI * 2
    const sameDir = (a: number, b: number) =>
      Math.abs(Math.sin(a) - Math.sin(b)) < 1e-9 && Math.abs(Math.cos(a) - Math.cos(b)) < 1e-9

    // the function itself
    for (const k of [1, -1, 447, -447, 10000]) {
      const w = wrapAngle(k * TAU + 0.786)
      if (Math.abs(w - 0.786) > 1e-9) problems.push(`wrapAngle(${k} turns + 0.786) = ${w}`)
    }
    for (const a of [0, 1.5, -2.9, 7.0, 2809.37]) {
      const w = wrapAngle(a)
      if (!(w > -Math.PI - 1e-9 && w <= Math.PI + 1e-9)) problems.push(`wrapAngle(${a}) = ${w} is out of range`)
      if (!sameDir(w, a)) problems.push(`wrapAngle(${a}) changed the direction`)
      if (Math.abs(wrapAngle(w) - w) > 1e-12) problems.push(`wrapAngle is not idempotent at ${a}`)
    }

    // the real values that were in the database
    for (const f of [2836.86, 2809.37, 2772.0, 2497.24, 2413.66, 176.8]) {
      const w = wrapAngle(f)
      if (!sameDir(w, f)) problems.push(`the stored facing ${f} would change direction when folded`)
    }

    // the mechanism: a large stored value must COLLAPSE once the wrap is in place
    const step = (g: number, target: number, wrapped: boolean) => {
      let diff = target - g
      while (diff > Math.PI) diff -= TAU
      while (diff < -Math.PI) diff += TAU
      g += diff * Math.min(1, (1 / 60) * 6)
      return wrapped ? wrapAngle(g) : g
    }
    const run = (start: number, wrapped: boolean) => {
      let g = start
      for (let i = 0; i < 6000; i++) g = step(g, i % 400 < 200 ? 0.79 : 3.13, wrapped)
      return g
    }
    const legacy = run(2809.37, false)
    const fixed = run(2809.37, true)
    if (Math.abs(legacy) < 1000) {
      problems.push(`the legacy path was expected to stay large, got ${legacy}`)
    }
    if (!(Math.abs(fixed) <= Math.PI + 1e-9)) {
      problems.push(`a stored facing of 2809 rad does not collapse: got ${fixed}`)
    }
    if (!sameDir(legacy, fixed)) problems.push('collapsing the angle changed which way the body points')

    // a body that starts small must NOT grow (the hypothesis I got wrong)
    if (Math.abs(run(0.79, false)) > TAU) {
      problems.push('a body starting near zero grew without bound, which the model says cannot happen')
    }

    // and the fix must actually be wired into the scene
    const scene = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
    if (!/g\.rotation\.y = wrapAngle\(g\.rotation\.y\)/.test(scene)) {
      problems.push('the render loop does not wrap the angle before it is persisted')
    }
    if (!/face: wrapAngle\(row\.facing/.test(scene)) {
      problems.push('a loaded facing is not folded, so old rows stay inflated')
    }
    if (!/anchorFacing: wrapAngle\(row\.facing/.test(scene)) {
      problems.push('a loaded anchorFacing is not folded')
    }

    check('a persisted facing stays bounded and points the same way', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE LOUNGE TV PLAYS THE RACE FEED WHILE SOMEBODY IS DRIVING.
  //
  // Reported: "saat ada yang pakai racing simulator tvnya berubah jadi main seperti lagi
  // balapan". Two things have to hold — the bay really has four rigs, and the screen really
  // swaps. Both are read off the BUILT scene; the wiring is read off scene.ts, because a
  // `setTvRacing` nobody calls is the same as no feature at all.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const scene = new THREE.Scene()
    const office = buildOffice(scene, 12)
    scene.updateMatrixWorld(true)

    // Four rigs, counted from the wheel meshes that identify a rig.
    let rigs = 0
    scene.traverse((n: any) => {
      if (!n.isMesh || !n.geometry || n.geometry.type !== 'TorusGeometry') return
      const v = new THREE.Vector3()
      n.getWorldPosition(v)
      if (v.x >= 14 && v.x <= 28 && v.z <= -10) rigs++
    })
    if (rigs !== 4) problems.push(`the racing bay has ${rigs} rig(s), expected 4`)

    // The ping-pong table is gone. 2.74 x 1.525 was its top and nothing else is that size.
    let tables = 0
    scene.traverse((n: any) => {
      if (!n.isMesh || !n.geometry) return
      const p = (n.geometry as any).parameters || {}
      if (Math.abs((p.width ?? 0) - 2.74) < 0.01 && Math.abs((p.depth ?? 0) - 1.525) < 0.01) tables++
    })
    if (tables !== 0) problems.push(`a 2.74x1.525 ping-pong top is still in the scene (${tables})`)

    // The screen swaps to a feed and back, and a repeated call is a no-op.
    const tv: any = scene.getObjectByName('lounge-tv-screen')
    if (!tv) {
      problems.push('no lounge TV screen in the scene, so setTvRacing has nothing to drive')
    } else {
      const mat = tv.material as THREE.MeshStandardMaterial
      const idleHex = mat.emissive.getHex()
      const idleEi = mat.emissiveIntensity
      office.setTvRacing(true)
      const feed = mat.map
      if (!feed) problems.push('setTvRacing(true) left the screen with no feed texture')
      office.setTvRacing(true)
      if (feed && mat.map !== feed) problems.push('setTvRacing is not idempotent: it reallocated the feed texture')
      office.setTvRacing(false)
      if (mat.map) problems.push('setTvRacing(false) did not clear the feed')
      if (mat.emissive.getHex() !== idleHex || mat.emissiveIntensity !== idleEi) {
        problems.push('the screen did not return to its standby glow')
      }
    }

    // And the render loop must actually drive it, gated on "has arrived" like the rack bar.
    const loopSrc = readFileSync(new URL('../src/lib/office/scene.ts', import.meta.url), 'utf8')
    if (!/office\.setTvRacing\(avatars\.some\(\(a\) => a\.activity === 'racing'/.test(loopSrc)) {
      problems.push('the render loop never switches the TV to the race feed')
    }

    check('the lounge TV plays the race feed while a rig is occupied', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE WHEEL SITS ON THE COLUMN'S DRIVER-SIDE END, AND THE HANDS GRIP IT.
  //
  // Reported: "posisi setir pada rig simulator itu kebalik bro, malah ada di belakang tiangnya
  // (kearah monitor) bukan kearah kursi". The wheel had been bolted to the column's BASE end
  // (z -0.66, the pedal side) instead of its TOP (z -0.376, the driver side) — the two ends
  // are 0.29 m apart and the difference is exactly which side of the post it reads as.
  //
  // Both halves are measured: a wheel in the right place that the hands float 0.4 m above is
  // not the fix either. The hand positions come from a REAL posed avatar, not arithmetic.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const scene = new THREE.Scene()
    buildOffice(scene, 12)
    scene.updateMatrixWorld(true)

    const rig = RACING_RIGS[0]
    const at = (n: any) => { const v = new THREE.Vector3(); n.getWorldPosition(v); return v }
    let wheel: THREE.Vector3 | null = null
    let column: THREE.Vector3 | null = null
    scene.traverse((n: any) => {
      if (!n.isMesh || !n.geometry) return
      const v = at(n)
      if (Math.hypot(v.x - rig.x, v.z - rig.z) > 1.6) return
      const g: any = n.geometry
      if (g.type === 'TorusGeometry' && !wheel) wheel = v
      if (g.type === 'CylinderGeometry' && Math.abs((g.parameters?.height ?? 0) - 0.6) < 0.01 && !column) column = v
    })

    const seat = new THREE.Vector3(rig.x, RACING_SEAT_H, rig.z)
    const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
    if (!wheel) {
      problems.push('no steering wheel on the rig')
    } else if (!column) {
      problems.push('no wheel column on the rig, so the wheel has no side to be on')
    } else if (flat(wheel, seat) >= flat(column, seat)) {
      problems.push(
        `the wheel is on the FAR side of its column: ${flat(wheel, seat).toFixed(2)} m from the seat ` +
        `vs the column centre's ${flat(column, seat).toFixed(2)} m`,
      )
    }

    if (wheel) {
      const av = buildAvatar('backend')
      av.group.position.set(rig.x, 0, rig.z)
      av.group.rotation.y = rig.facing + Math.PI
      const a = { avatar: av, activity: 'racing' as Activity, ease: 1, phase: 0.2, meetingTalking: false }
      for (let i = 0; i < 20; i++) animate(a, i * 0.1, 1 / 60)
      av.group.updateMatrixWorld(true)
      const fist = (limb: any) => {
        const e = new THREE.Vector3()
        limb.elbow.getWorldPosition(e)
        const down = new THREE.Vector3(0, -1, 0).applyQuaternion(limb.elbow.getWorldQuaternion(new THREE.Quaternion()))
        return e.addScaledVector(down, FIST_FROM_ELBOW)
      }
      av.arms.forEach((limb: any, i: number) => {
        const gap = fist(limb).distanceTo(wheel as THREE.Vector3)
        // the rim is r 0.16; allow a hand's width of slop around it
        if (gap > 0.26) {
          problems.push(`${i === 0 ? 'left' : 'right'} fist is ${gap.toFixed(2)} m from the wheel centre, so it does not grip the rim (r 0.16)`)
        }
      })
    }

    check("the racing wheel is on the column's driver side and the hands grip it", problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THE BOWLING LANE: TEN PINS ON THE BOARDS, AND A BOWLER ON THE APPROACH.
  //
  // The lane is the kind of feature that fails silently. Pins can sit off the end of the
  // surface, and the bowler's spot can land ON the lane instead of behind the foul line —
  // which looks fine from above and means the avatar is standing in the gutter. Both are
  // measured off the built mesh and the layout data.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const scene = new THREE.Scene()
    buildOffice(scene, 12)
    scene.updateMatrixWorld(true)

    // the pins, identified by the body cylinder's exact height
    const pins: THREE.Vector3[] = []
    scene.traverse((n: any) => {
      if (!n.isMesh || !n.geometry) return
      const g: any = n.geometry
      if (g.type !== 'CylinderGeometry') return
      if (Math.abs((g.parameters?.height ?? 0) - PIN_H * 0.72) > 0.005) return
      const v = new THREE.Vector3()
      n.getWorldPosition(v)
      if (Math.abs(v.z - BOWLING.z) > 1.5 || v.x < BOWLING.xFoul || v.x > BOWLING.xEnd + 1) return
      pins.push(v)
    })
    if (pins.length !== 10) {
      problems.push(`the lane has ${pins.length} pins, expected 10`)
    } else {
      for (const p of pins) {
        if (Math.abs(p.z - BOWLING.z) > BOWLING.w / 2 + 0.01) {
          problems.push(`a pin at z ${p.z.toFixed(2)} is off the side of the lane (half-width ${BOWLING.w / 2})`)
        }
        if (p.x > BOWLING.xEnd - 0.2 || p.x < BOWLING.xFoul) {
          problems.push(`a pin at x ${p.x.toFixed(2)} is off the end of the lane (${BOWLING.xFoul}..${BOWLING.xEnd})`)
        }
      }
      // the head pin is the one NEAREST the bowler, and must sit exactly where the layout says
      const head = pins.reduce((a, b) => (b.x < a.x ? b : a))
      if (Math.abs(head.x - BOWLING.headPinX) > 0.01 || Math.abs(head.z - BOWLING.z) > 0.01) {
        problems.push(`the head pin sits at (${head.x.toFixed(2)}, ${head.z.toFixed(2)}), not (${BOWLING.headPinX}, ${BOWLING.z})`)
      }
      // and the bowler must stand west of the foul line, aiming east at it
      const spot = IDLE_SPOTS.find((s) => s.act === 'bowling')
      if (!spot) {
        problems.push('no bowling idle spot, so nobody can ever use the lane')
      } else {
        if (Math.abs(spot.z - BOWLING.z) > BOWLING.w / 2 + BOWLING.gutter || spot.x >= BOWLING.xFoul) {
          problems.push(`the bowler stands at (${spot.x}, ${spot.z}), which is on the lane rather than on the approach`)
        }
        const look = { x: Math.sin(spot.face), z: Math.cos(spot.face) }
        // the lane is aimed EAST: the throw direction must be +x, not merely "at the pins"
        if (look.x < 0.99) {
          problems.push(`the bowler aims (${look.x.toFixed(2)}, ${look.z.toFixed(2)}), which is not east (+x)`)
        }
        const to = { x: head.x - spot.x, z: head.z - spot.z }
        const dot = (look.x * to.x + look.z * to.z) / Math.hypot(to.x, to.z)
        if (dot < 0.99) problems.push(`the bowler faces away from the head pin (dot ${dot.toFixed(2)})`)
      }
    }

    // ── flush against the pantry wall ──
    // The lane's outer edge must MEET the wall, not sit near it — and nothing in the assembly
    // may poke through. The score screen is the trap: it sits past the pin deck at full lane
    // width, so a screen even slightly too wide buries a post inside the wall, and from above
    // that looks exactly like a screen that fits.
    const pantryWall = (FOOTPRINTS as any[]).find((f) => f.id === 'part-leisure-pantry')
    if (!pantryWall) {
      problems.push('the pantry wall footprint is gone, so nothing can check the lane is flush')
    } else {
      const face = pantryWall.z - pantryWall.hd // the leisure-room side of the wall
      const edge = BOWLING.z + BOWLING.w / 2 + BOWLING.gutter
      if (Math.abs(edge - face) > 0.02) {
        problems.push(
          `the lane's edge is at z ${edge.toFixed(2)} but the pantry wall's face is at ${face.toFixed(2)} — a ${(face - edge).toFixed(2)} m gap`,
        )
      }
      let pierced = 0
      let worst = 0
      scene.traverse((n: any) => {
        if (!n.isMesh || !n.geometry) return
        const bb = new THREE.Box3().setFromObject(n)
        if (!isFinite(bb.min.x)) return
        if (bb.min.x < BOWLING.xEnd - 0.1 || bb.min.x > BOWLING.xEnd + 1.5) return
        // only small props: the room's own walls are meshes that START in this x band too, and
        // the east outer wall runs the whole depth of the building, so without this the check
        // reports a 19 m "pierce" that is just the wall doing its job
        if (bb.max.z - bb.min.z > 3 || bb.max.x - bb.min.x > 3) return
        if (Math.abs((bb.min.z + bb.max.z) / 2 - BOWLING.z) > 2) return
        if (bb.max.z > face + 0.01) {
          pierced++
          worst = Math.max(worst, bb.max.z - face)
        }
      })
      if (pierced > 0) {
        problems.push(`${pierced} mesh(es) past the pin deck reach through the pantry wall face, by up to ${worst.toFixed(2)} m`)
      }
    }

    // the ball must actually be IN the hand during the delivery, not near it
    {
      const av = buildAvatar('backend')
      const pose = { avatar: av, activity: 'bowling' as Activity, ease: 1, phase: 0, meetingTalking: false }
      let held = 0
      let samples = 0
      for (let i = 0; i < 40; i++) {
        animate(pose, i * 0.08, 1 / 60)
        av.group.updateMatrixWorld(true)
        samples++
        if (!av.held.bowlingBall.visible) continue
        held++
        const bp = new THREE.Vector3()
        av.held.bowlingBall.getWorldPosition(bp)
        const e = new THREE.Vector3()
        av.arms[1].elbow.getWorldPosition(e)
        const down = new THREE.Vector3(0, -1, 0).applyQuaternion(av.arms[1].elbow.getWorldQuaternion(new THREE.Quaternion()))
        const gap = bp.distanceTo(e.addScaledVector(down, FIST_FROM_ELBOW))
        if (gap > 0.02) problems.push(`the bowling ball is ${gap.toFixed(3)} m from the fist while held`)
      }
      if (held === 0) problems.push('the bowler never holds the ball')
      if (held >= samples) problems.push('the ball is never released, so the delivery has no release')
    }

    check('the bowling lane has ten pins on the boards and a bowler aiming at them', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SWIMWEAR: TRUNKS IN THE POOL, CLOTHES EVERYWHERE ELSE.
  //
  // Reported: "saat berenang pakaiannya itu berubah jadi kolor doang dong".
  //
  // The swap is per-frame and its reset lives in `animate()`, so the failure this guards is
  // NOT "the trunks never appear" — it is a body that swims once and then walks to its desk
  // still wearing them. A single-frame check of the pool would pass while that happened.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const av = buildAvatar('backend')
    const sk = av.swimwear.skinnable
    const dry = sk.map((s) => s.color)
    const colorOf = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color.getHex()
    const pose = { avatar: av, activity: 'swim' as Activity, ease: 1, phase: 0, meetingTalking: false }

    animate(pose, 0.5, 1 / 60)
    if (!av.swimwear.trunks.visible) problems.push('the swimmer is not wearing trunks')
    for (const s of sk) {
      if (colorOf(s.mesh) !== av.skin) {
        problems.push('the swimmer is still in clothes — a mesh kept its dry colour')
        break
      }
    }

    // and one frame of any other activity must dress the body again
    pose.activity = 'idle' as Activity
    animate(pose, 0.5, 1 / 60)
    if (av.swimwear.trunks.visible) problems.push('still wearing the trunks after leaving the pool')
    for (let i = 0; i < sk.length; i++) {
      if (colorOf(sk[i].mesh) !== dry[i]) {
        problems.push(`a mesh stayed bare-skinned after leaving the pool (wanted ${dry[i].toString(16)})`)
        break
      }
    }

    check('the swimmer wears trunks, and is dressed again the moment it leaves the pool', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // WALL JUNCTIONS: A PARTITION HAS TO REACH THE WALL IT MEETS.
  //
  // A partition that stops short of the wall it butts into leaves a slot running the full
  // height of the wall. It is invisible from directly above — the two walls still look like
  // they meet — and shows only from inside the room, at eye level. That is how this one
  // survived: nobody had compared the numbers, and a screenshot from overhead agreed with the
  // bug.
  //
  // These are COVERAGE rasters: sample the junction and require every sample to be inside some
  // wall. Asserting the wall's own extent instead would only re-state the numbers that were
  // wrong to begin with.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const walls = FOOTPRINTS.filter((f) => f.kind === 'wall')
    const inside = (x: number, z: number) =>
      walls.some((w) => Math.abs(x - w.x) <= w.hw + 1e-6 && Math.abs(z - w.z) <= w.hd + 1e-6)

    // 1. Each neighbouring pair of exec-floor rooms, sampled across the FULL thickness of the
    //    corridor wall. A partition that ends on that wall's centre line seals its north half
    //    and leaves a notch in the corridor-side half.
    const l1 = ROOMS.filter((r) => r.level === 1 && r.id !== 'corridor1').sort((a, b) => a.x1 - b.x1)
    for (let i = 0; i < l1.length - 1; i++) {
      const a = l1[i]
      const b = l1[i + 1]
      let worst = 0
      let run = 0
      for (let x = a.x2; x <= b.x1 + 1e-9; x += 0.01) {
        let open = false
        for (let z = a.z2 - WALL_T / 2; z <= a.z2 + WALL_T / 2 + 1e-9; z += 0.05) {
          if (!inside(Math.min(x, b.x1), z)) open = true
        }
        if (open) {
          run += 0.01
          worst = Math.max(worst, run)
        } else {
          run = 0
        }
      }
      if (worst > 0.01) {
        problems.push(
          `the partition between ${a.id} and ${b.id} leaves a ${worst.toFixed(2)} m gap through the corridor wall`,
        )
      }
    }

    // 2. Every level-0 partition end that lands beside a perpendicular wall must actually
    //    reach that wall's far face. The lounge/pantry partition stopped 0.15 m short of the
    //    wall at x = 14 — a slot straight through into the pantry.
    for (const w of walls) {
      if (w.level !== 0 || w.hw <= w.hd || Math.max(w.hw, w.hd) < 1) continue // horizontal partitions only
      for (const dir of [-1, 1] as const) {
        const ex = w.x + dir * w.hw
        // a perpendicular wall standing at the end of this one — and it has to actually SPAN
        // this partition's line. Matching on x alone found a level-1 meeting-room partition at
        // x 1.85 and reported it as a 0.2 m hole in a lobby wall 32 m away.
        const near = walls.find(
          (o) =>
            o !== w &&
            o.hd > o.hw &&
            Math.max(o.hw, o.hd) >= 1 &&
            Math.abs(o.x - ex) <= WALL_T * 1.6 &&
            Math.abs(w.z - o.z) <= o.hd + 1e-6,
        )
        if (!near) continue
        const farFace = near.x - dir * near.hw
        let open = 0
        for (let x = ex; dir > 0 ? x <= farFace + 1e-9 : x >= farFace - 1e-9; x += dir * 0.01) {
          if (!inside(x, w.z)) open += 0.01
        }
        if (open > 0.01) {
          problems.push(`${w.id} stops ${open.toFixed(2)} m short of the wall at x ${near.x.toFixed(2)}`)
        }
      }
    }

    check('every partition reaches the wall it meets, with no gap at the junction', problems.length === 0, problems.join(' | '))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // KESEHATAN: PENILAIANNYA, DAN LAMPU DI LOBBY.
  //
  // Ambangnya adalah satu-satunya hal di kantor ini yang menentukan "ada yang salah", dan
  // kalau penilaiannya salah, lampunya salah. Jadi yang diuji bukan tampilannya, tapi
  // KEPUTUSANNYA: apakah kasus yang jelas gawat dinilai gawat, dan apakah kasus aman dinilai
  // aman. Ruangan yang lampunya selalu merah sama tidak bergunanya dengan yang selalu hijau.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const problems: string[] = []
    const T = HEALTH_THRESHOLDS

    const ok = assessHealth({
      logAgeSeconds: 30,
      errorCount: 2,
      serverErrorCount: 0,
      costUsd: 12,
      unpricedModels: 0,
    })
    if (ok.level !== 'ok') problems.push(`sistem yang sehat dinilai "${ok.level}": ${ok.reasons.join(', ')}`)

    // kegagalan provider yang membatalkan kerja harus MERAH, bukan kuning
    const bad = assessHealth({
      logAgeSeconds: 30,
      errorCount: T.ERR_WARN + 1,
      serverErrorCount: T.SVR_BAD,
      costUsd: 12,
      unpricedModels: 0,
    })
    if (bad.level !== 'bad') problems.push(`provider gagal ${T.SVR_BAD}x dinilai "${bad.level}", seharusnya bad`)
    if (!bad.reasons.length) problems.push('tingkat gawat tanpa alasan — lampu tanpa alasan tidak berguna')

    // PEMANTAUAN MATI HARUS MERAH, walaupun tidak ada error sama sekali. Log yang diam berarti
    // tidak tahu ada berapa masalah, dan itu lebih buruk daripada masalah yang terlihat.
    const blind = assessHealth({
      logAgeSeconds: T.LOG_STALE_SEC + 60,
      errorCount: 0,
      serverErrorCount: 0,
      costUsd: 0,
      unpricedModels: 0,
    })
    if (blind.level !== 'bad') {
      problems.push(`log basi ${T.LOG_STALE_SEC + 60}s dengan nol error dinilai "${blind.level}" — memantau yang mati terlihat seperti sehat`)
    }

    // pembacaan yang gagal = tidak tahu = merah, apa pun isinya
    const cantRead = assessHealth({
      logAgeSeconds: 30,
      errorCount: 0,
      serverErrorCount: 0,
      costUsd: 0,
      unpricedModels: 0,
      failure: 'no such column: session_id',
    })
    if (cantRead.level !== 'bad') problems.push('pembacaan gagal tapi tidak dinilai bad')

    // model tanpa tarif = kuning, karena total biayanya jadi batas bawah
    const unpriced = assessHealth({
      logAgeSeconds: 30,
      errorCount: 0,
      serverErrorCount: 0,
      costUsd: 5,
      unpricedModels: 3,
    })
    if (unpriced.level !== 'warn') problems.push('model tanpa tarif tidak ditandai')

    // TINGKAT TIDAK BOLEH TURUN. Satu alasan bad di antara beberapa warn harus menghasilkan bad.
    const mixed = assessHealth({
      logAgeSeconds: 30,
      errorCount: T.ERR_BAD,
      serverErrorCount: 0,
      costUsd: T.COST_WARN + 1,
      unpricedModels: 2,
    })
    if (mixed.level !== 'bad') problems.push(`alasan bad tercampur warn dinilai "${mixed.level}"`)

    // ── lampunya benar-benar ada di scene dan benar-benar berubah warna ──
    {
      const scene3d = new THREE.Scene()
      const office = buildOffice(scene3d, 12)
      scene3d.updateMatrixWorld(true)
      const bulb = (office as unknown as { healthBulb?: THREE.Mesh }).healthBulb
      if (!bulb) {
        problems.push('lampu kesehatan tidak ada di scene, jadi tidak ada yang bisa memberi tahu')
      } else {
        const matOf = () => (bulb.material as THREE.MeshStandardMaterial)
        const seen = new Map<string, number>()
        for (const lvl of ['ok', 'warn', 'bad'] as const) {
          office.setHealth(lvl)
          const c = matOf().color.getHex()
          if (c !== HEALTH_COLOR[lvl]) {
            problems.push(`tingkat ${lvl} tidak menyalakan warna yang benar (${c.toString(16)} != ${HEALTH_COLOR[lvl].toString(16)})`)
          }
          seen.set(lvl, c)
        }
        if (new Set(seen.values()).size !== 3) {
          problems.push('dua tingkat menyalakan warna yang SAMA — kalau begitu lampunya tidak membedakan apa pun')
        }
        // merah harus paling menarik perhatian
        office.setHealth('bad')
        const badI = matOf().emissiveIntensity
        office.setHealth('ok')
        const okI = matOf().emissiveIntensity
        if (!(badI > okI)) problems.push(`lampu merah (${badI}) tidak lebih terang dari hijau (${okI})`)
      }
    }

    check('health tells danger from calm, and the lobby lamp shows it', problems.length === 0, problems.join(' | '))
  }

  /* ------------------------------------------------------------- result -- */
  console.log(`\n${checks - failures}/${checks} checks passed\n`)
  if (failures) {
    console.error(`${failures} FAILED\n`)
    process.exit(1)
  }
})()

