/**
 * Furniture and environment builder.
 *
 * EVERYTHING solid here is declared as a footprint in `layout.ts` first, and
 * `layoutConflicts()` is the check that proves the plan is clean. When adding a
 * prop: add its footprint there, run the check, then draw it here at the same
 * coordinates. Props that avatars may walk through (rugs, doormats) carry a
 * zero footprint height.
 *
 * Textures are procedural canvases rather than image files: the repo stays free
 * of binary assets, and a low-poly look does not need photographic detail.
 */
import * as THREE from 'three'
import {
  CONFERENCE,
  CONFERENCE_CHAIRS,
  DESKS,
  DESK_CHAIR,
  DOOR,
  DART,
  FLOOR,
  FOOTPRINTS,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  LOUNGE,
  PAINTINGS,
  paintingPlacement,
  RECEPTION,
  ROOMS,
  WALL_H,
  WALL_T,
  WINDOWS,
  SIDE_WINDOWS,
  paletteFor,
  type Desk,
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
 * of binary assets and the whole set costs a few milliseconds at startup. Each
 * one is drawn at 512px so it stays sharp when a surface fills the screen, and
 * every material that maps one sets a repeat that matches its real-world size
 * (a plank should read as ~30 cm, not as one giant plank per wall).
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

/** Deterministic pseudo-random so a texture looks the same on every reload. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Wood plank flooring: plank seams, grain streaks, knots and bevelled edges. */
function woodFloorTexture(light: string, mid: string, dark: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(7)
    c.fillStyle = mid
    c.fillRect(0, 0, s, s)
    const plank = 64 // 512 / 8 planks -> repeat makes each ~30 cm
    for (let row = 0; row * plank < s; row++) {
      const y = row * plank
      // per-plank base tone
      const shade = 0.9 + rand() * 0.2
      c.fillStyle = light
      c.globalAlpha = 0.35 * shade
      c.fillRect(0, y, s, plank)
      c.globalAlpha = 1
      // grain lines
      for (let g = 0; g < 26; g++) {
        c.strokeStyle = dark
        c.globalAlpha = 0.04 + rand() * 0.09
        c.lineWidth = rand() > 0.85 ? 1.6 : 0.8
        const gy = y + 4 + rand() * (plank - 8)
        c.beginPath()
        c.moveTo(0, gy)
        for (let x = 0; x <= s; x += 32) {
          c.lineTo(x, gy + Math.sin((x + row * 40) * 0.03) * (0.6 + rand()))
        }
        c.stroke()
      }
      c.globalAlpha = 1
      // occasional knot
      if (rand() > 0.72) {
        const kx = rand() * s
        const ky = y + plank / 2
        c.fillStyle = dark
        c.globalAlpha = 0.18
        c.beginPath()
        c.ellipse(kx, ky, 3 + rand() * 3, 2 + rand() * 2, 0, 0, Math.PI * 2)
        c.fill()
        c.globalAlpha = 1
      }
      // seam at the plank end
      c.fillStyle = dark
      c.globalAlpha = 0.5
      c.fillRect(((row * 137) % s), y, 2, plank)
      c.globalAlpha = 1
      // seam between rows
      c.fillStyle = dark
      c.globalAlpha = 0.65
      c.fillRect(0, y, s, 2)
      c.fillStyle = light
      c.globalAlpha = 0.25
      c.fillRect(0, y + 2, s, 1)
      c.globalAlpha = 1
    }
  })
}

/** Large-format porcelain tile for the lobby: grout, speckle, subtle sheen marks. */
function tileTexture(base: string, line: string, speck: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(23)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    // 4x4 tiles per texture
    const t = s / 4
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const shade = 0.96 + rand() * 0.08
        c.fillStyle = speck
        c.globalAlpha = 0.5 * (shade - 0.96) * 12
        c.fillRect(i * t, j * t, t, t)
        c.globalAlpha = 1
        // faint diagonal sheen
        c.strokeStyle = '#ffffff'
        c.globalAlpha = 0.05
        c.lineWidth = 12
        c.beginPath()
        c.moveTo(i * t, j * t + t)
        c.lineTo(i * t + t, j * t)
        c.stroke()
        c.globalAlpha = 1
      }
    }
    // grout lines
    c.strokeStyle = line
    c.lineWidth = 4
    for (let i = 0; i <= 4; i++) {
      c.beginPath()
      c.moveTo(i * t, 0)
      c.lineTo(i * t, s)
      c.moveTo(0, i * t)
      c.lineTo(s, i * t)
      c.stroke()
    }
    // fine speckle for realism
    for (let i = 0; i < 2600; i++) {
      c.globalAlpha = 0.03 + rand() * 0.05
      c.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000'
      c.fillRect(rand() * s, rand() * s, 1.5, 1.5)
    }
    c.globalAlpha = 1
  })
}

/** Plaster wall: near-white with a faint mottled roller finish. */
function plasterTexture(base: string, tint: string) {
  return canvasTex(256, (c, s) => {
    const rand = rng(91)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 900; i++) {
      c.globalAlpha = 0.02 + rand() * 0.03
      c.fillStyle = rand() > 0.5 ? tint : '#000000'
      const r = 3 + rand() * 14
      c.beginPath()
      c.arc(rand() * s, rand() * s, r, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1
  })
}

/** Brushed metal for door furniture and window mullions. */
function brushedMetalTexture(base: string, dark: string) {
  return canvasTex(128, (c, s) => {
    const rand = rng(41)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 420; i++) {
      c.globalAlpha = 0.04 + rand() * 0.1
      c.fillStyle = dark
      c.fillRect(0, rand() * s, s, rand() > 0.8 ? 1.4 : 0.6)
    }
    c.globalAlpha = 1
  })
}

/** Fabric weave for upholstery: sofa, chairs, cushions. */
function fabricTexture(base: string, thread: string) {
  return canvasTex(128, (c, s) => {
    const rand = rng(57)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    c.strokeStyle = thread
    c.globalAlpha = 0.12
    c.lineWidth = 1
    for (let i = 0; i < s; i += 3) {
      c.beginPath()
      c.moveTo(i, 0)
      c.lineTo(i, s)
      c.stroke()
      c.beginPath()
      c.moveTo(0, i)
      c.lineTo(s, i)
      c.stroke()
    }
    c.globalAlpha = 1
    for (let i = 0; i < 900; i++) {
      c.globalAlpha = 0.04
      c.fillStyle = rand() > 0.5 ? '#fff' : '#000'
      c.fillRect(rand() * s, rand() * s, 1, 1)
    }
    c.globalAlpha = 1
  })
}

/** Asphalt with aggregate and lane wear. */
function asphaltTexture(base: string, grit: string) {
  return canvasTex(256, (c, s) => {
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
    // patches / wear
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
  return canvasTex(256, (c, s) => {
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

/** Painted artwork for the wall frames — abstract, deterministic per seed. */
function artTexture(seed: number) {
  const hues = [212, 24, 148, 340, 44, 268, 190, 8]
  return canvasTex(256, (c, s) => {
    const rand = rng(seed * 97 + 3)
    const h = hues[seed % hues.length]
    const g = c.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, `hsl(${h} 30% 92%)`)
    g.addColorStop(1, `hsl(${(h + 20) % 360} 24% 78%)`)
    c.fillStyle = g
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 9; i++) {
      c.globalAlpha = 0.35 + rand() * 0.4
      c.fillStyle = `hsl(${(h + i * 29) % 360} ${40 + i * 5}% ${30 + (i % 4) * 12}%)`
      const w = 30 + rand() * 130
      const x = rand() * (s - w)
      const y = rand() * (s - 50)
      c.beginPath()
      c.ellipse(x + w / 2, y + 25, w / 2, 12 + rand() * 26, rand() * 3, 0, Math.PI * 2)
      c.fill()
    }
    c.globalAlpha = 1
  })
}

export type OfficeProps = {
  group: THREE.Group
  monitors: THREE.Mesh[]
  lamps: THREE.PointLight[]
  boardSurface: THREE.Mesh
  streaks: THREE.Mesh[]
  streetGroup: THREE.Group
  /** Advance pedestrians and traffic. */
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

  const floorTex = track(woodFloorTexture('#e6d5ae', '#d3bd93', '#a98c5f'))
  // 8 planks per tile, tile covers 2.4 m -> each plank ~30 cm wide
  floorTex.repeat.set(FLOOR.width / 2.4, FLOOR.depth / 2.4)
  const lobbyTex = track(tileTexture('#d5dbdf', '#b3bcc2', '#eef2f4'))
  // 4x4 tiles per texture, tile covers 3.2 m -> each tile ~80 cm
  lobbyTex.repeat.set((ROOMS.lobby.x2 - ROOMS.lobby.x1) / 3.2, (ROOMS.lobby.z2 - ROOMS.lobby.z1) / 3.2)
  const plasterTex = track(plasterTexture('#f4f7f9', '#cfd8de'))
  // Fine mottle reads as flat colour from across the street; 2 cm per pixel keeps
  // the grain visible up close and still resolves at building scale.
  plasterTex.repeat.set(16, 6)
  const metalTex = track(brushedMetalTexture('#9aa8b2', '#6b7880'))
  metalTex.repeat.set(2, 2)
  const fabricTex = track(fabricTexture('#8fb0d4', '#5f80a4'))
  const fabricTex2 = track(fabricTexture('#8397a4', '#5b6c78'))
  const asphaltTex = track(asphaltTexture('#5a5f63', '#8b9095'))
  asphaltTex.repeat.set(24, 3)
  const pavementTex = track(pavementTexture('#a3a8ab', '#8d9296'))
  pavementTex.repeat.set(14, 14)

  /* ------------------------------------------------------------- floors --- */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR.width, FLOOR.depth),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.72, metalness: 0.02 }),
  )
  floor.rotation.x = -Math.PI / 2
  group.add(floor)

  // the lobby is a different material so the transition reads as architecture
  const lobbyFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOMS.lobby.x2 - ROOMS.lobby.x1, ROOMS.lobby.z2 - ROOMS.lobby.z1),
    new THREE.MeshStandardMaterial({ map: lobbyTex, roughness: 0.42, metalness: 0.04 }),
  )
  lobbyFloor.rotation.x = -Math.PI / 2
  lobbyFloor.position.set(0, 0.006, (ROOMS.lobby.z1 + ROOMS.lobby.z2) / 2)
  group.add(lobbyFloor)

  // meeting room gets a rug, lounge too
  const rug = (x: number, z: number, w: number, d: number, color: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stdMat(color, { rough: 0.95 }))
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.012, z)
    group.add(m)
  }
  rug(CONFERENCE.x, CONFERENCE.z, 7.4, 6.2, pal.rug)
  rug(LOUNGE.x, LOUNGE.z - 2.4, 5.4, 4.6, 0xc6b9a2)

  /* -------------------------------------------------------------- walls --- */
  const wallMat = track(
    new THREE.MeshStandardMaterial({ color: pal.wall, map: plasterTex, roughness: 0.9 }),
  )
  /** A wall slab with optional rectangular cut-outs (windows, doorways). */
  const wallPanel = (
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    ry = 0,
    holes: { x: number; y: number; w: number; h: number }[] = [],
  ) => {
    if (!holes.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, WALL_T), wallMat)
      m.position.set(x, y, z)
      m.rotation.y = ry
      group.add(m)
      return
    }
    // build the wall as strips around each hole (simple and robust for rectangles)
    const local = (hx: number, hy: number, hw: number, hh: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, WALL_T), wallMat)
      m.rotation.y = ry
      const dx = hx * Math.cos(ry) + hy * 0
      m.position.set(x + hx * Math.cos(ry), y + hy, z - hx * Math.sin(ry))
      group.add(m)
      return dx
    }
    const sorted = [...holes].sort((a, b) => a.x - b.x)
    let cursor = -w / 2
    for (const hole of sorted) {
      const left = hole.x - hole.w / 2
      if (left > cursor) local((cursor + left) / 2, 0, left - cursor, h)
      // above and below the hole
      // hole.y is measured from the FLOOR; the panel is centred at h/2, so the
      // local offset is hole.y - h/2. Treating it as already-local put every
      // window cut-out above the wall line.
      const ly = hole.y - h / 2
      const top = ly + hole.h / 2
      const bot = ly - hole.h / 2
      if (top < h / 2) local(hole.x, (top + h / 2) / 2, hole.w, h / 2 - top)
      if (bot > -h / 2) local(hole.x, (-h / 2 + bot) / 2, hole.w, bot + h / 2)
      cursor = hole.x + hole.w / 2
    }
    if (cursor < w / 2) local((cursor + w / 2) / 2, 0, w / 2 - cursor, h)
  }

  // north wall with the two window bands; south wall with the entrance
  const northWindows = WINDOWS.filter((w) => !('west' in w) && !('east' in w)).map((w) => ({
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
  }))
  wallPanel(FLOOR.width, WALL_H, 0, WALL_H / 2, -HALF_D, 0, northWindows)
  wallPanel(FLOOR.width, WALL_H, 0, WALL_H / 2, HALF_D, 0, [
    { x: DOOR.x, y: 1.15, w: 3.4, h: 2.3 },
  ])
  const sideHoles = SIDE_WINDOWS.map((z) => ({ x: z, y: 2.7, w: 2.2, h: 1.9 }))
  wallPanel(FLOOR.depth, WALL_H, -HALF_W, WALL_H / 2, 0, Math.PI / 2, sideHoles)
  wallPanel(FLOOR.depth, WALL_H, HALF_W, WALL_H / 2, 0, Math.PI / 2, sideHoles)

  // interior partitions, each with a doorway to the lobby
  const partition = (x: number, zLen: number, doorX: number, doorW: number, ry: number) => {
    wallPanel(zLen, WALL_H, x, WALL_H / 2, 0, ry, [])
  }
  void partition

  // west/east room dividers run north-south, full length of the room band
  for (const px of [ROOMS.work.x1, ROOMS.work.x2]) {
    const z1 = -HALF_D + WALL_T
    const z2 = ROOMS.work.z2
    const m = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, WALL_H, z2 - z1), wallMat)
    m.position.set(px, WALL_H / 2, (z1 + z2) / 2)
    group.add(m)
  }
  // south walls of the three rooms, each with a doorway
  const roomSouthWall = (x1: number, x2: number, doorX: number, doorW: number) => {
    const z = ROOMS.work.z2
    const segs: [number, number][] = [
      [x1, doorX - doorW / 2],
      [doorX + doorW / 2, x2],
    ]
    for (const [a, b] of segs) {
      if (b - a < 0.1) continue
      const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, WALL_H, WALL_T), wallMat)
      m.position.set((a + b) / 2, WALL_H / 2, z)
      group.add(m)
    }
  }
  roomSouthWall(ROOMS.meeting.x1, ROOMS.meeting.x2, -11.0, 2.2)
  roomSouthWall(ROOMS.work.x1, ROOMS.work.x2, 0, 3.4)
  roomSouthWall(ROOMS.lounge.x1, ROOMS.lounge.x2, 11.0, 2.2)

  /* ------------------------------------------------------------ windows --- */
  const glassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xc3e2f0,
      transparent: true,
      opacity: 0.4,
      roughness: 0.03,
      metalness: 0,
      emissive: 0xa6cfe2,
      emissiveIntensity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const frameMat = track(
    new THREE.MeshStandardMaterial({ color: 0x9aa8b2, map: metalTex, metalness: 0.55, roughness: 0.35 }),
  )

  /** A glazed opening: frame, mullions and a bright pane. */
  const windowUnit = (
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    axis: 'x' | 'z',
  ) => {
    const depth = 0.1
    const mk = (ww: number, hh: number, ox: number, oy: number, color = 0x9aa8b2) => {
      const g = new THREE.BoxGeometry(axis === 'x' ? ww : depth + 0.04, hh, axis === 'x' ? depth + 0.04 : ww)
      const m = new THREE.Mesh(g, color === 0x9aa8b2 ? frameMat : stdMat(color))
      m.position.set(cx + (axis === 'x' ? ox : 0), cy + oy, cz + (axis === 'x' ? 0 : ox))
      group.add(m)
    }
    mk(w, 0.1, 0, h / 2)
    mk(w, 0.1, 0, -h / 2)
    mk(0.1, h, -w / 2, 0)
    mk(0.1, h, w / 2, 0)
    mk(0.08, h, 0, 0) // centre mullion
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(axis === 'x' ? w : 0.03, h, axis === 'x' ? 0.03 : w),
      glassMat,
    )
    pane.position.set(cx, cy, cz)
    group.add(pane)
    // what is visible through the glass: a bright sky card
    const sky = new THREE.Mesh(
      new THREE.BoxGeometry(axis === 'x' ? w - 0.1 : 0.02, h - 0.1, axis === 'x' ? 0.02 : w - 0.1),
      stdMat(0xcfe6f5, { emissive: 0xbfe0f2, ei: 0.5 }),
    )
    sky.position.set(
      cx + (axis === 'x' ? 0 : cz > 0 ? 0.12 : -0.12),
      cy,
      cz + (axis === 'x' ? (cz > 0 ? 0.12 : -0.12) : 0),
    )
    group.add(sky)
  }
  // Sunk slightly into the wall opening so the glass shows on BOTH faces; a unit
  // centred in the wall is buried and invisible from outside.
  const wallN = -HALF_D + WALL_T / 2
  for (const w of WINDOWS) {
    if ('west' in w || 'east' in w) continue
    windowUnit(w.x, w.y, wallN, w.w, w.h, 'x')
  }
  const wallW = -HALF_W + WALL_T / 2
  const wallE = HALF_W - WALL_T / 2
  for (const z of SIDE_WINDOWS) {
    windowUnit(wallW, 2.7, z, 2.2, 1.9, 'z')
    windowUnit(wallE, 2.7, z, 2.2, 1.9, 'z')
  }
  // lobby: wide street-facing window beside the entrance
  windowUnit(-5.4, 2.3, wallN, 3.2, 1.7, 'x')
  windowUnit(5.4, 2.3, wallN, 3.2, 1.7, 'x')

  // Facade relief: horizontal banding and corner pilasters. A flat plaster slab
  // has no scale cue from outside, so the building read as an untextured box.
  const facadeMat = track(
    new THREE.MeshStandardMaterial({ color: 0xe4eaee, map: plasterTex, roughness: 0.88 }),
  )
  const bandMat = track(
    new THREE.MeshStandardMaterial({ color: 0xb9c4cc, map: plasterTex, roughness: 0.7 }),
  )
  const facadeBand = (
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    ry: number,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.09), bandMat)
    m.position.set(x, y, z)
    m.rotation.y = ry
    group.add(m)
  }
  // base plinth + cornice + a mid band on all four faces
  for (const [x, z, ry, len] of [
    [0, -HALF_D - 0.03, 0, FLOOR.width],
    [0, HALF_D + 0.03, 0, FLOOR.width],
    [-HALF_W - 0.03, 0, Math.PI / 2, FLOOR.depth],
    [HALF_W + 0.03, 0, Math.PI / 2, FLOOR.depth],
  ] as const) {
    facadeBand(len, 0.34, x, 0.17, z, ry)
    facadeBand(len, 0.26, x, WALL_H - 0.13, z, ry)
    facadeBand(len, 0.16, x, 1.5, z, ry)
  }
  // corner pilasters
  for (const [px, pz] of [
    [-HALF_W, -HALF_D],
    [HALF_W, -HALF_D],
    [-HALF_W, HALF_D],
    [HALF_W, HALF_D],
  ] as const) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, WALL_H, 0.5), facadeMat)
    p.position.set(px, WALL_H / 2, pz)
    group.add(p)
  }
  // wall sconces either side of the entrance
  for (const sx of [-2.6, 2.6]) {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.3), bandMat)
    bracket.position.set(sx, 3.3, HALF_D - 0.02)
    group.add(bracket)
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      stdMat(0xfff1cf, { emissive: 0xffd89a, ei: 0.9 }),
    )
    bulb.position.set(sx, 3.16, HALF_D + 0.12)
    group.add(bulb)
    const lamp = new THREE.PointLight(0xffe3b0, hour >= 18 || hour < 6 ? 0.8 : 0.15, 8)
    lamp.position.set(sx, 3.1, HALF_D + 0.4)
    group.add(lamp)
  }

  /* ----------------------------------------------------------- paintings --- */
  // Placement comes from paintingPlacement(): it stands each frame and canvas off
  // the wall's inner face, so nothing is buried in the wall or floating in front.
  PAINTINGS.forEach((spec, i) => {
    const tex = track(artTexture(i))
    const at = paintingPlacement(spec)

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w + 0.14, spec.h + 0.14, 0.06),
      stdMat(0x6f5c45, { rough: 0.6 }),
    )
    frame.position.set(at.frame.x, at.frame.y, at.frame.z)
    frame.rotation.y = at.ry
    group.add(frame)

    const matte = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w + 0.04, spec.h + 0.04, 0.02),
      stdMat(0xece5d8, { rough: 0.9 }),
    )
    matte.position.set(at.canvas.x, at.canvas.y, at.canvas.z)
    matte.rotation.y = at.ry
    group.add(matte)

    const canvasMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.w, spec.h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    )
    canvasMesh.position.set(at.canvas.x, at.canvas.y, at.canvas.z)
    canvasMesh.rotation.y = at.ry
    // nudge the picture plane just proud of its matte
    canvasMesh.translateZ(0.012)
    group.add(canvasMesh)

    // picture light on the wall above the frame
    const spot = new THREE.PointLight(0xffe9c8, 0.28, 3.6)
    spot.position.set(
      at.frame.x + Math.sin(at.ry) * 0.45,
      at.frame.y + spec.h / 2 + 0.5,
      at.frame.z + Math.cos(at.ry) * 0.45,
    )
    group.add(spot)
  })

  /* ------------------------------------------------------- kanban board --- */
  const boardSurface = box(KANBAN_BOARD.w, KANBAN_BOARD.h, 0.14, 0x14313f, {
    emissive: 0x0b3d2c,
    rough: 0.4,
  })
  boardSurface.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z)
  boardSurface.name = 'kanban-board'
  group.add(boardSurface)
  // mounting: a frame plus brackets so it sits ON the wall instead of hovering
  const boardFrame = new THREE.Mesh(
    new THREE.BoxGeometry(KANBAN_BOARD.w + 0.24, KANBAN_BOARD.h + 0.24, 0.1),
    stdMat(0x2b3f49, { metal: 0.3, rough: 0.5 }),
  )
  boardFrame.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z - 0.06)
  group.add(boardFrame)
  for (const bx of [-KANBAN_BOARD.w / 2 + 0.6, 0, KANBAN_BOARD.w / 2 - 0.6]) {
    const bracket = box(0.12, 0.1, 0.18, 0x394f5b, { metal: 0.4 })
    bracket.position.set(KANBAN_BOARD.x + bx, KANBAN_BOARD.y + KANBAN_BOARD.h / 2 + 0.16, KANBAN_BOARD.z + 0.04)
    group.add(bracket)
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

  /* -------------------------------------------------------------- desks --- */
  const monitors: THREE.Mesh[] = []
  const lamps: THREE.PointLight[] = []

  for (const desk of DESKS) {
    const d = new THREE.Group()
    d.position.set(desk.x, 0, desk.z)
    d.rotation.y = desk.facing

    const top = box(2.0, 0.07, 1.0, pal.deskTop, { rough: 0.45 })
    top.position.y = 0.72
    d.add(top)
    const skirt = box(1.9, 0.5, 0.08, 0xc9d2d8, { rough: 0.6 })
    skirt.position.set(0, 0.46, -0.42)
    d.add(skirt)
    for (const [lx, lz] of [
      [-0.9, -0.42],
      [0.9, -0.42],
      [-0.9, 0.42],
      [0.9, 0.42],
    ]) {
      const leg = box(0.07, 0.72, 0.07, pal.deskLeg, { metal: 0.4 })
      leg.position.set(lx, 0.36, lz)
      d.add(leg)
    }

    const stand = cyl(0.04, 0.08, 0.24, pal.deskLeg)
    stand.position.set(0, 0.86, -0.28)
    d.add(stand)
    const bezel = box(0.94, 0.56, 0.04, 0x25292d, { metal: 0.3 })
    bezel.position.set(0, 1.2, -0.28)
    d.add(bezel)
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.48),
      new THREE.MeshStandardMaterial({
        color: pal.screen,
        emissive: 0x0d3b28,
        emissiveIntensity: 1.1,
        side: THREE.DoubleSide,
      }),
    )
    screen.position.set(0, 1.2, -0.255)
    screen.userData = { kind: 'monitor', deskIndex: desk.index }
    screen.name = `monitor-${desk.index}`
    d.add(screen)
    monitors.push(screen)

    const kb = box(0.56, 0.02, 0.18, 0x333a3f)
    kb.position.set(0, 0.765, 0.14)
    d.add(kb)
    const mouse = box(0.07, 0.02, 0.11, 0x2d3338)
    mouse.position.set(0.38, 0.765, 0.14)
    d.add(mouse)
    const mug = cyl(0.05, 0.045, 0.09, 0xeae4d8, 10)
    mug.position.set(-0.72, 0.8, 0.1)
    d.add(mug)

    const lamp = new THREE.PointLight(0xffc98a, hour >= 18 || hour < 6 ? 0.8 : 0, 4)
    lamp.position.set(desk.x + Math.sin(desk.facing) * 0.5, 1.5, desk.z + Math.cos(desk.facing) * 0.5)
    group.add(lamp)
    lamps.push(lamp)

    // task chair — child of the desk group so it inherits the desk rotation and
    // faces the monitor by construction
    const chair = new THREE.Group()
    chair.position.set(DESK_CHAIR.x, 0, DESK_CHAIR.z)
    const chairFabric = new THREE.MeshStandardMaterial({
      color: pal.chair,
      map: fabricTex2,
      roughness: 0.85,
    })
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 0.54), chairFabric)
    seat.position.y = 0.47
    chair.add(seat)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.6, 0.06), chairFabric)
    back.position.set(0, 0.76, 0.27)
    chair.add(back)
    const post = cyl(0.045, 0.06, 0.44, 0x5b666e, 10, 0.4)
    post.position.y = 0.22
    chair.add(post)
    const star = cyl(0.3, 0.32, 0.04, 0x4d565d, 12, 0.3)
    star.position.y = 0.02
    chair.add(star)
    d.add(chair)

    group.add(d)
  }

  /* --------------------------------------------------------- conference --- */
  const cTableTop = cyl(CONFERENCE.radius, CONFERENCE.radius, 0.08, pal.wood, 32)
  cTableTop.position.set(CONFERENCE.x, 0.72, CONFERENCE.z)
  group.add(cTableTop)
  const cTableEdge = cyl(CONFERENCE.radius + 0.04, CONFERENCE.radius + 0.04, 0.05, 0x9a7449, 32)
  cTableEdge.position.set(CONFERENCE.x, 0.675, CONFERENCE.z)
  group.add(cTableEdge)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const leg = cyl(0.05, 0.07, 0.68, pal.wood, 10)
    leg.position.set(CONFERENCE.x + Math.cos(a) * 1.5, 0.34, CONFERENCE.z + Math.sin(a) * 1.5)
    group.add(leg)
  }
  // table centre piece: display + water jugs
  const holo = box(1.5, 0.04, 0.9, 0x4fd1c5, { emissive: 0x2fd6c0 })
  holo.position.set(CONFERENCE.x, 1.06, CONFERENCE.z)
  group.add(holo)
  const holoLeg = cyl(0.05, 0.07, 0.3, 0x455a63, 10, 0.4)
  holoLeg.position.set(CONFERENCE.x, 0.88, CONFERENCE.z)
  group.add(holoLeg)
  const jug = cyl(0.08, 0.09, 0.22, 0xdfe9ee, 12)
  jug.position.set(CONFERENCE.x + 1.1, 0.87, CONFERENCE.z - 0.5)
  group.add(jug)
  for (let i = 0; i < 5; i++) {
    const glass = cyl(0.028, 0.022, 0.07, 0xcfe3ea, 8)
    glass.position.set(CONFERENCE.x - 0.8 + i * 0.18, 0.795, CONFERENCE.z + 0.7)
    group.add(glass)
  }

  for (let i = 0; i < CONFERENCE_CHAIRS.count; i++) {
    const a = CONFERENCE_CHAIRS.offset + (i / CONFERENCE_CHAIRS.count) * Math.PI * 2
    const cx = CONFERENCE.x + Math.cos(a) * CONFERENCE_CHAIRS.ring
    const cz = CONFERENCE.z + Math.sin(a) * CONFERENCE_CHAIRS.ring
    const c = new THREE.Group()
    c.position.set(cx, 0, cz)
    // face the table centre
    c.rotation.y = Math.atan2(cx - CONFERENCE.x, cz - CONFERENCE.z)
    const seat = box(0.54, 0.07, 0.52, pal.chair, { rough: 0.7 })
    seat.position.y = 0.47
    c.add(seat)
    const back = box(0.54, 0.56, 0.06, pal.chair, { rough: 0.7 })
    back.position.set(0, 0.75, 0.26)
    c.add(back)
    const post = cyl(0.04, 0.055, 0.44, 0x5b666e, 8, 0.4)
    post.position.y = 0.22
    c.add(post)
    const star = cyl(0.26, 0.28, 0.04, 0x4d565d, 10, 0.3)
    star.position.y = 0.02
    c.add(star)
    group.add(c)
  }
  // whiteboard in the meeting room
  const wbFrame = box(0.08, 1.7, 3.6, 0xc5ced5, { metal: 0.3 })
  wbFrame.position.set(ROOMS.meeting.x1 + 0.1, 1.75, CONFERENCE.z - 1.2)
  group.add(wbFrame)
  const wb = box(0.04, 1.55, 3.45, 0xfcfdff, { rough: 0.25 })
  wb.position.set(ROOMS.meeting.x1 + 0.16, 1.75, CONFERENCE.z - 1.2)
  group.add(wb)

  /* -------------------------------------------------------------- lounge -- */
  const sofa = new THREE.Group()
  sofa.position.set(LOUNGE.x, 0, LOUNGE.z - 1.45)
  const sofaFabric = track(
    new THREE.MeshStandardMaterial({ color: pal.sofa, map: fabricTex, roughness: 0.95 }),
  )
  const sofaSeat = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.34, 1.0), sofaFabric)
  sofaSeat.position.y = 0.42
  sofa.add(sofaSeat)
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.66, 0.24), sofaFabric)
  sofaBack.position.set(0, 0.82, 0.38)
  sofa.add(sofaBack)
  for (const sx of [-1.6, 1.6]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 1.0), sofaFabric)
    arm.position.set(sx, 0.6, 0)
    sofa.add(arm)
  }
  for (const px of [-1.0, 0, 1.0]) {
    const cushion = box(0.9, 0.12, 0.86, 0x9db9d6, { rough: 0.95 })
    cushion.position.set(px, 0.63, -0.02)
    sofa.add(cushion)
  }
  group.add(sofa)

  // TV on a REAL stand (it used to float)
  const tvUnit = new THREE.Group()
  tvUnit.position.set(LOUNGE.x, 0, LOUNGE.z - 4.9)
  const cabinet = box(2.6, 0.5, 0.55, pal.wood, { rough: 0.6 })
  cabinet.position.y = 0.25
  tvUnit.add(cabinet)
  for (const dx of [-1.22, 1.22]) {
    const door = box(0.02, 0.4, 0.45, 0x9a7449)
    door.position.set(dx, 0.26, 0.01)
    tvUnit.add(door)
  }
  const tvNeck = box(0.24, 0.16, 0.2, 0x2b3236, { metal: 0.4 })
  tvNeck.position.y = 0.58
  tvUnit.add(tvNeck)
  const tvFoot = box(0.7, 0.03, 0.32, 0x2b3236, { metal: 0.4 })
  tvFoot.position.y = 0.51
  tvUnit.add(tvFoot)
  const tv = box(2.1, 1.2, 0.07, 0x14181c, { rough: 0.3 })
  tv.position.y = 1.28
  tvUnit.add(tv)
  const tvScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 1.1),
    stdMat(0x14344a, { emissive: 0x1d5680, ei: 0.75 }),
  )
  tvScreen.position.set(0, 1.28, 0.04)
  tvUnit.add(tvScreen)
  group.add(tvUnit)

  const coffee = cyl(0.62, 0.62, 0.05, pal.wood, 24)
  coffee.position.set(LOUNGE.x, 0.44, LOUNGE.z - 2.9)
  group.add(coffee)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const cl = cyl(0.035, 0.045, 0.42, 0x8a6a45, 8)
    cl.position.set(LOUNGE.x + Math.cos(a) * 0.4, 0.21, LOUNGE.z - 2.9 + Math.sin(a) * 0.4)
    group.add(cl)
  }
  const magazine = box(0.32, 0.015, 0.24, 0xd8cfc0)
  magazine.position.set(LOUNGE.x + 0.16, 0.47, LOUNGE.z - 2.85)
  group.add(magazine)

  const armchair = new THREE.Group()
  armchair.position.set(LOUNGE.x - 2.3, 0, LOUNGE.z - 0.6)
  armchair.rotation.y = -0.7
  const acSeat = box(0.92, 0.14, 0.88, 0x8fb0d4, { rough: 0.9 })
  acSeat.position.y = 0.42
  armchair.add(acSeat)
  const acBack = box(0.92, 0.7, 0.2, 0x8fb0d4, { rough: 0.9 })
  acBack.position.set(0, 0.78, 0.34)
  armchair.add(acBack)
  for (const sx of [-0.4, 0.4]) {
    const ar = box(0.14, 0.42, 0.8, 0x8fb0d4, { rough: 0.9 })
    ar.position.set(sx, 0.56, 0)
    armchair.add(ar)
  }
  group.add(armchair)

  const floorLamp = new THREE.Group()
  floorLamp.position.set(LOUNGE.x + 2.5, 0, LOUNGE.z - 3.2)
  const pole = cyl(0.035, 0.05, 1.62, 0x8a949c, 10, 0.5)
  pole.position.y = 0.81
  floorLamp.add(pole)
  const base = cyl(0.24, 0.28, 0.04, 0x6f7981, 14, 0.4)
  base.position.y = 0.02
  floorLamp.add(base)
  const shade = cyl(0.34, 0.22, 0.28, 0xf6e8ca, 16)
  shade.position.y = 1.7
  floorLamp.add(shade)
  const bulb = new THREE.PointLight(0xffe0ae, hour >= 18 || hour < 6 ? 0.9 : 0.15, 7)
  bulb.position.set(0, 1.6, 0)
  floorLamp.add(bulb)
  group.add(floorLamp)

  // pantry counter with small appliances
  const pantry = new THREE.Group()
  pantry.position.set(14.4, 0, 1.0)
  const counter = box(2.5, 0.9, 0.62, 0xdcc9ab, { rough: 0.6 })
  counter.position.y = 0.45
  pantry.add(counter)
  const cTop = box(2.58, 0.05, 0.68, 0xf0e8d8, { rough: 0.35 })
  cTop.position.y = 0.92
  pantry.add(cTop)
  const espresso = box(0.34, 0.44, 0.34, 0x4c545b, { metal: 0.5, rough: 0.4 })
  espresso.position.set(-0.85, 1.16, 0)
  pantry.add(espresso)
  const kettle = cyl(0.11, 0.13, 0.24, 0xe9edf0, 12, 0.2)
  kettle.position.set(0.2, 1.06, 0)
  pantry.add(kettle)
  const tray = box(0.5, 0.03, 0.3, 0xb9c4cb)
  tray.position.set(0.9, 0.96, 0)
  pantry.add(tray)
  group.add(pantry)

  /* --------------------------------------------------------- work extras -- */
  // two small meeting pods in the bay
  for (const px of [-4.3, 4.3]) {
    const pod = new THREE.Group()
    pod.position.set(px, 0, 0.5)
    const ptop = cyl(0.7, 0.7, 0.05, 0xe9e0d0, 20)
    ptop.position.y = 0.72
    pod.add(ptop)
    const pleg = cyl(0.06, 0.1, 0.7, 0x9aa7b1, 10, 0.3)
    pod.add(pleg)
    pleg.position.y = 0.35
    for (const side of [-1, 1]) {
      const chair = new THREE.Group()
      chair.position.set(0, 0, side * 1.0)
      chair.rotation.y = side > 0 ? Math.PI : 0
      const s2 = box(0.5, 0.07, 0.48, 0xa8b8c4, { rough: 0.75 })
      s2.position.y = 0.46
      chair.add(s2)
      const b2 = box(0.5, 0.5, 0.06, 0xa8b8c4, { rough: 0.75 })
      b2.position.set(0, 0.72, 0.24)
      chair.add(b2)
      const l2 = cyl(0.035, 0.05, 0.42, 0x8b98a3, 8, 0.3)
      l2.position.y = 0.21
      chair.add(l2)
      pod.add(chair)
    }
    group.add(pod)
  }

  const printer = new THREE.Group()
  printer.position.set(-5.2, 0, 2.5)
  const pBody = box(0.78, 0.55, 0.62, 0xdfe6ea, { rough: 0.5 })
  pBody.position.y = 0.75
  printer.add(pBody)
  const pTray = box(0.5, 0.03, 0.34, 0xc3ccd2)
  pTray.position.set(0, 1.04, 0.1)
  printer.add(pTray)
  const pStand = box(0.84, 0.48, 0.68, 0xb9c3ca, { metal: 0.3 })
  pStand.position.y = 0.24
  printer.add(pStand)
  group.add(printer)

  const lockers = new THREE.Group()
  lockers.position.set(3.9, 0, 2.6)
  for (let i = 0; i < 4; i++) {
    const lk = box(0.44, 1.7, 0.5, i % 2 ? 0xa4b8c6 : 0x8fa8b8, { metal: 0.35, rough: 0.5 })
    lk.position.set((i - 1.5) * 0.46, 0.85, 0)
    lockers.add(lk)
    const handle = box(0.03, 0.16, 0.03, 0x5d686f, { metal: 0.6 })
    handle.position.set((i - 1.5) * 0.46 + 0.16, 0.85, 0.26)
    lockers.add(handle)
  }
  group.add(lockers)

  // archive shelves
  for (const px of [-5.6, 5.6]) {
    const sh = new THREE.Group()
    sh.position.set(px, 0, -10.6)
    const frame = box(0.38, 1.9, 2.4, 0xcbb69a, { rough: 0.65 })
    frame.position.y = 0.95
    sh.add(frame)
    for (let i = 1; i <= 3; i++) {
      const plank = box(0.42, 0.05, 2.3, 0xe6dbc6, { rough: 0.5 })
      plank.position.y = 0.3 + i * 0.45
      sh.add(plank)
    }
    const bookColors = [0x9a4f4f, 0x4f6f9a, 0x6f9a4f, 0xa88b4f, 0x7a5a9a]
    for (let i = 0; i < 5; i++) {
      const bk = box(0.26, 0.3, 0.08, bookColors[i % bookColors.length], { rough: 0.8 })
      bk.position.set(0.05, 0.47, -0.9 + i * 0.34)
      sh.add(bk)
    }
    group.add(sh)
  }

  // recyclers
  const bins = new THREE.Group()
  bins.position.set(7.0, 0, 3.0)
  for (const [i, c] of [0x4f7f9a, 0x7f9a4f].entries()) {
    const bin = cyl(0.22, 0.19, 0.68, c, 12)
    bin.position.set(i * 0.55 - 0.28, 0.34, 0)
    bins.add(bin)
    const lid = cyl(0.23, 0.23, 0.04, 0x3e4a52, 12)
    lid.position.set(i * 0.55 - 0.28, 0.7, 0)
    bins.add(lid)
  }
  group.add(bins)

  const cooler = new THREE.Group()
  cooler.position.set(15.6, 0, -1.6)
  const cBody = box(0.52, 0.95, 0.52, 0xe4ebee, { rough: 0.5 })
  cBody.position.y = 0.48
  cooler.add(cBody)
  const cJug = cyl(0.24, 0.2, 0.46, 0x8fd0ea, 16)
  cJug.position.y = 1.2
  cooler.add(cJug)
  const cTap = box(0.06, 0.12, 0.06, 0x5d686f, { metal: 0.5 })
  cTap.position.set(0, 0.86, 0.28)
  cooler.add(cTap)
  group.add(cooler)

  /* -------------------------------------------------------------- lobby --- */
  const reception = new THREE.Group()
  reception.position.set(RECEPTION.x, 0, RECEPTION.z)
  const rCounter = box(3.2, 1.05, 0.62, 0xe0d3bc, { rough: 0.6 })
  rCounter.position.y = 0.52
  reception.add(rCounter)
  const rTop = box(3.34, 0.06, 0.76, 0x8b6f52, { rough: 0.45 })
  rTop.position.y = 1.08
  reception.add(rTop)
  const rBadge = box(0.5, 0.34, 0.03, 0xdfe6ea, { metal: 0.2 })
  rBadge.position.set(0, 0.72, 0.33)
  reception.add(rBadge)
  const rLogo = box(0.44, 0.12, 0.02, 0x2f7f5f, { emissive: 0x2f7f5f, ei: 0.4 })
  rLogo.position.set(0, 0.72, 0.35)
  reception.add(rLogo)
  const monitorR = box(0.5, 0.34, 0.03, 0x25292d, { metal: 0.3 })
  monitorR.position.set(-1.2, 1.28, 0.06)
  reception.add(monitorR)
  group.add(reception)

  const rChair = new THREE.Group()
  rChair.position.set(RECEPTION.x, 0, RECEPTION.z + 1.15)
  const rcSeat = box(0.54, 0.07, 0.52, 0x6f8fa8, { rough: 0.7 })
  rcSeat.position.y = 0.47
  rChair.add(rcSeat)
  const rcBack = box(0.54, 0.6, 0.06, 0x6f8fa8, { rough: 0.7 })
  rcBack.position.set(0, 0.76, 0.26)
  rChair.add(rcBack)
  const rcPost = cyl(0.045, 0.06, 0.44, 0x5b666e, 10, 0.4)
  rcPost.position.y = 0.22
  rChair.add(rcPost)
  group.add(rChair)

  // waiting area
  for (const wx of [-6.4, 6.4]) {
    const wsofa = new THREE.Group()
    wsofa.position.set(wx, 0, 9.4)
    const wsSeat = box(1.8, 0.32, 0.9, 0x93a8ba, { rough: 0.9 })
    wsSeat.position.y = 0.4
    wsofa.add(wsSeat)
    const wsBack = box(1.8, 0.6, 0.22, 0x93a8ba, { rough: 0.9 })
    wsBack.position.set(0, 0.76, 0.34)
    wsofa.add(wsBack)
    group.add(wsofa)
  }
  const wTable = cyl(0.42, 0.46, 0.05, pal.wood, 20)
  wTable.position.set(-9.6, 0.44, 9.6)
  group.add(wTable)
  const wTableLeg = cyl(0.05, 0.07, 0.42, pal.wood, 10)
  wTableLeg.position.set(-9.6, 0.21, 9.6)
  group.add(wTableLeg)

  const coatRack = new THREE.Group()
  coatRack.position.set(-11.0, 0, 11.4)
  const crPole = cyl(0.045, 0.055, 1.72, 0x8b6f4f, 10)
  crPole.position.y = 0.86
  coatRack.add(crPole)
  const crBase = cyl(0.28, 0.32, 0.05, 0x7a6244, 14)
  crBase.position.y = 0.025
  coatRack.add(crBase)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const peg = box(0.05, 0.05, 0.22, 0x9c7d59)
    peg.position.set(Math.cos(a) * 0.11, 1.6, Math.sin(a) * 0.11)
    peg.rotation.y = -a
    coatRack.add(peg)
  }
  group.add(coatRack)

  const doormat = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 1.4),
    stdMat(0x6b7a6e, { rough: 1 }),
  )
  doormat.rotation.x = -Math.PI / 2
  doormat.position.set(0, 0.014, HALF_D - WALL_T - 0.9)
  group.add(doormat)

  /* ---------------------------------------------------------- entrance ---- */
  // A proper double door with glass leaves, transom and frame. The old version
  // was a single slab that read as a wall panel; nothing was actually there.
  const doorGroup = new THREE.Group()
  doorGroup.position.set(DOOR.x, 0, HALF_D - WALL_T / 2)
  const dFrameMat = track(
    new THREE.MeshStandardMaterial({ color: 0x54636d, map: metalTex, metalness: 0.6, roughness: 0.3 }),
  )
  const leafW = 1.65
  for (const side of [-1, 1]) {
    const leafH = 2.25
    const leafGlass = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.16, leafH - 0.2, 0.04), glassMat)
    leafGlass.position.set((side * leafW) / 2, 1.16, 0)
    doorGroup.add(leafGlass)
    const leafFrameV = box(0.07, leafH, 0.07, 0x54636d, { metal: 0.55 })
    leafFrameV.position.set(side * (leafW - 0.05), 1.16, 0)
    doorGroup.add(leafFrameV)
    const leafFrameH = box(leafW, 0.07, 0.07, 0x54636d, { metal: 0.55 })
    leafFrameH.position.set((side * leafW) / 2, 2.3, 0)
    doorGroup.add(leafFrameH)
    const leafFrameB = box(leafW, 0.09, 0.07, 0x54636d, { metal: 0.55 })
    leafFrameB.position.set((side * leafW) / 2, 0.05, 0)
    doorGroup.add(leafFrameB)
    // push bar
    const bar = box(0.05, 0.05, 0.9, 0x2f3a41, { metal: 0.7, rough: 0.3 })
    bar.position.set(side * 0.35, 1.05, side > 0 ? 0.16 : -0.16)
    bar.rotation.y = Math.PI / 2
    doorGroup.add(bar)
    // handle plate
    const plate = box(0.06, 0.24, 0.03, 0xd7dee3, { metal: 0.8, rough: 0.25 })
    plate.position.set(side * 0.45, 1.05, 0.12)
    doorGroup.add(plate)
  }
  // top transom window + outer frame
  const transom = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 0.04), glassMat)
  transom.position.set(0, 2.62, 0)
  doorGroup.add(transom)
  const headRail = box(3.6, 0.14, 0.12, 0x54636d, { metal: 0.55 })
  headRail.position.set(0, 2.92, 0)
  doorGroup.add(headRail)
  const jambL = box(0.12, 2.9, 0.12, 0x54636d, { metal: 0.55 })
  jambL.position.set(-1.76, 1.45, 0)
  doorGroup.add(jambL)
  const jambR = jambL.clone()
  jambR.position.x = 1.76
  doorGroup.add(jambR)
  group.add(doorGroup)
  void dFrameMat

  // Surrounding frame in a darker metal so the doorway reads from outside, where
  // two glass leaves alone vanish against the lobby's white wall.
  const doorSurround = box(4.0, 3.15, 0.16, 0x46545e, { metal: 0.5, rough: 0.4 })
  doorSurround.position.set(DOOR.x, 1.58, HALF_D - WALL_T / 2 - 0.08)
  group.add(doorSurround)
  const doorGlassOuter = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.55, 0.12), glassMat)
  doorGlassOuter.position.set(DOOR.x, 1.4, HALF_D - WALL_T / 2 + 0.02)
  group.add(doorGlassOuter)

  // canopy + step outside the entrance
  const canopy = box(4.2, 0.14, 1.4, 0x8d9aa4, { metal: 0.3, rough: 0.5 })
  canopy.position.set(0, 3.1, HALF_D + 0.6)
  group.add(canopy)
  const step = box(4.4, 0.12, 0.9, 0xbfc7cc, { rough: 0.8 })
  step.position.set(0, 0.06, HALF_D + 0.5)
  group.add(step)
  // entrance signage
  const signPlate = box(2.6, 0.42, 0.08, 0x113b2c, { emissive: 0x1c5c44, ei: 0.5 })
  signPlate.position.set(0, 3.5, HALF_D - 0.02)
  group.add(signPlate)

  /* ----------------------------------------------------------- lighting --- */
  scene.add(new THREE.AmbientLight(0xffffff, 1.15))
  const sun = new THREE.DirectionalLight(0xfff6e5, 1.85)
  sun.position.set(11, 16, 9)
  scene.add(sun)
  const fill = new THREE.HemisphereLight(0xeaf4ff, 0xcfc0a4, 1.0)
  scene.add(fill)

  // recessed ceiling panels in a grid, each with a fixture and a point light
  const streaks: THREE.Mesh[] = []
  for (const cz of [-10, -5.5, -1, 6.5, 10.5]) {
    const housing = box(FLOOR.width - 1.6, 0.12, 0.42, 0xd9dfe4, { metal: 0.25, rough: 0.5 })
    housing.position.set(0, 3.3, cz)
    group.add(housing)
    const panel = box(FLOOR.width - 2.0, 0.04, 0.3, 0xffffff, { emissive: 0xfff4e0, ei: 1 })
    panel.position.set(0, 3.23, cz)
    group.add(panel)
    streaks.push(panel)
    // One light per ceiling row: 25 point lights measurably starved the frame
    // budget for no visible gain, since the emissive panel already reads as lit.
    const l = new THREE.PointLight(0xfff6e6, 0.55, 22)
    l.position.set(0, 3.0, cz)
    group.add(l)
  }

  /* -------------------------------------------------- outside environment -- */
  // The office sits in a street: pavement, road, trees and neighbouring blocks,
  // so zooming out does not reveal an empty void. Built as one group the scene
  // can toggle, and the camera is clamped to this area.
  const streetGroup = new THREE.Group()
  scene.add(streetGroup)

  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR.width + 26, FLOOR.depth + 26),
    new THREE.MeshStandardMaterial({ map: pavementTex, roughness: 0.95 }),
  )
  pavement.rotation.x = -Math.PI / 2
  pavement.position.y = -0.06
  streetGroup.add(pavement)

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 9),
    new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.98 }),
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
    // window grid so the facade is not a blank slab
    const rows = Math.max(2, Math.floor(h / 3))
    const cols = Math.max(2, Math.floor(w / 2.4))
    const winMat = stdMat(0x8fb6cf, { emissive: 0x6f9cbb, ei: 0.35 })
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.06), winMat)
        win.position.set(
          x - w / 2 + 1.2 + c * (w / cols),
          1.8 + r * (h / rows),
          z + (d / 2 + 0.04) * (z > 0 ? 1 : -1),
        )
        streetGroup.add(win)
      }
    }
  }
  building(-26, -14, 12, 10, 13, 0x8e9aa6)
  building(27, -12, 14, 10, 9, 0x9aa39c)
  building(-30, 14, 10, 8, 7, 0xa39d94)
  building(30, 15, 12, 9, 11, 0x8f9aa0)
  building(-6, -24, 16, 10, 16, 0x9299a8)
  building(14, -25, 12, 9, 12, 0x9d9a92)

  // kerb, street lamps and a couple of parked cars
  const kerb = box(FLOOR.width + 26, 0.12, 0.3, 0xb9bec2, { rough: 0.9 })
  kerb.position.set(0, -0.02, HALF_D + 9.2)
  streetGroup.add(kerb)

  for (const lx of [-16, 16]) {
    const post = cyl(0.07, 0.09, 5.0, 0x6d7378, 8, 0.5)
    post.position.set(lx, 2.5, HALF_D + 10.5)
    streetGroup.add(post)
    const head = box(1.1, 0.14, 0.3, 0x6d7378, { metal: 0.5 })
    head.position.set(lx + 0.45, 4.95, HALF_D + 10.5)
    streetGroup.add(head)
    const lamp = new THREE.PointLight(0xfff0cf, hour >= 18 || hour < 6 ? 0.9 : 0.1, 16)
    lamp.position.set(lx + 0.9, 4.8, HALF_D + 10.5)
    streetGroup.add(lamp)
  }

  // (static parked cars replaced by the animated traffic below)

  /* --------------------------------------------------- living street ------ */
  // Pedestrians and traffic animated from the scene tick. They are collected in
  // arrays the caller advances each frame, so nothing here needs a timer.
  const walkers: { obj: THREE.Group; legs: THREE.Object3D[]; from: number; to: number; z: number; speed: number; t: number }[] = []
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
    const sidewalkZ = HALF_D + 11.6
    const from = -34 + i * 11
    g.position.set(from, 0, sidewalkZ)
    streetGroup.add(g)
    walkers.push({ obj: g, legs, from, to: 38, z: sidewalkZ, speed: 1.1 + (i % 3) * 0.25, t: i * 0.7 })
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

  const LANE_NORTH = HALF_D + 13.6
  const LANE_SOUTH = HALF_D + 15.4
  const CAR_COLORS = [0xb9563f, 0x3f6fb9, 0xd8d3c4, 0x4f7a5f, 0x8a8f95]
  for (let i = 0; i < 5; i++) {
    const forward = i % 2 === 0
    const c = makeVehicle(CAR_COLORS[i % CAR_COLORS.length])
    const z = forward ? LANE_NORTH : LANE_SOUTH
    c.rotation.y = forward ? Math.PI / 2 : -Math.PI / 2
    const x0 = forward ? -46 - i * 14 : 46 + i * 14
    const x1 = forward ? 46 + i * 8 : -46 - i * 8
    c.position.set(x0, 0, z)
    streetGroup.add(c)
    vehicles.push({ obj: c, x0, x1, z, speed: 6 + (i % 3) * 2 })
  }

  /** Advance the street. Called from the scene tick with the frame delta. */
  function animateStreet(dt: number, t: number) {
    for (const w of walkers) {
      const span = w.to - w.from
      w.t += (w.speed * dt) / span
      if (w.t > 1) w.t -= 1
      const x = w.from + span * w.t
      w.obj.position.x = x
      w.obj.position.z = w.z + Math.sin(x * 0.3) * 0.14
      w.obj.rotation.y = Math.PI / 2
      const swing = Math.sin(t * 7 * w.speed + x) * 0.5
      w.legs[0].rotation.x = swing
      w.legs[1].rotation.x = -swing
      const arms = w.obj.userData.arms as THREE.Object3D[]
      arms[0].rotation.x = -swing * 0.7
      arms[1].rotation.x = swing * 0.7
    }
    for (const v of vehicles) {
      const span = v.x1 - v.x0
      v.obj.position.x += Math.sign(span) * v.speed * dt
      if (Math.sign(span) > 0 ? v.obj.position.x > v.x1 : v.obj.position.x < v.x1) {
        v.obj.position.x = v.x0
      }
      void v.z
    }
  }

  streetGroup.visible = true

  /* ---------------------------------------------------------- apply state -- */
  function applyPalette(h: number) {
    pal = paletteFor(h)
    const night = h >= 18 || h < 6
    wallMat.color.setHex(pal.wall)
    sun.intensity = night ? 1.1 : 1.85
    sun.color.setHex(night ? 0xc9d8ee : 0xfff6e5)
    fill.intensity = night ? 0.9 : 1.0
    for (const l of lamps) l.intensity = night ? 0.85 : 0
    for (const s of streaks) (s.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 1.5 : 0.85
  }

  function dispose() {
    for (const d of disposables) d.dispose()
  }

  return { group, monitors, lamps, boardSurface, streaks, streetGroup, animateStreet, applyPalette, dispose }
}
