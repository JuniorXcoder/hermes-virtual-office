/**
 * Material PBR jujur: marmer / kayu / kaca / batu.
 *
 * Prinsip: SATU material per jenis permukaan di seluruh gedung (konsisten =
 * clean). Semua prosedural canvas — repo tetap bebas file biner.
 */
import * as THREE from 'three'

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  draw(ctx, size)
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Marmer terang berurat halus — lantai aula & lobby. Glossy (premium). */
export function marbleLight() {
  const map = canvasTex(512, (c, s) => {
    const rand = rng(11)
    c.fillStyle = '#efe9dc'
    c.fillRect(0, 0, s, s)
    // urat marmer: garis tipis berliku, alpha rendah
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = rand() > 0.5 ? '#c9c2b2' : '#d8d2c2'
      c.globalAlpha = 0.25 + rand() * 0.3
      c.lineWidth = 0.8 + rand() * 1.6
      let x = rand() * s
      let y = rand() * s
      c.beginPath()
      c.moveTo(x, y)
      for (let k = 0; k < 8; k++) {
        x += (rand() - 0.5) * 120
        y += (rand() - 0.5) * 120
        c.lineTo(x, y)
      }
      c.stroke()
    }
    c.globalAlpha = 1
    // nat ubin besar 2x2
    c.strokeStyle = '#b9b2a2'
    c.lineWidth = 3
    c.strokeRect(0, 0, s, s)
    c.beginPath()
    c.moveTo(s / 2, 0)
    c.lineTo(s / 2, s)
    c.moveTo(0, s / 2)
    c.lineTo(s, s / 2)
    c.stroke()
  })
  map.repeat.set(10, 8)
  // roughness rendah + sedikit metalness = pantulan glossy (premium, bukan matte kartun)
  return new THREE.MeshStandardMaterial({ map, roughness: 0.12, metalness: 0.15, envMapIntensity: 1.2 })
}

/** Kayu hangat berserat — meja, deck, kusen. */
export function woodWarm() {
  const map = canvasTex(512, (c, s) => {
    const rand = rng(31)
    c.fillStyle = '#9a7449'
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = rand() > 0.5 ? '#7d5c36' : '#b08a5c'
      c.globalAlpha = 0.3 + rand() * 0.4
      c.lineWidth = 1 + rand() * 2.4
      const y = rand() * s
      c.beginPath()
      c.moveTo(0, y)
      for (let x = 0; x <= s; x += 32) {
        c.lineTo(x, y + Math.sin((x + i * 37) * 0.02) * 3)
      }
      c.stroke()
    }
    c.globalAlpha = 1
  })
  map.repeat.set(2, 1)
  return new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.0 })
}

/** Kaca nyata — railing & jendela (transmisi, bukan opacity). */
export function glassReal() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd6e8f0,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.9,
    thickness: 0.05,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  })
}

/** Batu gelap — dinding air kolam & bibir kolam. */
export function stoneDark() {
  const map = canvasTex(256, (c, s) => {
    const rand = rng(51)
    c.fillStyle = '#6f7a82'
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 2500; i++) {
      c.globalAlpha = 0.08 + rand() * 0.15
      c.fillStyle = rand() > 0.5 ? '#59636b' : '#8b959d'
      c.fillRect(rand() * s, rand() * s, 2, 2)
    }
    c.globalAlpha = 1
  })
  map.repeat.set(4, 2)
  return new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.05 })
}

/** Plester bersih — SATU warna dinding seluruh gedung (clean = konsisten). */
export function plasterClean() {
  return new THREE.MeshStandardMaterial({ color: 0xf2f4f4, roughness: 0.92, metalness: 0 })
}

/** Panel kayu gelap — aksen dinding premium (signage, feature wall). */
export function woodPanelDark() {
  const map = canvasTex(512, (c, s) => {
    const rand = rng(71)
    c.fillStyle = '#3a2b1e'
    c.fillRect(0, 0, s, s)
    // panel vertikal: seam gelap tiap ~64px + serat
    for (let x = 0; x < s; x += 64) {
      c.fillStyle = '#2a1e14'
      c.globalAlpha = 0.9
      c.fillRect(x, 0, 3, s)
      c.globalAlpha = 1
    }
    for (let i = 0; i < 140; i++) {
      c.strokeStyle = rand() > 0.5 ? '#4a3728' : '#2e2116'
      c.globalAlpha = 0.25 + rand() * 0.35
      c.lineWidth = 1 + rand() * 2
      const y = rand() * s
      c.beginPath()
      c.moveTo(0, y)
      for (let x = 0; x <= s; x += 40) c.lineTo(x, y + Math.sin((x + i * 29) * 0.02) * 2)
      c.stroke()
    }
    c.globalAlpha = 1
  })
  map.repeat.set(3, 1)
  return new THREE.MeshStandardMaterial({ map, roughness: 0.4, metalness: 0.05 })
}

/** Karpet abu area kerja — zonasi visual (premium, bukan lantai seragam). */
export function carpetGrey() {
  const map = canvasTex(256, (c, s) => {
    const rand = rng(83)
    c.fillStyle = '#8b8f93'
    c.fillRect(0, 0, s, s)
    for (let i = 0; i < 12000; i++) {
      c.globalAlpha = 0.05 + rand() * 0.12
      c.strokeStyle = rand() > 0.5 ? '#6f7377' : '#a3a7ab'
      c.lineWidth = 0.8
      const x = rand() * s
      const y = rand() * s
      const a = rand() * Math.PI
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3)
      c.stroke()
    }
    c.globalAlpha = 1
  })
  map.repeat.set(6, 5)
  return new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 })
}

/** Emas/brass — aksen signage & hardware premium. */
export function goldAccent() {
  return new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.28 })
}
