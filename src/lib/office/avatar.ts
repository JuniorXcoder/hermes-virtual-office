/**
 * Avatar rig: a low-poly figure whose limbs stay individually addressable so the
 * animation layer can pose them without touching the mesh hierarchy.
 *
 * Proportions follow a 1.8 m human, measured from the feet:
 *
 *   head top   1.80   chest group 1.42   shoulder 1.56
 *   hip        0.98   knee 0.50         sole 0.00
 *
 * The first version pinned the shoulder at 2.26 — ABOVE the head top at 2.08 —
 * which is why every posed arm ended up beside the ears.
 */
import * as THREE from 'three'
import { ROLE_COLORS } from './layout'
import type { AgentRole } from '@/types/hermes'

export type Limb = {
  shoulder: THREE.Object3D
  elbow: THREE.Object3D
}

export type Avatar = {
  group: THREE.Group
  chest: THREE.Object3D
  neck: THREE.Object3D
  head: THREE.Object3D
  hips: THREE.Object3D
  arms: [Limb, Limb]
  legs: [Limb, Limb]
  badge: THREE.Mesh
  /**
   * Equipment the avatar can hold.
   *
   * A pose makes an item visible and puts it where the fists are; everything not held
   * stays hidden. These are parented to the CHEST rather than to the scene, so they
   * stay attached while the body turns and walks without the scene having to track
   * them.
   */
  held: {
    barbell: THREE.Group
    dumbbells: [THREE.Group, THREE.Group]
  }
}

/* ------------------------------------------------------------ proportions -- */
export const HIP_STAND = 0.98
const TORSO_H = 0.66
const TORSO_W = 0.42
const TORSO_D = 0.24
/** The chest group sits on top of the torso; its Y is the shoulder's origin. */
export const CHEST_Y = TORSO_H
/** Shoulder joint, below the chest top. */
export const SHOULDER_Y = 0.14
export const SHOULDER_X = 0.25
export const UPPER_ARM = 0.32
export const FOREARM = 0.30
/** Elbow joint to the fist's centre — the hand mesh's own offset. */
export const FIST_FROM_ELBOW = FOREARM + 0.03
const HIP_X = 0.11
const THIGH = 0.48
const SHIN = 0.46

const mat = (color: number, rough = 0.7) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough })

/* -------------------------------------------------------- held equipment -- */

/**
 * Shared buffers for held equipment.
 *
 * Eleven avatars each carrying their own copy of a barbell would be eleven identical
 * sets of buffers, so the geometry and the materials live at module scope and only the
 * meshes are per-avatar.
 */
const STEEL = new THREE.MeshStandardMaterial({ color: 0xb9c0c6, metalness: 0.4, roughness: 0.3 })
const KNURL = new THREE.MeshStandardMaterial({ color: 0x6f767c, metalness: 0.3, roughness: 0.9 })
const IRON = new THREE.MeshStandardMaterial({ color: 0x24282c, metalness: 0.5, roughness: 0.55 })

const BAR_GEO = new THREE.CylinderGeometry(0.031, 0.031, 1.9, 12)
const BAR_GRIP_GEO = new THREE.CylinderGeometry(0.037, 0.037, 0.26, 12)
const COLLAR_GEO = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12)
const PLATE_GEOS = [
  new THREE.CylinderGeometry(0.21, 0.21, 0.065, 18),
  new THREE.CylinderGeometry(0.18, 0.18, 0.065, 18),
  new THREE.CylinderGeometry(0.14, 0.14, 0.065, 18),
]
const DUMBBELL_HANDLE_GEO = new THREE.CylinderGeometry(0.022, 0.022, 0.22, 8)
const DUMBBELL_HEAD_GEO = new THREE.CylinderGeometry(0.075, 0.075, 0.07, 14)

/**
 * A loaded barbell, sized from the GRIP and not from a real bar.
 *
 * The fists in the press pose are 0.82 m apart, so a 2.2 m Olympic bar would read as
 * scaffolding around a 1.8 m figure. 1.9 m with the plates outboard of the grip looks
 * like a bar somebody is actually holding, and the plate radii match the rack's so it
 * reads as the same object that was on it.
 *
 * The bar lies along local +X and is centred on the origin, so a pose places it by
 * putting its origin at the midpoint of the two fists.
 */
function buildBarbell(): THREE.Group {
  const g = new THREE.Group()
  const bar = new THREE.Mesh(BAR_GEO, STEEL)
  bar.rotation.z = Math.PI / 2
  g.add(bar)
  for (const side of [-1, 1]) {
    // Knurled bands exactly where the fists close: the grip is what makes the bar read
    // as HELD rather than as a prop balanced on the hands.
    const grip = new THREE.Mesh(BAR_GRIP_GEO, KNURL)
    grip.rotation.z = Math.PI / 2
    grip.position.x = side * 0.41
    g.add(grip)
    const collar = new THREE.Mesh(COLLAR_GEO, IRON)
    collar.rotation.z = Math.PI / 2
    collar.position.x = side * 0.66
    g.add(collar)
    // plates, biggest inboard — the same grading as the rack's
    for (const [i, off] of [0.73, 0.82, 0.905].entries()) {
      const plate = new THREE.Mesh(PLATE_GEOS[i], IRON)
      plate.rotation.z = Math.PI / 2
      plate.position.x = side * off
      g.add(plate)
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true
  })
  g.visible = false
  return g
}

/**
 * A dumbbell. The handle lies along local +X, level with the fist that holds it.
 *
 * Deliberately not following the forearm: a curl is done with the wrist locked, so the
 * bell stays level while the arm swings under it.
 */
function buildDumbbell(): THREE.Group {
  const g = new THREE.Group()
  const handle = new THREE.Mesh(DUMBBELL_HANDLE_GEO, STEEL)
  handle.rotation.z = Math.PI / 2
  g.add(handle)
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(DUMBBELL_HEAD_GEO, IRON)
    head.rotation.z = Math.PI / 2
    head.position.x = side * 0.115
    g.add(head)
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true
  })
  g.visible = false
  return g
}

export function buildAvatar(role: AgentRole, skin = 0xe9c19a): Avatar {
  const group = new THREE.Group()
  const accent = ROLE_COLORS[role] ?? 0x6f8fa8
  const trouser = 0x46505a

  // ---- legs (built first so the hip sits at the top of them)
  const hips = new THREE.Group()
  hips.position.y = HIP_STAND
  group.add(hips)

  const makeLeg = (side: number): Limb => {
    const hipJoint = new THREE.Group()
    hipJoint.position.set(side * HIP_X, 0, 0)
    hips.add(hipJoint)
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, THIGH, 0.15), mat(trouser))
    thigh.position.y = -THIGH / 2
    hipJoint.add(thigh)
    const knee = new THREE.Group()
    knee.position.y = -THIGH
    hipJoint.add(knee)
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, SHIN, 0.13), mat(0x39424b))
    shin.position.y = -SHIN / 2
    knee.add(shin)
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.26), mat(0x2f3438))
    foot.position.set(0, -SHIN + 0.02, 0.05)
    knee.add(foot)
    return { shoulder: hipJoint, elbow: knee }
  }
  const legs: [Limb, Limb] = [makeLeg(-1), makeLeg(1)]

  // ---- torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D), mat(accent))
  torso.position.y = TORSO_H / 2
  hips.add(torso)

  const chest = new THREE.Group()
  chest.position.y = CHEST_Y
  hips.add(chest)

  const neckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.12), mat(skin, 0.85))
  neckMesh.position.y = 0.045
  const neck = new THREE.Group()
  neck.add(neckMesh)
  chest.add(neck)

  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.31, 0.29), mat(skin, 0.85))
  headMesh.position.y = 0.16
  const head = new THREE.Group()
  head.add(headMesh)
  // hair cap so the head reads as a head and not a cube
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.305, 0.1, 0.305), mat(0x2b2723, 0.9))
  hair.position.y = 0.13
  head.add(hair)
  neck.add(head)

  // role badge floats above the head; colour-coded by role
  const badge = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.032, 8, 20),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.5 }),
  )
  badge.rotation.x = Math.PI / 2
  badge.position.y = 1.98
  group.add(badge)

  const makeArm = (side: number): Limb => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, 0)
    chest.add(shoulder)
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.12, UPPER_ARM, 0.12), mat(accent))
    upper.position.y = -UPPER_ARM / 2
    shoulder.add(upper)
    const elbow = new THREE.Group()
    elbow.position.y = -UPPER_ARM
    shoulder.add(elbow)
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.1, FOREARM, 0.1), mat(skin, 0.85))
    fore.position.y = -FOREARM / 2
    elbow.add(fore)
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.08), mat(skin, 0.85))
    hand.position.y = -FOREARM - 0.03
    elbow.add(hand)
    return { shoulder, elbow }
  }
  const arms: [Limb, Limb] = [makeArm(-1), makeArm(1)]

  // ---- equipment, hidden until a pose picks it up
  //
  // Parented to the GROUP, not to the chest. `fistInAvatar` in anim.ts resolves the
  // fist all the way out to the avatar's own frame (fist -> elbow -> shoulder -> chest
  // -> hips -> group), so the item's position is expressed in that frame too. Hanging
  // it off the chest applied the chest's transform a second time and the bar floated
  // 1.67 m from the hands.
  const barbell = buildBarbell()
  group.add(barbell)
  const dumbbells: [THREE.Group, THREE.Group] = [buildDumbbell(), buildDumbbell()]
  for (const d of dumbbells) group.add(d)

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = false
    }
  })

  return { group, chest, neck, head, hips, arms, legs, badge, held: { barbell, dumbbells } }
}
