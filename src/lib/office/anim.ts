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
import { GYM, SEATS, WATER_Y } from './layout'

const D = Math.PI / 180
/** The bench pad's surface, read from the same data the mesh is built from. */
const BENCH_TOP = GYM.rack.benchTop
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
  out.y += CHEST_Y // chest, in the waist's frame
  out.applyEuler(av.waist.rotation) // the WAIST, which lays the upper body down
  out.y += av.hips.position.y // waist and hips, in the avatar's frame
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
  /**
   * Slide the GRIP BANDS onto the fists.
   *
   * They used to be fixed at +-0.41 — the width of the overhead press — so a wider grip
   * (a bench press opens to 1.26 m) left the hands holding bare bar between the bands. The
   * knurling is what says "held", so it has to be where the hands are.
   *
   * A bar is 1.9 m long, so the band cannot run past +-0.95 minus its own half-length. The
   * grip is clamped inside that and the plates stay outside it.
   */
  const grips = av.held.barbellGrips
  const half = L.distanceTo(R) / 2
  const at = Math.max(0.28, Math.min(0.72, half))
  for (const [i, g] of grips.entries()) {
    g.position.x = i === 0 ? -at : at
  }
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
 * WHICH MEAL this body is having.
 *
 * Random per body and stable for the whole rest, so a diner does not flip between a
 * burger and a pizza every frame. `phase` is per-agent and constant, so it is the
 * natural seed — and `Math.floor(phase * 7) % 2` needs no extra state on the agent.
 */
function mealFor(a: AnimAgent): 'burger' | 'pizza' {
  return Math.floor(a.phase * 7) % 2 === 0 ? 'burger' : 'pizza'
}

/**
 * A burger in the right fist, raised to the mouth.
 *
 * `lift` is 0 (hand at the table) .. 1 (at the mouth); the pose passes the chew cycle
 * so the burger moves with the head rather than hovering in front of a still face.
 */
function holdBurger(a: AnimAgent, lift: number) {
  const av = a.avatar
  const f = fistInAvatar(av, 1, _fistB)
  const b = av.held.burger
  b.visible = true
  b.position.copy(f)
  // the stack sits on top of the fist, and tips slightly toward the mouth
  b.position.y += 0.02
  b.rotation.set(-lift * 0.5, 0, 0)
}

/** The pizza box, held level between both fists. */
function holdPizza(a: AnimAgent) {
  const av = a.avatar
  const L = fistInAvatar(av, 0, _fistA)
  const R = fistInAvatar(av, 1, _fistB)
  const p = av.held.pizza
  p.visible = true
  p.position.set((L.x + R.x) / 2, (L.y + R.y) / 2, (L.z + R.z) / 2)
  p.rotation.set(0, 0, 0)
}

/** The tongs, in the right fist, with the jaws squeezed by `grip`. */
function holdTongs(a: AnimAgent, grip: number) {
  const av = a.avatar
  const f = fistInAvatar(av, 1, _fistB)
  const t = av.held.tongs
  t.visible = true
  t.position.copy(f)
  t.rotation.set(0, 0, 0)
  // squeeze the arms: they hang from the pivot at the fist
  const arms = t.children.slice(0, 2)
  for (const [i, arm] of arms.entries()) {
    arm.rotation.z = (i === 0 ? -1 : 1) * (0.05 + grip * 0.12)
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
  /** Swimming a lane in the pool. */
  | 'swim'
  /** Sitting at a dining table, eating a burger or a pizza. */
  | 'eat'
  /** Lying back on a daybed. */
  | 'recline'
  /** Standing at the rack, holding the bar. */
  | 'barbell'
  /** Lying on the bench, pressing the bar. */
  | 'benchpress'
  /** Hanging from the pull-up rig, doing a pull-up. */
  | 'pullup'
  /** Pulling up until the bar reaches the waist. */
  | 'muscleup'
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
  // The torso must be RESET here. This function sets the legs and arms and leaves the
  // chest alone, so a body that had just swum kept the swimmer's torso ROLL — 8 degrees of
  // twist — for the whole walk back to its desk. Measured: `walking` reported 8.00 after a
  // swim and 0.00 from a standing start, which is the leak.
  av.chest.rotation.x = 0
  av.chest.rotation.y = 0
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
 * Benching: LYING on the bench, pressing the bar.
 *
 * The body is horizontal, which is what makes it a bench press and not a seated press.
 * That needs the WAIST: `chest` pivots at the shoulders, so a chest-only lean tips the head
 * back and leaves the torso upright — the body reads as SITTING at the bench, which is what
 * the user saw.
 *
 * The rack's own bar is hidden while this runs (see `holdBarbell`), because the bar is in
 * the lifter's hands: two bars in the same place is the same mistake as two idle spots.
 */
function benchpress(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  // Lay the upper body flat on the pad. The pad's top is 0.52, so the hip rides just above
  // it and the waist lays the torso along the bench.
  av.waist.rotation.x = m(-88 * D)
  av.waist.rotation.y = 0
  av.hips.position.y = BENCH_TOP * k + HIP_STAND * (1 - k)
  // LEGS: knees up, feet flat on the floor beside the bench.
  //
  // Measured, not guessed. `-64 / +78` put both feet 0.19 m THROUGH the floor: the hip sits
  // on the pad at 0.56, so the legs must reach exactly the 0.56 m down to the ground while
  // still reading as "knees bent over the bench". The fold is solved for that drop instead
  // of eyeballed — THIGH 0.40 and SHIN 0.52 with the hip at 0.56 gives, at thigh -74 and
  // knee 112, a sole at y = 0.00 and the knee forward and up.
  //
  // This is the "begitu juga saat ... tiduran" report: a body lying on the bench press with
  // its feet buried in the floor slab.
  for (const [leg, sign] of [
    [av.legs[0], -1],
    [av.legs[1], 1],
  ] as const) {
    leg.shoulder.rotation.x = m(-74 * D)
    leg.shoulder.rotation.z = sign * m(12 * D)
    leg.elbow.rotation.x = m(112 * D)
  }
  // The torso is already flat; a slight arch and the head resting on the pad.
  av.chest.rotation.x = m(6 * D)
  av.chest.rotation.y = 0
  av.neck.rotation.x = m(-14 * D)
  av.head.rotation.x = m(-6 * D)
  av.head.rotation.y = wave(t, 0.3, a.phase) * 5 * D
  // ARMS: press from the chest to lockout. At the bottom the elbows are wide and bent; at
  // the top they are straight. Both arms together, because a bar is one object.
  const press = (Math.sin(t * 0.95 + a.phase) + 1) / 2
  const [L, R] = av.arms
  for (const [arm, sign] of [
    [L, -1],
    [R, 1],
  ] as const) {
    arm.shoulder.rotation.x = m(-88 * D) + press * 46 * D
    arm.shoulder.rotation.z = sign * m(36 * D)
    arm.elbow.rotation.x = m(-96 * D) + press * 92 * D
  }
  holdBarbell(a)
}

/**
 * Swimming a lane.
 *
 * THE BODY LIES FLAT, and that needs the WAIST. `chest` pivots at the shoulders, so leaning
 * it only tips the head back — the torso stays upright and the swimmer reads as a standing
 * person with a stiff neck, floating above the water. `waist` pivots at the hip and lays
 * the whole upper body down.
 *
 * The height is then solved against the WATER SURFACE, which is at `POOL.waterY - 0.06`
 * (the mesh offsets it), not at `POOL.waterY`. Getting that wrong is what left the body
 * hovering: it was set from the hip, and a horizontal body's hip is BELOW its centre.
 */
function swim(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  const stroke = (off: number) => Math.sin(t * 2.85 + a.phase + off)
  // Lay the upper body flat, face-down, at the waterline. The waist stays at 90 deg:
  // pitching it up to lift the hands was measured to float the HEAD 14 cm clear of the
  // water instead — the head is a child of the waist, so the two cannot be traded.
  // Hand clearance is the arm's job (below), not the torso's.
  av.waist.rotation.x = m(90 * D)
  av.waist.rotation.y = 0
  // The hips ride at the surface, 3 cm proud of it for buoyancy headroom. `WATER_Y` is
  // where the plane actually is. Measured: this keeps the head at the waterline
  // (skull 0.03..0.25) without lifting the whole body clear of the pool.
  av.hips.position.y = (WATER_Y + 0.03) * k + HIP_STAND * (1 - k)
  // The torso rolls slightly with the stroke, and the head lifts to breathe.
  av.chest.rotation.x = m(-16 * D) + wave(t, 1.4, a.phase) * 5 * D
  av.chest.rotation.y = wave(t, 1.4, a.phase) * 8 * D
  av.neck.rotation.x = m(-38 * D)
  av.head.rotation.x = m(-26 * D)
  av.head.rotation.y = wave(t, 1.4, a.phase) * 24 * D
  // LEGS: flutter kick, straight out behind. They hang from the hips, so a -90 rotation
  // lays them along the body.
  for (const [leg, sign] of [
    [av.legs[0], -1],
    [av.legs[1], 1],
  ] as const) {
    leg.shoulder.rotation.x = m(-90 * D) + wave(t, 5.5, a.phase + (sign > 0 ? Math.PI : 0)) * 12 * D
    leg.shoulder.rotation.z = sign * m(3 * D)
    leg.elbow.rotation.x = m(6 * D)
  }
  // ARMS: the crawl.
  //
  // HONEST BOUND ON THE PENETRATION: the basin is only 0.37 m deep (floor -0.38,
  // surface -0.01) and the arm is 0.65 m long, so a straight arm pointing down reaches
  // -0.80 — 0.42 m into the concrete. Sixteen rounds of measurement (shoulder sweep,
  // elbow fold, waist pitch, hips height, and a full re-author as a shallow sweep)
  // established that no combination of these joints keeps the hand out of the floor
  // for the whole cycle. The best of them is this one: the fold is gated to the part of
  // the stroke where it provably lifts the hand (in front of vertical), which cuts the
  // time spent in the floor from 29% / 24% to about 7% / 6%, and keeps the head at the
  // waterline. The residual is the hand at full extension; a shorter basin or a shorter
  // arm is what would remove it, not another angle.
  const [L, R] = av.arms
  for (const [arm, sign, off] of [
    [L, -1, 0],
    [R, 1, Math.PI],
  ] as const) {
    const s = stroke(off)
    arm.shoulder.rotation.x = m(-135 * D) + s * 80 * D
    // Elbow fold, gated to the part of the sweep where it provably LIFTS the hand.
    // Past -2.0 rad the same fold swings the forearm down and makes it worse, so the
    // gate is on the shoulder angle; it is also multiplied by the stroke phase, because
    // the recovery top sits inside that shoulder range.
    const shX = arm.shoulder.rotation.x
    const frontOfVertical = Math.max(0, Math.min(1, (shX + 2.0) / 0.3))
    const pull = Math.sqrt(Math.max(0, s)) * frontOfVertical
    // ADDUCTION through the deep window. Histogramming every crossing frame put the
    // remaining penetration in one narrow band (s = 0.2..0.5); in that configuration
    // the elbow cannot help, but pulling the arm IN toward the body shortens the
    // vertical reach. Swept on the rig: 0 deg = 13.4% of the stroke through the floor,
    // 60 deg = 0.0% with the hand bottoming at -0.30.
    const deep = Math.exp(-Math.pow((s - 0.35) / 0.25, 2))
    arm.shoulder.rotation.z = sign * m(18 * D) + sign * m(60 * D) * deep
    arm.elbow.rotation.x = m(-30 * D) + s * 24 * D + pull * m(150 * D)
  }
}

/**
 * Lying back on a daybed, hands behind the head.
 *
 * The daybed's back rest is RAISED, so this is a recline, not a flat lie: the torso is
 * about 35 deg off horizontal and the legs go out along the bed.
 *
 * `face` on the spot already points the body the right way — head away from the water,
 * looking across it — so this pose only has to lay the body down.
 */
function recline(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  // The bed surface is 0.5; lying on it puts the hip there.
  const HIP_LIE = 0.54
  av.hips.position.y = HIP_LIE * k + HIP_STAND * (1 - k)
  // LYING, and that needs the WAIST. The first version only leaned the CHEST, which pivots
  // at the shoulders — so the torso stayed upright and the "reclining" body measured a
  // chest-to-hip gap of 0.66, exactly a standing body's. The waist lays the torso back
  // along the raised back rest.
  // -76 deg: measured, not chosen. At -64 the chest-to-hip gap is 0.289, which reads as
  // SITTING on the bed; at -76 it is 0.160, clearly lying back while still propped on the
  // daybed's raised rest. -84 would be flat and would waste the rest.
  av.waist.rotation.x = m(-76 * D)
  av.waist.rotation.y = 0
  // LEGS: straight out along the bed, one knee loosely bent. They hang from the hips, so
  // they need their own rotation to lie along the bed rather than hang off the end.
  for (const [leg, sign] of [
    [av.legs[0], -1],
    [av.legs[1], 1],
  ] as const) {
    leg.shoulder.rotation.x = m(-84 * D) + (sign > 0 ? m(14 * D) : 0)
    leg.shoulder.rotation.z = sign * m(6 * D)
    leg.elbow.rotation.x = m(sign > 0 ? 30 * D : 8 * D)
  }
  // The torso is already laid back; the head rests and turns slowly.
  av.chest.rotation.x = m(6 * D)
  av.chest.rotation.y = wave(t, 0.25, a.phase) * 4 * D
  av.neck.rotation.x = m(8 * D)
  av.head.rotation.x = m(6 * D)
  av.head.rotation.y = wave(t, 0.2, a.phase) * 20 * D
  // ARMS: hands behind the head, elbows out. That is what makes a recline read as relaxing
  // rather than as a body that fell over.
  const [L, R] = av.arms
  for (const [arm, sign] of [
    [L, -1],
    [R, 1],
  ] as const) {
    arm.shoulder.rotation.x = m(-118 * D)
    arm.shoulder.rotation.z = sign * m(52 * D)
    arm.elbow.rotation.x = m(-112 * D)
  }
}

/**
 * Eating at a dining table.
 *
 * Two meals, chosen per body by `mealFor` and stable for the whole sitting:
 *
 *   burger  one hand raises it to the mouth on a chew cycle
 *   pizza   both hands hold the box at chest height, and the head dips to it
 *
 * Both use `SEATS.chair`, because a dining chair is the same height as a desk chair —
 * that is why there is no fifth seat profile.
 */
function eat(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  sit(a, HIP_SIT, SEATS.chair.thigh, SEATS.chair.knee)
  // chewing: a small head bob plus a jaw-ish nod
  const chew = wave(t, 3.2, a.phase)
  av.chest.rotation.x = m(-6 * D)
  av.chest.rotation.y = wave(t, 0.35, a.phase) * 5 * D
  av.neck.rotation.x = m(8 * D) + chew * 3 * D
  av.head.rotation.x = m(10 * D) + chew * 5 * D
  av.head.rotation.y = wave(t, 0.4, a.phase) * 8 * D

  const [L, R] = av.arms
  if (mealFor(a) === 'burger') {
    // right hand carries the burger: down to the plate, up to the mouth
    const lift = (Math.sin(t * 0.9 + a.phase) + 1) / 2
    R.shoulder.rotation.x = m(-34 * D) - lift * 46 * D
    R.shoulder.rotation.z = m(14 * D)
    R.elbow.rotation.x = m(-58 * D) - lift * 46 * D
    // left hand rests on the table
    L.shoulder.rotation.x = m(-30 * D)
    L.shoulder.rotation.z = m(-16 * D)
    L.elbow.rotation.x = m(-56 * D)
    holdBurger(a, lift)
  } else {
    // both hands on the box, held at chest height; the head dips to it
    for (const [arm, sign] of [
      [L, -1],
      [R, 1],
    ] as const) {
      arm.shoulder.rotation.x = m(-52 * D) + chew * 5 * D
      arm.shoulder.rotation.z = sign * m(20 * D)
      arm.elbow.rotation.x = m(-78 * D)
    }
    holdPizza(a)
  }
}

/**
 * Hanging from the rig, doing a MUSCLE-UP.
 *
 * Different from a pull-up: the body rises until the bar reaches the WAIST, which is
 * above the pull-up's top, and the knees tuck at the top. `GYM.rig.barY` is the same
 * data the pull-up solves against, so the two cannot disagree about where the bar is.
 */
function muscleup(a: AnimAgent, t: number) {
  const av = a.avatar
  const k = Math.min(1, a.ease)
  const m = (v: number) => v * k
  // 0 = dead hang, 1 = supported above the bar
  const up = (Math.sin(t * 0.62 + a.phase) + 1) / 2
  const swing = wave(t, 0.7, a.phase)
  // LEGS: hang straight, then tuck hard at the top.
  for (const [leg, sign] of [
    [av.legs[0], -1],
    [av.legs[1], 1],
  ] as const) {
    leg.shoulder.rotation.x = m(4 * D) + swing * 6 * D + up * 96 * D
    leg.shoulder.rotation.z = sign * m(5 * D)
    leg.elbow.rotation.x = m(10 * D) + up * 78 * D
  }
  av.chest.rotation.x = m(4 * D) - up * 14 * D
  av.chest.rotation.y = swing * 3 * D
  av.neck.rotation.x = m(-6 * D)
  av.head.rotation.x = m(-8 * D) - up * 10 * D
  av.head.rotation.y = wave(t, 0.3, a.phase) * 7 * D
  // ARMS: straight at the hang, then the elbows fold hard and drive down past the ribs.
  const [L, R] = av.arms
  for (const [arm, sign] of [
    [L, -1],
    [R, 1],
  ] as const) {
    arm.shoulder.rotation.x = m(-170 * D) + up * 118 * D
    arm.shoulder.rotation.z = sign * m(9 * D)
    arm.elbow.rotation.x = m(-4 * D) - up * 118 * D
  }
  // Solve the hip height so the fists land ON the bar, exactly as the pull-up does.
  //
  // The whole pull is then driven by the ARMS, not by moving the body: at the top the
  // elbows fold and the chest rises to the bar. The first version ALSO raised the hips by
  // `up * 0.34`, which lifted the fists 0.34 m clear of the bar — the hands let go of the
  // thing they were supposed to be gripping. The measurement caught it.
  av.hips.position.y = HIP_STAND
  const f = fistInAvatar(av, 0, _fistA)
  av.hips.position.y += GYM.rig.barY - f.y
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
 * At the grill: leaning slightly forward, tongs in hand, turning something.
 *
 * The tongs are HELD (derived from the fist), and the jaws squeeze on the beat — the
 * read is "cooking", not "standing next to a counter". The `face` on the spot points the
 * body at the counter, so the smoke and the cook line up.
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
  // right hand works the tongs: a slow turn plus a squeeze
  const turn = Math.sin(t * 1.9 + a.phase)
  const grip = (Math.sin(t * 3.1 + a.phase) + 1) / 2
  R.shoulder.rotation.x = m(-58 * D) + turn * 10 * D
  R.shoulder.rotation.z = m(12 * D)
  R.elbow.rotation.x = m(-64 * D) + turn * 18 * D
  holdTongs(a, grip)
}

/**
 * Sitting on a poolside bench, watching the water.
 *
 * The spot's `face` points at the water (the benches are south of the pool and look
 * north), so this pose only has to sit the body down.
 */
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
  swim,
  eat,
  recline,
  barbell,
  benchpress,
  pullup,
  muscleup,
  dumbbell,
  bbq,
}

/** Apply the pose for this frame. `dt` ramps `ease` so transitions are not snaps. */
export function animate(a: AnimAgent, t: number, dt: number) {
  a.ease = Math.min(1, a.ease + dt * 3.5)
  // Equipment is re-hidden every frame and a pose re-shows what it needs. Doing it here
  // (rather than in each of the eighteen poses) means a pose cannot forget: an avatar
  // leaving the gym would otherwise keep carrying the barbell to its desk.
  const held = a.avatar.held
  held.barbell.visible = false
  held.dumbbells[0].visible = false
  held.dumbbells[1].visible = false
  held.burger.visible = false
  held.pizza.visible = false
  held.tongs.visible = false
  // THE WAIST IS RESET EVERY FRAME, for the same reason the equipment is.
  //
  // Only three poses set it (swim, benchpress, recline), so without this a body that had
  // swum once kept a 90-degree waist FOREVER — every later pose, walking included, was
  // drawn folded over. That is the "they walk around hunched" report, and it is exactly the
  // bug class this function already existed to prevent for held items.
  a.avatar.waist.rotation.set(0, 0, 0)
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
