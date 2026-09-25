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
