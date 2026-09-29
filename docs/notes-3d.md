# Scene 3D, Tata Letak & Animasi

Building the office: footprint and collision, facade openings, seats, poses,
textures, and the street outside. Most of these were found by measuring rather
than looking.

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

---

## 14. Spawn/kill, meeting history, and four geometry bugs the measurements found

### Membership is `hide`, deleting is `kill`

`POST /api/hermes/agents` offers both, and they are not the same operation:

- `hide` adds the name to an in-memory hide list and the avatar walks out. The
  profile and its tasks are untouched, so the board still reports them.
- `kill` DELETES the profile (`hermes profile delete`) and purges its tasks.

This split exists because the two were once the same code path. A row with tasks but
no profile on disk — an assignee whose profile was already deleted — was offered a
button labelled "Sembunyikan" with the tooltip "tanpa menghapus apa pun", and that
button called `kill`. Clicking it deleted the tasks it promised to keep.

The hide list lives in memory for the life of the process. That is deliberate —
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

---

## 27. The ground, and two textures that had no relief

### "Hovering above clouds" was literally true

The ground was one plane: 60 x 52 m, colour `#a3a8ab`. Two consequences:

- **A pale plane that stops dead reads as sky, not ground.** Nothing beyond its edge
  but the background gradient, so the eye finishes the office with a horizon of
  nothing.
- **Buildings stood outside it.** A block at `x = 30` that is 12 m wide spans
  x 24..36 against a slab edge at x 30, and a southern block spanned z 34.5..43.5
  against an edge at z 26. Those blocks were floating over empty space — the report
  was accurate, not a figure of speech.

Two layers now:

- **Earth**, 220 x 220 m, dark olive (`#6b7a56`), tiled one texture per 12 m. Far
  beyond the furthest building in every direction, so there is no edge in view from
  the camera's clamped range.
- **Plaza**, 120 x 110 m, laid on top. Sized to contain every neighbouring block,
  not just the office.

The earth texture is deliberately low-frequency: broad tonal drift, clumps and
grit. Fine noise at this scale becomes uniform mush once mipmapped — the same
finding as the desk grain, where fine lines kept ~10% of their contrast through the
mip chain and broad bands kept ~80%.

A self-test now asserts every block lies inside the ground plane, because "the
buildings are standing on nothing" is not something a screenshot at normal zoom
makes obvious.

### The floor and the walls

- **Floor:** boards were 64 px (8 per texture) with grain lines at 4-13% alpha —
  invisible. Now 12 narrower boards with per-board tone variation (0.82-1.18), five
  broad grain bands at 8-22% alpha, fine grain on top, and a **dark seam plus a
  light bevel** at each board edge. Without the seam the boards merge into one
  surface, which is most of why it read as a flat sheet.
- **Walls:** the only variation was 900 circles at 2-5% alpha, which mipmapping
  erases. Now 60 broad radial blotches (7-17%), 34 long soft roller streaks, and
  5,200 fine stipple points. Plaster is painted with a roller, so both the broad
  pressure variation and the fine stipple are drawn.

Self-test: 18 checks.

---

---

## 29. Seats that nothing could sit on, and labels that never left

### The sofa was 9 cm too high, and the crouch was 13 cm underground

Two reports, one root cause: a seated pose was never compared against the furniture.

The avatar's legs reach 0.46 m below the hip (thigh 0.48 + shin 0.46, with the foot
slab). A desk chair's surface is 0.505 m, so the feet could not touch the floor —
they dangled 4-5 cm. The sofa was modelled with its surface at 0.59, so its sitters
dangled 12 cm. Nothing measured this.

Worse was the gardener. Its pose used `hip 0.46`, which put the feet **13 cm through
the floor** — and the floor hid them, so the visible result was a torso sitting in
mid-air with no chair under it, exactly as reported.

The fix is one source of truth. `SEATS` in layout.ts holds, per seat, the pose
(hip/thigh/knee) and the surface thickness; `seatTop()` derives the surface height
and build.ts uses it for the geometry while anim.ts uses the angles for the pose. The
angles were **solved against the rig** — a script sampled the real avatar until the
feet landed at 0.000 — not chosen by eye:

```
seat     hip     thigh  knee    feet land
chair    0.516   -86    90.75   0.000   (surface 0.505)
sofa     0.460   -88    66      0.000   (surface 0.449)
nook     0.516   -86    90.75   0.000   (surface 0.505)
stool    0.655   -92    64      0.239   (foot ring 0.24)
```

A self-test rebuilds the avatar and asserts every pose lands its feet where the seat
says. That check did not exist, which is why both errors shipped.

### The gardener was sitting, not crouching

Even with the feet planted, the pose read as sitting: measured, its knee came 0.46 m
forward and a desk sitter's comes 0.48 — indistinguishable. The rig has no waist
joint, so `chest` pivots at the top of the torso and leaning forward moves the head
~12 cm and the hands not at all; standing, the hands cannot reach below y=1.13 while
the planter's leaves are at 0.82. A real crouch is the only pose that reaches the bed.

Solved: `hip 0.634, thigh -50, knee 115, chest +35`. Feet at 0.000, knee 0.368
forward (vs 0.479 seated), hands on the leaves at 0.820 — zero error. Head height
drops from 1.64 to 1.29, so it reads as crouching from across the room.

Note the sign: positive `chest.rotation.x` leans **forward**. The old pose used -26,
which leaned the gardener *away* from the plant it was tending.

### Killed agents left their nameplates at the door

`scene.remove(group)` fires three.js's `'removed'` event on the **group**. The label
and speech bubble are `CSS2DObject` **children**, so their own handler never ran and
their DOM elements stayed in the overlay forever, frozen at the last projected
position — the doorway. Every killed agent stacked another name there, which is what
the screenshot showed.

`removeAgent()` now detaches both explicitly (`removeFromParent()` plus `el.remove()`)
before removing the group.

Self-test: 19 checks.

---
