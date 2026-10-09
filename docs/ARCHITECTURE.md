# 🏛️ Architecture & Technical Design

This document details the software architecture, design patterns, and coordinate system of **Hermes Virtual Office**.

---

## 1. High-Level System Architecture

Hermes Virtual Office operates on an **Adapter-First Architecture**, ensuring complete decoupling between the visual 3D simulation layer and the underlying autonomous agent infrastructure.

```
+-------------------------------------------------------------------------------+
|                               BROWSER CLIENT                                  |
|                                                                               |
|  +---------------------+   +---------------------+   +---------------------+  |
|  |   Three.js Engine   |   |   CSS2D Overlay     |   |   UI React Shell    |  |
|  |  • Scene & Shadows  |   |  • Speech Bubbles   |   |  • Kanban Drawer    |  |
|  |  • Avatar Rigging   |   |  • Role Badges      |   |  • Meeting Controls |  |
|  |  • Waypoint Motion  |   |  • Status Halos     |   |  • Terminal Peeker  |  |
|  +----------^----------+   +----------^----------+   +----------^----------+  |
|             |                         |                         |             |
|             +-------------------------+-------------------------+             |
|                                       | (React State / Zustand)               |
|                               +-------v-------+                               |
|                               |  OfficeStore  |                               |
|                               +-------^-------+                               |
+---------------------------------------|---------------------------------------+
                                        | SSE / HTTP REST
+---------------------------------------|---------------------------------------+
|                           NEXT.JS APP SERVER                                  |
|                                                                               |
|  +------------------------------------v------------------------------------+  |
|  |                       API Route Handlers                                |  |
|  |  • GET  /api/hermes/tasks         (board snapshot: tasks + agents)      |  |
|  |  • POST /api/hermes/tasks         (create one task, or a batch)         |  |
|  |  • GET  /api/hermes/tasks/{id}    (run history + log tail)              |  |
|  |  • POST /api/hermes/tasks/{id}    (steer/cancel/run/promote/set-model)  |  |
|  |  • GET  /api/hermes/meeting       (configured flag + meeting list)      |  |
|  |  • POST /api/hermes/meeting       (start a meeting: simulasi OR a2a)    |  |
|  |  • POST /api/hermes/meeting/cancel (stop a live meeting → DIBATALKAN)   |  |
|  |  • GET  /api/hermes/meeting/actions (follow-ups from the minutes)       |  |
|  |  • GET  /api/hermes/agents        (profiles + membership + A2A state)   |  |
|  |  • POST /api/hermes/agents        (spawn/hide/kill/create/set-model +   |  |
|  |                                    serve/unserve A2A entries)            |  |
|  |  • GET  /api/hermes/doctor        (Siap pakai? pass/fail/unknown)       |  |
|  |  • GET+POST /api/hermes/selfrepair (preview, then run + doctor-after)   |  |
|  |  • GET  /api/hermes/a2a/live      (live agent→agent pairs, for scene)   |  |
|  |  • GET  /api/hermes/a2a/transcript (A2A conversation transcripts)       |  |
|  |  • GET  /api/hermes/cron          (scheduled jobs + recent runs)        |  |
|  |  • POST /api/hermes/cron          (create / pause / resume / run / rm)  |  |
|  |  • GET  /api/hermes/cron/actions  (a failing job as a candidate task)   |  |
|  |  • GET  /api/hermes/chat          (thread list, or one thread's history) |  |
|  |  • POST /api/hermes/chat          (send a message, get the reply)       |  |
|  |  • DELETE /api/hermes/chat        (forget a thread pointer)             |  |
|  +------------------------------------^------------------------------------+  |
|                                       |                                       |
|  +------------------------------------v------------------------------------+  |
|  |              Hermes CLI bridges (src/lib/hermes/*.ts)                  |  |
|  |  board/tasks/agents/chat: hermes kanban/chat/profile ... --json        |  |
|  |  cron JOBS: $HERMES_HOME/cron/jobs.json (no --json mode); RUNS:        |  |
|  |  `hermes cron runs`. A2A served entries: surgical read/write of        |  |
|  |  platforms.a2a.agents in ~/.hermes/config.yaml (backup first,          |  |
|  |  local:false).                                                         |  |
|  +---------------------+-------------------------------+-------------------+  |
|                        |                               |                      |
+------------------------|-------------------------------|----------------------+
                         |                               |
             +-----------v-----------+       +-----------v-----------+
             |   Hermes A2A server   |       |  Upstream LLM gateway |
             |  • 127.0.0.1:9900    |       |  • OpenAI-compatible  |
             |  • one path /<slug>   |       |  • meetings (simulasi|
             |    per served agent   |       |    mode) only         |
             +-----------------------+       +-----------------------+
```

---

## 2. 3D Office Coordinate System & Zones

The 3D space uses a standard Cartesian coordinate system where:
- **`+X`** = East (Right)
- **`+Z`** = South (Towards Camera in default isometric view)
- **`+Y`** = Up (Height above floor)
- Floor dimensions: `Width = 32 units (-16 to +16)`, `Depth = 24 units (-12 to +12)`.

```
                  North (-Z)
             +--------------------+
             |   Kanban Display   |
             |     [Z = -11.0]    |
             +--------------------+
               |                |
  West (-X)    |                |    East (+X)
+------------+ |  Workstations  | +------------+
| Conference | |  (8 Desks in   | |   Lounge   |
| Room Area  | |   4 Columns)   | | Area (TV,  |
| (Table @   | |                | | Sofa, Dart)|
| X = -8.5,  | | X: -4 to +4    | | (X = +9.0, |
| Z = 2.0)   | | Z: -5 to +3    | |  Z = 2.0)  |
+------------+ +----------------+ +------------+
               |                |
             +--------------------+
             |     Entrance /     |
             |    Spawn Point     |
             |     [Z = +10.0]    |
             +--------------------+
                  South (+Z)
             [Isometric Camera View]
```

### Zone Coordinates Table

| Zone Name | Center `(X, Y, Z)` | Dimensions `(W, H, D)` | Purpose |
|---|---|---|---|
| **Kanban Display** | `(0, 3.5, -11.5)` | `14 x 5 x 0.2` | Holographic wall display showing sprint progress |
| **Desk Col 1 (W1, W2)** | `(-4.5, 0, -2.5)` | `3.2 x 1.5 x 4.0` | 2 Facing desks for Orchestrator / Backend |
| **Desk Col 2 (W3, W4)** | `(-1.5, 0, -2.5)` | `3.2 x 1.5 x 4.0` | 2 Facing desks for Frontend / Fullstack |
| **Desk Col 3 (W5, W6)** | `(+1.5, 0, -2.5)` | `3.2 x 1.5 x 4.0` | 2 Facing desks for QA / Reviewer |
| **Desk Col 4 (W7, W8)** | `(+4.5, 0, -2.5)` | `3.2 x 1.5 x 4.0` | 2 Facing desks for Research / DevOps |
| **Conference Table** | `(-8.5, 0, 2.0)` | Radius `2.2` | Round table with 4-6 meeting chairs |
| **Lounge Sofa** | `(+9.0, 0, 1.5)` | `4.0 x 1.2 x 1.8` | Blue sofa facing TV monitor |
| **Dartboard & Bar** | `(+10.5, 2.0, -8.0)` | `1.5 x 1.5 x 0.1` | Wall-mounted recreation area |
| **Spawn / Door** | `(0, 0, 10.5)` | `2.5 x 3.0 x 0.2` | Entrance door for avatar transitions |

---

## 3. Avatar Finite State Machine (FSM)

Each AI Agent avatar transitions deterministically between states based on incoming telemetry:

```
                  +-----------------+
                  |      SPAWN      |
                  +--------+--------+
                           |
                           v
             +----------->IDLE<-----------+
             |             |              |
             | (no tasks)  | (task assigned)
             |             v              |
             |          WORKING           |
             |          (Typing)          |
             |             |              |
             |             | (needs review)
             |             v              |
             |         REVIEWING          |
             |      (Walk to QA Desk)     |
             |             |              |
             |             | (approved)   |
             |             v              |
             |           DONE             |
             |     (Walk to Board)        |
             |             |              |
             +-------------+--------------+
                           ^
                           | (meeting called)
                           v
                        MEETING
                   (Round Table Talk)
```

### State Behaviors

1. **`IDLE`**:
   - Randomly chooses resting spots: Sofa seating, pacing to water cooler, or standing near dartboard.
   - Legs slightly swinging when sitting on sofa; head occasionally looks around.
2. **`WORKING`**:
   - Moves along waypoints to assigned workstation.
   - Sits in chair facing desk.
   - Upper body posture: Arms bent at 90°, typing animation active (`wave(time, frequency)` on wrists/elbows).
   - Workstation monitor glow enabled with code matrix shader.
3. **`REVIEWING`**:
   - Reviewer agent walks across the hallway to the author agent's desk.
   - Stands adjacent to author's chair, inspecting diffs with questioning hand gesture.
4. **`BLOCKED`**:
   - Avatar stands up from desk, exhibits pacing animation.
   - Floating red exclamation mark `(!)` rendered via CSS2D.
5. **`MEETING`**:
   - Navigates to assigned conference chair around `(-8.5, 0, 2.0)`.
   - On agent's speaking turn: Raises right hand, leans forward, head tilts upward.
   - Floating speech bubble displays speech text.
   - Non-speaking avatars rotate their heads toward the speaking avatar's position.
6. **`DONE`**:
   - Walks to northern Kanban board `(0, 0, -9.5)`.
   - Small cheer gesture (both hands raised briefly).
   - Returns to workstation or lounge.

---

## 4. Pathfinding & Navigation

To avoid complex polygon meshes, navigation uses a **2D Waypoint Graph**:

```
[Conference Zone] <---> [West Corridor] <---> [Main Hallway] <---> [East Corridor] <---> [Lounge Zone]
                                                   |
                                                   v
                                            [Workstation Rows]
                                                   |
                                                   v
                                             [South Door]
```

- When an agent transitions between locations, the system computes the shortest path along pre-defined waypoints.
- Avatars rotate smoothly toward their next waypoint (`approach(currentAngle, targetAngle, dt, speed)`).
- Walking animation (leg swing + hip bob) automatically engages whenever horizontal velocity `> 0.05 units/s`.

---

## 5. Meeting Orchestration Protocol

Two modes, one runner each (`src/lib/hermes/meeting.ts`). Both serialize turns;
both archive minutes to `data/meetings/`. For the wire details see
[`IMPLEMENTATION-NOTES.md`](IMPLEMENTATION-NOTES.md) §1–§2.

**Mode `simulasi`** (the old behaviour, labelled as such in the UI): the upstream
LLM speaks, not the agents. Moderator opens (`phase: 'opening'`), then up to 2
rounds of speeches (`phase: 'round1'..'round2'`), then minutes
(`phase: 'minutes'`). Concurrency guard: strictly serialized, max
`MAX_MEETING_TURNS` (default 10) turns, `MEETING_TURN_TIMEOUT_MS` (default
120 s) per turn with `MEETING_TURN_RETRIES` (default 3) linear-backoff retries
(`complete()` in `meeting.ts`). Minutes are a separate synthesis step
(`MINUTES_SYSTEM`) with three fixed sections — `## KEPUTUSAN`,
`## TINDAK LANJUT`, `## RISIKO` — and no agreement is invented when there is
none (`Belum ada kesepakatan final` + competing options). Needs
`AI_BASE_URL` + `AI_API_KEY`; without them the start is refused honestly.

**Mode `a2a`**: real agents take turns over the A2A protocol — no `AI_*` needed.
`runA2a()` (opening → cross-calls → minutes): one `message/send` per turn to
`A2A_BASE_URL/<slug>` (`sendA2a()` in `meeting-a2a.ts`). Cross-turns instruct
each agent to call the next via its own `a2a_call` tool with the **full peer
URL** (resolvable without depending on the caller's peer table) and to quote
the reply verbatim; failures are recorded `GAGAL + cause`, never
LLM-fabricated. Participants must all be served or the meeting is refused
before starting, naming who (`missingServed()` / `formatReject()`).

Either mode can be cancelled mid-flight: `POST /api/hermes/meeting/cancel`
stops at the safe boundary (the running turn finishes, the next never starts),
the archive is marked `- status: DIBATALKAN` with the stop-turn count, and
cancelling with nothing live answers `404 no_running_meeting`.

---

## 6. Synchronisation: polling, not SSE

There is **no** event stream. The client polls `GET /api/hermes/tasks` every
`NEXT_PUBLIC_POLL_MS` (default 4000 ms) and replaces the store snapshot.

Polling is a deliberate choice rather than a shortcut: the server's only channel to
Hermes is the CLI, which has no subscription mode. An SSE endpoint would have to be
fed by a poller anyway, and would then be a second source of truth to keep in step
with the first — strictly more moving parts for the same data.

The cost is bounded: one request per interval per open tab, against a local CLI.

---

## 7. Advanced Interactive Feature Specifications

### 7.1. Intip Layar Monitor (Live Screen Peeking)
- **Trigger**: Click directly on an active PC monitor on any desk, or click "Peek Screen" in the agent's popup card.
- **Component**: `<PeekPanel />`
- **Mechanism**: `GET /api/hermes/tasks/{id}` returns the run history and a bounded log tail (the CLI's `--tail`, so a chatty task cannot stream without limit).

### 7.2. Intervensi Cepat ("Tegur Meja" / Quick Steer)
- **Trigger**: Hover over or click an agent at their workstation to open the Desk Action Drawer.
- **Actions**:
  - `Steer`: appends a comment the worker picks up mid-flight (`POST /api/hermes/tasks/{id}`, `action: "steer"`).
  - `Cancel`: releases the worker's claim so a stuck loop stops (`action: "cancel"`). A task that is not running answers `409 not_running` — correct behaviour reported honestly, not an error.

### 7.3. Pair Programming & Reviewer Walk
- **Trigger**: Task lifecycle moves to `status: "review"`.
- **Mechanics**:
  - The designated reviewer avatar transitions from their desk or lounge to the author agent's desk.
  - The reviewer occupies a designated visitor standing spot at `(author.desk.x + 0.9, 0, author.desk.z + 0.3)`.
  - Both avatars face the monitor. Author types; reviewer occasionally nods or gestures.
  - Once reviewed and completed (`status: "done"`), the reviewer plays a celebratory gesture and walks back.

### 7.4. Pencahayaan Adaptif (Day/Night WIB Server Sync)
- **Synchronizer**: Client fetches server time on mount and syncs with Asia/Jakarta (WIB, UTC+7).
- **Daytime Mode (06:00 - 18:00 WIB)**:
  - Bright directional sunlight (`color: 0xfff8ee`, `intensity: 1.2`) coming through window louvers.
  - Subtle sky ambient light (`0xd0e8ff`, `intensity: 0.6`).
- **Nighttime Mode (18:00 - 06:00 WIB)**:
  - Darkened ambient exterior (`0x0b1018`, `intensity: 0.2`).
  - Warm desk lamps activated (`color: 0xffb347`, `intensity: 1.8`, localized point lights).
  - PC monitors cast vibrant cyan/green glow onto the avatars' faces and keyboards.

## 8. Doctor & self-repair: honest state, then self-healing

The **Siap pakai?** panel (`GET /api/hermes/doctor`, `src/lib/hermes/doctor.ts`,
rendered by `src/components/DoctorPanel.tsx`) checks every layer the office
depends on — CLI, board, profiles, per-profile models, dangling
`custom:<name>` providers, simulasi LLM keys, A2A platform, served entries
(stale marked BASI, `local:true` flagged), gateway restart state, write-origin
trust, per-served caller toolsets, global + profile-scope peers, and the
unknown-path fallthrough probe — each as `pass` / `fail` / `unknown` with a
copy-paste fix. What cannot be established says so; "needs restart" is a
check row, not a toast.

**Self-repair** (`GET`+`POST /api/hermes/selfrepair`,
`src/lib/hermes/selfrepair.ts`) closes the loop: preview what would change
plus what cannot be fixed automatically and why, run it through the same
writers the interactive paths use (config backed up first), then return a
fresh doctor report showing the new state. Idempotent — a healthy office
changes nothing. The seven sweep kinds (`staleServed`, `deadAvatar`,
`dupAvatar`, `strayProfileDir`, `danglingProvider`, `missingA2aToolset`,
`missingA2aPeer`) and the two key-absent-vs-unreadable distinctions are
documented in [`IMPLEMENTATION-NOTES.md`](IMPLEMENTATION-NOTES.md) §4–§5.

### 8.1. Dual View Switcher (3D Isometric ⇄ 2D Grid/Kanban)
- **Trigger**: 1-click persistent toggle in top-right HUD navbar (`[ 3D Office ]` / `[ 2D Kanban ]`).
- **2D Mode**: Completely detaches WebGL render loop to achieve 0% GPU load on mobile devices or battery saver modes.
- **Synchronization**: Shared Zustand store (`useOfficeStore`) guarantees that state, active meetings, and task movements remain 100% consistent across both views.
