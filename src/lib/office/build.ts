/**
 * Building + furniture builder.
 *
 * The building is a **U** wrapped around an open-air courtyard, and it is **split
 * level**: the ground floor carries the lobby, the three division work rooms, the
 * pantry and the leisure room; the first floor carries the CEO suite and the five
 * named meeting rooms. `layout.ts` is the plan and this file draws exactly it —
 * every solid here has a matching `Footprint`, and `nav.ts` walks the same table.
 *
 * Units: 1 = 1 metre. +X east, +Z south, +Y up.
 */
import * as THREE from 'three'
import { rbox } from './bevel'
import {
  carpetGrey,
  glassReal,
  goldAccent,
  marbleLight,
  plasterClean,
  stoneDark,
  woodPanelDark,
  woodWarm,
} from './materials'
import {
  BARS,
  BBQ,
  BOARD_COLUMNS,
  CEILING_Y,
  CONFERENCE,
  DESKS,
  DESK_CHAIR,
  DOOR,
  FLOOR,
  FOOTPRINTS,
  GARDEN,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  LEVEL_H,
  LOUNGE,
  LOUNGE_TABLE,
  LOUNGE_TV,
  courtyardWallSegments,
  MEETING_ROOMS,
  MEETING_ROOM_IDS,
  MEETING_TABLES,
  PANTRY,
  PANTRY_STOOLS,
  PANTRY_STOOL_GAP,
  POOL,
  POOL_BENCHES,
  POOL_LOUNGERS,
  RECEPTION,
  ROOMS,
  ROOM_SIGNS,
  STAIRS,
  STAIR_FLIGHT_TOP,
  STAIR_RAIL_EXTENSION,
  WALL_H,
  WALL_T,
  paletteFor,
  roomById,
  roomCentre,
  type Palette,
} from './layout'

/* ------------------------------------------------------------- primitives -- */

type MatOpts = { metal?: number; rough?: number; emissive?: number; ei?: number }
const stdMat = (color: number, o: MatOpts = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    metalness: o.metal ?? 0,
    roughness: o.rough ?? 0.75,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.ei ?? (o.emissive ? 0.9 : 0),
  })

const box = (w: number, h: number, d: number, color: number, o: MatOpts = {}) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(color, o))

const cyl = (rt: number, rb: number, h: number, color: number, seg = 14, metal = 0) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), stdMat(color, { metal, rough: 0.6 }))

/* --------------------------------------------------------------- textures -- */

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  draw(ctx, size)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function bumpFrom(source: THREE.Texture, strength = 0.5): THREE.Texture {
  const src = source.image as HTMLCanvasElement
  const cv = document.createElement('canvas')
  cv.width = src.width
  cv.height = src.height
  const g = cv.getContext('2d')!
  g.drawImage(src, 0, 0)
  const img = g.getImageData(0, 0, cv.width, cv.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
    const v = Math.max(0, Math.min(255, 128 + (l - 0.5) * 255 * strength * 2))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  g.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function earthTexture(base: string, dark: string, light: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(211)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 26; i++) {
      const g = c.createRadialGradient(rand() * s, rand() * s, 8, rand() * s, rand() * s, 60 + rand() * 120)
      g.addColorStop(0, rand() > 0.5 ? light : dark)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.globalAlpha = 0.16 + rand() * 0.18
      c.fillStyle = g
      c.fillRect(0, 0, s, s)
    }
    c.globalAlpha = 1
    for (let i = 0; i < 420; i++) {
      c.globalAlpha = 0.06 + rand() * 0.14
      c.fillStyle = rand() > 0.35 ? dark : light
      c.beginPath()
      c.ellipse(rand() * s, rand() * s, 3 + rand() * 14, 2 + rand() * 9, rand() * 3, 0, Math.PI * 2)
      c.fill()
    }
    for (let i = 0; i < 5200; i++) {
      c.globalAlpha = 0.05 + rand() * 0.16
      c.fillStyle = rand() > 0.5 ? light : dark
      c.fillRect(rand() * s, rand() * s, 1 + rand() * 2, 1 + rand() * 2)
    }
    c.globalAlpha = 1
  })
}

function asphaltTexture(base: string, grit: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(77)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 4200; i++) {
      c.globalAlpha = 0.05 + rand() * 0.16
      c.fillStyle = rand() > 0.35 ? grit : '#2b2e31'
      const r = 0.6 + rand() * 1.9
      c.beginPath()
      c.arc(rand() * s, rand() * s, r, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1
  })
}

function pavementTexture(base: string, joint: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(13)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    const n = 4
    const t = s / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        c.globalAlpha = 0.06 + rand() * 0.1
        c.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000'
        c.fillRect(i * t + 2, j * t + 2, t - 4, t - 4)
        c.globalAlpha = 1
      }
    }
    c.strokeStyle = joint
    c.lineWidth = 3
    for (let i = 0; i <= n; i++) {
      c.beginPath()
      c.moveTo(i * t, 0)
      c.lineTo(i * t, s)
      c.moveTo(0, i * t)
      c.lineTo(s, i * t)
      c.stroke()
    }
  })
}

/** Grass for the courtyard garden beds. */
function grassTexture(base: string, blade: string) {
  return canvasTex(256, (c, s) => {
    const rand = rng(97)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 9000; i++) {
      c.globalAlpha = 0.10 + rand() * 0.22
      c.strokeStyle = rand() > 0.5 ? blade : base
      c.lineWidth = 0.8
      const x = rand() * s
      const y = rand() * s
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 3)
      c.stroke()
    }
    c.globalAlpha = 1
  })
}

/** A readable room-name plate: dark panel, gold serif text. */
function signTexture(text: string, sub?: string) {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 128
  const c = cv.getContext('2d')!
  c.fillStyle = '#2a1f16'
  c.fillRect(0, 0, 512, 128)
  c.strokeStyle = '#c9a24a'
  c.lineWidth = 6
  c.strokeRect(8, 8, 496, 112)
  c.fillStyle = '#e8cf8a'
  c.font = 'bold 54px Georgia, serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(text, 256, sub ? 50 : 64)
  if (sub) {
    c.fillStyle = '#a89a72'
    c.font = '26px Georgia, serif'
    c.fillText(sub, 256, 94)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** The green whiteboard face — the office Kanban, now clickable. */
function whiteboardTexture() {
  const cv = document.createElement('canvas')
  cv.width = 1024
  cv.height = 512
  const c = cv.getContext('2d')!
  // A chalkboard green that still reads as GREEN from across the courtyard. The
  // first pass used #2f6b4f, which the tone mapping crushed to near-black.
  const grad = c.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, '#4f9c6f')
  grad.addColorStop(1, '#3d8058')
  c.fillStyle = grad
  c.fillRect(0, 0, 1024, 512)
  // chalk column headings, evenly spaced
  c.fillStyle = '#f2fff0'
  c.font = 'bold 44px ui-monospace, monospace'
  c.textAlign = 'center'
  c.textBaseline = 'top'
  const colW = 1024 / BOARD_COLUMNS.length
  for (let i = 0; i < BOARD_COLUMNS.length; i++) {
    c.fillText(BOARD_COLUMNS[i], colW * (i + 0.5), 24)
    c.strokeStyle = 'rgba(242,255,240,0.45)'
    c.lineWidth = 3
    if (i > 0) {
      c.beginPath()
      c.moveTo(colW * i, 12)
      c.lineTo(colW * i, 500)
      c.stroke()
    }
  }
  // a few chalk ticks, so it reads as a working board and not a coloured panel
  const rand = rng(53)
  c.strokeStyle = 'rgba(242,255,240,0.30)'
  c.lineWidth = 2
  for (let i = 0; i < 40; i++) {
    const x = rand() * 1024
    const y = 90 + rand() * 380
    c.beginPath()
    c.moveTo(x, y)
    c.lineTo(x + 20 + rand() * 60, y)
    c.stroke()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ------------------------------------------------------------------ build -- */

export type OfficeProps = {
  group: THREE.Group
  monitors: THREE.Mesh[]
  lamps: THREE.PointLight[]
  boardSurface: THREE.Mesh
  streaks: THREE.Mesh[]
  streetGroup: THREE.Group
  /** The single shadow-casting light; the scene configures its shadow camera. */
  sun: THREE.DirectionalLight
  /** Advance pedestrians, traffic and street foliage. */
  animateStreet: (dt: number, t: number) => void
  applyPalette: (hour: number) => void
  dispose: () => void
}

export function buildOffice(scene: THREE.Scene, hour: number) {
  const group = new THREE.Group()
  scene.add(group)
  let pal: Palette = paletteFor(hour)
  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(t: T): T => {
    disposables.push(t)
    return t
  }

  /* --------------------------------------------------------------- textures */
  const marbleMat = track(marbleLight())
  const woodMat = track(woodWarm())
  const glassMat = track(glassReal())
  const stoneMat = track(stoneDark())
  const plasterMat = track(plasterClean())
  const panelMat = track(woodPanelDark())
  const carpetMat = track(carpetGrey())
  const goldMat = track(goldAccent())
  const whiteboardMat = track(
    new THREE.MeshStandardMaterial({
      map: whiteboardTexture(),
      roughness: 0.8,
      // A touch of self-illumination so the board keeps its green under the
      // interior lights instead of falling to near-black in shadow.
      emissive: 0x2a5c3e,
      emissiveIntensity: 0.35,
    }),
  )
  const grassMat = track(
    new THREE.MeshStandardMaterial({ map: grassTexture('#4f7a45', '#6da05c'), roughness: 1 }),
  )

  const monitors: THREE.Mesh[] = []
  const lamps: THREE.PointLight[] = []
  const streaks: THREE.Mesh[] = []

  const add = (m: THREE.Object3D, y = 0) => {
    m.position.y += y
    group.add(m)
    return m
  }

  /* ------------------------------------------------------- level 0: floors */
  // Marble slabs under each BAR. The courtyard gets its own treatment (deck +
  // grass) because it is outdoors — that is the whole point of the U.
  for (const bar of [BARS.west, BARS.north, BARS.east, BARS.lobby]) {
    const w = bar.x2 - bar.x1
    const d = bar.z2 - bar.z1
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(w, d), marbleMat)
    slab.rotation.x = -Math.PI / 2
    slab.position.set((bar.x1 + bar.x2) / 2, 0, (bar.z1 + bar.z2) / 2)
    slab.receiveShadow = true
    group.add(slab)
  }

  /* ------------------------------------------------------------ courtyard */
  {
    const c = BARS.courtyard
    // Paved deck, drawn as FOUR slabs AROUND the pool so the basin is a real hole
    // in the paving. One slab across the whole courtyard buried the water under
    // the deck: the pool existed but was invisible.
    const deckMat = track(new THREE.MeshStandardMaterial({ color: 0xcfc7b4, roughness: 0.9 }))
    const px1 = POOL.x - POOL.w / 2 - 0.4
    const px2 = POOL.x + POOL.w / 2 + 0.4
    const pz1 = POOL.z - POOL.d / 2 - 0.4
    const pz2 = POOL.z + POOL.d / 2 + 0.4
    for (const [x1, x2, z1, z2] of [
      [c.x1, c.x2, c.z1, pz1], // north of the pool
      [c.x1, c.x2, pz2, c.z2], // south of the pool
      [c.x1, px1, pz1, pz2], // west of the pool
      [px2, c.x2, pz1, pz2], // east of the pool
    ] as const) {
      const w = x2 - x1
      const d = z2 - z1
      if (w <= 0.01 || d <= 0.01) continue
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(w, d), deckMat)
      slab.rotation.x = -Math.PI / 2
      slab.position.set((x1 + x2) / 2, 0.01, (z1 + z2) / 2)
      slab.receiveShadow = true
      group.add(slab)
    }
  }

  /* ------------------------------------------------------------------ pool */
  {
    // basin: a recessed box, water plane, stone coping, and a deck edge
    const { x, z, w, d } = POOL
    const wallH = 0.5
    const t = 0.35
    // four side walls of the basin
    for (const [sx, sz, sw, sd] of [
      [x, z - d / 2 + t / 2, w, t],
      [x, z + d / 2 - t / 2, w, t],
      [x - w / 2 + t / 2, z, t, d],
      [x + w / 2 - t / 2, z, t, d],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, wallH, sd), stoneMat)
      m.position.set(sx, -wallH / 2 + 0.02, sz)
      group.add(m)
    }
    // basin floor
    const floorM = new THREE.Mesh(new THREE.BoxGeometry(w - t * 2, 0.12, d - t * 2), stoneMat)
    floorM.position.set(x, -wallH + 0.06, z)
    group.add(floorM)
    // water: slightly transparent, low roughness so it catches the sky
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(w - t * 2, d - t * 2),
      track(
        new THREE.MeshPhysicalMaterial({
          color: 0x2f8fb5,
          roughness: 0.06,
          metalness: 0.1,
          transmission: 0.55,
          thickness: 0.4,
          transparent: true,
          opacity: 0.85,
        }),
      ),
    )
    water.rotation.x = -Math.PI / 2
    water.position.set(x, POOL.waterY - 0.06, z)
    group.add(water)
    // coping: a light stone lip all the way round
    for (const [sx, sz, sw, sd] of [
      [x, z - d / 2 - 0.18, w + 0.72, 0.36],
      [x, z + d / 2 + 0.18, w + 0.72, 0.36],
      [x - w / 2 - 0.18, z, 0.36, d],
      [x + w / 2 + 0.18, z, 0.36, d],
    ] as const) {
      const m = box(sw, 0.09, sd, 0xd8d2c2, { rough: 0.7 })
      m.position.set(sx, 0.045, sz)
      group.add(m)
    }
    // pool ladder at the east end
    for (const lz of [z - 0.5, z + 0.5]) {
      const rail = cyl(0.035, 0.035, 1.1, 0xcfd6da, 10, 0.9)
      rail.position.set(x + w / 2 - 0.2, 0.35, lz)
      rail.rotation.z = 0.18
      group.add(rail)
    }
  }

  /* ------------------------------------------------- courtyard furniture -- */
  // benches facing the water
  for (const b of POOL_BENCHES) {
    const g = new THREE.Group()
    g.position.set(b.x, 0, b.z)
    g.rotation.y = b.facing
    const seat = new THREE.Mesh(rbox(1.6, 0.09, 0.52, 0.03), woodMat)
    seat.position.y = 0.5
    seat.castShadow = true
    g.add(seat)
    for (const lx of [-0.65, 0.65]) {
      const leg = box(0.1, 0.46, 0.44, 0x8a8f95, { metal: 0.4 })
      leg.position.set(lx, 0.23, 0)
      g.add(leg)
    }
    group.add(g)
  }
  // Loungers on the pool deck, HEAD AWAY FROM THE POOL and lying surface looking
  // ACROSS the water.
  //
  // The mesh builds its head rest at local -z, so with rotation 0 the head points
  // north (-z). The two loungers sit EAST of the pool and used to be rotated
  // -PI/2, which swung the head rest to point EAST — away from the pool — while
  // the flat bed faced the water. That is the "bed faces one way, head faces the
  // other" bug: the lounger was rotated as a whole, so head and bed could not
  // disagree, but the head ended up on the far side from the pool.
  //
  // They now face WEST (-PI/2 turns local -z to -x), so the head is on the east
  // side and the body lies looking west across the pool — the way a sun lounger
  // is actually used.
  for (const l of POOL_LOUNGERS) {
    const g = new THREE.Group()
    g.position.set(l.x, 0, l.z)
    g.rotation.y = l.facing
    const bed = new THREE.Mesh(rbox(0.62, 0.1, 1.7, 0.04), woodMat)
    bed.position.y = 0.42
    g.add(bed)
    const back = new THREE.Mesh(rbox(0.62, 0.08, 0.6, 0.03), woodMat)
    back.position.set(0, 0.62, -0.75)
    // TILT SIGN. The back rest sits at the -z end of the bed, so its far edge
    // (further -z) must be the HIGH one or the head rest slopes down into the deck
    // and the bed reads as being on the wrong side of it. Rotating about X by +0.5
    // lifts the -z edge; -0.5 dropped it, which is the reported "the bed has its
    // back to the chair" bug.
    back.rotation.x = 0.5
    g.add(back)
    for (const [lx, lz] of [
      [-0.25, -0.7],
      [0.25, -0.7],
      [-0.25, 0.7],
      [0.25, 0.7],
    ] as const) {
      const leg = cyl(0.03, 0.03, 0.4, 0x8a8f95, 8, 0.4)
      leg.position.set(lx, 0.2, lz)
      g.add(leg)
    }
    group.add(g)
  }
  // BBQ: a stone counter with a hooded grill
  {
    const g = new THREE.Group()
    g.position.set(BBQ.x, 0, BBQ.z)
    const base = new THREE.Mesh(rbox(1.8, 0.9, 1.1, 0.05), stoneMat)
    base.position.y = 0.45
    base.castShadow = true
    g.add(base)
    const top = box(1.9, 0.07, 1.2, 0x4a5054, { metal: 0.5, rough: 0.4 })
    top.position.y = 0.93
    g.add(top)
    const grill = box(1.0, 0.16, 0.7, 0x2b2f33, { metal: 0.6 })
    grill.position.set(-0.3, 1.04, 0)
    g.add(grill)
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.0, 16, 1, false, 0, Math.PI), stdMat(0x3a3f43, { metal: 0.6, rough: 0.35 }))
    hood.rotation.z = Math.PI / 2
    hood.position.set(0.45, 1.16, 0)
    g.add(hood)
    group.add(g)
  }
  // garden beds
  {
    const g = new THREE.Group()
    g.position.set(GARDEN.x, 0, GARDEN.z)
    const bed = new THREE.Mesh(rbox(2.4, 0.5, 1.8, 0.06), woodMat)
    bed.position.y = 0.25
    g.add(bed)
    const soil = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 1.6), stdMat(0x3b2f23))
    soil.position.y = 0.52
    g.add(soil)
    const rand = rng(41)
    for (let i = 0; i < 14; i++) {
      const bush = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.18 + rand() * 0.14, 0),
        stdMat(rand() > 0.5 ? 0x4f8b55 : 0x6da05c, { rough: 0.9 }),
      )
      bush.position.set((rand() - 0.5) * 1.9, 0.66 + rand() * 0.1, (rand() - 0.5) * 1.3)
      g.add(bush)
    }
    group.add(g)
  }
  // grass patches beside the pool, so the courtyard is not all paving
  for (const [gx, gz, gw, gd] of [
    [-9.5, 8.5, 6, 4],
    [9.5, 8.5, 6, 4],
    [-9.5, 0.5, 4, 4],
    [9.5, 0.5, 4, 4],
  ] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), grassMat)
    m.rotation.x = -Math.PI / 2
    m.position.set(gx, 0.03, gz)
    m.receiveShadow = true
    group.add(m)
  }

  /* --------------------------------------------------------------- walls -- */
  /** A wall slab with a door cut-out, drawn as two jambs plus a lintel. */
  function wallRun(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    level: 0 | 1,
    mat: THREE.Material = plasterMat,
    h = WALL_H,
  ) {
    const y0 = level * LEVEL_H
    const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1)
    const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1)
    const cx = (x1 + x2) / 2
    const cz = (z1 + z2) / 2
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? len : WALL_T, h, horizontal ? WALL_T : len),
      mat,
    )
    m.position.set(cx, y0 + h / 2, cz)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }

  // outer shell — DOLLHOUSE CUT at 1.6 m. At full height the shell turned the whole
  // ground floor into a closed box: the three division rooms, the pantry, the
  // leisure room and the lobby were all built and then hidden by their own walls.
  // 1.6 m keeps every room edge, door and partition legible from the default
  // camera while still reading as a building from outside.
  const CUT_H = 1.6
  const shell = (x1: number, z1: number, x2: number, z2: number) => {
    const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1)
    const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1)
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? len : WALL_T, CUT_H, horizontal ? WALL_T : len),
      plasterMat,
    )
    m.position.set((x1 + x2) / 2, CUT_H / 2, (z1 + z2) / 2)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }
  shell(-HALF_W, -HALF_D, HALF_W, -HALF_D) // north
  shell(-HALF_W, -HALF_D, -HALF_W, HALF_D) // west
  shell(HALF_W, -HALF_D, HALF_W, HALF_D) // east
  shell(-HALF_W, HALF_D, -14, HALF_D) // south-west
  shell(14, HALF_D, HALF_W, HALF_D) // south-east
  shell(-14, HALF_D, DOOR.x - 2.2, HALF_D)
  shell(DOOR.x + 2.2, HALF_D, 14, HALF_D)
  // entrance transom (this one is full height: it is the doorway)
  {
    const m = box(4.4, 0.5, WALL_T, 0xe8eef2, { rough: 0.6 })
    m.position.set(DOOR.x, 2.35, HALF_D)
    group.add(m)
  }
  // courtyard-facing walls, SPLIT AT EVERY DOORWAY, from the same shared list the
  // collision footprints use. Building a solid wall here and then adding door jambs
  // on top of it sealed every ground-floor room in the render while leaving them
  // walkable in the nav grid — the "rooms with no doors" bug.
  for (const s of courtyardWallSegments()) shell(s.x1, s.z1, s.x2, s.z2)
  // lobby's courtyard side: two returns and a wide opening
  shell(-14, 16, -4, 16)
  shell(4, 16, 14, 16)
  // division partitions (full length, cut height)
  shell(-HALF_W, -6.9, -14, -6.9)
  shell(-HALF_W, 6.9, -14, 6.9)
  shell(14, 2, HALF_W, 2)

  /* ------------------------------------------------------------ level 1 -- */
  {
    const n = BARS.north
    // Floor plate over the north bar. The stair climbs the south face and its top
    // LANDING sits inside the building line (z -9.9..-9.0), i.e. directly under
    // this slab — so the plate needs a NOTCH cut into its south edge, otherwise the
    // stair climbs into solid marble.
    //
    // The notch opens SOUTHWARD (it is a bite out of the edge, not a hole in the
    // middle): x across the stair, z from the edge north to just past the landing.
    const notch = {
      x1: STAIRS.x1 - 0.25,
      x2: STAIRS.x2 + 0.25,
      // EXACTLY the landing's depth. Cutting further north would leave a hole in
      // the corridor floor beyond the landing, which a walker could fall into.
      z1: STAIRS.z1,
      z2: n.z2, // the south edge of the plate
    }
    const slabs: [number, number, number, number][] = [
      // west of the notch
      [n.x1, n.z1, notch.x1, n.z2],
      // east of the notch
      [notch.x2, n.z1, n.x2, n.z2],
      // the strip north of the notch, between the two side pieces
      [notch.x1, n.z1, notch.x2, notch.z1],
    ]
    for (const [x1, z1, x2, z2] of slabs) {
      const w = x2 - x1
      const d = z2 - z1
      if (w <= 0.01 || d <= 0.01) continue
      const piece = new THREE.Mesh(new THREE.PlaneGeometry(w, d), marbleMat)
      piece.rotation.x = -Math.PI / 2
      piece.position.set((x1 + x2) / 2, LEVEL_H, (z1 + z2) / 2)
      piece.receiveShadow = true
      group.add(piece)
    }
    // the slab's south edge (seen from the courtyard) is a fascia — BROKEN at the
    // stair, or it would run straight across the top of the flight.
    for (const [x1, x2] of [
      [n.x1, notch.x1],
      [notch.x2, n.x2],
    ] as [number, number][]) {
      const w = x2 - x1
      if (w <= 0.05) continue
      const f = box(w, 0.45, WALL_T, 0xdfe6ea, { rough: 0.85 })
      f.position.set((x1 + x2) / 2, LEVEL_H - 0.22, n.z2)
      group.add(f)
    }
  }
  // level 1 outer walls (same footprint as level 0's north bar), dollhouse-cut to
  // the same 1.6 m as the ground floor so the exec floor reads from above.
  const shell1 = (x1: number, z1: number, x2: number, z2: number) => {
    const horizontal = Math.abs(x2 - x1) > Math.abs(z2 - z1)
    const len = horizontal ? Math.abs(x2 - x1) : Math.abs(z2 - z1)
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? len : WALL_T, CUT_H, horizontal ? WALL_T : len),
      plasterMat,
    )
    m.position.set((x1 + x2) / 2, LEVEL_H + CUT_H / 2, (z1 + z2) / 2)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }
  shell1(-HALF_W, -HALF_D, HALF_W, -HALF_D)
  shell1(-HALF_W, -HALF_D, -HALF_W, -9)
  shell1(HALF_W, -HALF_D, HALF_W, -9)
  // The whiteboard wall: Rinjani's north wall is kept FULL height behind the board,
  // otherwise the green board would float above a 1.6 m parapet.
  {
    const r = roomById('rinjani')!
    const m = new THREE.Mesh(new THREE.BoxGeometry(r.x2 - r.x1, WALL_H, WALL_T), plasterMat)
    m.position.set((r.x1 + r.x2) / 2, LEVEL_H + WALL_H / 2, r.z1 + WALL_T / 2)
    m.receiveShadow = true
    group.add(m)
  }
  // The exec floor's south face (z=-9) is a GLASS BALUSTRADE, not a wall. This is
  // the dollhouse cut: the corridor and all five meeting rooms sit behind it, and a
  // full-height wall at this exact line hid every one of them from the default
  // camera. A railing keeps the floor edge real (and `LEVEL_BOUNDS` still stops a
  // walker) while letting the room read from above.
  //
  // It is BROKEN AT THE STAIR. A continuous pane across z=-9 walled off the very
  // opening the stair lands in, so the top of the flight ended in glass. The pane
  // is therefore two runs, one either side of the stair mouth, with the cap and
  // posts following suit.
  {
    const gap = { x1: STAIRS.x1 - 0.6, x2: STAIRS.x2 + 0.6 }
    const runs: [number, number][] = [
      [-HALF_W, gap.x1],
      [gap.x2, HALF_W],
    ]
    for (const [x1, x2] of runs) {
      const w = x2 - x1
      if (w <= 0.05) continue
      const mid = (x1 + x2) / 2
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.06), glassMat)
      rail.position.set(mid, LEVEL_H + 0.5, -9)
      group.add(rail)
      const cap = box(w, 0.07, 0.12, 0x8a8f95, { metal: 0.6, rough: 0.35 })
      cap.position.set(mid, LEVEL_H + 1.0, -9)
      group.add(cap)
      // posts every 4 m, so it reads as a balustrade and not a floating pane
      for (let x = x1 + 1; x <= x2 - 1; x += 4) {
        const post = cyl(0.04, 0.04, 1.0, 0x8a8f95, 8, 0.6)
        post.position.set(x, LEVEL_H + 0.5, -9)
        group.add(post)
      }
    }
    // A short return rail on each side of the mouth, so the gap reads as a real
    // opening with edges rather than a hole in the railing.
    for (const gx of [gap.x1, gap.x2]) {
      const end = cyl(0.045, 0.045, 1.05, 0x8a8f95, 8, 0.6)
      end.position.set(gx, LEVEL_H + 0.5, -9)
      group.add(end)
    }
  }
  // Interior partitions of the exec floor, drawn from the same footprints nav.ts
  // collides with, so the walls and the walkable space cannot disagree. They are
  // drawn at 1.5 m (half height) — a dollhouse cut. Full-height partitions turned
  // the exec floor into a closed box with five invisible rooms inside it.
  for (const f of FOOTPRINTS.filter((x) => x.level === 1 && x.kind === 'wall')) {
    if (f.id.startsWith('stair-')) continue
    const m = new THREE.Mesh(new THREE.BoxGeometry(f.hw * 2, 1.5, f.hd * 2), plasterMat)
    m.position.set(f.x, LEVEL_H + 0.75, f.z)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }
  // door lintels over every exec-floor doorway
  for (const r of ROOMS.filter((x) => x.level === 1 && x.door)) {
    const d = r.door!
    const lin = box(d.hw * 2, WALL_H - 2.15, WALL_T, 0xe8eef2, { rough: 0.7 })
    lin.position.set(d.x, LEVEL_H + 2.15 + (WALL_H - 2.15) / 2, d.z)
    group.add(lin)
  }

  /* --------------------------------------------------------- stairs -------- */
  {
    // EXTERNAL FEATURE STAIR in the courtyard, climbing the north bar's south face.
    //
    // It runs along Z and rises NORTHWARD: bottom step out at z2 in the open, top
    // landing at z1 tucked under the level-1 slab edge, where it meets the corridor.
    // Because it stands OUTSIDE the building envelope it is actually VISIBLE — the
    // two earlier positions put it inside the terrace, under the marble slab, where
    // no camera could ever see it.
    const w = STAIRS.x2 - STAIRS.x1
    const cx = (STAIRS.x1 + STAIRS.x2) / 2
    // Z DECREASES northward, so the run is (foot - top) — POSITIVE. Writing it as
    // (top - foot) made the run negative, which drew every tread with a negative
    // depth (invisible) and sent the posts marching SOUTH into the courtyard. The
    // stair rendered as two stray diagonal rails. Asserted in the self-test now.
    const flightRun = STAIRS.z2 - STAIR_FLIGHT_TOP
    const steps = 15
    const tread = flightRun / steps
    for (let i = 0; i < steps; i++) {
      const h = (LEVEL_H / steps) * (i + 1)
      const z = STAIRS.z2 - tread * (i + 0.5)
      const step = box(w - 0.24, h, tread, 0xd8d2c4, { rough: 0.82 })
      step.position.set(cx, h / 2, z)
      step.castShadow = true
      step.receiveShadow = true
      group.add(step)
    }
    // The top landing: flat, at corridor level, reaching through the building line
    // so you step straight off onto the corridor floor.
    {
      // EXACTLY the landing depth, centred on the landing — no more.
      //
      // It used to be `landing + 0.5` set 0.25 m further north, so it pushed half a
      // metre of floor out into the level-1 corridor. With the over-long rail below
      // that left only 0.6 m of the 2.65 m corridor walkable — the reported
      // "handrail blocks the corridor" bug. The landing is the stair's arrival, so
      // it may occupy its own footprint and nothing beyond it.
      const land = box(w - 0.24, 0.16, STAIRS.landing, 0xd8d2c4, { rough: 0.82 })
      land.position.set(cx, LEVEL_H - 0.08, STAIRS.z1 + STAIRS.landing / 2)
      land.castShadow = true
      land.receiveShadow = true
      group.add(land)
    }
    // Support: a slim wall under the outer stringer, so the flight is not floating.
    for (const sx of [STAIRS.x1 + 0.1, STAIRS.x2 - 0.1]) {
      for (let i = 0; i < steps; i += 3) {
        const h = (LEVEL_H / steps) * (i + 1)
        const z = STAIRS.z2 - tread * (i + 0.5)
        const leg = box(0.12, h, tread * 3, 0xb9b2a2, { rough: 0.9 })
        leg.position.set(sx, h / 2, z)
        group.add(leg)
      }
    }
    // Railings that FOLLOW THE SLOPE.
    //
    // SIGN MATTERS: the flight rises NORTHWARD and z DECREASES northward, so the
    // rail must rise as z falls. A box rotated about X by θ sends local +z to
    // (y = -z·sin θ), and the north end is local -z, so its height is +z·sin θ —
    // which only rises when θ is POSITIVE. `-pitch` therefore tilted the rail the
    // opposite way from its own steps. The self-test now compares the rail's two
    // world endpoints against the stair's, so the sign cannot flip again.
    const rise = LEVEL_H
    const pitch = Math.atan2(rise, flightRun)
    const railLen = Math.hypot(rise, flightRun)
    for (const rx of [STAIRS.x1 + 0.06, STAIRS.x2 - 0.06]) {
      const rail = box(0.07, 0.07, railLen, 0x8a8f95, { metal: 0.6 })
      rail.position.set(rx, LEVEL_H / 2 + 0.95, (STAIRS.z2 + STAIR_FLIGHT_TOP) / 2)
      rail.rotation.x = pitch
      group.add(rail)
      for (let i = 0; i <= 5; i++) {
        const f = i / 5
        const h = 0.95 + rise * f
        const z = STAIRS.z2 - flightRun * f
        const post = cyl(0.035, 0.035, h, 0x8a8f95, 8, 0.6)
        post.position.set(rx, h / 2, z)
        group.add(post)
      }
      // Handrail past the top nosing: LEVEL, and only as long as a handrail should
      // be — one tread, not the whole landing.
      //
      // It was `STAIRS.landing` (1.40 m), so a bar ran at waist height right across
      // the corridor and read as a railing planted in the walkway. A handrail
      // continues ~300 mm past the top riser so your hand has somewhere to go as you
      // step off; beyond that it is an obstruction.
      const lrail = box(0.07, 0.07, STAIR_RAIL_EXTENSION, 0x8a8f95, { metal: 0.6 })
      lrail.position.set(rx, LEVEL_H + 0.95, STAIR_FLIGHT_TOP - STAIR_RAIL_EXTENSION / 2)
      group.add(lrail)
      // a newel post at the end, so the rail terminates in something instead of
      // stopping in mid-air
      {
        const post = cyl(0.045, 0.045, 1.0, 0x8a8f95, 8, 0.6)
        post.position.set(rx, LEVEL_H + 0.5, STAIR_FLIGHT_TOP - STAIR_RAIL_EXTENSION)
        group.add(post)
      }
    }
  }

  /* --------------------------------------------------- walkway (covered) -- */
  // A canopy strip along the courtyard's three building sides, so moving between
  // rooms does not mean walking in the rain. Columns only — no walls.
  {
    const c = BARS.courtyard
    const off = 2.0
    for (const [x, z] of [
      // west edge
      [c.x1 + off, -7], [c.x1 + off, -1], [c.x1 + off, 5], [c.x1 + off, 11], [c.x1 + off, 15],
      // east edge
      [c.x2 - off, -7], [c.x2 - off, -1], [c.x2 - off, 5], [c.x2 - off, 11], [c.x2 - off, 15],
      // south edge (lobby side)
      [-9, c.z2 - off], [-3, c.z2 - off], [3, c.z2 - off], [9, c.z2 - off],
    ] as const) {
      const post = cyl(0.1, 0.1, LEVEL_H, 0xe6e2d8, 10)
      post.position.set(x, LEVEL_H / 2, z)
      post.castShadow = true
      group.add(post)
    }
    // canopy strips
    for (const [cx, cz, cw, cd] of [
      [c.x1 + off, 4, 3.2, c.z2 - c.z1],
      [c.x2 - off, 4, 3.2, c.z2 - c.z1],
      [0, c.z2 - off, c.x2 - c.x1, 3.2],
    ] as const) {
      const roof = box(cw, 0.16, cd, 0xe8eef2, { rough: 0.85 })
      roof.position.set(cx, LEVEL_H - 0.08, cz)
      roof.castShadow = true
      group.add(roof)
    }
  }

  /* --------------------------------------------------------------- roof --- */
  {
    // DOLLHOUSE: the roof is a THIN RIM around the north bar, not a lid. A solid
    // roof hid the whole exec floor — the CEO suite, all five meeting rooms and the
    // whiteboard were under an opaque slab. The rim keeps the building reading as a
    // building from outside while leaving the interior visible from above.
    const n = BARS.north
    for (const [px, pz, pw, pd] of [
      [0, -HALF_D - 0.3, HALF_W * 2 + 0.6, 0.6],
      [0, -9 + 0.3, HALF_W * 2 + 0.6, 0.6],
      [-HALF_W - 0.3, (n.z1 + n.z2) / 2, 0.6, n.z2 - n.z1 + 0.6],
      [HALF_W + 0.3, (n.z1 + n.z2) / 2, 0.6, n.z2 - n.z1 + 0.6],
    ] as const) {
      const p = box(pw, 0.55, pd, 0x8f9aa0, { rough: 0.9 })
      p.position.set(px, LEVEL_H * 2 + 0.35, pz)
      p.castShadow = true
      group.add(p)
    }
  }

  /* ---------------------------------------------------- ceiling + lights -- */
  // DOLLHOUSE: no ceiling SLAB anywhere. A slab over the west bar hid the three
  // division rooms from above, and one over the east bar hid the pantry and the
  // leisure room — the interior was built and then covered up. What remains is a
  // perimeter BEAM (so the bars read as roofed) plus the light panels themselves,
  // which hang in the open. The courtyard has no ceiling at all: that is what
  // makes the pool outdoor.
  for (const bar of [BARS.west, BARS.east, BARS.lobby]) {
    const w = bar.x2 - bar.x1
    const d = bar.z2 - bar.z1
    const cx = (bar.x1 + bar.x2) / 2
    const cz = (bar.z1 + bar.z2) / 2
    // four thin beams around the bar's edge
    for (const [bx, bz, bw, bd] of [
      [cx, bar.z1 + 0.15, w, 0.3],
      [cx, bar.z2 - 0.15, w, 0.3],
      [bar.x1 + 0.15, cz, 0.3, d],
      [bar.x2 - 0.15, cz, 0.3, d],
    ] as const) {
      const beam = box(bw, 0.34, bd, 0xf2f4f4, { rough: 0.95 })
      beam.position.set(bx, LEVEL_H - 0.17, bz)
      group.add(beam)
    }
  }
  // hanging light panels over the exec floor (they are the `streaks` the palette
  // dims at night) and over the division rooms.
  const panelRows: { x: number; z: number; w: number; y: number }[] = [
    // exec floor
    { x: 0, z: -19, w: HALF_W * 2 - 4, y: LEVEL_H * 2 - 0.35 },
    { x: 0, z: -15.5, w: HALF_W * 2 - 4, y: LEVEL_H * 2 - 0.35 },
    // ground floor: one row per bar, hanging at the ceiling line
    { x: -21, z: -13, w: 12, y: LEVEL_H - 0.35 },
    { x: -21, z: 0, w: 12, y: LEVEL_H - 0.35 },
    { x: -21, z: 13, w: 12, y: LEVEL_H - 0.35 },
    { x: 21, z: -12, w: 12, y: LEVEL_H - 0.35 },
    { x: 21, z: 8, w: 12, y: LEVEL_H - 0.35 },
    { x: 0, z: 18, w: 20, y: LEVEL_H - 0.35 },
  ]
  for (const p of panelRows) {
    const panel = box(p.w, 0.05, 0.4, 0xffffff, { emissive: 0xfff4e0, ei: 1 })
    panel.position.set(p.x, p.y, p.z)
    group.add(panel)
    streaks.push(panel)
    const l = new THREE.PointLight(0xfff6e6, 0.5, 22)
    l.position.set(p.x, p.y - 0.4, p.z)
    group.add(l)
  }

  /* --------------------------------------------------------------- signs -- */
  for (const s of ROOM_SIGNS) {
    const tex = track(signTexture(s.text))
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), mat)
    plate.position.set(s.x, s.level * LEVEL_H + 2.55, s.z)
    // face into the room: south-facing signs look +Z, others look -Z
    plate.rotation.y = 0
    group.add(plate)
    const backing = box(2.5, 0.7, 0.06, 0x2a1f16, { rough: 0.7 })
    backing.position.set(s.x, s.level * LEVEL_H + 2.55, s.z + 0.04)
    group.add(backing)
  }

  /* ------------------------------------------------------ division rooms -- */
  const deskTopMat = woodMat
  for (const d of DESKS) {
    const g = new THREE.Group()
    g.position.set(d.x, 0, d.z)
    g.rotation.y = d.facing
    // top (bevelled), so the edge catches a highlight
    const top = new THREE.Mesh(rbox(1.7, 0.06, 1.0, 0.03), deskTopMat)
    top.position.y = 0.72
    top.castShadow = true
    top.receiveShadow = true
    g.add(top)
    // legs: two trestles, not four sticks
    for (const lx of [-0.62, 0.62]) {
      const leg = box(0.08, 0.72, 0.86, 0xa9b7c1, { metal: 0.35, rough: 0.45 })
      leg.position.set(lx, 0.36, 0)
      g.add(leg)
    }
    // monitor, on a stand, facing the sitter (local -Z is the desk's far side)
    const screen = box(0.86, 0.5, 0.04, 0x24343c, { emissive: 0x1d3b4a, ei: 0.55, rough: 0.35 })
    screen.position.set(0, 1.12, -0.28)
    screen.userData = { kind: 'monitor', deskIndex: d.index }
    g.add(screen)
    monitors[d.index] = screen
    const stand = box(0.1, 0.26, 0.1, 0x3a4147, { metal: 0.5 })
    stand.position.set(0, 0.86, -0.28)
    g.add(stand)
    const foot = box(0.34, 0.03, 0.2, 0x3a4147, { metal: 0.5 })
    foot.position.set(0, 0.755, -0.28)
    g.add(foot)
    // desk lamp, warm at night
    const arm = cyl(0.025, 0.025, 0.42, 0x6d7378, 8, 0.6)
    arm.position.set(0.66, 0.94, -0.3)
    g.add(arm)
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 12, 1, true), stdMat(0xf0e2c4, { emissive: 0xffd89a, ei: hour >= 18 || hour < 6 ? 0.9 : 0.2 }))
    shade.position.set(0.66, 1.12, -0.3)
    shade.rotation.x = 0.5
    g.add(shade)
    const lamp = new THREE.PointLight(0xffdcae, hour >= 18 || hour < 6 ? 0.5 : 0.12, 4.5)
    lamp.position.set(0.66, 1.05, -0.3)
    g.add(lamp)
    lamps.push(lamp)
    // chair: seat, back, star base
    const chair = new THREE.Group()
    chair.position.set(DESK_CHAIR.x, 0, DESK_CHAIR.z)
    const seat = new THREE.Mesh(rbox(0.5, 0.08, 0.48, 0.03), stdMat(0x5f7382, { rough: 0.85 }))
    seat.position.y = 0.5
    chair.add(seat)
    const backr = new THREE.Mesh(rbox(0.48, 0.5, 0.08, 0.03), stdMat(0x5f7382, { rough: 0.85 }))
    backr.position.set(0, 0.78, 0.28)
    chair.add(backr)
    const post = cyl(0.05, 0.05, 0.42, 0x8a8f95, 10, 0.6)
    post.position.y = 0.26
    chair.add(post)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      const arm = box(0.32, 0.04, 0.06, 0x8a8f95, { metal: 0.5 })
      arm.position.set(Math.cos(a) * 0.16, 0.06, Math.sin(a) * 0.16)
      arm.rotation.y = -a
      chair.add(arm)
    }
    g.add(chair)
    group.add(g)
  }
  // a carpet under each division's desk row, so the rooms read as rooms
  for (const r of [roomById('dev')!, roomById('mkt')!, roomById('content')!]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(r.x2 - r.x1 - 1.2, r.z2 - r.z1 - 1.2),
      carpetMat,
    )
    m.rotation.x = -Math.PI / 2
    m.position.set((r.x1 + r.x2) / 2, 0.02, (r.z1 + r.z2) / 2)
    m.receiveShadow = true
    group.add(m)
  }

  /* ------------------------------------------------------ meeting ----- */
  let boardSurface: THREE.Mesh | null = null
  for (const id of MEETING_ROOM_IDS) {
    const t = MEETING_TABLES[id]
    const y = LEVEL_H
    const g = new THREE.Group()
    g.position.set(t.x, y, t.z)
    // oval table: a bevelled box reads as a boardroom table at this scale
    const top = new THREE.Mesh(rbox(t.rx * 2, 0.07, t.rz * 2, 0.06), woodMat)
    top.position.y = 0.74
    top.castShadow = true
    top.receiveShadow = true
    g.add(top)
    const ped = box(t.rx * 0.8, 0.7, t.rz * 0.8, 0x8a6a44, { rough: 0.6 })
    ped.position.y = 0.35
    g.add(ped)
    // chairs on the ring
    for (const s of MEETING_ROOMS[id].seats) {
      const chair = new THREE.Group()
      chair.position.set(s.x - t.x, 0, s.z - t.z)
      // FACE THE TABLE. The seat mesh carries its back rest at local +z, so the
      // chair looks along local -z, and `facing + PI` turns that -z towards the
      // table centre. The old expression `facing - atan2(seat - centre)` reduced
      // to a CONSTANT -PI for every chair, swinging them all to face north no
      // matter where they sat — which is why half of them had their backs to the
      // table. The self-test now checks the world direction of every back rest.
      chair.rotation.y = s.facing + Math.PI
      const seat = new THREE.Mesh(rbox(0.48, 0.08, 0.46, 0.03), stdMat(0x6b7d8a, { rough: 0.85 }))
      seat.position.y = 0.5
      chair.add(seat)
      const backr = new THREE.Mesh(rbox(0.46, 0.46, 0.07, 0.03), stdMat(0x6b7d8a, { rough: 0.85 }))
      backr.position.set(0, 0.75, 0.25)
      chair.add(backr)
      for (const [lx, lz] of [
        [-0.2, -0.2],
        [0.2, -0.2],
        [-0.2, 0.2],
        [0.2, 0.2],
      ] as const) {
        const leg = cyl(0.025, 0.025, 0.48, 0x8a8f95, 8, 0.5)
        leg.position.set(lx, 0.24, lz)
        chair.add(leg)
      }
      g.add(chair)
    }
    group.add(g)
  }
  // the green whiteboard in Rinjani, on its north wall, facing INTO the room (+Z).
  // Its face was pointing north into the wall, so the camera saw only the frame.
  {
    const board = new THREE.Mesh(new THREE.BoxGeometry(KANBAN_BOARD.w, KANBAN_BOARD.h, 0.1), whiteboardMat)
    board.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z + 0.08)
    board.name = 'kanban-board'
    board.userData = { kind: 'whiteboard' }
    board.castShadow = true
    group.add(board)
    const frame = box(KANBAN_BOARD.w + 0.16, KANBAN_BOARD.h + 0.16, 0.08, 0x8a6a44, { rough: 0.6 })
    frame.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z)
    group.add(frame)
    // chalk tray
    const tray = box(KANBAN_BOARD.w, 0.06, 0.14, 0x6f5c45, { rough: 0.7 })
    tray.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y - KANBAN_BOARD.h / 2 - 0.08, KANBAN_BOARD.z + 0.06)
    group.add(tray)
    // expose the board mesh for scene.ts (it pins the card grid / raycast to it)
    boardSurface = board
  }

  /* ------------------------------------------------------------ CEO suite -- */
  {
    const c = roomCentre('ceo')
    const y = LEVEL_H
    // desk: a wide executive top with a return
    const desk = new THREE.Mesh(rbox(2.2, 0.07, 1.2, 0.04), woodMat)
    desk.position.set(c.x, y + 0.74, c.z - 1.5)
    desk.castShadow = true
    group.add(desk)
    for (const [lx, lz] of [
      [-0.95, -0.5],
      [0.95, -0.5],
      [-0.95, 0.5],
      [0.95, 0.5],
    ] as const) {
      const leg = box(0.1, 0.72, 0.1, 0x8a6a44, { rough: 0.6 })
      leg.position.set(c.x + lx, y + 0.36, c.z - 1.5 + lz)
      group.add(leg)
    }
    // chair
    const chair = new THREE.Group()
    chair.position.set(c.x, y, c.z - 0.4)
    const seat = new THREE.Mesh(rbox(0.56, 0.1, 0.54, 0.04), stdMat(0x3f4a52, { rough: 0.8 }))
    seat.position.y = 0.5
    chair.add(seat)
    const backr = new THREE.Mesh(rbox(0.54, 0.62, 0.1, 0.04), stdMat(0x3f4a52, { rough: 0.8 }))
    backr.position.set(0, 0.85, 0.28)
    chair.add(backr)
    const post = cyl(0.05, 0.05, 0.42, 0x8a8f95, 10, 0.6)
    post.position.y = 0.26
    chair.add(post)
    group.add(chair)
    // guest sofa facing the desk
    const sofa = new THREE.Group()
    sofa.position.set(c.x, y, c.z + 2.6)
    const sseat = new THREE.Mesh(rbox(2.2, 0.34, 0.9, 0.06), stdMat(0x83a7cc, { rough: 0.95 }))
    sseat.position.y = 0.28
    sofa.add(sseat)
    const sback = new THREE.Mesh(rbox(2.2, 0.5, 0.24, 0.06), stdMat(0x83a7cc, { rough: 0.95 }))
    sback.position.set(0, 0.6, 0.36)
    sofa.add(sback)
    group.add(sofa)
    // a plant and a floor lamp, so the suite reads as a room not an office box
    const pot = cyl(0.26, 0.2, 0.5, 0xa8674a, 14)
    pot.position.set(c.x + 2.6, y + 0.25, c.z - 2.4)
    group.add(pot)
    for (let i = 0; i < 3; i++) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 - i * 0.09, 0), stdMat(0x4f8b55, { rough: 0.9 }))
      bush.position.set(c.x + 2.6, y + 0.72 + i * 0.34, c.z - 2.4)
      bush.scale.set(1, 0.8, 1)
      group.add(bush)
    }
  }

  /* -------------------------------------------------------- corridor rug --- */
  {
    const r = roomById('corridor1')!
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.x2 - r.x1 - 1, 1.6), carpetMat)
    m.rotation.x = -Math.PI / 2
    m.position.set((r.x1 + r.x2) / 2, LEVEL_H + 0.02, (r.z1 + r.z2) / 2)
    group.add(m)
  }

  /* ---------------------------------------------------------------- lobby -- */
  {
    // reception counter: an L, with a back panel and a chair
    const g = new THREE.Group()
    g.position.set(RECEPTION.x, 0, RECEPTION.z)
    const top = new THREE.Mesh(rbox(3.6, 0.08, 0.9, 0.04), woodMat)
    top.position.y = 1.05
    top.castShadow = true
    g.add(top)
    const body = box(3.5, 0.98, 0.8, 0xe8e2d4, { rough: 0.85 })
    body.position.y = 0.5
    g.add(body)
    // brass kick plate, the only gold in the room
    const kick = box(3.52, 0.1, 0.82, 0xc9a24a, { metal: 0.8, rough: 0.3 })
    kick.position.y = 0.06
    g.add(kick)
    group.add(g)
    // staff chair behind the counter
    const chair = new THREE.Group()
    chair.position.set(RECEPTION.x, 0, RECEPTION.z - 1.15)
    const seat = new THREE.Mesh(rbox(0.5, 0.08, 0.48, 0.03), stdMat(0x5f7382, { rough: 0.85 }))
    seat.position.y = 0.5
    chair.add(seat)
    const backr = new THREE.Mesh(rbox(0.48, 0.5, 0.08, 0.03), stdMat(0x5f7382, { rough: 0.85 }))
    backr.position.set(0, 0.78, -0.28)
    chair.add(backr)
    group.add(chair)
    // waiting bench + planters
    for (const bx of [-11.5, 11.5]) {
      const bench = new THREE.Mesh(rbox(2.6, 0.4, 0.7, 0.06), stdMat(0x8f6f4a, { rough: 0.8 }))
      bench.position.set(bx, 0.3, 18.5)
      bench.castShadow = true
      group.add(bench)
    }
    for (const [px, pz] of [
      [-12.5, 20.4],
      [12.5, 20.4],
      [-3.5, 17.0],
      [3.5, 17.0],
    ] as const) {
      const pot = cyl(0.3, 0.24, 0.6, 0xa8674a, 14)
      pot.position.set(px, 0.3, pz)
      group.add(pot)
      for (let i = 0; i < 3; i++) {
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48 - i * 0.1, 0), stdMat(0x4f8b55, { rough: 0.9 }))
        bush.position.set(px, 0.85 + i * 0.38, pz)
        bush.scale.set(1, 0.8, 1)
        group.add(bush)
      }
    }
    // the entrance doors themselves: two glass leaves with frames
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.3, 0.06), glassMat)
      leaf.position.set(DOOR.x + side * 1.0, 1.15, HALF_D)
      group.add(leaf)
      const frame = box(2.0, 2.4, 0.09, 0x2b3f49, { metal: 0.4, rough: 0.4 })
      frame.position.set(DOOR.x + side * 1.0, 1.2, HALF_D + 0.02)
      group.add(frame)
      const inner = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 0.1), glassMat)
      inner.position.set(DOOR.x + side * 1.0, 1.2, HALF_D)
      group.add(inner)
    }
    // office name plate above the doors (edited through the UI, stored in the DB).
    // It faces OUT (south, toward the street) so a visitor reads it on approach —
    // facing north put the text on the inside face, invisible from the entrance.
    const namePlate = box(6.2, 0.9, 0.12, 0x2a1f16, { rough: 0.6 })
    namePlate.position.set(DOOR.x, 3.5, HALF_D + 0.08)
    namePlate.name = 'office-name-plate'
    group.add(namePlate)
    const nameMat = new THREE.MeshStandardMaterial({ map: signTexture('HERMES OFFICE'), roughness: 0.55 })
    const nameFace = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 0.8), nameMat)
    nameFace.position.set(DOOR.x, 3.5, HALF_D + 0.15)
    nameFace.name = 'office-name-face'
    group.add(nameFace)
    // canopy over the entrance, so the doorway reads from above
    const canopy = box(7.0, 0.22, 2.6, 0xe8eef2, { rough: 0.85 })
    canopy.position.set(DOOR.x, 3.1, HALF_D + 1.3)
    canopy.castShadow = true
    group.add(canopy)
    for (const cx of [-3.2, 3.2]) {
      const col = cyl(0.12, 0.12, 3.0, 0xe6e2d8, 10)
      col.position.set(DOOR.x + cx, 1.5, HALF_D + 2.4)
      col.castShadow = true
      group.add(col)
    }
    // a carpet runner from the doors into the lobby, so the axis reads
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 3.4), carpetMat)
    runner.rotation.x = -Math.PI / 2
    runner.position.set(DOOR.x, 0.03, HALF_D - 1.8)
    runner.receiveShadow = true
    group.add(runner)
  }

  /* --------------------------------------------------------------- pantry -- */
  {
    const g = new THREE.Group()
    g.position.set(PANTRY.x, 0, PANTRY.z)
    // counter along the wall
    const body = box(0.9, 0.9, 6.4, 0xe8e2d4, { rough: 0.85 })
    body.position.y = 0.45
    g.add(body)
    const top = new THREE.Mesh(rbox(1.0, 0.08, 6.5, 0.04), marbleMat)
    top.position.y = 0.94
    g.add(top)
    // sink: a recessed box with a tap
    const sink = box(0.7, 0.14, 0.9, 0xb9c4cb, { metal: 0.7, rough: 0.3 })
    sink.position.set(0, 0.9, -1.4)
    g.add(sink)
    const tap = cyl(0.03, 0.03, 0.4, 0xcfd6da, 8, 0.9)
    tap.position.set(-0.28, 1.15, -1.4)
    g.add(tap)
    // fridge at the north end
    const fridge = box(0.85, 1.9, 0.8, 0xd7dee2, { metal: 0.4, rough: 0.35 })
    fridge.position.set(0, 0.95, -3.0)
    g.add(fridge)
    // wall shelves
    for (let i = 0; i < 3; i++) {
      const shelf = box(0.4, 0.05, 3.2, 0x8f6f4a, { rough: 0.7 })
      shelf.position.set(-0.55, 1.35 + i * 0.42, 1.6)
      g.add(shelf)
    }
    group.add(g)
    // stools at the counter, on the room side
    for (const sz of PANTRY_STOOLS) {
      const g2 = new THREE.Group()
      g2.position.set(PANTRY.x + PANTRY_STOOL_GAP, 0, sz)
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 16), stdMat(0x8f6f4a, { rough: 0.7 }))
      seat.position.y = 0.64
      g2.add(seat)
      const stem = cyl(0.035, 0.045, 0.62, 0x8a8f95, 10, 0.6)
      stem.position.y = 0.32
      g2.add(stem)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 16), stdMat(0x8a8f95, { metal: 0.6 }))
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.24
      g2.add(ring)
      group.add(g2)
    }
  }

  /* -------------------------------------------------------------- leisure -- */
  {
    const g = new THREE.Group()
    g.position.set(LOUNGE.x, 0, LOUNGE.z)
    // Sofa facing NORTH (-z), looking at the TV on the north wall. Rotation 0
    // already faces -z: the mesh puts its back rest at local +z. It used to be
    // described as "facing the courtyard glass" while sitting at z=-12 with the TV
    // at z=-15.4 — i.e. the TV floated in the middle of the room and the sofa
    // faced a wall. Both now come from LOUNGE / LOUNGE_TV.
    const seat = new THREE.Mesh(rbox(2.8, 0.34, 1.0, 0.06), stdMat(0x83a7cc, { rough: 0.95 }))
    seat.position.y = 0.28
    g.add(seat)
    const back = new THREE.Mesh(rbox(2.8, 0.52, 0.26, 0.06), stdMat(0x83a7cc, { rough: 0.95 }))
    back.position.set(0, 0.62, 0.4)
    g.add(back)
    for (const ax of [-1.42, 1.42]) {
      const arm = new THREE.Mesh(rbox(0.24, 0.4, 0.98, 0.06), stdMat(0x83a7cc, { rough: 0.95 }))
      arm.position.set(ax, 0.5, 0)
      g.add(arm)
    }
    // coffee table between sofa and TV
    const table = new THREE.Mesh(rbox(1.2, 0.06, 0.6, 0.03), woodMat)
    table.position.set(LOUNGE_TABLE.x - LOUNGE.x, 0.42, LOUNGE_TABLE.z - LOUNGE.z)
    g.add(table)
    for (const [lx, lz] of [
      [-0.5, -0.2],
      [0.5, -0.2],
      [-0.5, 0.2],
      [0.5, 0.2],
    ] as const) {
      const leg = cyl(0.03, 0.03, 0.42, 0x8a6a44, 8)
      leg.position.set(LOUNGE_TABLE.x - LOUNGE.x + lx, 0.21, LOUNGE_TABLE.z - LOUNGE.z + lz)
      g.add(leg)
    }
    group.add(g)
    // TV flat on the north wall, at the sofa's own x
    const tv = box(1.8, 1.0, 0.08, 0x1b2226, { metal: 0.3, rough: 0.3 })
    tv.position.set(LOUNGE_TV.x, LOUNGE_TV.y, LOUNGE_TV.z)
    group.add(tv)
    const tvScreen = box(1.7, 0.9, 0.02, 0x24343c, { emissive: 0x2a4a5a, ei: 0.6 })
    tvScreen.position.set(LOUNGE_TV.x, LOUNGE_TV.y, LOUNGE_TV.z + 0.06)
    group.add(tvScreen)
  }

  /* ------------------------------------------------------------ lighting -- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.24))
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.6)
  sun.position.set(30, 24, 18)
  scene.add(sun)
  const fill = new THREE.HemisphereLight(0xdfeaf7, 0x8a7a5f, 0.45)
  scene.add(fill)

  /* -------------------------------------------------- outside environment -- */
  const streetGroup = new THREE.Group()
  scene.add(streetGroup)

  const asphaltTex = track(asphaltTexture('#5a5f63', '#8b9095'))
  asphaltTex.repeat.set(24, 3)
  const pavementTex = track(pavementTexture('#9aa0a4', '#7f868b'))
  const earthTex = track(earthTexture('#6b7a56', '#4d5a3e', '#8a9a6c'))
  earthTex.repeat.set(18, 18)
  const earthBump = track(bumpFrom(earthTex, 0.55))
  const asphaltBump = track(bumpFrom(asphaltTex, 0.7))
  const pavementBump = track(bumpFrom(pavementTex, 0.5))

  const GROUND_EXTENT = 220
  const earth = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_EXTENT, GROUND_EXTENT),
    new THREE.MeshStandardMaterial({ color: 0x6f7a5e, map: earthTex, bumpMap: earthBump, bumpScale: 0.5, roughness: 1 }),
  )
  earth.rotation.x = -Math.PI / 2
  earth.position.y = -0.12
  earth.receiveShadow = true
  streetGroup.add(earth)

  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 130),
    new THREE.MeshStandardMaterial({ map: pavementTex, bumpMap: pavementBump, bumpScale: 0.25, roughness: 0.95 }),
  )
  pavement.rotation.x = -Math.PI / 2
  pavement.position.set(0, -0.06, 0)
  pavement.receiveShadow = true
  streetGroup.add(pavement)

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 9),
    new THREE.MeshStandardMaterial({ map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.4, roughness: 0.98 }),
  )
  road.rotation.x = -Math.PI / 2
  road.position.set(0, -0.05, HALF_D + 14)
  streetGroup.add(road)
  for (let i = -10; i <= 10; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.18), stdMat(0xd8d2b8, { rough: 0.9 }))
    dash.rotation.x = -Math.PI / 2
    dash.position.set(i * 7, -0.04, HALF_D + 14)
    streetGroup.add(dash)
  }

  const foliage: { group: THREE.Group; phase: number }[] = []
  const tree = (x: number, z: number, scale = 1) => {
    const t = new THREE.Group()
    t.position.set(x, 0, z)
    const trunk = cyl(0.14 * scale, 0.2 * scale, 2.0 * scale, 0x6b5138, 8)
    trunk.position.y = 1.0 * scale
    t.add(trunk)
    const canopyMat = stdMat(0x4f8b55, { rough: 0.9 })
    for (const [ox, oy, oz, r] of [
      [0, 2.4, 0, 1.05],
      [0.5, 2.0, 0.3, 0.75],
      [-0.45, 2.1, -0.3, 0.7],
    ]) {
      const leafM = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 0), canopyMat)
      leafM.position.set(ox * scale, oy * scale, oz * scale)
      t.add(leafM)
    }
    streetGroup.add(t)
    foliage.push({ group: t, phase: Math.abs(x * 0.17 + z * 0.11) })
  }
  // palms along the frontage, so the entrance has a boulevard
  for (const [tx, tz] of [
    [-34, 26], [-22, 26], [22, 26], [34, 26],
    [-42, 6], [42, 6], [-42, -14], [42, -14],
  ]) {
    tree(tx, tz, 1.3)
  }

  const kerb = box(FLOOR.width + 40, 0.12, 0.3, 0xb9bec2, { rough: 0.9 })
  kerb.position.set(0, -0.02, HALF_D + 9.2)
  streetGroup.add(kerb)

  for (const lx of [-20, 20]) {
    const lampZ = HALF_D + 6.4
    const post = cyl(0.07, 0.09, 5.4, 0x6d7378, 8, 0.5)
    post.position.set(lx, 2.7, lampZ)
    streetGroup.add(post)
    const arm = box(0.14, 0.1, 1.2, 0x6d7378, { metal: 0.5 })
    arm.position.set(lx, 5.3, lampZ + 0.5)
    streetGroup.add(arm)
    const head = box(0.6, 0.14, 0.34, 0x6d7378, { metal: 0.5 })
    head.position.set(lx, 5.24, lampZ + 1.05)
    streetGroup.add(head)
    const lamp = new THREE.PointLight(0xfff0cf, hour >= 18 || hour < 6 ? 1.0 : 0.1, 18)
    lamp.position.set(lx, 5.05, lampZ + 1.05)
    streetGroup.add(lamp)
  }

  /* --------------------------------------------------------- living street */
  const ROW_SPEED = [1.55, 1.05] as const
  const PED_GAP = 3.2
  const walkers: {
    obj: THREE.Group
    legs: THREE.Object3D[]
    from: number
    to: number
    z: number
    speed: number
    row: number
    t: number
  }[] = []
  const vehicles: { obj: THREE.Group; x0: number; x1: number; z: number; speed: number }[] = []

  const makeWalker = (color: number) => {
    const g = new THREE.Group()
    const body = box(0.34, 0.62, 0.22, color, { rough: 0.8 })
    body.position.y = 1.05
    g.add(body)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), stdMat(0xe4b48c, { rough: 0.85 }))
    head.position.y = 1.5
    g.add(head)
    const legs: THREE.Object3D[] = []
    for (const side of [-1, 1]) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.09, 0.74, 0)
      const leg = box(0.12, 0.72, 0.12, 0x39424b)
      leg.position.y = -0.36
      hip.add(leg)
      g.add(hip)
      legs.push(hip)
    }
    const arms: THREE.Object3D[] = []
    for (const side of [-1, 1]) {
      const sh = new THREE.Group()
      sh.position.set(side * 0.22, 1.32, 0)
      const arm = box(0.1, 0.5, 0.1, color)
      arm.position.y = -0.25
      sh.add(arm)
      g.add(sh)
      arms.push(sh)
    }
    g.userData.arms = arms
    return { g, legs }
  }

  const PED_COLORS = [0xc9553f, 0x3f6fc9, 0x4f9a63, 0xd8a83f, 0x8a5fc9, 0x3fa8a8]
  for (let i = 0; i < 6; i++) {
    const { g, legs } = makeWalker(PED_COLORS[i % PED_COLORS.length])
    const row = i % 2
    const sidewalkZ = HALF_D + (row === 0 ? 2.5 : 5.5)
    const from = -40 + i * 13
    g.position.set(from, 0, sidewalkZ)
    streetGroup.add(g)
    walkers.push({ obj: g, legs, from, to: 44, z: sidewalkZ, speed: ROW_SPEED[row], row, t: i * 0.7 })
  }

  const makeVehicle = (color: number) => {
    const c = new THREE.Group()
    const body = box(4.0, 0.85, 1.8, color, { metal: 0.45, rough: 0.35 })
    body.position.y = 0.75
    c.add(body)
    const cabin = box(2.1, 0.65, 1.65, 0x9fb2bd, { metal: 0.3, rough: 0.2 })
    cabin.position.set(-0.15, 1.45, 0)
    c.add(cabin)
    for (const [wx, wz] of [
      [-1.3, 0.9],
      [1.3, 0.9],
      [-1.3, -0.9],
      [1.3, -0.9],
    ]) {
      const wheel = cyl(0.34, 0.34, 0.22, 0x24282b, 12, 0.2)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(wx, 0.34, wz)
      c.add(wheel)
    }
    for (const hx of [-2.0, 2.0]) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.16, 0.3),
        stdMat(0xfff0cc, { emissive: 0xffe0a0, ei: 0.8 }),
      )
      lamp.position.set(hx, 0.85, 0)
      c.add(lamp)
    }
    return c
  }

  const LANE_NORTH = HALF_D + 11.5
  const LANE_SOUTH = HALF_D + 15.5
  const CAR_COLORS = [0xb9563f, 0x3f6fb9, 0xd8d3c4, 0x4f7a5f, 0x8a8f95]
  const LANE_SPEED = { [LANE_NORTH]: 7, [LANE_SOUTH]: 9 } as Record<number, number>
  const perLane = [0, 0]
  for (let i = 0; i < 5; i++) {
    const forward = i % 2 === 0
    const c = makeVehicle(CAR_COLORS[i % CAR_COLORS.length])
    const z = forward ? LANE_NORTH : LANE_SOUTH
    c.rotation.y = forward ? 0 : Math.PI
    const laneIdx = forward ? 0 : 1
    const slot = perLane[laneIdx]++
    const laneLen = 92
    const gap = laneLen / 3
    const startOffset = forward ? slot * gap : -slot * gap
    const x0 = forward ? -46 + startOffset : 46 + startOffset
    const x1 = forward ? x0 + laneLen : x0 - laneLen
    c.position.set(x0, 0, z)
    streetGroup.add(c)
    vehicles.push({ obj: c, x0, x1, z, speed: LANE_SPEED[z] })
  }

  function animateStreet(dt: number, t: number) {
    for (const { group: g, phase } of foliage) {
      g.rotation.z = Math.sin(t * 0.8 + phase) * 0.018
      g.rotation.x = Math.sin(t * 0.55 + phase) * 0.012
    }
    const byRow: number[][] = [[], []]
    walkers.forEach((w, i) => byRow[w.row].push(i))
    for (const row of byRow) {
      row.sort((a, b) => walkers[a].obj.position.x - walkers[b].obj.position.x)
      for (let k = 1; k < row.length; k++) {
        const behind = walkers[row[k - 1]]
        const ahead = walkers[row[k]]
        const gap = ahead.obj.position.x - behind.obj.position.x
        if (gap < PED_GAP) behind.obj.position.x = ahead.obj.position.x - PED_GAP
      }
    }
    for (const w of walkers) {
      const span = w.to - w.from
      w.t += (w.speed * dt) / span
      if (w.t > 1) w.t -= 1
      if (w.t < 0) w.t += 1
      w.obj.position.x = w.from + span * w.t
      w.obj.position.z = w.z + Math.sin(w.obj.position.x * 0.3) * 0.14
      w.obj.rotation.y = Math.PI / 2
      const swing = Math.sin(t * 6.5 + w.obj.position.x * 0.9) * 0.5
      w.legs[0].rotation.x = swing
      w.legs[1].rotation.x = -swing
      const arms = w.obj.userData.arms as THREE.Object3D[]
      arms[0].rotation.x = -swing * 0.7
      arms[1].rotation.x = swing * 0.7
    }
    for (const v of vehicles) {
      const span = v.x1 - v.x0
      const dir = Math.sign(span)
      v.obj.position.x += dir * v.speed * dt
      if (dir > 0 ? v.obj.position.x > v.x1 : v.obj.position.x < v.x1) {
        v.obj.position.x = v.x0
      }
      v.obj.position.z = v.z
    }
  }

  streetGroup.visible = true

  /* ---------------------------------------------------------- apply state -- */
  function applyPalette(h: number) {
    pal = paletteFor(h)
    const night = h >= 18 || h < 6
    sun.intensity = night ? 1.2 : 2.6
    sun.color.setHex(night ? 0xc9d8ee : 0xfff4e2)
    fill.intensity = night ? 0.35 : 0.45
    for (const l of lamps) l.intensity = night ? 0.85 : 0.25
    for (const s of streaks) (s.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 1.5 : 0.85
  }

  function dispose() {
    for (const d of disposables) d.dispose()
  }

  void pal
  void panelMat
  void goldMat
  void CEILING_Y
  void CONFERENCE
  void FOOTPRINTS
  void KANBAN_BOARD
  void STAIRS

  return {
    group,
    monitors,
    lamps,
    boardSurface: boardSurface as THREE.Mesh,
    streaks,
    streetGroup,
    animateStreet,
    sun,
    applyPalette,
    dispose,
  }
}
