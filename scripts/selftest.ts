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
  LEVEL_H,
  MEETING_ROOMS,
  MEETING_ROOM_IDS,
  meetingRoomFor,
  POOL,
  LOUNGE,
  LOUNGE_TABLE,
  LOUNGE_TV,
  MEETING_TABLES,
  POOL_LOUNGERS,
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
} from '../src/lib/office/layout'
import { BODY_R, blocked, onStairArea, route, routeBetween, stairCentre } from '../src/lib/office/nav'
import { dummyRoster } from '../src/lib/office/dummy-roster'
import { buildOffice } from '../src/lib/office/build'
import type { MeetingRoomId } from '../src/lib/office/layout'
import { IDLE_SPOTS } from '../src/lib/office/layout'
import { buildAvatar } from '../src/lib/office/avatar'
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
{
  const dead = IDLE_SPOTS.filter((p) => blocked(p.x, p.z, BODY_R, { allowSeat: p.seated }))
  check(
    'every idle spot is reachable',
    dead.length === 0,
    dead.map((p) => `(${p.x},${p.z}) ${p.act}`).join(' | '),
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

  /* ------------------------------------------------------------- result -- */
  console.log(`\n${checks - failures}/${checks} checks passed\n`)
  if (failures) {
    console.error(`${failures} FAILED\n`)
    process.exit(1)
  }
})()

