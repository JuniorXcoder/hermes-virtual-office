/**
 * Beveled box: pengganti BoxGeometry tajam 90°.
 *
 * Semua sudut kartun berasal dari box tajam yang tidak menangkap highlight.
 * RoundedBoxGeometry dengan radius kecil (0.01–0.03) memberi lengkungan mikro
 * yang memantulkan cahaya — ini pembeda utama look realistis vs mainan.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * Box dengan sudut membulat mikro.
 * radius dijepit agar tidak melebihi setengah sisi terkecil (meledak bila over).
 */
export function rbox(w: number, h: number, d: number, radius = 0.02) {
  const r = Math.min(radius, Math.min(w, h, d) / 2.1)
  return new RoundedBoxGeometry(w, h, d, 2, Math.max(0.005, r))
}
