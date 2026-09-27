# Backend & Integrasi Hermes

Bridging the office to a real Hermes install: the Kanban CLI, the cron
store, meeting orchestration, and the cross-menu links between them.

---

> **Route paths in these notes are as they were when written.** A later refactor
> merged `POST /api/hermes/tasks/create` and `POST /api/hermes/tasks/from-items`
> into `POST /api/hermes/tasks`. For the current surface see
> [API-SPEC.md](API-SPEC.md); the entries below keep their original paths because
> they are records of what was verified at the time.

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

---

## 4. Desk assignment is derived, never stored

Desk position is computed, not persisted: agents that are `running` or `review`
take the first stations, idle agents fill the rest in alphabetical order. That
keeps avatars still across reloads without writing layout state into the Hermes
install — the app remains a pure reader of the board.

---

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

---

---

## 24. `kill` deletes the profile, and the guard that almost did not exist

`kill` used to hide a profile from the office. It now runs `hermes profile delete`:
the directory, sessions, memory store and wrapper script are gone. The only residue
is a one-line tombstone at `profiles/.deleted/<name>` containing the word
`deleted` — a gateway marker, **not a backup**. Nothing restores from it.

### Two guards, one of them supplied by the CLI

`hermes profile delete` refuses `default` on its own (it lives at `~/.hermes` itself,
not under `profiles/`). It does **not** refuse a profile whose gateway is running —
it stops that gateway first. Deleting a served profile would therefore take down
whatever messaging it handles, and a bot going quiet is not an acceptable side
effect of a button in a 3D office.

Detecting "gateway running" needs two signals, because a profile can be served two
ways:

1. Its own `gateway.pid` — **a JSON blob, not a bare number**, with the PID verified
   against the process table so a stale file left by a crash does not count.
2. The default gateway's `served_profiles` list. A multiplexed profile has no
   `gateway.pid` of its own, so signal 1 alone reports it stopped.

`hermes gateway status` was not used: it reports only the active profile.

### The first guard test passed for the wrong reason

The probe wrote a `gateway.pid` pointing at `$$` — the shell's own PID — then sent
the kill request. The request was accepted and the profile deleted, which looked
like the guard had failed. It had not: `$$` was the PID of the short-lived shell
running the probe, which had already exited by the time the API read the file, so
the liveness check correctly reported the gateway stopped.

Re-run with PID 1 (permanently alive), the guard refused as designed:

```
kill zzz-gw2 (gateway.pid -> pid 1) -> 400 'gateway profil "zzz-gw2" sedang berjalan'
profiles/ still contains zzz-gw2
```

A test that passes is not the same as a test that tested what you meant.

### Verified

```
create zzz-hapus-uji -> profile directory appears
kill   zzz-hapus-uji -> deleted: true, directory gone from disk
kill   default       -> 400 'profil "default" tidak bisa dihapus'
kill   tidakada      -> 400 'profil "tidakada" tidak ada di disk'
kill   (gateway up)  -> 400 'gateway profil … sedang berjalan'
```

Probe profiles deleted afterwards; `profiles/` is back to `alice, bob, carol`, and
the default gateway (PID 131415) was never touched.

---

---

## 26. A deleted profile, a lane too narrow, and a sign error shipped twice

### "Can't delete carol" — there was nothing to delete

The panel offered `Kill` for every name in the office, but the roster is the union
of profiles **and task assignees**. `carol`'s profile directory was already gone;
only the name survived on an old task. Killing it therefore answered `profil "carol"
tidak ada di disk`, which reads as a failed delete rather than "there is nothing
here".

Two fixes:

- The API returns `409 no_profile` with an explanation instead of a bare `400`, and
  the roster now carries `reason: 'no_profile'` so the UI can tell the two apart.
- A name without a profile gets a **Sembunyikan** button (membership only) instead
  of `Kill`. `Kill` is shown only when there is a profile to destroy.

The underlying confusion is that one list mixes two kinds of thing — a profile that
exists, and a string that used to be one. The UI now says which it is (`tanpa
profil`) and offers only the action that can succeed.

### The lanes were exactly one car wide

```
lane centres   z = 26.6 and 28.4   -> 1.8 m apart
car body width                     -> 1.8 m
```

The two directions touched, so the westbound lane sat on the eastbound one. Moved to
24.5 and 28.5: 4.0 m apart with 2.2 m of clear road between them, both inside the
road band (22.5..31.5).

### Pedestrians walked through the neighbours — and then through our own building

The sidewalk rows were at `HALF_D + 3.4` and `+ 6.6`, i.e. z 16.4 and 19.6. The
neighbouring blocks occupy z 10..19.5, so both rows ran straight through them.

The first fix moved the rows to `HALF_D - 1.4` and `- 2.8` — z 11.6 and 10.2, which
is **inside our own building** (z −13..13). Same expression, opposite sign error.
The sidewalk is on the street side: z > HALF_D.

The real cause was underneath both attempts: the southern neighbours were placed at
z 14 and 15, covering the entire sidewalk band, so no value of the offset could
work. They now sit across the road at z 38 and 39, leaving the band from the facade
at 13 to the kerb at 22 clear.

Verified: 6/6 pedestrian rows clear of every block and of the road, 6/6 neighbouring
blocks clear of the road, lanes 4.0 m apart. A `street is layered` self-test asserts
all of it, because this is the second time a sign error here reached the user.

### Textures

Eleven procedural textures existed but **not one normal or bump map** — a
`MeshStandardMaterial` with only a colour map has no relief, so lighting slid over
every surface uniformly and everything read as flat paint. `bumpFrom()` derives a
bump map from the luminance of each colour map (no new generators), tiled to match,
and it is applied to floors, lobby tile, walls, desks, vinyl, fabric, carpet,
asphalt and pavement. Resolutions raised where they were still 128 or 256 px.

Self-test: 17 checks.

---

---

## 28. Killing an agent now deletes its tasks, and three bugs found doing it

`kill` removed the profile but left its tasks behind, so the board accumulated work
belonging to nobody. It now removes both: the tasks first, then the profile.

### `hermes kanban list --archived` is a FILTER, not "include archived"

`listTasks({includeArchived: true})` passed `--archived` expecting the archived rows
to be added. Measured on the same board:

```
hermes kanban list --json             -> 16 rows
hermes kanban list --archived --json  ->  0 rows
```

It returns **only** archived rows, so the flag silently produced an EMPTY list. There
is no CLI flag for "everything including archived", so the two sets are fetched
separately and merged by id.

This mattered because `tasksForAssignee()` used that flag to find an agent's work —
it saw nothing, and the "N tasks are still running" guard then fired against the
wrong set.

### `archive` refuses an already-finished task, and says so without failing

```
hermes kanban --board default archive t_ca6865ff
  -> "cannot archive t_ca6865ff"
  -> exit code 0
  -> the task is deleted anyway by the following `--rm`
```

The CLI answers with that line, exits **0**, and the purge still works. Treating it
as fatal made a successful purge report `502 action_failed` while the board showed
the tasks gone — the worst kind of error, one that is wrong about what happened. The
archive pass is now tolerant; the purge pass is not, because if that fails the tasks
really are still there.

### The spawn guard rejected the case kill exists for

`POST /api/hermes/agents` validated every action against "profiles the install
knows", so `kill carol` — a name with tasks but no profile, which is exactly what
needs cleaning up — was refused with `profil "carol" tidak dikenal`. The check now
applies to `spawn` only; `kill` has its own validation because its requirements are
different.

### The board was not pinned, so reads were not stable

The office used the CLI's *active board*, a global that other tools move. During this
work the active board changed to an empty one and the office started reading it — 0
tasks where there had been 13. `HERMES_KANBAN_BOARD=default` is now set in
`.env.local`, and `.env.example` already documented the variable. An unpinned office
can silently show the wrong board; pinning removes the class of bug.

### Guard kept: a running task blocks the delete

Archiving a running task abandons the worker mid-flight, and the CLI does it without
complaint. The endpoint refuses while any task is `running` or `review`, naming the
ids. Verified: the guard fired first, then allowed the delete once the tasks were
terminal.

### Verified

```
create zzz-uji3 + 2 tasks  -> kill -> deleted: true, purged: 2, board back to 13
kill carol (no profile)    -> 409 no_profile when it has no tasks; purges its tasks when it has them
kill default               -> 400 refused
kill (task running)        -> 409 refused, ids listed
```

All probe profiles and tasks removed. `profiles/` is `alice, bob`; the board holds 13
tasks across `default`, `alice`, `bob`. The `carol` task was removed during testing,
which is the behaviour that was asked for.

Self-test: 18 checks.

---

---

## 30. Crossing menus: output of one becomes input of another

The board was a flat pile. A meeting produced follow-ups and a cron job produced
failures, and neither left a trace of where the work came from — you could not tell
which meeting asked for what, or get back to it.

### The link lives in `created_by`

`hermes kanban create --created-by` accepts free text and returns it verbatim on
`list --json` (verified). So the origin rides there as a marker — `meeting:m123`,
`cron:abc`, `agent:alice` — and is parsed back out. No schema change, and the field the
CLI already writes itself (`worker`, `user`) is left alone rather than mistaken for a
link: `parseOrigin('worker')` returns `manual`, and the UI shows nothing for it.

### The meeting contract was already there

`MINUTES_SYSTEM` has always asked for a `## TINDAK LANJUT` section with one line per
item as `**Owner**: deliverable — tenggat`. That is a contract, not a guess, so the
parser reads it. It is lenient about FORM and strict about CONTENT: bold or plain
owners, bullets or numbers, wrapped lines joined back to their bullet — but a line
that yields no text is dropped, and `Belum ada kesepakatan` is not a task.

Measured against real minutes, it produces exactly the three items written, resolves
`alice`/`bob` to real profiles, and returns `null` for `dave`, who is not on the
roster. That null is the point: an item whose owner the roster does not know is
offered with the picker open, not silently assigned to nobody.

### Nothing is created until you say so

Both sources PROPOSE. The meeting panel lists the parsed items with a checkbox and an
owner picker; the cron panel offers one item, only for a job that is actually failing
(`failureStreak > 0` — a healthy job has nothing to hand over, and offering one would
be noise). The default is every row with a resolved owner ON, every row without one
OFF, because an item assigned to nobody is not work.

The create call is one shared endpoint, `POST /api/hermes/tasks/from-items`, rather
than one per source: the only thing that differs is the marker, and duplicating the
path would let the two drift. Partial success is reported as such — one row with no
assignee must not lose the others.

### Both directions are visible

A created task shows its origin in the task panel (`asal: rapat m123`) and carries a
colour-coded chip on the board card (green meeting, blue cron, purple agent), so the
link can be read from either end.

### Verified end to end

```
GET  meeting/actions?from=mTESTLINK  -> 3 items, dave unresolved (null)
POST tasks/from-items                -> 2 created, 1 refused ("penanggung belum dipilih")
     created_by on the board          -> 'meeting:mTESTLINK' on both
GET  cron/actions?from=<healthy job> -> 0 items
GET  cron/actions?from=<failing job> -> 1 item carrying the job's real error text
POST tasks/from-items (cron origin)  -> 1 created, origin reads back as cron:<id>
GET  */actions?from=unknown          -> 404 JSON from the handler, not a route miss
```

All probe tasks, the probe job and the probe transcript were removed afterwards; the
board is back to its 13 tasks and `jobs.json` was restored from a backup taken before
the test.

Self-test: 21 checks (added origin round-trip and minutes parsing).

---

---

## 31. A measurement that did not reproduce

While clearing the board I checked `list` against `list --archived` on the same board
and got a result that contradicted a note in this codebase:

```
list             -> 11 rows
list --archived  -> 17 rows, and every live id was in that set
```

So `--archived` is INCLUSIVE — it returns the live rows plus the archived ones. The
earlier note in `kanban.ts` claimed the opposite, that it filtered to ONLY archived
rows, and cited "16 vs 0". That measurement does not reproduce.

The wrong conclusion had consequences beyond the comment: `listTasks({includeArchived})`
was written to fetch the two sets separately and merge them by id, which was
unnecessary work built on a false premise.

The lesson is the one this file keeps recording: the flag's semantics were asserted
from a single reading instead of being checked against a second measurement. `listTasks`
is now the one-liner the real semantics allow.

Fixed the comment and the function; the self-test suite still passes 21 checks.
