/**
 * Scene controller: owns the Three.js world and drives every avatar.
 *
 * Two sources feed this scene and they are NOT the same thing:
 *
 *   - **avatars** (`data/office.db`) — where each body stands, what it was doing
 *     last, and whether it is still a DUMMY or a real agent. Dummies are free:
 *     they never call a model.
 *   - **agents** (the Hermes roster) — who is working on what. A real agent
 *     overrides its avatar's status; a dummy has none.
 *
 * Movement is LEVEL-AWARE. The building is split level, so a walker carries a
 * `level` and the stairs are the only way between floors (`routeBetween`).
 *
 * Idle avatars WANDER: they rotate through the idle spots and their position is
 * written back to the DB, so a reload puts everyone back where they were.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

import { buildOffice, type OfficeProps } from './build'
import type { Health } from './health'
import { buildAvatar } from './avatar'
import { animate, type Activity, type AnimAgent } from './anim'
import { blocked, onStairArea, planRoute, stairCentre, BODY_R, type Level, type Waypoint } from './nav'
import {
  CONFERENCE_CHAIRS,
  DOOR,
  DESKS,
  deskByIndex,
  deskSeatWorld,
  MEETING_ROOMS,
  MEETING_ROOM_IDS,
  meetingRoomFor,
  visitorSpot,
  IDLE_SPOTS as OFFICE_IDLE_SPOTS,
  LEVEL_H,
  stairHeightAt,
  insideCeoRoom,
  mayEnterCeoRoom,
  wrapAngle,
  POOL,
  type Desk,
  type IdleSpot,
  type MeetingRoomId,
} from './layout'
import type { Agent, AgentDivision, AgentRole, Meeting, Task } from '@/types/hermes'
import type { AvatarState } from './types'

export type SceneAgent = AnimAgent & {
  data: Agent
  /** Row id in `avatar_state` — what the DB writes are keyed on. */
  avatarId: string
  kind: 'dummy' | 'agent'
  /** Which floor this body is on. */
  level: Level
  /** Position the DB last reported (used to restore, not to move). */
  target: THREE.Vector3 | null
  /**
   * Which floor the TARGET is on.
   *
   * This must be stored separately from `level` (the body's current floor). The
   * route was computed with `level: a.level` for the DESTINATION too, so an idle
   * body sent to an upstairs spot walked to those coordinates on the ground floor
   * and never took the stair — all twelve level-1 idle spots were unreachable.
   */
  targetLevel: Level
  /** Remaining waypoints from A*; movement follows these, not the raw target. */
  path: Waypoint[]
  destKey: string
  face: number
  /**
   * Which way to LOOK once the destination is reached.
   *
   * Separate from `face`, which the mover overwrites every frame with the direction of
   * travel. Without this a body that walked east to a bench would keep facing east
   * instead of turning to the water — the bench's `face` was lost the moment it set off.
   */
  arrivalFace?: number
  /**
   * Set when the destination is IN the pool.
   *
   * The basin is a solid for everyone on foot, so a swimmer could never enter it. This
   * is the same kind of exemption as `seatYaw`, for the same reason: the destination is
   * inside something by construction.
   */
  targetWater?: boolean
  /**
   * Set only when the destination is a SEAT. It switches on the `settling` exemption:
   * the final metre ignores ALL furniture, because a chair is tucked under a desk or
   * covered by its table by construction.
   *
   * This is a FLAG, not a direction. It used to be assigned the spot's facing for every
   * spot, so any body walking anywhere enabled `settling` on its last metre and passed
   * through whatever stood there.
   */
  seatYaw?: number
  /**
   * The facing the destination REQUIRES, remembered across the rest period.
   *
   * `retarget()` clears `arrivalFace` at the top of every frame, and the "resting" branch
   * returns before reassigning it — so a sitting body kept the heading it walked in with and
   * never turned to face its bench, table or screen. This survives that clear.
   */
  holdFace?: number
  /** True when the remembered facing belongs to a real seat (keeps `settling` on). */
  holdSeat?: boolean
  walking: number
  meetingTalking: boolean
  bubble: CSS2DObject
  label: CSS2DObject
  bubbleTimer: number
  /** Seconds remaining of the "entering through the door" walk. */
  spawnGate?: number
  /** Set when the agent is leaving: walk out of the door, then despawn. */
  leaving?: boolean
  /** Pinned in place: never wanders, never joins a meeting (poin 2). */
  anchored: boolean
  /** Pose an anchored body holds: the activity and facing from the DB. */
  anchorActivity: Activity
  anchorFacing: number
  /**
   * Which idle spot this body is heading to / holding, as `x,z`.
   *
   * Kept SEPARATE from `target` because the resting branch clears `target` (leaving
   * it set made the loop re-arm the rest timer every frame and the body froze
   * forever). With only `target` in the claim set, a resting body released its spot
   * and another body walked onto it — two avatars in the same chair.
   */
  spotKey: string
  /** Which idle spot this body is heading to / holding. */
  wanderIndex: number
  /** Seconds to stay put before wandering again. */
  restUntil: number
}

export type SceneEvents = {
  onMonitorClick?: (deskIndex: number) => void
  onAvatarClick?: (name: string) => void
  /** A card on the 3D board was clicked (kept for compatibility). */
  onTaskClick?: (taskId: string) => void
  /** The green whiteboard was clicked — open the full Kanban modal. */
  onBoardClick?: () => void
  /** A DUMMY avatar was clicked — offer to spawn a real agent in its place. */
  onDummyClick?: (avatarId: string, division: AgentDivision) => void
  /** The office name plate was clicked — open the rename field. */
  onNameClick?: () => void
  /** Periodic position/activity flush, batched (the scene throttles this). */
  onSaveAvatars?: (list: AvatarState[]) => void
}

const SHADOW_MIN = 0.6
function selectiveShadow(root: THREE.Object3D, light: THREE.DirectionalLight) {
  const bb = new THREE.Box3()
  const size = new THREE.Vector3()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.geometry) return
    bb.setFromObject(m)
    bb.getSize(size)
    const big = Math.max(size.x, size.y, size.z) >= SHADOW_MIN
    m.castShadow = big
    m.receiveShadow = big
  })
  light.castShadow = true
  const cam = light.shadow.camera as THREE.OrthographicCamera
  // The plot is 56 x 42 m and the building is a U around a courtyard, so the
  // shadow camera must cover the WHOLE footprint.
  cam.left = -34
  cam.right = 34
  cam.top = 30
  cam.bottom = -30
  cam.near = 1
  cam.far = 110
  cam.updateProjectionMatrix()
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.bias = -0.0004
  light.shadow.normalBias = 0.02
}

function skyGradientTexture(stops = ['#9dc4e8', '#c6dcef', '#e2edf6', '#eef4f8']): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 2
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, stops[0])
  grad.addColorStop(0.45, stops[1])
  grad.addColorStop(0.75, stops[2])
  grad.addColorStop(1, stops[3])
  g.fillStyle = grad
  g.fillRect(0, 0, 2, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.mapping = THREE.EquirectangularReflectionMapping
  return t
}

function envContrastTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#dfefff')
  grad.addColorStop(0.42, '#bcd6ea')
  grad.addColorStop(0.5, '#f4e6cf')
  grad.addColorStop(0.62, '#6a6152')
  grad.addColorStop(1, '#241f1a')
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 256)
  const panels: [number, number, number, number][] = [
    [40, 30, 70, 26],
    [190, 22, 90, 30],
    [360, 36, 64, 24],
    [110, 62, 48, 18],
    [300, 70, 56, 20],
  ]
  for (const [x, y, w, h] of panels) {
    const rg = g.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, Math.max(w, h))
    rg.addColorStop(0, '#ffffff')
    rg.addColorStop(0.5, 'rgba(255,246,224,0.85)')
    rg.addColorStop(1, 'rgba(255,246,224,0)')
    g.fillStyle = rg
    g.fillRect(x - w, y - h, w * 3, h * 3)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.mapping = THREE.EquirectangularReflectionMapping
  return t
}

export function createScene(
  canvas: HTMLCanvasElement,
  labelHost: HTMLElement,
  events: SceneEvents = {},
) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromEquirectangular(envContrastTexture())
  envRT.texture.mapping = THREE.EquirectangularReflectionMapping

  const labelRenderer = new CSS2DRenderer({ element: labelHost })
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'

  const scene = new THREE.Scene()
  scene.environment = envRT.texture
  scene.environmentIntensity = 1.0
  pmrem.dispose()
  scene.background = skyGradientTexture()
  scene.fog = new THREE.Fog(0xd3e2ef, 80, 220)

  let hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
      .format(new Date()),
  )
  const office: OfficeProps = buildOffice(scene, hour)
  office.sun.shadow.radius = 4
  selectiveShadow(office.group, office.sun)
  selectiveShadow(office.streetGroup, office.sun)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400)
  // Looking down the courtyard from the south-east: the U, the pool and the open
  // division rooms all read from here.
  camera.position.set(14, 34, 40)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1.5, -2)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI / 2.35
  controls.minDistance = 6
  controls.maxDistance = 95
  controls.enablePan = true
  controls.screenSpacePanning = false

  /* ---------------------------------------------------------- avatars ------ */

  const avatars: SceneAgent[] = []
  const byName = new Map<string, SceneAgent>()
  /** Division per name, so a meeting can be routed to the right room. */
  const divisionOf = new Map<string, AgentDivision>()
  /** Latest avatar rows from the DB (positions restored on first sync). */
  let avatarRows: AvatarState[] = []
  /** Latest Hermes roster. */
  let agentRows: Agent[] = []
  let restored = false

  const DUMMY_ROLES: Record<AgentDivision, AgentRole> = {
    tech: 'backend',
    growth: 'marketing',
    content: 'content',
    exec: 'orchestrator',
  }

  /** Build the `Agent` view of a dummy so labels and poses have something to read. */
  function dummyAgent(row: AvatarState): Agent {
    return {
      name: row.name,
      displayName: row.name,
      role: DUMMY_ROLES[row.division] ?? 'backend',
      division: row.division,
      soulExists: false,
      deskIndex: null,
      status: 'idle',
    }
  }

  function makeAvatar(row: AvatarState, data: Agent): SceneAgent {
    const av = buildAvatar(data.role)
    av.group.userData.agentName = row.name
    av.group.userData.avatarId = row.avatarId
    av.group.userData.kind = row.kind
    scene.add(av.group)

    const bubbleEl = document.createElement('div')
    bubbleEl.className = 'vp-bubble'
    const bubble = new CSS2DObject(bubbleEl)
    bubble.position.set(0, 2.35, 0)
    av.group.add(bubble)
    bubble.visible = false

    const labelEl = document.createElement('div')
    labelEl.className = 'vp-label'
    const label = new CSS2DObject(labelEl)
    label.position.set(0, 2.25, 0)
    av.group.add(label)

    const a: SceneAgent = {
      data,
      avatarId: row.avatarId,
      kind: row.kind,
      level: row.level as Level,
      avatar: av,
      activity: (row.activity as Activity) || 'idle',
      ease: 0,
      phase: Math.random() * Math.PI * 2,
      target: null,
      targetLevel: 0,
      spotKey: '',
      path: [],
      destKey: '',
      // WRAPPED ON LOAD. The database accumulated values like 2809 rad (447 turns) because
      // the render loop only ever incremented this angle. Old rows still hold those numbers,
      // so folding them here means a restart heals the data instead of carrying it forward.
      face: wrapAngle(row.facing ?? 0),
      walking: 0,
      meetingTalking: false,
      bubble,
      label,
      bubbleTimer: 0,
      spawnGate: 0,
      leaving: false,
      anchored: row.anchored,
      anchorActivity: (row.activity as Activity) || 'typing',
      anchorFacing: wrapAngle(row.facing ?? 0),
      wanderIndex: Math.floor(Math.random() * OFFICE_IDLE_SPOTS.length),
      restUntil: 0,
    }
    avatars.push(a)
    byName.set(row.name, a)
    divisionOf.set(row.name, row.division)
    setLabel(a)

    // Place the body at the position the DB remembers — that is the whole point
    // of storing it. Only a body with no stored position enters through the door.
    av.group.position.set(row.x, row.level * LEVEL_H, row.z)
    av.group.rotation.y = wrapAngle(row.facing ?? 0)
    return a
  }

  function setLabel(a: SceneAgent) {
    const el = a.label.element as HTMLDivElement
    el.textContent = a.data.displayName
    el.dataset.status = a.data.status
    el.dataset.role = a.data.role
    el.dataset.kind = a.kind
  }

  function removeAvatar(a: SceneAgent) {
    // Detach the CSS2D label and bubble FIRST, explicitly: `scene.remove(group)`
    // fires 'removed' on the GROUP only, so a descendant's handler never runs and
    // its DOM element stays in the overlay forever.
    for (const c of [a.label, a.bubble]) {
      c.removeFromParent()
      const el = c.element as HTMLElement
      el.remove()
    }
    scene.remove(a.avatar.group)
    const i = avatars.indexOf(a)
    if (i >= 0) avatars.splice(i, 1)
    byName.delete(a.data.name)
  }

  /**
   * Reconcile the world with the DB rows + the Hermes roster.
   *
   * A name present in BOTH is a real agent (roster status wins). A name present
   * only in the DB is a dummy: it walks and idles but has no task and costs
   * nothing.
   *
   * AN AGENT WITH NO DB ROW STILL GETS A BODY. Rows are only ever written by the
   * scene, so a freshly spawned agent — one that has never been saved — had no row
   * and therefore no avatar: you spawned `jun` as CEO and the floor stayed empty.
   * The roster is the authority on WHO exists; the DB only remembers WHERE they
   * were. A missing row now means "walk in through the front door", which is
   * exactly what spawning should look like.
   */
  function syncAvatars(rows: AvatarState[], agents: Agent[]) {
    avatarRows = rows
    agentRows = agents
    const agentByName = new Map(agents.map((a) => [a.name, a]))

    // Every roster name needs a row. Synthesise one at the entrance for any agent
    // the DB has never seen, and feed it through the same path as the rest.
    const known = new Set(rows.map((r) => r.name))
    const missing: AvatarState[] = agents
      .filter((a) => !known.has(a.name))
      .map((a) => ({
        avatarId: `agent:${a.name}`,
        name: a.name,
        // `division` is null for a profile with no SOUL marker. Falling back to
        // 'tech' would seat the CEO with the developers, so the fallback is 'exec':
        // an unknown agent is unplaced, not a developer.
        division: a.division ?? 'exec',
        kind: 'agent' as const,
        // start at the door so the body walks in, rather than appearing at a desk
        x: DOOR.x,
        z: DOOR.z - 1.2,
        level: 0,
        activity: 'idle',
        facing: Math.PI,
        spawned: true,
        anchored: false,
        updatedAt: new Date().toISOString(),
      }))
    const all = missing.length ? [...rows, ...missing] : rows

    // Drop bodies the DB no longer lists AND the roster no longer has, UNLESS they
    // are real agents leaving.
    for (const [name, a] of [...byName]) {
      const stillThere = all.some((r) => r.name === name)
      if (!stillThere && a.kind === 'agent' && !a.leaving) {
        a.leaving = true
        a.path = []
        a.destKey = ''
      } else if (!stillThere && a.kind === 'dummy') {
        removeAvatar(a)
      }
    }

    for (const row of all) {
      const existing = byName.get(row.name)
      const data = agentByName.get(row.name) ?? dummyAgent(row)
      const kind: 'dummy' | 'agent' = agentByName.has(row.name) ? 'agent' : 'dummy'
      if (existing) {
        if (existing.leaving) existing.leaving = false
        const changed =
          existing.data.status !== data.status ||
          existing.data.deskIndex !== data.deskIndex ||
          existing.data.currentTaskId !== data.currentTaskId ||
          existing.kind !== kind
        existing.data = data
        existing.kind = kind
        existing.avatar.group.userData.kind = kind
        if (changed) {
          existing.ease = 0
          setLabel(existing)
        }
      } else {
        const fresh = makeAvatar(row, data)
        // A synthesised row means "this agent has just arrived": give it the walk
        // in through the door, the same entrance a spawned dummy gets.
        if (missing.some((m) => m.name === row.name)) {
          fresh.spawnGate = 0.6
          fresh.leaving = false
        }
      }
    }
    restored = true
  }

  // ---- destination resolution ------------------------------------------------

  function deskTarget(desk: Desk) {
    const seat = deskSeatWorld(desk)
    return new THREE.Vector3(seat.x, 0, seat.z)
  }

  function deskSeatYaw(desk: Desk) {
    const chair = deskSeatWorld(desk)
    const mx = desk.x + -0.28 * Math.sin(desk.facing)
    const mz = desk.z + -0.28 * Math.cos(desk.facing)
    return Math.atan2(mx - chair.x, mz - chair.z)
  }

  /** Meeting room currently in use, chosen from the participants' divisions. */
  let meetingRoom: MeetingRoomId = 'rinjani'

  function meetingSeat(i: number) {
    const room = MEETING_ROOMS[meetingRoom]
    const s = room.seats[i % room.seats.length]
    return new THREE.Vector3(s.x, 0, s.z)
  }

  function meetingSeatYaw(i: number) {
    const room = MEETING_ROOMS[meetingRoom]
    return room.seats[i % room.seats.length].facing
  }

  /**
   * The idle spots the world will actually use.
   *
   * The exemptions MUST match the mover's, or this filter silently discards exactly the
   * spots that need them: a bench press is inside the rack's footprint, a swim lane is
   * inside the pool basin, and a pull-up is inside the rig. The first version passed only
   * `allowSeat`, so all three were dropped here while the self-test — which checked the
   * DATA with the right flags — stayed green. Nobody swam, nobody benched, and the
   * muscle-up never appeared. The user found it by looking.
   */
  const IDLE_SPOTS: IdleSpot[] = OFFICE_IDLE_SPOTS.filter(
    (p) =>
      !blocked(p.x, p.z, BODY_R, {
        allowSeat: p.seated,
        settling: p.seated || p.bench,
        allowWater: p.water,
        level: p.level,
      }),
  )
  /**
   * The spots this filter threw away, by name.
   *
   * Kept so the self-test can assert the list is EMPTY. A dropped spot is invisible at
   * runtime — the body simply goes elsewhere — which is exactly why three of them went
   * unnoticed until somebody watched the room.
   */
  const droppedSpots = OFFICE_IDLE_SPOTS.filter((p) => !IDLE_SPOTS.includes(p)).map(
    (p) => `${p.act}@${p.x.toFixed(1)},${p.z.toFixed(1)}`,
  )
  if (droppedSpots.length && typeof console !== 'undefined') {
    console.warn(`[office] ${droppedSpots.length} idle spot(s) dropped as unreachable:`, droppedSpots.join(', '))
  }

  /** Decide activity + destination for the coming frames. */
  function retarget(a: SceneAgent, meeting: Meeting | null, index: number) {
    a.seatYaw = undefined
    a.arrivalFace = undefined
    a.targetWater = undefined

    // ANCHORED bodies never get a destination. The receptionist stays behind the
    // counter: no wander, no meeting, no stroll to the pool (poin 2). Checked
    // FIRST, so nothing below can hand this body a target.
    if (a.anchored) {
      a.target = null
      a.spotKey = ''
      // Keep the activity and facing the DB remembers — the receptionist keeps
      // typing at the counter, facing the door, forever.
      a.activity = a.anchorActivity
      a.arrivalFace = a.anchorFacing
      a.face = a.anchorFacing
      a.holdFace = a.anchorFacing
      a.holdSeat = true
      return
    }

    // 0. entering / leaving: hold at the doorway until the walk completes.
    if (a.spawnGate && a.spawnGate > 0) {
      a.target = null
      a.activity = 'idle'
      // Facing, not a seat: `seatYaw` would switch on the settling exemption.
      a.arrivalFace = Math.PI
      a.face = Math.PI
      return
    }
    if (a.leaving) {
      a.target = new THREE.Vector3(DOOR.x, 0, DOOR.z)
      a.targetLevel = 0
      a.spotKey = ''
      a.activity = 'idle'
      return
    }

    // 0b. a body that has arrived and is resting stays put (and keeps its pose).
    if (a.restUntil > t && !a.path.length) {
      a.target = null
      // ── KEEP LOOKING WHERE THE DESTINATION POINTS ─────────────────────────
      //
      // THE FACING BUG. `retarget()` runs EVERY frame and clears `arrivalFace` at the top
      // (line 545), and this branch returns before anything assigns it again. So the rule
      // further down — "arrived: turn to the destination's own facing" — could NEVER fire:
      // by the time `a.walking` dropped to 0 and `restUntil` took over, `arrivalFace` was
      // already undefined for that frame.
      //
      // A body therefore kept the heading it WALKED IN WITH for the entire rest. Walk east
      // to a poolside bench and it sat facing east; walk south to a dining chair and it sat
      // facing south, which from the table's point of view is its back to the table and its
      // face to the chair's own back rest. That is the report: "banyak yg ngebelakangin
      // kursi/sofa dan ada juga yg ga menghadap objectnya".
      //
      // No amount of fixing the angle CONVENTION could have helped, which is why two rounds
      // of that did nothing visible: the layout data was right all along and the renderer
      // simply never used it for a resting body.
      if (a.holdFace !== undefined) {
        a.arrivalFace = a.holdFace
        a.face = a.holdFace
        if (a.holdSeat) a.seatYaw = a.holdFace
      }
      return
    }

    const st = a.data.status
    const isDummy = a.kind === 'dummy'

    // 1. meeting wins over everything — but ONLY while it is actually live.
    const meetingLive = meeting?.state === 'queued' || meeting?.state === 'running'
    if (meeting && meetingLive && meeting.participants.includes(a.data.name)) {
      const idx = meeting.participants.indexOf(a.data.name)
      a.target = meetingSeat(idx)
      a.targetLevel = 1
      a.seatYaw = meetingSeatYaw(idx)
      a.arrivalFace = meetingSeatYaw(idx)
      a.holdFace = a.arrivalFace
      a.holdSeat = true
      a.activity = 'meeting'
      a.meetingTalking = meeting.currentSpeaker === a.data.name
      return
    }

    // 2. reviewer walk: a reviewing agent stands at the author's desk
    if (!isDummy && st === 'review') {
      const desk = a.data.deskIndex != null ? deskByIndex(a.data.deskIndex) : null
      if (desk) {
        const v = visitorSpot(desk)
        a.target = new THREE.Vector3(v.x, 0, v.z)
        // every desk is on the ground floor
        a.targetLevel = 0
        a.activity = 'idle'
        // The reviewer STANDS at the desk and looks at it. Facing, not a seat — this was
        // `a.seatYaw`, which made every reviewing agent ignore furniture on its approach.
        a.arrivalFace = Math.atan2(desk.x - v.x, desk.z - v.z)
        a.holdFace = a.arrivalFace
        a.holdSeat = false
        return
      }
    }

    // 3. working: sit at the assigned desk and type
    if (!isDummy && (st === 'working' || st === 'review' || st === 'blocked') && a.data.deskIndex != null) {
      const desk = deskByIndex(a.data.deskIndex)
      if (desk) {
        a.target = deskTarget(desk)
        a.targetLevel = 0
        a.seatYaw = deskSeatYaw(desk)
        a.arrivalFace = deskSeatYaw(desk)
        a.holdFace = a.arrivalFace
        a.holdSeat = true
        a.activity = 'typing'
        return
      }
    }

    // 4. idle: WANDER. Rotate to the next free spot, walk there, rest, repeat.
    //
    // ALREADY UNDER WAY? KEEP GOING. `retarget()` runs EVERY FRAME, so picking a
    // fresh spot here re-rolled the destination sixty times a second: wanderIndex
    // advanced on each call, the destination key changed, the path was recomputed,
    // and the body vibrated in place without ever arriving. That is the reported
    // "Content, MKT, dev nge glitch" — it was never a rendering problem, it was the
    // destination being re-drawn before the body could reach it.
    if (a.target && a.path.length) return

    if (!IDLE_SPOTS.length) {
      a.target = null
      a.activity = isDummy ? 'typing' : 'idle'
      return
    }
    // Claim a spot no other body holds.
    // A spot is claimed if a body is WALKING to it (`target`) or SITTING on it
    // (`spotKey`, which survives the rest period). Reserving only `target` let a
    // resting body's chair be re-taken by someone else.
    const taken = new Set<string>()
    for (const x of avatars) {
      if (x === a) continue
      if (x.target) taken.add(`${x.target.x.toFixed(1)},${x.target.z.toFixed(1)}`)
      if (x.spotKey) taken.add(x.spotKey)
    }
    let spot: IdleSpot | null = null
    for (let k = 0; k < IDLE_SPOTS.length; k++) {
      const cand = IDLE_SPOTS[(a.wanderIndex + k) % IDLE_SPOTS.length]
      if (taken.has(`${cand.x.toFixed(1)},${cand.z.toFixed(1)}`)) continue
      // ACCESS: the CEO suite is for the CEO and the managers. A body that may not go in
      // does not merely get turned back at the door — the spot is never chosen, so it
      // walks somewhere it is welcome instead of bouncing off a wall.
      if (cand.level === 1 && insideCeoRoom(cand.x, cand.z) && !mayEnterCeoRoom(a.data.role)) continue
      spot = cand
      a.wanderIndex = (a.wanderIndex + k + 1) % IDLE_SPOTS.length
      break
    }
    if (!spot) {
      a.target = null
      a.spotKey = ''
      a.activity = isDummy ? 'typing' : 'idle'
      return
    }
    a.target = new THREE.Vector3(spot.x, 0, spot.z)
    a.targetLevel = spot.level
    a.spotKey = `${spot.x.toFixed(1)},${spot.z.toFixed(1)}`
    a.activity = spot.act
    // TWO DIFFERENT THINGS, and conflating them let bodies walk through furniture.
    //
    //   `face`     which way to LOOK on arrival — every spot has one.
    //   `seatYaw`  a flag meaning "the destination is a SEAT", which switches on the
    //              `settling` exemption: the last metre ignores ALL furniture, because a
    //              chair is tucked under a desk or covered by a table by construction.
    //
    // This line used to be `a.seatYaw = spot.face`, which set the flag for EVERY spot.
    // So any body walking anywhere turned on `settling` for its final metre and passed
    // through whatever stood there — 49,586 frames inside solid furniture in a 30-minute
    // simulation, mostly the garden beds and the pantry wall.
    a.arrivalFace = spot.face
    a.seatYaw = spot.seated || spot.bench ? spot.face : undefined
    a.targetWater = spot.water
    // Remember it: `arrivalFace` is cleared every frame, so without this the turn-to-target
    // never happens for a body that has stopped (see the 0b branch).
    a.holdFace = spot.face
    a.holdSeat = !!(spot.seated || spot.bench)
  }

  // ---- simulation ------------------------------------------------------------

  const tmp = new THREE.Vector3()
  let t = 0
  let raf = 0
  let last = performance.now()
  const stats = { frames: 0, lastDt: 0, fps: 0, fpsAt: performance.now(), fpsFrames: 0 }
  let quality = 2
  /** Set by the test stepping hook: advance the simulation without drawing. */
  let skipRender = false
  const qualityLocked = false

  function setQuality(q: number) {
    quality = Math.max(0, Math.min(2, q))
    renderer.setPixelRatio(q === 2 ? Math.min(devicePixelRatio, 2) : 1)
    renderer.shadowMap.enabled = q > 0
    renderer.shadowMap.needsUpdate = true
    office.sun.shadow.mapSize.set(q === 2 ? 2048 : 1024, q === 2 ? 2048 : 1024)
    office.sun.shadow.map?.dispose()
    office.sun.shadow.map = null
    if (q < 2) {
      const parent = renderer.domElement.parentElement
      if (parent) renderer.setSize(parent.clientWidth, parent.clientHeight, false)
    }
  }
  void setQuality
  void qualityLocked
  let currentMeeting: Meeting | null = null

  /** Seconds between DB flushes. Writing every frame would be pure waste. */
  const SAVE_EVERY = 5
  let lastSave = performance.now()
  /** Snapshot of what the DB currently holds, so we only send CHANGES. */
  const lastSaved = new Map<string, string>()

  /**
   * WHAT IS ACTUALLY ON SCREEN, for a body at `g`.
   *
   * Two things must agree here and used to disagree:
   *
   *   `a.activity`   the activity of the SPOT BEING WALKED TO — retarget() sets it when
   *                  the spot is claimed. A body striding toward the barbell rack reads
   *                  'barbell' from 13 m away.
   *   water          a body inside the pool must read 'swim' whatever it is heading to.
   *
   * This formula existed twice: once in the render path (which I had fixed) and once in
   * flushPositions (which I had not). flushPositions runs FIRST, every frame, and writes
   * its answer to the database — so the render fix was invisible: the DB said 'walking'
   * for a body crossing the water, and that is what the UI and every other client drew.
   * Traced: 13 consecutive frames at x -6.0..-4.1, z 7.3..4.2 with the DB reporting
   * 'walking' while the body was in the basin.
   *
   * Kept as one function so the two cannot drift apart again.
   */
  function shownActivity(a: SceneAgent, g: THREE.Object3D): Activity {
    if (a.walking <= 0.5) return a.activity
    const inWater =
      Math.abs(g.position.x - POOL.x) < POOL.w / 2 &&
      Math.abs(g.position.z - POOL.z) < POOL.d / 2
    return inWater ? 'swim' : 'walking'
  }

  function flushPositions() {
    if (!events.onSaveAvatars) return
    const out: AvatarState[] = []
    for (const a of avatars) {
      const g = a.avatar.group
      // REPORT WHAT IS ON SCREEN, not the destination.
      //
      // `a.activity` is the activity of the spot being WALKED TO — retarget() assigns it
      // when the spot is claimed. So a body striding across the courtyard toward the
      // barbell rack was stored as `activity: 'barbell'`, at a position 13 m from the
      // rack. Reading the DB then said "two avatars are lifting in a corridor", which is
      // not what the scene showed and not what a user watching the room would see.
      const shown: Activity = shownActivity(a, g)
      const key = `${g.position.x.toFixed(1)},${g.position.z.toFixed(1)},${a.level},${shown}`
      // Skip bodies that have not moved and are not doing anything new.
      if (lastSaved.get(a.avatarId) === key) continue
      lastSaved.set(a.avatarId, key)
      out.push({
        avatarId: a.avatarId,
        name: a.data.name,
        division: divisionOf.get(a.data.name) ?? 'tech',
        kind: a.kind,
        x: Number(g.position.x.toFixed(2)),
        z: Number(g.position.z.toFixed(2)),
        level: a.level,
        activity: shown,
        facing: Number(g.rotation.y.toFixed(2)),
        spawned: a.kind === 'agent',
        anchored: a.anchored,
        updatedAt: new Date().toISOString(),
      })
    }
    if (out.length) events.onSaveAvatars(out)
  }

  function frame(now: number, forcedDt?: number) {
    raf = requestAnimationFrame(frame)
    // `forcedDt` lets a test step the simulation at a controlled rate. Deriving `dt` from
    // `performance.now()` alone makes a test useless: calling this in a tight loop yields
    // `now - last` of ~0, so every body stands still while still reporting `walking = 1`.
    const dt = forcedDt !== undefined ? forcedDt : Math.min(0.25, (now - last) / 1000)
    last = now
    t += dt

    stats.frames++
    stats.lastDt = dt
    stats.fpsFrames++
    if (now - stats.fpsAt >= 1000) {
      stats.fps = (stats.fpsFrames * 1000) / (now - stats.fpsAt)
      stats.fpsAt = now
      stats.fpsFrames = 0
      if (!qualityLocked && stats.fps < 26 && quality > 1) setQuality(1)
    }

    if (now - lastPaletteUpdate >= 60_000) {
      const nextHour = Number(
        new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
          .format(new Date()),
      )
      if (nextHour !== hour) setHour(nextHour)
      lastPaletteUpdate = now
    }

    // Flush positions to the DB on a slow cadence, batched, changes only.
    if (now - lastSave >= SAVE_EVERY * 1000) {
      lastSave = now
      flushPositions()
    }

    avatars.forEach((a, i) => {
      retarget(a, currentMeeting, i)

      const g = a.avatar.group
      if (a.target) {
        const destKey = `${a.target.x.toFixed(1)},${a.target.z.toFixed(1)}`
        if (destKey !== a.destKey || !a.path.length) {
          a.destKey = destKey
          // LEVEL-AWARE: crossing floors goes through the stair shaft, and the
          // destination's floor comes from the TARGET, not from the body.
          a.path = planRoute(
            { x: g.position.x, z: g.position.z, level: a.level, targetLevel: a.targetLevel },
            { x: a.target.x, z: a.target.z },
          )
        }

        const leg = a.path[0]
        tmp.set(leg.x - g.position.x, 0, leg.z - g.position.z)
        const dist = tmp.length()
        if (dist < 0.18) {
          a.path.shift()
          // A waypoint that changes floor is the stair hand-off. Do NOT snap the
          // height here: on the way down the body is standing on the landing at
          // corridor level and still has to DESCEND, so snapping to 0 would drop it
          // through the flight. The per-frame height below reads the ramp instead.
          if (leg.level !== a.level) {
            a.level = leg.level
          }
          if (!a.path.length) {
            g.position.set(a.target.x, a.level * LEVEL_H, a.target.z)
            a.walking = 0
            // Arrived: rest a while before wandering on. This is what keeps an
            // idle office from looking like a swarm.
            a.restUntil = t + 6 + Math.random() * 8
          }
        } else {
          tmp.normalize()
          const SPEED = 3.4
          const step = Math.min(SPEED * dt, dist)
          const nx = g.position.x + tmp.x * step
          const nz = g.position.z + tmp.z * step
          // A body walking the stair must not collide with the ramp it is standing
          // on; everyone else is stopped by it (A* never routes through the flight,
          // so only a body explicitly sent up or down is ever inside this box).
          const climbing = onStairArea(g.position.x, g.position.z)
          // SEATS ARE ENTERABLE. A body heading for a chair has to be able to step
          // ONTO it; without this the seat footprint refuses the final step, the
          // mover falls through to the 0.05 m/frame creep below, and the body
          // judders against the chair forever instead of sitting down.
          //
          // The last metre is `settling`: there, ALL furniture is ignored (walls
          // still apply). A desk chair is tucked under the desk and a meeting chair
          // is covered by its table's footprint, so the seat is INSIDE furniture by
          // construction — collision cannot be what decides whether you can reach
          // it. A* has already proved a legal route exists; this is the doorway at
          // the end of it.
          const goingToSeat = a.seatYaw !== undefined
          const settling = goingToSeat && dist < 1.3
          // A swimmer may enter the water, but only on its final approach — otherwise a
          // body merely walking past the pool would cut across the surface.
          const goingToWater = !!a.targetWater && dist < 2.2
          if (
            !blocked(nx, nz, BODY_R * 0.9, {
              level: a.level,
              onStair: climbing,
              allowSeat: goingToSeat,
              settling,
              allowWater: goingToWater,
            })
          ) {
            g.position.set(nx, g.position.y, nz)
          } else {
            // BLOCKED: creep toward the waypoint at 5 cm, UNCHECKED.
            //
            // This is deliberate, and it was measured before being touched. A "refuse to
            // enter" variant (try smaller steps, slide along one axis, else hold) removes
            // almost all furniture overlap — 2490 frames to 118 — but it COLLAPSES the
            // simulation: arrivals fall from 1358 to 106 and bodies sit still for up to
            // 1789 s, because a body wedged against a solid never gets past it. The
            // unchecked creep is what slides a walker along an obstacle until the waypoint
            // clears, which is why every body eventually arrives.
            //
            // The overlap it does cause is transient and shallow: the mover's own pad is
            // BODY_R * 0.9, so "inside" here means the body's centre is within 0.31 m of a
            // solid's face — brushing a rack, not standing in a wall. The alternative is
            // bodies that never arrive.
            g.position.x += tmp.x * Math.min(0.05, step)
            g.position.z += tmp.z * Math.min(0.05, step)
          }
          a.face = Math.atan2(tmp.x, tmp.z)
          a.walking = 1
        }

        // HEIGHT. On the stair the surface is a ramp, so the height is a pure
        // function of the position — that is what makes the climb continuous going
        // up AND coming down. Everywhere else it is simply the floor of the level
        // the body is on.
        {
          const h = onStairArea(g.position.x, g.position.z)
            ? stairHeightAt(g.position.x, g.position.z)
            : null
          g.position.y = h ?? a.level * LEVEL_H
        }
      } else {
        a.walking = 0
      }

      if (a.spawnGate && a.spawnGate > 0) {
        a.spawnGate = Math.max(0, a.spawnGate - dt)
        a.walking = 0
      }

      if (a.leaving && !a.path.length) {
        const dd = Math.hypot(g.position.x - DOOR.x, g.position.z - DOOR.z)
        if (dd < 0.6) {
          removeAvatar(a)
          return
        }
      }

      // ── WRAP THE STORED ANGLE ──────────────────────────────────────────────
      //
      // `diff` below is wrapped into [-PI, PI], but `g.rotation.y` is NOT: it accumulates
      // forever. A body that walks back and forth across the +-PI boundary picks up a
      // fraction of a turn on every crossing, and the value is persisted verbatim
      // (`facing: Number(g.rotation.y.toFixed(2))`), so the database filled up with
      // 2809 rad = 447 TURNS for a body that is visually pointing at 0.79 rad.
      //
      // Visually this is invisible — sin/cos are periodic, so the mesh renders correctly —
      // which is exactly why it survived. It is still wrong: it is an unbounded value in a
      // persisted column, it drifts without limit for as long as the page is open, and any
      // consumer that compares two facings numerically (a smoothing test, a "did it turn?"
      // check, a diff of two snapshots) reads 447 turns of rotation where there is none.
      //
      // Wrapping here fixes it at the source, so every reader — the renderer, the DB, the
      // API — sees an angle in the range the rest of the code assumes.
      const TAU = Math.PI * 2
      let diff = a.face - g.rotation.y
      while (diff > Math.PI) diff -= TAU
      while (diff < -Math.PI) diff += TAU
      g.rotation.y += diff * Math.min(1, dt * 6)
      // Keep it in (-PI, PI]. The body's own `a.face` is already wrapped by construction
      // (atan2), so this cannot introduce a visible turn: the difference is a whole number
      // of turns, which is the same orientation.
      g.rotation.y = wrapAngle(g.rotation.y)

      // ARRIVED: turn to the destination's own facing. The mover overwrote `face` with
      // the direction of travel every frame, so without this a body keeps facing the way
      // it walked — a bench that should look at the pool looks at the wall.
      if (a.walking < 0.5 && a.arrivalFace !== undefined) {
        a.face = a.arrivalFace
      }

      // IN THE WATER, SWIM.
      //
      // Decided by WHERE THE BODY IS, not by what it is heading to. The earlier version
      // gated this on `a.targetWater`, which is only set while a body is en route to a
      // swim LANE — so it did nothing for the case the user actually reported: a body
      // that steps off the coping and crosses the water. Traced frame by frame, such a
      // body showed `walking` for 12 consecutive frames in the middle of the pool
      // (x -5.8..-4.2, z 7.0..4.3) and only switched to `swim` on arrival at the lane.
      // The pose must follow the body's position: inside the basin means swimming,
      // whatever the destination is.
      //
      // The basin footprint — not the coping — is the test, matching the numbers the deck
      // cut-out and the pool footprint use. The coping is deck you walk on.
      const activity: Activity = shownActivity(a, g)
      const anim: AnimAgent = {
        avatar: a.avatar,
        activity,
        ease: a.ease,
        phase: a.phase,
        meetingTalking: a.meetingTalking,
      }
      animate(anim, t, dt)
      a.ease = anim.ease

      // Monitor glow reflects the occupant's state.
      if (a.data.deskIndex != null && office.monitors[a.data.deskIndex]) {
        const mat = office.monitors[a.data.deskIndex].material as THREE.MeshStandardMaterial
        const st = a.data.status
        const target = st === 'working' ? 1.9 : st === 'review' ? 1.35 : 0.55
        mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, dt * 4)
      }

      a.avatar.badge.rotation.z = t * 0.8 + a.phase
      a.avatar.badge.position.y = 1.85 + Math.sin(t * 1.6 + a.phase) * 0.03

      if (a.bubbleTimer > 0) {
        a.bubbleTimer -= dt * 1000
        if (a.bubbleTimer <= 0) a.bubble.visible = false
      }
      if (a.meetingTalking && a.bubbleTimer <= 0) {
        a.bubbleTimer = 1200
        a.bubble.visible = true
      }
    })

    office.animateStreet(dt, t)
    // The grill's fire and smoke: the only live flame in the building.
    office.animateBbq(t)
    // The rack's bar is hidden while somebody is benching: the bar is in their hands, and
    // leaving a second one resting in the hooks draws two bars in the same place.
    office.setRackBarVisible(!avatars.some((a) => a.activity === 'benchpress' && a.walking < 0.5))
    // The lounge TV plays the race feed while anybody is actually ON a rig. `walking < 0.5` is
    // the same "has arrived" test the bench bar above uses — an avatar striding toward the bay
    // must not switch the television on before it has sat down.
    office.setTvRacing(avatars.some((a) => a.activity === 'racing' && a.walking < 0.5))
    controls.update()
    // A test may drive the simulation without paying for WebGL: rendering every step made
    // even 30 frames too slow to measure over a debugger (software GL), which is what made a
    // time-dependent behaviour — a body turning to face its seat — unverifiable.
    if (!skipRender) {
      renderer.render(scene, camera)
      labelRenderer.render(scene, camera)
    }
  }

  // ---- pointer picking -------------------------------------------------------

  const ray = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  function pick(clientX: number, clientY: number) {
    const r = renderer.domElement.getBoundingClientRect()
    pointer.x = ((clientX - r.left) / r.width) * 2 - 1
    pointer.y = -((clientY - r.top) / r.height) * 2 + 1
    ray.setFromCamera(pointer, camera)

    const hits = ray.intersectObjects(scene.children, true)
    for (const h of hits) {
      const ud = h.object.userData as { kind?: string; deskIndex?: number; avatarId?: string }
      // The green whiteboard → open the full Kanban modal.
      if (ud?.kind === 'whiteboard' || h.object.name === 'kanban-board') {
        events.onBoardClick?.()
        return
      }
      // The office name plate → rename.
      if (h.object.name === 'office-name-face' || h.object.name === 'office-name-plate') {
        events.onNameClick?.()
        return
      }
      if (ud?.kind === 'monitor' && typeof ud.deskIndex === 'number') {
        events.onMonitorClick?.(ud.deskIndex)
        return
      }
      let o: THREE.Object3D | null = h.object
      while (o && !o.userData?.agentName) o = o.parent
      if (o?.userData?.agentName) {
        const name = o.userData.agentName as string
        const kind = o.userData.kind as 'dummy' | 'agent' | undefined
        if (kind === 'dummy') {
          // A dummy has no agent behind it: offer to spawn one.
          events.onDummyClick?.(
            (o.userData.avatarId as string) ?? '',
            divisionOf.get(name) ?? 'tech',
          )
        } else {
          events.onAvatarClick?.(name)
        }
        return
      }
    }
  }

  let pending: { x: number; y: number; t: number } | null = null
  const onDown = (e: MouseEvent) => {
    pending = { x: e.clientX, y: e.clientY, t: performance.now() }
  }
  const onUp = (e: MouseEvent) => {
    if (!pending) return
    const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y)
    const held = performance.now() - pending.t
    if (moved < 5 && held < 400) pick(e.clientX, e.clientY)
    pending = null
  }
  renderer.domElement.addEventListener('mousedown', onDown)
  renderer.domElement.addEventListener('mouseup', onUp)

  function resize(w: number, h: number) {
    renderer.setSize(w, h, false)
    labelRenderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  /** Kept for the OfficeApp contract; the 3D view no longer draws cards. */
  function setTasks(_tasks: Task[]) {
    void _tasks
  }

  function setMeeting(m: Meeting | null) {
    const live = m && (m.state === 'queued' || m.state === 'running') ? m : null
    currentMeeting = live
    if (live) {
      // Route the meeting to a room by its participants' divisions.
      meetingRoom = meetingRoomFor(live.participants, divisionOf)
    } else {
      for (const a of avatars) {
        a.meetingTalking = false
        a.bubble.visible = false
        a.bubbleTimer = 0
      }
    }
  }

  /** Show a speech bubble with plain text (never HTML — the element escapes). */
  function say(name: string, text: string, ms = 8000) {
    const a = byName.get(name)
    if (!a) return
    const el = a.bubble.element as HTMLDivElement
    el.textContent = text
    a.bubble.visible = true
    a.bubbleTimer = ms
  }

  const skyDay = skyGradientTexture()
  const skyNight = skyGradientTexture(['#20344d', '#31465f', '#4a6076', '#63798c'])
  function setHour(h: number) {
    hour = h
    office.applyPalette(h)
    scene.background = h >= 18 || h < 6 ? skyNight : skyDay
    scene.fog = new THREE.Fog(h >= 18 || h < 6 ? 0x54697d : 0xd3e2ef, 80, 220)
  }
  setHour(hour)

  let lastPaletteUpdate = performance.now()

  function start() {
    if (!raf) {
      last = performance.now()
      lastPaletteUpdate = last
      raf = requestAnimationFrame(frame)
    }
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    // Leaving the tab is a good moment to persist: the page may never come back.
    flushPositions()
  }
  function dispose() {
    stop()
    controls.dispose()
    renderer.domElement.removeEventListener('mousedown', onDown)
    renderer.domElement.removeEventListener('mouseup', onUp)
    renderer.dispose()
  }

  /** Snapshot used by the debug handle and the rename UI. */
  function avatarSnapshot() {
    return avatars.map((a) => ({
      avatarId: a.avatarId,
      name: a.data.name,
      kind: a.kind,
      division: divisionOf.get(a.data.name) ?? 'tech',
      x: a.avatar.group.position.x,
      z: a.avatar.group.position.z,
      level: a.level,
      activity: a.activity,
      // The rendered rotation and the pose actually in effect. Without these a snapshot can
      // only say WHERE a body is, never which way it ended up pointing — and "which way it
      // points" is exactly the thing that was wrong.
      rotation: a.avatar.group.rotation.y,
      shown: shownActivity(a, a.avatar.group),
      walking: a.walking,
      seated: a.seatYaw !== undefined,
      // The internals: what the body is steering toward, and where it thinks it is going.
      face: a.face,
      arrivalFace: a.arrivalFace,
      target: a.target ? { x: a.target.x, z: a.target.z } : null,
      spotKey: a.spotKey,
      hasPath: a.path.length > 0,
    }))
  }

  return {
    scene,
    camera,
    stats,
    controls,
    office,
    agents: avatars,
    byName,
    syncAvatars,
    setTasks,
    setMeeting,
    say,
    setHour,
    setQuality,
    /**
     * Nyalakan lampu kesehatan di lobby.
     *
     * Kantor harus bisa menunjukkan bahwa ada yang salah TANPA ada yang membuka panel. Provider
     * sudah balas 503 berjam-jam tanpa ketahuan, dan itu persis kegagalan yang mau dicegah:
     * pemantauan yang hanya bekerja kalau ditengok bukan pemantauan.
     */
    setHealth(level: Health['level']) {
      office.setHealth(level)
    },
    start,
    stop,
    resize,
    dispose,
    avatarSnapshot,
    /**
     * Advance the simulation by hand, for tests.
     *
     * `requestAnimationFrame` does not tick in a headless or BACKGROUND tab, so a browser
     * probe can read a snapshot but can never watch a body turn: measured `stats.frames` was
     * 35 after 20 s and `fps` 0. Without this there is no way to check a time-dependent
     * behaviour (a body rotating to face its seat arrives over several frames) outside a
     * visible window.
     *
     * Calls the same `frame()` the rAF loop calls, so a test drives the real code path.
     */
    stepForTest(dtSeconds = 1 / 60, steps = 1) {
      skipRender = true
      try {
        for (let i = 0; i < steps; i++) {
          // `t` advances inside frame() now, from this dt — not twice.
          frame(performance.now(), dtSeconds)
        }
      } finally {
        skipRender = false
      }
      return t
    },
    /** Room the live meeting is using (for the UI). */
    get meetingRoom() {
      return meetingRoom
    },
    get restored() {
      return restored
    },
    get hour() {
      return hour
    },
    /** Exposed so the self-check can assert the room signs exist. */
    stairCentre,
    meetingRoomIds: MEETING_ROOM_IDS,
    conferenceChairs: CONFERENCE_CHAIRS,
    desks: DESKS,
  }
}

export type OfficeScene = ReturnType<typeof createScene>
