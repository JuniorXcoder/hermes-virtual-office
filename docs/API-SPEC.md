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

The **screen peeker**: what a clicked monitor shows, plus the task's own row.

```json
{
  "taskId": "t_52abe1e8",
  "task": { "id": "t_52abe1e8", "status": "todo", "parents": ["t_0c35ea2b", "t_43e2205b"] },
  "runs": [
    { "id": "r_1", "status": "completed", "startedAt": "…", "finishedAt": "…", "outcome": "ok" }
  ],
  "log": "…raw CLI log tail…"
}
```

`task.parents` lists the tasks this one waits for. It comes from `kanban show
--json`, not `kanban list --json` — the board rows carry no dependency edge at
all, so a task parked by the auto-decomposer looks identical to a task nobody
picked up. The panel renders them as `PRASYARAT (n)` with each parent's status,
so "waiting for prerequisites" names the prerequisites instead of raising the
question.

`runs` and `log` are fetched in parallel and individually tolerated: a missing run
history or an unreadable log yields an empty value rather than failing the request.
Returns `502 peek_failed` only when both fail at the transport level.

---

## 5. `POST /api/hermes/tasks/{id}`

Desk intervention — the "tegur meja" controls. Five actions, discriminated by
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

### `action: "run"`

Runs ONE dispatcher pass (`hermes kanban dispatch --max 1`) so the task's worker
is spawned now.

Why it exists: the board has no runner of its own. `ready` only means "a worker
may take this" — the dispatcher that actually spawns workers lives in the Hermes
gateway. With the gateway stopped, a task sits in `ready` forever and the UI had
no way to say why or to do anything about it. The worker is spawned detached, so
it outlives this request.

A parked task (`blocked`/`scheduled`) is lifted first (`unblock`), because the
dispatcher ignores those rows entirely.

```json
{ "action": "run" }
```

- `200` → `{ "success": true, "spawned": ["t_..."], "mine": true, "note": "Worker dijalankan — pantau lewat Intip layar." }`
- `200` with `mine: false` → the dispatcher took another task first, or nothing was
  runnable. `note` says which. A task that lands back in `todo` is waiting on its
  parent dependencies — that is reported, not swallowed.

### `action: "promote"`

Returns a parked task to the board. `promote` refuses `scheduled`, so the route
calls `unblock` for that status; both land in `todo` when a parent is still open.

```json
{ "action": "promote", "message": "dijalankan dari kantor" }
```

- `200` → `{ "success": true, "promoted": true }`
- `502 action_failed` → the CLI refused (e.g. unsatisfied parent dependencies)

### `action: "set-model"`

Pins the model this task's worker is spawned with (`hermes kanban set-model`). It
takes effect on the **next** spawn. `model: null` clears the override.

```json
{ "action": "set-model", "model": "kn/deepseek-v4-flash", "provider": "9router" }
```

- `200` → `{ "success": true, "model": true }`
- The provider is optional but should be sent: `kanban set-model --provider` writes
  `provider_override`, and without it the worker inherits the profile's provider.

---

## 6. `GET /api/hermes/agents`

The spawn/kill menu.

```json
{
  "available": [
    { "name": "budi",    "total": 0, "profile": true,  "inOffice": true,  "model": "claude-sonnet-4.6", "reason": null },
    { "name": "default", "total": 7, "profile": true,  "inOffice": true,  "model": "Kenari",            "reason": null },
    { "name": "carol",   "total": 1, "profile": true,  "inOffice": false, "model": null,                "reason": "hidden" }
  ],
  "hidden": ["carol"]
}
```

`available` is the union of task assignees and profiles on disk, so a profile with
no tasks is still listed — otherwise creating one would look like it failed.

- `total` — tasks assigned to it.
- `profile` — the profile exists on disk. `false` means the name appears only as a
  task assignee (or came from a stale task), which the UI flags as `tanpa profil`.
- `inOffice` — currently shown in the room.
- `model` — the profile's default model (`hermes -p <name> config get model`). One
  CLI read per profile, run in parallel and only for profiles on disk; `null` when
  the profile has none or the read failed.
- `reason` — `hidden` (removed here via the membership toggle), `unknown` (absent
  for another reason), `no_profile` (assignee with no profile on disk), else `null`.

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

- `action`: `"spawn"`, `"hide"`, `"kill"`, `"create"`, `"set-model"`, `"serve"` or `"unserve"` (required)
- `name`: must be a profile the install knows (required)

Responses:

- `200` → `{ "success": true, "action", "name", "changed": true, "hidden": [...] }`.
  `changed` is `false` when the profile was already in the requested state.
- `400 invalid_request` → unknown action, missing name, `profil "x" tidak dikenal`,
  `profil "x" tidak ada di disk`, `profil "default" tidak bisa dihapus`, or
  `gateway profil "x" sedang berjalan — hentikan dulu sebelum dihapus`
- `502 action_failed` → the CLI failed while listing or deleting

### `action: "set-model"`

Sets the profile's **default** model — what its workers and chat turns run when a
task carries no override.

```json
{ "action": "set-model", "name": "budi", "model": "claude-sonnet-4.6", "provider": "9router" }
```

- `200` → `{ "success": true, "action": "set-model", "name": "budi", "model": "…", "provider": "9router" }`
- `400 invalid_request` → `model` empty
- `502 action_failed` → the CLI refused

Two writes: `model.default` (the model id) and `model.provider`. The provider is
stored **qualified** (`custom:9router`) — that is the form `hermes model` itself
writes, and a bare name is not accepted here. Both land in the profile's own
`config.yaml`, so they affect the next spawn or chat turn, not a running one.

Per-task overrides are separate and win over this: see `action: "set-model"` on
`POST /api/hermes/tasks/{id}`.

### What each action does to the profile

| `action` | Effect |
|---|---|
| `create` | creates a new, **empty** profile (no `--clone`) |
| `spawn` | removes the name from the in-memory hide list; profile untouched |
| `hide` | adds the name to the in-memory hide list; profile **and tasks untouched** |
| `kill` | **DELETES the profile** (directory, sessions, memory store, wrapper script) **and its tasks** |
| `set-model` | writes `model.default` / `model.provider` into the profile's `config.yaml` |

`hide` is the safe membership toggle, and it is the only action the UI offers for a
name that has tasks but no profile on disk — there is nothing to delete, and routing
that row to `kill` deleted the tasks behind a button that promised nothing would be
removed.

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

## 15. `/api/hermes/chat`

Talk to an agent, with memory.

The memory is Hermes' own per-profile session store (`state.db`), not a store of our
own: `hermes chat -q` answers and prints a `session_id`, and `--resume <id>` continues
that conversation with its history intact. The office only maps an agent to its
session id. See `src/lib/hermes/chat.ts` for why a second store was not built.

**An agent IS a profile.** Sending to `jun` runs the `jun` profile, and the thread
lives in that profile's store. There is no separate profile parameter: an earlier
version accepted one, which was a design mistake — `jun` the agent has no second
identity to choose from, and exposing the install's profile list as a choice only
confused things.

### `GET`

Without `agent`: the thread list, plus who can be chatted with. `agents` is every
profile, plus any board assignee that has no profile yet, so the list matches the
office floor. A name in `agents` but not in `profiles` cannot be chatted with — it is
shown disabled with "belum punya profil".

```json
{
  "sessions": [
    { "id": "20260927_114029_c50d6a", "agent": "jun", "profile": "office-chat",
      "title": "Ingat kode proyek AD-2026", "updatedAt": "…", "messageCount": 4 }
  ],
  "agents": ["default", "jun", "riset"],
  "profiles": ["default", "jun"]
}
```

With `?agent=<name>`: that thread's messages, oldest first. No thread yet is a normal
state — `session` is `null` and `messages` is empty, not a 404.

```json
{
  "agent": "jun",
  "session": { "id": "…", "profile": "office-chat", "messageCount": 4 },
  "messages": [
    { "role": "user", "content": "Ingat kode proyek AD-2026", "ts": 1790484022000 },
    { "role": "assistant", "content": "Tersimpan.", "ts": 1790484030000 }
  ]
}
```

### `POST`

```json
{ "agent": "jun", "message": "Kode proyek saya apa?" }
```

A reply can take minutes because the agent may run tools, so the server allows up to
300 s.

- `201`-style success → `{ "success": true, "session": { … }, "reply": "AD-2026." }`
- `400 invalid_request` → empty `agent` or `message`, or the agent has no profile
- `502 chat_failed` → the CLI failed, or answered without a readable `session_id`

### `DELETE ?agent=<name>`

Forgets the agent's thread pointer. **The history is not deleted** — it stays in
Hermes' session store and is recoverable with `hermes sessions list`. Reset is a
pointer operation, not a destructive one.

---

## 16. `GET /api/hermes/models`

The model catalogue for the two pickers (per-task override, per-agent default).

```json
{
  "models": [
    { "model": "Kenari", "provider": "9router", "label": "Kenari · 9router" },
    { "model": "kn/deepseek-v4-flash", "provider": "9router", "label": "kn/deepseek-v4-flash · 9router" }
  ]
}
```

Read from `hermes config get custom_providers --json`, because that list is exactly
what a worker can be spawned with — a hardcoded dropdown would drift from
`config.yaml`. The CLI masks `api_key`, so no credential reaches the browser.

- Deduped by model id; the first provider that declares an id wins.
- A provider with no `base_url` is skipped (unreachable), and a provider with no
  `models` map still contributes its default `model` so it can be picked at all.
- Sorted by label. Memoised for the same 3 s as every other CLI read.

The two pickers are the `ModelPicker` component, not a `<select>`. A native select's
popup is browser chrome: on a dark panel its option list renders dark-on-dark and
cannot be styled, and with ~400 models there is no way to reach one by typing. The
component draws its own list (light background, black text) and filters once the
query is 3 characters — below that it shows everything, capped at 80 rows, and always
reports the true match count so a truncated list never reads as "no such model".

---

## 17. Polling

There is no push channel. The client polls `GET /api/hermes/tasks` on an interval
set by `NEXT_PUBLIC_POLL_MS` (default `4000`). This is a build-time constant, so
changing it requires a rebuild.

Polling was chosen over SSE because the CLI has no event stream to subscribe to;
adding SSE would mean inventing a second source of truth.

---

## 18. Server-side limits worth knowing

- **One meeting at a time per server process.** State lives in memory, so a
  multi-instance deployment would run one meeting per instance and they would not
  see each other.
- **Meeting state is in-memory** and lost on restart. Transcripts and minutes are
  written to `DATA_DIR` as markdown and survive.
- **CLI calls are serialised per request**, not globally. Many simultaneous
  requests mean many child processes.
- **`taskLog`** reads only a tail (bounded by the CLI's `--tail`) so a chatty task
  cannot stream unbounded output into the browser.

---

## 19. `GET /api/hermes/agents` — full shape

`§6` shows the short menu. The real payload carries the A2A state, the
permission table and the restart flag (`src/app/api/hermes/agents/route.ts`
`GET`, lines 57–153):

```json
{
  "available": [
    {
      "name": "jun", "total": 7, "profile": true, "inOffice": true,
      "model": "cmc/deepseek/deepseek-v4.1-flash",
      "role": "ceo", "division": "exec", "soulExists": true, "domains": [],
      "a2a": "served", "reason": null
    }
  ],
  "hidden": ["default"],
  "permissions": { "ceo": { "allow": ["jeda semua", "…"], "deny": [], "anyTask": true } },
  "domainOwners": { "seo": "mkt-1" },
  "needsGatewayRestart": true
}
```

- `a2a` is the honest status: `served` = listed in `platforms.a2a.agents`,
  `unlisted` = profile exists but not registered, `null` = not a profile at
  all. `served` does **not** mean callable — the list is read once at gateway
  boot, so it applies only after a restart.
- `needsGatewayRestart` is `boolean | null` from the same comparator the
  doctor uses (`mtime config.yaml` vs gateway start, `readNeedsGatewayRestart`
  / `needsRestart` in `src/lib/hermes/doctor.ts`). `null` = cannot be
  determined — the UI shows grey, never green.
- `permissions` is `agentPermissionSummary()` from the single table in
  `src/lib/hermes/control.ts` (`AGENT_PERMISSIONS`).
- `domainOwners` maps each office domain to its owner via `ownersForDomains`
  (`src/lib/hermes/a2a.ts`); a domain with no owner is `null` — shown as-is,
  never invented.
- `reason` is `hidden` (membership toggle), `unknown` (profile exists but not
  shown), `no_profile` (assignee with no profile on disk), else `null`.

Raw probe (`GET /api/hermes/agents`, 2026-10-09, trimmed):

```json
{"available":[{"name":"jun","total":7,"profile":true,"inOffice":true,"model":"cmc/deepseek/deepseek-v4.1-flash","role":"ceo","division":"exec","soulExists":true,"domains":[],"a2a":"served","reason":null},{"name":"mkt-1","total":0,"profile":true,"inOffice":true,"a2a":"served","reason":null}],"hidden":["default"],"permissions":{"ceo":{"allow":["jeda semua","spawn/sembunyikan","kill","buat profil","ganti model","arahkan task","gerakkan task"],"deny":[],"anyTask":true}}}
```

---

## 20. `POST /api/hermes/agents` with `action: "serve"` / `"unserve"`

Registers or removes the profile's A2A entry (`upsertServedAgent` /
`removeServedAgent` in `src/lib/hermes/a2a-served.ts`; handler at
`src/app/api/hermes/agents/route.ts` lines 255–339).

```json
{ "action": "serve", "name": "jun" }
```

Success (`200`):

```json
{
  "success": true, "action": "serve", "name": "jun",
  "a2aNote": "Terdaftar. Berlaku setelah gateway di-restart — sampai itu, agent belum bisa dipanggil.",
  "peerAdded": true, "peerError": null, "peerProfiles": ["mkt-1"],
  "toolsetAdded": true, "toolsetError": null,
  "needsGatewayRestart": true
}
```

`serve` also registers the `<name>-local` peer (global + every other served
profile's scope, `ensureA2aPeer`) and merges the `a2a` toolset into the profile
(`ensureA2aToolset`, never overwrites the list) — so the agent can be CALLED
and can CALL. Both are idempotent; a failure is reported honestly in
`peerError` / `toolsetError` **without** undoing the registration.
`unserve` answers symmetrically with `"Tercabut dari config. Berlaku setelah
gateway di-restart — sampai itu, path A2A-nya masih dijawab."`

Honest refusals, probed 2026-10-09 (headers
`Host: 127.0.0.1:3300`, `Origin: http://127.0.0.1:3300`):

- Unknown profile → `400 invalid_request` (handler lines 257–269):

```json
{"error":{"code":"invalid_request","message":"profil \"zz-tidak-ada-9x9\" tidak dikenal — tidak ada profil di disk untuk didaftarkan","status":400}}
```

- On-behalf-of an agent → `400 refused` (serve/unserve is operator-only,
  lines 200–223; `denyAudit` records it):

```json
{"error":{"code":"refused","message":"hanya operator yang boleh mendaftarkan entri A2A — mengubah config gateway bukan wewenang agent","status":400}}
```

```json
{"error":{"code":"refused","message":"hanya operator yang boleh mencabut entri A2A — mengubah config gateway bukan wewenang agent","status":400}}
```

**"Berlaku setelah gateway di-restart" is load-bearing, not boilerplate.**
The served list is read once at boot (`peerBaseUrl` / A2A notes in code); a
green toggle without a restart is a lie the UI must not tell — see
`POST /api/hermes/gateway-restart` (§23) and the doctor `restart` check (§24).

---

## 21. `GET` / `POST /api/hermes/selfrepair`

The app fixing its own broken state (`src/app/api/hermes/selfrepair/route.ts`;
logic in `src/lib/hermes/selfrepair.ts`). Both are idempotent: healthy state →
nothing changes.

`GET` = preview only, read-only, no write guard (like doctor):

```json
{ "success": true, "planned": [], "unfixable": [] }
```

`planned[]` items have `kind` (`staleServed` | `deadAvatar` | `dupAvatar` |
`strayProfileDir` | `danglingProvider` | `missingA2aToolset` |
`missingA2aPeer`), `target`, and an honest `what` sentence.
`unfixable[]` items name what is broken plus why this module cannot fix it —
`null` owner, unreadable source, or "tidak bisa dipastikan" are reported
verbatim, never swallowed into success.

`POST` = runs the repairs (existing writers only, backup before writing),
then re-checks the doctor and returns **both** — not a "fixed" claim. Write
guard required (changes gateway config + office DB):

```json
{
  "success": true,
  "result": {
    "a2aRemoved": [], "avatarRemoved": [], "avatarMerged": [],
    "toolsetAdded": [], "peerAdded": [], "providerFixed": [], "dirsRemoved": [],
    "failed": [{ "target": "…", "why": "…sebab nyata…" }],
    "unfixable": []
  },
  "doctor": { "readAt": "…", "hermesBin": "…", "checks": […] }
}
```

Raw probe, healthy host (2026-10-09) — empty plan, empty failures:

- `GET /api/hermes/selfrepair` → `{"success":true,"planned":[],"unfixable":[]}`
- `POST /api/hermes/selfrepair` →
  `{"success":true,"result":{"a2aRemoved":[],"avatarRemoved":[],"avatarMerged":[],"toolsetAdded":[],"peerAdded":[],"providerFixed":[],"dirsRemoved":[],"failed":[],"unfixable":[]},"doctor":{"readAt":"2026-10-09T06:18:36.059Z",…}}`

---

## 22. `POST /api/hermes/meeting/cancel`

Cancels the live meeting (`src/app/api/hermes/meeting/cancel/route.ts`;
`cancelMeeting` in `src/lib/hermes/meeting.ts` lines 589–609). Stops at the
turn boundary — the running turn finishes, the runner quits before the next
one, never mid-archive-write. `{ id? }` without id targets the meeting holding
the execution slot.

Three honest answers, all probed:

- `200 cancel_requested` — new request, flag raised; the runner finalises:

```json
{ "ok": true, "cancel_requested": true, "meeting": { "id": "m…", "state": "running" } }
```

- `200 already_cancelled` — idempotent double-cancel (meeting already
  `done` / `cancelled` / `error`):

```json
{ "ok": true, "already_cancelled": true, "meeting": { "id": "m…", "state": "cancelled" } }
```

- `404 no_running_meeting` — no lie of success when nothing runs (probed
  2026-10-09, empty board):

```json
{"error":{"code":"no_running_meeting","message":"tidak ada rapat yang berjalan","status":404}}
```

A still-queued meeting with zero turns finalises immediately so the operator
never waits on a runner that never started. See `docs/MEETING-PROTOCOL.md`
for what the archive looks like.

---

## 23. `POST /api/hermes/gateway-restart`

Schedules a gateway restart (`src/app/api/hermes/gateway-restart/route.ts`).
Why it exists: A2A served entries are read once at boot, so every serve
demands a restart. The route does NOT restart itself — it schedules the
`gw-restart.service` unit (own cgroup, PID + port verification, result to
Telegram) via `systemctl --user start --no-block`.

Write guard applies (privileged action). Without a valid origin → `403`
(probed 2026-10-09, no `Origin` header):

```json
{"error":{"code":"forbidden_origin","message":"origin \"(tidak ada)\" tidak diizinkan menulis. Tambahkan \"127.0.0.1:3300\" ke ALLOWED_ORIGINS di .env.local, lalu restart.","status":403}}
```

Success (same day, valid origin) only means *scheduled*, not restarted:

```json
{"success":true,"scheduled":true,"message":"Restart dijadwalkan lewat gw-restart.service — halaman ini akan kehilangan sambungan sebentar. Hasilnya (berhasil ATAU gagal) dilaporkan ke Telegram."}
```

Failure (unit missing, systemctl error) → `502` with `scheduled: false`,
the real error, and the manual path — never fake success:

```json
{
  "success": false, "scheduled": false,
  "message": "Restart TIDAK dijadwalkan — unit gw-restart.service gagal dijalankan. Jalankan manual dari shell di mesin yang sama:",
  "manual": ["hermes gateway restart", "systemctl --user start gw-restart.service"],
  "error": "…"
}
```

The manual command is `hermes gateway restart` (portable); the unit is the
host-specific alternative. Host binary paths are deliberately not written here.

---

## 24. `GET /api/hermes/doctor` — panel "Siap pakai?"

Read-only, changes nothing. The requester's `Host`/`Origin` are forwarded so
the origin check judges the real browser (`src/app/api/hermes/doctor/route.ts`;
`runDoctor` in `src/lib/hermes/doctor.ts`). House rule, same as the UI panel:
what cannot be determined says so (`unknown`) — never a green light for
"looks fine".

| `id` | What it checks | `fail` means |
|---|---|---|
| `cli` | `hermes --version` answers | binary missing / un-runnable |
| `board` | task list readable via CLI | `HERMES_BIN` / board wrong |
| `profiles` | ≥1 profile on disk | none at all |
| `models` | every profile has a default model | chat to the named ones will fail |
| `model-providers` | `custom:<name>` resolves in the profile's own scope (only when a custom provider is used) | `Unknown provider` at chat time |
| `simulasi` | `AI_BASE_URL` + `AI_API_KEY` set | simulasi meetings answer "not configured" (a2a needs none of this) |
| `a2a-platform` | `platforms.a2a` enabled + port | A2A server not up |
| `served` | served entries fresh (`local:false`), stale ones named not counted | none fresh / stale / `local:true` (wrong identity) |
| `restart` | `mtime config.yaml` vs gateway start | stored but NOT active — restart |
| `origin` | requesting browser may write | writes will 403 |
| `caller` | every served profile has the `a2a` toolset (called + can-call) | reachable but mute — one-way meetings |
| `peers` | `a2a_agents.<slug>-local` global + in every other served profile's scope | `a2a_call("name")` → `unknown agent` / tool missing from session |
| `fallthrough` | unknown A2A path refused, never answered by the default agent | fallthrough bug — reinstall `docs/patches/hermes-a2a-unknown-path-404.README.md` |

Three states, all legitimate: `pass` / `fail` / `unknown`. `unknown` is an
honest answer, e.g. `origin` requested without an `Origin` header (curl,
server-to-server) — the panel cannot know what a browser would send:

```json
{"id":"origin","label":"Origin boleh menulis","status":"unknown","detail":"tidak bisa dipastikan — panel diminta tanpa header Origin (buka panel ini dari browser untuk memeriksa)","fix":""}
```

Full probe (2026-10-09, 13 checks, trimmed details — pre-restart, gateway stale).
Gateway di-restart jam 13:17 WIB; probe pasca-restart (13:25) menunjukkan
kombinasi jujur yang baru: `restart: pass` ("gateway start lebih baru dari
config — served yang tersimpan sudah aktif"), `served: pass` (2 siap:
jun, mkt-1), `origin: unknown` (tetap sah tanpa header `Origin`).

```json
{"readAt":"2026-10-09T06:16:39.968Z","hermesBin":"/usr/local/bin/hermes","checks":[
{"id":"cli","status":"pass"},{"id":"board","status":"pass"},
{"id":"profiles","status":"pass"},{"id":"models","status":"pass"},
{"id":"model-providers","status":"pass"},{"id":"simulasi","status":"pass"},
{"id":"a2a-platform","status":"pass"},{"id":"served","status":"pass"},
{"id":"restart","status":"fail","detail":"config.yaml lebih baru dari start gateway — entri served tersimpan tapi BELUM aktif"},
{"id":"origin","status":"unknown"},
{"id":"caller","status":"pass"},{"id":"peers","status":"pass"},
{"id":"fallthrough","status":"pass"}]}
```

Note the honest combination on a real host: everything green except
`restart: fail` (a serve is stored but not active yet) and `origin: unknown`
(probed without a browser). That is the panel telling the truth, not a broken
panel.

---

## 25. Routes the old spec never mentioned

Every `route.ts` under `src/app/api/hermes` exists and answers; these had no
section at all. Each mutating route enforces the same-origin write guard
(`assertLocalWriteRequest`, `src/lib/local-guard.ts`) — reads always work,
writes without a trusted `Origin` get `403 forbidden_origin`.

### `GET /api/hermes/office` · `POST /api/hermes/office`

The office's own store (`data/office.db` via `src/lib/office/db.ts`) — room
name and avatar positions. Deliberately separate from the Hermes CLI routes:
a broken Hermes install still renders the room.
`GET` seeds the dummy roster on first run (idempotent) → `{ name, avatars }`.
`POST` actions: `setName`, `saveAvatars` (malformed rows dropped, not fatal),
`claimAvatar` (one agent = one canonical `agent:<name>` row; needs
`avatarId` + `name`, else `400`). Unknown action → `400 invalid_request`.

### `GET` / `POST /api/hermes/control` — KENDALI

The only endpoint that changes system state (`src/lib/hermes/control.ts` is
the single rulebook; the route owns no rules of its own).
`GET` → `{ pause, estopPath, actions, audit, agentPermissions }`; `pause` is
read from the `$HERMES_HOME/ESTOP` sentinel — opening the panel can never
pause the system.
`POST` runs ONE closed-list action: `pauseAll` (needs a reason ≥3 chars),
`resumeAll`, `unblock` / `promote` / `release` (need `t_<hex8>` task id;
`unblock` needs a reason), `setFallback` (chain recomputed server-side from
measured providers, never taken from the client). Unknown action →
`400 invalid_request`; rule refusal → `400 refused` (also audit-logged);
`pauseAll` stops NEW work only — in-flight work is never killed. Replies name
what happened (`{ ok: true, did, pause }`), never bare "ok".

### `GET /api/hermes/board`

The answering board: `{ board, pause, notRead }`. Detail (`kanban show`,
~1.4 s each) is fetched only for `blocked`/`running`/`review` tasks, max 40 —
`notRead` names how many were cut, so the cut is visible, not silent.

### `GET /api/hermes/approvals`

Read-only: `{ policy, patterns, pending, blockedAgents, health, notRead }`.
No path here approves, refuses, or edits anything — `suggest --apply` is
never called. Same 40-task detail budget as board.

### `GET /api/hermes/observability?days=30&hours=24`

Read-only command state: `{ health, providers, fallback, status, usage,
errors, errorsRecent }`. Every section carries `ageSeconds` so the panel can
call data STALE. Health judges the short window (30 min), not `hours`.

### `GET /api/hermes/toolsets`

The real Hermes toolset list (`hermes tools list --platform cli`, parsed) for
the create-agent form's `advertised_toolsets` — the form picks from this
instead of inventing names. → `{ toolsets: [{ name, enabled }] }`; CLI down →
`503 hermes_unavailable`.

### `GET /api/hermes/a2a/live` · `GET /api/hermes/a2a/transcript`

A2A calls between agents (protocol truth), not meetings. Both read `source='a2a'`
session exports per profile + `a2a_conversations/ctx-*.jsonl`, memoised 20 s
(N CLI exports behind them). `live` → `{ pairs, at }` (who is talking to whom
right now, for avatar movement); `transcript` → the conversations. Failures →
`502 a2a_live_failed` / `a2a_transcript_failed`.

### Verification & evidence

- `GET /api/hermes/tasks/{id}/verification` — independent check of ONE task:
  worker claims vs review trail from `kanban show` events. Read failure →
  `502`, never an empty "unverified".
- `POST /api/hermes/tasks/verification` — batch marks (`{ ids }` in body
  because the list rides the body; still read-only): `{ mode: "ringkas",
  cap: 40, marks }`, ids past the cap are `unchecked` (neutral, not judged).
- `GET /api/hermes/tasks/{id}/evidence` and `POST
  /api/hermes/tasks/evidence` — same shape for work evidence (summary, last
  run outcome + metadata, log, attachments).
- Unknown task id anywhere → `404` (`not_found` / `invalid_request`), e.g.
  `GET /api/hermes/tasks/zz-tidak-ada` →

```json
{"error":{"code":"not_found","message":"tugas \"zz-tidak-ada\" tidak ada di board","status":404}}
```

### `GET /api/hermes/meeting/actions?from=<id>` · `GET /api/hermes/cron/actions?from=<id>`

Proposals, never writes — creating goes through `POST /api/hermes/tasks`
(batch shape). Meeting actions parse the minutes' `## TINDAK LANJUT` section
(live or archived) and resolve each owner against the live roster (`suggested`
is `null` when the minutes named nobody known — the UI opens the picker
rather than assigning to nobody; empty items = normal, "agreed nothing").
Cron actions emit one item only when `failureStreak > 0`, carrying the real
`lastError`. Unknown id → `404 invalid_request` (probed):

```json
{"error":{"code":"invalid_request","message":"rapat \"zz-tidak-ada\" tidak ditemukan","status":404}}
{"error":{"code":"invalid_request","message":"job \"zz\" tidak ditemukan","status":404}}
```

---

## 26. Corrections to older sections of this same file

Probed against code 2026-10-09; the old text was wrong on these points:

- `§8` action list omitted `serve` / `unserve` (fixed above).
- `§10`: a second start does **not** queue — `startMeeting`
  (`src/lib/hermes/meeting.ts`) throws `masih ada rapat yang berjalan` when
  `busy`, and the route answers `409 meeting_failed`. One meeting per server
  process; the loser is refused, not queued.
- `§10` validation today: unknown names are **named** in a `400` (a2a mode
  uses the serve-reject text naming who), not silently dropped; `<2` known →
  `400`; unserved participants in a2a mode → `409 meeting_failed` naming who
  (`missingServed` + `formatReject`, `src/lib/hermes/meeting-a2a.ts`).
- `§10` modes: `a2a` = real agents, anything else = `simulasi` (the old
  `roundtable` value in the example request is not a mode — it falls back to
  `simulasi`). `GET` archives expose the stored `mode` plus `cancelled` and
  `ctxIds`, which `§9` did not list.
- Error table (`§1`): the live code also emits `refused` (400, agent
  permission / operator-only), `no_running_meeting` (404), `no_profile`
  (409), `forbidden_origin` (403), `not_found` (404), `selfrepair_failed`
  (502/503), `doctor_failed` / `board_failed` / `approvals_failed` /
  `observability_failed` / `a2a_live_failed` / `a2a_transcript_failed` /
  `meeting_actions_failed` / `cron_actions_failed` / `verification_failed` /
  `evidence_failed` (502/503), `office_db_failed` / `office_write_failed`
  (500), `no_candidate` (400).
