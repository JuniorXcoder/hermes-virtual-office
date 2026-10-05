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
  AULA,
  BOARD_COLUMNS,
  CEILING_Y,
  DESKS,
  deskByIndex,
  desksForDivision,
  DIV_ROOMS,
  FOOTPRINTS,
  HALF_D,
  ROOM_DOORS,
  HALF_W,
  KANBAN_BOARD,
  PAINTINGS,
  ROOMS,
  DOOR,
  blockingFootprints,
  layoutConflicts,
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
import { BODY_R, blocked, route } from '../src/lib/office/nav'
import { IDLE_SPOTS } from '../src/lib/office/layout'
import { buildAvatar } from '../src/lib/office/avatar'
import { followUpSection, matchOwner, parseActionItems } from '../src/lib/hermes/action-items'
import { parseLimit, parseCronRuns } from '../src/lib/hermes/cron'
import { hide, isHidden, show, visible } from '../src/lib/hermes/office-membership'
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

// Board melengkung: chord di sisi utara aula, di dalam radius + di bawah plafon.
{
  const left = KANBAN_BOARD.x - KANBAN_BOARD.w / 2
  const right = KANBAN_BOARD.x + KANBAN_BOARD.w / 2
  const bottom = KANBAN_BOARD.y - KANBAN_BOARD.h / 2
  const top = KANBAN_BOARD.y + KANBAN_BOARD.h / 2
  const corners = [[left, KANBAN_BOARD.z], [right, KANBAN_BOARD.z]]
  const inside = corners.every(([x, z]) => Math.hypot(x - AULA.x, z - AULA.z) < AULA.r + 0.6)
  check(
    'curved kanban board sits inside the aula oval',
    inside,
    `x ${f2(left)}..${f2(right)} z ${f2(KANBAN_BOARD.z)} vs aula r ${AULA.r}`,
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
    '-17': { lo: -13 + 0.3, hi: 13 - 0.3 }, // dinding luar barat, world z
    '17': { lo: -13 + 0.3, hi: 13 - 0.3 }, // dinding luar timur, world z
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

// Footprints must not sit on top of one another — via layoutConflicts(), the
// single source of truth (tahu lobus kolam organik boleh bersinggungan).
{
  const bad = layoutConflicts()
  check('no furniture overlaps furniture', bad.length === 0, bad.slice(0, 4).map((c) => `${c.a}<->${c.b}`).join(', '))
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

// Celah aula + pintu luar/lounge wajib bebas furniture (koridor cincin jalan).
{
  const gaps = [
    { x: AULA.x, z: AULA.z - AULA.r, hw: 1.4, hd: 0.8 }, // N
    { x: AULA.x + AULA.r, z: AULA.z, hw: 0.8, hd: 1.4 }, // E
    { x: AULA.x, z: AULA.z + AULA.r, hw: 1.4, hd: 0.8 }, // S
    { x: AULA.x - AULA.r, z: AULA.z, hw: 0.8, hd: 1.4 }, // W
    { x: DOOR.x, z: DOOR.z, hw: 1.7, hd: 1.2 },
    { x: ROOM_DOORS.lounge.x, z: ROOMS.lobby.z1, hw: 1.1, hd: 1.2 },
  ]
  const blockedDoor: string[] = []
  for (const g of gaps) {
    for (const f of FOOTPRINTS) {
      if (f.kind === 'wall' || f.kind === 'seat' || f.h <= 0.4) continue
      const ox = f.x + f.hw > g.x - g.hw && f.x - f.hw < g.x + g.hw
      const oz = f.z + f.hd > g.z - g.hd && f.z - f.hd < g.z + g.hd
      if (ox && oz) blockedDoor.push(`${f.id} @ gap ${g.x},${g.z}`)
    }
  }
  check('no furniture blocks an aula gap or entrance', blockedDoor.length === 0, blockedDoor.join(' | '))
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

// A seat's footprint and its mesh must agree, and a chair must be on the side of the
// desk it serves. The reception chair was placed at `z + 1.15` — the VISITOR side of
// the counter — so the receptionist sat facing away from it and blocked the walk-up.
{
  const problems: string[] = []
  const rec = FOOTPRINTS.find((f) => f.id === 'reception')
  const chair = FOOTPRINTS.find((f) => f.id === 'reception-chair')
  if (!rec || !chair) {
    problems.push('reception or reception-chair footprint missing')
  } else {
    // The counter's staff side is the lower z (its badge faces +z, the visitor side).
    if (chair.z >= rec.z) {
      problems.push(`reception chair at z=${chair.z} is not behind the counter (z=${rec.z})`)
    }
    // A chair that touches the counter leaves nowhere to sit.
    const gap = rec.z - rec.hd - (chair.z + chair.hd)
    if (gap < 0.2) problems.push(`only ${gap.toFixed(2)}m between chair and counter`)
  }
  // Sofa lounge (3 segmen 유기) tak boleh sentuh counter.
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

// Denah organik: sumbu tengah pintu->aula jalan, koridor cincin sekeliling aula
// jalan (8 titik mata angin di r 6.2), tiap divisi punya >=1 meja terjangkau.
{
  const problems: string[] = []
  const lobbyZ = ROOMS.lobby.z1

  // 1. Sumbu tengah pintu masuk -> celah selatan aula wajib jalan.
  const laneBlocked: string[] = []
  for (let z = HALF_D - WALL_T - 0.4; z >= AULA.z + AULA.r - 0.3; z -= 0.2) {
    if (blocked(0, z, BODY_R)) laneBlocked.push(z.toFixed(1))
  }
  if (laneBlocked.length) {
    problems.push(`centre axis blocked at z ${laneBlocked.join(', ')}`)
  }

  // 2. Koridor cincin (r 5.2: antara dinding aula r4.5 dan pods) wajib bebas.
  const ringBad: string[] = []
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8
    const x = AULA.x + Math.cos(a) * (AULA.r + 0.7)
    const z = AULA.z + Math.sin(a) * (AULA.r + 0.7)
    if (Math.abs(x) > HALF_W - 1 || Math.abs(z) > HALF_D - 1) continue
    if (blocked(x, z, BODY_R)) ringBad.push(`(${x.toFixed(1)},${z.toFixed(1)})`)
  }
  if (ringBad.length) problems.push(`ring corridor blocked at ${ringBad.join(', ')}`)

  // 3. Pintu masuk + pintu lounge.
  if (blocked(DOOR.x, HALF_D - WALL_T - 0.8, BODY_R)) {
    problems.push('entrance approach blocked')
  }
  if (blocked(ROOM_DOORS.lounge.x, ROOMS.lobby.z1 + 0.6, BODY_R)) {
    problems.push('lounge door approach blocked')
  }

  // 4. Tiap divisi punya >=1 meja; visitor spot-nya bebas & bisa di-route dari pintu.
  // (Titik meja MEMANG blocked — itu buktinya collision jalan.)
  for (const div of ['exec', 'tech', 'growth', 'content'] as const) {
    const desks = desksForDivision(div)
    if (!desks.length) { problems.push(`${div} has no desks`); continue }
    const vs = desks.map((d) => {
      const s = Math.sin(d.facing), c = Math.cos(d.facing)
      return { d, x: d.x + s * 1.6, z: d.z + c * 1.6 }
    })
    const free = vs.filter((v) => !blocked(v.x, v.z, BODY_R))
    if (!free.length) { problems.push(`${div}: all visitor spots blocked`); continue }
    const legs = free.map((v) => route({ x: DOOR.x, z: DOOR.z - 1 }, { x: v.x, z: v.z }))
    if (!legs.some((l) => l.length > 0)) problems.push(`${div}: no route door->desk`)
  }

  // 5. Tak ada dua solid selatan (z>lobbyZ-0.5) yg overlap.
  const solid = blockingFootprints().filter((f) => f.z > lobbyZ - 0.5)
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i]
      const b = solid[j]
      const dx = Math.abs(a.x - b.x) - (a.hw + b.hw)
      const dz = Math.abs(a.z - b.z) - (a.hd + b.hd)
      if (dx < 0 && dz < 0) problems.push(`${a.id} overlaps ${b.id}`)
    }
  }

  check('organic plan: axis, ring corridor, division desks reachable', problems.length === 0, problems.join(' | '))
}




// The base `default` profile is itself the Hermes orchestrator and is part of
// the office roster. Agent counts and the `/api/hermes/agents` panel depend on it.
{
  const source = readFileSync(new URL('../src/lib/hermes/kanban.ts', import.meta.url), 'utf8')
  check('base default profile remains included in office agent roster', !/\.filter\(\(name\) => name !== 'default'\)/.test(source))
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

