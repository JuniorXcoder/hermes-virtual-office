/**
 * Furniture builders. Everything is procedural low-poly: no external assets, so
 * the repo stays small and the scene loads instantly on low-end GPUs.
 */
import * as THREE from 'three'
import {
  CONFERENCE,
  DART,
  DESKS,
  FLOOR,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  LOUNGE,
  ROOMS,
  WALL_H,
  paletteFor,
  type Desk,
  type Palette,
} from './layout'

const box = (
  w: number,
  h: number,
  d: number,
  color: number,
  opts: { metal?: number; rough?: number; emissive?: number } = {},
) =>
  new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      metalness: opts.metal ?? 0,
      roughness: opts.rough ?? 0.75,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissive ? 0.9 : 0,
    }),
  )

const cyl = (rt: number, rb: number, h: number, color: number, seg = 14) =>
  new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, h, seg),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  )

export type OfficeProps = {
  group: THREE.Group
  desks: Desk[]
  monitors: THREE.Mesh[]
  lamps: THREE.PointLight[]
  boardSurface: THREE.Mesh
  applyPalette: (hour: number) => void
}

export function buildOffice(scene: THREE.Scene, hour: number): OfficeProps {
  const group = new THREE.Group()
  scene.add(group)

  let pal: Palette = paletteFor(hour)

  // ---- floor + rug + walls
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR.width, FLOOR.depth),
    new THREE.MeshStandardMaterial({ color: pal.floor, roughness: 0.9 }),
  )
  floor.rotation.x = -Math.PI / 2
  group.add(floor)

  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 4.4),
    new THREE.MeshStandardMaterial({ color: pal.rug, roughness: 0.95 }),
  )
  rug.rotation.x = -Math.PI / 2
  rug.position.set(CONFERENCE.x, 0.01, CONFERENCE.z)
  group.add(rug)

  const wallMat = new THREE.MeshStandardMaterial({ color: pal.wall, roughness: 0.9 })
  const mkWall = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat)
    m.position.set(x, WALL_H / 2, z)
    group.add(m)
    return m
  }
  // north wall carries the Kanban board, so it stays whole
  const walls = [
    mkWall(FLOOR.width, 0.4, 0, -HALF_D),
    mkWall(0.4, FLOOR.depth, -HALF_W, 0),
    mkWall(0.4, FLOOR.depth, HALF_W, 0),
  ]
  // south wall with a gap for the door
  mkWall(12, 0.4, -10, HALF_D)
  mkWall(12, 0.4, 10, HALF_D)
  mkWall(8, 0.4, 0, HALF_D - 0.001).visible = false // keep the doorway open

  // ---- Kanban display
  const boardSurface = box(KANBAN_BOARD.w, KANBAN_BOARD.h, 0.2, 0x101820, {
    emissive: 0x0a3d2a,
    rough: 0.4,
  })
  boardSurface.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z)
  boardSurface.name = 'kanban-board'
  group.add(boardSurface)
  // Five dividers split the board into the SIX columns the labels name —
  // three dividers (four cells) under six labels reads as a broken grid.
  const BOARD_COLUMNS = 4
  for (let i = 1; i < BOARD_COLUMNS; i++) {
    const div = box(0.05, KANBAN_BOARD.h - 0.7, 0.22, 0x1d5c42)
    div.position.set(
      KANBAN_BOARD.x - KANBAN_BOARD.w / 2 + (KANBAN_BOARD.w / BOARD_COLUMNS) * i,
      KANBAN_BOARD.y,
      KANBAN_BOARD.z + 0.12,
    )
    group.add(div)
  }

  // ---- rooms: glass partitions carve the floor into actual rooms ---------
  // Plain transparent glass renders as almost nothing without an environment
  // map — the frames showed but the panes did not. A slight emissive tint plus
  // higher opacity makes the partition actually read as a glass wall.
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe0ef,
    transparent: true,
    opacity: 0.55,
    roughness: 0.05,
    metalness: 0.0,
    emissive: 0x9fc9de,
    emissiveIntensity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  /** One partition panel: a glass sheet with a slim frame. */
  const panel = (w: number, h: number, frameColor = 0x8f9ea8) => {
    const g = new THREE.Group()
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), glassMat)
    glass.position.y = h / 2
    g.add(glass)
    const rail = box(w + 0.06, 0.12, 0.14, frameColor, { metal: 0.55 })
    rail.position.y = h
    g.add(rail)
    const sill = box(w + 0.06, 0.12, 0.14, frameColor, { metal: 0.55 })
    sill.position.y = 0.06
    g.add(sill)
    // Vertical mullions every ~1.8m: the frames are what actually read as a
    // partition. Bare tinted glass alone was invisible in the render.
    const bays = Math.max(1, Math.round(w / 1.8))
    for (let i = 0; i <= bays; i++) {
      const post = box(0.09, h, 0.13, frameColor, { metal: 0.55 })
      post.position.set(-w / 2 + (w / bays) * i, h / 2, 0)
      g.add(post)
    }
    return g
  }

  /** Wall run along X or Z with a door gap, made of framed glass panels. */
  const glassRun = (
    from: [number, number],
    to: [number, number],
    gap?: { at: number; width: number },
  ) => {
    const horizontal = Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1])
    const total = horizontal ? Math.abs(to[0] - from[0]) : Math.abs(to[1] - from[1])
    const start = horizontal ? Math.min(from[0], to[0]) : Math.min(from[1], to[1])
    const fixed = horizontal ? from[1] : from[0]
    const h = 3.1

    // split the run into segments around the doorway
    const cuts: [number, number][] = []
    if (gap) {
      const g0 = gap.at - gap.width / 2
      const g1 = gap.at + gap.width / 2
      if (g0 > start) cuts.push([start, g0])
      if (g1 < start + total) cuts.push([g1, start + total])
    } else {
      cuts.push([start, start + total])
    }

    for (const [a, b] of cuts) {
      const len = b - a
      if (len < 0.2) continue
      const seg = panel(len, h)
      const mid = (a + b) / 2
      if (horizontal) {
        seg.position.set(mid, 0, fixed)
      } else {
        seg.position.set(fixed, 0, mid)
        seg.rotation.y = Math.PI / 2
      }
      group.add(seg)
    }
  }

  const M = ROOMS.meeting
  const L = ROOMS.lounge
  const DOOR_W = 2.2

  // Meeting room: glass on the east face (doorway to the work area) and a
  // partial south face that stops short of the corridor, so the room is
  // enclosed but you can see into it from the hallway.
  glassRun([M.x2, M.z1], [M.x2, M.z2], { at: M.z2 - 3.2, width: DOOR_W })
  glassRun([M.x2, M.z2], [M.x2 - 3.0, M.z2])

  // Lounge: mirrored.
  glassRun([L.x1, L.z1], [L.x1, L.z2], { at: L.z2 - 3.2, width: DOOR_W })
  glassRun([L.x1 + 3.0, L.z2], [L.x1, L.z2])

  // ---- per-zone flooring so the rooms read as separate spaces
  const zoneFloor = (x1: number, z1: number, x2: number, z2: number, color: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.abs(x2 - x1), Math.abs(z2 - z1)),
      new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
    )
    m.rotation.x = -Math.PI / 2
    m.position.set((x1 + x2) / 2, 0.008, (z1 + z2) / 2)
    group.add(m)
  }
  zoneFloor(M.x1, M.z1, M.x2, M.z2, 0xdccdb0) // meeting: warm timber
  zoneFloor(L.x1, L.z1, L.x2, L.z2, 0xd8d4c6) // lounge: cool neutral
  zoneFloor(-HALF_W + 0.4, ROOMS.corridor.z1, HALF_W - 0.4, ROOMS.corridor.z2, 0xc4ccd2) // corridor: tile

  // ---- cubicle dividers between the four desk columns
  for (const x of [-3.0, 0, 3.0]) {
    const divider = box(0.07, 1.35, 7.4, 0xcfd8dd, { rough: 0.6 })
    divider.position.set(x, 0.68, -1.2)
    group.add(divider)
    const cap = box(0.11, 0.06, 7.4, 0xaab7bf, { metal: 0.2 })
    cap.position.set(x, 1.37, -1.2)
    group.add(cap)
  }

  // ---- desks (8, in 4 facing pairs)
  const monitors: THREE.Mesh[] = []
  const lamps: THREE.PointLight[] = []
  for (const desk of DESKS) {
    const d = new THREE.Group()
    d.position.set(desk.x, 0, desk.z)
    d.rotation.y = desk.facing

    const top = box(2.0, 0.09, 1.0, pal.deskTop, { rough: 0.5 })
    top.position.y = 0.74
    d.add(top)
    for (const [lx, lz] of [
      [-0.88, -0.4],
      [0.88, -0.4],
      [-0.88, 0.4],
      [0.88, 0.4],
    ]) {
      const leg = box(0.09, 0.72, 0.09, pal.deskLeg, { metal: 0.4 })
      leg.position.set(lx, 0.36, lz)
      d.add(leg)
    }

    // monitor (the clickable screen-peeker target)
    const stand = cyl(0.05, 0.09, 0.28, pal.deskLeg)
    stand.position.set(0, 0.9, -0.26)
    d.add(stand)
    const bezel = box(0.98, 0.58, 0.05, 0x22262a, { metal: 0.3 })
    bezel.position.set(0, 1.3, -0.26)
    d.add(bezel)
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.5),
      // DoubleSide: a single-sided plane is invisible to the raycaster from behind,
      // which silently kills the "peek at screen" click target.
      new THREE.MeshStandardMaterial({
        color: pal.screen,
        emissive: 0x0d3b28,
        emissiveIntensity: 1.1,
        side: THREE.DoubleSide,
      }),
    )
    screen.position.set(0, 1.3, -0.225)
    screen.userData = { kind: 'monitor', deskIndex: desk.index }
    screen.name = `monitor-${desk.index}`
    d.add(screen)
    monitors.push(screen)

    // keyboard + mug
    const kb = box(0.6, 0.03, 0.2, 0x2f3437)
    kb.position.set(0, 0.79, 0.12)
    d.add(kb)
    const mug = cyl(0.055, 0.05, 0.1, 0xe8e2d6, 10)
    mug.position.set(-0.7, 0.83, 0.1)
    d.add(mug)

    // desk lamp: on at night, off during the day
    const lamp = new THREE.PointLight(0xffc98a, hour >= 18 || hour < 6 ? 0.85 : 0, 4.5)
    lamp.position.set(desk.x + 0.6 * Math.cos(desk.facing), 1.5, desk.z - 0.5)
    group.add(lamp)
    lamps.push(lamp)

    // chair behind the desk
    const chair = new THREE.Group()
    chair.position.set(-Math.sin(desk.facing) * 0.0, 0, 0.95)
    const seat = box(0.62, 0.09, 0.6, pal.chair, { rough: 0.6 })
    seat.position.y = 0.46
    chair.add(seat)
    const back = box(0.62, 0.62, 0.08, pal.chair, { rough: 0.6 })
    back.position.set(0, 0.78, 0.27)
    chair.add(back)
    const post = cyl(0.05, 0.07, 0.42, pal.deskLeg, 10)
    post.position.y = 0.24
    chair.add(post)
    d.add(chair)

    group.add(d)
  }

  // ---- conference table + chairs
  const table = cyl(CONFERENCE.radius, CONFERENCE.radius, 0.1, pal.wood, 24)
  table.position.set(CONFERENCE.x, 0.75, CONFERENCE.z)
  group.add(table)
  const tleg = cyl(0.14, 0.2, 0.72, pal.wood, 12)
  tleg.position.set(CONFERENCE.x, 0.36, CONFERENCE.z)
  group.add(tleg)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const cx = CONFERENCE.x + Math.cos(a) * (CONFERENCE.radius + 0.85)
    const cz = CONFERENCE.z + Math.sin(a) * (CONFERENCE.radius + 0.85)
    const c = new THREE.Group()
    c.position.set(cx, 0, cz)
    c.rotation.y = Math.atan2(CONFERENCE.x - cx, CONFERENCE.z - cz)
    const seat = box(0.58, 0.08, 0.56, pal.chair)
    seat.position.y = 0.46
    c.add(seat)
    const back = box(0.58, 0.56, 0.07, pal.chair)
    back.position.set(0, 0.75, 0.26)
    c.add(back)
    const legs = cyl(0.04, 0.06, 0.44, pal.deskLeg, 8)
    legs.position.y = 0.23
    c.add(legs)
    group.add(c)
  }
  // hologram above the table
  const holo = box(1.9, 0.05, 1.2, 0x4fd1c5, { emissive: 0x2fd6c0, rough: 0.2 })
  holo.position.set(CONFERENCE.x, 1.85, CONFERENCE.z)
  group.add(holo)

  // ---- lounge: sofa + TV + coffee table
  const sofa = new THREE.Group()
  sofa.position.set(LOUNGE.x, 0, LOUNGE.z)
  const sofaSeat = box(3.2, 0.34, 1.1, pal.sofa, { rough: 0.85 })
  sofaSeat.position.y = 0.42
  sofa.add(sofaSeat)
  const sofaBack = box(3.2, 0.7, 0.28, pal.sofa, { rough: 0.85 })
  sofaBack.position.set(0, 0.85, 0.42)
  sofa.add(sofaBack)
  for (const sx of [-1.5, 1.5]) {
    const arm = box(0.26, 0.5, 1.1, pal.sofa, { rough: 0.85 })
    arm.position.set(sx, 0.62, 0)
    sofa.add(arm)
  }
  group.add(sofa)

  const tv = box(2.2, 1.25, 0.1, 0x14181c, { emissive: 0x123a52, rough: 0.35 })
  tv.position.set(LOUNGE.x, 1.9, LOUNGE.z - 3.4)
  group.add(tv)
  const tvStand = box(2.4, 0.08, 0.5, pal.wood)
  tvStand.position.set(LOUNGE.x, 1.24, LOUNGE.z - 3.4)
  group.add(tvStand)

  const coffee = cyl(0.55, 0.6, 0.08, pal.wood, 16)
  coffee.position.set(LOUNGE.x, 0.4, LOUNGE.z - 1.6)
  group.add(coffee)
  const coffeeLeg = cyl(0.08, 0.12, 0.38, pal.wood, 10)
  coffeeLeg.position.set(LOUNGE.x, 0.2, LOUNGE.z - 1.6)
  group.add(coffeeLeg)

  // ---- meeting room dressing (whiteboard, credenza, plant, window band)
  const whiteboard = box(3.4, 1.7, 0.08, 0xfbfdff, { rough: 0.35 })
  whiteboard.position.set(ROOMS.meeting.x1 + 0.22, 1.85, CONFERENCE.z - 2.6)
  whiteboard.rotation.y = Math.PI / 2
  group.add(whiteboard)
  const wbFrame = box(3.55, 1.85, 0.05, 0xc3ccd4, { metal: 0.3 })
  wbFrame.position.set(ROOMS.meeting.x1 + 0.16, 1.85, CONFERENCE.z - 2.6)
  wbFrame.rotation.y = Math.PI / 2
  group.add(wbFrame)

  const credenza = box(2.6, 0.72, 0.5, 0xd8c3a2, { rough: 0.6 })
  credenza.position.set(ROOMS.meeting.x1 + 1.5, 0.36, ROOMS.meeting.z1 + 0.7)
  group.add(credenza)

  const plantPot = (x: number, z: number) => {
    const pot = cyl(0.24, 0.19, 0.36, 0xcfd6da, 12)
    pot.position.set(x, 0.18, z)
    group.add(pot)
    const leaves = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({ color: 0x5f9e6b, flatShading: true, roughness: 0.8 }),
    )
    leaves.position.set(x, 0.78, z)
    group.add(leaves)
    const stem = cyl(0.04, 0.05, 0.3, 0x6b7a55, 8)
    stem.position.set(x, 0.48, z)
    group.add(stem)
  }
  plantPot(ROOMS.meeting.x2 - 0.9, ROOMS.meeting.z1 + 1.0)
  plantPot(ROOMS.lounge.x1 + 0.9, ROOMS.lounge.z1 + 1.0)
  plantPot(ROOMS.lounge.x2 - 0.9, ROOMS.lounge.z2 - 1.2)

  // ---- lounge dressing (extra chair, rug, floor lamp, second table)
  const loungeChair = new THREE.Group()
  loungeChair.position.set(LOUNGE.x - 2.3, 0, LOUNGE.z + 0.6)
  loungeChair.rotation.y = -0.5
  const lcSeat = box(0.8, 0.14, 0.8, 0x8fb0d4, { rough: 0.85 })
  lcSeat.position.y = 0.42
  loungeChair.add(lcSeat)
  const lcBack = box(0.8, 0.72, 0.2, 0x8fb0d4, { rough: 0.85 })
  lcBack.position.set(0, 0.78, 0.32)
  loungeChair.add(lcBack)
  group.add(loungeChair)

  const loungeRug = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 3.4),
    new THREE.MeshStandardMaterial({ color: 0xbfae94, roughness: 0.95 }),
  )
  loungeRug.rotation.x = -Math.PI / 2
  loungeRug.position.set(LOUNGE.x, 0.012, LOUNGE.z - 1.2)
  group.add(loungeRug)

  const floorLamp = new THREE.Group()
  floorLamp.position.set(LOUNGE.x + 2.6, 0, LOUNGE.z - 2.6)
  const pole = cyl(0.045, 0.06, 1.7, 0x8a949c, 10)
  pole.position.y = 0.85
  floorLamp.add(pole)
  const shade = cyl(0.36, 0.24, 0.32, 0xf3e3c4, 14)
  shade.position.y = 1.78
  floorLamp.add(shade)
  const base = cyl(0.24, 0.28, 0.05, 0x6f7981, 14)
  base.position.y = 0.03
  floorLamp.add(base)
  group.add(floorLamp)

  // ---- filling the floor: print corner, lockers, pantry, corridor rail
  const printer = box(0.7, 0.9, 0.6, 0xdfe6ea, { rough: 0.5 })
  printer.position.set(ROOMS.work.x1 + 1.4, 0.45, ROOMS.work.z2 - 1.2)
  group.add(printer)
  const printerStand = box(0.85, 0.35, 0.7, 0xb9c3ca, { metal: 0.3 })
  printerStand.position.set(ROOMS.work.x1 + 1.4, 0.17, ROOMS.work.z2 - 1.2)
  group.add(printerStand)

  const lockers = new THREE.Group()
  lockers.position.set(ROOMS.work.x2 - 1.3, 0, ROOMS.work.z2 - 1.1)
  for (let i = 0; i < 4; i++) {
    const lk = box(0.42, 1.7, 0.44, i % 2 ? 0x9fb4c2 : 0x8ba5b6, { metal: 0.35 })
    lk.position.set(i * 0.44, 0.85, 0)
    lockers.add(lk)
  }
  group.add(lockers)
  const lockerTop = box(1.85, 0.07, 0.5, 0xd3dbe0, { metal: 0.4 })
  lockerTop.position.set(ROOMS.work.x2 - 1.3 + 0.66, 1.73, ROOMS.work.z2 - 1.1)
  group.add(lockerTop)

  const pantry = new THREE.Group()
  pantry.position.set(ROOMS.lounge.x2 - 1.6, 0, ROOMS.lounge.z2 - 1.8)
  const counter = box(2.4, 0.9, 0.62, 0xd9c6a8, { rough: 0.6 })
  counter.position.y = 0.45
  pantry.add(counter)
  const counterTop = box(2.5, 0.07, 0.7, 0xeee6d6, { rough: 0.4 })
  counterTop.position.y = 0.92
  pantry.add(counterTop)
  const espresso = box(0.4, 0.5, 0.4, 0x4c545b, { metal: 0.5 })
  espresso.position.set(-0.7, 1.2, 0)
  pantry.add(espresso)
  const kettle = cyl(0.12, 0.14, 0.26, 0xe8ecef, 12)
  kettle.position.set(0.6, 1.08, 0)
  pantry.add(kettle)
  group.add(pantry)

  // corridor rail separating the walkway from the work area
  const rail = box(HALF_W * 2 - 1.2, 0.07, 0.09, 0x9aa8b2, { metal: 0.5 })
  rail.position.set(0, 1.02, ROOMS.corridor.z1 + 0.08)
  group.add(rail)
  for (let i = -8; i <= 8; i++) {
    if (Math.abs(i) < 2) continue // leave the doorway clear
    const post = box(0.07, 1.0, 0.07, 0x9aa8b2, { metal: 0.5 })
    post.position.set(i * 1.75, 0.5, ROOMS.corridor.z1 + 0.08)
    group.add(post)
  }

  // window band on the north wall, either side of the Kanban board
  for (const x of [-11.4, 11.4]) {
    const frame = box(5.6, 2.5, 0.1, 0xa9b6bf, { metal: 0.4 })
    frame.position.set(x, 2.6, -HALF_D + 0.22)
    group.add(frame)
    const sky = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 2.2, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xbcd8ea, emissive: 0x9dc4de, emissiveIntensity: 0.55 }),
    )
    sky.position.set(x, 2.6, -HALF_D + 0.3)
    group.add(sky)
  }

  // ---- dartboard + water cooler
  const db = cyl(0.62, 0.62, 0.08, 0xe8e2d6, 20)
  db.rotation.x = Math.PI / 2
  db.position.set(DART.x, 2.0, DART.z)
  group.add(db)
  const bull = cyl(0.09, 0.09, 0.1, 0xd24a4a, 12)
  bull.rotation.x = Math.PI / 2
  bull.position.set(DART.x - 0.07, 2.0, DART.z)
  group.add(bull)

  const cooler = new THREE.Group()
  cooler.position.set(HALF_W - 1.5, 0, HALF_D - 4)
  const body = box(0.6, 1.0, 0.6, 0xdfe7ea)
  body.position.y = 0.5
  cooler.add(body)
  const jug = cyl(0.26, 0.22, 0.5, 0x7fc9e8, 14)
  jug.position.y = 1.25
  cooler.add(jug)
  group.add(cooler)

  // ---- door frame at the south gap
  const door = box(2.6, 3.0, 0.12, pal.wood)
  door.position.set(0, 1.5, HALF_D - 0.05)
  door.visible = true
  door.name = 'door'
  group.add(door)

  // ---- lights
  scene.add(new THREE.AmbientLight(0xffffff, 1.15))
  const sun = new THREE.DirectionalLight(0xfff6e5, 1.9)
  sun.position.set(9, 14, 7)
  scene.add(sun)
  const fill = new THREE.HemisphereLight(0xeaf4ff, 0xcfc0a4, 1.05)
  scene.add(fill)
  // ceiling strip lights: what makes it read as an office rather than a warehouse
  for (const z of [-6.5, 0.5, 6.5]) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(9, 0.06, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 1.0 }),
    )
    strip.position.set(0, 4.6, z)
    group.add(strip)
    const housing = box(9.3, 0.14, 0.44, 0xd7dde2, { metal: 0.3 })
    housing.position.set(0, 4.7, z)
    group.add(housing)
    const light = new THREE.PointLight(0xfff6e6, 0.85, 18)
    light.position.set(0, 4.4, z)
    group.add(light)
  }

  function applyPalette(h: number) {
    pal = paletteFor(h)
    const night = h >= 18 || h < 6
    floor.material = new THREE.MeshStandardMaterial({ color: pal.floor, roughness: 0.9 })
    ;(rug.material as THREE.MeshStandardMaterial).color.setHex(pal.rug)
    wallMat.color.setHex(pal.wall)
    // Even at night this is a lit office, not a dark warehouse: the ceiling
    // strips carry the room and the desks get their task lamps.
    sun.intensity = night ? 1.15 : 1.9
    sun.color.setHex(night ? 0xc9d8ee : 0xfff6e5)
    fill.intensity = night ? 0.95 : 1.05
    for (const l of lamps) l.intensity = night ? 0.85 : 0
    for (const m of monitors) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 1.6 : 1.1
  }

  return { group, desks: DESKS, monitors, lamps, boardSurface, applyPalette }
}
