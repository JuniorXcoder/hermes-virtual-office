/**
 * Animation layer.
 *
 * Every pose is a pure function of (agent, time) so there is no per-agent
 * animation state to keep in sync — the scene tick simply re-derives the pose
 * each frame from the agent's current activity.
 */
import * as THREE from 'three'
import type { Avatar } from './avatar'

import { HIP_STAND } from './avatar'

const D = Math.PI / 180
export { HIP_STAND }
/** Seated hip height: the chair seat top sits at ~0.50, so the joint rides just above it. */
export const HIP_SIT = 0.52

/** Smooth triangle-ish oscillation, deterministic in `t`. */
export function wave(t: number, freq: number, phase = 0): number {
  return Math.sin(t * freq + phase)
}

export type Activity =
  | 'idle'
  | 'walking'
  | 'typing'
  | 'meeting'
  | 'gaming'
  | 'dart'
  | 'sofa'

export type AnimAgent = {
  avatar: Avatar
  activity: Activity
  /** 0..1, ramps in when the activity starts (prevents pose snapping). */
  ease: number
  phase: number
  meetingTalking?: boolean
}

/**
 * Seated pose. `thigh` is the hip angle: -90 places the thigh horizontally
 * forward (the correct seated posture). The first version used -76..-88 *and*
 * had the hip nested under a torso that started too high, so legs read as
 * dangling stubs.
 */
function sit(a: AnimAgent, hipY: number, thigh: number, knee: number) {
  const av = a.avatar
  av.hips.position.y = hipY
  const [L, R] = av.legs
  for (const [leg, sign] of [
    [L, -1],
    [R, 1],
  ] as const) {
    leg.shoulder.rotation.x = thigh * D
    leg.shoulder.rotation.z = sign * 5 * D
    leg.elbow.rotation.x = knee * D
  }
}

function standLegs(a: AnimAgent, t: number) {
  const av = a.avatar
  av.hips.position.y = HIP_STAND
  const [L, R] = av.legs
  L.shoulder.rotation.x = wave(t, 4.2, 0) * 3 * D
  R.shoulder.rotation.x = wave(t, 4.2, Math.PI) * 3 * D
  L.shoulder.rotation.z = 0
  R.shoulder.rotation.z = 0
  L.elbow.rotation.x = -4 * D
  R.elbow.rotation.x = -4 * D
}

function walkLegs(a: AnimAgent, t: number, speed: number) {
  const av = a.avatar
  const sw = 34 * D * speed
  av.hips.position.y = HIP_STAND - 0.03 + Math.abs(wave(t, 9, a.phase)) * 0.05
  const [L, R] = av.legs
  L.shoulder.rotation.x = wave(t, 9, a.phase) * sw
  R.shoulder.rotation.x = wave(t, 9, a.phase + Math.PI) * sw
  L.elbow.rotation.x = Math.max(0, -wave(t, 9, a.phase)) * 40 * D
  R.elbow.rotation.x = Math.max(0, -wave(t, 9, a.phase + Math.PI)) * 40 * D
  av.arms[0].shoulder.rotation.x = -wave(t, 9, a.phase + Math.PI) * 22 * D
  av.arms[1].shoulder.rotation.x = -wave(t, 9, a.phase) * 22 * D
  av.arms[0].elbow.rotation.x = -18 * D
  av.arms[1].elbow.rotation.x = -18 * D
}

/** Seated at a desk, typing on the keyboard. */
function typing(a: AnimAgent, t: number) {
  const av = a.avatar
  sit(a, HIP_SIT, -90, 86)
  av.chest.rotation.x = -7 * D
  av.chest.rotation.y = 0
  av.neck.rotation.x = 4 * D
  av.head.rotation.x = 6 * D
  av.head.rotation.y = wave(t, 0.7, a.phase) * 4 * D
  const [L, R] = av.arms
  // Upper arm hangs slightly forward, forearm swings in to reach the keyboard.
  for (const [arm, sign] of [
    [L, -1],
    [R, 1],
  ] as const) {
    arm.shoulder.rotation.x = -38 * D
    arm.shoulder.rotation.z = sign * 9 * D
    arm.elbow.rotation.x = -62 * D + wave(t, 7.5, a.phase + (sign > 0 ? 1.3 : 0)) * 4 * D
  }
}

/** Seated in the conference room; raises a hand on the speaking turn. */
function meeting(a: AnimAgent, t: number) {
  const av = a.avatar
  sit(a, HIP_SIT, -90, 84)
  const talking = !!a.meetingTalking
  av.chest.rotation.x = (talking ? -5 : 9) * D
  av.chest.rotation.y = talking ? 0 : wave(t, 0.35, a.phase) * 9 * D
  av.neck.rotation.x = (talking ? -5 : 5) * D
  av.head.rotation.x = (talking ? 1 : 7) * D
  av.head.rotation.y = (talking ? wave(t, 0.6, a.phase) * 5 : wave(t, 0.4, a.phase) * 18) * D
  const [L, R] = av.arms
  const k = talking ? 1 : 0.2
  // Raised hand: shoulder forward ~50-80 deg, elbow folded — never above the head.
  R.shoulder.rotation.x = (-42 - k * 36) * D
  R.shoulder.rotation.z = (10 + k * 14) * D
  R.elbow.rotation.x = (-58 + k * 26) * D
  L.shoulder.rotation.x = (-34 - (1 - k) * 10) * D
  L.shoulder.rotation.z = -14 * D
  L.elbow.rotation.x = (-62 - (1 - k) * 14) * D
  av.hips.position.y = HIP_SIT + wave(t, 1.5, a.phase) * 0.012
}

/** Lounging on the sofa, controller in hand. */
function gaming(a: AnimAgent, t: number) {
  const av = a.avatar
  sit(a, 0.52, -90, 88)
  av.chest.rotation.x = -12 * D
  av.chest.rotation.y = wave(t, 0.4, a.phase) * 6 * D
  av.head.rotation.x = 10 * D
  av.head.rotation.y = wave(t, 1.4, a.phase) * 8 * D
  const [L, R] = av.arms
  L.shoulder.rotation.x = -46 * D
  R.shoulder.rotation.x = -46 * D
  L.shoulder.rotation.z = -16 * D
  R.shoulder.rotation.z = 16 * D
  L.elbow.rotation.x = -70 * D + wave(t, 6, a.phase) * 4 * D
  R.elbow.rotation.x = -70 * D + wave(t, 6, a.phase + 2) * 4 * D
}

/** Throwing at the dartboard: alternating arm wind-up. */
function dart(a: AnimAgent, t: number) {
  const av = a.avatar
  standLegs(a, t)
  // the throw cycle repeats every ~2.4s
  const c = (t * 0.42 + a.phase) % 1
  const raise = c < 0.5 ? c * 2 : Math.max(0, 1 - (c - 0.5) * 4)
  av.chest.rotation.y = -8 * D
  av.head.rotation.x = -6 * D
  const [L, R] = av.arms
  R.shoulder.rotation.x = (-24 - raise * 78) * D
  R.shoulder.rotation.z = (10 + raise * 10) * D
  R.elbow.rotation.x = (-40 + raise * 20) * D
  L.shoulder.rotation.x = -20 * D
  L.elbow.rotation.x = -30 * D
}

/** Relaxed sit on the sofa without a controller. */
function sofa(a: AnimAgent, t: number) {
  const av = a.avatar
  sit(a, 0.54, -92, 84)
  av.chest.rotation.x = 10 * D
  av.chest.rotation.y = wave(t, 0.3, a.phase) * 5 * D
  av.neck.rotation.x = -6 * D
  av.head.rotation.y = wave(t, 0.45, a.phase) * 22 * D
  const [L, R] = av.arms
  L.shoulder.rotation.x = -30 * D
  L.shoulder.rotation.z = -18 * D
  L.elbow.rotation.x = -46 * D
  R.shoulder.rotation.x = -30 * D
  R.shoulder.rotation.z = 18 * D
  R.elbow.rotation.x = -46 * D
  av.hips.position.y = 0.54 + wave(t, 1.1, a.phase) * 0.01
}

const TABLE: Record<Activity, (a: AnimAgent, t: number) => void> = {
  idle: (a, t) => {
    standLegs(a, t)
    const av = a.avatar
    av.chest.rotation.x = 0
    av.chest.rotation.y = 0
    av.head.rotation.y = wave(t, 0.35, a.phase) * 16 * D
    const [L, R] = av.arms
    L.shoulder.rotation.x = -6 * D
    R.shoulder.rotation.x = -6 * D
    L.shoulder.rotation.z = -4 * D
    R.shoulder.rotation.z = 4 * D
    L.elbow.rotation.x = -12 * D
    R.elbow.rotation.x = -12 * D
  },
  walking: (a, t) => walkLegs(a, t, 1),
  typing,
  meeting,
  gaming,
  dart,
  sofa,
}

/** Apply the pose for this frame. `dt` ramps `ease` so transitions are not snaps. */
export function animate(a: AnimAgent, t: number, dt: number) {
  a.ease = Math.min(1, a.ease + dt * 3.5)
  const fn = TABLE[a.activity] || TABLE.idle
  fn(a, t)
  // blend the first frames in from a neutral posture
  const e = a.ease
  if (e < 1) {
    const av = a.avatar
    av.chest.rotation.x *= e
    av.chest.rotation.y *= e
    av.head.rotation.x *= e
    av.head.rotation.y *= e
  }
}

export const ACTIVITIES: Activity[] = ['idle', 'typing', 'meeting', 'gaming', 'dart', 'sofa']
