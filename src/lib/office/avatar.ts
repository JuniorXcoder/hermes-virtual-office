/**
 * Avatar rig: a low-poly figure whose limbs stay individually addressable so the
 * animation layer can pose them without touching the mesh hierarchy.
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

const mat = (color: number, rough = 0.7) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough })

export function buildAvatar(role: AgentRole, skin = 0xe4b48c): Avatar {
  const group = new THREE.Group()
  const accent = ROLE_COLORS[role] ?? 0x6f8fa8

  const hips = new THREE.Group()
  hips.position.y = 1.16
  group.add(hips)

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.58, 0.26), mat(accent))
  torso.position.y = 0.29
  hips.add(torso)

  const chest = new THREE.Group()
  chest.position.y = 0.58
  hips.add(chest)

  const neck = new THREE.Group()
  chest.add(neck)

  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat(skin, 0.85))
  headMesh.position.y = 0.19
  const head = new THREE.Group()
  head.add(headMesh)
  neck.add(head)

  // role badge floats above the head; colour-coded by role
  const badge = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.035, 8, 20),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.5 }),
  )
  badge.rotation.x = Math.PI / 2
  badge.position.y = 1.85
  group.add(badge)

  const makeArm = (side: number): Limb => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * 0.29, 0.52, 0)
    chest.add(shoulder)
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.13), mat(accent))
    upper.position.y = -0.21
    shoulder.add(upper)
    const elbow = new THREE.Group()
    elbow.position.y = -0.42
    shoulder.add(elbow)
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.38, 0.11), mat(skin, 0.85))
    fore.position.y = -0.19
    elbow.add(fore)
    return { shoulder, elbow }
  }
  const arms: [Limb, Limb] = [makeArm(-1), makeArm(1)]

  const makeLeg = (side: number): Limb => {
    const hip = new THREE.Group()
    hip.position.set(side * 0.12, -0.05, 0)
    hips.add(hip)
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.44, 0.16), mat(0x39414a))
    thigh.position.y = -0.22
    hip.add(thigh)
    const knee = new THREE.Group()
    knee.position.y = -0.44
    hip.add(knee)
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), mat(0x2d343b))
    shin.position.y = -0.21
    knee.add(shin)
    return { shoulder: hip, elbow: knee }
  }
  const legs: [Limb, Limb] = [makeLeg(-1), makeLeg(1)]

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = false
    }
  })

  return { group, chest, neck, head, hips, arms, legs, badge }
}
