/**
 * Animation layer.
 *
 * Every pose is a pure function of (agent, time) so there is no per-agent
 * animation state to keep in sync — the scene tick simply re-derives the pose
 * each frame from the agent's current activity.
 */
import * as THREE from 'three'
import type { Avatar } from './avatar'

import { CHEST_Y, FIST_FROM_ELBOW, HIP_STAND, SHOULDER_X, SHOULDER_Y, UPPER_ARM } from './avatar'
import { GYM, SEATS } from './layout'

const D = Math.PI / 180
export { HIP_STAND }

/* ------------------------------------------------------------ held items -- */

/** Scratch vectors: `animate` runs once per body per frame, so no allocation. */
const _fistA = new THREE.Vector3()
const _fistB = new THREE.Vector3()

/**
 * The fist's centre in the avatar's own frame, walked through the real rig.
 *
 * Held equipment must sit IN the hands, so its position is DERIVED from the rig rather
 * than hand-tuned to it: change an arm angle and the barbell follows. Every offset here
 * is the same one `avatar.ts` builds the limb from — chest, shoulder, upper arm, elbow,
 * fist — so the two cannot drift apart.
 *
 * The result is in the avatar's frame, not the chest's, which is what keeps a held bar
 * LEVEL: the body only turns about Y, so a bar in this frame stays horizontal no matter
 * how far the torso leans.
 */
function fistInAvatar(av: Avatar, side: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
  const arm = av.arms[side]
  out.set(0, -FIST_FROM_ELBOW, 0) // fist, in the elbow's frame
  out.applyEuler(arm.elbow.rotation)
  out.y -= UPPER_ARM // elbow joint, in the shoulder's frame
  out.applyEuler(arm.shoulder.rotation)
  out.x += side === 0 ? -SHOULDER_X : SHOULDER_X
  out.y += SHOULDER_Y // shoulder joint, in the chest's frame
  out.applyEuler(av.chest.rotation)
  out.y += CHEST_Y + av.hips.position.y // chest and hips, in the avatar's frame
  return out
}

/** The barbell, centred between the two fists and level. */
function holdBarbell(a: AnimAgent) {
  const av = a.avatar
  const L = fistInAvatar(av, 0, _fistA)
  const R = fistInAvatar(av, 1, _fistB)
  const bar = av.held.barbell
  bar.visible = true
  bar.position.set((L.x + R.x) / 2, (L.y + R.y) / 2, (L.z + R.z) / 2)
  bar.rotation.set(0, 0, 0)
}

/** A dumbbell in each fist. */
function holdDumbbells(a: AnimAgent) {
  const av = a.avatar
  for (const side of [0, 1] as const) {
    const f = fistInAvatar(av, side, side === 0 ? _fistA : _fistB)
    const d = av.held.dumbbells[side]
    d.visible = true
    d.position.copy(f)
    // The wrist stays locked through a curl, so the bell stays level while the arm
    // swings under it.
    d.rotation.set(0, 0, 0)
  }
}
/**
 * Seated hip height for an office/meeting chair.
 *
 * NOT a guess: it is the hip Y that puts this rig's feet exactly on the floor for
 * the seated pose below (thigh -86, knee 92), solved by sampling the rig. The
 * chair's seat top is 0.505, so the hip rides 0.011 above it — a hair, which is
 * what "sitting on the seat" means.
 *
 * The previous 0.52 was chosen to match the chair, not the legs, and the legs are
 * what decide whether the feet touch: with the feet 4-5 cm off the floor every
 * sitter looked like they were hovering.
 */
export const HIP_SIT = SEATS.chair.hip

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
  | 'garden'
  | 'read'
  | 'coffee'
  /** Sitting on a poolside bench, watching the water. */
  | 'pool'
  /** Benching under the bar at the rack, holding it. */
  | 'barbell'
  /** Hanging from the pull-up rig, doing a pull-up. */
  | 'pullup'
  /** Curling a pair of dumbbells. */
  | 'dumbbell'
  /** Cooking at the grill. */
  | 'bbq'

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
  sit(a, HIP_SIT, SEATS.chair.thigh, SEATS.chair.knee)
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
  sit(a, HIP_SIT, SEATS.chair.thigh, SEATS.chair.knee)
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
  sit(a, SEATS.sofa.hip, SEATS.sofa.thigh, SEATS.sofa.knee)
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

/**
 * Crouched at the planter, tending plants.
 *
 * Every number here was solved against the rig, not chosen. The rig has no waist
 * joint — `chest` pivots at the TOP of the torso, so leaning forward moves the
 * head about 12 cm and the hands not at all. Standing up, the hands cannot reach
 * below y=1.13, while the planter's leaves sit at 0.82. A crouch is therefore the
 * only pose that reaches the bed, and the crouch has to be REAL: the previous one
 * used hip 0.46 with thigh -74, which measured 13 cm of leg THROUGH the floor
 * (the floor hid it) and a knee 0.46 m forward — the same as sitting. That is why
 * it read as a person sitting in mid-air with no chair.
 *
 * Solved: hip 0.634, thigh -50, knee 115. Feet plant at 0.000, the knee comes
 * 0.368 forward (vs 0.479 seated — clearly a crouch), and the hands land on the
 * leaves at 0.820 with zero error.
 */
function garden(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  for (const [leg, sign] of [
    [av.legs[0], -1],
    [av.legs[1], 1],
  ] as const) {
    leg.shoulder.rotation.x = m(-50 * D)
    leg.shoulder.rotation.z = sign * m(9 * D)
    leg.elbow.rotation.x = m(115 * D)
  }
  av.hips.position.y = HIP_STAND - (HIP_STAND - 0.634) * k
  // Torso folds FORWARD over the bed (positive chest leans toward local +Z).
  av.chest.rotation.x = m(35 * D)
  av.chest.rotation.y = wave(t, 0.5, a.phase) * 8 * D
  av.neck.rotation.x = m(12 * D)
  av.head.rotation.x = m(16 * D)
  av.head.rotation.y = wave(t, 0.65, a.phase) * 14 * D
  const [L, R] = av.arms
  // Both hands reach down onto the leaves; one works in a small repeated motion.
  const work = wave(t, 2.1, a.phase)
  L.shoulder.rotation.x = m(-30 * D) + work * 4 * D
  L.shoulder.rotation.z = m(-12 * D)
  L.elbow.rotation.x = m(-40 * D) + work * 6 * D
  R.shoulder.rotation.x = m(-32 * D) - work * 5 * D
  R.shoulder.rotation.z = m(12 * D)
  R.elbow.rotation.x = m(-42 * D) - work * 7 * D
}

/** Seated in the armchair with a book: page turns every few seconds. */
function read(a: AnimAgent, t: number) {
  const av = a.avatar
  sit(a, SEATS.bench.hip, SEATS.bench.thigh, SEATS.bench.knee)
  av.chest.rotation.x = -14 * D
  av.chest.rotation.y = wave(t, 0.28, a.phase) * 5 * D
  av.neck.rotation.x = 14 * D
  av.head.rotation.x = 12 * D
  // slow scan across the page
  av.head.rotation.y = wave(t, 0.22, a.phase) * 12 * D
  const [L, R] = av.arms
  // both forearms up in front of the chest, holding the book open
  L.shoulder.rotation.x = -34 * D
  L.shoulder.rotation.z = -22 * D
  L.elbow.rotation.x = -78 * D
  R.shoulder.rotation.x = -34 * D
  R.shoulder.rotation.z = 22 * D
  R.elbow.rotation.x = -78 * D
  // a page turn every ~7 s
  const turn = ((t * 0.14 + a.phase) % 1) < 0.12 ? 1 : 0
  R.elbow.rotation.x += turn * -10 * D
  R.shoulder.rotation.z += turn * -8 * D
}

/** Perched on a pantry stool with a mug: sip, lower, glance around. */
function coffee(a: AnimAgent, t: number) {
  const av = a.avatar
  // stools are counter height, so the hip rides higher than a desk chair
  sit(a, SEATS.stool.hip, SEATS.stool.thigh, SEATS.stool.knee)
  const sip = Math.max(0, wave(t, 0.55, a.phase))
  av.chest.rotation.x = (-4 - sip * 5) * D
  av.chest.rotation.y = wave(t, 0.3, a.phase) * 7 * D
  av.neck.rotation.x = (-2 - sip * 6) * D
  av.head.rotation.x = (5 - sip * 10) * D
  av.head.rotation.y = wave(t, 0.4, a.phase) * 16 * D
  const [L, R] = av.arms
  // right hand carries the mug up to the mouth on the sip beat
  R.shoulder.rotation.x = (-40 - sip * 34) * D
  R.shoulder.rotation.z = (12 + sip * 4) * D
  R.elbow.rotation.x = (-64 + sip * 46) * D
  // left hand rests on the counter
  L.shoulder.rotation.x = -28 * D
  L.shoulder.rotation.z = -16 * D
  L.elbow.rotation.x = -52 * D
}

/** Sitting on a poolside bench, watching the water. */
function pool(a: AnimAgent, t: number) {
  const av = a.avatar
  sit(a, SEATS.bench.hip, SEATS.bench.thigh, SEATS.bench.knee)
  // leaning back on the bench, hands resting on the lap
  av.chest.rotation.x = 6 * D
  av.chest.rotation.y = wave(t, 0.22, a.phase) * 4 * D
  av.neck.rotation.x = -4 * D
  av.head.rotation.x = 4 * D
  av.head.rotation.y = wave(t, 0.18, a.phase) * 16 * D
  const [L, R] = av.arms
  for (const [arm, sign] of [
    [L, -1],
    [R, 1],
  ] as const) {
    arm.shoulder.rotation.x = -18 * D
    arm.shoulder.rotation.z = sign * 14 * D
    arm.elbow.rotation.x = -46 * D
  }
}

/** Relaxed sit on the sofa without a controller. */
function sofa(a: AnimAgent, t: number) {
  const av = a.avatar
  sit(a, SEATS.sofa.hip, SEATS.sofa.thigh, SEATS.sofa.knee)
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

/**
 * Benching at the rack: a standing overhead press, with the bar IN the hands.
 *
 * The barbell is not decoration placed near the avatar — `holdBarbell` derives its
 * position from the two fists, so the bar travels with the press. The travel is
 * chest height (1.32) to overhead (2.08), which is why the bar's rest height on the
 * rack is the same number: the bottom of the press meets the bar where it lives.
 */
function barbell(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  // feet apart, slight crouch
  standLegs(a, t)
  for (const [leg, sign] of [
    [av.legs[0], -1],
    [av.legs[1], 1],
  ] as const) {
    leg.shoulder.rotation.z = sign * m(7 * D)
    leg.elbow.rotation.x = m(16 * D)
  }
  av.hips.position.y = HIP_STAND - 0.05 * k
  // torso leans back a touch, as under a bar
  av.chest.rotation.x = m(-8 * D)
  av.chest.rotation.y = 0
  av.neck.rotation.x = m(-6 * D)
  av.head.rotation.x = m(-10 * D)
  av.head.rotation.y = wave(t, 0.4, a.phase) * 6 * D
  const [L, R] = av.arms
  // the PRESS: a slow up/down cycle, both arms together
  const press = (Math.sin(t * 1.15 + a.phase) + 1) / 2
  L.shoulder.rotation.x = m(-96 * D) + press * 62 * D
  L.shoulder.rotation.z = m(-16 * D)
  L.elbow.rotation.x = m(-52 * D) + press * 44 * D
  R.shoulder.rotation.x = m(-96 * D) + press * 62 * D
  R.shoulder.rotation.z = m(16 * D)
  R.elbow.rotation.x = m(-52 * D) + press * 44 * D
  holdBarbell(a)
}

/**
 * Curling a pair of dumbbells: alternating arms, elbows pinned to the ribs.
 *
 * The upper arm does NOT swing — a curl rotates about the elbow, which is what makes
 * it read as a curl rather than as a wave. The dumbbell follows the fist and stays
 * level, because a wrist locked under load does not rotate.
 */
function dumbbell(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  standLegs(a, t)
  av.hips.position.y = HIP_STAND - 0.02 * k
  av.chest.rotation.x = m(-4 * D)
  av.chest.rotation.y = wave(t, 0.5, a.phase) * 5 * D
  av.neck.rotation.x = m(4 * D)
  av.head.rotation.x = m(6 * D)
  av.head.rotation.y = wave(t, 0.5, a.phase) * 8 * D
  const [L, R] = av.arms
  // The two arms alternate: each does one full curl per cycle, half a cycle apart.
  for (const [arm, sign, off] of [
    [L, -1, 0],
    [R, 1, Math.PI],
  ] as const) {
    const c = (Math.sin(t * 1.5 + a.phase + off) + 1) / 2
    // upper arm hangs, angled slightly out from the ribs and held there
    arm.shoulder.rotation.x = m(-14 * D)
    arm.shoulder.rotation.z = sign * m(11 * D)
    // the elbow does the work: -14 deg hanging, -104 deg fully curled
    arm.elbow.rotation.x = m(-14 * D) - c * 90 * D
  }
  holdDumbbells(a)
}

/**
 * Hanging from the pull-up rig, doing a pull-up.
 *
 * THE HEIGHT IS SOLVED, NOT GUESSED. A body hanging from a bar has its hips wherever
 * the arms put them, so the pose sets the arm angles and then shifts the hips by the
 * error between where the fists ended up and where the bar actually is. That is why
 * `GYM.rig.barY` is data: the mesh and the pose read the same number, so the fists
 * cannot end up beside the bar instead of on it.
 *
 * The feet leave the floor as a consequence — which is the point. A pull-up you can
 * do standing on the ground is not a pull-up.
 */
function pullup(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  // 0 = dead hang (arms straight), 1 = chin at the bar
  const pull = (Math.sin(t * 0.8 + a.phase) + 1) / 2
  // legs dangle and swing a little, knees softly bent
  const swing = wave(t, 0.8, a.phase)
  for (const [leg, sign] of [
    [av.legs[0], -1],
    [av.legs[1], 1],
  ] as const) {
    leg.shoulder.rotation.x = m(6 * D) + swing * 7 * D + pull * 12 * D
    leg.shoulder.rotation.z = sign * m(4 * D)
    leg.elbow.rotation.x = m(14 * D) + pull * 26 * D
  }
  av.chest.rotation.x = m(2 * D) - pull * 6 * D
  av.chest.rotation.y = swing * 3 * D
  av.neck.rotation.x = m(-8 * D)
  av.head.rotation.x = m(-10 * D) - pull * 6 * D
  av.head.rotation.y = wave(t, 0.35, a.phase) * 8 * D
  // Arms overhead, gripping. The elbow folds as the body rises: straight at the dead
  // hang, about 105 deg at the top.
  const [L, R] = av.arms
  for (const [arm, sign] of [
    [L, -1],
    [R, 1],
  ] as const) {
    arm.shoulder.rotation.x = m(-168 * D)
    arm.shoulder.rotation.z = sign * m(8 * D)
    arm.elbow.rotation.x = m(-2 * D) - pull * 103 * D
  }
  // Solve the hip height so the fists land ON the bar. `hips.position.y` enters the
  // fist's Y with coefficient exactly 1, so one correction is exact.
  av.hips.position.y = HIP_STAND
  const f = fistInAvatar(av, 0, _fistA)
  av.hips.position.y += GYM.rig.barY - f.y
}

/**
 * At the grill: leaning slightly forward, one arm turning something.
 *
 * The hand does a small repeated rotation — the read is "cooking", not "standing
 * next to a counter".
 */
function bbq(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  standLegs(a, t)
  av.hips.position.y = HIP_STAND
  av.chest.rotation.x = m(16 * D)
  av.chest.rotation.y = wave(t, 0.3, a.phase) * 4 * D
  av.neck.rotation.x = m(10 * D)
  av.head.rotation.x = m(14 * D)
  av.head.rotation.y = wave(t, 0.45, a.phase) * 10 * D
  const [L, R] = av.arms
  // left hand steadies the counter
  L.shoulder.rotation.x = m(-52 * D)
  L.shoulder.rotation.z = m(-14 * D)
  L.elbow.rotation.x = m(-58 * D)
  // right hand turns the tongs
  const turn = Math.sin(t * 1.9 + a.phase)
  R.shoulder.rotation.x = m(-58 * D) + turn * 10 * D
  R.shoulder.rotation.z = m(12 * D)
  R.elbow.rotation.x = m(-64 * D) + turn * 18 * D
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
  garden,
  read,
  coffee,
  pool,
  barbell,
  pullup,
  dumbbell,
  bbq,
}

/** Apply the pose for this frame. `dt` ramps `ease` so transitions are not snaps. */
export function animate(a: AnimAgent, t: number, dt: number) {
  a.ease = Math.min(1, a.ease + dt * 3.5)
  // Equipment is re-hidden every frame and a pose re-shows what it needs. Doing it here
  // (rather than in each of the fifteen poses) means a pose cannot forget: an avatar
  // leaving the gym would otherwise keep carrying the barbell to its desk.
  const held = a.avatar.held
  held.barbell.visible = false
  held.dumbbells[0].visible = false
  held.dumbbells[1].visible = false
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

/**
 * Every activity the pose table implements. Kept alongside `TABLE` so adding a
 * walk-in-the-park to the union without a pose (or vice versa) is a type error.
 */
export const ACTIVITIES: Activity[] = Object.keys(TABLE) as Activity[]
