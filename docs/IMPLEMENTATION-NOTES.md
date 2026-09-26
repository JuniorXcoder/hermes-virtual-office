# 🧭 Implementation Notes

Practical findings from building the office against a real Hermes install. Read
this before wiring the app to your own agent box — two of these will save you an
afternoon.

---

## 1. Kanban is NOT on the API server (8642)

The plan assumed the OpenAI-compatible API server on `:8642` would expose the
task board. It does not. The authoritative route table is
`APIServerAdapter._http_route_table()` in `gateway/platforms/api_server.py`, and
it contains only:

```
/health, /v1/models, /v1/chat/completions, /v1/responses, /v1/runs,
/api/sessions, /api/jobs, /v1/skills, /v1/toolsets, /v1/artifacts/...
```

No board, no tasks, no profiles endpoint. (Spec §2.1 of the upstream API server
documents this restriction; profile listing is likewise unavailable to external
clients.)

The Kanban HTTP surface lives in the **dashboard plugin**
(`plugins/kanban/dashboard/plugin_api.py`, mounted at `/api/plugins/kanban/` on
the dashboard port `9119`). It is a FastAPI router, and it authenticates via the
dashboard's cookie session or a route allow-list of bearer tokens — not with
`API_SERVER_KEY`. Driving it from a headless service means forging dashboard
sessions, which the app deliberately does not do.

**What this project uses instead:** the official CLI with `--json`.

```bash
hermes kanban list --json
hermes kanban assignees --json
hermes kanban runs <task_id> --json
hermes kanban create "<title>" --assignee <profile>
hermes kanban comment <task_id> "<guidance>"
hermes kanban reclaim <task_id>
hermes kanban log <task_id> --tail 16000
```

The CLI is the same surface the gateway's `/kanban` command drives
(`hermes_cli.kanban_db`), so it cannot silently drift from the board the agent
sees. Trade-off: **the app must run on the same host as Hermes.** All of this is
isolated in `src/lib/hermes/kanban.ts`; adding an HTTP driver later means one new
file implementing the same functions — no UI changes.

### The delegated-context guard

Inside an agent session (including a subagent) the CLI refuses with:

```
kanban: delegate_task child contexts cannot mutate Kanban tasks or boards
```

The guard keys off environment markers, so `kanban.ts` strips them from the child
environment before every call:

```
HERMES_DELEGATED_CHILD_CONTEXT, HERMES_SUPERVISED_CHILD,
HERMES_SESSION_ID, HERMES_SESSION_PLATFORM, ...
```

Without this, every request from the web server fails.

---

## 2. Compatible gateways answer in three different shapes

an OpenAI-compatible gateway was observed returning a **Server-Sent-Events body even when `stream` was
never requested** — a full JSON document with `data: [DONE]` glued onto its tail
with no separating newline:

```
{"object":"chat.completion", ... }data: [DONE]
```

`await res.json()` throws `Unexpected non-whitespace character after JSON`,
which turned *every* meeting turn into an instant failure. `extractContent()` in
`src/lib/meeting-engine.ts` now handles all three observed shapes:

1. a plain JSON document
2. SSE frames (`data: {...}` lines, closed by `data: [DONE]`)
3. plain JSON with a glued `data: [DONE]` tail

It also retries `429`/`5xx` with linear backoff, because such gateways answer
`503 upstream_error` in bursts under load.

---

## 3. Two rendering bugs worth remembering

Both were invisible to code review and only showed up under a real raycaster:

- **Hiding a mesh hides its click target.** Monitors were made invisible when
  nobody was typing, which silently removed the "peek at screen" hit box
  entirely. Keep the mesh, animate its `emissiveIntensity` instead.
- **A single-sided `PlaneGeometry` is invisible to `Raycaster` from behind.**
  From an isometric camera the screen plane faces away, so picks passed straight
  through. Set `side: THREE.DoubleSide`.

A third, unrelated source-overlay bug: this gateway needs
`lightningcss-linux-x64-gnu` installed explicitly. npm's optional-dependency
resolution skipped the native binary (a known npm bug), and Next's CSS pipeline
crashes on the missing `.node` file:

```bash
npm install lightningcss-linux-x64-gnu
```

---

## 4. Desk assignment is derived, never stored

Desk position is computed, not persisted: agents that are `running` or `review`
take the first stations, idle agents fill the rest in alphabetical order. That
keeps avatars still across reloads without writing layout state into the Hermes
install — the app remains a pure reader of the board.

---

## 5. Verification performed

Against a live board and a live worker:

| Check | Command | Result |
|---|---|---|
| Read board | `GET /api/hermes/tasks` | tasks + agents returned |
| Create | `POST /api/hermes/tasks/create` | `t_bae7b12c` created, then archived |
| Dispatch | `hermes kanban dispatch --max 1` | `Spawned: 1` |
| Worker ran | `GET /api/hermes/tasks` | status `done`, outcome `completed` |
| Steer | `POST /api/hermes/tasks/<id>` `action=steer` | `{"steered":true}` |
| Peek | `GET /api/hermes/tasks/<id>` | run history + raw log tail |
| Cancel guard | `action=cancel` on a finished task | `409 not_running` |
| Validation | empty title / empty steer / 1 participant | `400` |
| Meeting turns | 2 rounds, 2 agents | 2 real turns before upstream died |

The `503` failures observed at the end were the provider being down entirely —
verified independently with `curl` across 5 attempts and 3 model names — not an
application fault.


---

## 6. CSS2D cards on a 3D board

Rendering Kanban cards onto the wall board uses `CSS2DObject`, which is the
cheapest way to get crisp text in WebGL — but its anchoring has two traps that
cost real time here:

- **The element is anchored as a POINT, and its parent is sized to its content.**
  A 470px-wide grid therefore hangs off the anchor to the right. `margin-left`
  only shifts it further; the fix is `transform: translate(-50%, -50%)` on the
  grid, because percentage translate is relative to the element's own box.
- **The grid must be scaled to the mesh, not chosen for readability alone.** A
  grid that looks fine in isolation spilled past the board's bottom edge
  (`5.4` world units tall). Verify by projecting the mesh's top and bottom edges
  to screen space and asserting the grid's bounding box sits inside them — that
  is a two-line check and it caught the overflow immediately.

Cards are also capped per column (3) and the overflow is summarised with a
`+N lagi` chip, because a wall board is not a scroller.

---

## 7. Testing the meeting engine without a live provider

Upstream LLM gateways go down. When that happened here, the meeting feature
could not be exercised end to end — and "the provider is down" is not a useful
thing to leave unverified, because it hides whether the orchestration itself
works.

`scripts/mock-provider.py` is a dependency-free OpenAI-compatible stub that
**deliberately reproduces the awkward response shape** a real gateway returned
(JSON with `data: [DONE]` glued on, no newline). A stub that answered
cleanly would prove nothing about the parser.

It also counts requests, which turns "did the meeting actually talk to anyone"
into a measurable assertion:

```bash
python3 scripts/mock-provider.py 8799 &          # start the stub
AI_BASE_URL=http://127.0.0.1:8799/v1 \
AI_API_KEY=mock-key-1234567890 npm start         # point the office at it

curl -s localhost:8799/                          # {"calls": N}
# ... run a 2-participant meeting ...
curl -s localhost:8799/                          # {"calls": N+6}
```

Verified outcome: 6 turns (opening + 4 speeches + minutes), state `done`, and a
minutes file written to `data/meetings/`. Request counter moved 1 -> 7, so the
turns were genuinely driven by the provider call and not fabricated locally.

Product options (participant count, rounds, turn cap) are read from
`process.env` at module load, so overriding them for a test must happen in the
process environment, not by mutating `process.env` at runtime.

---

## 8. Layout, collision, and the two measurement traps

### A footprint table is the contract

`layout.ts` declares every solid object as an axis-aligned footprint, and
`layoutConflicts()` proves no two occupy the same ground. This is not ceremony:
running it over the first draft of the new plan found six real collisions
(meeting pods against the printer, lockers and the archive shelf) that no visual
sweep had caught. Add the footprint first, run the check, then draw the prop.

`nav.ts` turns the same table into a walkable grid (0.5 m cells, body radius
0.34 m) and runs A* with corner-cut prevention. `blocked()` inflates each
footprint by the body radius, so a walker slides along a desk instead of entering
it. Verified: 7/7 routes across the office are waypoint-clean, and 73% of the
grid is walkable.

### Trap 1 — CSS2D anchoring needs BOTH axes

Anchoring the Kanban card grid to the board mesh is not enough. The board's
projected size changes with camera distance, and a fixed CSS width is wrong at
every zoom but one: measured at a normal view the 13.6-unit board was **239 px
wide and 135 px tall** while the grid was a fixed **560 px** — 2.3x too wide, so
the columns rendered *beside* the board. The scene now projects both corners each
~12 frames and calls `setBoardSize(w, h)`. Do not hard-code either dimension.

Also: `CSS2DRenderer` anchors the element as a POINT and sizes the parent to its
content, so a negative margin only shifts the grid. `transform: translate(-50%,
-50%)` is required, and it must be set inline so CSS cascade order cannot drop it.

### Trap 2 — a clamped delta turns the office into slow motion

`dt = Math.min(0.05, elapsed)` looks like sane spike protection. On a slow
renderer it silently caps the simulation: at 0.5 fps every frame advanced the
world by only 50 ms, so avatars crawled at ~0.06 m/s instead of 3.4 m/s. Clamp
loosely (0.25) and treat frame rate as a first-class concern.

### The 0.5 fps was the test rig, not the app

The headless browser in this environment renders WebGL through **SwiftShader**
(software rasteriser, `ANGLE (Google, Vulkan ... SwiftShader Device)`), which
costs ~2 s per frame on a scene of this size. Every frame-rate number measured
here is a property of the test rig. Before optimising further, check
`WEBGL_debug_renderer_info` — optimising an application for a software
rasteriser is wasted work.

---

## 9. Facade, artwork and a living street

### Window cut-outs were silently impossible

`wallPanel()` builds a wall as strips around its openings, but it treated
`hole.y` as relative to the panel centre while `WINDOWS` stores it from the
floor. Every cut-out therefore landed at y 2.65–4.55 on a 3.4 m wall: no opening
was formed, and the window units sat inside the wall's thickness. Converting to a
local offset (`hole.y - h/2`) and raising the walls to 4.6 m fixed it. The lesson
generalises: when two files agree on a coordinate, write the frame of reference
in the name (`yFromFloor`) so the mistake cannot be made twice.

The facade is now 18 window units (6 north, 10 on the side elevations, 2 in the
lobby), plus plinth, mid band, cornice, corner pilasters and entrance sconces.

### Artwork is defined by its wall, not by coordinates

Hand-typed frame positions put paintings at the wall centre line (buried) or tens
of centimetres in front of it (floating). `PAINTINGS` now names the wall plane
and outward normal, and `paintingPlacement()` derives both the frame and the
canvas from the wall thickness. There is no coordinate left to get wrong.

### Animation belongs to the scene tick, not to timers

Pedestrians and traffic are plain arrays that `animateStreet(dt, t)` advances from
the frame loop. No `setInterval`, so they pause with the tab, stay in step with
`dt`, and cannot outlive the scene. Each walker swings its own legs and arms from
`t`, and the vehicles loop along a lane with headlights that matter at night.

### Trap: a long frame makes walkers oscillate

With `dt` up to 0.25 s a 3.4 m/s walker advances 0.85 m in one step. If that
overshoots the current waypoint, the next frame turns around and the avatar
oscillates in place — which reads as "stuck at the door". The step is now clamped
to the distance remaining on the leg (`Math.min(SPEED * dt, dist)`).

---

## 10. Facade openings, board mounting, and frames of reference

### Openings must be checked in world coordinates

`facadeConflicts()` first compared a painting's local `along` offset against a
window's world Z. They are different frames of reference, so it reported overlaps
that did not exist and hid ones that did. Everything is projected to world
coordinates before comparison. The invariant it now enforces:

> No two openings overlap; no opening falls inside the Kanban band; no artwork
> overlaps an opening.

Windows are generated from data (`NORTH_WINDOWS`, `SIDE_WINDOWS`) rather than
hand-placed, so the layout is checkable and reproducible.

### An object must fit the surface it is mounted on

The Kanban board was 7.6 m tall on a 4.6 m wall. Its lower edge drove 0.9 m
through the floor and its top stood 2.1 m proud of the wall — which is exactly why
it read as detached. Board height now derives from the wall with a fixed reveal,
so a later wall change cannot reintroduce the overlap. The same check applies to
the ceiling: a ceiling at 4.3 m under a 4.6 m wall sliced across the upper wall
and looked like a beam crossing the board. It is now flush with the wall top.

Artwork has the same failure mode in a smaller size: a frame box centred on the
wall's coordinate is buried inside the wall. `paintingPlacement()` measures
outward from the wall's inner face (`WALL_T/2 + FRAME_D/2`).

### One layout parent, or the parts drift

Column labels were CSS2DObjects positioned in board-local *world* units while the
card grid was laid out in *pixels*. Measured pitch: labels 211 px, columns 189 px —
the labels floated over the wrong columns and no constant could reconcile them
because one side scaled with the camera and the other did not. The headers now
live inside the same flex grid as the cards, inside board.ts. Measured after the
fix: header and column centres differ by 0 px.

Rule: if two overlays must line up, give them one parent.

### Trap: the E2E hook is build-time

`NEXT_PUBLIC_E2E_HOOK` is inlined at build time. A rebuild without it silently
drops `window.__office`, so every follow-up probe fails with "cannot read
properties of undefined" and looks like an application bug. Always rebuild with
the flag when probing.

---

## 11. Architecture pass: roof, glazing, entrance, rendering

### The building had no roof

Walls stopped dead at `WALL_H`. From outside it read as an open box — the
neighbouring blocks had parapets and it did not. Fixed with a perimeter parapet
plus coping, and a roof deck over the 4.2 m entrance strip carrying two air
handlers, a duct run, three capped vents and an access hatch.

The deck is deliberately NOT the whole lobby: a 34 x 9.6 m slab would hide half
the interior in the default view, and the cutaway is the point. The three work
rooms stay open so the office and its Kanban board remain readable.

### Windows were lit panels, not glazing

Behind every pane sat an emissive "sky card", so windows read as light boxes; and
the pane was flush with the wall face, removing the shadow line that makes an
opening legible. The card is gone (you see the room), the glass is recessed by a
0.07 m reveal, and each unit gained a transom, a projecting sill and a lintel band.
The south elevation — the street facade, carrying the entrance — had no windows at
all; it now has six.

### The canopy floated

A 0.22 m slab with nothing under it. It is now carried on two slim columns with
base plates and diagonal brackets, with a soffit, fascia trim and three soffit
downlights, over a recessed vestibule with a two-step threshold.

### Two rendering upgrades that changed everything

- **Image-based lighting.** Without an environment map, `metalness` has nothing to
  reflect, so every metal and glass surface renders flat and near-black — the
  building looked like painted cardboard. A generated RoomEnvironment (no asset
  files) plus `scene.environmentIntensity = 0.55` fills the shadows without
  washing the scene out.
- **Shadows, selectively.** The sun casts; `selectiveShadow()` enables casting and
  receiving only on meshes above 0.6 m, which keeps frames, sills and rungs out of
  the pass (552 of 701 meshes). The map resolution follows the quality tier
  (2048 / 1024 / off) instead of being locked, so a phone or a software rasteriser
  degrades gracefully rather than choking.

Background is now a vertical gradient (separate day and night stops) with matching
fog, rather than a flat colour — a flat colour gives the scene no depth and
discards the sky the moment the clock ticks over.

### Trap: a const used above its declaration is a runtime crash, not a compile error

`windowUnit` gained a lintel using `bandMat`, which is declared ~100 lines later in
the same function scope. TypeScript compiled it happily; at runtime the module threw
`Cannot access 'bandMat' before initialization` and React unmounted the whole app
("Application error: a client-side exception"). Order matters for `const` in a
scope — hoisting only applies to `function`.

### Trap: measure, do not trust the vision pass

The vision model reported "shadow maps disabled, no cast shadows" twice while the
runtime reported `castShadow: true` on 552 meshes, `shadowMap.enabled` true,
2048x2048, and the adaptive tier correctly stepping to 1024 under load. An A/B
capture after the fixes had the same model confirm shadows under vehicles, canopy,
trees and lamps. On this scene the vision pass is unreliable for lighting; the
runtime values are the ground truth.

---

## 12. Textures, props, and idle life

### The board was inside two walls

The Kanban board was 13.6 m wide in a 12.0 m work bay, so it passed clean through
both partitions at x = +-6 — the same class of bug as the 7.6 m board on a 4.6 m
wall. Width is 11.2 m, leaving 0.28 m clear of each partition face, and it is now
derived from the ROOM rather than chosen by eye. When an object is mounted inside a
space, both the surface it hangs on AND the enclosure around it are constraints.

### Fine texture detail does not survive mipmapping

The desk grain was present in the map (`map: deskTex`, verified in the served
bundle) yet the desk read as flat tan. Measured cause: fine lines at 1-2 px lose
their contrast when the mip chain averages them — a 512 -> 64 downsample retained
only **10%** of the standard deviation. Adding broad tonal bands (7-23 px wide)
first raises retention to **75%**, because low-frequency features survive
downsampling. Contrast was also raised from 0.03-0.07 to 0.10-0.32 alpha, which had
been invisible past a metre. A second copy of the canvas drives `roughnessMap`, so
the figure catches highlights instead of reading as one flat plane.

Rule: when a procedural texture must read at normal viewing distance, put the
signal in low frequencies. High-frequency detail is decoration that the GPU will
average away.

### Contact shadows are not the same thing as shadows

The directional shadow map cannot darken a contact patch, so desk legs and chair
bases visually detached from the floor. A radial gradient decal under every large
solid is a cheap stand-in for ambient occlusion and fixes the read.

### A seat footprint blocks its own seat

`blockingFootprints()` keeps anything above 0.5 m. Chairs and sofas qualify, so
validating an idle spot with `blocked()` discarded every sit-down spot — including
the `sofa` spot, which had been silently absent long before this change. `blocked()`
now takes `opts.allowSeat`: walking still respects seats (you cannot walk through a
sofa) while a seated spot is allowed to be ON one. Sofas and waiting benches were
also re-tagged from `prop` to `seat` for the same reason.

### Idle activities need a prop first

`garden`, `read` and `coffee` were added with real furniture before the poses:
a raised planter with herbs and two floor pots, a book nook (shelf with generated
spines, armchair, side table) and two pantry stools. A pose with nothing to
interact with reads as an agent staring at a wall, so the prop is built first and
the spot is validated against it.

`IDLE_SPOTS` went from 8 to 13 entries, and the seated ones carry `seated: true`
so they validate with `allowSeat`. Measured: 13/13 walkable (was 10/13 before the
seat fix, and the sit-down spots were dropped entirely).

### Trap: the vision pass is unreliable for texture and lighting

It reported "flat solid tan, zero grain" on the desk, "no shadows" twice, and
"flat untextured shading" across the scene while the runtime reported 552
shadow-casting meshes, a populated `map`, and a 2048 shadow map. After the fixes
it confirmed grain, contact shadows and grid alignment in the same scene. Use
runtime values and pixel statistics as ground truth; treat the vision pass as a
hint, and where it and the runtime disagree, believe the runtime.

---

## 13. Release pass: what actually blocked publication

### The README described an application that does not exist

Three claims were false and would have been the first thing a visitor hit:

- **"Connects via HTTP/SSE to Hermes Agent (`HERMES_API_URL` & `HERMES_API_KEY`)"**
  — `HERMES_DRIVER`, `HERMES_API_URL` and `HERMES_API_KEY` were never read by any
  file. The app drives the `hermes kanban` CLI. `.env.example` shipped all three
  anyway, so a new user would set variables that did nothing and then wonder why
  the board was empty.
- **"Built-in Mock Development Mode"** — there was no mock mode. `types/hermes.ts`
  declared `kind: 'api' | 'mock'`, but nothing implemented the second case.
- **`docs/API-SPEC.md` documented `GET /api/hermes/sync`, an SSE stream** — that
  route has never existed. The file described `initial_state` payloads for an
  endpoint with no file behind it.

The fix is structural, not editorial: `.env.example` now lists only variables the
code reads, and CI fails the build if a documented variable is never referenced.
API-SPEC.md was rewritten from the four real route files, including the actual
error codes (`not_found` was invented in my first draft and removed after
grepping the codebase for it).

### Private identifiers in a repo about to be published

`meeting-engine.ts` fell back to a provider-specific key variable named after the
operator's own infrastructure, and defaulted the model to that provider's private
alias. Both are gone: `AI_API_KEY` only, and the default model is a public one.
`docs/DEPLOYMENT.md` carried the same private model name in two places.

CI now greps every tracked file for those identifiers and for absolute paths from
the authoring machine. The path rule matches `/root/<project>|infra|panel|keys`
rather than all of `/root`, because `/root/.hermes` appears in a legitimate Docker
volume mount.

### `npm run selftest` was a promise with no file behind it

`package.json` advertised it; `scripts/selftest.ts` did not exist. It exists now and
asserts the ten invariants that caught real bugs here — board-versus-room,
board-versus-ceiling, window cut-outs inside the wall, artwork not buried, no
furniture overlap, inside/outside reachability. It failed on first run:
`pantry<->stool-1`, because the pantry stools were declared at the counter's own z
and were embedded inside the cabinet. They now sit at `PANTRY.z + PANTRY_STOOL_GAP`.

A self-test is only worth its runtime if it fails when something is wrong; this one
did, immediately.

### 18 of 21 screenshots were iteration debris

5.6 MB of images from successive design passes, referenced nowhere. Curated to the
three the README actually shows and quantised to 256 colours (UI renders are
low-poly, so banding is invisible): **5.6 MB -> 236 KB**.

### Verification

```
npm run typecheck   ok
npm run selftest    10/10 checks passed
npm run build       ok
publish hygiene     no private identifiers, no authoring-machine paths
```

---

## 14. Spawn/kill, meeting history, and four geometry bugs the measurements found

### Kill must not delete work

`POST /api/hermes/agents` toggles office MEMBERSHIP, not data. An agent exists in
the room when its Hermes profile is an assignee, so "kill" adds the name to an
in-memory kill-list and the avatar leaves; its tasks stay on the board. Verified:
killing `default` drops the office to `['lulu','risko']` while the board still
reports 10 tasks, two of them `default`'s.

The kill-list lives in memory for the life of the process. That is deliberate —
persisting it would mean writing office state into the Hermes install, which this
app otherwise never does. A restart restores "everyone visible". Documented in
API-SPEC.md rather than left as a surprise.

### Spawn and kill animate through the door

Removal is deferred. `syncAgents()` no longer deletes an agent that disappeared
from the list; it sets `leaving`, and the avatar paths to the entrance and despawns
only on arrival. Spawning sets `spawnGate`, a ~1.6 s hold at the threshold facing
into the room. Without those two, agents pop into and out of existence at a desk,
which reads as a rendering glitch rather than an agent arriving or leaving.

A task that comes back mid-exit cancels the exit (`leaving = false`), otherwise an
agent re-hired during its walk-out would vanish anyway.

### "Previous meetings" needed reading the files that were already being written

`persist()` has always written a markdown transcript per meeting. Nothing read them
back, so `listMeetings()` returned only the in-memory map and a restart emptied the
UI's history. `listArchived()` parses them with a narrow, tolerant reader: header
fields by prefix, transcript by its `**speaker**` lines, anything unrecognised
ignored rather than thrown. One unreadable file must not empty the whole list, so
per-file errors are swallowed.

`GET /api/hermes/meeting` now returns `{configured, live, active, archived}` in one
request, and `?id=` returns a single transcript. Measured against the real install:
3 archived meetings loaded, newest first.

The create form lists agents too — the point of a picker is to show who exists
before you commit to participants.

### Four geometry bugs, all found by measuring rather than looking

1. **Four of eight paintings hung in mid-air.** The lobby walls were declared as a
   12 m span centred on `z=6` (0..12) while the partition actually runs 3.4..12.7.
   Two pieces landed past the end, two before the start. `WallFace` now carries
   `from`/`to` derived from the room constants, `paintingPlacement()` measures
   `along` from the wall's start rather than its centre, and the self-test asserts
   every painting fits its wall.
2. **Cars drove through each other.** Each car had its own speed inside one lane,
   so a 10 m/s car lapped a 6 m/s car on the same line. One speed per lane.
3. **Pedestrians walked through each other** for the same reason, one speed per row
   — plus `PED_GAP`, because equal speeds alone still let a walker close a gap that
   started small.
4. **The pantry stools were inside the cabinet.** Declared at the counter's own z,
   which put them inside its footprint. The self-test caught this on its first run.

Each was invisible in a screenshot and obvious in a number.

---

## 15. Three frame-of-reference bugs in one wall, and why the checks agreed with the bug

The user reported this twice — "paintings still floating / colliding" and, earlier,
"the side windows are mirrored, just holes". Both were real, both survived a
previous "fix", and both survived the self-test. The reason is the same in every
case: **two pieces of code disagreed about a coordinate, and the check compared the
same two wrong numbers against each other.**

### The side windows were mirrored

`wallPanel()` cuts a hole at world `z = z - holes.x · sin(ry)`, which for the side
elevations (`ry = +PI/2`) is `z = -holes.x`. `windowUnit()` places its mesh at its
`cz` argument directly. Both were handed `SIDE_WINDOWS`, so:

```
holes:  z = -x  →  11.2,  6.7,  2.2, -2.3, -6.8, -11.3
glass:  z = +x  → -11.2, -6.7, -2.2,  2.3,  6.8,  11.3
```

Not one window unit sat in its opening. The side elevations were six holes and six
panes of glass on opposite sides of the building. Fixed by negating the hole list.

### Artwork was placed in tangent space and validated in world space

`paintingPlacement()` adds `along` to `wall.from`, so `along` must be a **tangent
offset from the wall's start**. The painting list was hand-written as if `along`
were an absolute world coordinate, and with `ry = ±PI/2` the tangent also runs
**backwards** on one side of the building — so the same number landed mirrored.

The fix is not more careful arithmetic; it is removing the arithmetic:

- `wallFace()` now takes the wall's WORLD extent and converts to tangent space
  itself.
- `lobbyAlongForWorldZ(wall, z)` takes a world Z and returns the offset, doing both
  conversions (`world → tangent` and `tangent → offset`).
- The painting list reads in world coordinates, which is what you can check against
  the building.

### The self-test passed while four paintings floated

`facadeConflicts()` derived a painting's world position by hand — `wall.x + tx·along`
— using the wall **centre** while `paintingPlacement()` uses the wall **start**. Two
different formulas, so the checker and the geometry disagreed by a whole offset and
the check reported "0 conflicts". The same helper now derives the art position by
calling `paintingPlacement()`, so there is one formula.

The integrity check was also weak in a second way: "is the art inside its room" is
not the same as "is the art clear of the glass". Side windows span several rooms, so
a painting could sit inside the lobby and still land on a window in it — which two
of them did. There is now a dedicated `no painting covers a side window` assertion,
and it is the assertion that would have caught the original report.

### Verify with a diagram, not a screenshot

The browser harness dies on this scene before it can hand back a frame (900+ meshes
with a shadow pass under a software rasteriser), so visual confirmation is
unavailable. The elevation is therefore rendered from the real layout data:

```
=== DINDING TIMUR x=+17 ===
 3.45 |  WWWWWWWWWW       WWWWWWWWWWW       WWWWWWWWWW       WWWWWWWWWW.......WWWWWWWWWW.......WWWWWWWWWW.
 2.88 |  WWWWWWWWWW       WWWWWWWWWWW       WWWWWWWWWW       WWWWWWWWWWAAAAAA.WWWWWWWWWWAAAAAA.WWWWWWWWWW.
 1.15 |                                                              ..AAAAAA...........AAAAAA............
```
`W` = window, `A` = artwork, `.` = lobby zone, `X` = collision. No `X` on either
wall, and both elevations are now identical — they should be, and before this they
were not.

Measured after the fix: 6/6 window holes match their glass, 8/8 paintings inside
their wall and clear of every opening, 12/12 self-test checks.

---

## 16. Creating a profile: two reasons an agent was invisible

The Agent panel could only toggle existing profiles. Adding "create" exposed two
bugs that would each have made it look broken.

### `listAgents()` only read task assignees

The roster came from `hermes kanban assignees`, which is derived from tasks. A
profile with no work therefore did not exist as far as the office was concerned, so
a freshly created agent would not appear until someone gave it a task — and the
obvious conclusion is "create did nothing".

`listProfiles()` reads the profile directories instead (a directory with a
`config.yaml` is a profile, which is what `hermes profile list` counts), and
`listAgents()` unions the two. The API also reports `profile: boolean` so the UI can
flag a name that exists only as a stale task assignee with `tanpa profil`.

The filesystem is the source rather than `hermes profile list` because that command
has no `--json` mode: parsing its table would break on a column reorder or a long
model name, and the office would silently show the wrong roster.

### Creating a profile must not clone credentials

`hermes profile create` has `--clone` and `--clone-all`. Neither is used. Cloning
copies the active profile's `config.yaml` — its model, provider and API keys — and
spawning an office worker must not hand it someone else's credentials. The profile
is created empty and inherits from the shell environment, exactly as the CLI does
without flags. `--no-alias` skips the wrapper script the office does not need.

### Verification against the real install

```
create  budi            -> 201, profile directory appears
describe budi           -> "Uji coba pembuatan profil dari office"
GET /agents             -> budi listed, total=0, profile=true, inOffice=true
GET /tasks              -> agents: budi, default, lulu, risko
create budi (again)     -> 400 'profil "budi" sudah ada'
create "Budi Dua"       -> 400 name-format error
kill budi               -> office: default, lulu, risko
spawn budi              -> office: budi, default, lulu, risko
```

The probe profiles were deleted afterwards; `~/.hermes/profiles` is back to the
original two.

---

## 17. A desk addressed by array position, and two chairs I turned the wrong way

### `DESKS[n]` is not the desk labelled n

`DESKS` is built by flat-mapping the columns, so the array alternates far/near:

```
DESKS[0] = desk 4     DESKS[1] = desk 0
DESKS[2] = desk 5     DESKS[3] = desk 1   …
```

`listAgents()` hands out `deskIndex`, and the scene did `DESKS[a.data.deskIndex]`.
So an agent whose card read "Meja 1" sat at the station labelled 5 — exactly what
was reported. Every lookup now goes through `deskByIndex(n)`, which searches by
label, and the self-test asserts `deskByIndex(n).index === n` for all eight.

This is the same failure shape as the other bugs in this file: two places agreeing
on a number while disagreeing on what it means. An array position is not an id.

### Two chairs rotated 180° by hand

The task chair and the conference chairs are built with the backrest at local +Z,
which is correct: the monitor is at local −Z, so a sitter faces it. When I added the
book-nook armchair and the lounge's second armchair I wrote `rotation.y = Math.PI`
"to face the TV" and "to face the shelf" — but with the backrest already at +Z,
no rotation was needed. The PI put the backrest against the target and the sitter's
face to the wall.

Checked now by direction, not by eye: the backrest normal is `(sin ry, cos ry)` and
the facing is its negation. Book chair → faces the shelf to the north. Lounge
chair → faces the TV wall. Desk and conference chairs unchanged and correct.

### The book nook was sitting in the work bay's doorway

It was placed at `x=0, z=1.7`. The work bay's door is at `x=0`, 3.4 m wide, opening
inward from `z=3.4`. Three of the nook's four footprints — shelf, chair, side table —
sat across that opening, which is what read as a sofa parked in the walkway. Moved
to the lounge's west corner; the second shelf unit moved to the north wall to make
room. A `no furniture blocks a doorway` assertion now covers all three room doors,
so this cannot come back silently.

Self-test: 14 checks.

---

## 18. Idle poses had no heading, and two more hand-placed rotations

### Seated agents faced whatever direction they walked in from

`seatYaw` existed and was applied — but only for `typing` and `meeting`:

```ts
if ((a.activity === 'typing' || a.activity === 'meeting') && a.walking < 0.5 && a.seatYaw !== undefined)
```

Every other seated pose (sofa, read, coffee) fell through, so the avatar kept the
heading it arrived with. Sitting on the sofa, that meant facing the backrest
depending on which way you walked in — which is exactly what was reported.

Worse, the idle spots never set `seatYaw` at all: the code assigned `a.target` and
`a.activity` and stopped. There was no heading to apply even if the gate had allowed
it. Both halves are fixed:

- `SEATED` is now a set of every pose that sits (`typing`, `meeting`, `sofa`,
  `read`, `coffee`), and the yaw applies to all of them.
- Every idle spot declares `face`, seated or standing. A standing agent staring at
  nothing is the same bug in a different pose.

Directions are verified numerically — the avatar's forward is local +Z, so the
facing is `(sin y, cos y)` and the check is the dot product with the vector to the
target. 7/7 spots now face what they are meant to.

### The garden was behind the television

The green corner sat at `z = -11.6`; the TV unit is at `z = -9.5`. An agent sent
there stood with its back to a screen in the far corner. Moved to the lounge's east
wall beside the side glazing, rotated 90°, with two stools facing the planter.

### Two chairs in the meeting pods had inverted rotations

```ts
chair.rotation.y = side > 0 ? Math.PI : 0
```

The backrest is at local +Z, so the chair at `-Z` needs `+Z` (no rotation) and the
one at `+Z` needs `PI`. The condition had both backwards — both pod chairs faced
away from their table. Now verified by direction: each chair's facing vector points
at the table centre.

### Two shelves in one corner

`book-shelf` and `lng-shelf-2` both ended up in the lounge's west corner after the
earlier reshuffle. `lng-shelf-2` is removed; the book nook keeps its own shelf.

### Note on the checker

The first pass at verifying the garden direction reported `dot=0.62` and looked like
a failure. The check compared against the planter's CENTRE, but the planter is a
2.9 m strip — the correct comparison is against the nearest point on it, which
gives 1.000. A wrong checker is indistinguishable from a wrong result until you look
at why it disagrees.

Self-test: 14 checks.

---

## 19. The facing gate was wrong twice, both times for the same reason

An agent at the green corner stood with its back to the planter. The spot declared
`face: Math.PI / 2`, pointing straight at it — so the data was right and the code
that consumed it was not.

`seatYaw` is applied by one line in the frame loop, and that line has now been
written wrong twice:

```ts
// v1: pose-name test
if ((a.activity === 'typing' || a.activity === 'meeting') && …)
// v2: hand-kept set of sitting poses
if (SEATED.has(a.activity) && …)
```

Both ask **"is this the right kind of pose?"**. The question that actually matters
is **"did the destination say which way to look?"** Every version therefore
silently excludes whatever pose is added next. `garden` and `dart` were the ones it
excluded, so those agents kept the heading they walked in with — back to the
planter, back to the dartboard.

The gate is now `a.seatYaw !== undefined`, and there is one path that decides
facing: `retarget()` sets `seatYaw` for every destination that has a direction
(desk, meeting seat, reviewer visit, idle spot) and clears it for those that do not.
The reviewer-visit and spawn-gate branches previously set `a.face` directly, a second
mechanism doing the same job; they go through `seatYaw` now.

Clearing matters as much as setting: without `a.seatYaw = undefined` at the top of
`retarget()`, an agent moving from a spot with a direction to one without would keep
the old heading and the pose layer would snap it there on arrival.

### A self-test for a bug that shipped twice

The check reads `scene.ts` and fails if a hand-kept `SEATED` set reappears, if the
pose-name comparison returns, or if `seatYaw` stops being cleared per retarget.
Grepping the source is a blunt instrument, but it is the only check that would have
caught both versions of this bug, and both versions reached the user.

Directions verified numerically (forward is local +Z, so facing is `(sin y, cos y)`,
compared against the nearest point on the target rather than its centre when the
target is a long strip): 7/7 idle spots.

Self-test: 15 checks.

---

## 20. A route handler deleted by a rewrite

Starting a meeting failed with `Failed to execute 'json' on 'Response': Unexpected
end of JSON input`. That message is the browser's, not the server's: the response
had a 405 status and an **empty body**, and `res.json()` on nothing throws.

Cause: `src/app/api/hermes/meeting/route.ts` was rewritten to add the history GET
(`{configured, live, active, archived}`) and only the GET was written. The POST
handler was not carried over. Nothing caught it:

- TypeScript cannot see a missing HTTP method — a route file with one export is
  perfectly valid.
- The build succeeds; the route just answers 405.
- The UI sends the request and only fails at `res.json()`.

Restored, and there is now a self-test that lists the methods each route must
export. It is a crude check — it reads the files and greps for the export — but a
missing handler is invisible to every other tool in the chain, and this is the
second class of bug in this codebase where a rewrite silently dropped behaviour.

Verified after the fix: `POST` returns 200 with the meeting object, and the
participant validation returns 400 `invalid_request` for fewer than two known
participants.

Self-test: 16 checks.

---

## 21. Every meeting is a card, including the running one

A live meeting rendered its entire transcript directly into the list, so the newest
meeting filled the panel and pushed the older ones out of view. The list is a list:
one card per meeting, and the transcript appears only once a card is opened.

Both kinds open the same way, which needed one state instead of two:

```ts
const [opened, setOpened] = useState<{ kind: 'live' | 'archive'; id: string } | null>(null)
```

- `kind: 'live'` reads from the in-memory meeting the store already holds, so the
  transcript keeps updating while the meeting runs.
- `kind: 'archive'` fetches the markdown by id.

Previously the archived transcript used its own `archive` state and the live one was
always expanded, so there was no single "which card is open" concept to build on.

The create form now clears its fields after a successful start, so opening it again
does not silently re-use the previous topic and participants.

---

## 22. Cron management, and why its reads come from two different places

`hermes cron list` has **no `--json` mode** — the same gap as `hermes profile list`.
Parsing a human table would break on a column reorder or a long job name, and the
office would silently show the wrong schedule, which is worse than showing nothing.

So reads are split by what is stable:

- **Jobs** come from `$HERMES_HOME/cron/jobs.json`. Its shape (`{jobs: [...],
  updated_at}`) is fixed, the CLI writes it, and a job object carries everything the
  panel needs: schedule, enabled state, `next_run_at`, `last_status`,
  `failure_streak`, `deliver`, `repeat`.
- **Executions** come from `hermes cron runs`, because that table's shape is the
  CLI's business and it already offers `--limit` to bound the rows.

Writes go through the CLI — `cron create`, `pause`, `resume`, `run`, `remove` — so
schedule parsing, validation and the lock protocol stay the CLI's job. The schedule
string is still pattern-checked before it is passed, because it becomes an argv
entry.

### Two safety rules in the UI, one of them not enforced by the API

1. **New jobs are created paused.** A job created live can fire before anyone has
   read it back, and the schedule syntax is easy to get wrong. The create form has
   an explicit "langsung aktif" checkbox.
2. **Actions need a second click.** The button becomes "Yakin jeda?" in place, and a
   click anywhere else cancels.

The second rule is a UI courtesy only, and the docs say so: the API cannot tell a
confirmed click from an unconfirmed one, so anything able to reach
`POST /api/hermes/cron` can pause or delete a job. Pretending otherwise would be a
worse kind of documentation than admitting it.

### Verified end to end

```
GET    (no jobs)        -> jobs: 0, runs: 0
create                  -> 201, id 86c71c7de2cf, enabled=false, state=paused
resume                  -> enabled=true, state=scheduled, next=2026-09-27T09:00
pause                   -> enabled=false, state=paused
remove                  -> success, job=null; jobs.json back to 0
GET ?id=unknown         -> 404
POST action=hapus       -> 400 'action harus salah satu dari: create, pause, …'
POST id=unknown         -> 400 'job "tidakada" tidak ditemukan'
POST schedule=''        -> 400 'jadwal wajib diisi'
POST prompt=''          -> 400 'isi prompt atau script'
```

The probe job was created paused and deleted; `jobs.json` is back to zero.

Self-test: 16 checks (the route-method assertion now covers `/api/hermes/cron`).
