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
      "assignee": "bob",
      "priority": 0,
      "updatedAt": "2026-09-26T08:14:02.000Z",
      "createdAt": "2026-09-26T08:02:11.000Z"
    }
  ],
  "agents": [
    {
      "name": "bob",
      "displayName": "bob",
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

## 3. `POST /api/hermes/tasks`

Creates one task, or several under a shared origin. One endpoint for both shapes
because they are the same operation; they used to be two routes
(`tasks/create` and `tasks/from-items`) that duplicated the create path, the origin
validation and the partial-failure reporting.

**Single shape**

```json
{ "title": "Ship the release checklist", "assignee": "bob", "body": "…", "priority": 2 }
```

`title` and `assignee` are required and non-empty. `title` is truncated to 300
characters. `priority` is optional and coerced with `Number.isFinite`.

- `201` → `{ "success": true, "task": { … } }`
- `400 invalid_request` → missing `title` or `assignee`
- `502 dispatch_failed` → the CLI refused the create

**Batch shape** — used by the meeting and cron panels to turn their output into
tasks:

```json
{
  "origin": { "kind": "meeting", "ref": "m1790411341397" },
  "items": [
    { "title": "tulis migrasi tabel invoices", "assignee": "alice", "body": "Tenggat: 2026-09-30" },
    { "title": "tambah test regresi checkout", "assignee": "bob" }
  ]
}
```

`origin.kind` is one of `meeting`, `cron`, `agent`, `manual` and is written to the
task's `created_by` as a marker (`meeting:m1790411341397`), so the board can show
where a task came from and the source panel can list what it produced. Items are
capped at 25 per request.

- `201` → `{ "success": true, "created": [ … ], "failed": [ … ], "origin": { … } }`
- `400 invalid_request` → unknown `origin.kind`, or no items
- `502` → nothing was created (some may still have failed individually)

**Partial success is normal.** An item with no assignee is reported in `failed`
with `"penanggung belum dipilih"` rather than silently assigned to nobody, and the
other items are still created.

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

## 6. `GET /api/hermes/agents`

The spawn/kill menu.

```json
{
  "available": [
    { "name": "budi",    "total": 0, "profile": true,  "inOffice": true,  "reason": null },
    { "name": "default", "total": 7, "profile": false, "inOffice": true,  "reason": null },
    { "name": "carol",   "total": 1, "profile": true,  "inOffice": false, "reason": "killed" }
  ],
  "killed": ["carol"]
}
```

`available` is the union of task assignees and profiles on disk, so a profile with
no tasks is still listed — otherwise creating one would look like it failed.

- `total` — tasks assigned to it.
- `profile` — the profile exists on disk. `false` means the name appears only as a
  task assignee (or came from a stale task), which the UI flags as `tanpa profil`.
- `inOffice` — currently shown in the room.
- `reason` — `killed` (removed here), `unknown` (absent for another reason), `null`.

---

## 7. `POST /api/hermes/agents` with `action: "create"`

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

---

## 8. `POST /api/hermes/agents`

```json
{ "action": "kill", "name": "carol" }
```

- `action`: `"spawn"`, `"kill"` or `"create"` (required)
- `name`: must be a profile the install knows (required)

Responses:

- `200` → `{ "success": true, "action", "name", "changed": true, "killed": [...] }`.
  `changed` is `false` when the profile was already in the requested state.
- `400 invalid_request` → unknown action, missing name, `profil "x" tidak dikenal`,
  `profil "x" tidak ada di disk`, `profil "default" tidak bisa dihapus`, or
  `gateway profil "x" sedang berjalan — hentikan dulu sebelum dihapus`
- `502 action_failed` → the CLI failed while listing or deleting

### What each action does to the profile

| `action` | Effect |
|---|---|
| `create` | creates a new, **empty** profile (no `--clone`) |
| `spawn` | removes the name from the in-memory hide-list; profile untouched |
| `kill` | **DELETES the profile** (directory, sessions, memory store, wrapper script) **and its tasks** |

`kill` is destructive and permanent. `hermes profile delete` leaves a one-line
tombstone at `profiles/.deleted/<name>`, but that is a marker for the gateway, **not
a backup** — nothing can be restored from it.

**`kill` also removes the profile's tasks from the board.** The tasks are deleted
first, then the profile, and the response reports how many:

```json
{ "success": true, "action": "kill", "name": "carol", "deleted": true, "purged": 3, "killed": [] }
```

Without this the board accumulated work belonging to nobody — a name that no longer
existed as a profile, still holding tasks. `deleted` is `false` when the profile was
already gone but it still had tasks, which is the case worth cleaning up.

**Refused while any of its tasks is live.** Archiving a `running` or `review` task
abandons the worker mid-flight and the CLI does it without complaint, so the request
is rejected with `409` naming the task ids. Stop them first.

**Refused for a profile whose gateway is running.** `hermes profile delete` stops
that gateway itself, so deleting a served profile would take down whatever messaging
it handles. The CLI already refuses `default`; this refuses that plus a live
gateway. The check reads the profile's own `gateway.pid` (a JSON blob, with the PID
verified against the process table so a stale file does not count) and the default
gateway's `served_profiles` list, because a multiplexed profile has no pid file of
its own.

**A name with tasks but no profile is a valid target** — that is exactly the stale
case worth cleaning. It returns `409 no_profile` only when there is nothing to
remove at all.

---

## 9. `GET /api/hermes/meeting`

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
      "participants": ["bob", "carol"],
      "moderator": "bob",
      "mode": "auto",
      "turnCount": 7,
      "preview": "**bob** (opening r1): …",
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

## 10. `POST /api/hermes/meeting`

Starts a meeting. Participants are **validated against the live agent list**, so a
stale name from an old page cannot start a meeting with a non-existent agent.

**Request**

```json
{
  "topic": "Should we split the auth service?",
  "participants": ["bob", "carol"],
  "moderator": "bob",
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

## 11. `GET /api/hermes/meeting/actions`

The follow-up items from one meeting's minutes, as candidate tasks.

`?from=<meetingId>` — works for a live meeting and for an archived transcript.

```json
{
  "meeting": { "id": "m1790411341397", "topic": "Migrasi database" },
  "items": [
    { "owner": "alice", "text": "tulis migrasi tabel invoices", "due": "2026-09-30", "suggested": "alice" },
    { "owner": "dave",  "text": "siapkan runbook rollback", "suggested": null }
  ],
  "roster": ["default", "alice", "bob"]
}
```

Items come from the `## TINDAK LANJUT` section of the minutes. `suggested` is the
owner resolved against the live roster, or `null` when the minutes named somebody
who is not a profile — the UI then opens the owner picker rather than assigning
work to nobody. An empty `items` array is a normal outcome: minutes that agreed
nothing have nothing to convert.

- `404` → no such meeting

**Nothing is written by this endpoint.** Creating goes through
`POST /api/hermes/tasks` with the batch shape.

---

## 12. `GET /api/hermes/cron`

Every scheduled job plus recent executions.

```json
{
  "jobs": [
    {
      "id": "86c71c7de2cf",
      "name": "cek rilis harian",
      "prompt": "…",
      "schedule": "0 9 * * *",
      "scheduleKind": "cron",
      "enabled": true,
      "state": "scheduled",
      "nextRunAt": "2026-09-27T09:00:00+07:00",
      "lastRunAt": null,
      "lastStatus": null,
      "lastError": null,
      "failureStreak": 0,
      "deliver": "local",
      "noAgent": false,
      "script": null,
      "skills": [],
      "repeatTimes": null,
      "repeatCompleted": 0
    }
  ],
  "runs": [
    { "id": 42, "jobId": "86c71c7de2cf", "status": "success", "source": "scheduler",
      "startedAt": "2026-09-26 09:00", "finishedAt": "2026-09-26 09:00" }
  ]
}
```

### Why the jobs are read from a file and the runs from the CLI

`hermes cron list` has **no `--json` mode**, so parsing its table would break on a
column reorder or a long job name and the office would silently show the wrong
schedule — worse than showing nothing. The job list is read from
`$HERMES_HOME/cron/jobs.json`, whose shape is stable and which the CLI itself
writes. Executions come from `hermes cron runs`, where the table shape is the CLI's
business, not ours; `--limit` bounds the rows.

`GET /api/hermes/cron?id=<jobId>` returns one job and its runs; `404` when the id is
unknown.

---

## 13. `POST /api/hermes/cron`

### Create

```json
{ "action": "create", "schedule": "0 9 * * *", "prompt": "…", "name": "…", "paused": true }
```

- `schedule` — `30m`, `every 2h`, or a cron expression. Validated against
  `^[0-9A-Za-z*/,:\- ]{1,64}$` before it reaches the CLI.
- `prompt` or `script` — one is required.
- `paused` — **defaults to `true`**. A job created live can fire before anyone has
  read it back. Pass `false` to start it immediately.

`201` → `{ "success": true, "id": "86c71c7de2cf", "job": { … } }`.

### Act

```json
{ "action": "pause", "id": "86c71c7de2cf" }
```

`action` is one of `pause`, `resume`, `run`, `remove`. `200` →
`{ "success": true, "action", "id", "job" }` (`job` is `null` for `remove`).

**The endpoint executes what it is told.** The UI asks for a second click before
acting, but that is a UI courtesy — the API cannot tell a confirmed click from an
unconfirmed one. Anything able to reach this route can pause or delete a job.

Errors: `400 invalid_request` for an unknown action, a missing id, an unknown job id,
or a missing/oversized schedule; `502 action_failed` when the CLI fails.

---

## 14. `GET /api/hermes/cron/actions`

A failing cron job, as a candidate task.

`?from=<jobId>` — returns one item only when `failureStreak > 0`, carrying the
job's real `lastError` in the body. A healthy job has nothing to hand over and
returns an empty list rather than inventing work.

```json
{
  "job": { "id": "4a349bb25d9f", "name": "cek rilis harian" },
  "items": [{ "text": "Perbaiki cron \"cek rilis harian\" (gagal 3×)", "owner": "", "body": "…" }],
  "roster": ["default", "alice"]
}
```

- `404` → no such job

---

## 15. Polling

There is no push channel. The client polls `GET /api/hermes/tasks` on an interval
set by `NEXT_PUBLIC_POLL_MS` (default `4000`). This is a build-time constant, so
changing it requires a rebuild.

Polling was chosen over SSE because the CLI has no event stream to subscribe to;
adding SSE would mean inventing a second source of truth.

---

## 16. Server-side limits worth knowing

- **One meeting at a time per server process.** State lives in memory, so a
  multi-instance deployment would run one meeting per instance and they would not
  see each other.
- **Meeting state is in-memory** and lost on restart. Transcripts and minutes are
  written to `DATA_DIR` as markdown and survive.
- **CLI calls are serialised per request**, not globally. Many simultaneous
  requests mean many child processes.
- **`taskLog`** reads only a tail (bounded by the CLI's `--tail`) so a chatty task
  cannot stream unbounded output into the browser.
