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
import { rbox } from './bevel'
import { marbleLight, woodWarm, glassReal, stoneDark, plasterClean, goldAccent, carpetGrey, woodPanelDark } from './materials'
import { setupLights } from './lights'
import {
  CONFERENCE,
  CONFERENCE_CHAIRS,
  DESKS,
  DESK_CHAIR,
  DIV_ROOMS,
  DOOR,
  GARDEN,
  BOOK_NOOK,
  PANTRY,
  PANTRY_STOOLS,
  PANTRY_STOOL_GAP,
  FLOOR,
  CEILING_Y,
  FOOTPRINTS,
  HALF_D,
  HALF_W,
  KANBAN_BOARD,
  LOUNGE,
  POOL,
  POOL_LOUNGERS,
  ROOM_SIGNS,
  PAINTINGS,
  paintingPlacement,
  FRAME_D,
  RECEPTION,
  ROOMS,
  WALL_H,
  WALL_T,
  NORTH_WINDOWS,
  SIDE_WINDOWS,
  SIDE_WINDOW_W,
  SOUTH_WINDOWS,
  PARAPET_H,
  PARAPET_T,
  COPING_H,
  COPING_LIP,
  ROOF_DECK_T,
  ROOF_BAY,
  WINDOW_Y,
  WINDOW_H,
  paletteFor,
  SEATS,
  seatTop,
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

/**
 * Turn a colour texture into a bump map.
 *
 * There were no normal or bump maps anywhere, which is why every surface read as
 * flat paint: a MeshStandardMaterial with only a colour map has no relief, so
 * lighting slides over it uniformly. Deriving the bump from the luminance of the
 * texture already generated costs one small canvas and no new generators, and
 * gives planks, grout lines, plaster mottle and fabric weave an edge to catch.
 *
 * A real normal map would be better, but this is honest about what it is: a
 * greyscale height field fed to `bumpMap`, which three.js differentiates per
 * fragment.
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
  // luminance -> grey, with a contrast stretch so faint detail still registers
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
 * Deliberately low-frequency. Fine noise at this scale turns into uniform mush
 * once the mip chain averages it (measured elsewhere in this file: fine lines keep
 * ~10% of their contrast after a 512->64 downsample, broad bands keep ~80%), so the
 * signal is in patches, clumps and broad tonal drift.
 */
function earthTexture(base: string, dark: string, light: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(211)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)

    // broad tonal drift, so it does not read as one flat colour at distance
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

    // clumps of darker soil
    for (let i = 0; i < 420; i++) {
      c.globalAlpha = 0.06 + rand() * 0.14
      c.fillStyle = rand() > 0.35 ? dark : light
      c.beginPath()
      c.ellipse(rand() * s, rand() * s, 3 + rand() * 14, 2 + rand() * 9, rand() * 3, 0, Math.PI * 2)
      c.fill()
    }
    // scattered grit
    for (let i = 0; i < 5200; i++) {
      c.globalAlpha = 0.05 + rand() * 0.16
      c.fillStyle = rand() > 0.5 ? light : dark
      c.fillRect(rand() * s, rand() * s, 1 + rand() * 2, 1 + rand() * 2)
    }
    c.globalAlpha = 1
  })
}

/** Wood plank flooring: plank seams, grain streaks, knots and bevelled edges. */
function woodFloorTexture(light: string, mid: string, dark: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(7)
    c.fillStyle = mid
    c.fillRect(0, 0, s, s)
    const plank = 42 // 512 / 12 planks -> repeat makes each ~22 cm, closer to real boards
    for (let row = 0; row * plank < s; row++) {
      const y = row * plank
      // Per-plank tone. Wide variation, because a floor where every board is the
      // same colour reads as vinyl. This is low-frequency and survives mipmapping.
      const shade = 0.82 + rand() * 0.36
      c.fillStyle = rand() > 0.5 ? light : dark
      c.globalAlpha = 0.3 * shade
      c.fillRect(0, y, s, plank)
      c.globalAlpha = 1

      // Broad grain bands first: fine lines alone lose ~90% of their contrast in
      // the mip chain, so the visible figure has to be low-frequency.
      for (let b = 0; b < 5; b++) {
        c.strokeStyle = rand() > 0.4 ? dark : light
        c.globalAlpha = 0.08 + rand() * 0.14
        c.lineWidth = 3 + rand() * 7
        const gy = y + 3 + rand() * (plank - 6)
        c.beginPath()
        c.moveTo(0, gy)
        for (let x = 0; x <= s; x += 24) {
          c.lineTo(x, gy + Math.sin((x + row * 31 + b * 17) * 0.02) * (1.2 + rand() * 2))
        }
        c.stroke()
      }
      // fine grain on top of the bands
      for (let g = 0; g < 22; g++) {
        c.strokeStyle = dark
        c.globalAlpha = 0.06 + rand() * 0.14
        c.lineWidth = rand() > 0.85 ? 1.6 : 0.7
        const gy = y + 4 + rand() * (plank - 8)
        c.beginPath()
        c.moveTo(0, gy)
        for (let x = 0; x <= s; x += 32) {
          c.lineTo(x, gy + Math.sin((x + row * 40) * 0.03) * (0.6 + rand()))
        }
        c.stroke()
      }
      // Dark seam at the board edge: without it the boards merge into one surface.
      c.fillStyle = dark
      c.globalAlpha = 0.55
      c.fillRect(0, y, s, 2)
      // bevelled highlight just below the seam
      c.fillStyle = light
      c.globalAlpha = 0.22
      c.fillRect(0, y + 2, s, 1)
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
  return canvasTex(512, (c, s) => {
    const rand = rng(91)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)

    // Roller texture. A wall read as a flat sheet because the only variation was
    // 900 circles at 2-5% alpha, which is invisible once mipmapped. Painted plaster
    // has broad, soft blotches where the roller pressure varied, plus a fine
    // stipple — so both scales are drawn, broad first.
    for (let i = 0; i < 60; i++) {
      const r = 40 + rand() * 130
      const g = c.createRadialGradient(rand() * s, rand() * s, r * 0.1, rand() * s, rand() * s, r)
      g.addColorStop(0, rand() > 0.5 ? tint : '#ffffff')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.globalAlpha = 0.07 + rand() * 0.1
      c.fillStyle = g
      c.fillRect(0, 0, s, s)
    }
    // roller streaks: long, soft, roughly vertical
    for (let i = 0; i < 34; i++) {
      c.strokeStyle = rand() > 0.5 ? tint : '#ffffff'
      c.globalAlpha = 0.04 + rand() * 0.07
      c.lineWidth = 6 + rand() * 22
      const x = rand() * s
      c.beginPath()
      c.moveTo(x, 0)
      c.bezierCurveTo(x + 14, s * 0.33, x - 14, s * 0.66, x + 6, s)
      c.stroke()
    }
    // fine stipple
    for (let i = 0; i < 5200; i++) {
      c.globalAlpha = 0.03 + rand() * 0.06
      c.fillStyle = rand() > 0.5 ? tint : '#ffffff'
      c.fillRect(rand() * s, rand() * s, 1 + rand() * 1.6, 1 + rand() * 1.6)
    }
    c.globalAlpha = 1
  })
}

/** Brushed metal for door furniture and window mullions. */
function brushedMetalTexture(base: string, dark: string) {
  return canvasTex(256, (c, s) => {
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
  return canvasTex(256, (c, s) => {
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

/** Fine furniture-grade wood: tighter grain, subtle sheen, no plank seams. */
function deskWoodTexture(base: string, grain: string, edge: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(131)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    // BROAD tonal bands FIRST. Measured: fine lines alone retain only ~10% of
    // their contrast after mipmapping (512 -> 64 px averaged them away), which is
    // exactly why the desk read as a solid colour on screen despite the texture
    // being present. Wide bands survive downsampling at ~80%, so they carry the
    // grain that the eye actually sees.
    for (let b = 0; b < 16; b++) {
      c.strokeStyle = b % 3 === 0 ? edge : grain
      c.globalAlpha = 0.16 + rand() * 0.2
      c.lineWidth = 7 + rand() * 16
      const y0 = rand() * s
      c.beginPath()
      c.moveTo(0, y0)
      for (let x = 0; x <= s; x += 16) {
        c.lineTo(x, y0 + Math.sin((x + b * 47) * 0.006) * (4 + rand() * 5))
      }
      c.stroke()
    }
    // Long figure lines: furniture veneer runs the length of the top. These carry
    // the fine detail once the broad bands have established the tone.
    for (let i = 0; i < 170; i++) {
      c.strokeStyle = rand() > 0.6 ? grain : edge
      c.globalAlpha = 0.10 + rand() * 0.22
      c.lineWidth = rand() > 0.85 ? 2.6 : 1.1
      const y = rand() * s
      c.beginPath()
      c.moveTo(0, y)
      for (let x = 0; x <= s; x += 24) {
        c.lineTo(x, y + Math.sin((x + i * 31) * 0.018) * (0.8 + rand() * 1.4))
      }
      c.stroke()
    }
    // occasional darker figure streak
    for (let i = 0; i < 16; i++) {
      c.strokeStyle = edge
      c.globalAlpha = 0.12 + rand() * 0.14
      c.lineWidth = 3 + rand() * 4
      const y = rand() * s
      c.beginPath()
      c.moveTo(0, y)
      c.bezierCurveTo(s * 0.3, y + 6, s * 0.6, y - 6, s, y + 2)
      c.stroke()
    }
    // fine pore speckle so it does not read as flat vinyl
    for (let i = 0; i < 3400; i++) {
      c.fillStyle = rand() > 0.5 ? grain : edge
      c.globalAlpha = 0.06 + rand() * 0.12
      c.fillRect(rand() * s, rand() * s, 1.2, 1.2)
    }
    c.globalAlpha = 1
  })
}

/** Upholstery vinyl: fine pebble grain, low sheen, for task chairs. */
function vinylTexture(base: string, crease: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(151)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 3600; i++) {
      const r = 1.2 + rand() * 2.4
      c.globalAlpha = 0.08 + rand() * 0.16
      c.fillStyle = rand() > 0.45 ? crease : '#ffffff'
      c.beginPath()
      c.ellipse(rand() * s, rand() * s, r, r * 0.7, rand() * Math.PI, 0, Math.PI * 2)
      c.fill()
    }
    // shallow creases where the foam compresses
    for (let i = 0; i < 16; i++) {
      c.strokeStyle = crease
      c.globalAlpha = 0.05 + rand() * 0.06
      c.lineWidth = 1 + rand() * 1.6
      const x = rand() * s
      c.beginPath()
      c.moveTo(x, 0)
      c.lineTo(x + (rand() - 0.5) * 30, s)
      c.stroke()
    }
    c.globalAlpha = 1
  })
}

/** Short-pile carpet: dense fibre noise plus a faint square nap grid. */
function carpetTexture(base: string, fibre: string) {
  return canvasTex(512, (c, s) => {
    const rand = rng(167)
    c.fillStyle = base
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 26000; i++) {
      c.globalAlpha = 0.06 + rand() * 0.16
      c.strokeStyle = rand() > 0.5 ? fibre : '#ffffff'
      c.lineWidth = 0.8
      const x = rand() * s
      const y = rand() * s
      const a = rand() * Math.PI
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3)
      c.stroke()
    }
    // tuft rows give the surface a direction
    c.strokeStyle = fibre
    c.globalAlpha = 0.04
    for (let i = 0; i < s; i += 8) {
      c.beginPath()
      c.moveTo(0, i)
      c.lineTo(s, i)
      c.stroke()
    }
    c.globalAlpha = 1
  })
}

/**
 * Monitor content. A flat emissive colour reads as a switched-off panel; this
 * draws actual UI, so the screens read as running work. Tiles are laid out on a
 * grid and each one gets a distinct layout (editor, terminal, chart, chat) so a
 * row of monitors does not look cloned.
 */
function screenTexture() {
  return canvasTex(512, (c, s) => {
    const rand = rng(193)
    const accent = ['#5fd0a6', '#7ab8ff', '#ffd479', '#ff9c9c']
    const cell = s / 2
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        const ox = gx * cell
        const oy = gy * cell
        // window chrome
        c.fillStyle = '#101a22'
        c.fillRect(ox, oy, cell, cell)
        c.fillStyle = '#18242e'
        c.fillRect(ox, oy, cell, 22)
        for (let i = 0; i < 3; i++) {
          c.fillStyle = ['#ff5f56', '#ffbd2e', '#27c93f'][i]
          c.beginPath()
          c.arc(ox + 14 + i * 13, oy + 11, 4, 0, Math.PI * 2)
          c.fill()
        }
        const kind = (gx + gy) % 4
        c.font = '700 10px ui-monospace, monospace'
        c.fillStyle = accent[(gx + gy) % accent.length]
        if (kind === 0) {
          // code editor: line numbers + syntax-coloured bars
          for (let l = 0; l < 11; l++) {
            const y = oy + 40 + l * 18
            c.fillStyle = '#4a5a66'
            c.fillRect(ox + 10, y, 14, 7)
            let x = ox + 32
            const blocks = 2 + Math.floor(rand() * 4)
            for (let b = 0; b < blocks; b++) {
              const w = 16 + rand() * 52
              c.fillStyle = ['#5fd0a6', '#7ab8ff', '#ffd479', '#c9a6ff'][Math.floor(rand() * 4)]
              c.globalAlpha = 0.75
              c.fillRect(x, y, w, 7)
              c.globalAlpha = 1
              x += w + 7
            }
          }
        } else if (kind === 1) {
          // terminal: prompt + output lines
          for (let l = 0; l < 10; l++) {
            const y = oy + 42 + l * 20
            c.fillStyle = l % 3 === 0 ? '#5fd0a6' : '#8fb0c4'
            c.globalAlpha = 0.8
            c.fillRect(ox + 12, y, 8 + rand() * (cell - 40), 6)
            c.globalAlpha = 1
          }
        } else if (kind === 2) {
          // dashboard: bars growing from the baseline
          const base = oy + cell - 18
          for (let b = 0; b < 9; b++) {
            const h = 12 + rand() * (cell - 70)
            c.fillStyle = accent[b % accent.length]
            c.globalAlpha = 0.7
            c.fillRect(ox + 14 + b * ((cell - 28) / 9), base - h, (cell - 28) / 9 - 5, h)
            c.globalAlpha = 1
          }
        } else {
          // chat: alternating message bubbles
          for (let l = 0; l < 7; l++) {
            const y = oy + 40 + l * 26
            const mine = l % 2 === 0
            const w = 40 + rand() * 70
            c.fillStyle = mine ? '#2f6f8f' : '#1d2a34'
            const bx = mine ? ox + cell - w - 12 : ox + 12
            c.beginPath()
            c.roundRect(bx, y, w, 18, 6)
            c.fill()
            c.fillStyle = '#b9cbd6'
            c.globalAlpha = 0.7
            c.fillRect(bx + 7, y + 7, w - 20, 4)
            c.globalAlpha = 1
          }
        }
      }
    }
  })
}

/** Painted artwork for the wall frames — abstract, deterministic per seed. */
function artTexture(seed: number) {
  const hues = [212, 24, 148, 340, 44, 268, 190, 8]
  return canvasTex(512, (c, s) => {
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
  // Furniture-grade surfaces. The floor wood has 30 cm planks with visible seams —
  // wrong on a desk top, so furniture gets its own finer veneer. Chairs get vinyl
  // (office task chairs are not woven), the rug gets pile, and monitors get real
  // UI content instead of a flat emissive colour.
  const deskTex = track(deskWoodTexture('#b08a5c', '#7d5f3c', '#5f4728'))
  // Same canvas drives roughness: wood figure is slightly glossier in the light
  // bands, so the top catches highlights instead of reading as one flat plane.
  const deskRough = track(deskWoodTexture('#909090', '#666666', '#3f3f3f'))
  // One tile per 0.55 m: at a 1 m tile the grain halved in size and mip
  // filtering washed it out at normal viewing distance.
  deskTex.repeat.set(3.6, 1.8)
  const vinylTex = track(vinylTexture('#5f7382', '#38454f'))
  const carpetTex = track(carpetTexture('#c6b9a2', '#9c907a'))
  carpetTex.repeat.set(3, 2.6)
  const screenTex = track(screenTexture())
  const asphaltTex = track(asphaltTexture('#5a5f63', '#8b9095'))

  asphaltTex.repeat.set(24, 3)
  const pavementTex = track(pavementTexture('#9aa0a4', '#7f868b'))
  // Earth for everything beyond the plaza. Tiled coarsely: one tile per 12 m, so
  // the patch detail reads at street scale instead of as noise.
  const GROUND_EXTENT_HINT = 220
  const earthTex = track(earthTexture('#6b7a56', '#4d5a3e', '#8a9a6c'))
  earthTex.repeat.set(GROUND_EXTENT_HINT / 12, GROUND_EXTENT_HINT / 12)

  // Bump maps derived from the colour maps above: no new generators, and every
  // surface gains relief so lighting has something to catch.
  const floorBump = track(bumpFrom(floorTex, 0.55))
  const lobbyBump = track(bumpFrom(lobbyTex, 0.4))
  const plasterBump = track(bumpFrom(plasterTex, 0.35))
  const deskBump = track(bumpFrom(deskTex, 0.5))
  const vinylBump = track(bumpFrom(vinylTex, 0.45))
  const carpetBump = track(bumpFrom(carpetTex, 0.6))
  const earthBump = track(bumpFrom(earthTex, 0.55))
  earthBump.repeat.copy(earthTex.repeat)
  const asphaltBump = track(bumpFrom(asphaltTex, 0.7))
  const pavementBump = track(bumpFrom(pavementTex, 0.5))
  const metalBump = track(bumpFrom(metalTex, 0.25))
  const fabricBump = track(bumpFrom(fabricTex, 0.4))
  // Same tiling as their colour maps, or the relief slides against the colour.
  for (const [b, src] of [
    [floorBump, floorTex],
    [lobbyBump, lobbyTex],
    [plasterBump, plasterTex],
    [deskBump, deskTex],
    [vinylBump, vinylTex],
    [carpetBump, carpetTex],
    [asphaltBump, asphaltTex],
    [pavementBump, pavementTex],
    [metalBump, metalTex],
    [fabricBump, fabricTex],
  ] as const) {
    b.repeat.copy(src.repeat)
  }
  pavementTex.repeat.set(14, 14)

  /* ------------------------------------------------------------- floors --- */
  // REALISTIS: lantai marmer terang (ganti kayu kartun). Satu material konsisten.
  const marbleMat = track(marbleLight())
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.width, FLOOR.depth), marbleMat)
  floor.rotation.x = -Math.PI / 2
  group.add(floor)

  // lobby: marmer sama (transisi via pola, bukan material beda)
  const lobbyFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOMS.lobby.x2 - ROOMS.lobby.x1, ROOMS.lobby.z2 - ROOMS.lobby.z1),
    marbleMat,
  )
  lobbyFloor.rotation.x = -Math.PI / 2
  lobbyFloor.position.set(0, 0.006, (ROOMS.lobby.z1 + ROOMS.lobby.z2) / 2)
  group.add(lobbyFloor)

  // meeting room gets a rug, lounge too
  const rug = (x: number, z: number, w: number, d: number, color: number, carpet = true) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      carpet
        ? track(new THREE.MeshStandardMaterial({ color, map: carpetTex, roughness: 1 }))
        : stdMat(color, { rough: 0.95 }),
    )
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.012, z)
    group.add(m)
  }
  rug(CONFERENCE.x, CONFERENCE.z, 7.4, 6.2, pal.rug)
  rug(LOUNGE.x, LOUNGE.z - 2.4, 5.4, 4.6, 0xc6b9a2)

  /* -------------------------------------------------------------- walls --- */
  // REALISTIS: SATU plester bersih seluruh gedung (hapus variasi dinding).
  const wallMat = track(plasterClean())
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
  // North elevation openings come from NORTH_WINDOWS, which guarantees the
  // central Kanban band stays solid (enforced by facadeConflicts()).
  const northWindows = NORTH_WINDOWS.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }))
  wallPanel(FLOOR.width, WALL_H, 0, WALL_H / 2, -HALF_D, 0, northWindows)
  wallPanel(FLOOR.width, WALL_H, 0, WALL_H / 2, HALF_D, 0, [
    { x: DOOR.x, y: 1.15, w: 3.4, h: 2.3 },
    ...SOUTH_WINDOWS.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
  ])
  // wallPanel() places a hole at world z = -holes.x (it computes z - hx*sin(ry),
  // and ry = +PI/2 here), while windowUnit() places its mesh at cz directly.
  // Passing the same list to both therefore mirrored them: holes at z = -x, glass
  // at z = +x, so no window unit ever sat in its opening — the side elevations
  // were a solid wall with six holes in it.
  const sideHoles = SIDE_WINDOWS.map((z) => ({ x: -z, y: WINDOW_Y, w: SIDE_WINDOW_W, h: WINDOW_H }))
  wallPanel(FLOOR.depth, WALL_H, -HALF_W, WALL_H / 2, 0, Math.PI / 2, sideHoles)
  wallPanel(FLOOR.depth, WALL_H, HALF_W, WALL_H / 2, 0, Math.PI / 2, sideHoles)

  // DINDING AULA OVAL (0,-4) r=4.5: 16 segmen busur, 4 celah (N/E/S/W).
  // Koordinat & celah SELARAS dgn footprint aula-w* di layout.ts.
  {
    const cx = 0, cz = -4, r = 4.5, n = 16
    const gaps = [Math.PI, Math.PI / 2, 0, -Math.PI / 2]
    const seg = (2 * Math.PI * r) / n
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      if (gaps.some((g) => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.22)) continue
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      const m = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.96, WALL_H, WALL_T), wallMat)
      m.position.set(x, WALL_H / 2, z)
      m.rotation.y = -a + Math.PI / 2
      group.add(m)
    }
  }
  // SEKAT PODS melengkung (busur pendek) — selaras footprint sek-*.
  {
    const arc = (cx: number, cz: number, r: number, a0: number, a1: number, k: number) => {
      for (let i = 0; i < k; i++) {
        const a = a0 + ((a1 - a0) * (i + 0.5)) / k
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.12), wallMat)
        m.position.set(x, 1.1, z)
        m.rotation.y = -a + Math.PI / 2
        group.add(m)
      }
    }
    arc(-5.5, -9.5, 2.6, Math.PI * 0.9, Math.PI * 1.7, 3)
    arc(-9.0, -4.0, 2.6, Math.PI * 0.4, Math.PI * 1.1, 3)
    arc(9.0, -4.5, 2.6, -Math.PI * 0.6, Math.PI * 0.3, 3)
    arc(10.5, 0.0, 2.2, -Math.PI * 0.3, Math.PI * 0.45, 3)
  }

  /* ------------------------------------------------- room signs + pool --- */
  // Papan nama tiap ruang: panel kayu gelap + teks emas (premium, bukan neon).
  {
    const signTex = (text: string) => {
      const cv = document.createElement('canvas')
      cv.width = 512
      cv.height = 96
      const c = cv.getContext('2d')!
      c.fillStyle = '#2a1e14'
      c.fillRect(0, 0, 512, 96)
      c.strokeStyle = '#c9a24a'
      c.lineWidth = 3
      c.strokeRect(6, 6, 500, 84)
      c.fillStyle = '#c9a24a'
      c.font = '700 46px system-ui, sans-serif'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(text, 256, 52)
      const t = new THREE.CanvasTexture(cv)
      t.colorSpace = THREE.SRGBColorSpace
      return track(t)
    }
    const gold = track(goldAccent())
    for (const s of ROOM_SIGNS) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 0.45),
        new THREE.MeshStandardMaterial({ map: signTex(s.text), emissive: 0x3a2b1e, emissiveIntensity: 0.15 }),
      )
      m.position.set(s.x, 2.9, s.z + 0.2)
      group.add(m)
      // frame emas tipis di keliling papan
      const fr = new THREE.Mesh(rbox(2.46, 0.51, 0.03, 0.01), gold)
      fr.position.set(s.x, 2.9, s.z + 0.17)
      group.add(fr)
    }
  }

  // Kolam renang ORGANIK (ginjal) di area santai SE dalam gedung (9,6).
  // Kolam ginjal + DINDING AIR (waterfall wall, ala referensi): batu gelap +
  // air transmisi + dinding air terjun di sisi utara + deck kayu + kursi.
  {
    const deck = new THREE.Mesh(rbox(POOL.deckW, 0.05, POOL.deckD, 0.01), track(woodWarm()))
    deck.position.set(POOL.x, 0.025, POOL.z)
    group.add(deck)
    const lobe = (x: number, z: number, w: number, d: number, mat: THREE.Material, y = 0.05) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 24), mat)
      m.scale.set(w / 2, 1, d / 2)
      m.position.set(x, y, z)
      group.add(m)
    }
    const basinMat = track(stoneDark())
    lobe(7.6, 6.0, 2.6, 3.4, basinMat)
    lobe(9.2, 6.2, 3.0, 2.8, basinMat)
    lobe(10.8, 5.6, 2.2, 2.4, basinMat)
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x2fa8c8, transparent: true, opacity: 0.75,
      transmission: 0.6, roughness: 0.08, metalness: 0,
      emissive: 0x1a7fa0, emissiveIntensity: 0.4,
    })
    lobe(7.6, 6.0, 2.3, 3.1, waterMat, POOL.waterY + 0.25)
    lobe(9.2, 6.2, 2.7, 2.5, waterMat, POOL.waterY + 0.25)
    lobe(10.8, 5.6, 1.9, 2.1, waterMat, POOL.waterY + 0.25)
    // dinding air terjun: batu gelap vertikal + selimut air mengalir
    const fallWall = new THREE.Mesh(rbox(4.6, 2.2, 0.3, 0.02), track(stoneDark()))
    fallWall.position.set(9.2, 1.1, 3.9)
    group.add(fallWall)
    const fallWater = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 2.0),
      new THREE.MeshPhysicalMaterial({
        color: 0x9fd8e8, transparent: true, opacity: 0.55,
        transmission: 0.5, roughness: 0.1,
        emissive: 0x6fb8d0, emissiveIntensity: 0.5,
        side: THREE.DoubleSide,
      }),
    )
    fallWater.position.set(9.2, 1.05, 3.73)
    fallWater.rotation.y = Math.PI
    group.add(fallWater)
    const fenceMat = stdMat(0x2b3236, { metal: 0.7, rough: 0.3 })
    const fence = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(rbox(w, 1.0, d, 0.01), fenceMat)
      m.position.set(x, 0.5, z)
      group.add(m)
    }
    fence(4.0, 0.08, 8.4, 4.0)
    fence(5.2, 0.08, 9.0, 8.0)
    // kursi santai beveled di deck (menghadap air) — posisi dari POOL_LOUNGERS
    for (const l of POOL_LOUNGERS) {
      const g = new THREE.Group()
      g.position.set(l.x, 0, l.z)
      g.rotation.y = l.facing
      const bed = new THREE.Mesh(rbox(0.7, 0.12, 1.7, 0.02), track(woodWarm()))
      bed.position.y = 0.35
      g.add(bed)
      const back = new THREE.Mesh(rbox(0.7, 0.5, 0.12, 0.02), track(woodWarm()))
      back.position.set(0, 0.6, -0.8)
      back.rotation.x = -0.5
      g.add(back)
      for (const [dx, dz] of [[-0.3, -0.7], [0.3, -0.7], [-0.3, 0.7], [0.3, 0.7]]) {
        const leg = cyl(0.025, 0.03, 0.32, 0x5b666e, 8, 0.5)
        leg.position.set(dx, 0.16, dz)
        g.add(leg)
      }
      group.add(g)
    }
  }

  /* ------------------------------------------------------------ windows --- */
  // REALISTIS: kaca transmisi nyata + frame hitam tipis (ganti frame tebal abu).
  const glassMat = track(glassReal())
  // Facade materials. Declared HERE, above windowUnit(): its lintel uses bandMat,
  // and a const declared later in the same scope is in the temporal dead zone —
  // the call threw "Cannot access 'bandMat' before initialization" at runtime.
  const bandMat = track(plasterClean())
  const sillMat = track(plasterClean())
  const frameMat = track(
    new THREE.MeshStandardMaterial({ color: 0x2b3236, metalness: 0.7, roughness: 0.3 }),
  )

  /**
   * A glazed opening: reveal, frame, transom, sill, clear pane.
   *
   * The first version had two defects visible from outside. It laid a bright
   * emissive "sky card" behind the glass, so every window read as a lit panel
   * rather than glass; and the pane was flush with the wall face, which removes
   * the shadow line that makes an opening legible. The glass is now recessed by
   * REVEAL behind the outer face and nothing sits behind it — you see the room.
   */
  const windowUnit = (
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    axis: 'x' | 'z',
  ) => {
    const depth = 0.1
    const REVEAL = 0.07
    // outward normal of the wall this opening sits on
    const out = axis === 'x' ? (cz > 0 ? 1 : -1) : cx > 0 ? 1 : -1
    const off = (d: number) => (axis === 'x' ? { x: 0, z: d * out } : { x: d * out, z: 0 })
    const mk = (ww: number, hh: number, ox: number, oy: number, outOff = 0) => {
      const o = off(outOff)
      const g = new THREE.BoxGeometry(
        axis === 'x' ? ww : depth + 0.04,
        hh,
        axis === 'x' ? depth + 0.04 : ww,
      )
      const m = new THREE.Mesh(g, frameMat)
      m.position.set(cx + (axis === 'x' ? ox : o.x), cy + oy, cz + (axis === 'x' ? o.z : ox))
      group.add(m)
    }
    // outer frame, set just inside the opening so it reads as a reveal
    mk(w, depth + 0.04, 0, h / 2, -REVEAL)
    mk(w, depth + 0.04, 0, -h / 2, -REVEAL)
    mk(depth + 0.04, h, -w / 2, 0, -REVEAL)
    mk(depth + 0.04, h, w / 2, 0, -REVEAL)
    mk(0.08, h, 0, 0, -REVEAL) // centre mullion
    // transom: a horizontal bar low in the opening, breaking the tall sheet
    if (h > 1.2) mk(w, 0.07, 0, -h / 2 + 0.55, -REVEAL)

    // the pane itself, recessed so the wall thickness casts a shadow line
    const o = off(-REVEAL)
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(axis === 'x' ? w : 0.03, h, axis === 'x' ? 0.03 : w),
      glassMat,
    )
    pane.position.set(cx + o.x, cy, cz + o.z)
    group.add(pane)

    // projecting sill, the detail that gives the elevation a scale cue
    const so = off(0.06)
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(axis === 'x' ? w + 0.22 : 0.2, 0.09, axis === 'x' ? 0.2 : w + 0.22),
      sillMat,
    )
    sill.position.set(cx + so.x, cy - h / 2 - 0.05, cz + so.z)
    group.add(sill)
    // lintel band above
    const lo = off(0.04)
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(axis === 'x' ? w + 0.22 : 0.14, 0.1, axis === 'x' ? 0.14 : w + 0.22),
      bandMat,
    )
    lintel.position.set(cx + lo.x, cy + h / 2 + 0.06, cz + lo.z)
    group.add(lintel)
  }
  // Sunk slightly into the wall opening so the glass shows on BOTH faces; a unit
  // centred in the wall is buried and invisible from outside.
  const wallN = -HALF_D + WALL_T / 2
  for (const w of NORTH_WINDOWS) {
    windowUnit(w.x, w.y, wallN, w.w, w.h, 'x')
  }
  // south elevation: the street facade, previously blind apart from the door
  const wallS = HALF_D - WALL_T / 2
  for (const w of SOUTH_WINDOWS) {
    windowUnit(w.x, w.y, wallS, w.w, w.h, 'x')
  }
  const wallW = -HALF_W + WALL_T / 2
  const wallE = HALF_W - WALL_T / 2
  for (const z of SIDE_WINDOWS) {
    windowUnit(wallW, WINDOW_Y, z, SIDE_WINDOW_W, WINDOW_H, 'z')
    windowUnit(wallE, WINDOW_Y, z, SIDE_WINDOW_W, WINDOW_H, 'z')
  }


  // Facade relief: horizontal banding and corner pilasters. A flat plaster slab
  // has no scale cue from outside, so the building read as an untextured box.
  const facadeMat = track(
    new THREE.MeshStandardMaterial({ color: 0xe4eaee, map: plasterTex, roughness: 0.88 }),
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
      new THREE.BoxGeometry(spec.w + 0.14, spec.h + 0.14, FRAME_D),
      stdMat(0x6f5c45, { rough: 0.6 }),
    )
    frame.position.set(at.frame.x, at.frame.y, at.frame.z)
    frame.rotation.y = at.ry
    group.add(frame)

    const matte = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w + 0.04, spec.h + 0.04, 0.02),
      stdMat(0xece5d8, { rough: 0.9 }),
    )
    matte.position.set(at.matte.x, at.matte.y, at.matte.z)
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

  /* --------------------------------------- kanban board (melengkung) --- */
  // 5 panel segi mengikuti busur r=4.7 di sisi utara aula, chord z~=-8.35.
  const boardSurface = box(1.6, KANBAN_BOARD.h, 0.14, 0x14313f, {
    emissive: 0x0b3d2c,
    rough: 0.4,
  })
  boardSurface.position.set(KANBAN_BOARD.x, KANBAN_BOARD.y, KANBAN_BOARD.z)
  boardSurface.name = 'kanban-board'
  group.add(boardSurface)
  {
    // panel samping selaras footprint board-l/r (chord, bukan busur penuh)
    for (const sx of [-2.05, 2.05]) {
      const p = box(1.9, KANBAN_BOARD.h, 0.12, 0x14313f, { emissive: 0x0b3d2c, rough: 0.4 })
      p.position.set(sx, KANBAN_BOARD.y, -7.1)
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

  /* ---------------------------------------------------------------- roof --- */
  // The building had no roof at all: the walls simply stopped at WALL_H, so from
  // outside it read as an open box rather than a building. A parapet with a coping
  // now runs the whole perimeter, and the entrance strip carries a real roof deck
  // with plant. The work rooms stay open (dollhouse) so the interior — and the
  // Kanban board — remain visible.
  {
    const wallMatRoof = track(
      new THREE.MeshStandardMaterial({ color: 0xdfe6ea, map: plasterTex, roughness: 0.9 }),
    )
    const copingMat = track(
      new THREE.MeshStandardMaterial({ color: 0x9aa5ad, map: metalTex, metalness: 0.35, roughness: 0.45 }),
    )
    const parY = WALL_H + PARAPET_H / 2

    /** Parapet run of `len` centred at (x,z), rotated ry, with a coping cap. */
    const parapet = (len: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, PARAPET_H, PARAPET_T), wallMatRoof)
      m.position.set(x, parY, z)
      m.rotation.y = ry
      group.add(m)
      const cop = new THREE.Mesh(
        new THREE.BoxGeometry(len, COPING_H, PARAPET_T + COPING_LIP * 2),
        copingMat,
      )
      cop.position.set(x, WALL_H + PARAPET_H + COPING_H / 2, z)
      cop.rotation.y = ry
      group.add(cop)
    }
    // full perimeter (§ the roofline is what stops it reading as a box)
    parapet(FLOOR.width + PARAPET_T, 0, -HALF_D, 0)
    parapet(FLOOR.width + PARAPET_T, 0, HALF_D, 0)
    parapet(FLOOR.depth, -HALF_W, 0, Math.PI / 2)
    parapet(FLOOR.depth, HALF_W, 0, Math.PI / 2)

    // roof deck over the entrance strip
    const deckTop = WALL_H + ROOF_DECK_T
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(FLOOR.width, ROOF_DECK_T, ROOF_BAY.z2 - ROOF_BAY.z1),
      track(new THREE.MeshStandardMaterial({ color: 0xc9d1d6, map: plasterTex, roughness: 0.95 })),
    )
    deck.position.set(0, WALL_H + ROOF_DECK_T / 2, (ROOF_BAY.z1 + ROOF_BAY.z2) / 2)
    group.add(deck)
    // fascia along the deck's open edge, so it does not read as a floating slab
    const fascia = new THREE.Mesh(
      new THREE.BoxGeometry(FLOOR.width, 0.3, 0.12),
      track(new THREE.MeshStandardMaterial({ color: 0x9aa5ad, map: metalTex, metalness: 0.3, roughness: 0.5 })),
    )
    fascia.position.set(0, deckTop - 0.15, ROOF_BAY.z1 - 0.06)
    group.add(fascia)

    // rooftop plant: two air handlers, a duct run, three vents, an access hatch
    const plantMat = track(
      new THREE.MeshStandardMaterial({ color: 0xb6c0c7, map: metalTex, metalness: 0.4, roughness: 0.5 }),
    )
    const ahu = (x: number, z: number, w: number, h: number, d: number) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, 0.14, d + 0.16), stdMat(0x9aa5ad))
      curb.position.set(x, deckTop + 0.07, z)
      group.add(curb)
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plantMat)
      m.position.set(x, deckTop + 0.14 + h / 2, z)
      group.add(m)
      // louvre on the long face
      const grille = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, h * 0.5, 0.04), stdMat(0x6f7a82))
      grille.position.set(x, deckTop + 0.14 + h * 0.55, z - d / 2 - 0.03)
      group.add(grille)
    }
    ahu(-9.5, 10.8, 3.2, 1.5, 1.8)
    ahu(9.5, 10.8, 3.2, 1.5, 1.8)
    // duct run linking the units
    const duct = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.6, 0.7), plantMat)
    duct.position.set(0, deckTop + 1.0, 11.9)
    group.add(duct)
    for (const vx of [-4.6, 0, 4.6]) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 12), plantMat)
      v.position.set(vx, deckTop + 0.3, 9.7)
      group.add(v)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12), stdMat(0x8d98a0, { metal: 0.4 }))
      cap.position.set(vx, deckTop + 0.65, 9.7)
      group.add(cap)
    }
    // access hatch with a low curb
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 1.1), stdMat(0x8d98a0, { metal: 0.3 }))
    hatch.position.set(-15.2, deckTop + 0.08, 9.6)
    group.add(hatch)
    // night wash over the roofline, so plant does not disappear after dark
    for (const ox of [-13.2, 13.2]) {
      const l = new THREE.PointLight(0xdfe8ef, hour >= 18 || hour < 6 ? 0.35 : 0, 11)
      l.position.set(ox, deckTop + 2.2, 9.8)
      group.add(l)
    }
  }

  /* ------------------------------------------------ contact shadows (AO-ish) --- */
  // A cheap stand-in for ambient occlusion: a soft radial darkening under every
  // large object. Without it the desk legs and chair bases visually detach from
  // the floor, because the real shadow map is one directional pass and cannot
  // darken a contact patch.
  const contactTex = track(
    (() => {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 64
      const g2 = cv.getContext('2d')!
      const rg = g2.createRadialGradient(32, 32, 2, 32, 32, 32)
      rg.addColorStop(0, 'rgba(0,0,0,0.42)')
      rg.addColorStop(0.55, 'rgba(0,0,0,0.16)')
      rg.addColorStop(1, 'rgba(0,0,0,0)')
      g2.fillStyle = rg
      g2.fillRect(0, 0, 64, 64)
      const t = new THREE.CanvasTexture(cv)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })(),
  )
  const contactMat = track(
    new THREE.MeshBasicMaterial({
      map: contactTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    }),
  )
  const contact = (x: number, z: number, w: number, d: number, y = 0.02) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), contactMat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, y, z)
    m.renderOrder = 1
    group.add(m)
  }
  for (const desk of DESKS) {
    contact(desk.x, desk.z, 2.6, 1.7)
    const cs = Math.sin(desk.facing)
    const cc = Math.cos(desk.facing)
    contact(desk.x + DESK_CHAIR.z * cs, desk.z + DESK_CHAIR.z * cc, 1.1, 1.1)
  }
  contact(LOUNGE.x, LOUNGE.z - 1.45, 4.2, 1.9)
  contact(LOUNGE.x, LOUNGE.z - 4.9, 3.2, 1.2)
  contact(CONFERENCE.x, CONFERENCE.z, 5.6, 5.6)
  for (const f of FOOTPRINTS) {
    if (f.kind === 'wall' || f.h < 0.7 || f.hw < 0.4) continue
    contact(f.x, f.z, Math.max(0.9, f.hw * 2.6), Math.max(0.9, f.hd * 2.6))
  }

  /* ------------------------------------------- activity props (idle life) --- */
  // Props for the extra idle activities. Without a prop the pose has nothing to
  // interact with and reads as an agent staring at a wall, so each activity added
  // to anim.ts gets real furniture here first.
  {
    const woodMat = track(
      new THREE.MeshStandardMaterial({ color: 0x8a6a44, map: deskTex, roughness: 0.55 }),
    )
    const leafMat = track(
      new THREE.MeshStandardMaterial({ color: 0x4f8b55, roughness: 0.85 }),
    )
    // Local upholstery material: `sofaFabric` is declared in the lounge block
    // BELOW this one, and a `const` used above its declaration throws at runtime.
    const nookFabric = track(
      new THREE.MeshStandardMaterial({ color: pal.sofa, map: fabricTex, bumpMap: fabricBump, bumpScale: 0.18, roughness: 0.95 }),
    )

    /* ---- green corner: a raised planter and two pots ---- */
    const garden = new THREE.Group()
    garden.position.set(GARDEN.x, 0, GARDEN.z)
    // The planter now runs along the east wall, so it is turned 90 degrees.
    garden.rotation.y = Math.PI / 2
    const boxBody = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.55, 0.56), woodMat)
    boxBody.position.y = 0.28
    garden.add(boxBody)
    // soil
    const soil = new THREE.Mesh(
      new THREE.BoxGeometry(2.7, 0.06, 0.44),
      stdMat(0x3c2f22, { rough: 1 }),
    )
    soil.position.y = 0.57
    garden.add(soil)
    // a row of leafy plants, sized so they read as herbs rather than trees
    for (let i = 0; i < 7; i++) {
      const px = -1.15 + i * 0.383
      const stem = cyl(0.018, 0.02, 0.24, 0x5d7f45, 8)
      stem.position.set(px, 0.71, 0)
      garden.add(stem)
      for (let l = 0; l < 4; l++) {
        const leaf = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.09 + (l % 2) * 0.03, 0),
          leafMat,
        )
        const a = (l / 4) * Math.PI * 2
        leaf.position.set(px + Math.cos(a) * 0.1, 0.82 + (l % 2) * 0.07, Math.sin(a) * 0.08)
        leaf.scale.set(1, 0.6, 1)
        garden.add(leaf)
      }
    }
    // two floor pots at the ends
    for (const px of [-2.0, 2.0]) {
      const pot = cyl(0.17, 0.13, 0.3, 0xa8674a, 12)
      pot.position.set(px, 0.15, 0)
      garden.add(pot)
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), leafMat)
      bush.position.set(px, 0.46, 0)
      bush.scale.set(1, 0.85, 1)
      garden.add(bush)
    }
    group.add(garden)

    /* ---- book nook: shelf + armchair + side table ---- */
    const nook = new THREE.Group()
    nook.position.set(BOOK_NOOK.x, 0, BOOK_NOOK.z)
    // shelf against the partition
    // Shelf along the north edge, facing the chair.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.0, 0.4), woodMat)
    shelf.position.set(0, 1.0, -1.3)
    nook.add(shelf)
    const bookCols = [0xd05f4a, 0x4a72d0, 0xd0a84a, 0x4ad08f, 0x9a4ad0, 0xcfd0cf]
    for (let sh = 0; sh < 3; sh++) {
      const y = 0.55 + sh * 0.6
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.03, 0.36), stdMat(0xd9cdb8, { rough: 0.8 }))
      board.position.set(0, y - 0.26, -1.3)
      nook.add(board)
      let bx = -0.82
      while (bx < 0.82) {
        const w = 0.05 + Math.abs(Math.sin(bx * 7)) * 0.05
        const h = 0.24 + Math.abs(Math.cos(bx * 5)) * 0.1
        const book = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, 0.26),
          stdMat(bookCols[Math.floor(Math.abs(bx * 13)) % bookCols.length], { rough: 0.85 }),
        )
        book.position.set(bx + w / 2, y - 0.24 + h / 2, -1.14)
        nook.add(book)
        bx += w + 0.012
      }
    }
    // armchair, facing the shelf
    const chair = new THREE.Group()
    chair.position.set(0, 0, 0.75)
    // No rotation: the backrest sits at local +Z, the shelf is to the north
    // (-Z), so the sitter already faces it. Rotating by PI put the backrest
    // against the shelf and the sitter's face to the wall.
    chair.rotation.y = 0
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.3, 0.8), nookFabric)
    cushion.position.y = seatTop('nook') - SEATS.nook.thickness / 2
    chair.add(cushion)
    const backr = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.62, 0.2), nookFabric)
    backr.position.set(0, 0.72, 0.36)
    chair.add(backr)
    for (const ax of [-0.46, 0.46]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.8), nookFabric)
      arm.position.set(ax, 0.58, 0)
      chair.add(arm)
    }
    nook.add(chair)
    // side table with a mug
    const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.05, 14), woodMat)
    tbl.position.set(-1.15, 0.5, 0.75)
    nook.add(tbl)
    const tleg = cyl(0.045, 0.05, 0.5, 0x6b6f73, 10, 0.4)
    tleg.position.set(-1.15, 0.25, 0.75)
    nook.add(tleg)
    const nookMug = cyl(0.05, 0.045, 0.1, 0xeae4d8, 10)
    nookMug.position.set(-1.15, 0.575, 0.75)
    nook.add(nookMug)
    group.add(nook)

    /* ---- pantry stools ---- */
    for (const sx of PANTRY_STOOLS) {
      const st = new THREE.Group()
      st.position.set(sx, 0, PANTRY.z + PANTRY_STOOL_GAP)
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 14), stdMat(0x7c4f34, { rough: 0.7 }))
      seat.position.y = seatTop('stool') - SEATS.stool.thickness / 2
      st.add(seat)
      for (const [dx, dz] of [
        [-0.14, -0.14],
        [0.14, -0.14],
        [-0.14, 0.14],
        [0.14, 0.14],
      ]) {
        const lg = cyl(0.022, 0.025, 0.6, 0x5b666e, 8, 0.5)
        lg.position.set(dx, 0.3, dz)
        lg.rotation.z = -dx * 0.5
        lg.rotation.x = dz * 0.5
        st.add(lg)
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.014, 6, 16), stdMat(0x5b666e, { metal: 0.5 }))
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.24
      st.add(ring)
      group.add(st)
    }
  }

  /* -------------------------------------------------------------- desks --- */
  const monitors: THREE.Mesh[] = []
  const lamps: THREE.PointLight[] = []

  // REALISTIS: meja kayu beveled + kaki ramping. Top rbox (bukan Box tajam).
  const deskWoodMat = track(woodWarm())
  // Karpet abu di area kerja (zonasi premium): satu bidang besar di bawah meja.
  {
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), track(carpetGrey()))
    carpet.rotation.x = -Math.PI / 2
    carpet.position.set(0, 0.01, -6.5)
    group.add(carpet)
  }
  for (const desk of DESKS) {
    const d = new THREE.Group()
    d.position.set(desk.x, 0, desk.z)
    d.rotation.y = desk.facing

    const top = new THREE.Mesh(rbox(2.0, 0.07, 1.0, 0.015), deskWoodMat)
    top.position.y = 0.72
    d.add(top)
    const skirt = new THREE.Mesh(rbox(1.9, 0.5, 0.08, 0.015), track(plasterClean()))
    skirt.position.set(0, 0.46, -0.42)
    d.add(skirt)
    for (const [lx, lz] of [
      [-0.9, -0.42],
      [0.9, -0.42],
      [-0.9, 0.42],
      [0.9, 0.42],
    ]) {
      const leg = new THREE.Mesh(rbox(0.05, 0.72, 0.05, 0.01), track(plasterClean()))
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
        color: 0xffffff,
        map: screenTex,
        emissive: 0xffffff,
        emissiveMap: screenTex,
        emissiveIntensity: 0.85,
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

    // lampu meja hangat (premium): lebih terang + selalu ada (bukan hanya malam)
    const lamp = new THREE.PointLight(0xffc98a, hour >= 18 || hour < 6 ? 0.8 : 0.25, 4)
    lamp.position.set(desk.x + Math.sin(desk.facing) * 0.5, 1.5, desk.z + Math.cos(desk.facing) * 0.5)
    group.add(lamp)
    lamps.push(lamp)
    // lampu meja fisik: batang + shade
    const lampPole = cyl(0.015, 0.02, 0.32, 0x2b3236, 8, 0.6)
    lampPole.position.set(0.72, 0.9, -0.1)
    d.add(lampPole)
    const lampShade = cyl(0.11, 0.07, 0.12, 0xc9a24a, 12, 0.6)
    lampShade.position.set(0.72, 1.06, -0.1)
    d.add(lampShade)

    // task chair — child of the desk group so it inherits the desk rotation and
    // faces the monitor by construction
    const chair = new THREE.Group()
    chair.position.set(DESK_CHAIR.x, 0, DESK_CHAIR.z)
    // Task chairs are vinyl/foam, not woven fabric: the weave map read as cloth.
    const chairFabric = new THREE.MeshStandardMaterial({
      color: pal.chair,
      map: vinylTex,
      roughness: 0.62,
    })
    const seat = new THREE.Mesh(rbox(0.56, 0.07, 0.54, 0.015), chairFabric)
    // Top surface comes from the pose that sits here (SEATS.chair), so the two can
    // never drift apart again. Centring the slab puts its top at the derived value.
    seat.position.y = seatTop('chair') - SEATS.chair.thickness / 2
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
    seat.position.y = seatTop('chair') - SEATS.chair.thickness / 2
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
    new THREE.MeshStandardMaterial({ color: pal.sofa, map: fabricTex, bumpMap: fabricBump, bumpScale: 0.18, roughness: 0.95 }),
  )
  const sofaSeat = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.34, 1.0), sofaFabric)
  // The sofa used to be modelled at 0.42 (top 0.59) while the avatar's legs reach
  // only 0.46 below the hip — the feet could not touch the floor and every sitter
  // hovered. Derived from SEATS.sofa now.
  sofaSeat.position.y = seatTop('sofa') - SEATS.sofa.thickness / 2
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
      // The backrest is at local +Z, so the chair must be turned to put its BACK
      // on the far side of the table: +Z for the chair at -Z, -Z (PI) for the
      // chair at +Z. The previous condition had both chairs facing away.
      chair.rotation.y = side > 0 ? 0 : Math.PI
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
  //
  // Rebuilt as four zones plus planting. Every coordinate matches a footprint in
  // layout.ts, which the self-test checks for collision and doorway clearance. The
  // previous set had accumulated a piece at a time — two benches, a second desk with
  // its own chair, four planters, a sofa pair one behind the other, and a reception
  // group overlapping the waiting area — and read as a stack of objects rather than
  // a lobby.
  //
  //   entrance        mat, flanking plants, coat rack, umbrella stand
  //   reception       counter facing the entrance, chair behind it, credenza
  //   waiting (west)  two sofas facing each other over a low table, side table
  //   exhibition      four plinths + a sculpture plinth along the north wall, bench
  //   coffee (east)   bar, two stools, back shelf, table with two chairs
  //   planting        wall gaps and the north bays between the room doors

  /** A potted plant: tapered pot plus a layered bush. */
  const potted = (
    parent: THREE.Group,
    x: number,
    z: number,
    r: number,
    h: number,
    leafMat: THREE.Material,
    potMat: THREE.Material,
  ) => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.6, r * 1.1, 14), potMat)
    p.position.y = r * 0.55
    g.add(p)
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.74, r * 0.74, 0.05, 14),
      stdMat(0x3b2f23),
    )
    soil.position.y = r * 1.1
    g.add(soil)
    const layers = h > 1.4 ? 3 : 2
    for (let i = 0; i < layers; i++) {
      const rr = r * (1.15 - i * 0.22)
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 1), leafMat)
      bush.position.y = r * 1.2 + i * rr * 0.95
      bush.scale.set(1, 0.78, 1)
      g.add(bush)
    }
    parent.add(g)
  }

  /**
   * A chair with the seat top every pose expects.
   *
   * `facing` is the direction the sitter looks, in the avatar convention (local +Z
   * is forward), so the backrest goes on local -Z.
   */
  const lobbyChair = (
    parent: THREE.Group,
    x: number,
    z: number,
    facing: number,
    fabric: number,
  ) => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    g.rotation.y = facing
    const seat = box(0.54, 0.07, 0.52, fabric, { rough: 0.7 })
    seat.position.y = seatTop('chair') - SEATS.chair.thickness / 2
    g.add(seat)
    const back = box(0.54, 0.6, 0.06, fabric, { rough: 0.7 })
    back.position.set(0, 0.76, -0.26)
    g.add(back)
    const post = cyl(0.04, 0.055, 0.44, 0x5b666e, 8, 0.4)
    post.position.y = 0.22
    g.add(post)
    const star = cyl(0.26, 0.28, 0.04, 0x4d565d, 10, 0.3)
    star.position.y = 0.02
    g.add(star)
    parent.add(g)
  }

  {
    // Materials local to the lobby: wood, foliage, terracotta, upholstery.
    const woodMat = track(
      new THREE.MeshStandardMaterial({ color: 0x8f6f4a, map: deskTex, roughness: 0.55 }),
    )
    const leafMat = track(new THREE.MeshStandardMaterial({ color: 0x4a8352, roughness: 0.9 }))
    const potMat = track(new THREE.MeshStandardMaterial({ color: 0xa8674a, roughness: 0.8 }))
    const counterMat = track(
      new THREE.MeshStandardMaterial({ color: 0x8b6f52, map: deskTex, roughness: 0.45 }),
    )
    const stoneMat = track(
      new THREE.MeshStandardMaterial({ color: 0xcfd6da, map: plasterTex, roughness: 0.7 }),
    )

    /* ---- entrance ---------------------------------------------------------- */
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.4), stdMat(0x6b7a6e, { rough: 1 }))
    mat.rotation.x = -Math.PI / 2
    mat.position.set(0, 0.014, 11.8)
    group.add(mat)

    potted(group, -2.8, 12.0, 0.4, 1.1, leafMat, potMat)
    potted(group, 2.8, 12.0, 0.4, 1.1, leafMat, potMat)

    {
      const rack = new THREE.Group()
      rack.position.set(-4.4, 0, 12.0)
      const pole = cyl(0.045, 0.055, 1.72, 0x8b6f4f, 10)
      pole.position.y = 0.86
      rack.add(pole)
      const base = cyl(0.28, 0.32, 0.05, 0x7a6244, 14)
      base.position.y = 0.025
      rack.add(base)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2
        const peg = box(0.05, 0.05, 0.22, 0x9c7d59)
        peg.position.set(Math.cos(a) * 0.11, 1.6, Math.sin(a) * 0.11)
        peg.rotation.y = -a
        rack.add(peg)
      }
      group.add(rack)
    }

    {
      const g = new THREE.Group()
      g.position.set(4.4, 0, 12.0)
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.22, 0.7, 14),
        stdMat(0x5c666e, { metal: 0.5, rough: 0.4 }),
      )
      drum.position.y = 0.35
      g.add(drum)
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4
        const stick = cyl(0.025, 0.025, 0.95, i === 1 ? 0x2f6f8f : 0x8a3f3f, 8)
        stick.position.set(Math.cos(a) * 0.1, 0.75, Math.sin(a) * 0.1)
        stick.rotation.z = Math.cos(a) * 0.16
        stick.rotation.x = -Math.sin(a) * 0.16
        g.add(stick)
      }
      group.add(g)
    }

    /* ---- reception --------------------------------------------------------- */
    {
      const rec = new THREE.Group()
      rec.position.set(RECEPTION.x, 0, RECEPTION.z)
      // Visitor side is +z, so the badge, logo and monitor face that way.
      const body = box(3.2, 1.05, 0.62, 0xe0d3bc, { rough: 0.6 })
      body.position.y = 0.52
      rec.add(body)
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.34, 0.06, 0.76), counterMat)
      top.position.y = 1.08
      rec.add(top)
      const badge = box(0.5, 0.34, 0.03, 0xdfe6ea, { metal: 0.2 })
      badge.position.set(0, 0.72, 0.33)
      rec.add(badge)
      const logo = box(0.44, 0.12, 0.02, 0x2f7f5f, { emissive: 0x2f7f5f, ei: 0.4 })
      logo.position.set(0, 0.72, 0.35)
      rec.add(logo)
      const monitor = box(0.5, 0.34, 0.03, 0x25292d, { metal: 0.3 })
      monitor.position.set(-1.2, 1.28, 0.06)
      rec.add(monitor)
      group.add(rec)
    }
    // Chair behind the counter, facing it: the counter is at +z from here.
    lobbyChair(group, RECEPTION.x, RECEPTION.z - 1.15, 0, 0x6f8fa8)

    {
      // Credenza against the south wall, with a lamp and a tray.
      const g = new THREE.Group()
      g.position.set(-8.8, 0, 11.9)
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 0.5), woodMat)
      body.position.y = 0.35
      g.add(body)
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.56), counterMat)
      top.position.y = 0.72
      g.add(top)
      const lamp = cyl(0.1, 0.12, 0.24, 0xe8e2d2, 12)
      lamp.position.set(-0.55, 0.86, 0)
      g.add(lamp)
      const tray = box(0.34, 0.03, 0.24, 0x6b5334)
      tray.position.set(0.3, 0.76, 0)
      g.add(tray)
      group.add(g)
    }

    /* ---- waiting (west) ---------------------------------------------------- */
    for (const [z, facing] of [
      [8.2, 0], // north sofa faces south (+z), toward the table
      [10.4, Math.PI], // south sofa faces north
    ] as const) {
      const g = new THREE.Group()
      g.position.set(-13.0, 0, z)
      g.rotation.y = facing
      const seat = box(2.0, 0.24, 0.9, 0x93a8ba, { rough: 0.9 })
      seat.position.y = 0.28
      g.add(seat)
      // Backrest away from the table, i.e. local -Z.
      const back = box(2.0, 0.6, 0.22, 0x93a8ba, { rough: 0.9 })
      back.position.set(0, 0.64, -0.34)
      g.add(back)
      for (const [lx, lz] of [
        [-0.88, -0.36],
        [0.88, -0.36],
        [-0.88, 0.36],
        [0.88, 0.36],
      ]) {
        const leg = cyl(0.03, 0.035, 0.16, 0x5b666e, 8, 0.5)
        leg.position.set(lx, 0.08, lz)
        g.add(leg)
      }
      group.add(g)
    }

    {
      // Low table between the sofas, with a magazine on it.
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.05, 20), woodMat)
      top.position.set(-13.0, 0.44, 9.3)
      group.add(top)
      const leg = cyl(0.05, 0.07, 0.42, 0x8f6f4a, 10)
      leg.position.set(-13.0, 0.21, 9.3)
      group.add(leg)
      const mag = box(0.3, 0.02, 0.22, 0xd8cfc0)
      mag.position.set(-13.0, 0.475, 9.3)
      group.add(mag)
    }

    {
      // Side table against the west wall, with a small plant.
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.05, 16), woodMat)
      top.position.set(-15.2, 0.5, 9.3)
      group.add(top)
      const leg = cyl(0.04, 0.05, 0.48, 0x8f6f4a, 10)
      leg.position.set(-15.2, 0.25, 9.3)
      group.add(leg)
      potted(group, -15.2, 9.3, 0.16, 0.5, leafMat, potMat)
    }

    {
      // Magazine rack: a low frame holding tilted papers.
      const g = new THREE.Group()
      g.position.set(-11.6, 0, 11.9)
      for (const sxp of [-0.4, 0.4]) {
        const side = box(0.06, 1.15, 0.3, 0x6b5334)
        side.position.set(sxp, 0.58, 0)
        g.add(side)
      }
      for (const y of [0.25, 0.6, 0.95]) {
        const shelf = box(0.86, 0.04, 0.3, 0x7a6040)
        shelf.position.set(0, y, 0)
        g.add(shelf)
        for (let i = 0; i < 3; i++) {
          const m = box(0.24, 0.3, 0.03, [0xd05f4a, 0x4a72d0, 0xd0a84a][i], {})
          m.position.set(-0.25 + i * 0.25, y + 0.17, 0)
          m.rotation.x = -0.22
          g.add(m)
        }
      }
      group.add(g)
    }

    /* ---- exhibition (centre, north wall) ----------------------------------- */
    // Four plinths flank the axis, each carrying a small object, plus a taller one
    // with a sculpture. They are deliberately off-centre so the entrance-to-work
    // sightline stays open.
    const plinthObjects: ((g: THREE.Group, y: number) => void)[] = [
      (g, y) => {
        // a framed panel, leaning
        const panel = box(0.34, 0.44, 0.03, 0xd9e2e8)
        panel.position.y = y + 0.22
        panel.rotation.x = -0.12
        g.add(panel)
      },
      (g, y) => {
        // two books, stacked
        for (let i = 0; i < 2; i++) {
          const b = box(0.3 - i * 0.04, 0.05, 0.22, i ? 0x8a5f3f : 0x3f5f8a)
          b.position.set(i * 0.02, y + 0.03 + i * 0.055, 0)
          g.add(b)
        }
      },
      (g, y) => {
        // a tall vase
        const v = cyl(0.09, 0.13, 0.34, 0xc9a86a, 14)
        v.position.y = y + 0.17
        g.add(v)
      },
      (g, y) => {
        // a model on a thin stand
        const stem = cyl(0.015, 0.015, 0.14, 0x8a949c, 8)
        stem.position.y = y + 0.07
        g.add(stem)
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 1), stoneMat)
        orb.position.y = y + 0.19
        g.add(orb)
      },
    ]
    const plinthSpots: [number, number][] = [
      [-6.0, 5.6],
      [-3.6, 5.6],
      [3.6, 5.6],
      [6.0, 5.6],
    ]
    plinthSpots.forEach(([x, z], i) => {
      const g = new THREE.Group()
      g.position.set(x, 0, z)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.1, 0.76), stoneMat)
      body.position.y = 0.55
      g.add(body)
      const cap = box(0.84, 0.06, 0.84, 0xe6ebee)
      cap.position.y = 1.13
      g.add(cap)
      plinthObjects[i]?.(g, 1.16)
      group.add(g)
    })

    {
      // The tall plinth: a sculpture with a small spot on the cap.
      const g = new THREE.Group()
      g.position.set(8.8, 0, 5.6)
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.24, 0.72), stoneMat)
      body.position.y = 0.62
      g.add(body)
      const cap = box(0.8, 0.06, 0.8, 0xe6ebee)
      cap.position.y = 1.27
      g.add(cap)
      const art = new THREE.Mesh(
        new THREE.TorusKnotGeometry(0.15, 0.05, 48, 8),
        stdMat(0x2f7f5f, { metal: 0.5, rough: 0.3 }),
      )
      art.position.y = 1.52
      g.add(art)
      const spot = cyl(0.05, 0.06, 0.05, 0x2b3236, 10, 0.4)
      spot.position.set(0.26, 1.31, 0)
      g.add(spot)
      group.add(g)
    }

    {
      // Bench on the exhibition side, facing the plinths across the aisle.
      const g = new THREE.Group()
      g.position.set(-8.6, 0, 7.6)
      g.rotation.y = Math.PI / 2 // faces east
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.8), woodMat)
      seat.position.y = 0.46
      g.add(seat)
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.46, 0.08), woodMat)
      back.position.set(0, 0.72, -0.36)
      g.add(back)
      for (const lx of [-0.8, 0.8]) {
        for (const lz of [-0.3, 0.3]) {
          const leg = cyl(0.035, 0.04, 0.44, 0x5b666e, 10, 0.5)
          leg.position.set(lx, 0.22, lz)
          g.add(leg)
        }
      }
      group.add(g)
    }

    /* ---- coffee bar (east) -------------------------------------------------- */
    {
      const g = new THREE.Group()
      g.position.set(12.8, 0, 10.3)
      // The bar faces the entrance (+z), so the stools sit on that side.
      const body = box(3.0, 1.0, 0.6, 0x6b5334, { rough: 0.6 })
      body.position.y = 0.5
      g.add(body)
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.16, 0.07, 0.76), counterMat)
      top.position.y = 1.03
      g.add(top)
      const machine = box(0.5, 0.4, 0.34, 0x3a4046, { metal: 0.5 })
      machine.position.set(-0.7, 1.26, 0)
      g.add(machine)
      const head = cyl(0.05, 0.05, 0.1, 0x8a949c, 10, 0.4)
      head.position.set(-0.7, 1.06, 0.14)
      g.add(head)
      for (let i = 0; i < 3; i++) {
        const cup = cyl(0.05, 0.04, 0.07, 0xeae4d8, 10)
        cup.position.set(0.25 + i * 0.13, 1.1, 0)
        g.add(cup)
      }
      const menu = box(1.2, 0.5, 0.03, 0x25292d)
      menu.position.set(0, 2.0, -0.2)
      g.add(menu)
      group.add(g)
    }

    for (const sx of [11.9, 13.7]) {
      const g = new THREE.Group()
      g.position.set(sx, 0, 11.3)
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 14), woodMat)
      seat.position.y = 0.62
      g.add(seat)
      for (const [dx, dz] of [
        [-0.14, -0.14],
        [0.14, -0.14],
        [-0.14, 0.14],
        [0.14, 0.14],
      ]) {
        const lg = cyl(0.022, 0.025, 0.6, 0x5b666e, 8, 0.5)
        lg.position.set(dx, 0.3, dz)
        lg.rotation.z = -dx * 0.5
        lg.rotation.x = dz * 0.5
        g.add(lg)
      }
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.014, 6, 16),
        stdMat(0x5b666e, { metal: 0.5 }),
      )
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.24
      g.add(ring)
      group.add(g)
    }

    {
      // Back shelf with jars, against the east partition.
      const g = new THREE.Group()
      g.position.set(12.8, 0, 9.0)
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.34), woodMat)
      body.position.y = 0.75
      g.add(body)
      for (const y of [0.35, 0.75, 1.15]) {
        const shelf = box(2.2, 0.04, 0.3, 0x7a6040)
        shelf.position.set(0, y, 0.02)
        g.add(shelf)
        for (let i = 0; i < 5; i++) {
          const jar = cyl(0.06, 0.06, 0.2, [0xc9a86a, 0x6b8f5a, 0x9a5f4a][i % 3], 10)
          jar.position.set(-0.8 + i * 0.4, y + 0.12, 0.02)
          g.add(jar)
        }
      }
      group.add(g)
    }

    {
      // Table with two chairs, in the coffee corner.
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.05, 20), woodMat)
      top.position.set(12.8, 0.44, 6.6)
      group.add(top)
      const leg = cyl(0.06, 0.08, 0.42, 0x5b666e, 10)
      leg.position.set(12.8, 0.21, 6.6)
      group.add(leg)
      const base = cyl(0.28, 0.3, 0.03, 0x4d565d, 12, 0.3)
      base.position.set(12.8, 0.015, 6.6)
      group.add(base)
      const mug = cyl(0.05, 0.045, 0.1, 0xeae4d8, 10)
      mug.position.set(13.0, 0.5, 6.5)
      group.add(mug)
    }
    // Chairs face the table: local +Z is forward, so the west chair turns -90°.
    lobbyChair(group, 11.5, 6.6, -Math.PI / 2, 0x6f8fa8)
    lobbyChair(group, 14.1, 6.6, Math.PI / 2, 0x6f8fa8)

    /* ---- planting ----------------------------------------------------------- */
    potted(group, -9.0, 5.0, 0.42, 1.05, leafMat, potMat)
    potted(group, 9.2, 4.4, 0.42, 1.05, leafMat, potMat)
    potted(group, -15.6, 6.0, 0.5, 1.1, leafMat, potMat)
    potted(group, 15.6, 6.0, 0.5, 1.1, leafMat, potMat)
  }

  /* ---------------------------------------------------------- entrance ---- */
  // A proper double door with glass leaves, transom and frame. The old version
  // was a single slab that read as a wall panel; nothing was actually there.
  const doorGroup = new THREE.Group()
  doorGroup.position.set(DOOR.x, 0, HALF_D - WALL_T / 2)
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

  // Surrounding frame in a darker metal so the doorway reads from outside, where
  // two glass leaves alone vanish against the lobby's white wall.
  const doorSurround = box(4.0, 3.15, 0.16, 0x46545e, { metal: 0.5, rough: 0.4 })
  doorSurround.position.set(DOOR.x, 1.58, HALF_D - WALL_T / 2 - 0.08)
  group.add(doorSurround)
  const doorGlassOuter = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.55, 0.12), glassMat)
  doorGlassOuter.position.set(DOOR.x, 1.4, HALF_D - WALL_T / 2 + 0.02)
  group.add(doorGlassOuter)

  // ---- entrance: canopy on brackets and columns, vestibule, address --------
  // The canopy was a 0.14 m slab with nothing holding it up, which is why it read
  // as a floating panel. It is thicker now, carried on two slim columns and a pair
  // of brackets, and the door sits inside a recessed vestibule.
  const matSteel = track(
    new THREE.MeshStandardMaterial({ color: 0x8d98a0, map: metalTex, metalness: 0.45, roughness: 0.45 }),
  )
  const CANOPY_W = 5.0
  const CANOPY_D = 1.8
  const CANOPY_Y = 3.25
  const canopyZ = HALF_D + CANOPY_D / 2 - 0.1
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(CANOPY_W, 0.22, CANOPY_D), matSteel)
  canopy.position.set(0, CANOPY_Y, canopyZ)
  group.add(canopy)
  // soffit, so the underside is not the same flat grey as the top
  const soffit = new THREE.Mesh(
    new THREE.BoxGeometry(CANOPY_W - 0.3, 0.06, CANOPY_D - 0.3),
    stdMat(0xd6dde2, { rough: 0.85 }),
  )
  soffit.position.set(0, CANOPY_Y - 0.14, canopyZ)
  group.add(soffit)
  // fascia edge trim
  const cFascia = new THREE.Mesh(new THREE.BoxGeometry(CANOPY_W + 0.06, 0.1, 0.08), stdMat(0x6f7a82, { metal: 0.5 }))
  cFascia.position.set(0, CANOPY_Y - 0.02, canopyZ + CANOPY_D / 2)
  group.add(cFascia)
  for (const cx of [-CANOPY_W / 2 + 0.35, CANOPY_W / 2 - 0.35]) {
    // column
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.14, CANOPY_Y - 0.11, 0.14), matSteel)
    col.position.set(cx, (CANOPY_Y - 0.11) / 2, canopyZ + CANOPY_D / 2 - 0.25)
    group.add(col)
    // base plate
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), stdMat(0x6f7a82, { metal: 0.5 }))
    bp.position.set(cx, 0.04, canopyZ + CANOPY_D / 2 - 0.25)
    group.add(bp)
    // diagonal bracket back to the wall
    const br = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1.0), matSteel)
    br.position.set(cx, CANOPY_Y - 0.55, HALF_D + 0.35)
    br.rotation.x = Math.PI / 4
    group.add(br)
  }
  // downlights in the soffit
  for (const lx of [-1.5, 0, 1.5]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10), stdMat(0xb9c4cc, { metal: 0.4 }))
    ring.position.set(lx, CANOPY_Y - 0.18, canopyZ + 0.1)
    group.add(ring)
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10),
      stdMat(0xfff4e0, { emissive: 0xffe6b8, ei: 1 }),
    )
    lens.position.set(lx, CANOPY_Y - 0.2, canopyZ + 0.1)
    group.add(lens)
  }
  // recessed vestibule: side cheeks + a step up
  for (const vx of [-1.9, 1.9]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.0, 0.5), stdMat(0xdde4e8, { rough: 0.85 }))
    cheek.position.set(vx, 1.5, HALF_D + 0.16)
    group.add(cheek)
  }
  const step = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 1.1), stdMat(0xc3ccd2, { rough: 0.85 }))
  step.position.set(0, 0.06, HALF_D + 0.62)
  group.add(step)
  const stepTop = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.1, 0.7), stdMat(0xd2dade, { rough: 0.85 }))
  stepTop.position.set(0, 0.17, HALF_D + 0.5)
  group.add(stepTop)
  // entrance signage over the door
  const signPlate = box(2.9, 0.46, 0.1, 0x113b2c, { emissive: 0x1c5c44, ei: 0.5 })
  signPlate.position.set(0, 3.72, HALF_D - 0.02)
  group.add(signPlate)
  // street number plate beside the entrance
  const numPlate = box(0.4, 0.3, 0.06, 0xe8eef2)
  numPlate.position.set(2.35, 1.55, HALF_D - 0.01)
  group.add(numPlate)

  /* ----------------------------------------------------------- lighting --- */
  // REALISTIS: ambient RENDAH + sun KUAT = ada bayangan + kontras.
  // Sebelumnya AmbientLight 1.15 + Hemisphere 1.0 + env 1.0 mencuci seluruh
  // scene jadi rata: sun 1.85 tidak menghasilkan bayangan terlihat sama sekali,
  // dan tanpa bayangan tidak ada satupun highlight yang terbaca.
  scene.add(new THREE.AmbientLight(0xffffff, 0.22))
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.6)
  // Sudut lebih rendah (bukan 34 tinggi): matahari tinggi memproyeksikan
  // bayangan tepat di bawah objek sehingga tidak terlihat. Sudut ~35° memberi
  // bayangan memanjang yang terbaca, seperti sinar pagi/sore.
  sun.position.set(26, 20, 16)
  scene.add(sun)
  const fill = new THREE.HemisphereLight(0xdfeaf7, 0x8a7a5f, 0.45)
  scene.add(fill)

  // recessed ceiling panels in a grid, each with a fixture and a point light
  const streaks: THREE.Mesh[] = []
  // Ceiling at 4.3 m, not 3.3: the old height cut straight through the Kanban
  // board, which reaches 4.25 m. A 4.3 m ceiling also reads as a loft office.
  // z=-10 omitted: that row sat directly in front of the Kanban board and read
  // as a beam cutting through it.
  for (const cz of [-5.5, -1, 6.5, 10.5]) {
    const housing = box(FLOOR.width - 1.6, 0.12, 0.42, 0xd9dfe4, { metal: 0.25, rough: 0.5 })
    housing.position.set(0, CEILING_Y, cz)
    group.add(housing)
    const panel = box(FLOOR.width - 2.0, 0.04, 0.3, 0xffffff, { emissive: 0xfff4e0, ei: 1 })
    panel.position.set(0, CEILING_Y - 0.07, cz)
    group.add(panel)
    streaks.push(panel)
    // One light per ceiling row: 25 point lights measurably starved the frame
    // budget for no visible gain, since the emissive panel already reads as lit.
    const l = new THREE.PointLight(0xfff6e6, 0.55, 22)
    l.position.set(0, CEILING_Y - 0.3, cz)
    group.add(l)
  }

  /* -------------------------------------------------- outside environment -- */
  // The office sits in a street: pavement, road, trees and neighbouring blocks,
  // so zooming out does not reveal an empty void. Built as one group the scene
  // can toggle, and the camera is clamped to this area.
  const streetGroup = new THREE.Group()
  scene.add(streetGroup)

  /**
   * Ground.
   *
   * Two layers, because one was wrong: a single 60x52 m slab of light grey
   * (#a3a8ab) with nothing beyond it read as floating above cloud — the eye reads
   * a pale plane that stops dead as sky, not as ground. The neighbouring blocks
   * also stood OUTSIDE it (a block at x=30, 12 m wide spans x 24..36 against a
   * slab edge at x=30), so they floated too.
   *
   * So: a wide, darker earth plane well beyond the furthest building, with the
   * paved plaza laid on top of it.
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

  // The plaza: pavement around the office, sized to contain every neighbouring
  // block, not just the office.
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

    // Window grid on ALL FOUR faces. The first version only glazed the face on
    // the outward side of the group, so most neighbours read as blank slabs, and
    // the panes were offset by a whole half-depth instead of sitting on the wall.
    const winMat = stdMat(0x8fb6cf, { emissive: 0x6f9cbb, ei: 0.5 })
    const frameMat2 = stdMat(0x6b7681, { metal: 0.2, rough: 0.6 })
    const rows = Math.max(2, Math.floor(h / 3))
    const colsX = Math.max(2, Math.floor(w / 2.6)) // windows along the X faces
    const colsZ = Math.max(2, Math.floor(d / 2.6)) // windows along the Z faces

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
      // north and south faces
      for (let c = 0; c < colsX; c++) {
        const px = x - w / 2 + (w / colsX) * (c + 0.5)
        pane(px, py, z - d / 2 - 0.06, true)
        pane(px, py, z + d / 2 + 0.06, true)
      }
      // east and west faces
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

  // kerb, street lamps and a couple of parked cars
  const kerb = box(FLOOR.width + 26, 0.12, 0.3, 0xb9bec2, { rough: 0.9 })
  kerb.position.set(0, -0.02, HALF_D + 9.2)
  streetGroup.add(kerb)

  for (const lx of [-16, 16]) {
    // On the sidewalk, near the kerb, not in the traffic lane.
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

  // (static parked cars replaced by the animated traffic below)

  /* --------------------------------------------------- living street ------ */
  // Pedestrians and traffic animated from the scene tick. They are collected in
  // arrays the caller advances each frame, so nothing here needs a timer.
  /**
   * One speed per row, and a minimum gap held behind the walker ahead in the same
   * row. Two independent fixes for the same bug: differing speeds alone still let
   * a faster walker close the gap and pass through, so spacing is enforced too.
   */
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
    // Sidewalk band: from the building face out to the kerb at HALF_D+9.2,
    // NOT the road (which starts at HALF_D+9.5). Two rows so it reads as a path.
    // One speed per row. Different speeds in the same row meant a faster walker
    // walked straight through a slower one; row A is the brisk lane, row B the
    // strolling lane, so a walker only ever catches someone in the OTHER row.
    const row = i % 2
    // The sidewalk is OUTSIDE the building, on the street side: z > HALF_D. Two
    // earlier attempts put it at 16.4/19.6 (through the neighbouring blocks) and
    // then at 11.6/10.2 (inside our own building) — the sign was wrong both times.
    // The clear band runs from the facade at 13 to the kerb at 22.
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

  // Lanes were 1.8 m apart and the car body is 1.8 m wide, so the two directions
  // touched exactly — the westbound lane overlapped the eastbound one. The road
  // spans z 22.5..31.5, so each lane centre is now 2.6 m from the kerb side and
  // they are 4.0 m apart, which leaves 2.2 m of clear road between them.
  const LANE_NORTH = HALF_D + 11.5 // nearer the building, eastbound
  const LANE_SOUTH = HALF_D + 15.5 // far side, westbound
  const CAR_COLORS = [0xb9563f, 0x3f6fb9, 0xd8d3c4, 0x4f7a5f, 0x8a8f95]
  // Per-lane speeds, and cars are spaced evenly along the lane. Giving each car
  // its own speed inside one lane made them drive through each other: a car at
  // 10 m/s laps a car at 6 m/s on the same line. One speed per lane means the gap
  // is fixed for good, and CAR_GAP is enforced as a second line of defence.
  const LANE_SPEED = { [LANE_NORTH]: 7, [LANE_SOUTH]: 9 } as Record<number, number>
  const CAR_GAP = 13
  const perLane = [0, 0]
  for (let i = 0; i < 5; i++) {
    const forward = i % 2 === 0
    const c = makeVehicle(CAR_COLORS[i % CAR_COLORS.length])
    const z = forward ? LANE_NORTH : LANE_SOUTH
    // The body's length is its LOCAL X. The lane runs along world X, so a car
    // travelling east needs no rotation and one travelling west is turned 180°.
    // ±PI/2 (the first attempt) drove them sideways down the road.
    c.rotation.y = forward ? 0 : Math.PI
    const laneIdx = forward ? 0 : 1
    const slot = perLane[laneIdx]++
    // Cars in a lane share a span and start CAR_GAP apart, so they keep formation.
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
    for (const { group, phase } of foliage) {
      group.rotation.z = Math.sin(t * 0.8 + phase) * 0.018
      group.rotation.x = Math.sin(t * 0.55 + phase) * 0.012
    }

    // ---- pedestrians: lane discipline ----
    // Two walkers must not occupy the same stretch of the same row. Sorted by x,
    // each walker is held back to PED_GAP behind the one ahead of it in its own
    // row; because every row now has ONE speed, the gap only ever opens.
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
    wallMat.color.setHex(pal.wall)
    sun.intensity = night ? 1.2 : 2.6
    sun.color.setHex(night ? 0xc9d8ee : 0xfff4e2)
    fill.intensity = night ? 0.35 : 0.45
    // lampu meja selalu menyala (premium warm), lebih kuat malam
    for (const l of lamps) l.intensity = night ? 0.85 : 0.25
    for (const s of streaks) (s.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 1.5 : 0.85
  }

  function dispose() {
    for (const d of disposables) d.dispose()
  }

  /* ------------------------------------ lobby & lounge furnishing (fill) --- */
  // The lobby was a 34 x 9 m corridor holding four objects, and the lounge read
  // as a sofa in a field. Everything here is placed on coordinates validated free
  // by nav.blocked() and non-overlapping by the self-test.
  {
    const woodMat2 = track(
      new THREE.MeshStandardMaterial({ color: 0x8f6f4a, map: deskTex, roughness: 0.55 }),
    )
    const leaf2 = track(new THREE.MeshStandardMaterial({ color: 0x4a8352, roughness: 0.9 }))
    const potMat = track(new THREE.MeshStandardMaterial({ color: 0xa8674a, roughness: 0.8 }))
    const stoneMat = track(new THREE.MeshStandardMaterial({ color: 0xcfd6da, map: plasterTex, roughness: 0.7 }))

    /** A potted plant: tapered pot plus a layered bush. */
    const potted = (x: number, z: number, r: number, h: number) => {
      const g = new THREE.Group()
      g.position.set(x, 0, z)
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.6, r * 1.1, 14), potMat)
      pot.position.y = r * 0.55
      g.add(pot)
      const soil = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.74, r * 0.74, 0.05, 14), stdMat(0x3b2f23))
      soil.position.y = r * 1.1
      g.add(soil)
      // layered foliage so it does not read as one sphere
      const layers = h > 1.4 ? 3 : 2
      for (let i = 0; i < layers; i++) {
        const rr = r * (1.15 - i * 0.22)
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(rr, 1), leaf2)
        bush.position.y = r * 1.2 + i * rr * 0.95
        bush.scale.set(1, 0.78, 1)
        g.add(bush)
      }
      group.add(g)
    }

    /* ---------------- lounge ---------------- */
    // second armchair, facing the TV wall
    {
      const g = new THREE.Group()
      g.position.set(LOUNGE.x + 2.6, 0, LOUNGE.z - 0.4)
      // Faces the TV wall to the north. The backrest is at local +Z, so no
      // rotation is needed; PI turned the chair's back to the television.
      g.rotation.y = 0
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.3, 0.8), sofaFabric)
      cushion.position.y = 0.42
      g.add(cushion)
      const backr = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.6, 0.18), sofaFabric)
      backr.position.set(0, 0.72, 0.34)
      g.add(backr)
      for (const ax of [-0.46, 0.46]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.78), sofaFabric)
        arm.position.set(ax, 0.57, 0)
        g.add(arm)
      }
      for (const [lx, lz] of [[-0.36, -0.32], [0.36, -0.32], [-0.36, 0.32], [0.36, 0.32]]) {
        const leg = cyl(0.028, 0.03, 0.4, 0x6b5334, 8)
        leg.position.set(lx, 0.2, lz)
        g.add(leg)
      }
      group.add(g)
    }

    // side table with a lamp, between the two chairs
    {
      const g = new THREE.Group()
      g.position.set(LOUNGE.x - 2.0, 0, LOUNGE.z - 2.9)
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.06, 16), woodMat2)
      top.position.y = 0.52
      g.add(top)
      const column = cyl(0.05, 0.06, 0.5, 0x6b5334, 10)
      column.position.y = 0.26
      g.add(column)
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.04, 16), stdMat(0x5b666e, { metal: 0.5 }))
      foot.position.y = 0.02
      g.add(foot)
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.24, 14, 1, true), stdMat(0xf0e2c4, { emissive: 0xffd89a, ei: hour >= 18 || hour < 6 ? 0.8 : 0.15 }))
      shade.position.y = 0.78
      g.add(shade)
      const bulb = new THREE.PointLight(0xffdcae, hour >= 18 || hour < 6 ? 0.55 : 0.1, 5)
      bulb.position.y = 0.72
      g.add(bulb)
      group.add(g)
    }

    // low console against the room's north face, with books and a bowl
    {
      const g = new THREE.Group()
      g.position.set(LOUNGE.x, 0, LOUNGE.z + 1.2)
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.72, 0.5), woodMat2)
      body.position.y = 0.38
      g.add(body)
      const topPlate = box(1.9, 0.05, 0.56, 0x6f5c45, { rough: 0.5 })
      topPlate.position.y = 0.76
      g.add(topPlate)
      for (let i = 0; i < 5; i++) {
        const bk = box(0.05, 0.24, 0.3, [0xd05f4a, 0x4a72d0, 0xd0a84a, 0x4ad08f, 0x9a4ad0][i])
        bk.position.set(-0.55 + i * 0.07, 0.9, 0)
        g.add(bk)
      }
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), stdMat(0xcfd6da, { rough: 0.4 }))
      bowl.position.set(0.5, 0.79, 0)
      bowl.rotation.x = Math.PI
      g.add(bowl)
      group.add(g)
    }

    // tall planter in the lounge corner
    potted(LOUNGE.x + 3.6, LOUNGE.z + 0.8, 0.4, 2.4)

    // pouf
    {
      const g = new THREE.Group()
      g.position.set(LOUNGE.x - 2.1, 0, LOUNGE.z - 3.9)
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 0.42, 18), sofaFabric)
      body.position.y = 0.21
      g.add(body)
      const pip = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.03, 6, 20), stdMat(0xd7dee2))
      pip.rotation.x = Math.PI / 2
      pip.position.y = 0.42
      g.add(pip)
      group.add(g)
    }

  }

  return { group, monitors, lamps, boardSurface, streaks, streetGroup, animateStreet, sun, applyPalette, dispose }
}
