/**
 * Scene controller: owns the Three.js world and drives agent avatars from
 * office state. React only pushes new state in and receives clicks out.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildOffice, type OfficeProps } from './build'
import { buildAvatar, type Avatar } from './avatar'
import { animate, type Activity, type AnimAgent } from './anim'
import { buildBoardCards } from './board'
import { blocked, route, BODY_R } from './nav'
import {
  CONFERENCE,
  CONFERENCE_CHAIRS,
  BOARD_COLUMNS as BOARD_COLS,
  DESKS,
  deskByIndex,
  DOOR,
  KANBAN_BOARD,
  GARDEN,
  BOOK_NOOK,
  PANTRY_STOOLS,
  PANTRY_STOOL_GAP,
  PANTRY,
  DART,
  LOUNGE,
  ROOMS,
  HALF_D,
  HALF_W,
  deskSeatWorld,
  visitorSpot,
  type Desk,
} from './layout'
import type { Agent, Meeting, Task } from '@/types/hermes'

export type SceneAgent = AnimAgent & {
  data: Agent
  target: THREE.Vector3 | null
  /** Remaining waypoints from A*; movement follows these, not the raw target. */
  path: { x: number; z: number }[]
  destKey: string
  face: number
  /** Facing to adopt at a seat; set when a desk target is chosen. */
  seatYaw?: number
  walking: number
  meetingTalking: boolean
  bubble: CSS2DObject
  label: CSS2DObject
  bubbleTimer: number
  /** Seconds remaining of the "entering through the door" walk. */
  spawnGate?: number
  /** Set when the agent is leaving: walk out of the door, then despawn. */
  leaving?: boolean
}

export type SceneEvents = {
  onMonitorClick?: (deskIndex: number) => void
  onAvatarClick?: (name: string) => void
  /** A card on the 3D Kanban wall was clicked. */
  onTaskClick?: (taskId: string) => void
}


/**
 * Enable shadows only on the objects that matter.
 *
 * A full-scene shadow pass roughly doubles the draw calls and this scene has 551
 * meshes. The sun is the only caster, so the filter takes solids above a size
 * threshold (walls, furniture, vehicles, roof plant) and leaves small trim —
 * frames, sills, rungs — out of the pass. Those contribute almost nothing to the
 * shadow silhouette but cost a full render each.
 */
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
  cam.left = -34
  cam.right = 34
  cam.top = 34
  cam.bottom = -34
  cam.near = 1
  cam.far = 90
  cam.updateProjectionMatrix()
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.bias = -0.0006
  light.shadow.normalBias = 0.02
}

/**
 * Vertical sky gradient. A flat background colour gives the scene no atmosphere:
 * the horizon should be pale and the zenith deeper, which is also what lets the
 * roofline and the distant blocks read against it.
 */
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

export function createScene(
  canvas: HTMLCanvasElement,
  labelHost: HTMLElement,
  events: SceneEvents = {},
) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  // Shadows on, but filtered: a 551-mesh scene cannot afford every object in the
  // shadow pass, so selectiveShadow() keeps the large solids and drops the trim.
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // Without an explicit tone mapping + exposure the standard materials render
  // flat and muddy, which is what made the office look dim and lifeless.
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.outputColorSpace = THREE.SRGBColorSpace

  // Image-based lighting. Without an environment map every metal and glass surface
  // renders flat and near-black — metalness has nothing to reflect — which is what
  // made the building look like painted cardboard. The room environment is
  // generated, so it costs no asset files.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)

  const labelRenderer = new CSS2DRenderer({ element: labelHost })
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'

  const scene = new THREE.Scene()
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.55 // fill the shadows, do not wash the scene out
  pmrem.dispose()
  // A vertical gradient reads as atmosphere; a flat colour reads as paper.
  scene.background = skyGradientTexture()
  // Depth cue: distant blocks wash toward the sky, so the street has depth.
  scene.fog = new THREE.Fog(0xd3e2ef, 70, 190)

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
      .format(new Date()),
  )
  const office: OfficeProps = buildOffice(scene, hour)
  selectiveShadow(office.group, office.sun)
  selectiveShadow(office.streetGroup, office.sun)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400)
  camera.position.set(0, 21, 24)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1.2, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI / 2.35
  controls.minDistance = 8
  // Clamp zoom-out to the building itself: letting the camera escape shows the
  // empty world box behind the set dressing.
  controls.maxDistance = 46
  controls.enablePan = true
  controls.screenSpacePanning = false

  // ---- Kanban board title. Column headers are built inside board.ts so that the
  // labels and the card grid share one flex layout and cannot drift apart.
  {
    const titleEl = document.createElement('div')
    titleEl.className = 'vp-board-title'
    titleEl.textContent = 'SPRINT · PAPAN KANBAN'
    const title = new CSS2DObject(titleEl)
    title.position.set(0, KANBAN_BOARD.h / 2 + 0.26, 0.09)
    office.boardSurface.add(title)
  }

  // ---- cards pinned to the wall board (child of the board mesh)
  const board = buildBoardCards(office.boardSurface, (taskId) => events.onTaskClick?.(taskId))

  const agents: SceneAgent[] = []
  const byName = new Map<string, SceneAgent>()

  // ---- agent lifecycle -------------------------------------------------------

  function makeAgent(data: Agent): SceneAgent {
    const av = buildAvatar(data.role)
    av.group.userData.agentName = data.name   // picked by the raycaster
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
      avatar: av,
      activity: 'idle',
      ease: 0,
      phase: Math.random() * Math.PI * 2,
      target: null,
      path: [],
      destKey: '',
      face: 0,
      walking: 0,
      meetingTalking: false,
      bubble,
      label,
      bubbleTimer: 0,
      spawnGate: 0,
      leaving: false,
    }
    agents.push(a)
    byName.set(data.name, a)
    setLabel(a)
    // Spawn just INSIDE the doorway: the threshold itself is outside the walkable
    // band, so an avatar placed on it could never path anywhere. `spawnGate` below
    // turns this into a real entrance walk — the agent steps in through the door
    // and walks to its station instead of materialising at it.
    av.group.position.set(DOOR.x, 0, DOOR.z - 0.9)
    a.spawnGate = 1.6   // seconds of "just walked in" before it heads to work
    return a
  }

  function setLabel(a: SceneAgent) {
    const el = a.label.element as HTMLDivElement
    el.textContent = a.data.displayName
    el.dataset.status = a.data.status
    el.dataset.role = a.data.role
  }

  function removeAgent(a: SceneAgent) {
    scene.remove(a.avatar.group)
    const i = agents.indexOf(a)
    if (i >= 0) agents.splice(i, 1)
    byName.delete(a.data.name)
  }

  /** Reconcile the avatar list with the latest agent roster. */
  function syncAgents(list: Agent[]) {
    // Removal is deferred: an agent that disappears from the list first walks out
    // of the door, and only despawns once it arrives. `leaving` is what turns a
    // kill into an exit rather than a vanish.
    for (const [name, a] of [...byName]) {
      if (!list.some((x) => x.name === name) && !a.leaving) {
        a.leaving = true
        a.path = []
        a.destKey = ''
      }
    }
    for (const data of list) {
      const existing = byName.get(data.name)
      if (existing && existing.leaving) {
        // It came back before finishing its exit — cancel the exit.
        existing.leaving = false
      }
      if (existing) {
        const changed =
          existing.data.status !== data.status ||
          existing.data.deskIndex !== data.deskIndex ||
          existing.data.currentTaskId !== data.currentTaskId
        existing.data = data
        if (changed) {
          existing.ease = 0
          setLabel(existing)
        }
      } else {
        makeAgent(data)
      }
    }
  }

  // ---- destination resolution ------------------------------------------------

  function deskTarget(desk: Desk) {
    // MUST match the chair drawn in build.ts, which reads the same constant.
    const seat = deskSeatWorld(desk)
    return new THREE.Vector3(seat.x, 0, seat.z)
  }

  /**
   * Seat facing so a sitter squares up to the monitor.
   *
   * Derived from geometry, not from a `+Math.PI` guess: the chair is at local
   * +z of the desk and the monitor at local -z, so the facing is simply the
   * direction from the seat to the monitor. The avatar rig's forward is local
   * +Z, which is why this is `atan2(dx, dz)` and not the atan2(x, z) form used
   * for camera-space headings.
   */
  function deskSeatYaw(desk: Desk) {
    const chair = deskSeatWorld(desk)
    // monitor world position: local (0, -0.28) rotated by the desk's facing
    const mx = desk.x + -0.28 * Math.sin(desk.facing)
    const mz = desk.z + -0.28 * Math.cos(desk.facing)
    return Math.atan2(mx - chair.x, mz - chair.z)
  }

  /** Must mirror the chair ring drawn in build.ts — a mismatch parks agents on bare floor. */
  function meetingSeat(i: number) {
    const a = CONFERENCE_CHAIRS.offset + (i % CONFERENCE_CHAIRS.count) * (Math.PI * 2 / CONFERENCE_CHAIRS.count)
    return new THREE.Vector3(
      CONFERENCE.x + Math.cos(a) * CONFERENCE_CHAIRS.ring,
      0,
      CONFERENCE.z + Math.sin(a) * CONFERENCE_CHAIRS.ring,
    )
  }

  /** Facing for a conference chair: toward the table centre, same convention as the desk seat. */
  function meetingSeatYaw(i: number) {
    const a = CONFERENCE_CHAIRS.offset + (i % CONFERENCE_CHAIRS.count) * (Math.PI * 2 / CONFERENCE_CHAIRS.count)
    const cx = CONFERENCE.x + Math.cos(a) * CONFERENCE_CHAIRS.ring
    const cz = CONFERENCE.z + Math.sin(a) * CONFERENCE_CHAIRS.ring
    return Math.atan2(CONFERENCE.x - cx, CONFERENCE.z - cz)
  }

  // Idle lounging spots. Each MUST be walkable — `nav.blocked()` validates them
  // at startup and drops any that land inside furniture, so an agent can never
  // be assigned a destination it cannot reach.
  // Each entry pairs a POSITION with the pose that belongs there, and the prop at
  // that position exists in build.ts. A pose without its prop (or a spot inside
  // furniture) reads as an agent staring at a blank wall.
  const IDLE_SPOTS = [
    { x: LOUNGE.x - 1.1, z: LOUNGE.z - 1.45, act: 'sofa' as Activity, seated: true },
    { x: DART.x - 2.6, z: DART.z + 0.4, act: 'dart' as Activity },
    // green corner: stand at the planter's face
    { x: GARDEN.x, z: GARDEN.z + 0.95, act: 'garden' as Activity },
    { x: GARDEN.x - 1.6, z: GARDEN.z + 0.95, act: 'garden' as Activity },
    // book nook: sit in the armchair, facing the shelf
    { x: BOOK_NOOK.x, z: BOOK_NOOK.z + 0.75, act: 'read' as Activity, seated: true },
    // pantry stools at the counter
    { x: PANTRY_STOOLS[0], z: PANTRY.z + PANTRY_STOOL_GAP, act: 'coffee' as Activity, seated: true },
    { x: PANTRY_STOOLS[1], z: PANTRY.z + PANTRY_STOOL_GAP, act: 'coffee' as Activity, seated: true },
    { x: 15.0, z: -3.4, act: 'idle' as Activity }, // by the water cooler
    { x: -8.6, z: 1.0, act: 'idle' as Activity }, // meeting room doorway
    { x: -4.0, z: 4.6, act: 'idle' as Activity }, // lobby, west side
    { x: 4.0, z: 4.6, act: 'idle' as Activity }, // lobby, east side
    { x: -8.4, z: 6.6, act: 'idle' as Activity }, // reception
    { x: 9.4, z: 0.6, act: 'idle' as Activity }, // lounge entry
  ].filter((p) => !blocked(p.x, p.z, BODY_R, { allowSeat: p.seated }))

  /** Decide activity + destination for the coming frames. */
  function retarget(
    a: SceneAgent,
    meeting: Meeting | null,
    seed: number,
    index: number,
    total: number,
  ) {
    // 0. entering / leaving: hold at the doorway until the walk completes. This
    //    is what makes spawn and kill read as "walks in / walks out" rather than
    //    popping into existence at a desk.
    if (a.spawnGate && a.spawnGate > 0) {
      a.target = null
      a.activity = 'idle'
      a.face = Math.PI // face into the room (door is on the south wall)
      return
    }
    if (a.leaving) {
      a.target = new THREE.Vector3(DOOR.x, 0, DOOR.z)
      a.activity = 'idle'
      return
    }

    const st = a.data.status

    // 1. meeting wins over everything — but ONLY while it is actually live. A
    //    finished OR failed meeting must release its seats, otherwise every
    //    participant stays parked at the table forever after a provider error.
    const meetingLive = meeting?.state === 'queued' || meeting?.state === 'running'
    if (meeting && meetingLive && meeting.participants.includes(a.data.name)) {
      const idx = meeting.participants.indexOf(a.data.name)
      const seat = meetingSeat(idx)
      a.target = seat
      // Face the table (the pose layer applies this on arrival).
      a.seatYaw = meetingSeatYaw(idx)
      a.activity = 'meeting'
      a.meetingTalking = meeting.currentSpeaker === a.data.name
      return
    }

    // 2. reviewer walk: a reviewing agent stands at the author's desk
    if (st === 'review') {
      const desk = a.data.deskIndex != null ? deskByIndex(a.data.deskIndex) : null
      if (desk) {
        const v = visitorSpot(desk)
        a.target = new THREE.Vector3(v.x, 0, v.z)
        a.activity = 'idle'
        a.face = Math.atan2(desk.x - v.x, desk.z - v.z)
        return
      }
    }

    // 3. working: sit at the assigned desk and type
    if ((st === 'working' || st === 'review' || st === 'blocked') && a.data.deskIndex != null) {
      const desk = deskByIndex(a.data.deskIndex)
      if (desk) {
        a.target = deskTarget(desk)
        // Record the seat's facing: the pose layer turns the avatar to this once
        // it arrives. Without it the avatar kept whatever heading it walked in
        // with, so a sitter faced sideways.
        a.seatYaw = deskSeatYaw(desk)
        a.activity = 'typing'
        return
      }
    }

    // 4. blocked without a desk: pace in the aisle
    if (st === 'blocked') {
      a.target = new THREE.Vector3(-3 + (index % 3) * 3, 0, 4.6)
      a.activity = 'idle'
      return
    }

    // 5. idle: pick a stable spot so avatars do not clump on the same furniture
    if (!IDLE_SPOTS.length) {
      a.target = new THREE.Vector3(0, 0, 8)
      a.activity = 'idle'
      return
    }
    // Claim an idle spot no other agent holds. Sharing a spot deadlocks both:
    // their bodies block each other in the corridor and neither ever arrives.
    const taken = new Set(
      agents.filter((x) => x !== a && x.target).map((x) => `${x.target!.x.toFixed(1)},${x.target!.z.toFixed(1)}`),
    )
    let spot = IDLE_SPOTS[index % IDLE_SPOTS.length]
    for (let k = 0; k < IDLE_SPOTS.length; k++) {
      const cand = IDLE_SPOTS[(index + k) % IDLE_SPOTS.length]
      if (!taken.has(`${cand.x.toFixed(1)},${cand.z.toFixed(1)}`)) {
        spot = cand
        break
      }
    }
    a.target = new THREE.Vector3(spot.x, 0, spot.z)
    a.activity = spot.act
  }

  // ---- simulation ------------------------------------------------------------

  const tmp = new THREE.Vector3()
  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  let t = 0
  let raf = 0
  let last = performance.now()
  /** Diagnostics: frame count + last dt, surfaced for the e2e hook. */
  const stats = { frames: 0, lastDt: 0, fps: 0, fpsAt: performance.now(), fpsFrames: 0 }
  /** 2 = full, 1 = no antialias/soft effects, 0 = bare minimum. */
  let quality = 2
  // Adaptive, not locked: the shadow pass at 2048 with 552 casters is heavy for a
  // phone or a software rasteriser. Rather than choosing between "no shadows
  // anywhere" and "unusable on a weak GPU", the shadow resolution steps down with
  // the quality tier and the pass is dropped only at tier 0.
  const qualityLocked = false

  function setQuality(q: number) {
    quality = Math.max(0, Math.min(2, q))
    renderer.setPixelRatio(q === 2 ? Math.min(devicePixelRatio, 2) : 1)
    // tier 2 -> 2048, tier 1 -> 1024, tier 0 -> no shadow pass at all
    renderer.shadowMap.enabled = q > 0
    office.sun.shadow.mapSize.set(q === 2 ? 2048 : 1024, q === 2 ? 2048 : 1024)
    office.sun.shadow.map?.dispose()
    office.sun.shadow.map = null
    if (q < 2) {
      const parent = renderer.domElement.parentElement
      if (parent) renderer.setSize(parent.clientWidth, parent.clientHeight, false)
    }
  }
  void setQuality
  let currentMeeting: Meeting | null = null

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    // Wall-clock delta, clamped only against tab-switch spikes. A tight clamp
    // (0.05) silently turns the whole office into slow motion on a slow GPU,
    // which is what made avatars appear to crawl.
    const dt = Math.min(0.25, (now - last) / 1000)
    last = now
    t += dt

    stats.frames++
    stats.lastDt = dt
    stats.fpsFrames++
    if (now - stats.fpsAt >= 1000) {
      stats.fps = (stats.fpsFrames * 1000) / (now - stats.fpsAt)
      stats.fpsAt = now
      stats.fpsFrames = 0
      // Step the renderer down when the machine cannot keep up (software WebGL
      // in a VM or a headless browser, or a very weak GPU). Three tiers, and it
      // never steps back up so a struggling machine does not oscillate.
      if (!qualityLocked) {
        if (stats.fps < 12 && quality > 0) setQuality(quality - 1)
        else if (stats.fps < 26 && quality > 1) setQuality(quality - 2)
      }
    }

    agents.forEach((a, i) => {
      retarget(a, currentMeeting, i, i, agents.length)

      const g = a.avatar.group
      if (a.target) {
        // Re-plan only when the destination moved: A* over the nav grid is what
        // keeps walkers out of desks, so movement follows `path`, not a straight
        // line to the target.
        const destKey = `${a.target.x.toFixed(1)},${a.target.z.toFixed(1)}`
        if (destKey !== a.destKey || !a.path.length) {
          a.destKey = destKey
          a.path = route({ x: g.position.x, z: g.position.z }, { x: a.target.x, z: a.target.z })
          if (!a.path.length) a.path = [{ x: a.target.x, z: a.target.z }]
        }

        const leg = a.path[0]
        tmp.set(leg.x - g.position.x, 0, leg.z - g.position.z)
        const dist = tmp.length()
        if (dist < 0.18) {
          a.path.shift()
          if (!a.path.length) {
            g.position.set(a.target.x, g.position.y, a.target.z)
            a.walking = 0
          }
        } else {
          tmp.normalize()
          // Slide along the surface when the next micro-step would enter a prop,
          // so a body never ends up inside furniture after a re-plan.
          const SPEED = 3.4 // m/s, brisk office walking pace
          // Clamp the step to the distance left on THIS leg. Without it a long
          // frame (dt up to 0.25 s -> 0.85 m) overshoots the waypoint, the next
          // frame reverses, and the agent oscillates on the spot forever.
          const step = Math.min(SPEED * dt, dist)
          const nx = g.position.x + tmp.x * step
          const nz = g.position.z + tmp.z * step
          // The A* path is already collision-free; this guard exists only to
          // absorb float drift, so a blocked micro-step nudges toward the
          // waypoint rather than freezing the agent in place.
          if (!blocked(nx, nz, BODY_R * 0.9)) {
            g.position.set(nx, g.position.y, nz)
          } else {
            g.position.x += tmp.x * Math.min(0.05, step)
            g.position.z += tmp.z * Math.min(0.05, step)
          }
          a.face = Math.atan2(tmp.x, tmp.z)
          a.walking = 1
        }
      } else {
        a.walking = 0
      }

      // Tick the entrance gate: while it runs the agent stands at the threshold
      // facing into the room, which is what sells "just walked in".
      if (a.spawnGate && a.spawnGate > 0) {
        a.spawnGate = Math.max(0, a.spawnGate - dt)
        a.walking = 0
      }

      // A leaving agent despawns when it reaches the doorway.
      if (a.leaving && !a.path.length) {
        const dd = Math.hypot(g.position.x - DOOR.x, g.position.z - DOOR.z)
        if (dd < 0.6) {
          removeAgent(a)
          return // forEach callback, not a loop body
        }
      }

      // smooth turn toward the facing direction
      let diff = a.face - g.rotation.y
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      g.rotation.y += diff * Math.min(1, dt * 6)
      g.position.y = 0

      // Square up to the desk once seated: the seat's yaw wins over the heading
      // the avatar walked in with.
      if (
        (a.activity === 'typing' || a.activity === 'meeting') &&
        a.walking < 0.5 &&
        a.seatYaw !== undefined
      ) {
        a.face = a.seatYaw
      }

      // walking overrides the seated pose until arrival
      const activity: Activity = a.walking > 0.5 ? 'walking' : a.activity
      const anim: AnimAgent = {
        avatar: a.avatar,
        activity,
        ease: a.ease,
        phase: a.phase,
        meetingTalking: a.meetingTalking,
      }
      animate(anim, t, dt)
      a.ease = anim.ease

      // Monitor glow reflects the occupant's state. The screen itself is NEVER
      // hidden: an invisible mesh is skipped by the raycaster, which would make
      // the "peek at screen" click target unreachable whenever nobody is typing.
      if (a.data.deskIndex != null && office.monitors[a.data.deskIndex]) {
        const mat = office.monitors[a.data.deskIndex].material as THREE.MeshStandardMaterial
        const st = a.data.status
        const target = st === 'working' ? 1.9 : st === 'review' ? 1.35 : 0.55
        mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, dt * 4)
      }

      // badge bob
      a.avatar.badge.rotation.z = t * 0.8 + a.phase
      a.avatar.badge.position.y = 1.85 + Math.sin(t * 1.6 + a.phase) * 0.03

      // speech bubble lifetime
      if (a.bubbleTimer > 0) {
        a.bubbleTimer -= dt * 1000
        if (a.bubbleTimer <= 0) a.bubble.visible = false
      }

      // keep the speaker's bubble pinned while talking
      if (a.meetingTalking && a.bubbleTimer <= 0) {
        a.bubbleTimer = 1200
        a.bubble.visible = true
      }
    })

    // Keep the card grid matched to the board's on-screen size (throttled: the
    // projection only needs re-measuring a few times a second).
    if (stats.frames % 12 === 0) {
      tmpA.set(-KANBAN_BOARD.w / 2, KANBAN_BOARD.h / 2, 0)
      tmpB.set(KANBAN_BOARD.w / 2, -KANBAN_BOARD.h / 2, 0)
      office.boardSurface.localToWorld(tmpA)
      office.boardSurface.localToWorld(tmpB)
      tmpA.project(camera)
      tmpB.project(camera)
      const w = renderer.domElement.clientWidth
      const h = renderer.domElement.clientHeight
      const pxW = Math.abs(tmpB.x - tmpA.x) * 0.5 * w
      const pxH = Math.abs(tmpB.y - tmpA.y) * 0.5 * h
      if (pxW > 0 && pxH > 0) board.setBoardSize(pxW, pxH)
    }

    office.animateStreet(dt, t)

    controls.update()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
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
      const ud = h.object.userData as { kind?: string; deskIndex?: number }
      if (ud?.kind === 'monitor' && typeof ud.deskIndex === 'number') {
        events.onMonitorClick?.(ud.deskIndex)
        return
      }
      // walking up the parents finds the avatar group of this hit mesh
      let o: THREE.Object3D | null = h.object
      while (o && !o.userData?.agentName) o = o.parent
      if (o?.userData?.agentName) {
        events.onAvatarClick?.(o.userData.agentName as string)
        return
      }
    }
  }

  const onDown = (e: MouseEvent) => {
    pending = { x: e.clientX, y: e.clientY, t: performance.now() }
  }
  let pending: { x: number; y: number; t: number } | null = null
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

  /** Push the latest board contents onto the 3D wall. */
  function setTasks(tasks: Task[]) {
    board.render(tasks)
  }

  function setMeeting(m: Meeting | null) {
    // A dead meeting must not keep holding seats: treat done/error as no meeting.
    const live = m && (m.state === 'queued' || m.state === 'running') ? m : null
    currentMeeting = live
    if (!live) {
      for (const a of agents) {
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
    office.applyPalette(h)
    // Day and night keep the gradient background. A flat colour (the previous
    // behaviour) threw away the sky's depth the moment the clock ticked over.
    scene.background = h >= 18 || h < 6 ? skyNight : skyDay
    scene.fog = new THREE.Fog(h >= 18 || h < 6 ? 0x54697d : 0xd3e2ef, 70, 190)
  }
  setHour(hour)

  function start() {
    if (!raf) {
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
  function dispose() {
    stop()
    renderer.domElement.removeEventListener('mousedown', onDown)
    renderer.domElement.removeEventListener('mouseup', onUp)
    renderer.dispose()
  }

  return {
    scene,
    camera,
    stats,
    controls,
    office,
    agents,
    byName,
    syncAgents,
    setTasks,
    setMeeting,
    say,
    setHour,
    start,
    stop,
    resize,
    dispose,
    get hour() {
      return hour
    },
  }
}

export type OfficeScene = ReturnType<typeof createScene>
