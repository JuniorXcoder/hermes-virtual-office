/**
 * Furniture and environment builder — DEMOLISHED SHELL.
 *
 * The whole interior (outer walls, the oval aula, the division pods, desks,
 * chairs, conference table, lounge, pantry, reception, pool, garden, book nook,
 * windows, artwork, roof) has been removed on purpose so the office can be
 * rebuilt from scratch. What this file builds now is:
 *
 *   - an OPEN MARBLE FLOOR (no walls, no partitions, no furniture),
 *   - a FREE-STANDING Kanban board (the task wall is a feature, not furniture),
 *   - ceiling light panels (overhead fixtures, not furniture),
 *   - the sun/sky lighting rig,
 *   - the OUTSIDE world (earth, plaza, road, trees, neighbours, pedestrians,
 *     traffic) which is unchanged — it is not part of the building.
 *
 * `layout.ts` is the plan; it is empty, so there is nothing to collide with.
 * The rebuild re-populates `FOOTPRINTS` and draws the matching meshes here.
 */
import * as THREE from 'three'
import { marbleLight } from './materials'
import {
  CEILING_Y,
  FLOOR,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  paletteFor,
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
/*
 * Textures are procedural canvases rather than image files: the repo stays free
 * of binary assets. Only the surfaces the OUTSIDE world still uses are generated
 * here; the interior's wood, tile, plaster, fabric and screen textures went with
 * the furniture they belonged to.
 */

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  draw(ctx, size)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  return tex
}

/**
 * Turn a colour texture into a bump map.
 *
 * Deriving the bump from the luminance of a texture already generated costs one
 * small canvas and gives asphalt, pavement and soil an edge for the light to
 * catch instead of reading as flat paint.
 */
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
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  return tex
}

/** Deterministic pseudo-random so a texture looks the same on every reload. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Earth: rough ground for everything beyond the paved plaza.
 *
 * Deliberately low-frequency: the signal is in patches, clumps and broad tonal
 * drift, because fine noise turns into uniform mush once the mip chain averages it.
 */
function earthTexture(base: string, dark: string, light: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(211)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 26; i++) {
      const g = c.createRadialGradient(
        rand() * s, rand() * s, 8,
        rand() * s, rand() * s, 60 + rand() * 120,
      )
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

/** Asphalt with aggregate and lane wear. */
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
    for (let i = 0; i < 5; i++) {
      c.globalAlpha = 0.05
      c.fillStyle = '#1f2225'
      c.beginPath()
      c.ellipse(rand() * s, rand() * s, 20 + rand() * 50, 14 + rand() * 40, rand() * 3, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1
  })
}

/** Pavement slabs with expansion joints. */
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
    for (let i = 0; i < 1400; i++) {
      c.globalAlpha = 0.05
      c.fillStyle = rand() > 0.5 ? '#fff' : '#000'
      c.fillRect(rand() * s, rand() * s, 1.5, 1.5)
    }
    c.globalAlpha = 1
  })
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

  const asphaltTex = track(asphaltTexture('#5a5f63', '#8b9095'))
  asphaltTex.repeat.set(24, 3)
  const pavementTex = track(pavementTexture('#9aa0a4', '#7f868b'))
  const GROUND_EXTENT_HINT = 220
  const earthTex = track(earthTexture('#6b7a56', '#4d5a3e', '#8a9a6c'))
  earthTex.repeat.set(GROUND_EXTENT_HINT / 12, GROUND_EXTENT_HINT / 12)

  const earthBump = track(bumpFrom(earthTex, 0.55))
  earthBump.repeat.copy(earthTex.repeat)
  const asphaltBump = track(bumpFrom(asphaltTex, 0.7))
  const pavementBump = track(bumpFrom(pavementTex, 0.5))
  for (const [b, src] of [
    [asphaltBump, asphaltTex],
    [pavementBump, pavementTex],
  ] as const) {
    b.repeat.copy(src.repeat)
  }
  pavementTex.repeat.set(14, 14)

  /* ------------------------------------------------------------- floor --- */
  // Open marble floor. There is no lobby, no rooms and no rug — one surface.
  const marbleMat = track(marbleLight())
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.width, FLOOR.depth), marbleMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  group.add(floor)

  /* ------------------------------------------------------- kanban board --- */
  // Free-standing display board on the open floor (the walls it used to hang on
  // are gone). Held up by two posts; the card grid is pinned to `boardSurface`.
  const boardSurface = box(1.6, KANBAN_BOARD.h, 0.14, 0x14313f, {
    emissive: 0x0b3d2c,
    rough: 0.4,
  })
  boardSurface.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z)
  boardSurface.name = 'kanban-board'
  group.add(boardSurface)
  {
    // side panels, chord-aligned with the centre panel
    for (const sx of [-2.05, 2.05]) {
      const p = box(1.9, KANBAN_BOARD.h, 0.12, 0x14313f, { emissive: 0x0b3d2c, rough: 0.4 })
      p.position.set(sx, KANBAN_BOARD.y, KANBAN_BOARD.z + 0.2)
      p.rotation.y = sx < 0 ? 0.28 : -0.28
      group.add(p)
    }
  }
  const boardFrame = new THREE.Mesh(
    new THREE.BoxGeometry(KANBAN_BOARD.w + 0.24, KANBAN_BOARD.h + 0.24, 0.1),
    stdMat(0x2b3f49, { metal: 0.3, rough: 0.5 }),
  )
  boardFrame.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z - 0.06)
  group.add(boardFrame)
  // two posts down to the floor, so the board stands on its own
  const postBaseY = KANBAN_BOARD.y - KANBAN_BOARD.h / 2
  for (const px of [-KANBAN_BOARD.w / 2 + 0.3, KANBAN_BOARD.w / 2 - 0.3]) {
    const post = box(0.16, postBaseY, 0.16, 0x394f5b, { metal: 0.4 })
    post.position.set(KANBAN_BOARD.x + px, postBaseY / 2, KANBAN_BOARD.z - 0.02)
    group.add(post)
    const foot = box(0.5, 0.06, 0.5, 0x2b3f49, { metal: 0.3 })
    foot.position.set(KANBAN_BOARD.x + px, 0.03, KANBAN_BOARD.z - 0.02)
    group.add(foot)
  }
  // column dividers matching the four board columns
  for (let i = 1; i < 4; i++) {
    const div = box(0.04, KANBAN_BOARD.h - 0.5, 0.16, 0x1f5c46)
    div.position.set(
      KANBAN_BOARD.x - KANBAN_BOARD.w / 2 + (KANBAN_BOARD.w / 4) * i,
      KANBAN_BOARD.y,
      KANBAN_BOARD.z + 0.09,
    )
    group.add(div)
  }

  /* ----------------------------------------------------------- lighting --- */
  // Ambient RENDAH + sun KUAT = shadows + contrast. A washed-out rig produced no
  // visible shadow at all, and without a shadow nothing reads.
  scene.add(new THREE.AmbientLight(0xffffff, 0.22))
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.6)
  sun.position.set(26, 20, 16)
  scene.add(sun)
  const fill = new THREE.HemisphereLight(0xdfeaf7, 0x8a7a5f, 0.45)
  scene.add(fill)

  // Recessed ceiling panels: overhead fixtures, not furniture. They keep the open
  // floor lit and are the `streaks` the palette dims at night.
  const streaks: THREE.Mesh[] = []
  for (const cz of [-5.5, -1, 6.5, 10.5]) {
    const housing = box(FLOOR.width - 1.6, 0.12, 0.42, 0xd9dfe4, { metal: 0.25, rough: 0.5 })
    housing.position.set(0, CEILING_Y, cz)
    group.add(housing)
    const panel = box(FLOOR.width - 2.0, 0.04, 0.3, 0xffffff, { emissive: 0xfff4e0, ei: 1 })
    panel.position.set(0, CEILING_Y - 0.07, cz)
    group.add(panel)
    streaks.push(panel)
    const l = new THREE.PointLight(0xfff6e6, 0.55, 22)
    l.position.set(0, CEILING_Y - 0.3, cz)
    group.add(l)
  }

  /* -------------------------------------------------- outside environment -- */
  // The office sits in a street: pavement, road, trees and neighbouring blocks,
  // so zooming out does not reveal an empty void.
  const streetGroup = new THREE.Group()
  scene.add(streetGroup)

  /**
   * Ground: a wide, darker earth plane well beyond the furthest building, with the
   * paved plaza laid on top of it. One pale slab that stops dead reads as sky, not
   * as ground.
   */
  const GROUND_EXTENT = 220
  const earth = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_EXTENT, GROUND_EXTENT),
    new THREE.MeshStandardMaterial({
      color: 0x6f7a5e,
      map: earthTex,
      bumpMap: earthBump,
      bumpScale: 0.5,
      roughness: 1,
    }),
  )
  earth.rotation.x = -Math.PI / 2
  earth.position.y = -0.12
  earth.receiveShadow = true
  streetGroup.add(earth)

  const plazaW = 120
  const plazaD = 110
  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(plazaW, plazaD),
    new THREE.MeshStandardMaterial({
      map: pavementTex,
      bumpMap: pavementBump,
      bumpScale: 0.25,
      roughness: 0.95,
    }),
  )
  pavement.rotation.x = -Math.PI / 2
  pavement.position.set(0, -0.06, 6)
  pavement.receiveShadow = true
  streetGroup.add(pavement)

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 9),
    new THREE.MeshStandardMaterial({ map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.4, roughness: 0.98 }),
  )
  road.rotation.x = -Math.PI / 2
  road.position.set(0, -0.05, HALF_D + 14)
  streetGroup.add(road)
  // centre line + zebra crossing in front of the entrance
  for (let i = -8; i <= 8; i++) {
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
    const phase = Math.abs(x * 0.17 + z * 0.11)
    foliage.push({ group: t, phase })
  }
  for (const [tx, tz] of [
    [-20, 10],
    [-20, 2],
    [20, 10],
    [20, 2],
    [-13, 16.5],
    [13, 16.5],
    [-22, -6],
    [22, -6],
  ]) {
    tree(tx, tz, 1.2)
  }

  const building = (x: number, z: number, w: number, d: number, h: number, color: number) => {
    const b = box(w, h, d, color, { rough: 0.9 })
    b.position.set(x, h / 2, z)
    streetGroup.add(b)

    // Window grid on ALL FOUR faces, so neighbours do not read as blank slabs.
    const winMat = stdMat(0x8fb6cf, { emissive: 0x6f9cbb, ei: 0.5 })
    const frameMat2 = stdMat(0x6b7681, { metal: 0.2, rough: 0.6 })
    const rows = Math.max(2, Math.floor(h / 3))
    const colsX = Math.max(2, Math.floor(w / 2.6))
    const colsZ = Math.max(2, Math.floor(d / 2.6))

    const pane = (px: number, py: number, pz: number, alongX: boolean) => {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 1.3 : 0.08, 1.6, alongX ? 0.08 : 1.3),
        frameMat2,
      )
      frame.position.set(px, py, pz)
      streetGroup.add(frame)
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(alongX ? 1.1 : 0.05, 1.4, alongX ? 0.05 : 1.1),
        winMat,
      )
      glass.position.set(px, py, pz)
      streetGroup.add(glass)
    }

    for (let r = 1; r < rows; r++) {
      const py = 1.6 + r * (h / rows)
      for (let c = 0; c < colsX; c++) {
        const px = x - w / 2 + (w / colsX) * (c + 0.5)
        pane(px, py, z - d / 2 - 0.06, true)
        pane(px, py, z + d / 2 + 0.06, true)
      }
      for (let c = 0; c < colsZ; c++) {
        const pz = z - d / 2 + (d / colsZ) * (c + 0.5)
        pane(x - w / 2 - 0.06, py, pz, false)
        pane(x + w / 2 + 0.06, py, pz, false)
      }
    }
    // roof parapet so the skyline is not a bare box
    const parapet = box(w + 0.4, 0.5, d + 0.4, 0x76808a, { rough: 0.9 })
    parapet.position.set(x, h + 0.25, z)
    streetGroup.add(parapet)
  }

  building(-26, -14, 12, 10, 13, 0x8e9aa6)
  building(27, -12, 14, 10, 9, 0x9aa39c)
  building(-30, 38, 10, 8, 7, 0xa39d94)
  building(30, 39, 12, 9, 11, 0x8f9aa0)
  building(-6, -24, 16, 10, 16, 0x9299a8)
  building(14, -25, 12, 9, 12, 0x9d9a92)

  // kerb and street lamps
  const kerb = box(FLOOR.width + 26, 0.12, 0.3, 0xb9bec2, { rough: 0.9 })
  kerb.position.set(0, -0.02, HALF_D + 9.2)
  streetGroup.add(kerb)

  for (const lx of [-16, 16]) {
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

  /* --------------------------------------------------- living street ------ */
  // Pedestrians and traffic animated from the scene tick. They are collected in
  // arrays the caller advances each frame, so nothing here needs a timer.
  const ROW_SPEED = [1.55, 1.05] as const
  /** Minimum spacing between walkers sharing a row. */
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
    // Sidewalk band: from the building face out to the kerb at HALF_D+9.2, NOT
    // the road. Two rows so it reads as a path; one speed per row so a walker
    // only ever catches someone in the OTHER row.
    const row = i % 2
    const sidewalkZ = HALF_D + (row === 0 ? 2.5 : 5.5)
    const from = -34 + i * 11
    g.position.set(from, 0, sidewalkZ)
    streetGroup.add(g)
    walkers.push({
      obj: g,
      legs,
      from,
      to: 38,
      z: sidewalkZ,
      speed: ROW_SPEED[row],
      row,
      t: i * 0.7,
    })
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
    // headlights so the night read is a street, not a box
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

  // Lane centres 4.0 m apart (the car body is 1.8 m wide), so the two directions
  // do not overlap: each lane is 2.6 m from the kerb side.
  const LANE_NORTH = HALF_D + 11.5 // nearer the building, eastbound
  const LANE_SOUTH = HALF_D + 15.5 // far side, westbound
  const CAR_COLORS = [0xb9563f, 0x3f6fb9, 0xd8d3c4, 0x4f7a5f, 0x8a8f95]
  // One speed per lane, and cars are spaced evenly along the lane, so the gap is
  // fixed for good and a car can never lap another in the same lane.
  const LANE_SPEED = { [LANE_NORTH]: 7, [LANE_SOUTH]: 9 } as Record<number, number>
  const CAR_GAP = 13
  const perLane = [0, 0]
  for (let i = 0; i < 5; i++) {
    const forward = i % 2 === 0
    const c = makeVehicle(CAR_COLORS[i % CAR_COLORS.length])
    const z = forward ? LANE_NORTH : LANE_SOUTH
    // The body's length is its LOCAL X. A car travelling east needs no rotation
    // and one travelling west is turned 180°.
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
  void CAR_GAP

  /** Advance the street. Called from the scene tick with the frame delta. */
  function animateStreet(dt: number, t: number) {
    for (const { group: g, phase } of foliage) {
      g.rotation.z = Math.sin(t * 0.8 + phase) * 0.018
      g.rotation.x = Math.sin(t * 0.55 + phase) * 0.012
    }

    // ---- pedestrians: lane discipline ----
    // Two walkers must not occupy the same stretch of the same row. Sorted by x,
    // each walker is held back to PED_GAP behind the one ahead of it in its row.
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
      w.obj.visible = true
      const swing = Math.sin(t * 6.5 + w.obj.position.x * 0.9) * 0.5
      w.legs[0].rotation.x = swing
      w.legs[1].rotation.x = -swing
      const arms = w.obj.userData.arms as THREE.Object3D[]
      arms[0].rotation.x = -swing * 0.7
      arms[1].rotation.x = swing * 0.7
    }
    // Re-apply the spacing after movement, and re-home anything pushed out of its
    // span so the two rows cannot overlap at the wrap boundary.
    for (const row of byRow) {
      row.sort((a, b) => walkers[a].obj.position.x - walkers[b].obj.position.x)
      for (let k = 1; k < row.length; k++) {
        const behind = walkers[row[k - 1]]
        const ahead = walkers[row[k]]
        const gap = ahead.obj.position.x - behind.obj.position.x
        if (gap < PED_GAP) {
          behind.obj.position.x = ahead.obj.position.x - PED_GAP
          behind.t = (behind.obj.position.x - behind.from) / (behind.to - behind.from)
        }
      }
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

  // No interior furniture left to build. `monitors` and `lamps` stay in the
  // contract (scene.ts reads both) and are simply empty until the rebuild.
  const monitors: THREE.Mesh[] = []
  const lamps: THREE.PointLight[] = []
  void pal

  return { group, monitors, lamps, boardSurface, streaks, streetGroup, animateStreet, sun, applyPalette, dispose }
}
