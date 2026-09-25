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
}

/* ------------------------------------------------------------ proportions -- */
export const HIP_STAND = 0.98
const TORSO_H = 0.66
const TORSO_W = 0.42
const TORSO_D = 0.24
const CHEST_Y = TORSO_H // chest group sits on top of the torso
const SHOULDER_Y = 0.14 // shoulder joint below the chest top
const SHOULDER_X = 0.25
const UPPER_ARM = 0.32
const FOREARM = 0.30
const HIP_X = 0.11
const THIGH = 0.48
const SHIN = 0.46

const mat = (color: number, rough = 0.7) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough })

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

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = false
    }
  })

  return { group, chest, neck, head, hips, arms, legs, badge }
}
