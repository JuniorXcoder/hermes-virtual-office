/**
 * THE FACING AUDIT — does the BODY look at the thing its pose is about?
 *
 * WHY THIS FILE EXISTS, and why the previous version of it was worthless.
 *
 * Every facing test in this project before now compared a spot's `face` with the same helper
 * that PRODUCED that face. `diningChairFacing` on both sides, `spot.face` on both sides. Those
 * tests could not disagree with the code by construction, and they passed 100% while 30
 * orientations were wrong — which is how "banyak yang ngebelakangin kursi/sofa dan ada juga yg
 * ga menghadap objectnya" reached the user.
 *
 * Then I "fixed" it by writing a look-at convention into BOTH the code and a new test, which
 * is the same mistake one layer deeper: they agreed with each other and both disagreed with
 * the renderer, and I flipped 31 correct orientations 180 degrees before catching it.
 *
 * The lesson, and the rule this file follows: measure against something the code under test
 * does not control.
 *
 *   - The CONVENTION is pinned by two physical measurements of the rig, not by a comment:
 *       (a) the `sit` pose puts the feet at local +z of the hips — a seated body's feet point
 *           the way it faces, so front is +z;
 *       (b) `scene.ts` faces a walking body by `rotation.y = atan2(dirX, dirZ)`, so a body
 *           looks along `(sin f, cos f)`.
 *   - The FURNITURE is pinned by reading the built mesh: a chair carries its back rest at
 *     local +z, so a chair mesh looks along -z. Mesh rotation and body facing are therefore
 *     DIFFERENT QUANTITIES that differ by PI, and conflating them is the original bug.
 *
 * The assertions below use the measured convention to aim each body at its object's world
 * position, and use the built rig to check that a seated body's FEET agree with the direction
 * it claims to be looking. Neither can be satisfied by editing a `face` literal.
 */
import * as THREE from 'three'
import { buildAvatar } from './avatar'
import { animate } from './anim'
import type { Activity } from './anim'
import {
  IDLE_SPOTS,
  POOL,
  POOL_BENCHES,
  SUNBEDS,
  DINING_SETS,
  diningChairs,
  MEETING_ROOMS,
  MEETING_TABLES,
  MEETING_ROOM_IDS,
  LOUNGE,
  LOUNGE_TV,
  BBQ,
  PLANTING,
  PANTRY,
  ROOM_PROPS,
  PANTRY_COUNTER,
  GYM,
  DESKS,
  deskSeatWorld,
  faceToward,
  PANTRY_STOOL_GAP,
} from './layout'

const SHIN = 0.52
const MATTRESS_Y = 0.49
const BED_HEAD_LOCAL_Z = -0.72

const wp = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false)
  const e = o.matrixWorld.elements
  return new THREE.Vector3(e[12], e[13], e[14])
}
const wpDown = (o: THREE.Object3D, dy: number) => {
  o.updateWorldMatrix(true, false)
  return new THREE.Vector3(0, dy, 0).applyMatrix4(o.matrixWorld)
}

/** THE MEASURED CONVENTION: the world direction a body looks, from its rotation.y. */
export const bodyLook = (face: number) => ({ x: Math.sin(face), z: Math.cos(face) })

/** Pose a body at a spot and return it, for measuring. */
function posed(spot: { x: number; z: number; face: number }, act: Activity, frames = 12) {
  const av = buildAvatar('backend')
  av.group.position.set(spot.x, 0, spot.z)
  av.group.rotation.y = spot.face
  const a = { avatar: av, activity: act, ease: 1, phase: 0.3, meetingTalking: false }
  for (let i = 0; i < frames; i++) animate(a, i * 0.1, 1 / 60)
  av.group.updateMatrixWorld(true)
  return av
}

/** Where the FEET point, in world space, for a seated pose. Independent of `face`. */
function feetDir(av: ReturnType<typeof buildAvatar>) {
  const hip = wp(av.hips)
  const fL = wpDown(av.legs[0].elbow, -SHIN)
  const fR = wpDown(av.legs[1].elbow, -SHIN)
  const dx = (fL.x + fR.x) / 2 - hip.x
  const dz = (fL.z + fR.z) / 2 - hip.z
  const len = Math.hypot(dx, dz)
  return len < 0.05 ? null : { x: dx / len, z: dz / len }
}

export type FacingProblem = string

/** Every orientation problem in the scene, as human-readable strings. */
export function facingProblems(): FacingProblem[] {
  const out: FacingProblem[] = []

  /** Does the body at this spot look at (tx,tz)? Returns the dot product. */
  const dotTo = (spot: { x: number; z: number; face: number }, tx: number, tz: number) => {
    const look = bodyLook(spot.face)
    const dx = tx - spot.x
    const dz = tz - spot.z
    const len = Math.hypot(dx, dz)
    if (len < 0.05) return 1 // the body is ON the target: no direction exists
    return (look.x * dx + look.z * dz) / len
  }

  // ---- 0. THE CONVENTION ITSELF, pinned by the rig.
  //
  // If this fails, nothing else in this function means anything: a seated body's feet must
  // point the way its `face` says it looks.
  {
    const av = posed({ x: 0, z: 0, face: 0 }, 'eat')
    const feet = feetDir(av)
    if (!feet || feet.z < 0.9) {
      out.push(
        `the CONVENTION is wrong: a body with face=0 has its feet pointing ` +
          `(${feet ? feet.x.toFixed(2) : '?'}, ${feet ? feet.z.toFixed(2) : '?'}), so front is not +z`,
      )
    }
  }

  // ---- 1. poolside benches look at the WATER
  for (const [i, b] of POOL_BENCHES.entries()) {
    const spot = IDLE_SPOTS.find((s) => Math.hypot(s.x - b.x, s.z - b.z) < 0.05 && s.act === 'pool')
    if (!spot) {
      out.push(`pool bench ${i} has no idle spot`)
      continue
    }
    const d = dotTo(spot, POOL.x, POOL.z)
    if (d < 0.9) out.push(`pool bench ${i} does not look at the water (dot ${d.toFixed(2)})`)
  }

  // ---- 2. daybeds: LYING with the head on the raised rest, parallel to the mattress.
  //
  // This is the one spot where the body's rotation must equal the MESH's rotation, because
  // the recline pose has no look direction — a supine body's chest faces the sky. What
  // matters is that the head lands at the rest and the body lies ALONG the bed.
  for (const [i, b] of SUNBEDS.entries()) {
    const spot = IDLE_SPOTS.find((s) => Math.hypot(s.x - b.x, s.z - b.z) < 0.05 && s.act === 'recline')
    if (!spot) {
      out.push(`daybed ${i} has no idle spot`)
      continue
    }
    const av = posed(spot, 'recline', 24)
    const hip = wp(av.hips)
    const head = wp(av.head)
    const up = { x: head.x - hip.x, y: head.y - hip.y, z: head.z - hip.z }
    const horiz = Math.hypot(up.x, up.z)
    const tilt = (Math.atan2(horiz, up.y) * 180) / Math.PI
    // THE BED's OWN AXIS, from the mesh data — NOT from `spot.face`.
    //
    // Using `spot.face` here made the check circular: rotate the body and the "bed" rotates
    // with it, so a body lying across its mattress still measured as perfectly aligned. The
    // sabotage test caught that (mutating the daybed's face was BLIND). `b.facing` is the
    // mesh's fixed rotation and does not move when the spot's facing is changed.
    const axis = bodyLook(b.facing)
    const along = (up.x * axis.x + up.z * axis.z) / (horiz || 1)
    const rest = {
      x: b.x + Math.sin(b.facing) * BED_HEAD_LOCAL_Z,
      z: b.z + Math.cos(b.facing) * BED_HEAD_LOCAL_Z,
    }
    const headDist = Math.hypot(head.x - rest.x, head.z - rest.z)
    if (tilt < 65) out.push(`daybed ${i}: the body is not lying down (${tilt.toFixed(0)} deg from upright)`)
    if (Math.abs(along) < 0.8) out.push(`daybed ${i}: the body lies across the mattress, not along it`)
    if (Math.abs(hip.y - MATTRESS_Y) > 0.14) {
      out.push(`daybed ${i}: the hip is not on the mattress (${hip.y.toFixed(2)} vs ${MATTRESS_Y})`)
    }
    if (headDist > 0.85) out.push(`daybed ${i}: the head misses the raised rest by ${headDist.toFixed(2)} m`)
  }

  // ---- 3. every dining chair looks at ITS OWN table, and the feet agree
  for (const [si, set] of DINING_SETS.entries()) {
    const chairs = IDLE_SPOTS.filter((s) => s.act === 'eat' && Math.hypot(s.x - set.x, s.z - set.z) < 2.2)
    if (chairs.length !== 4) out.push(`dining set ${si} has ${chairs.length} eat spots, not 4`)
    for (const [ci, s] of chairs.entries()) {
      const d = dotTo(s, set.x, set.z)
      if (d < 0.9) out.push(`dining set ${si} chair ${ci} does not look at its table (dot ${d.toFixed(2)})`)
      // the feet must agree with the claim
      const feet = feetDir(posed(s, 'eat'))
      if (feet) {
        const dx = set.x - s.x
        const dz = set.z - s.z
        const len = Math.hypot(dx, dz)
        const fd = (feet.x * dx + feet.z * dz) / len
        if (fd < 0.9) {
          out.push(`dining set ${si} chair ${ci}: the FEET point away from the table (dot ${fd.toFixed(2)})`)
        }
      }
    }
  }

  // ---- 4. meeting chairs look at their room's table
  for (const id of MEETING_ROOM_IDS) {
    const t = MEETING_TABLES[id]
    const room = MEETING_ROOMS[id]
    const c = {
      x: room.seats.reduce((a, p) => a + p.x, 0) / room.seats.length,
      z: room.seats.reduce((a, p) => a + p.z, 0) / room.seats.length,
    }
    const spots = IDLE_SPOTS.filter((s) => s.act === 'meeting' && Math.hypot(s.x - c.x, s.z - c.z) < 3.4)
    for (const s of spots) {
      const d = dotTo(s, t.x, t.z)
      if (d < 0.85) out.push(`a ${id} meeting chair does not look at its table (dot ${d.toFixed(2)})`)
    }
  }

  // ---- 5. the LOUNGE sofa looks at the TV; the TERRACE sofas look at the pool
  //
  // Scoped by position, not just by activity. `act: 'sofa'` is now used in two places — the
  // leisure room (which must face the TV on its north wall) and the covered terrace under
  // the executive slab (which must face SOUTH over the courtyard, because the point of
  // sitting there is the view). Testing every 'sofa' spot against the TV failed the terrace
  // pair by construction, which is what this scoping fixes.
  for (const s of IDLE_SPOTS.filter((x) => x.act === 'sofa' && x.x > LOUNGE.x - 4 && x.z < -15)) {
    const d = dotTo(s, LOUNGE_TV.x, LOUNGE_TV.z)
    if (d < 0.9) out.push(`the lounge sofa does not look at the TV (dot ${d.toFixed(2)})`)
  }
  // ...and the TERRACE pair. Scoped to the covered strip (z > -13 AND z < -9 AND |x| < 14),
  // because `act: 'sofa'` is also used by the marketing nook's two chairs, which face their
  // own low table deep in the west bar (x ~ -25) — they are nowhere near the courtyard and
  // must not be asked to look at the pool.
  for (const s of IDLE_SPOTS.filter((x) => x.act === 'sofa' && x.z > -13 && x.z < -9 && Math.abs(x.x) < 14)) {
    const d = dotTo(s, POOL.x, POOL.z)
    if (d < 0.6) out.push(`a terrace sofa does not look at the pool (dot ${d.toFixed(2)})`)
  }
  // the nook chairs look at their own table
  for (const n of ROOM_PROPS.filter((p) => p.kind === 'nook')) {
    for (const s of IDLE_SPOTS.filter((x) => x.act === 'sofa' && Math.hypot(x.x - n.x, x.z - n.z) < 1.6)) {
      const d = dotTo(s, n.x, n.z)
      if (d < 0.85) out.push(`a nook chair does not look at its table (dot ${d.toFixed(2)})`)
    }
  }

  // ---- 6. the PANTRY stools look at the counter — at its NEAREST point, since it is long.
  //
  // Scoped to the pantry by position: the terrace work bar's stools also use `act: 'coffee'`
  // (the pose is "sitting at a counter with a drink"), but they face the bar under the slab,
  // NOT the pantry counter 40 m away.
  const pantryStools = IDLE_SPOTS.filter((x) => x.act === 'coffee' && x.x > 24)
  for (const [i, s] of pantryStools.entries()) {
    const nearZ = Math.max(PANTRY_COUNTER.z1, Math.min(PANTRY_COUNTER.z2, s.z))
    const d = dotTo(s, PANTRY.x, nearZ)
    if (d < 0.9) out.push(`pantry stool ${i} does not look at the counter (dot ${d.toFixed(2)})`)
  }

  // ---- 7. the cooks look at the grill
  for (const [i, s] of IDLE_SPOTS.filter((x) => x.act === 'bbq').entries()) {
    const d = dotTo(s, BBQ.x, BBQ.z)
    if (d < 0.9) out.push(`BBQ spot ${i} does not look at the grill (dot ${d.toFixed(2)})`)
  }

  // ---- 8. the gardener looks INTO the planting band
  for (const [i, s] of IDLE_SPOTS.filter((x) => x.act === 'garden').entries()) {
    const d = dotTo(s, s.x, (PLANTING.z1 + PLANTING.z2) / 2)
    if (d < 0.85) out.push(`garden spot ${i} does not look at the plants (dot ${d.toFixed(2)})`)
  }

  // ---- 9. gym: the standing spots look at the equipment they are using
  for (const s of IDLE_SPOTS.filter((x) => x.act === 'barbell')) {
    const d = dotTo(s, GYM.rack.x, GYM.rack.z)
    if (d < 0.9) out.push(`the barbell spot does not look at the rack (dot ${d.toFixed(2)})`)
  }
  for (const s of IDLE_SPOTS.filter((x) => x.act === 'dumbbell')) {
    const d = dotTo(s, GYM.dumbbells.x, GYM.dumbbells.z)
    if (d < 0.9) out.push(`a dumbbell spot does not look at the rack (dot ${d.toFixed(2)})`)
  }

  // ---- 10. a typing body looks at its own desk
  for (const d of DESKS) {
    const seat = deskSeatWorld(d)
    const av = buildAvatar('backend')
    av.group.position.set(seat.x, 0, seat.z)
    av.group.rotation.y = faceToward(seat.x, seat.z, d.x, d.z)
    const a = { avatar: av, activity: 'typing' as Activity, ease: 1, phase: 0.3, meetingTalking: false }
    for (let i = 0; i < 12; i++) animate(a, i * 0.1, 1 / 60)
    const look = bodyLook(av.group.rotation.y)
    const dx = d.x - seat.x
    const dz = d.z - seat.z
    const len = Math.hypot(dx, dz)
    const dot = (look.x * dx + look.z * dz) / len
    if (dot < 0.9) out.push(`desk ${d.index}: a typing body does not face its desk (dot ${dot.toFixed(2)})`)
  }

  // ---- 11. the pantry stools: the counter is EAST of them, so the look must have +x
  for (const [i, s] of pantryStools.entries()) {
    // Compare against the COUNTER, not against the stool's own expected position: an earlier
    // version of this line tested `s.x > PANTRY.x + GAP - 0.05`, which the correct stool
    // position (PANTRY.x + GAP exactly) fails by 5 cm — an assertion that rejects the very
    // layout it is meant to protect.
    if (s.x >= PANTRY.x - 0.3) {
      out.push(`pantry stool ${i} is not west of the counter (x=${s.x}, counter at ${PANTRY.x})`)
    }
    const look = bodyLook(s.face)
    if (look.x < 0.9) out.push(`pantry stool ${i} does not look east into the counter (look.x=${look.x.toFixed(2)})`)
  }

  return out
}
