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
  DINING_SETS,
  diningChairs,
  diningChairFacing,
  BOARD_COLUMNS,
  CEILING_Y,
  CONFERENCE,
  DESKS,
  DESK_CHAIR,
  DOOR,
  FLOOR,
  FOOTPRINTS,
  GARDEN_BEDS,
  GYM,
  PLANTING,
  SUNBEDS,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  LEVEL_H,
  LOUNGE,
  LOUNGE_TABLE,
  LOUNGE_TV,
  ROOM_PROPS,
  TERRACE_PROPS,
  DARTBOARD,
  DART_THROW,
  RACING_RIGS,
  RACING_SEAT_H,
  BOWLING,
  PIN_R,
  PIN_H,
  BALL_R,
  PIN_OFFSETS,
  courtyardWallSegments,
  MEETING_ROOMS,
  MEETING_ROOM_IDS,
  MEETING_TABLES,
  PANTRY,
  PANTRY_COUNTER,
  PANTRY_COFFEE_Z,
  PANTRY_SINK_Z,
  PANTRY_STOOLS,
  PANTRY_STOOL_GAP,
  FRIDGE,
  WATER_COOLER,
  POOL,
  WATER_Y,
  POOL_BENCHES,
  POOL_LOUNGERS,
  RECEPTION,
  ROOMS,
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

/**
 * The bowling lane's boards: long maple strips with grain and a dark seam between each pair.
 *
 * BOARDS, not planks. A lane is 39 strips running its LENGTH, so the seams have to end up
 * running down the lane. On a box's top face U maps to geometry x, so drawing the seams along
 * the canvas X axis is what puts them along the lane — which is only true while the lane runs
 * along x. Turn the lane and this must be turned with it, or the boards run across and the
 * whole thing reads as a table top, which is a different object entirely.
 *
 * The seams are also the strongest single cue that says "bowling lane" from across a room.
 */
function laneTexture() {
  return canvasTex(512, (c, s) => {
    const rand = rng(41)
    const boards = 16
    const h = s / boards
    for (let i = 0; i < boards; i++) {
      // each board a slightly different tone, which is what stops it reading as printed
      const t = 0.86 + rand() * 0.28
      c.fillStyle = `rgb(${Math.round(201 * t)},${Math.round(160 * t)},${Math.round(106 * t)})`
      c.fillRect(0, i * h, s, h)
      // grain, running the length of the board
      for (let g = 0; g < 7; g++) {
        c.globalAlpha = 0.05 + rand() * 0.07
        c.strokeStyle = rand() > 0.5 ? '#8a6a3c' : '#e8cfa4'
        c.lineWidth = 1
        const y = i * h + rand() * h
        c.beginPath()
        c.moveTo(0, y)
        c.lineTo(s, y + (rand() - 0.5) * 6)
        c.stroke()
        c.globalAlpha = 1
      }
      c.fillStyle = 'rgba(60,40,20,0.5)'
      c.fillRect(0, i * h, s, 1.5)
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

/**
 * The lounge TV's RACE FEED — what the screen shows while somebody is on a racing rig.
 *
 * A first-person racing frame rather than an abstract glow: a road with a vanishing point,
 * lane dashes, barriers and a HUD strip. The requirement was that the TV read as "somebody
 * is playing a racing game", and a flat colour swap does not say that from across the room.
 *
 * Drawn ONCE here and kept; `setTvRacing` only swaps which texture the screen material
 * carries, so the canvas is never redrawn per frame.
 */
function racingFeedTexture() {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 288
  const c = cv.getContext('2d')!
  const HORIZON = 118

  // sky / dusk glow above the horizon
  const sky = c.createLinearGradient(0, 0, 0, HORIZON)
  sky.addColorStop(0, '#0d1b3a')
  sky.addColorStop(1, '#5b4a86')
  c.fillStyle = sky
  c.fillRect(0, 0, 512, HORIZON)
  // ground either side of the road
  c.fillStyle = '#2b3a2a'
  c.fillRect(0, HORIZON, 512, 288 - HORIZON)

  // the road: a trapezoid from a narrow vanishing point to past the frame at the bottom
  c.beginPath()
  c.moveTo(234, HORIZON)
  c.lineTo(278, HORIZON)
  c.lineTo(572, 288)
  c.lineTo(-60, 288)
  c.closePath()
  c.fillStyle = '#3b4046'
  c.fill()

  // barriers hugging both edges
  c.fillStyle = '#c8402f'
  c.beginPath(); c.moveTo(234, HORIZON); c.lineTo(252, HORIZON); c.lineTo(-88, 288); c.lineTo(-118, 288); c.closePath(); c.fill()
  c.beginPath(); c.moveTo(278, HORIZON); c.lineTo(296, HORIZON); c.lineTo(600, 288); c.lineTo(630, 288); c.closePath(); c.fill()

  // lane dashes: they widen as they come forward, which is what sells the depth
  c.fillStyle = '#e8e2c8'
  for (let i = 0; i < 7; i++) {
    const t0 = i / 7
    const t1 = t0 + 0.06
    const y0 = HORIZON + (288 - HORIZON) * t0 * t0
    const y1 = HORIZON + (288 - HORIZON) * t1 * t1
    const w = 1 + 6 * t0 * t0
    c.fillRect(256 - w / 2, y0, w, Math.max(1, y1 - y0))
  }

  // HUD strip along the bottom
  c.fillStyle = 'rgba(6,10,16,0.74)'
  c.fillRect(0, 288 - 48, 512, 48)
  c.textBaseline = 'middle'
  c.font = 'bold 30px ui-monospace, monospace'
  c.textAlign = 'left'
  c.fillStyle = '#7ef0a8'
  c.fillText('LAP 3/5', 18, 288 - 24)
  c.textAlign = 'right'
  c.fillStyle = '#ffd45e'
  c.fillText('248 KM/H', 494, 288 - 24)
  // a rev strip, so the HUD is not just two numbers
  c.fillStyle = '#39d3ff'
  c.fillRect(150, 288 - 21, 212, 9)

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
  /**
   * Drive the grill: the smoke puffs rise and fade on a loop and the fire flickers.
   *
   * The BBQ is the only place in the office with a live flame, and smoke that hangs
   * motionless in the air reads as a grey ball rather than as cooking.
   */
  animateBbq: (t: number) => void
  /**
   * Show or hide the bar resting in the rack's hooks.
   *
   * The bench-press pose puts the bar in the lifter's hands; leaving the rack's own bar in
   * place would draw two bars in the same spot.
   */
  setRackBarVisible: (visible: boolean) => void
  /**
   * Swap the lounge TV between its standby glow and the race feed. The scene calls this once
   * per frame with whether any avatar is driving; it is a no-op unless the state changed.
   */
  setTvRacing: (on: boolean) => void
  applyPalette: (hour: number) => void
  dispose: () => void
}

export function buildOffice(scene: THREE.Scene, hour: number) {
  const group = new THREE.Group()
  scene.add(group)
  /** The BBQ smoke puffs and fire, collected so `animateBbq` can drive them. */
  const bbqSmoke: THREE.Mesh[] = []
  let bbqFire: THREE.Mesh | null = null
  let bbqGlow: THREE.PointLight | null = null
  /**
   * The lounge TV screen, hoisted to function scope so `setTvRacing` (built near the end of
   * this function) can reach it. The lounge block runs long before that, so a `const` inside
   * the block would be out of reach.
   */
  let tvScreen: THREE.Mesh | null = null
  /** The TV's standby look, captured when the mesh is built so `setTvRacing` can restore it. */
  let tvIdleEmissive = 0x2a4a5a
  let tvIdleIntensity = 0.6
  /** The bar and plates resting in the rack's hooks, hidden while somebody benches. */
  const rackBarParts: THREE.Mesh[] = []
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
    water.position.set(x, WATER_Y, z)
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
  // FOUR ZONES, read from layout.ts so the meshes, the footprints and the idle
  // spots cannot disagree. The old furniture (three green lawns, six benches, two
  // loungers, a raised planter) is gone — it was replaced wholesale.

  /* ---- ZONE 1 · NORTH · the GYM ------------------------------------------ */
  {
    // The mat: a green rubber surface you STAND on, so it is a rug, not a blocker.
    const w = GYM.x2 - GYM.x1
    const d = GYM.z2 - GYM.z1
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      stdMat(0x3d6b4b, { rough: 0.98 }),
    )
    mat.rotation.x = -Math.PI / 2
    mat.position.set((GYM.x1 + GYM.x2) / 2, 0.035, (GYM.z1 + GYM.z2) / 2)
    mat.receiveShadow = true
    group.add(mat)
    // a painted border, so the mat reads as a mat and not as lawn
    for (const [bx, bz, bw, bd] of [
      [GYM.x1, (GYM.z1 + GYM.z2) / 2, 0.12, d],
      [GYM.x2, (GYM.z1 + GYM.z2) / 2, 0.12, d],
      [(GYM.x1 + GYM.x2) / 2, GYM.z1, w, 0.12],
      [(GYM.x1 + GYM.x2) / 2, GYM.z2, w, 0.12],
    ] as const) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), stdMat(0xd8d2c4, { rough: 0.9 }))
      edge.rotation.x = -Math.PI / 2
      edge.position.set(bx, 0.04, bz)
      group.add(edge)
    }

    // --- BARBELL RACK: a squat stand with a loaded bar on it -----------------
    {
      const g = new THREE.Group()
      g.position.set(GYM.rack.x, 0, GYM.rack.z)
      // two uprights
      for (const ux of [-0.55, 0.55]) {
        const post = box(0.11, 1.35, 0.11, 0x2f3438, { metal: 0.7 })
        post.position.set(ux, 0.675, 0)
        post.castShadow = true
        g.add(post)
        // feet
        const foot = box(0.14, 0.09, 0.9, 0x2f3438, { metal: 0.7 })
        foot.position.set(ux, 0.045, 0)
        g.add(foot)
      }
      // the bar, resting in the hooks
      const bar = cyl(0.035, 0.035, 2.2, 0xb9c0c6, 12, 0.85)
      bar.rotation.z = Math.PI / 2
      bar.position.set(0, GYM.rack.barY, 0)
      g.add(bar)
      // The rack's bar and its plates are collected so the bench-press pose can HIDE them:
      // when the bar is in the lifter's hands, leaving a second bar resting in the hooks
      // means two bars in the same place.
      rackBarParts.push(bar)
      // plates, biggest inboard
      for (const side of [-1, 1]) {
        for (const [off, r] of [
          [0.78, 0.22],
          [0.88, 0.19],
          [0.97, 0.15],
        ] as const) {
          const plate = cyl(r, r, 0.07, 0x24282c, 18, 0.55)
          plate.rotation.z = Math.PI / 2
          plate.position.set(side * off, GYM.rack.barY, 0)
          g.add(plate)
          rackBarParts.push(plate)
        }
      }
      // a bench under the bar
      const pad = new THREE.Mesh(rbox(0.36, 0.12, 1.25, 0.03), stdMat(0x1f2427, { rough: 0.85 }))
      pad.position.set(0, 0.46, 0.05)
      g.add(pad)
      for (const pz of [-0.42, 0.52]) {
        const leg = box(0.3, 0.4, 0.1, 0x2f3438, { metal: 0.7 })
        leg.position.set(0, 0.2, pz)
        g.add(leg)
      }
      group.add(g)
    }

    // --- DUMBBELL RACK ------------------------------------------------------
    {
      const g = new THREE.Group()
      g.position.set(GYM.dumbbells.x, 0, GYM.dumbbells.z)
      // two-tier A-frame
      for (const [ty, tz] of [
        [0.42, 0.16],
        [0.72, -0.16],
      ] as const) {
        const shelf = box(1.9, 0.06, 0.3, 0x2f3438, { metal: 0.7 })
        shelf.position.set(0, ty, tz)
        shelf.castShadow = true
        g.add(shelf)
      }
      for (const sx of [-0.88, 0, 0.88]) {
        for (const sgn of [-1, 1]) {
          const leg = box(0.07, 0.78, 0.07, 0x2f3438, { metal: 0.7 })
          leg.position.set(sx, 0.39, sgn * 0.14)
          leg.rotation.x = sgn * 0.2
          g.add(leg)
        }
      }
      // the dumbbells themselves, graded
      for (let i = 0; i < 6; i++) {
        const x = -0.72 + i * 0.29
        const tier = i < 3 ? 0.45 : 0.75
        const z = i < 3 ? 0.16 : -0.16
        const r = 0.1 + (i % 3) * 0.022
        const handle = cyl(0.022, 0.022, 0.2, 0x9aa2a8, 8, 0.85)
        handle.rotation.z = Math.PI / 2
        handle.position.set(x, tier + 0.11, z)
        g.add(handle)
        for (const hx of [-0.09, 0.09]) {
          const head = cyl(r, r, 0.09, 0x24282c, 14, 0.55)
          head.rotation.z = Math.PI / 2
          head.position.set(x + hx, tier + 0.11, z)
          g.add(head)
        }
      }
      group.add(g)
    }

    // --- PULL-UP RIG --------------------------------------------------------
    {
      const g = new THREE.Group()
      g.position.set(GYM.rig.x, 0, GYM.rig.z)
      const H = 2.45
      for (const px of [-GYM.rig.span / 2, GYM.rig.span / 2]) {
        const post = box(0.12, H, 0.12, 0x2f3438, { metal: 0.7 })
        post.position.set(px, H / 2, 0)
        post.castShadow = true
        g.add(post)
        const foot = box(0.18, 0.1, 1.0, 0x2f3438, { metal: 0.7 })
        foot.position.set(px, 0.05, 0)
        g.add(foot)
      }
      // the bar you hang from
      const bar = cyl(0.032, 0.032, GYM.rig.span + 0.12, 0xb9c0c6, 12, 0.85)
      bar.rotation.z = Math.PI / 2
      bar.position.set(0, GYM.rig.barY, 0)
      g.add(bar)
      // NO LOWER CROSS-BAR. It used to sit here as decoration ("so it reads as a rig and
      // not a doorway"), and it cannot coexist with the two hanging poses. Measured
      // bands across the muscle-up and the pull-up: heads 1.46..2.22, hips 0.95..1.41,
      // and the swinging feet reach down to 0.03 — the bodies fill the entire height
      // between the mat and the bar, so there is no free y for a rail. At 1.40 the
      // muscle-up's torso passed through it (the OBB audit measured the hip 0.02 m
      // inside); at 1.51 it hit the head band instead. The straps and rings below read
      // as a rig on their own.
      // two hanging grips
      for (const gx of [-0.5, 0.5]) {
        const strap = box(0.05, 0.42, 0.05, 0x3a4045, { rough: 0.9 })
        strap.position.set(gx, H - 0.27, 0)
        g.add(strap)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 16), stdMat(0x9aa2a8, { metal: 0.8 }))
        ring.position.set(gx, H - 0.52, 0)
        g.add(ring)
      }
      group.add(g)
    }
  }

  /* ---- ZONE 2 · PLANTING BAND (between gym and pool) --------------------- */
  {
    const g = new THREE.Group()
    const cx = (PLANTING.x1 + PLANTING.x2) / 2
    const cz = (PLANTING.z1 + PLANTING.z2) / 2
    const w = PLANTING.x2 - PLANTING.x1
    const d = PLANTING.z2 - PLANTING.z1
    // a low planter kerb along the band
    const kerb = new THREE.Mesh(rbox(w, 0.34, d, 0.05), stoneMat)
    kerb.position.set(cx, 0.17, cz)
    kerb.castShadow = true
    kerb.receiveShadow = true
    g.add(kerb)
    const soil = new THREE.Mesh(new THREE.BoxGeometry(w - 0.16, 0.06, d - 0.16), stdMat(0x3b2f23))
    soil.position.set(cx, 0.36, cz)
    g.add(soil)
    // shrubs + a couple of small trees, seeded so the layout is stable
    const rand = rng(77)
    for (let i = 0; i < PLANTING.count; i++) {
      const t = (i + 0.5) / PLANTING.count
      const px = PLANTING.x1 + t * w
      const pz = cz + (rand() - 0.5) * (d - 0.5)
      const big = i % 3 === 0
      const h = big ? 0.95 : 0.5
      const bush = new THREE.Mesh(
        new THREE.IcosahedronGeometry(big ? 0.42 : 0.28, 0),
        stdMat(big ? 0x4f8b55 : 0x6da05c, { rough: 0.9 }),
      )
      bush.position.set(px, 0.4 + h / 2, pz)
      bush.scale.set(1, big ? 1.15 : 0.85, 1)
      bush.castShadow = true
      g.add(bush)
    }
    group.add(g)
  }

  /* ---- ZONE 3 · WEST · TIMBER DAYBEDS facing the water ------------------- */
  for (const b of SUNBEDS) {
    const g = new THREE.Group()
    g.position.set(b.x, 0, b.z)
    g.rotation.y = b.facing
    // a proper daybed: platform, mattress, head rest, four legs
    const frame = new THREE.Mesh(rbox(1.0, 0.12, 2.1, 0.04), woodMat)
    frame.position.y = 0.36
    frame.castShadow = true
    frame.receiveShadow = true
    g.add(frame)
    const mattress = new THREE.Mesh(rbox(0.9, 0.14, 1.95, 0.05), stdMat(0xe8e2d2, { rough: 0.95 }))
    mattress.position.y = 0.49
    g.add(mattress)
    // head rest at the -z end, tilted up
    const head = new THREE.Mesh(rbox(0.9, 0.1, 0.62, 0.04), stdMat(0xe8e2d2, { rough: 0.95 }))
    head.position.set(0, 0.66, -0.72)
    head.rotation.x = 0.5
    head.castShadow = true
    g.add(head)
    for (const [lx, lz] of [
      [-0.4, -0.92],
      [0.4, -0.92],
      [-0.4, 0.92],
      [0.4, 0.92],
    ] as const) {
      const leg = box(0.09, 0.36, 0.09, 0x8a6a44, { rough: 0.8 })
      leg.position.set(lx, 0.18, lz)
      g.add(leg)
    }
    group.add(g)
  }

  /* ---- ZONE 4 · SOUTH · PLAIN WOODEN SEATS facing the water -------------- */
  for (const b of POOL_BENCHES) {
    const g = new THREE.Group()
    g.position.set(b.x, 0, b.z)
    g.rotation.y = b.facing
    // seat slab
    const seat = new THREE.Mesh(rbox(1.7, 0.09, 0.5, 0.03), woodMat)
    seat.position.y = 0.46
    seat.castShadow = true
    g.add(seat)
    // slatted back, so it is clearly a bench and not a table
    for (const [by, tilt] of [
      [0.72, 0.22],
      [0.9, 0.28],
    ] as const) {
      const slat = new THREE.Mesh(rbox(1.7, 0.1, 0.05, 0.02), woodMat)
      slat.position.set(0, by, 0.26)
      slat.rotation.x = -tilt
      g.add(slat)
    }
    for (const lx of [-0.7, 0.7]) {
      const leg = box(0.09, 0.42, 0.42, 0x8a6a44, { rough: 0.8 })
      leg.position.set(lx, 0.21, 0.02)
      g.add(leg)
    }
    group.add(g)
  }

  /* ---- ZONE 5 · EAST · the BBQ ------------------------------------------- */
  {
    const g = new THREE.Group()
    g.position.set(BBQ.x, 0, BBQ.z)
    // stone counter
    const base = new THREE.Mesh(rbox(2.0, 0.9, 1.15, 0.05), stoneMat)
    base.position.y = 0.45
    base.castShadow = true
    g.add(base)
    const top = box(2.1, 0.07, 1.25, 0x4a5054, { metal: 0.5, rough: 0.4 })
    top.position.y = 0.93
    g.add(top)
    // the grill, set into the counter
    const grill = box(1.05, 0.18, 0.72, 0x2b2f33, { metal: 0.6 })
    grill.position.set(-0.35, 1.03, 0)
    g.add(grill)
    // hood
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 1.05, 16, 1, false, 0, Math.PI),
      stdMat(0x3a3f43, { metal: 0.6, rough: 0.35 }),
    )
    hood.rotation.z = Math.PI / 2
    hood.position.set(-0.35, 1.12, 0)
    g.add(hood)
    // a small prep shelf on the other end
    const shelf = box(0.62, 0.05, 0.8, 0xb9b2a2, { rough: 0.8 })
    shelf.position.set(0.62, 0.98, 0)
    g.add(shelf)
    // side burner knob strip, so it reads as equipment
    for (let i = 0; i < 3; i++) {
      const knob = cyl(0.045, 0.045, 0.05, 0x24282c, 10, 0.6)
      knob.rotation.x = Math.PI / 2
      knob.position.set(0.35 + i * 0.22, 0.72, 0.6)
      g.add(knob)
    }
    // The FIRE: an emissive bar under the grate, so the grill glows. Named, because the
    // scene pulses its emissive intensity rather than leaving it constant.
    const fire = box(0.95, 0.05, 0.62, 0xff5a1e, { emissive: 0xff5a1e, ei: 1.4 })
    fire.name = 'bbq-fire'
    fire.position.set(-0.35, 0.97, 0)
    g.add(fire)
    bbqFire = fire
    // The SMOKE: four translucent puffs above the hood, rising and fading on a loop.
    //
    // Sized and weighted to actually be SEEN from the default camera: the first version
    // was 0.16-0.26 m at opacity 0.16-0.30, which against a bright courtyard is invisible.
    // These are larger and denser, and they drift sideways as they rise so the column
    // reads as smoke rather than as beads on a wire.
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.3 + i * 0.09, 12, 10),
        new THREE.MeshBasicMaterial({
          color: 0xe8edf1,
          transparent: true,
          opacity: 0.55 - i * 0.08,
          depthWrite: false,
        }),
      )
      puff.name = `bbq-smoke-${i}`
      puff.position.set(-0.35 + (i - 1.5) * 0.14, 1.5 + i * 0.36, 0)
      g.add(puff)
      bbqSmoke.push(puff)
    }
    // A dim ember glow so the fire lights the counter around it.
    const glow = new THREE.PointLight(0xff7a2e, 0.5, 3.2, 2)
    glow.name = 'bbq-glow'
    glow.position.set(-0.35, 1.05, 0)
    g.add(glow)
    bbqGlow = glow
    group.add(g)
  }

  /* ---- decorative planting beds, tucked along the courtyard edges -------- */
  for (const bed of GARDEN_BEDS) {
    const g = new THREE.Group()
    g.position.set(bed.x, 0, bed.z)
    const box0 = new THREE.Mesh(rbox(bed.w, 0.42, bed.d, 0.05), woodMat)
    box0.position.y = 0.21
    box0.castShadow = true
    g.add(box0)
    const soil = new THREE.Mesh(new THREE.BoxGeometry(bed.w - 0.14, 0.06, bed.d - 0.14), stdMat(0x3b2f23))
    soil.position.y = 0.44
    g.add(soil)
    const rand = rng(41)
    for (let i = 0; i < 12; i++) {
      const bush = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16 + rand() * 0.12, 0),
        stdMat(rand() > 0.5 ? 0x4f8b55 : 0x6da05c, { rough: 0.9 }),
      )
      bush.position.set((rand() - 0.5) * (bed.w - 0.5), 0.56 + rand() * 0.08, (rand() - 0.5) * (bed.d - 0.5))
      g.add(bush)
    }
    group.add(g)
  }

  /* ---- dining sets: one table and four chairs each ---------------------- */
  // Read straight from DINING_SETS, so the mesh, the collision footprints and the idle
  // spots cannot disagree about where a table is. Each chair is turned to LOOK at its own
  // table centre, which is the bug that once left half the meeting chairs back-to-front.
  for (const set of DINING_SETS) {
    const g = new THREE.Group()
    g.position.set(set.x, 0, set.z)
    g.rotation.y = set.facing
    // table top and a central pedestal
    const top = new THREE.Mesh(rbox(set.d, 0.06, set.w, 0.03), woodMat)
    top.position.y = 0.74
    top.castShadow = true
    g.add(top)
    const stem = cyl(0.07, 0.09, 0.72, 0x6f5334, 10, 0.2)
    stem.position.y = 0.37
    g.add(stem)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.05, 16), stdMat(0x5c4429, { rough: 0.7 }))
    foot.position.y = 0.025
    g.add(foot)
    group.add(g)

    // the four chairs, each rotated to face the table centre
    for (const c of diningChairs(set)) {
      const cg = new THREE.Group()
      cg.position.set(c.x, 0, c.z)
      cg.rotation.y = diningChairFacing(set, c.x, c.z)
      const seat = new THREE.Mesh(rbox(0.44, 0.07, 0.44, 0.02), woodMat)
      seat.position.y = 0.46
      seat.castShadow = true
      cg.add(seat)
      // the back rest, at local +z — which is why the chair LOOKS along local -z
      const back = new THREE.Mesh(rbox(0.44, 0.5, 0.06, 0.02), woodMat)
      back.position.set(0, 0.73, 0.19)
      back.castShadow = true
      cg.add(back)
      for (const [lx, lz] of [
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ] as const) {
        const leg = box(0.05, 0.46, 0.05, 0x6f5334, { rough: 0.7 })
        leg.position.set(lx, 0.23, lz)
        cg.add(leg)
      }
      group.add(cg)
    }
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

  /* ------------------------------- under the second floor: the terrace --- */
  // The covered floor beneath the executive slab. Placed from TERRACE_PROPS so the mesh and
  // the footprint cannot drift.
  for (const tp of TERRACE_PROPS) {
    const tg = new THREE.Group()
    tg.position.set(tp.x, 0, tp.z)
    if (tp.facing !== undefined) tg.rotation.y = tp.facing
    const W = tp.hw * 2 // width in the piece's own LOCAL x
    const D = tp.hd * 2 // depth in its own LOCAL z
    switch (tp.kind) {
      case 'sofa': {
        const seat = new THREE.Mesh(rbox(W, 0.34, D - 0.12, 0.06), stdMat(0x7d8f6a, { rough: 0.95 }))
        seat.position.y = 0.28
        tg.add(seat)
        const back = new THREE.Mesh(rbox(W, 0.5, 0.22, 0.06), stdMat(0x7d8f6a, { rough: 0.95 }))
        back.position.set(0, 0.6, tp.hd - 0.11)
        tg.add(back)
        for (const ax of [-tp.hw + 0.13, tp.hw - 0.13]) {
          const arm = new THREE.Mesh(rbox(0.24, 0.4, D - 0.12, 0.06), stdMat(0x6f8060, { rough: 0.95 }))
          arm.position.set(ax, 0.48, 0)
          tg.add(arm)
        }
        for (const [lx, lz] of [
          [-tp.hw + 0.14, -tp.hd + 0.14],
          [tp.hw - 0.14, -tp.hd + 0.14],
          [-tp.hw + 0.14, tp.hd - 0.14],
          [tp.hw - 0.14, tp.hd - 0.14],
        ] as const) {
          const foot = cyl(0.03, 0.03, 0.14, 0x5a4a34, 8)
          foot.position.set(lx, 0.07, lz)
          tg.add(foot)
        }
        break
      }
      case 'lowtable': {
        const top = new THREE.Mesh(rbox(W, 0.05, D, 0.03), woodMat)
        top.position.y = tp.h
        tg.add(top)
        for (const [lx, lz] of [
          [-tp.hw + 0.12, -tp.hd + 0.12],
          [tp.hw - 0.12, -tp.hd + 0.12],
          [-tp.hw + 0.12, tp.hd - 0.12],
          [tp.hw - 0.12, tp.hd - 0.12],
        ] as const) {
          const leg = cyl(0.025, 0.025, tp.h, 0x6b4423, 8)
          leg.position.set(lx, tp.h / 2, lz)
          tg.add(leg)
        }
        break
      }
      case 'longtable': {
        const top = new THREE.Mesh(rbox(W, 0.07, D, 0.03), woodMat)
        top.position.y = tp.h
        tg.add(top)
        for (const tz of [-tp.hd + 0.5, tp.hd - 0.5]) {
          for (const tx of [-tp.hw + 0.16, tp.hw - 0.16]) {
            const leg = box(0.1, tp.h - 0.06, 0.1, 0x8a9096, { metal: 0.4, rough: 0.5 })
            leg.position.set(tx, (tp.h - 0.06) / 2, tz)
            tg.add(leg)
          }
        }
        break
      }
      case 'tbench': {
        const top = new THREE.Mesh(rbox(W, 0.06, D, 0.03), stdMat(0x9c7a52, { rough: 0.8 }))
        top.position.y = tp.h
        tg.add(top)
        for (const tz of [-tp.hd + 0.3, 0, tp.hd - 0.3]) {
          for (const tx of [-tp.hw + 0.1, tp.hw - 0.1]) {
            const leg = cyl(0.022, 0.022, tp.h, 0x6b4423, 8)
            leg.position.set(tx, tp.h / 2, tz)
            tg.add(leg)
          }
        }
        break
      }
      case 'workbar': {
        const body = box(W, tp.h - 0.06, D, 0x6f5a44, { rough: 0.85 })
        body.position.y = (tp.h - 0.06) / 2
        tg.add(body)
        const top = new THREE.Mesh(rbox(W + 0.08, 0.06, D + 0.1, 0.03), marbleMat)
        top.position.y = tp.h - 0.03
        tg.add(top)
        // a few power sockets along the bar's front face
        for (let i = 0; i < 4; i++) {
          const sx = -W / 2 + (i + 0.5) * (W / 4)
          const sock = box(0.11, 0.09, 0.02, 0xe8e4d8, { rough: 0.5 })
          sock.position.set(sx, tp.h - 0.28, tp.hd + 0.005)
          tg.add(sock)
        }
        break
      }
      case 'stool': {
        const seat = new THREE.Mesh(
          new THREE.CylinderGeometry(tp.hw, tp.hw, 0.06, 16),
          stdMat(0x8f6f4a, { rough: 0.75 }),
        )
        seat.position.y = tp.h
        tg.add(seat)
        const stem = cyl(0.032, 0.045, tp.h, 0x8a8f95, 10, 0.6)
        stem.position.y = tp.h / 2
        tg.add(stem)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(tp.hw * 0.72, 0.018, 6, 16), stdMat(0x8a8f95, { metal: 0.6 }))
        ring.rotation.x = Math.PI / 2
        ring.position.y = 0.22
        tg.add(ring)
        const base = cyl(0.16, 0.18, 0.03, 0x8a8f95, 16, 0.6)
        base.position.y = 0.015
        tg.add(base)
        break
      }
      case 'locker': {
        // A bank of lockers: the cabinet, then door lines and handles.
        const body = box(W, tp.h, D, 0x4f6b7a, { rough: 0.6 })
        body.position.y = tp.h / 2
        tg.add(body)
        const doors = Math.max(2, Math.round(D / 0.45))
        for (let i = 0; i < doors; i++) {
          const dz = -tp.hd + (i + 0.5) * (D / doors)
          const line = box(0.012, tp.h - 0.12, 0.012, 0x2f3f48, { rough: 0.7 })
          line.position.set(-tp.hw + 0.005, tp.h / 2, dz - D / (2 * doors))
          tg.add(line)
          const handle = box(0.02, 0.1, 0.02, 0xd8d8d2, { metal: 0.7 })
          handle.position.set(-tp.hw - 0.01, tp.h / 2, dz + 0.12)
          tg.add(handle)
          // a vent at the top of each door
          for (let k = 0; k < 3; k++) {
            const vent = box(0.01, 0.02, 0.14, 0x2f3f48, { rough: 0.7 })
            vent.position.set(-tp.hw - 0.005, tp.h - 0.16 - k * 0.05, dz)
            tg.add(vent)
          }
        }
        break
      }
      case 'coffee': {
        // A coffee point: a machine on a small cabinet.
        const cab = box(W, 0.9, D, 0x6f5a44, { rough: 0.8 })
        cab.position.y = 0.45
        tg.add(cab)
        const cabTop = new THREE.Mesh(rbox(W + 0.05, 0.05, D + 0.05, 0.02), marbleMat)
        cabTop.position.y = 0.925
        tg.add(cabTop)
        const mg = box(0.34, 0.42, 0.32, 0x2f3438, { metal: 0.4, rough: 0.4 })
        mg.position.y = 1.16
        tg.add(mg)
        const head = box(0.28, 0.09, 0.24, 0x3d4449, { metal: 0.5 })
        head.position.set(0, 1.06, -0.13)
        tg.add(head)
        const tray = box(0.28, 0.03, 0.18, 0x9aa2a8, { metal: 0.7 })
        tray.position.set(0, 0.97, 0.12)
        tg.add(tray)
        const plate = box(0.28, 0.02, 0.24, 0x6f767c, { metal: 0.6 })
        plate.position.y = 1.38
        tg.add(plate)
        for (const cx of [-0.075, 0.075]) {
          const cup = cyl(0.033, 0.026, 0.07, 0xf2efe8, 12, 0.1)
          cup.position.set(cx, 1.42, 0)
          tg.add(cup)
        }
        break
      }
      case 'shelf': {
        const H = tp.h
        for (const sx of [-tp.hw + 0.03, tp.hw - 0.03]) {
          const side = box(0.06, H, D, 0x8f6f4a, { rough: 0.75 })
          side.position.set(sx, H / 2, 0)
          tg.add(side)
        }
        const back = box(W, H, 0.04, 0x7a5f3f, { rough: 0.8 })
        back.position.set(0, H / 2, -tp.hd + 0.02)
        tg.add(back)
        const levels = 4
        for (let i = 0; i < levels; i++) {
          const y = 0.14 + i * ((H - 0.28) / (levels - 1))
          const shelf = box(W, 0.04, D, 0x9c7a52, { rough: 0.7 })
          shelf.position.set(0, y, 0)
          tg.add(shelf)
          for (let k = 0; k < 2; k++) {
            const oz = -tp.hd + 0.3 + k * (D - 0.6)
            const oh = 0.16 + ((i + k) % 3) * 0.06
            const col = [0x4a6d8c, 0x8c6d4a, 0x6d8c4a][(i + k) % 3]
            const thing = box(0.18, oh, 0.12, col, { rough: 0.7 })
            thing.position.set(0, y + 0.02 + oh / 2, oz)
            tg.add(thing)
          }
        }
        break
      }
      case 'plant': {
        const pot = cyl(tp.hw * 0.72, tp.hw * 0.56, 0.4, 0x8c5a3f, 14, 0.1)
        pot.position.y = 0.2
        tg.add(pot)
        const soil = cyl(tp.hw * 0.66, tp.hw * 0.66, 0.03, 0x3a2a1e, 14)
        soil.position.y = 0.4
        tg.add(soil)
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2
          const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.62, 6), stdMat(0x3f6b3a, { rough: 0.9 }))
          leaf.position.set(Math.sin(a) * 0.12, 0.7, Math.cos(a) * 0.12)
          leaf.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4)
          tg.add(leaf)
        }
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), stdMat(0x4a7a42, { rough: 0.95 }))
        crown.position.y = 0.86
        tg.add(crown)
        break
      }
    }
    group.add(tg)
  }

  /* ------------------------------------------- division rooms' extra gear -- */
  // The furniture that makes each division room its own arrangement. Every piece is
  // placed from its ROOM_PROPS entry, so the mesh and the footprint cannot drift.
  for (const rp of ROOM_PROPS) {
    const rg = new THREE.Group()
    rg.position.set(rp.x, 0, rp.z)
    // `facing` is a LOOK direction (0 rad = +z), and these meshes put their "business end"
    // down their LOCAL -z: the camera's lens and the light's softbox are both built at
    // negative local z. Rotating by `facing + PI` is what turns that local -z into the world
    // aim, and it is MEASURED, not assumed: with `facing + PI` the softbox sits on the aim
    // side of its stand; with `facing` alone it sits on the far side, i.e. behind the stand,
    // which is what "lightning sekarang malah membelakangi" was.
    if (rp.facing !== undefined) rg.rotation.y = rp.facing + Math.PI
    switch (rp.kind) {
      case 'rack': {
        // A server rack: a dark cabinet with a glass front and blinking status lights.
        const body = box(rp.hw * 2, rp.h, rp.hd * 2, 0x20262b, { metal: 0.5, rough: 0.45 })
        body.position.y = rp.h / 2
        rg.add(body)
        const glass = box(rp.hw * 2 - 0.06, rp.h - 0.3, 0.04, 0x18242a, { emissive: 0x1d3b4a, ei: 0.5 })
        glass.position.set(0, rp.h / 2, rp.hd - 0.01)
        rg.add(glass)
        // server blades, each with two LEDs
        const units = Math.max(3, Math.floor((rp.h - 0.4) / 0.22))
        for (let i = 0; i < units; i++) {
          const y = 0.24 + i * 0.22
          const blade = box(rp.hw * 2 - 0.1, 0.16, 0.02, 0x2f373d, { rough: 0.6 })
          blade.position.set(0, y, rp.hd + 0.005)
          rg.add(blade)
          for (const [lx, col] of [
            [-rp.hw + 0.16, 0x4ad07a],
            [-rp.hw + 0.26, 0x4ad07a],
            [-rp.hw + 0.36, Math.random() > 0.5 ? 0x4ad07a : 0xd0a04a],
          ] as const) {
            const led = box(0.035, 0.035, 0.01, col, { emissive: col, ei: 1.0 })
            led.position.set(lx, y, rp.hd + 0.018)
            rg.add(led)
          }
        }
        break
      }
      case 'whiteboard': {
        // A whiteboard on the wall, with a tray and a couple of marker pens.
        const frame = box(0.06, rp.h, rp.hd * 2, 0xb9c4cb, { metal: 0.5, rough: 0.4 })
        frame.position.y = rp.h / 2 + 0.5
        rg.add(frame)
        const board = box(0.03, rp.h - 0.16, rp.hd * 2 - 0.16, 0xf4f4ee, { rough: 0.35 })
        board.position.set(0.03, rp.h / 2 + 0.5, 0)
        rg.add(board)
        const tray = box(0.14, 0.04, rp.hd * 2 - 0.2, 0x9aa2a8, { metal: 0.6 })
        tray.position.set(0.06, 0.52, 0)
        rg.add(tray)
        for (const [tz, col] of [
          [-0.5, 0xc23b2f],
          [-0.42, 0x2f5d3a],
        ] as const) {
          const pen = cyl(0.012, 0.012, 0.12, col, 8, 0.2)
          pen.rotation.z = Math.PI / 2
          pen.position.set(0.06, 0.56, tz)
          rg.add(pen)
        }
        break
      }
      case 'bench': {
        // A parts bench: a worktop on two trestles, with a tool board behind it and a
        // few boxes on the surface.
        const top = new THREE.Mesh(rbox(rp.hw * 2, 0.06, rp.hd * 2, 0.03), woodMat)
        top.position.y = rp.h
        rg.add(top)
        for (const tx of [-rp.hw + 0.18, rp.hw - 0.18]) {
          const trestle = box(0.12, rp.h, rp.hd * 1.5, 0x8a9096, { metal: 0.4, rough: 0.5 })
          trestle.position.set(tx, rp.h / 2, 0)
          rg.add(trestle)
        }
        // a pegboard behind, with a few tools hanging
        const peg = box(0.05, 0.9, rp.hd * 1.8, 0x9aa2a8, { rough: 0.7 })
        peg.position.set(-rp.hw + 0.1, rp.h + 0.55, 0)
        rg.add(peg)
        for (const [pz, ph] of [
          [-0.5, 0.26],
          [-0.1, 0.34],
          [0.3, 0.22],
          [0.6, 0.3],
        ] as const) {
          const tool = box(0.03, ph, 0.05, 0x3a4147, { metal: 0.5 })
          tool.position.set(-rp.hw + 0.16, rp.h + 0.55 - ph / 2 + 0.2, pz)
          rg.add(tool)
        }
        // a couple of parts boxes on top
        for (const [bx, bz, bw] of [
          [-0.1, -0.4, 0.3],
          [0.25, 0.35, 0.24],
        ] as const) {
          const b = box(bw, 0.18, bw * 0.8, 0x6f767c, { rough: 0.8 })
          b.position.set(bx, rp.h + 0.12, bz)
          rg.add(b)
        }
        break
      }
      case 'shelf': {
        // A tall shelf unit with five shelves and things on them.
        const H = rp.h
        const W = rp.hw * 2
        const D = rp.hd * 2
        for (const sx of [-rp.hw + 0.03, rp.hw - 0.03]) {
          const side = box(0.06, H, D, 0x8f6f4a, { rough: 0.75 })
          side.position.set(sx, H / 2, 0)
          rg.add(side)
        }
        const back = box(W, H, 0.04, 0x7a5f3f, { rough: 0.8 })
        back.position.set(0, H / 2, -rp.hd + 0.02)
        rg.add(back)
        const levels = 5
        for (let i = 0; i < levels; i++) {
          const y = 0.12 + i * ((H - 0.24) / (levels - 1))
          const shelf = box(W, 0.04, D, 0x9c7a52, { rough: 0.7 })
          shelf.position.set(0, y, 0)
          rg.add(shelf)
          // a few objects per shelf, deterministic per (i)
          const count = 2 + (i % 2)
          for (let k = 0; k < count; k++) {
            const oz = -rp.hd + 0.25 + k * ((D - 0.5) / Math.max(1, count - 1))
            const oh = 0.16 + ((i + k) % 3) * 0.06
            const col = [0x4a6d8c, 0x8c6d4a, 0x6d8c4a, 0x8c4a6d][(i + k) % 4]
            const thing = box(0.2, oh, 0.14, col, { rough: 0.7 })
            thing.position.set(0, y + 0.02 + oh / 2, oz)
            rg.add(thing)
          }
        }
        break
      }
      case 'screenwall': {
        // A video wall: a dark frame holding a 2x2 grid of screens, each lit.
        const W = rp.hw * 2
        const H = rp.h
        const frame = box(W, H, 0.1, 0x1b2226, { rough: 0.5 })
        frame.position.y = H / 2 + 0.5
        rg.add(frame)
        for (const [ox, oy] of [
          [-W / 4, H / 4],
          [W / 4, H / 4],
          [-W / 4, -H / 4],
          [W / 4, -H / 4],
        ] as const) {
          const scr = box(W / 2 - 0.08, H / 2 - 0.08, 0.02, 0x24343c, { emissive: 0x2a4a5a, ei: 0.75 })
          scr.position.set(ox, H / 2 + 0.5 + oy, 0.06)
          rg.add(scr)
        }
        // a slim stand under it
        const stand = box(W * 0.5, 0.06, 0.36, 0x2a2f34, { metal: 0.5 })
        stand.position.y = 0.5
        rg.add(stand)
        for (const lx of [-W * 0.2, W * 0.2]) {
          const leg = cyl(0.03, 0.03, 0.5, 0x3a4147, 8, 0.7)
          leg.position.set(lx, 0.25, 0)
          rg.add(leg)
        }
        break
      }
      case 'nook': {
        // A low round table with two soft tub chairs — the discussion nook.
        const topm = cyl(rp.hw, rp.hw, 0.05, 0x8f6f4a, 22, 0.1)
        topm.position.y = rp.h
        rg.add(topm)
        const stem = cyl(0.06, 0.09, rp.h, 0x6d7378, 10, 0.5)
        stem.position.y = rp.h / 2
        rg.add(stem)
        const base = cyl(0.28, 0.32, 0.04, 0x6d7378, 16, 0.5)
        base.position.y = 0.02
        rg.add(base)
        // Two tub chairs either side, in a soft colour, TURNED TO FACE THE TABLE.
        //
        // The two rotations were swapped, so both chairs had their BACKRESTS toward the
        // table — reported as "there is a chair positioned with its back to the table".
        //
        // The chair mesh puts its backrest at local +z. For the sitter to face the table, the
        // backrest must land on the far side, so the west chair's backrest must point WEST
        // (-x, rotation -pi/2) and the east chair's EAST (+x, rotation +pi/2). Measured:
        //   rot +pi/2 -> backrest world dir (+1, 0)   <- what the west chair had: at the table
        //   rot -pi/2 -> backrest world dir (-1, 0)   <- correct for the west chair
        for (const [cxx, czz, rot] of [
          [-0.95, 0, -Math.PI / 2],
          [0.95, 0, Math.PI / 2],
        ] as const) {
          const cg = new THREE.Group()
          cg.position.set(cxx, 0, czz)
          cg.rotation.y = rot
          const cs = new THREE.Mesh(rbox(0.62, 0.14, 0.6, 0.06), stdMat(0x8c6d5a, { rough: 0.95 }))
          cs.position.y = 0.42
          cg.add(cs)
          const cb = new THREE.Mesh(rbox(0.62, 0.5, 0.14, 0.06), stdMat(0x8c6d5a, { rough: 0.95 }))
          cb.position.set(0, 0.66, 0.23)
          cg.add(cb)
          for (const [lx, lz] of [
            [-0.24, -0.22],
            [0.24, -0.22],
            [-0.24, 0.22],
            [0.24, 0.22],
          ] as const) {
            const cl = cyl(0.025, 0.025, 0.42, 0x6b4423, 8)
            cl.position.set(lx, 0.21, lz)
            cg.add(cl)
          }
          rg.add(cg)
        }
        break
      }
      case 'backdrop': {
        // A shoot backdrop: a paper roll on a frame, pulled down to the floor.
        const W = rp.hw * 2
        const H = rp.h
        for (const sx of [-rp.hw + 0.08, rp.hw - 0.08]) {
          const post = cyl(0.035, 0.035, H, 0x3a4147, 8, 0.7)
          post.position.set(sx, H / 2, 0)
          rg.add(post)
        }
        const cross = cyl(0.045, 0.045, W, 0x3a4147, 10, 0.7)
        cross.rotation.z = Math.PI / 2
        cross.position.y = H
        rg.add(cross)
        // the roll: a wide sheet falling to the floor
        const sheet = box(W - 0.16, H - 0.1, 0.02, 0xe8e4d8, { rough: 0.95 })
        sheet.position.set(0, (H - 0.1) / 2, 0)
        rg.add(sheet)
        // a soft tint across the top, so it reads as a photo backdrop
        const tint = box(W - 0.16, H * 0.42, 0.015, 0xbfc9d4, { rough: 0.9 })
        tint.position.set(0, H - 0.1 - (H * 0.42) / 2, 0.02)
        rg.add(tint)
        break
      }
      case 'tripod': {
        // A CAMERA on a tripod, built from explicit POINTS so the orientation cannot be
        // guessed wrong.
        //
        // Two reports, both correct, and both from hand-rolled angles:
        //
        //   1. "the tripod legs are upside down". The legs were cylinders placed at
        //      `y = H*0.28` with a length of `H*0.78`, so two thirds of every leg was BELOW
        //      the floor, and the splay was inverted.
        //   2. Still wrong after the first fix: I positioned the legs correctly (foot far
        //      out, hub narrow) but oriented them with a hand-written `rotation.z`/`x` pair.
        //      Euler angles COMPOSE, so tilting by both does not point the cylinder along the
        //      foot->hub vector — the legs stayed splayed outward going up.
        //
        // The fix is to stop writing angles: each leg now gets a direction vector and a
        // quaternion, so its axis IS the foot->hub line by construction.
        const H = rp.h
        const hubY = H * 0.62
        const footR = 0.42
        const hubR = 0.06
        const up = new THREE.Vector3(0, 1, 0)
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + Math.PI / 6
          const foot = new THREE.Vector3(Math.sin(a) * footR, 0, Math.cos(a) * footR)
          const hub = new THREE.Vector3(Math.sin(a) * hubR, hubY, Math.cos(a) * hubR)
          const dir = new THREE.Vector3().subVectors(hub, foot)
          const len = dir.length()
          const leg = cyl(0.016, 0.022, len, 0x2f373d, 8, 0.6)
          leg.position.copy(foot).addScaledVector(dir, 0.5)
          leg.quaternion.setFromUnitVectors(up, dir.clone().normalize())
          rg.add(leg)
          // a foot pad ON THE FLOOR under each leg, so it clearly stands on something
          const pad = cyl(0.034, 0.038, 0.03, 0x1b2226, 10, 0.3)
          pad.position.copy(foot).setY(0.015)
          rg.add(pad)
        }
        // the column, ON THE AXIS from the hub up
        const column = cyl(0.028, 0.03, H * 0.4, 0x2f373d, 10, 0.6)
        column.position.set(0, hubY + H * 0.14, 0)
        rg.add(column)
        // THE CAMERA, dead centre on the column's axis
        const camY = hubY + H * 0.34
        const cam = box(0.24, 0.16, 0.18, 0x1b2226, { rough: 0.45 })
        cam.position.set(0, camY, 0)
        rg.add(cam)
        // the lens points at the set (-z), on the same axis
        const lens = cyl(0.055, 0.06, 0.12, 0x14181b, 14, 0.5)
        lens.rotation.x = Math.PI / 2
        lens.position.set(0, camY, -0.14)
        rg.add(lens)
        // a small monitor, centred on the axis and tipped toward the operator
        const mon = box(0.16, 0.12, 0.02, 0x24343c, { emissive: 0x2a4a5a, ei: 0.6 })
        mon.position.set(0, camY - 0.02, 0.13)
        mon.rotation.x = -0.35
        rg.add(mon)
        break
      }
      case 'lightstand': {
        // A STUDIO LIGHT: legs FOOT-to-HUB (the right way up), a riser, and a softbox that
        // throws down the group's local -z, aimed by `facing`.
        //
        // Reported: "tripod untuk lightning kakinya masih terbalik" and "lightning tidak
        // menghadap background". A light is not a camera, so it is its own kind — and its
        // legs get the same foot->hub quaternion construction as the camera tripod's, because
        // hand-written Euler angles COMPOSE and do not point a cylinder where you expect.
        const H = rp.h
        const hubY = H * 0.45
        const footR = 0.38
        const hubR = 0.05
        const up = new THREE.Vector3(0, 1, 0)
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + Math.PI / 6
          const foot = new THREE.Vector3(Math.sin(a) * footR, 0, Math.cos(a) * footR)
          const hub = new THREE.Vector3(Math.sin(a) * hubR, hubY, Math.cos(a) * hubR)
          const dir = new THREE.Vector3().subVectors(hub, foot)
          const leg = cyl(0.015, 0.02, dir.length(), 0x3a4147, 8, 0.6)
          leg.position.copy(foot).addScaledVector(dir, 0.5)
          leg.quaternion.setFromUnitVectors(up, dir.clone().normalize())
          rg.add(leg)
          const pad = cyl(0.03, 0.034, 0.028, 0x1b2226, 10, 0.3)
          pad.position.copy(foot).setY(0.014)
          rg.add(pad)
        }
        const riser = cyl(0.026, 0.028, H * 0.62, 0x3a4147, 10, 0.6)
        riser.position.y = hubY + H * 0.31
        rg.add(riser)
        // the head: a short arm reaching FORWARD (-z), then the softbox.
        //
        // THE SOFTBOX MUST GLOW TOWARD THE SET. Reported as "lightningnya masih sama aja
        // kebalik": the plate was in the right PLACE — offset toward the aim — but its lit
        // face pointed the other way, so it shone off the back of the stand. Measured on the
        // built mesh: the face normal dotted -0.96 against the direction to the backdrop.
        //
        // The rim is built as a dark plate just BEHIND the white one, and a white emissive
        // face behind a dark rim reads as "off". Putting the rim on the far side of the panel
        // (local +z, i.e. further from the aim) makes the white face the one that shows.
        const headY = H * 0.92
        const arm = cyl(0.02, 0.02, 0.26, 0x3a4147, 8, 0.6)
        arm.rotation.x = Math.PI / 2
        arm.position.set(0, headY, -0.13)
        rg.add(arm)
        const panel = box(0.72, 0.72, 0.05, 0xf4efe2, { emissive: 0xfff0d0, ei: 0.85 })
        panel.position.set(0, headY, -0.30)
        panel.rotation.x = -0.3
        rg.add(panel)
        // the rim BEHIND the panel (local +z is toward the stand, away from the aim), so the
        // white face — not the dark frame — is what points at the set
        const rim = box(0.78, 0.78, 0.03, 0x2f373d, { rough: 0.5 })
        rim.position.set(0, headY, -0.255)
        rim.rotation.x = -0.3
        rg.add(rim)
        break
      }
      case 'plant': {
        // A pot with a bush, so every room has something alive in it.
        const pot = cyl(rp.hw * 0.7, rp.hw * 0.55, 0.4, 0x8c5a3f, 14, 0.1)
        pot.position.y = 0.2
        rg.add(pot)
        const soil = cyl(rp.hw * 0.65, rp.hw * 0.65, 0.03, 0x3a2a1e, 14)
        soil.position.y = 0.4
        rg.add(soil)
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2
          const leaf = new THREE.Mesh(
            new THREE.ConeGeometry(0.12, 0.62, 6),
            stdMat(0x3f6b3a, { rough: 0.9 }),
          )
          leaf.position.set(Math.sin(a) * 0.12, 0.7, Math.cos(a) * 0.12)
          leaf.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4)
          rg.add(leaf)
        }
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), stdMat(0x4a7a42, { rough: 0.95 }))
        crown.position.y = 0.86
        rg.add(crown)
        break
      }
    }
    group.add(rg)
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
    // COUNTER along the wall — SHORTER than it used to be, and offset south.
    //
    // It was 6.4 m long centred on PANTRY.z, so it ran z 4.8..11.2 and the fridge (a
    // 0.8 m deep box at z 4.6..5.4, 1.9 m TALL) sat inside that run: the fridge was
    // half-buried in the counter and the taller body swallowed the shorter one. Reported
    // as "the fridge seems to be clashing with the counter".
    //
    // Now the counter runs PANTRY_COUNTER.z1..z2, which starts south of the fridge with a
    // clear gap, measured from the same constants the footprints and the self-test read.
    const len = PANTRY_COUNTER.z2 - PANTRY_COUNTER.z1
    const cz = PANTRY_COUNTER.z1 + len / 2
    const body = box(0.9, 0.9, len, 0xe8e2d4, { rough: 0.85 })
    body.position.set(0, 0.45, cz - PANTRY.z)
    g.add(body)
    const top = new THREE.Mesh(rbox(1.0, 0.08, len + 0.1, 0.04), marbleMat)
    top.position.set(0, 0.94, cz - PANTRY.z)
    g.add(top)
    // sink: a recessed box with a tap
    const sink = box(0.7, 0.14, 0.9, 0xb9c4cb, { metal: 0.7, rough: 0.3 })
    sink.position.set(0, 0.9, PANTRY_SINK_Z - PANTRY.z)
    g.add(sink)
    const tap = cyl(0.03, 0.03, 0.4, 0xcfd6da, 8, 0.9)
    tap.position.set(-0.28, 1.15, PANTRY_SINK_Z - PANTRY.z)
    g.add(tap)
    // FRIDGE at the north end, NORTH of the counter's end, so the two never overlap.
    // The counter starts at PANTRY_COUNTER.z1 and the fridge ends before it.
    const fridge = box(0.85, 1.9, 0.8, 0xd7dee2, { metal: 0.4, rough: 0.35 })
    fridge.position.set(0, 0.95, FRIDGE.z - PANTRY.z)
    g.add(fridge)
    // wall shelves
    for (let i = 0; i < 3; i++) {
      const shelf = box(0.4, 0.05, len - 0.4, 0x8f6f4a, { rough: 0.7 })
      shelf.position.set(-0.55, 1.35 + i * 0.42, cz - PANTRY.z)
      g.add(shelf)
    }
    // WATER COOLER: a dispenser with a full bottle on top, at the south end of the
    // counter. `PANTRY.z + 3.6` is clear of the counter's own footprint (which ends at
    // z 11.2) and of the wall, and the bottle is translucent so it reads as water.
    {
      const cg = new THREE.Group()
      // RELATIVE to `g`, which is already at (PANTRY.x, 0, PANTRY.z). Setting the WORLD z
      // here put the cooler at z = 8 + 11.8 = 19.8 — inside the pantry's south wall, where
      // nothing could see it. Caught by probing the live scene for meshes near the constant.
      cg.position.set(WATER_COOLER.x - PANTRY.x, 0, WATER_COOLER.z - PANTRY.z)
      const body = box(0.42, 1.05, 0.42, 0xe4e8ea, { metal: 0.3, rough: 0.35 })
      body.position.y = 0.52
      cg.add(body)
      // the tap recess
      const tap = cyl(0.035, 0.035, 0.16, 0x9aa2a8, 10, 0.8)
      tap.rotation.x = Math.PI / 2
      tap.position.set(0, 0.72, -0.24)
      cg.add(tap)
      // the bottle: translucent blue, sitting in the collar
      const collar = cyl(0.11, 0.13, 0.1, 0xcfd6da, 14, 0.3)
      collar.position.y = 1.09
      cg.add(collar)
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.15, 0.44, 16),
        new THREE.MeshStandardMaterial({
          color: 0x6fb6d8,
          transparent: true,
          opacity: 0.55,
          roughness: 0.25,
        }),
      )
      bottle.position.y = 1.36
      cg.add(bottle)
      const neck = cyl(0.07, 0.09, 0.09, 0x6fb6d8, 12, 0.2)
      neck.position.y = 1.12
      cg.add(neck)
      g.add(cg)
    }
    // COFFEE MACHINE, on the counter top. Its drip tray, group head and a warming plate
    // on top, so it reads as a machine rather than as a box.
    {
      const mg = new THREE.Group()
      mg.position.set(0, 0.98, PANTRY_COFFEE_Z - PANTRY.z)
      const body = box(0.36, 0.44, 0.34, 0x2f3438, { metal: 0.4, rough: 0.4 })
      body.position.y = 0.22
      mg.add(body)
      const head = box(0.3, 0.1, 0.26, 0x3d4449, { metal: 0.5, rough: 0.35 })
      head.position.set(0, 0.12, -0.14)
      mg.add(head)
      const tray = box(0.3, 0.03, 0.2, 0x9aa2a8, { metal: 0.7, rough: 0.3 })
      tray.position.set(0, 0.03, 0.13)
      mg.add(tray)
      const plate = box(0.3, 0.02, 0.26, 0x6f767c, { metal: 0.6, rough: 0.4 })
      plate.position.y = 0.45
      mg.add(plate)
      // two cups on the warming plate
      for (const cx of [-0.08, 0.08]) {
        const cup = cyl(0.035, 0.028, 0.07, 0xf2efe8, 12, 0.1)
        cup.position.set(cx, 0.49, 0)
        mg.add(cup)
      }
      g.add(mg)
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
    // THE SCREEN HAS TWO STATES. Idle is the cool standby glow; the race feed switches on
    // while any driver is on a rig, driven from the scene's frame loop. The material is
    // allocated once and only its map/emissive are swapped, so nothing re-allocates per frame.
    tvScreen = box(1.7, 0.9, 0.02, 0x24343c, { emissive: 0x2a4a5a, ei: 0.6 })
    tvScreen.position.set(LOUNGE_TV.x, LOUNGE_TV.y, LOUNGE_TV.z + 0.06)
    tvScreen.name = 'lounge-tv-screen'
    {
      const tvMat = tvScreen.material as THREE.MeshStandardMaterial
      tvIdleEmissive = tvMat.emissive.getHex()
      tvIdleIntensity = tvMat.emissiveIntensity
    }
    group.add(tvScreen)
  }

  /* -------------------------------------------------------- darts / racing -- */
  // The rec stations. Each is placed from its LAYOUT constant, so the mesh, its footprint
  // and the idle spot that uses it can never drift apart.
  {
    // ---- DARTBOARD -------------------------------------------------------------
    // Flat on the east wall, bullseye at 1.73 m, with a surround and a small scorer.
    {
      const dg = new THREE.Group()
      dg.position.set(DARTBOARD.x, 0, DARTBOARD.z)
      // the surround backing, so the board is not a floating disc
      const back = box(0.06, DARTBOARD.r * 2.4, DARTBOARD.r * 2.4, 0x1e2428, { rough: 0.7 })
      back.position.y = DARTBOARD.y
      dg.add(back)
      // the board face: concentric rings, dark and light, from the wall outward
      const rings: [number, number][] = [
        [1.0, 0x14100c],
        [0.62, 0xe8e0cc],
        [0.42, 0x14100c],
        [0.16, 0xe8c04a],
        [0.07, 0xc23b2f],
      ]
      for (const [frac, col] of rings) {
        const disc = cyl(DARTBOARD.r * frac, DARTBOARD.r * frac, 0.015, col, 24, 0.2)
        disc.rotation.z = Math.PI / 2
        disc.position.x = -0.045
        disc.position.y = DARTBOARD.y
        dg.add(disc)
      }
      // a small scoreboard above the board
      const sb = box(0.03, 0.24, 0.4, 0x2a2f34, { rough: 0.6 })
      sb.position.set(-0.03, DARTBOARD.y + DARTBOARD.r + 0.34, 0)
      dg.add(sb)
      const sbFace = box(0.005, 0.17, 0.32, 0x0b1418, { emissive: 0x224a3a, ei: 0.5 })
      sbFace.position.set(-0.05, DARTBOARD.y + DARTBOARD.r + 0.34, 0)
      dg.add(sbFace)
      group.add(dg)
      // the oche line on the floor, so the throw position is legible
      const oche = box(0.02, 0.004, 1.4, 0xc8b070, { rough: 0.6 })
      oche.position.set(DART_THROW.x + 0.4, 0.008, DART_THROW.z)
      group.add(oche)
    }

    // ---- RACING SIMULATORS (four) ----------------------------------------------
    // A bucket seat, a wheel on a column, a pedal box and a screen each, all facing NORTH.
    // Built from RACING_RIGS, so the bay, its four footprints and the four drivers can never
    // disagree about where a rig stands.
    for (const rig of RACING_RIGS) {
      const rg = new THREE.Group()
      rg.position.set(rig.x, 0, rig.z)
      rg.rotation.y = rig.facing
      // the seat base + back + side bolsters, in a dark racing red
      const seat = new THREE.Mesh(rbox(0.52, 0.12, 0.5, 0.04), stdMat(0x8f2f2f, { rough: 0.8 }))
      seat.position.y = RACING_SEAT_H
      rg.add(seat)
      const back = new THREE.Mesh(rbox(0.52, 0.62, 0.12, 0.04), stdMat(0x8f2f2f, { rough: 0.8 }))
      back.position.set(0, RACING_SEAT_H + 0.31, 0.24)
      rg.add(back)
      for (const bx of [-0.24, 0.24]) {
        const bolster = new THREE.Mesh(rbox(0.07, 0.4, 0.42, 0.03), stdMat(0x7a2727, { rough: 0.8 }))
        bolster.position.set(bx, RACING_SEAT_H + 0.1, 0.02)
        rg.add(bolster)
      }
      // the seat pedestal
      const ped = cyl(0.06, 0.09, RACING_SEAT_H, 0x3a3f45, 10, 0.7)
      ped.position.y = RACING_SEAT_H / 2
      rg.add(ped)
      // ---- the wheel column, and the wheel that sits on its DRIVER-side end -----------
      //
      // The rig faces local -z, so the DRIVER sits at z 0 and the pedals/monitor are at
      // negative z. The column therefore leans with its TOP toward the driver (+z) and its
      // BASE toward the pedals.
      //
      // Reported: "posisi setir pada rig simulator itu kebalik bro, malah ada di belakang
      // tiangnya (kearah monitor) bukan kearah kursi". Measured on the built mesh: the
      // column runs from z -0.664 (base, at the pedals) to z -0.376 (top, at the driver),
      // and the wheel was bolted at z -0.66 — the BASE end. So the wheel sat on the far side
      // of the column with nothing on the driver's end.
      //
      // The wheel is now placed FROM the column's top itself, never from a literal, so the
      // two cannot drift apart again.
      const COL_LEN = 0.6
      const COL_TILT = 0.5
      /** The column's centre in the rig's local space. */
      const COL_MID = { y: 0.62, z: -0.52 }
      // The cylinder's axis is its local +Y, so a tilt of COL_TILT sends the TOP to
      // (0, cos, sin) * half-length — i.e. up and toward the driver.
      const colTop = {
        y: COL_MID.y + Math.cos(COL_TILT) * (COL_LEN / 2),
        z: COL_MID.z + Math.sin(COL_TILT) * (COL_LEN / 2),
      }
      const column = cyl(0.035, 0.035, COL_LEN, 0x3a3f45, 10, 0.7)
      column.rotation.x = COL_TILT
      column.position.set(0, COL_MID.y, COL_MID.z)
      rg.add(column)
      // The wheel: a ring plus a hub, seated ON the column's top and facing the driver. A
      // torus lies in its own XY plane with its axis along +Z, so `COL_TILT - PI/2` turns
      // that axis onto the column's — the wheel is perpendicular to the column, which is
      // what a real rack is, instead of lying across it.
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 24), stdMat(0x1c1f24, { rough: 0.5 }))
      wheel.rotation.x = COL_TILT - Math.PI / 2
      wheel.position.set(0, colTop.y, colTop.z)
      rg.add(wheel)
      const hub = cyl(0.055, 0.055, 0.04, 0x2a2f34, 12, 0.5)
      hub.rotation.x = COL_TILT
      hub.position.set(0, colTop.y, colTop.z)
      rg.add(hub)
      // the pedal box, on the floor ahead
      const pedals = box(0.34, 0.09, 0.26, 0x2a2f34, { metal: 0.4, rough: 0.5 })
      pedals.position.set(0, 0.05, -1.02)
      rg.add(pedals)
      for (const px of [-0.09, 0.09]) {
        const pad = box(0.1, 0.03, 0.14, 0x9aa2a8, { metal: 0.7, rough: 0.3 })
        pad.position.set(px, 0.1, -1.0)
        rg.add(pad)
      }
      // the screen on a post, ahead of the wheel
      const post = cyl(0.03, 0.03, 1.1, 0x3a3f45, 8, 0.7)
      post.position.set(0, 0.55, -1.5)
      rg.add(post)
      const scr = box(1.1, 0.62, 0.05, 0x1b2226, { metal: 0.3, rough: 0.3 })
      scr.position.set(0, 1.24, -1.52)
      rg.add(scr)
      const scrFace = box(1.02, 0.54, 0.02, 0x24343c, { emissive: 0x3a5a6a, ei: 0.7 })
      scrFace.position.set(0, 1.24, -1.49)
      rg.add(scrFace)
      // a floor mat, so the rig reads as a station rather than loose props
      const mat = box(1.4, 0.01, 2.6, 0x24282c, { rough: 0.95 })
      mat.position.set(0, 0.006, -0.5)
      rg.add(mat)
      group.add(rg)
    }
  }

  /* ------------------------------------------------------------------ bowling -- */
  // One shortened arcade lane in the lounge's south half, aimed EAST: the bowler stands at the
  // west end and throws east. Everything is placed from BOWLING, so the surface, the pins, the
  // foul line and the bowler's idle spot cannot disagree about where the lane is — the same
  // rule as the rec gear above, and for the same reason.
  {
    const laneLen = BOWLING.xEnd - BOWLING.xFoul
    const midX = (BOWLING.xFoul + BOWLING.xEnd) / 2
    const halfW = BOWLING.w / 2

    // The playing surface. The boards must run its LENGTH (now x), so the texture draws its
    // seams along the canvas X axis; the repeat's Y counts boards ACROSS the lane.
    const laneTex = track(laneTexture())
    laneTex.repeat.set(laneLen / 2.4, 39 / 16)
    const surface = new THREE.Mesh(
      new THREE.BoxGeometry(laneLen, 0.06, BOWLING.w),
      new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.22, metalness: 0.05 }),
    )
    surface.position.set(midX, BOWLING.y - 0.03, BOWLING.z)
    surface.receiveShadow = true
    group.add(surface)

    // gutters: a channel each side (now either side in z), dropped below the boards, with an
    // outer wall so it reads as a channel rather than as a painted stripe
    for (const side of [-1, 1]) {
      const floor = box(laneLen, 0.05, BOWLING.gutter, 0x4a5158, { rough: 0.55 })
      floor.position.set(midX, -0.02, BOWLING.z + side * (halfW + BOWLING.gutter / 2))
      group.add(floor)
      const wall = box(laneLen, 0.18, 0.05, 0x2b3138, { rough: 0.5 })
      wall.position.set(midX, -0.005, BOWLING.z + side * (halfW + BOWLING.gutter))
      group.add(wall)
    }

    // the approach, laid flush with the floor west of the foul line. Its depth is exactly the
    // lane plus its gutters: the lane's north edge is against the pantry wall, so an approach
    // any wider would disappear into that wall.
    const approach = box(1.4, 0.024, BOWLING.w + 2 * BOWLING.gutter, 0x9a8266, { rough: 0.85 })
    approach.position.set(BOWLING.xFoul - 0.7, 0.006, BOWLING.z)
    group.add(approach)

    // the foul line, and the seven aiming arrows. The arrows stagger: the centre sits deepest,
    // which is the shape a real lane uses to point you at the pocket.
    const foul = box(0.06, 0.014, BOWLING.w, 0x161c20, { rough: 0.6 })
    foul.position.set(BOWLING.xFoul + 0.04, BOWLING.y + 0.007, BOWLING.z)
    group.add(foul)
    for (const az of [-0.28, -0.19, -0.09, 0, 0.09, 0.19, 0.28]) {
      const arrow = box(0.1, 0.012, 0.035, 0x2b3138, { rough: 0.6 })
      arrow.position.set(BOWLING.xFoul + (4.9 - Math.abs(az) * 1.6), BOWLING.y + 0.006, BOWLING.z + az)
      group.add(arrow)
    }
    // a slightly darker deck under the pins, so the triangle is not floating on open boards
    const deck = box(1.0, 0.014, BOWLING.w, 0x8a6a44, { rough: 0.5 })
    deck.position.set(BOWLING.headPinX + 0.45, BOWLING.y + 0.005, BOWLING.z)
    group.add(deck)

    // the ten pins, from the one triangle definition: `across` offsets in z, `back` runs east
    // away from the bowler
    for (const [across, back] of PIN_OFFSETS) {
      const pin = new THREE.Group()
      pin.position.set(
        BOWLING.headPinX + back * BOWLING.pinSpacing,
        BOWLING.y,
        BOWLING.z + across * BOWLING.pinSpacing,
      )
      // body: fat at the belly, tapered to the neck
      const body = cyl(PIN_R * 0.6, PIN_R, PIN_H * 0.72, 0xf4f1e8, 12, 0)
      body.position.y = PIN_H * 0.36
      pin.add(body)
      const neck = cyl(PIN_R * 0.26, PIN_R * 0.6, PIN_H * 0.16, 0xf4f1e8, 12, 0)
      neck.position.y = PIN_H * 0.72 + PIN_H * 0.08
      pin.add(neck)
      const head = new THREE.Mesh(new THREE.SphereGeometry(PIN_R * 0.3, 12, 10), stdMat(0xf4f1e8, { rough: 0.42 }))
      head.position.y = PIN_H * 0.88 + PIN_R * 0.2
      pin.add(head)
      // the two red neck rings — what makes ten white sticks read as tenpins
      for (const ry of [PIN_H * 0.62, PIN_H * 0.7]) {
        const ring = cyl(PIN_R * 0.62, PIN_R * 0.62, 0.012, 0xc0392b, 14, 0)
        ring.position.y = ry
        pin.add(ring)
      }
      group.add(pin)
    }

    // the ball return: a rack beside the approach, on the NORTH side so the door path along
    // the south of the room stays clear
    const retX = BOWLING.xFoul - 0.1
    const retZ = BOWLING.z - (halfW + BOWLING.gutter + 0.36)
    const retBody = box(1.9, 0.9, 0.34, 0x2b3138, { metal: 0.35, rough: 0.45 })
    retBody.position.set(retX, 0.45, retZ)
    group.add(retBody)
    const retRail = box(1.9, 0.07, 0.32, 0x3d454d, { metal: 0.6, rough: 0.3 })
    retRail.position.set(retX, 0.935, retZ)
    group.add(retRail)
    for (const [i, rx] of [-0.56, 0, 0.56].entries()) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_R, 16, 12),
        stdMat([0x1d3f8f, 0xb03030, 0x2f7f4f][i], { rough: 0.3 }),
      )
      ball.position.set(retX + rx, 0.97 + BALL_R, retZ)
      group.add(ball)
    }

    // the score screen past the pin deck, its face turned WEST at the bowler, on two posts
    // clear of the lane. Its width is held inside the lane's: the lane's far edge is against
    // the pantry wall, so a screen any wider would bury a post in that wall.
    const scrY = BOWLING.y + 1.9
    const scrX = BOWLING.xEnd + 0.34
    for (const side of [-1, 1]) {
      const post = cyl(0.04, 0.04, scrY, 0x2b3138, 8, 0.6)
      post.position.set(scrX - 0.08, scrY / 2, BOWLING.z + side * 0.55)
      group.add(post)
    }
    const scrBody = box(0.06, 0.52, 1.3, 0x141a1f, { metal: 0.3, rough: 0.35 })
    scrBody.position.set(scrX, scrY, BOWLING.z)
    group.add(scrBody)
    const scrFace = box(0.02, 0.44, 1.2, 0x0e1620, { emissive: 0x2a5a8a, ei: 0.55 })
    scrFace.position.set(scrX - 0.04, scrY, BOWLING.z)
    group.add(scrFace)
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

  /**
   * The grill, alive: the fire flickers and the smoke rises.
   *
   * Each puff has its own offset in the loop, and rises about a metre before fading out
   * and starting again. The opacity is multiplied by the base the mesh was built with, so
   * the three puffs keep their graded faintness instead of all becoming equally solid.
   */
  function setRackBarVisible(visible: boolean) {
    for (const m of rackBarParts) m.visible = visible
  }

  function animateBbq(t: number) {
    if (bbqFire) {
      const mat = bbqFire.material as THREE.MeshStandardMaterial
      // two frequencies, so the flicker does not read as a sine wave
      mat.emissiveIntensity = 1.25 + Math.sin(t * 7.3) * 0.22 + Math.sin(t * 11.9) * 0.12
    }
    if (bbqGlow) {
      bbqGlow.intensity = 0.45 + Math.sin(t * 7.3) * 0.12 + Math.sin(t * 11.9) * 0.07
    }
    for (const [i, puff] of bbqSmoke.entries()) {
      const cycle = ((t * 0.22 + i * 0.33) % 1 + 1) % 1
      const base = 0.55 - i * 0.08
      const mat = puff.material as THREE.MeshBasicMaterial
      // fade in over the first fifth, out over the rest
      const fade = cycle < 0.2 ? cycle / 0.2 : 1 - (cycle - 0.2) / 0.8
      mat.opacity = base * Math.max(0, fade)
      puff.position.y = 1.45 + i * 0.34 + cycle * 0.9
      puff.position.x = -0.35 + (i - 1) * 0.12 + Math.sin(t * 0.6 + i) * 0.1
      const s = 0.8 + cycle * 0.9
      puff.scale.set(s, s * 0.85, s)
    }
  }

  /**
   * Switch the lounge TV between its standby glow and the live race feed.
   *
   * Driven from the scene's frame loop with whether ANY driver is on a rig. Kept idempotent
   * and allocation-free: the loop calls it every frame, so it early-returns unless the state
   * actually changed, and the feed texture is drawn once and reused.
   */
  let tvFeed: THREE.Texture | null = null
  let tvRacing = false
  function setTvRacing(on: boolean) {
    if (!tvScreen || on === tvRacing) return
    tvRacing = on
    const mat = tvScreen.material as THREE.MeshStandardMaterial
    if (on) {
      if (!tvFeed) tvFeed = track(racingFeedTexture())
      mat.map = tvFeed
      // the same texture drives the emissive, so the road and the HUD GLOW instead of sitting
      // as a dark decal on the standby-blue panel
      mat.emissiveMap = tvFeed
      mat.emissive.setHex(0xffffff)
      mat.emissiveIntensity = 0.95
    } else {
      mat.map = null
      mat.emissiveMap = null
      mat.emissive.setHex(tvIdleEmissive)
      mat.emissiveIntensity = tvIdleIntensity
    }
    // adding or removing a map changes the compiled program, so the material must recompile
    mat.needsUpdate = true
  }

  return {
    group,
    monitors,
    lamps,
    boardSurface: boardSurface as THREE.Mesh,
    streaks,
    streetGroup,
    animateStreet,
    animateBbq,
    setRackBarVisible,
    setTvRacing,
    sun,
    applyPalette,
    dispose,
  }
}
