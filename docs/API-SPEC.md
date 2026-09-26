# 📡 Hermes Virtual Office — API Specification

Every endpoint below exists in the code and is described from its implementation.
All routes live under `/api/hermes` and set `dynamic = 'force-dynamic'` — they are
never statically cached, because the board changes underneath them.

There is no SSE stream and no authentication layer. The browser talks to these
routes on the same origin, and the server talks to the local `hermes` CLI.

---

## 0. How the server reaches Hermes

There is no HTTP client to a Hermes API server. The server shells out to the
official CLI and parses JSON from stdout:

```
hermes kanban [--board <slug>] <args...> --json
```

- `HERMES_BIN` (default `hermes`) selects the executable. If it is missing the CLI
  call fails with a message naming the path it tried.
- `HERMES_KANBAN_BOARD` pins a board; omitted, the CLI's active board is used.
- `KANBAN_TIMEOUT_MS` (default `20000`) aborts a call that hangs.

This is deliberate: the CLI is Hermes' stable public surface, so board layout and
`kanban.db` schema can change without breaking this app.

---

## 1. Error shape

Every failure returns the same envelope, with an HTTP status that matches `status`:

```json
{ "error": { "code": "hermes_unavailable", "message": "…", "status": 503 } }
```

| `code` | Status | Meaning |
|---|---|---|
| `invalid_request` | 400 | A required field is missing or malformed |
| `not_running` | 409 | Cancel was requested for a task that is not running |
| `meeting_failed` | 409 | A meeting could not start (see `message`) |
| `peek_failed` | 502 | Runs/logs could not be read from the CLI |
| `action_failed` | 502 | The CLI rejected the action |
| `dispatch_failed` | 502 | Task creation failed |
| `hermes_unavailable` | 503 | The CLI could not be reached or returned an error |

Success responses are never wrapped — they are the payload directly.

---

## 2. `GET /api/hermes/tasks`

The office's single source of truth: every task and the derived agent list.

```json
{
  "tasks": [
    {
      "id": "t_52abe1e8",
      "title": "Uji regresi checkout",
      "status": "running",
      "assignee": "lulu",
      "priority": 0,
      "updatedAt": "2026-09-26T08:14:02.000Z",
      "createdAt": "2026-09-26T08:02:11.000Z"
    }
  ],
  "agents": [
    {
      "name": "lulu",
      "displayName": "lulu",
      "role": "qa",
      "deskIndex": 3,
      "status": "working",
      "currentTaskId": "t_52abe1e8"
    }
  ]
}
```

`agents` is **derived**, not stored: `listAgents()` folds the task list into one
entry per assignee, so an agent exists in the office exactly when it has work.

- `role` comes from `roleFor(name)` — a name heuristic, not a stored field.
- `deskIndex` is a station slot 0-7, or `null` when the agent has no desk.
- `status` is `idle | working | review | blocked | meeting | done`, derived from
  the agent's active task (`running` → `working`, `review` → `review`).

Statuses map to Kanban columns in `board.ts`:

| Hermes status | Column |
|---|---|
| `todo`, `triage`, `ready`, `scheduled` | TODO |
| `running` | JALAN |
| `review` | REVIEW |
| `done` | SELESAI |
| anything else (`blocked`, `archived`) | TODO |

Returns `503 hermes_unavailable` when the CLI fails.

---

## 3. `POST /api/hermes/tasks/create`

Creates a task and (through the CLI) dispatches it.

**Request**

```json
{ "title": "Ship the release checklist", "assignee": "lulu", "body": "…", "priority": 2 }
```

`title` and `assignee` are required and non-empty. `title` is truncated to 300
characters. `priority` is optional and coerced with `Number.isFinite`.

**Responses**

- `201` → `{ "success": true, "task": { … } }`
- `400 invalid_request` → missing `title` or `assignee`
- `502 dispatch_failed` → the CLI refused the create

---

## 4. `GET /api/hermes/tasks/{id}`

The **screen peeker**: what a clicked monitor shows.

```json
{
  "taskId": "t_52abe1e8",
  "runs": [
    { "id": "r_1", "status": "completed", "startedAt": "…", "finishedAt": "…", "outcome": "ok" }
  ],
  "log": "…raw CLI log tail…"
}
```

`runs` and `log` are fetched in parallel and individually tolerated: a missing run
history or an unreadable log yields an empty value rather than failing the request.
Returns `502 peek_failed` only when both fail at the transport level.

---

## 5. `POST /api/hermes/tasks/{id}`

Desk intervention — the "tegur meja" controls. Two actions, discriminated by
`action`.

### `action: "steer"`

Appends a comment to the task; on a running task Hermes delivers it to the worker.

```json
{ "action": "steer", "message": "Stop looping on the auth test and report the blocker." }
```

- `200` → `{ "success": true, "steered": true }`
- `400 invalid_request` → `message` empty
- `502 action_failed` → the CLI rejected the comment

### `action: "cancel"`

Releases the worker's claim on the task.

```json
{ "action": "cancel" }
```

- `200` → `{ "success": true, "released": true }`
- `409 not_running` → the task is not currently running. This is **correct**
  behaviour being reported honestly, not a server fault: the CLI refuses to reclaim
  a task that has nothing to reclaim. The matcher accepts `cannot reclaim`,
  `not running`, or `unknown id` from stderr.
- `502 action_failed` → any other CLI failure

---

## 6. `GET /api/hermes/meeting`

Everything the meeting picker needs, in one request.

```json
{
  "configured": true,
  "live": [ { "id": "m_1", "topic": "…", "state": "running" } ],
  "active": "m_1",
  "archived": [
    {
      "id": "m1790411341397",
      "topic": "meeting dummy",
      "startedAt": "2026-09-26",
      "participants": ["lulu", "risko"],
      "moderator": "lulu",
      "mode": "auto",
      "turnCount": 7,
      "preview": "**lulu** (opening r1): …",
      "archived": true
    }
  ]
}
```

- `configured` is `Boolean(AI_BASE_URL && AI_API_KEY)`. When `false` the UI says so
  instead of letting the user start something that cannot run.
- `live` are meetings in this process. `state` is `queued | running | done | error | idle`.
- `active` is the id holding the single execution slot, or `null`. A second start
  queues behind it.
- `archived` are markdown transcripts on disk under `DATA_DIR/meetings`, newest
  first. Reading is tolerant: a hand-edited or unparseable file yields fewer fields
  rather than failing the request, and one bad file never empties the list.

### `GET /api/hermes/meeting?id=<meetingId>`

Returns one archived transcript verbatim: `{ "id": "…", "body": "# topic…" }`.
`404 invalid_request` when the id is not on disk.

---

## 5b. `GET /api/hermes/agents`

The spawn/kill menu.

```json
{
  "available": [
    { "name": "budi",    "total": 0, "profile": true,  "inOffice": true,  "reason": null },
    { "name": "default", "total": 7, "profile": false, "inOffice": true,  "reason": null },
    { "name": "risko",   "total": 1, "profile": true,  "inOffice": false, "reason": "killed" }
  ],
  "killed": ["risko"]
}
```

`available` is the union of task assignees and profiles on disk, so a profile with
no tasks is still listed — otherwise creating one would look like it failed.

- `total` — tasks assigned to it.
- `profile` — the profile exists on disk. `false` means the name appears only as a
  task assignee (or came from a stale task), which the UI flags as `tanpa profil`.
- `inOffice` — currently shown in the room.
- `reason` — `killed` (removed here), `unknown` (absent for another reason), `null`.

## 5d. `POST /api/hermes/agents` with `action: "create"`

```json
{ "action": "create", "name": "budi", "description": "Frontend specialist" }
```

Creates a Hermes profile and brings it into the office.

- `name` must match `^[a-z0-9][a-z0-9_-]{0,63}$` (lowercase, digits, `-`, `_`).
- `description` is optional and is passed to `hermes profile describe`'s field; the
  kanban decomposer routes on it.

Responses:

- `201` → `{ "success": true, "action": "create", "name": "budi", "description": "…" }`
- `400 invalid_request` → name already exists (`profil "budi" sudah ada`) or the
  name does not match the pattern
- `502 action_failed` → the CLI failed

**The profile is created empty** — `hermes profile create` without `--clone`.
Cloning copies the source profile's `config.yaml`, which carries its model,
provider and API keys; spawning an office worker must not hand it someone else's
credentials. The new profile inherits from the shell environment, exactly as the
CLI does without flags. `--no-alias` skips wrapper-script creation, which the office
does not need because it drives profiles through the kanban CLI.

## 5c. `POST /api/hermes/agents`

```json
{ "action": "kill", "name": "risko" }
```

- `action`: `"spawn"`, `"kill"` or `"create"` (required)
- `name`: must be a profile the install knows (required)

Responses:

- `200` → `{ "success": true, "action", "name", "changed": true, "killed": [...] }`.
  `changed` is `false` when the profile was already in the requested state.
- `400 invalid_request` → unknown action, missing name, or `profil "x" tidak dikenal`
  (spawn/kill accept profiles on disk as well as task assignees)
- `502 action_failed` → the CLI failed while listing profiles

**This changes office membership only.** Killing a profile removes its avatar; its
tasks stay on the board, and `GET /api/hermes/tasks` still reports them. The
kill-list lives in memory for the life of the server process — a restart restores
everyone. Persisting it would mean writing office state into the Hermes install,
which this app never does.

---

## 7. `POST /api/hermes/meeting`

Starts a meeting. Participants are **validated against the live agent list**, so a
stale name from an old page cannot start a meeting with a non-existent agent.

**Request**

```json
{
  "topic": "Should we split the auth service?",
  "participants": ["lulu", "risko"],
  "moderator": "lulu",
  "mode": "roundtable"
}
```

**Validation performed**

1. `participants` must be an array; every entry is stringified.
2. Names not in the current agent list are dropped.
3. Fewer than 2 survivors → `400 invalid_request`
   (`"pilih minimal 2 peserta yang dikenal"`).

**Responses**

- `200` → `{ "meeting": { … } }`
- `400 invalid_request` → too few known participants
- `409 meeting_failed` → the engine refused (already running, provider
  unconfigured, or a start error)

Only one meeting runs per server; a second start queues behind the first.

---

## 8. Polling

There is no push channel. The client polls `GET /api/hermes/tasks` on an interval
set by `NEXT_PUBLIC_POLL_MS` (default `4000`). This is a build-time constant, so
changing it requires a rebuild.

Polling was chosen over SSE because the CLI has no event stream to subscribe to;
adding SSE would mean inventing a second source of truth.

---

## 9. Server-side limits worth knowing

- **One meeting at a time per server process.** State lives in memory, so a
  multi-instance deployment would run one meeting per instance and they would not
  see each other.
- **Meeting state is in-memory** and lost on restart. Transcripts and minutes are
  written to `DATA_DIR` as markdown and survive.
- **CLI calls are serialised per request**, not globally. Many simultaneous
  requests mean many child processes.
- **`taskLog`** reads only a tail (bounded by the CLI's `--tail`) so a chatty task
  cannot stream unbounded output into the browser.
