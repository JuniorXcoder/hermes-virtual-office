'use client'

import { useEffect, useRef } from 'react'
import type { Agent, Meeting, Task } from '@/types/hermes'
import { useOffice } from '@/lib/store'
import { columnOf } from '@/lib/office/board'
import {
  BOOK_NOOK, CONFERENCE, CONFERENCE_CHAIRS, DESKS, DOOR, FLOOR, GARDEN, HALF_D, HALF_W,
  IDLE_SPOTS, LOUNGE, NORTH_WINDOWS, PANTRY, RECEPTION, ROOM_DOORS, ROOMS,
  ROLE_COLORS, SIDE_WINDOWS, WALL_H, WALL_T, deskSeatWorld, visitorSpot,
} from '@/lib/office/layout'
import { route } from '@/lib/office/nav'

/*
 * Isometric pixel map of the SAME office the 3D view builds.
 *
 * Every coordinate below comes from `layout.ts` — DESKS, CONFERENCE, ROOMS,
 * ROOM_DOORS, LOUNGE, PANTRY, RECEPTION, IDLE_SPOTS — so the two views cannot
 * drift apart. The projection is the classic 2:1 iso: `sx` spreads world (x, z)
 * across the screen, `sy` stacks it downward, and `at()` adds height, which is
 * what lifts walls and furniture off the floor plane.
 *
 * Cost control for small laptops: the room is rasterised ONCE into an offscreen
 * layer, then each frame only blits it and redraws the handful of things that
 * move (agents, kanban cards) at 12 fps, stopping entirely while the tab is hidden.
 */
const T = 12
const U = 11
const OX = 392
const OY = 236
const W = 784
const H = 520
const sx = (x: number, z: number) => OX + (x - z) * T
const sy = (x: number, z: number) => OY + (x + z) * T / 2
type Pt = [number, number]
const at = (x: number, z: number, y = 0): Pt => [sx(x, z), sy(x, z) - y * U]

const C = {
  floorA: '#b6955f', floorB: '#c1a26c',
  wallTop: '#e6e2cf', wallSide: '#cbd0be', partTop: '#d6d2c1', partSide: '#aeb3a3',
  wood: '#8d6238', woodTop: '#c69a5c', metal: '#5b6a73', screen: '#33505a',
  rug: '#6f8f6b', rug2: '#5f7fa0', leaf: '#4f8149', leaf2: '#6da05c', pot: '#a86a4c',
  cream: '#efe6cd', sofa: '#4f7ba3', board: '#2f5a45', glass: '#8fc3cc',
}

function poly(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string) {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.fill()
}

/** Ground-plane quad: rugs, floor tiles, shadows. */
function flat(ctx: CanvasRenderingContext2D, x: number, z: number, w: number, d: number, fill: string) {
  poly(ctx, [at(x - w / 2, z - d / 2), at(x + w / 2, z - d / 2), at(x + w / 2, z + d / 2), at(x - w / 2, z + d / 2)], fill)
}

/**
 * Upright box. `dir` picks which side faces are visible: 's' for a run along x
 * (north wall, room divider), 'e' for a run along z (side wall, partitions),
 * 'both' for free-standing furniture.
 */
function solid(
  ctx: CanvasRenderingContext2D,
  x: number, z: number, w: number, d: number, h: number,
  top: string, side: string, dir: 's' | 'e' | 'both' = 'both',
) {
  const x1 = x - w / 2, x2 = x + w / 2, z1 = z - d / 2, z2 = z + d / 2
  if (dir !== 'e') poly(ctx, [at(x1, z2), at(x2, z2), at(x2, z2, h), at(x1, z2, h)], side)
  if (dir !== 's') poly(ctx, [at(x2, z1), at(x2, z2), at(x2, z2, h), at(x2, z1, h)], side)
  poly(ctx, [at(x1, z1, h), at(x2, z1, h), at(x2, z2, h), at(x1, z2, h)], top)
}

/** Static room: floor, walls, kanban backing, all furniture. Rasterised once. */
function buildStatic(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#141d24'
  ctx.fillRect(0, 0, W, H)

  for (let x = -HALF_W; x < HALF_W; x++) {
    for (let z = -HALF_D; z < HALF_D; z++) {
      flat(ctx, x + 0.5, z + 0.5, 1, 1, ((x + z) & 1) ? C.floorA : C.floorB)
    }
  }
  flat(ctx, CONFERENCE.x, CONFERENCE.z, 7.4, 6.2, C.rug)
  flat(ctx, LOUNGE.x, LOUNGE.z - 1.45, 4.2, 3.8, C.rug2)
  flat(ctx, 0, 9.5, 8, 5, '#93a67b')

  // Painter's order: everything is sorted by depth (x + z), so near props cover far ones.
  const items: { d: number; f: () => void }[] = []
  const push = (x: number, z: number, f: () => void) => items.push({ d: x + z, f })

  /* ---- north wall: windows + the Kanban board the 3D view hangs there too -- */
  push(0, -HALF_D, () => {
    solid(ctx, 0, -HALF_D, FLOOR.width, WALL_T, WALL_H, C.wallTop, C.wallSide, 's')
    const face = -HALF_D + WALL_T / 2
    for (const win of NORTH_WINDOWS) {
      poly(ctx, [
        at(win.x - win.w / 2, face, win.y), at(win.x + win.w / 2, face, win.y),
        at(win.x + win.w / 2, face, win.y + win.h), at(win.x - win.w / 2, face, win.y + win.h),
      ], C.glass)
    }
    const bw = 11.2, y0 = 0.35, y1 = 4.25
    poly(ctx, [at(-bw / 2, face, y0), at(bw / 2, face, y0), at(bw / 2, face, y1), at(-bw / 2, face, y1)], C.board)
    for (let i = 0; i < 4; i++) {
      const cx = -bw / 2 + bw * (i + 0.5) / 4
      poly(ctx, [at(cx - 1.2, face, y1 - 0.4), at(cx + 1.2, face, y1 - 0.4), at(cx + 1.2, face, y1 - 0.08), at(cx - 1.2, face, y1 - 0.08)], '#8fd0ae')
    }
  })

  /* ---- west wall, glazed on the same SIDE_WINDOWS offsets ----------------- */
  push(-HALF_W, 0, () => {
    solid(ctx, -HALF_W, 0, WALL_T, FLOOR.depth, WALL_H, C.wallTop, C.wallSide, 'e')
    const face = -HALF_W + WALL_T / 2
    for (const z of SIDE_WINDOWS) {
      poly(ctx, [
        at(face, z - 1.2, 2.7), at(face, z + 1.2, 2.7), at(face, z + 1.2, 4.6), at(face, z - 1.2, 4.6),
      ], C.glass)
    }
  })

  /* ---- interior walls, split into segments so depth sorting stays honest --- */
  const runX = (x1: number, x2: number, z: number, h: number) => {
    for (let x = x1; x < x2 - 0.01; x += 2) {
      const xe = Math.min(x + 2, x2)
      const xc = (x + xe) / 2
      push(xc, z, () => solid(ctx, xc, z, xe - x, WALL_T, h, C.partTop, C.partSide, 's'))
    }
  }
  const runZ = (z1: number, z2: number, x: number, h: number) => {
    for (let z = z1; z < z2 - 0.01; z += 2) {
      const ze = Math.min(z + 2, z2)
      const zc = (z + ze) / 2
      push(x, zc, () => solid(ctx, x, zc, WALL_T, ze - z, h, C.partTop, C.partSide, 'e'))
    }
  }
  // meeting | work | lounge dividers, and the low lobby threshold with its doorways
  runZ(ROOMS.work.z1, ROOMS.work.z2, ROOMS.work.x1, 1.4)
  runZ(ROOMS.work.z1, ROOMS.work.z2, ROOMS.work.x2, 1.4)
  let cursor = -HALF_W + WALL_T
  for (const door of [ROOM_DOORS.meeting, ROOM_DOORS.work, ROOM_DOORS.lounge].sort((a, b) => a.x - b.x)) {
    runX(cursor, door.x - door.width / 2, ROOMS.work.z2, 0.5)
    cursor = door.x + door.width / 2
  }
  runX(cursor, HALF_W - WALL_T, ROOMS.work.z2, 0.5)
  runX(-HALF_W + WALL_T, -1.7, HALF_D, 0.55)
  runX(1.7, HALF_W - WALL_T, HALF_D, 0.55)

  /* ---- meeting room ------------------------------------------------------- */
  push(CONFERENCE.x, CONFERENCE.z, () => {
    const [cx, cy] = at(CONFERENCE.x, CONFERENCE.z)
    const rx = CONFERENCE.radius * T * Math.SQRT2
    ctx.fillStyle = '#6f4c2c'
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx / 2, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = C.woodTop
    ctx.beginPath(); ctx.ellipse(cx, cy - 8, rx, rx / 2, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#3fae9f'
    ctx.fillRect(cx - 14, cy - 12, 28, 5)
  })
  for (let i = 0; i < CONFERENCE_CHAIRS.count; i++) {
    const ang = CONFERENCE_CHAIRS.offset + i / CONFERENCE_CHAIRS.count * Math.PI * 2
    const cx = CONFERENCE.x + Math.cos(ang) * CONFERENCE_CHAIRS.ring
    const cz = CONFERENCE.z + Math.sin(ang) * CONFERENCE_CHAIRS.ring
    push(cx, cz, () => solid(ctx, cx, cz, 0.6, 0.6, 0.5, C.metal, '#3f4a52'))
  }

  /* ---- the eight work stations, monitors facing the sitter --------------- */
  for (const desk of DESKS) {
    push(desk.x, desk.z, () => {
      solid(ctx, desk.x, desk.z, 2.0, 1.0, 0.78, C.woodTop, C.metal)
      const mx = desk.x - Math.sin(desk.facing) * 0.28
      const mz = desk.z - Math.cos(desk.facing) * 0.28
      solid(ctx, mx, mz, 0.8, 0.2, 0.92, C.screen, '#3a4750')
    })
    const seat = deskSeatWorld(desk)
    push(seat.x, seat.z, () => solid(ctx, seat.x, seat.z, 0.7, 0.7, 0.5, C.metal, '#3f4a52'))
  }

  /* ---- lounge, garden, book nook, pantry, reception ---------------------- */
  push(LOUNGE.x, LOUNGE.z - 1.45, () => solid(ctx, LOUNGE.x, LOUNGE.z - 1.45, 3.5, 1.1, 0.7, C.sofa, '#3f6486'))
  push(LOUNGE.x, LOUNGE.z - 4.9, () => solid(ctx, LOUNGE.x, LOUNGE.z - 4.9, 2.6, 0.7, 0.55, '#39464d', '#2b353b'))
  push(LOUNGE.x - 2.1, LOUNGE.z - 3.9, () => solid(ctx, LOUNGE.x - 2.1, LOUNGE.z - 3.9, 0.8, 0.8, 0.42, '#c3b49a', '#9c8f78'))
  push(LOUNGE.x + 2.6, LOUNGE.z - 0.4, () => solid(ctx, LOUNGE.x + 2.6, LOUNGE.z - 0.4, 1.0, 1.0, 0.85, '#c3b49a', '#9c8f78'))
  push(BOOK_NOOK.x, BOOK_NOOK.z - 1.3, () => solid(ctx, BOOK_NOOK.x, BOOK_NOOK.z - 1.3, 2.6, 0.44, 1.8, '#7a5b41', '#5b4130'))
  push(GARDEN.x, GARDEN.z, () => {
    solid(ctx, GARDEN.x, GARDEN.z, 0.56, 2.9, 0.55, '#8a6a45', '#6a4f34')
    for (let i = 0; i < 5; i++) {
      const [cx, cy] = at(GARDEN.x, GARDEN.z - 1.15 + i * 0.58, 0.55)
      ctx.fillStyle = i % 2 ? C.leaf : C.leaf2
      ctx.fillRect(cx - 4, cy - 9, 9, 9)
    }
  })
  push(PANTRY.x, PANTRY.z, () => solid(ctx, PANTRY.x, PANTRY.z, 3.0, 0.9, 1.0, C.woodTop, C.wood))
  push(RECEPTION.x, RECEPTION.z, () => solid(ctx, RECEPTION.x, RECEPTION.z, 3.2, 0.9, 1.0, C.woodTop, C.wood))
  push(12.8, 10.3, () => solid(ctx, 12.8, 10.3, 1.5, 0.9, 1.05, C.woodTop, C.wood))

  const plant = (x: number, z: number) => push(x, z, () => {
    solid(ctx, x, z, 0.6, 0.6, 0.5, C.pot, '#8a5238')
    const [cx, cy] = at(x, z, 0.5)
    ctx.fillStyle = C.leaf
    ctx.fillRect(cx - 5, cy - 12, 11, 12)
    ctx.fillStyle = C.leaf2
    ctx.fillRect(cx - 8, cy - 7, 6, 8)
    ctx.fillRect(cx + 3, cy - 9, 6, 9)
    ctx.fillStyle = '#3f6f3c'
    ctx.fillRect(cx - 2, cy - 16, 6, 6)
  })
  plant(-15.6, 6); plant(15.6, 6); plant(-9, 5); plant(9.2, 4.4)

  items.sort((a, b) => a.d - b.d)
  for (const item of items) item.f()
  return cv
}

/** Same destination rules as the 3D simulation, so agents stand in the same places. */
function agentSpot(a: Agent, i: number, meeting: Meeting | null) {
  if (meeting && (meeting.state === 'queued' || meeting.state === 'running') && meeting.participants.includes(a.name)) {
    const n = meeting.participants.indexOf(a.name) % CONFERENCE_CHAIRS.count
    const ang = CONFERENCE_CHAIRS.offset + n * Math.PI * 2 / CONFERENCE_CHAIRS.count
    return { x: CONFERENCE.x + Math.cos(ang) * CONFERENCE_CHAIRS.ring, z: CONFERENCE.z + Math.sin(ang) * CONFERENCE_CHAIRS.ring, seated: true }
  }
  const desk = a.deskIndex == null ? undefined : DESKS.find((d) => d.index === a.deskIndex)
  if (desk && (a.status === 'working' || a.status === 'blocked')) {
    const seat = deskSeatWorld(desk)
    return { x: seat.x, z: seat.z, seated: true }
  }
  if (desk && a.status === 'review') {
    const v = visitorSpot(desk)
    return { x: v.x, z: v.z, seated: false }
  }
  const spot = IDLE_SPOTS[i % IDLE_SPOTS.length]
  return { x: spot.x, z: spot.z, seated: !!spot.seated }
}

/* ----------------------------------------------------------------- walk --- */

type Dir = 's' | 'n' | 'e' | 'w'

type Motion = {
  x: number
  z: number
  /** Remaining waypoints from route(); empty once the agent has arrived. */
  path: { x: number; z: number }[]
  /** The destination the current path was computed for. */
  goal: { x: number; z: number }
  dir: Dir
  moving: boolean
}

const WALK_MPS = 2.6

/**
 * Move every agent along an A* route toward its current destination.
 *
 * The 3D scene does the same thing, and for the same reason: an agent that snaps
 * from desk to meeting table reads as a teleport, not as an office. Routes come
 * from `nav.ts`, the same grid the 3D avatars walk, so the two views agree on what
 * is walkable. A new agent enters through the front door.
 */
function stepMotions(
  agents: Agent[],
  meeting: Meeting | null,
  dt: number,
  motions: Map<string, Motion>,
) {
  const step = WALK_MPS * Math.min(dt, 0.25)
  agents.forEach((a, i) => {
    const target = agentSpot(a, i, meeting)
    let m = motions.get(a.name)
    if (!m) {
      // A new agent enters through the front door, not on top of its desk.
      const from = { x: DOOR.x, z: DOOR.z - 1.4 }
      m = { ...from, path: route(from, target), goal: target, dir: 'n', moving: true }
      if (!m.path.length) m.path = [{ x: target.x, z: target.z }]
      motions.set(a.name, m)
    }
    // Recompute only when the destination actually moved; a meeting starting or a
    // task arriving changes it, an idle agent does not.
    if (Math.hypot(target.x - m.goal.x, target.z - m.goal.z) > 0.4) {
      m.goal = { x: target.x, z: target.z }
      m.path = route({ x: m.x, z: m.z }, { x: target.x, z: target.z })
      // route() returns [] when no path exists; a straight line beats freezing.
      if (!m.path.length) m.path = [{ x: target.x, z: target.z }]
    }
    if (!m.path.length) {
      m.x = target.x
      m.z = target.z
      m.moving = false
      return
    }
    const wp = m.path[0]
    const dx = wp.x - m.x
    const dz = wp.z - m.z
    const d = Math.hypot(dx, dz)
    if (d <= step) {
      m.x = wp.x
      m.z = wp.z
      m.path.shift()
    } else {
      m.x += (dx / d) * step
      m.z += (dz / d) * step
    }
    m.moving = true
    // Facing is decided in SCREEN space: the iso projection tilts the axes, so a
    // world-space angle would point the sprite at the wrong side of the room.
    const ix = dx - dz
    const iy = dx + dz
    if (Math.abs(ix) > Math.abs(iy)) m.dir = ix > 0 ? 'e' : 'w'
    else if (Math.abs(iy) > 0.001) m.dir = iy > 0 ? 's' : 'n'
  })
  for (const name of [...motions.keys()]) {
    if (!agents.some((a) => a.name === name)) motions.delete(name)
  }
}

const STATUS_DOT: Record<string, string> = {
  working: '#5fd08d', review: '#e0b95f', blocked: '#e8705f', meeting: '#8f86d6', done: '#6fae8a', idle: '#9fb0b8',
}

function person(
  ctx: CanvasRenderingContext2D, a: Agent, x: number, z: number, t: number,
  seated: boolean, selected: boolean, talking: boolean, dir: Dir, moving: boolean,
) {
  const [cx, cy] = at(x, z)
  const color = `#${(ROLE_COLORS[a.role] ?? 0x5b91a6).toString(16).padStart(6, '0')}`
  const seed = [...a.name].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0
  const skin = ['#f0c49c', '#d79a71', '#b4765a', '#e8b489', '#7f513e'][seed % 5]
  const hair = ['#2f2a2b', '#584033', '#1d2a2f', '#a25d3c', '#c3a05e'][seed % 5]
  // Two-frame walk cycle while moving, a slow breath while standing still, a
  // rock while seated — the FF6 trick: motion reads from the pose, not the frame rate.
  const frame = moving ? (Math.floor(t * 6) % 2 ? 1 : -1) : 0
  const bob = seated ? 0 : moving ? (Math.abs(frame) ? 0 : -1) : Math.round(Math.sin(t * 3 + seed))
  const y = seated ? cy - 5 : cy

  ctx.fillStyle = '#1b242b66'
  ctx.beginPath(); ctx.ellipse(cx, cy, 9, 4, 0, 0, Math.PI * 2); ctx.fill()
  if (selected) {
    ctx.strokeStyle = '#e6c35f'
    ctx.lineWidth = 1
    ctx.strokeRect(cx - 11, y - 31 + bob, 22, 35)
  }
  // legs: alternate length while walking so the two frames differ
  const legH = seated ? 3 : 5
  const legA = seated || !moving ? legH : legH + frame
  const legB = seated || !moving ? legH : legH - frame
  ctx.fillStyle = '#2c3a42'
  ctx.fillRect(cx - 6, y - 3, 5, 3)
  ctx.fillRect(cx + 1, y - 3, 5, 3)
  ctx.fillStyle = '#3d4b55'
  ctx.fillRect(cx - 5, y - 3 - legA, 4, legA)
  ctx.fillRect(cx + 1, y - 3 - legB, 4, legB)
  ctx.fillStyle = color
  ctx.fillRect(cx - 6, y - 16 + bob, 12, 9)
  ctx.fillRect(cx - 9, y - 15 + bob, 3, 7)
  ctx.fillRect(cx + 6, y - 15 + bob, 3, 7)
  ctx.fillStyle = skin
  ctx.fillRect(cx - 9, y - 9 + bob, 3, 3)
  ctx.fillRect(cx + 6, y - 9 + bob, 3, 3)
  ctx.fillRect(cx - 6, y - 26 + bob, 12, 10)
  ctx.fillStyle = hair
  ctx.fillRect(cx - 7, y - 28 + bob, 14, 5)
  // Facing: back of the head for 'n' (no face), side profile for e/w.
  if (dir === 'n') {
    ctx.fillRect(cx - 7, y - 24 + bob, 14, 8)
  } else {
    ctx.fillRect(cx - 7, y - 24 + bob, 3, 4)
    ctx.fillRect(cx + 4, y - 24 + bob, 3, 4)
    ctx.fillStyle = '#26323a'
    if (dir === 'e') {
      ctx.fillRect(cx + 1, y - 21 + bob, 2, 2)
    } else if (dir === 'w') {
      ctx.fillRect(cx - 3, y - 21 + bob, 2, 2)
    } else {
      ctx.fillRect(cx - 4, y - 21 + bob, 2, 2)
      ctx.fillRect(cx + 2, y - 21 + bob, 2, 2)
    }
    ctx.fillStyle = '#8f4c46'
    ctx.fillRect(cx - 1, y - 18 + bob, 3, 1)
  }
  if (talking && Math.floor(t * 3) % 2 === 0) {
    ctx.fillStyle = '#fff4d6'
    ctx.fillRect(cx + 8, y - 34, 18, 12)
    ctx.fillStyle = '#5a5140'
    ctx.fillRect(cx + 11, y - 30, 3, 2)
    ctx.fillRect(cx + 17, y - 30, 3, 2)
  }
}

type CardRect = { x: number; y: number; w: number; h: number; id: string }

/** Frame pass: blit the cached room, then the two things that actually change. */
function drawFrame(
  ctx: CanvasRenderingContext2D, room: HTMLCanvasElement,
  agents: Agent[], tasks: Task[], meeting: Meeting | null, selected: string | null,
  t: number, cards: CardRect[], motions: Map<string, Motion>, dt: number,
) {
  ctx.drawImage(room, 0, 0)
  cards.length = 0

  const face = -HALF_D + WALL_T / 2
  const bw = 11.2
  const columns: Task[][] = [[], [], [], []]
  for (const task of tasks) columns[columnOf(task.status)].push(task)
  ctx.font = 'bold 8px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const MAX_CARDS = 3
  const cardW = 1.9
  for (let i = 0; i < 4; i++) {
    const cx = -bw / 2 + bw * (i + 0.5) / 4
    const shown = columns[i].slice(0, MAX_CARDS)
    const quadAt = (y: number) => [
      at(cx - cardW / 2, face, y), at(cx + cardW / 2, face, y),
      at(cx + cardW / 2, face, y + 0.44), at(cx - cardW / 2, face, y + 0.44),
    ]
    shown.forEach((task, k) => {
      const quad = quadAt(3.5 - k * 0.66)
      poly(ctx, quad, C.cream)
      const xs = quad.map((p) => p[0])
      const ys = quad.map((p) => p[1])
      const x0 = Math.min(...xs), y0 = Math.min(...ys)
      cards.push({ x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0, id: task.id })
      ctx.fillStyle = '#3a4a3f'
      ctx.fillText(task.title.slice(0, 12), (quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2 - 4)
    })
    // Overflow badge: without it a backlog silently lost every card past the third.
    const extra = columns[i].length - shown.length
    if (extra > 0) {
      const quad = quadAt(3.5 - shown.length * 0.66)
      poly(ctx, quad, C.board)
      ctx.fillStyle = '#eaf6e6'
      ctx.fillText(`+${extra}`, (quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2 - 4)
    }
  }

  stepMotions(agents, meeting, dt, motions)

  // ponytail: characters draw over the cached room rather than interleaving with it;
  // split-sort against the walls if a sprite ever needs to stand behind a partition.
  const placed = agents
    .map((a) => ({ a, m: motions.get(a.name) }))
    .filter((p): p is { a: Agent; m: Motion } => !!p.m)
    .sort((p, q) => (p.m.x + p.m.z) - (q.m.x + q.m.z))
  for (const { a, m } of placed) {
    const spot = agentSpot(a, agents.indexOf(a), meeting)
    // Seated pose only once the agent has actually arrived at a seated target;
    // otherwise the walk to the desk would be a slide.
    const seated = spot.seated && !m.path.length
    const talking = meeting?.state === 'running' && meeting.currentSpeaker === a.name
    person(ctx, a, m.x, m.z, t, seated, selected === a.name, talking, m.dir, m.moving)
    const [cx, cy] = at(m.x, m.z)
    const label = a.displayName.slice(0, 11)
    const width = Math.max(34, ctx.measureText(label).width + 10)
    ctx.fillStyle = '#1d2a32'
    ctx.fillRect(cx - width / 2, cy + 2, width, 11)
    ctx.fillStyle = STATUS_DOT[a.status] || '#9fb0b8'
    ctx.fillRect(cx - width / 2 + 3, cy + 5, 3, 3)
    ctx.fillStyle = '#f0e6c8'
    ctx.fillText(label, cx, cy + 4)
  }
}

export default function SpriteOffice({ onSelect }: { onSelect: (name: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const agents = useOffice((s) => s.agents)
  const tasks = useOffice((s) => s.tasks)
  const meeting = useOffice((s) => s.meeting)
  const selected = useOffice((s) => s.selectedAgent)
  const openTask = useOffice((s) => s.openTask)
  const data = useRef({ agents, tasks, meeting, selected, onSelect, openTask })
  data.current = { agents, tasks, meeting, selected, onSelect, openTask }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    canvas.width = W
    canvas.height = H
    ctx.imageSmoothingEnabled = false
    const room = buildStatic()
    const cards: CardRect[] = []
    const motions = new Map<string, Motion>()
    let raf = 0
    let last = 0

    const frame = (now: number) => {
      if (document.hidden) {
        raf = 0
        return
      }
      raf = requestAnimationFrame(frame)
      const step = now - last
      if (step < 1000 / 12) return
      last = now
      // Clamped so a background tab that resumes does not teleport everyone.
      drawFrame(ctx, room, data.current.agents, data.current.tasks, data.current.meeting, data.current.selected, now / 1000, cards, motions, Math.min(step / 1000, 0.25))
    }
    raf = requestAnimationFrame(frame)

    // Stop the loop outright while the tab is hidden: the 3D scene already parks,
    // and a 12 fps repaint is still work a small laptop should not do off-screen.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (!raf) {
        raf = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = (event.clientX - rect.left) * W / rect.width
      const y = (event.clientY - rect.top) * H / rect.height
      for (const card of cards) {
        if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
          data.current.openTask(card.id)
          return
        }
      }
      const hit = data.current.agents.find((a) => {
        const m = motions.get(a.name)
        if (!m) return false
        return Math.abs(sx(m.x, m.z) - x) < 13 && y > sy(m.x, m.z) - 36 && y < sy(m.x, m.z) + 8
      })
      if (hit) data.current.onSelect(hit.name)
    }
    canvas.addEventListener('click', onClick)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('click', onClick)
    }
  }, [])

  return (
    <div className="absolute inset-0 overflow-auto pt-14 vp-sprite-office" aria-label="Kantor pixel 2D">
      <div className="vp-sprite-hud" aria-hidden="true">
        <span>HERMES OFFICE</span><span>{agents.length} agent</span><span>{tasks.length} tugas</span><span>klik sprite untuk pilih</span>
      </div>
      <canvas
        ref={canvasRef}
        className="block pixel-office"
        role="img"
        aria-label="Peta kantor isometrik: ruang rapat, area kerja, lounge, dan lobi sama seperti mode 3D. Klik karakter untuk memilih agent."
      />
      <div className="sr-only" aria-label="Pilih agent">
        {agents.map((agent) => (
          <button key={agent.name} onClick={() => onSelect(agent.name)}>{agent.displayName}, {agent.status}</button>
        ))}
      </div>
    </div>
  )
}
