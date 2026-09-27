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
|  |  • POST /api/hermes/tasks/{id}    (steer or cancel a running task)      |  |
|  |  • GET  /api/hermes/meeting       (configured flag + meeting list)      |  |
|  |  • POST /api/hermes/meeting       (start a simulated meeting)           |  |
|  |  • GET  /api/hermes/meeting/actions (follow-ups from the minutes)       |  |
|  |  • GET  /api/hermes/agents        (profiles + office membership)        |  |
|  |  • POST /api/hermes/agents        (create / spawn / kill a profile)     |  |
|  |  • GET  /api/hermes/cron          (scheduled jobs + recent runs)        |  |
|  |  • POST /api/hermes/cron          (create / pause / resume / run / rm)  |  |
|  |  • GET  /api/hermes/cron/actions  (a failing job as a candidate task)   |  |
|  +------------------------------------^------------------------------------+  |
|                                       |                                       |
|  +------------------------------------v------------------------------------+  |
|  |                 Hermes CLI adapter (src/lib/hermes/kanban.ts)           |  |
|  |  spawns:  hermes kanban [--board B] <args> --json                       |  |
|  +---------------------+-------------------------------+-------------------+  |
|                        |                               |                      |
+------------------------|-------------------------------|----------------------+
                         |                               |
             +-----------v-----------+       +-----------v-----------+
             |    ApiServerDriver    |       |       MockDriver      |
             |  • HTTP to port 8642  |       |  • Offline Preview    |
             |  • OpenAI-compatible  |       |  • Unit Testing       |
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

The meeting subsystem handles multi-agent discussions safely without tripping upstream rate limits:

1. **Moderator Phase**: Assigned moderator opens the agenda and asks question 1.
2. **Round-Robin Turns**: Participants take turns responding in sequential order.
3. **Concurrency Guard**:
   - Worker calls are **strictly serialized** (one LLM request at a time).
   - Maximum budget of **10 turns** per meeting.
   - Timeout capped at 60 seconds per turn.
4. **Minutes Generator**:
   - Once all turns conclude, a separate synthesis prompt formats the discussion into:
     - `## 🎯 Decisions`
     - `## 📋 Action Items (Owner + Deadline)`
     - `## ⚠️ Identified Risks & Mitigations`
   - Stored in markdown and broadcasted via SSE to the client.

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

### 7.5. Dual View Switcher (3D Isometric ⇄ 2D Grid/Kanban)
- **Trigger**: 1-click persistent toggle in top-right HUD navbar (`[ 3D Office ]` / `[ 2D Kanban ]`).
- **2D Mode**: Completely detaches WebGL render loop to achieve 0% GPU load on mobile devices or battery saver modes.
- **Synchronization**: Shared Zustand store (`useOfficeStore`) guarantees that state, active meetings, and task movements remain 100% consistent across both views.
