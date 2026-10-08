'use client'

import { useEffect, useRef } from 'react'
import type { Agent, Meeting, Task } from '@/types/hermes'
import { useOffice } from '@/lib/store'
import { columnOf } from '@/lib/office/board'
import { NIGHT_PALETTE, paletteFor } from '@/lib/office/layout'
import {
  BARS, BBQ, DESKS, DOOR, FOOTPRINTS, GARDEN_BEDS, GYM, HALF_D, HALF_W,
  IDLE_SPOTS, KANBAN_BOARD, LEVEL_H, LOUNGE, MEETING_ROOMS, MEETING_ROOM_IDS,
  MEETING_TABLES, PANTRY, PANTRY_STOOLS, PANTRY_STOOL_GAP, PLANTING, POOL, POOL_BENCHES,
  POOL_LOUNGERS, RECEPTION, ROLE_COLORS, STAIRS, WALL_T,
  deskSeatWorld, meetingRoomFor, roomCentre, visitorSpot,
} from '@/lib/office/layout'
import { route, stairCentre } from '@/lib/office/nav'

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
const T = 8.6
const U = 8
const OX = 400
const OY = 300
const W = 820
const H = 560
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

/**
 * Night is a wash over the finished frame, not a second set of colours.
 *
 * The 3D view swaps materials because it has them; the sprite room is a cached
 * bitmap of hand-picked retro colours, and re-picking all of them for a dusk that
 * lasts half the day is a lot of palette for one boolean. One translucent fill
 * gets the same read — and the boundary is `paletteFor`, so both views agree on
 * when night starts.
 */
const NIGHT_WASH = 'rgba(26,38,66,0.34)'

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

/**
 * Static map: the SAME U-shaped, split-level office the 3D view builds.
 *
 * Ground floor is drawn at y=0; the exec floor is drawn at y=LEVEL_H, so the two
 * storeys read as two stacked plates in the isometric projection. Rooms, walls,
 * desks, the pool and the green board all come from `layout.ts`.
 */
function buildStatic(): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#141d24'
  ctx.fillRect(0, 0, W, H)

  // Painter's order: sort by depth (x + z); the exec floor is drawn after the
  // ground floor so it sits above it.
  const items: { d: number; f: () => void }[] = []
  const push = (x: number, z: number, f: () => void) => items.push({ d: x + z, f })

  /* ------------------------------------------------ ground floor slabs --- */
  for (const bar of [BARS.west, BARS.north, BARS.east, BARS.lobby]) {
    push((bar.x1 + bar.x2) / 2, (bar.z1 + bar.z2) / 2, () => {
      flat(ctx, (bar.x1 + bar.x2) / 2, (bar.z1 + bar.z2) / 2, bar.x2 - bar.x1, bar.z2 - bar.z1, C.floorB)
    })
  }
  // courtyard paving, split around the pool so the water shows
  {
    const c = BARS.courtyard
    const px1 = POOL.x - POOL.w / 2
    const px2 = POOL.x + POOL.w / 2
    const pz1 = POOL.z - POOL.d / 2
    const pz2 = POOL.z + POOL.d / 2
    push(0, c.z1, () => flat(ctx, 0, (c.z1 + pz1) / 2, c.x2 - c.x1, pz1 - c.z1, '#cfc7b4'))
    push(0, c.z2, () => flat(ctx, 0, (pz2 + c.z2) / 2, c.x2 - c.x1, c.z2 - pz2, '#cfc7b4'))
    push(c.x1, POOL.z, () => flat(ctx, (c.x1 + px1) / 2, POOL.z, px1 - c.x1, POOL.d, '#cfc7b4'))
    push(c.x2, POOL.z, () => flat(ctx, (px2 + c.x2) / 2, POOL.z, c.x2 - px2, POOL.d, '#cfc7b4'))
  }
  // the pool itself: blue water with a stone rim
  push(POOL.x, POOL.z, () => {
    flat(ctx, POOL.x, POOL.z, POOL.w + 0.7, POOL.d + 0.7, '#b9b2a2')
    flat(ctx, POOL.x, POOL.z, POOL.w, POOL.d, '#2f8fb5')
    flat(ctx, POOL.x, POOL.z, POOL.w - 0.8, POOL.d - 0.8, '#3aa3c9')
  })
  // grass patches
  for (const [gx, gz, gw, gd] of [
    [-9.5, 8.5, 6, 4],
    [9.5, 8.5, 6, 4],
    [-9.5, 0.5, 4, 4],
    [9.5, 0.5, 4, 4],
  ] as const) {
    push(gx, gz, () => flat(ctx, gx, gz, gw, gd, C.rug))
  }

  /* ---------------------------------------------------------- the walls --- */
  // Ground-floor shell, drawn as short walls (the 3D view dollhouse-cuts them).
  const wallH = 1.6
  const wall = (x1: number, z1: number, x2: number, z2: number, level: 0 | 1 = 0) => {
    const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1)
    const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1)
    const cx = (x1 + x2) / 2
    const cz = (z1 + z2) / 2
    const y = level * LEVEL_H
    push(cx, cz, () => {
      const [ax, ay] = at(cx, cz, y + wallH)
      const [bx] = at(cx, cz, y)
      if (horizontal) {
        solid(ctx, cx, cz, len, WALL_T, wallH, C.wallTop, C.wallSide, 's')
      } else {
        solid(ctx, cx, cz, WALL_T, len, wallH, C.wallTop, C.wallSide, 'e')
      }
      void ax
      void ay
      void bx
    })
  }
  wall(-HALF_W, -HALF_D, HALF_W, -HALF_D)
  wall(-HALF_W, -HALF_D, -HALF_W, HALF_D)
  wall(HALF_W, -HALF_D, HALF_W, HALF_D)
  wall(-HALF_W, HALF_D, -14, HALF_D)
  wall(14, HALF_D, HALF_W, HALF_D)
  wall(-14, HALF_D, DOOR.x - 2.2, HALF_D)
  wall(DOOR.x + 2.2, HALF_D, 14, HALF_D)
  wall(-14, -9, -14, HALF_D)
  wall(14, -9, 14, HALF_D)
  wall(-14, 16, -4, 16)
  wall(4, 16, 14, 16)
  wall(-HALF_W, -6.9, -14, -6.9)
  wall(-HALF_W, 6.9, -14, 6.9)
  wall(14, 2, HALF_W, 2)
  // exec floor
  wall(-HALF_W, -HALF_D, HALF_W, -HALF_D, 1)
  wall(-HALF_W, -HALF_D, -HALF_W, -9, 1)
  wall(HALF_W, -HALF_D, HALF_W, -9, 1)
  for (const f of FOOTPRINTS.filter((x) => x.level === 1 && x.kind === 'wall' && !x.id.startsWith('stair-'))) {
    push(f.x, f.z, () => {
      solid(
        ctx, f.x, f.z, f.hw * 2, f.hd * 2, 1.5,
        C.partTop, C.partSide,
        Math.abs(f.hw) > Math.abs(f.hd) ? 's' : 'e',
      )
    })
  }

  /* ------------------------------------------------------------ stairs --- */
  push(stairCentre.x, stairCentre.z, () => {
    solid(ctx, stairCentre.x, stairCentre.z, STAIRS.x2 - STAIRS.x1, STAIRS.z2 - STAIRS.z1, LEVEL_H, '#c3bba6', '#8f8878')
  })

  /* ------------------------------------------------------- the furniture -- */
  // desks (ground floor). Meja exec (lantai 1) adalah meja CEO, digambar di "CEO suite desk".
  for (const desk of DESKS.filter((d) => d.level === 0)) {
    push(desk.x, desk.z, () => {
      solid(ctx, desk.x, desk.z, 1.8, 1.0, 0.72, C.woodTop, C.wood)
      const mx = desk.x - Math.sin(desk.facing) * 0.28
      const mz = desk.z - Math.cos(desk.facing) * 0.28
      solid(ctx, mx, mz, 0.7, 0.16, 0.5, C.screen, '#3a4750')
    })
    const seat = deskSeatWorld(desk)
    push(seat.x, seat.z, () => solid(ctx, seat.x, seat.z, 0.6, 0.6, 0.5, C.metal, '#3f4a52'))
  }
  // meeting tables + chairs (exec floor)
  for (const id of MEETING_ROOM_IDS) {
    const t = MEETING_TABLES[id]
    push(t.x, t.z, () => {
      const [cx, cy] = at(t.x, t.z, LEVEL_H)
      ctx.fillStyle = C.woodTop
      ctx.beginPath()
      ctx.ellipse(cx, cy, t.rx * T * 1.4, t.rz * T * 0.7, 0, 0, Math.PI * 2)
      ctx.fill()
    })
    for (const s of MEETING_ROOMS[id].seats) {
      push(s.x, s.z, () => {
        const [cx, cy] = at(s.x, s.z, LEVEL_H)
        ctx.fillStyle = C.metal
        ctx.fillRect(cx - 4, cy - 4, 8, 8)
      })
    }
  }
  // the green whiteboard in Rinjani
  push(KANBAN_BOARD.x, KANBAN_BOARD.z, () => {
    const [cx, cy] = at(KANBAN_BOARD.x, KANBAN_BOARD.z, KANBAN_BOARD.y)
    const rx = KANBAN_BOARD.w * T * Math.SQRT2 / 2
    const ry = KANBAN_BOARD.h * U / 2
    ctx.fillStyle = C.board
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2)
    for (let i = 0; i < 4; i++) {
      const hx = cx - rx + rx * 2 * (i + 0.5) / 4
      ctx.fillStyle = '#8fd0ae'
      ctx.fillRect(hx - 5, cy - ry + 3, 10, 3)
    }
  })
  // CEO suite desk
  {
    const c = roomCentre('ceo')
    push(c.x, c.z, () => solid(ctx, c.x, c.z - 1.5, 2.2, 1.2, 0.74, C.woodTop, C.wood))
  }
  // ---- courtyard zones: gym mat + weights, planting band, daybeds, benches,
  // BBQ, decorative beds. Read from the same constants the 3D view uses.
  {
    // the gym mat, as a flat quad you can see the equipment standing on
    const gw = GYM.x2 - GYM.x1
    const gd = GYM.z2 - GYM.z1
    push((GYM.x1 + GYM.x2) / 2, (GYM.z1 + GYM.z2) / 2, () =>
      flat(ctx, (GYM.x1 + GYM.x2) / 2, (GYM.z1 + GYM.z2) / 2, gw, gd, '#3d6b4b'),
    )
    // barbell rack: two uprights + a bar with plates
    push(GYM.rack.x, GYM.rack.z, () => {
      for (const ux of [-0.55, 0.55]) solid(ctx, GYM.rack.x + ux, GYM.rack.z, 0.16, 0.16, 1.35, '#2f3438', '#22262a')
      const [bx, by] = at(GYM.rack.x, GYM.rack.z, 1.32)
      ctx.fillStyle = '#b9c0c6'
      ctx.fillRect(bx - 26, by - 3, 52, 6)
      for (const off of [-20, -15, -10, 10, 15, 20]) {
        const [px2] = at(GYM.rack.x + off / 26, GYM.rack.z, 1.32)
        ctx.fillStyle = '#24282c'
        ctx.beginPath()
        ctx.arc(px2, by, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    })
    // dumbbell rack
    push(GYM.dumbbells.x, GYM.dumbbells.z, () => {
      for (const ty of [0.45, 0.75]) solid(ctx, GYM.dumbbells.x, GYM.dumbbells.z, 1.9, 0.3, ty, '#2f3438', '#22262a')
      for (let i = 0; i < 6; i++) {
        const dx = -0.72 + i * 0.29
        const dz = i < 3 ? 0.16 : -0.16
        const [cx2, cy2] = at(GYM.dumbbells.x + dx, GYM.dumbbells.z + dz, i < 3 ? 0.56 : 0.86)
        ctx.fillStyle = '#24282c'
        ctx.beginPath()
        ctx.arc(cx2, cy2, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    })
    // pull-up rig: two posts + the bar
    push(GYM.rig.x, GYM.rig.z, () => {
      for (const px2 of [-GYM.rig.span / 2, GYM.rig.span / 2]) {
        solid(ctx, GYM.rig.x + px2, GYM.rig.z, 0.16, 0.16, 2.45, '#2f3438', '#22262a')
      }
      const [rx1, ry1] = at(GYM.rig.x - GYM.rig.span / 2, GYM.rig.z, 2.39)
      const [rx2] = at(GYM.rig.x + GYM.rig.span / 2, GYM.rig.z, 2.39)
      ctx.strokeStyle = '#b9c0c6'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(rx1, ry1)
      ctx.lineTo(rx2, ry1)
      ctx.stroke()
    })
    // planting band between gym and pool
    push((PLANTING.x1 + PLANTING.x2) / 2, (PLANTING.z1 + PLANTING.z2) / 2, () =>
      flat(
        ctx,
        (PLANTING.x1 + PLANTING.x2) / 2,
        (PLANTING.z1 + PLANTING.z2) / 2,
        PLANTING.x2 - PLANTING.x1,
        PLANTING.z2 - PLANTING.z1,
        '#5b7f4a',
      ),
    )
  }
  for (const b of POOL_BENCHES) {
    push(b.x, b.z, () => solid(ctx, b.x, b.z, 1.7, 0.5, 0.46, C.woodTop, C.wood))
  }
  for (const l of POOL_LOUNGERS) {
    push(l.x, l.z, () => solid(ctx, l.x, l.z, 1.0, 2.1, 0.42, C.woodTop, C.wood))
  }
  push(BBQ.x, BBQ.z, () => solid(ctx, BBQ.x, BBQ.z, 2.0, 1.15, 0.95, '#4a5054', '#2f3336'))
  for (const bed of GARDEN_BEDS) {
    push(bed.x, bed.z, () => solid(ctx, bed.x, bed.z, bed.w, bed.d, 0.5, '#8a6a45', '#6a4f34'))
  }
  // reception counter + chair
  push(RECEPTION.x, RECEPTION.z, () => solid(ctx, RECEPTION.x, RECEPTION.z, 3.6, 0.9, 1.05, C.woodTop, C.wood))
  push(RECEPTION.x, RECEPTION.z - 1.15, () => solid(ctx, RECEPTION.x, RECEPTION.z - 1.15, 0.6, 0.6, 0.5, C.metal, '#3f4a52'))
  // pantry counter + stools
  push(PANTRY.x, PANTRY.z, () => solid(ctx, PANTRY.x, PANTRY.z, 1.0, 6.4, 0.94, C.woodTop, C.wood))
  for (const sz of PANTRY_STOOLS) {
    push(PANTRY.x + PANTRY_STOOL_GAP, sz, () =>
      solid(ctx, PANTRY.x + PANTRY_STOOL_GAP, sz, 0.44, 0.44, 0.64, C.woodTop, C.wood),
    )
  }
  // leisure sofa
  push(LOUNGE.x, LOUNGE.z, () => solid(ctx, LOUNGE.x, LOUNGE.z, 2.8, 1.0, 0.6, C.sofa, '#3f6486'))

  items.sort((a, b) => a.d - b.d)
  for (const item of items) item.f()
  return cv
}

/** Same destination rules as the 3D simulation, so agents stand in the same places. */
function agentSpot(a: Agent, i: number, meeting: Meeting | null) {
  if (meeting && (meeting.state === 'queued' || meeting.state === 'running') && meeting.participants.includes(a.name)) {
    // Same routing as the 3D view: one division → its own room, exec-heavy →
    // Merapi, everyone → Rinjani.
    const roomId = meetingRoomFor(
      meeting.participants,
      new Map(meeting.participants.map((p) => [p, a.division ?? 'tech'])),
    )
    const room = MEETING_ROOMS[roomId]
    const seat = room.seats[meeting.participants.indexOf(a.name) % room.seats.length]
    return { x: seat.x, z: seat.z, seated: true }
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

/**
 * Greedy word wrap for the balloon, capped at `maxLines`.
 *
 * Pure and exported so the self-test can pin the edge cases: canvas has no text
 * layout, so the only thing standing between a meeting turn and a balloon that
 * covers the whole room is this function.
 */
export function wrapBubble(text: string, max = 26, maxLines = 3): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  let truncated = false
  for (const word of words) {
    // A single unbreakable token (a URL, a path) would otherwise make the balloon
    // as wide as the word: hard-slice it before wrapping.
    if (word.length > max) {
      if (line) { lines.push(line); line = '' }
      for (let i = 0; i < word.length && lines.length < maxLines; i += max) lines.push(word.slice(i, i + max))
      truncated = lines.length === maxLines
      continue
    }
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) {
      lines.push(line)
      line = word
      if (lines.length === maxLines) {
        truncated = true
        break
      }
    } else {
      line = next
    }
  }
  if (truncated) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, max - 1)}…`
  else if (line) lines.push(line)
  return lines
}

/**
 * Retro speech balloon carrying the speaker's actual line.
 *
 * The 3D view shows the text; a 2D office where the speaker only blinks reads as
 * decoration. Capped at three lines — a full meeting turn is a paragraph and
 * would cover the room.
 */
function speechBubble(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, t: number) {
  const lines = wrapBubble(text)
  if (!lines.length) return

  ctx.save()
  ctx.font = '8px ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const wpx = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 9
  const hpx = lines.length * 10 + 7
  // A gentle float so a long speech does not look frozen; clamped so it never
  // drifts off the top of the canvas.
  const bx = cx + 10
  const by = Math.max(4, cy - 40 - hpx + Math.round(Math.sin(t * 2) * 1.5))
  ctx.fillStyle = '#fff8e2'
  ctx.fillRect(bx, by, wpx, hpx)
  ctx.fillRect(bx + 3, by + hpx, 4, 4)
  ctx.fillStyle = '#8d8265'
  ctx.fillRect(bx, by, wpx, 1)
  ctx.fillRect(bx, by + hpx - 1, wpx, 1)
  ctx.fillRect(bx, by, 1, hpx)
  ctx.fillRect(bx + wpx - 1, by, 1, hpx)
  ctx.fillStyle = '#4a4436'
  lines.forEach((l, i) => ctx.fillText(l, bx + 5, by + 4 + i * 10))
  ctx.restore()
}

type CardRect = { x: number; y: number; w: number; h: number; id: string }

/** Frame pass: blit the cached room, then the two things that actually change. */
function drawFrame(
  ctx: CanvasRenderingContext2D, room: HTMLCanvasElement,
  agents: Agent[], tasks: Task[], meeting: Meeting | null, selected: string | null,
  t: number, cards: CardRect[], motions: Map<string, Motion>, dt: number, night: boolean,
) {
  ctx.drawImage(room, 0, 0)
  if (night) {
    ctx.fillStyle = NIGHT_WASH
    ctx.fillRect(0, 0, W, H)
  }
  cards.length = 0

  // Cards live on the free-standing board (KANBAN_BOARD), not on a wall.
  const face = KANBAN_BOARD.z + 0.1
  const bw = KANBAN_BOARD.w
  const topY = KANBAN_BOARD.y + KANBAN_BOARD.h / 2 - 0.55
  const columns: Task[][] = [[], [], [], []]
  for (const task of tasks) columns[columnOf(task.status)].push(task)
  ctx.font = 'bold 8px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const MAX_CARDS = 3
  const cardW = 1.15
  for (let i = 0; i < 4; i++) {
    const cx = KANBAN_BOARD.x - bw / 2 + bw * (i + 0.5) / 4
    const shown = columns[i].slice(0, MAX_CARDS)
    const quadAt = (y: number) => [
      at(cx - cardW / 2, face, y), at(cx + cardW / 2, face, y),
      at(cx + cardW / 2, face, y + 0.44), at(cx - cardW / 2, face, y + 0.44),
    ]
    shown.forEach((task, k) => {
      const quad = quadAt(topY - k * 0.66)
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
      const quad = quadAt(topY - shown.length * 0.66)
      poly(ctx, quad, C.board)
      ctx.fillStyle = '#eaf6e6'
      ctx.fillText(`+${extra}`, (quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2 - 4)
    }
  }

  stepMotions(agents, meeting, dt, motions)

  // The current speaker's latest line, looked up once for the whole frame.
  const spoken = meeting?.state === 'running' && meeting.currentSpeaker
    ? [...meeting.turns].reverse().find((turn) => turn.speaker === meeting.currentSpeaker)?.text ?? ''
    : ''

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
    if (talking && spoken) speechBubble(ctx, cx, cy, spoken, t)
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

    // Same clock and same timezone as the 3D scene, so switching views at 18:05
    // does not change the time of day. Re-checked once a minute, not per frame.
    const hourNow = () =>
      Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date()))
    let hour = hourNow()
    let lastHourCheck = performance.now()

    const frame = (now: number) => {
      if (document.hidden) {
        raf = 0
        return
      }
      raf = requestAnimationFrame(frame)
      const step = now - last
      if (step < 1000 / 12) return
      last = now
      if (now - lastHourCheck > 60_000) {
        lastHourCheck = now
        hour = hourNow()
      }
      // Clamped so a background tab that resumes does not teleport everyone.
      drawFrame(ctx, room, data.current.agents, data.current.tasks, data.current.meeting, data.current.selected, now / 1000, cards, motions, Math.min(step / 1000, 0.25), paletteFor(hour) === NIGHT_PALETTE)
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
