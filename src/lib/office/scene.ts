/**
 * Scene controller: owns the Three.js world and drives agent avatars from
 * office state. React only pushes new state in and receives clicks out.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { buildOffice, type OfficeProps } from './build'
import { buildAvatar, type Avatar } from './avatar'
import { animate, type Activity, type AnimAgent } from './anim'
import { buildBoardCards } from './board'
import {
  CONFERENCE,
  CONFERENCE_CHAIRS,
  BOARD_COLUMNS as BOARD_COLS,
  DESKS,
  DOOR,
  KANBAN_BOARD,
  DART,
  LOUNGE,
  ROOMS,
  HALF_D,
  HALF_W,
  visitorSpot,
  type Desk,
} from './layout'
import type { Agent, Meeting, Task } from '@/types/hermes'

export type SceneAgent = AnimAgent & {
  data: Agent
  target: THREE.Vector3 | null
  face: number
  walking: number
  meetingTalking: boolean
  bubble: CSS2DObject
  label: CSS2DObject
  bubbleTimer: number
}

export type SceneEvents = {
  onMonitorClick?: (deskIndex: number) => void
  onAvatarClick?: (name: string) => void
  /** A card on the 3D Kanban wall was clicked. */
  onTaskClick?: (taskId: string) => void
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
  // Without an explicit tone mapping + exposure the standard materials render
  // flat and muddy, which is what made the office look dim and lifeless.
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const labelRenderer = new CSS2DRenderer({ element: labelHost })
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xdce9f4)

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
      .format(new Date()),
  )
  const office: OfficeProps = buildOffice(scene, hour)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400)
  camera.position.set(0, 21, 24)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1.2, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI / 2.15
  controls.minDistance = 9
  controls.maxDistance = 60

  // ---- Kanban board legend: makes the wall display readable as a board
  const BOARD_COLUMNS = BOARD_COLS
  {
    const titleEl = document.createElement('div')
    titleEl.className = 'vp-board-title'
    titleEl.textContent = 'SPRINT · PAPAN KANBAN'
    const title = new CSS2DObject(titleEl)
    title.position.set(0, KANBAN_BOARD.h / 2 + 0.45, 0.2)
    office.boardSurface.add(title)

    BOARD_COLUMNS.forEach((name, i) => {
      const el = document.createElement('div')
      el.className = 'vp-board-col'
      el.textContent = name
      const obj = new CSS2DObject(el)
      const step = KANBAN_BOARD.w / BOARD_COLUMNS.length
      // header row, just under the title (was mistakenly pinned to the footer)
      obj.position.set(-KANBAN_BOARD.w / 2 + step * (i + 0.5), KANBAN_BOARD.h / 2 - 0.75, 0.2)
      office.boardSurface.add(obj)
    })
  }

  // ---- cards pinned to the wall board
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
      face: 0,
      walking: 0,
      meetingTalking: false,
      bubble,
      label,
      bubbleTimer: 0,
    }
    agents.push(a)
    byName.set(data.name, a)
    setLabel(a)
    // enter through the door
    av.group.position.set(DOOR.x + (Math.random() - 0.5) * 1.4, 0, DOOR.z)
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
    for (const [name, a] of [...byName]) {
      if (!list.some((x) => x.name === name)) removeAgent(a)
    }
    for (const data of list) {
      const existing = byName.get(data.name)
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
    // sit slightly behind the desk top, on the chair
    const back = desk.side === 'near' ? 0.95 : -0.95
    return new THREE.Vector3(desk.x, 0, desk.z + back)
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

  // Spread across distinct zones so idle agents never stack on one spot.
  const IDLE_SPOTS = [
    new THREE.Vector3(LOUNGE.x - 1.1, 0, LOUNGE.z - 0.15), // sofa
    new THREE.Vector3(DART.x - 2.4, 0, DART.z - 0.8), // dartboard
    new THREE.Vector3(HALF_W - 3.0, 0, HALF_D - 3.8), // water cooler
    new THREE.Vector3(ROOMS.meeting.x2 - 1.6, 0, ROOMS.meeting.z2 + 1.6), // meeting doorway
    new THREE.Vector3(ROOMS.work.x1 + 2.6, 0, ROOMS.corridor.z1 - 1.2), // print corner
    new THREE.Vector3(ROOMS.work.x2 - 2.4, 0, ROOMS.corridor.z1 - 1.2), // lockers
    new THREE.Vector3(-2.6, 0, ROOMS.corridor.z1 + 1.4), // corridor
    new THREE.Vector3(2.6, 0, ROOMS.corridor.z1 + 1.4), // corridor
  ]

  /** Decide activity + destination for the coming frames. */
  function retarget(
    a: SceneAgent,
    meeting: Meeting | null,
    seed: number,
    index: number,
    total: number,
  ) {
    const st = a.data.status

    // 1. meeting wins over everything — but ONLY while it is actually live. A
    //    finished OR failed meeting must release its seats, otherwise every
    //    participant stays parked at the table forever after a provider error.
    const meetingLive = meeting?.state === 'queued' || meeting?.state === 'running'
    if (meeting && meetingLive && meeting.participants.includes(a.data.name)) {
      const seat = meetingSeat(meeting.participants.indexOf(a.data.name))
      a.target = seat
      a.activity = 'meeting'
      a.meetingTalking = meeting.currentSpeaker === a.data.name
      return
    }

    // 2. reviewer walk: a reviewing agent stands at the author's desk
    if (st === 'review') {
      const desk = a.data.deskIndex != null ? DESKS[a.data.deskIndex] : null
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
      const desk = DESKS[a.data.deskIndex]
      if (desk) {
        a.target = deskTarget(desk)
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
    const slot = index % IDLE_SPOTS.length
    a.target = IDLE_SPOTS[slot].clone()
    if (slot === 0) a.activity = 'sofa'
    else if (slot === 1) a.activity = 'dart'
    else a.activity = 'idle'
  }

  // ---- simulation ------------------------------------------------------------

  const tmp = new THREE.Vector3()
  let t = 0
  let raf = 0
  let last = performance.now()
  let currentMeeting: Meeting | null = null

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    t += dt

    agents.forEach((a, i) => {
      retarget(a, currentMeeting, i, i, agents.length)

      const g = a.avatar.group
      if (a.target) {
        tmp.set(a.target.x - g.position.x, 0, a.target.z - g.position.z)
        const dist = tmp.length()
        const arrived = dist < 0.22
        if (!arrived) {
          tmp.normalize()
          const speed = 2.5
          g.position.addScaledVector(tmp, Math.min(speed * dt, dist))
          a.face = Math.atan2(tmp.x, tmp.z)
          a.walking = 1
        } else {
          g.position.set(a.target.x, g.position.y, a.target.z)
          a.walking = 0
        }
      } else {
        a.walking = 0
      }

      // smooth turn toward the facing direction
      let diff = a.face - g.rotation.y
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      g.rotation.y += diff * Math.min(1, dt * 6)
      g.position.y = 0

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

  function setHour(h: number) {
    office.applyPalette(h)
    // daytime looks out onto a bright sky; night is a lit office, not black
    scene.background = new THREE.Color(h >= 18 || h < 6 ? 0x76909e : 0xcfe0ee)
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
