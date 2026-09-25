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
  const BOARD_COLUMNS = 6
  for (let i = 1; i < BOARD_COLUMNS; i++) {
    const div = box(0.05, KANBAN_BOARD.h - 0.7, 0.22, 0x1d5c42)
    div.position.set(
      KANBAN_BOARD.x - KANBAN_BOARD.w / 2 + (KANBAN_BOARD.w / BOARD_COLUMNS) * i,
      KANBAN_BOARD.y,
      KANBAN_BOARD.z + 0.12,
    )
    group.add(div)
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const sun = new THREE.DirectionalLight(0xfff6e5, 1.1)
  sun.position.set(9, 14, 7)
  scene.add(sun)
  const fill = new THREE.HemisphereLight(0xbfd8ff, 0x6b5b45, 0.5)
  scene.add(fill)

  function applyPalette(h: number) {
    pal = paletteFor(h)
    const night = h >= 18 || h < 6
    floor.material = new THREE.MeshStandardMaterial({ color: pal.floor, roughness: 0.9 })
    ;(rug.material as THREE.MeshStandardMaterial).color.setHex(pal.rug)
    wallMat.color.setHex(pal.wall)
    sun.intensity = night ? 0.18 : 1.1
    sun.color.setHex(night ? 0x9fb6d8 : 0xfff6e5)
    fill.intensity = night ? 0.22 : 0.5
    for (const l of lamps) l.intensity = night ? 0.85 : 0
    for (const m of monitors) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 1.6 : 1.1
  }

  return { group, desks: DESKS, monitors, lamps, boardSurface, applyPalette }
}
