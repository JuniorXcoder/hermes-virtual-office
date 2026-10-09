# 🧭 Implementation Notes

Practical findings from building the office against a real Hermes install. Read
this before wiring the app to your own agent box — two of these will save you an
afternoon.

The notes are split by area. Each entry records a real bug or decision, what the
measurement showed, and what was changed; they are the reasoning behind the code,
not a changelog.

| File | What it covers |
|---|---|
| **[notes-backend.md](notes-backend.md)** | Bridging to Hermes: Kanban CLI, cron store, meetings, cross-menu links |
| **[notes-3d.md](notes-3d.md)** | The office itself: layout, collision, facade, seats, poses, textures, street |
| **[notes-product.md](notes-product.md)** | Interface decisions: what to show, hide, and confirm |

`README.md` is how to **use** the office; this file is how it **works** and where
it bites. For setup steps see `README.md` and
[`DEPLOYMENT.md`](DEPLOYMENT.md) (§7 A2A, §7.7 the Hermes-side contract); for the
endpoint surface see [`API-SPEC.md`](API-SPEC.md).

## A recurring lesson

Most entries below describe the same failure mode, and it is worth naming up front:
**a number was asserted from one reading instead of being checked against a second
measurement.** A chair modelled 9 cm taller than the avatar's legs could reach; a
label that never left the doorway because a three.js event does not fire on children;
a lane 1.8 m wide for a 1.8 m car. None were visible in a screenshot at normal zoom.

Where it was possible, the fix is a self-test that compares two numbers
(`npm run selftest`, 112 checks) rather than a comment asking the next person to be
careful.

---

## 1. A2A flow: office → gateway → destination profile

One A2A server, one path per agent. The gateway binds `127.0.0.1:9900` by default
(no token → loopback only, a safe default, not a bug); each served agent answers
`POST /<slug>` with JSON-RPC `message/send`. Both directions share one URL basis:
`peerBaseUrl()` in `src/lib/hermes/meeting-a2a.ts` (env `A2A_BASE_URL`, default
`http://127.0.0.1:9900`) feeds `a2aEndpoint()` used by the meeting runner
(`sendA2a()`) and by the peer entries (`peerEntryUrl()` in
`src/lib/hermes/kanban.ts`), so peers always point at the path the gateway
actually answers.

Three facts about served entries, all load-bearing:

- **`local` must be `false`.** With `local: true` the request is answered by the
  live gateway session, and the *wrong agent identity* comes back — a bug that
  looks like success until you read who answered. The office always writes
  `false`: `buildServedAgentEntry()` in `src/lib/hermes/a2a.ts` hard-codes it,
  and `upsertServedAgent()` in `src/lib/hermes/a2a-served.ts` documents the rule.
  Hermes side: `adapter.py::_prepare_task` forwards to the profile only when
  `local` is false; otherwise the gateway session answers. Doctor flags any
  `local:true` entry (`served` check in `src/lib/hermes/doctor.ts`).
- **The served list is read once at gateway boot.** Registering an agent only
  writes `~/.hermes/config.yaml`; nothing can call it until
  `hermes gateway restart`. Every mutating surface says so out loud: the
  `serve`/`unserve` response carries `a2aNote` ("...takes effect only after a
  gateway restart...") plus `needsGatewayRestart` (computed by `needsRestart()` from
  config mtime vs gateway start, `src/lib/hermes/doctor.ts`), and the doctor
  `restart` check reports it as a state, not a hint.
- **The office writes entries through its own API, never by hand-editing
  config.** `upsertServedAgent()` / `removeServedAgent()` in
  `src/lib/hermes/a2a-served.ts` back the config up first (timestamped
  `.bak-a2a3-*`), then splice only inside the `platforms: → a2a: → agents:`
  block — every other key is preserved byte-for-byte, no YAML dependency that
  could reformat unrelated keys.

The meeting path for mode `a2a`: `runA2a()` in `src/lib/hermes/meeting.ts`
(opening → cross-calls → minutes), one `message/send` per turn via `sendA2a()`.
Replies are read from `result.status.message.parts[].text` (`artifacts` only as
fallback — the server sends the same text in both, so merging them duplicates
every turn), transport noise lines (`Warning: ...`) are stripped by
`stripTransportNoise()`, and the conversation id comes from `result.contextId`.
Agent-to-agent relay is proven, not assumed: the header comment in
`meeting-a2a.ts` records the measured relay (jun → budi, `ctx-957f10df6e9346ce`).

## 2. Peers live in TWO scopes (global + profile) — and the toolset must be merged

Two independent gates decide whether agent B can call agent A, and each reads a
different scope:

1. **Name resolution** (`a2a_call("name")` → URL) reads `a2a_agents` entries.
   Without a peer, the call answers `unknown agent` — earlier "successful" hops
   only worked because the model fell back to a full URL. `ensureA2aPeer()` in
   `src/lib/hermes/kanban.ts` registers `<slug>-local → http://127.0.0.1:9900/<slug>`
   (`peerKeyFor()` / `peerEntryUrl()`), and meeting cross-prompts send the full
   URL too (`buildCrossPrompt()` in `meeting-a2a.ts`) so the call works even
   before peers propagate. Belt and suspenders, deliberately.
2. **Tool visibility** (does the `a2a_call` tool even appear in B's session?)
   reads the *profile scope* of the caller. Hermes' gate
   (`_a2a_tools_available` in `plugins/platforms/a2a/tools.py`, upstream) reads
   the session profile's config — writing a peer only globally leaves the tool
   missing. Proven live: mkt-1 reported "TOOL A2A_CALL TIDAK ADA" until the
   profile-scope peer was written.

So `ensureA2aPeer()` writes **both**: global, plus every *other* served profile's
scope (skipping self). `removeA2aPeer()` unwrites both on `kill`/`unserve`.
The doctor `peers` check verifies both scopes; self-repair re-adds whatever is
missing (`missingA2aPeer`, `src/lib/hermes/selfrepair.ts`).

The sibling rule: the caller's `platform_toolsets.cli` must **contain** `a2a` —
**merged, never overwritten**. `ensureA2aToolset()` in `kanban.ts` appends via
`mergeToolsetList()` (idempotent, read-back verified). Without it the agent is
callable but cannot call, and meetings only run one way. Doctor's `caller`
check (`canCall()` in `doctor.ts`) uses the *same* function self-repair uses —
one logic, two callers, so they cannot drift.

## 3. Profile config does NOT inherit global config (the provider trap)

A profile with `model.provider: custom:<name>` but no matching
`custom_providers` definition **in its own scope** dies at chat time with
`Unknown provider` — even though the model picker (which reads global
`custom_providers` via `listModels()`, `GET /api/hermes/models`) shows the
model green. "Has a model" and "can resolve its provider" are different checks;
the old doctor only ran the first.

The fix is copy-then-verify, in two places sharing one classifier:

- `setProfileModel()` in `src/lib/hermes/kanban.ts`: when the provider is a
  `custom:<name>` slug, the matching definition is copied from global config
  into the profile scope *before* the model is written (a crash between writes
  leaves the harmless case — unused definition — not the fatal one), then read
  back to prove it landed. An unknown provider name throws honestly without
  touching the profile.
- `ensureProviderDef()` in `kanban.ts`: same copy for profiles whose provider
  went dangling without a model change; driven by self-repair
  (`danglingProvider`).
- `classifyProviderScope()` in `src/lib/hermes/doctor.ts` is the shared
  verdict: non-custom → `ok`; custom with matching def → `ok`; custom without
  → `dangling` (fail + copy-paste fix); defs unreadable → `unknown`.

## 4. Self-repair loop: preview → run → doctor-after (idempotent)

`GET /api/hermes/selfrepair` previews only; `POST` runs then returns a fresh
doctor report (`src/app/api/hermes/selfrepair/route.ts`) so the operator sees
the *new* state, not the plan. Both go through `previewRepairs()` /
`runRepairs()` in `src/lib/hermes/selfrepair.ts`; the panel is
`src/components/DoctorPanel.tsx`.

What one run sweeps (each kind is a `RepairKind`):

| Kind | What | Writer reused |
|---|---|---|
| `staleServed` | served entries whose profile is gone | `removeServedAgent()` |
| `deadAvatar` | unspawned dummy rows naming a profile that no longer exists | `deleteAvatar()` |
| `dupAvatar` | one agent name on >1 row → keep canonical `agent:<name>`, adopt the visible position | `officeDb()` update + `deleteAvatar()` |
| `strayProfileDir` | leftover `profiles/<name>/` without `config.yaml` | `rm` after re-verify |
| `danglingProvider` | `custom:<name>` with no profile-scope definition | `ensureProviderDef()` |
| `missingA2aToolset` | profile callable-but-cannot-call | `ensureA2aToolset()` |
| `missingA2aPeer` | peer missing in global or in another served profile's scope | `ensureA2aPeer()` |

Two distinctions the code is careful about, because they are constantly mixed:

- **Key absent = knowable.** `profileToolsets()` returns `[]` when the
  `platform_toolsets` key is not set (all office-born agents start this way) —
  that is a *read* saying "cannot call", i.e. FAIL + planned fix, not a shrug.
  Only a real read failure (CLI error, timeout, unparseable output) returns
  `null` = `unknown`. Same split for peers (`{}` vs `null`) and provider defs.
- **Strict residue criteria.** A `profiles/<name>/` directory is swept only if
  it has no `config.yaml`; `.deleted` (Hermes' official tombstone) and any
  directory still containing `config.yaml` are never touched. Roster slots
  (`dummy:<division>:<n>` + placeholder name) are live seats, not corpses
  (`isRosterSlotId()` / `isLiveSlot()`). Run twice → second run changes
  nothing.

## 5. Honesty discipline: pass / fail / unknown, and never green on a guess

Three states everywhere (`DoctorStatus` in `doctor.ts`): `pass`, `fail`,
`unknown`. The rule, stated at the top of both `doctor.ts` and the system
panel: what cannot be established says "cannot be established" — never a green
light for "looks fine". Concrete applications:

- Unreadable provider defs, unreadable peer lists, unreadable toolsets →
  `unknown` with the cause, never `pass`.
- `needsRestart()` returns `null` (not `false`) when the gateway start time is
  unknown — "restart not needed" is a claim that requires knowing the start.
- "Needs restart" is a check with its own row (`restart`), fix
  `hermes gateway restart` — a visible state, not a dismissible toast. The
  serve/spawn responses carry it too (`needsGatewayRestart`).
- A missing profile on kill is `409 no_profile` ("nothing here"), not a failed
  delete; cancelling with no live meeting is `404 no_running_meeting`
  (`src/app/api/hermes/meeting/cancel/route.ts`), not fake success; a
  corrupted `jobs.json` surfaces as `cron_unreadable` 502, never as "no jobs"
  (`readJobList()` in `src/lib/hermes/cron.ts`, `CronPanel.tsx`).
- Meeting mode `a2a` with unserved participants is refused before starting,
  naming who (`missingServed()` / `formatReject()` in `meeting-a2a.ts`); a
  failed A2A turn is recorded `GAGAL + cause` (`failedTurnText()`), and the A2A
  path never calls the LLM synthesizer, so fabrication cannot sneak in
  silently.

## 6. Hermes-side contract (what the app relies on, and how to check it)

Behaviour of Hermes itself the app depends on. Each item states how to verify
it; [`DEPLOYMENT.md`](DEPLOYMENT.md) §7.7 is the operator-facing version and
[`patches/`](patches/) holds the re-appliable server-side patch.

1. **POST to an unknown agent path is REJECTED, not answered.** Needs
   `patches/hermes-a2a-unknown-path-404.README.md` applied to the Hermes
   install (Hermes v0.21.2 upstream answers via the default agent — a
   misleading report under the wrong name). Check with the curl probe in the
   patch README; doctor `fallthrough` probes it live
   (`fallthroughVerdict()`).
2. **GET to an unknown path is 404** — stock behaviour (`do_GET` in
   `plugins/platforms/a2a/adapter.py`), not part of the patch. Don't conflate
   the two when re-verifying after `hermes update` (the patch README says this
   explicitly).
3. **The served list is read once at gateway boot** (`_load_served_agents`
   runs in the adapter constructor, upstream `adapter.py`). New entries need
   `hermes gateway restart`.
4. **Served entries need `local: false`** (`_prepare_task`: only non-local
   agents are forwarded to their profile via `hermes chat`; local ones are
   answered by the gateway session).
5. **The A2A platform binds loopback without tokens** (safe default), and
   **peer resolution accepts names or full URLs** (`_resolve_peer` in upstream
   `tools.py` — the reason the meeting prompts send full URLs).
6. **The Kanban board has no HTTP surface the app may use.** The API server's
   route table (`_http_route_table` in `gateway/platforms/api_server.py`)
   exposes chat/runs/sessions/jobs/skills/toolsets — no board, no tasks, no
   profiles. The dashboard plugin's Kanban router needs cookie sessions the
   app deliberately will not forge. So the app drives the board through the
   official CLI (`hermes kanban ... --json`, isolated in
   `src/lib/hermes/kanban.ts`), which is the same surface the gateway's own
   `/kanban` command drives — it cannot silently drift from the board the
   agent sees. Trade-off, stated plainly: **the app must run on the same host
   as Hermes.** (Full story: `notes-backend.md` §1.)
7. **Cron job list has no `--json` mode** (`hermes cron list` offers only
   `--all`), so jobs are read from `$HERMES_HOME/cron/jobs.json` (stable shape,
   CLI-written) while *runs* come from `hermes cron runs` (`src/lib/hermes/cron.ts`).
   Writes go through the CLI so parsing/validation/locks stay its job.
   (Full story: `notes-backend.md` §22.)
8. **`hermes kanban list --archived` is INCLUSIVE** — live rows plus archived
   ones (measured 11 vs 17 on one board, every live id in the second set). An
   earlier comment in `kanban.ts` claimed the opposite from a single 16-vs-0
   reading; that reading does not reproduce, and the comment now records the
   correction. `listTasks({ includeArchived: true })` is the one-liner the real
   semantics allow. (Full story: `notes-backend.md` §31.)

## 7. Where data lives

| Data | Location | Notes |
|---|---|---|
| Office roster/avatar state | `data/office.db` (`OFFICE_DB_PATH` overrides; `src/lib/office/db.ts`, tables `avatar_state` + `office_meta`) | Local to the app; avatar rows are derived from board + profiles, desk assignment is computed, never stored |
| Meeting minutes + live state | `data/meetings/` (`DATA_DIR` overrides; `src/lib/hermes/meeting.ts`) | Filenames `YYYY-MM-DD-m<id>.md`; archives carry `- status: SELESAI` or `- status: DIBATALKAN` |
| Chat thread pointers | `data/chat-sessions.json` (`src/lib/hermes/chat.ts`) | Pointers only; history is re-read from the CLI |
| Control audit trail | `data/control-audit.jsonl` (`OFFICE_AUDIT_PATH` overrides; `src/lib/hermes/audit.ts`) | Tests must override the path, never write the real file |
| A2A transcripts | `<hermesHome>/a2a_conversations/ctx-<hash>.jsonl` + session export (`hermes -p <p> sessions export --source a2a`) | Read by `src/lib/hermes/a2a-transcript-server.ts`; each ctx line is doubled (two task_ids), deduped on read; kanban/telegram sessions calling `a2a_call` are *operator* context and deliberately excluded |
| Cron jobs (read) | `$HERMES_HOME/cron/jobs.json` | See §6.7 |
| Task origin links | `created_by` free text (`meeting:<id>`, `cron:<id>`, `agent:<name>`) | Parsed by `parseOrigin()` in `kanban.ts`; proposed first, created only on confirmation (`POST /api/hermes/tasks` batch shape) |

Pin the board: `HERMES_KANBAN_BOARD` in `.env.local` (see `.env.example`).
Without it the office follows the CLI's *active board*, a global other tools
move — the office once silently showed an empty board after it changed under
it (`notes-backend.md` §28).

## 8. Trap list (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| `Unknown provider` at chat, panel showed a model | `model.provider: custom:<name>` with no profile-scope `custom_providers` def (§3) | Re-pick the model in the Agent form (copies the def, read-back verified) or press "perbaiki" in Siap pakai? |
| Meeting runs one way only | Callee lacks `a2a` in `platform_toolsets.cli` and/or profile-scope peers — callable but cannot call (§2) | Self-repair (`missingA2aToolset` / `missingA2aPeer`), or serve again |
| Unknown agent path answered by the default agent | Hermes fallthrough: patch missing (often lost to `hermes update`) (§6.1) | Re-apply `docs/patches/` (`git apply --check`, `git apply`, curl probe, restart); doctor `fallthrough` tells you |
| Agent answers as the wrong profile | Served entry with `local: true` (§1) | Toggle serve again (office always writes `false`); doctor `served` flags it |
| New agent "cannot be called" though saved | Served list read once at boot (§1) | `hermes gateway restart`; the UI says "saved, not yet active" until then |
| Kill leaves tasks / names behind | Old behaviour; plus `carol`-style names (tasks, no profile) need different handling | Current `kill` purges tasks first, refuses while any is `running`/`review`, then deletes the profile + served entry + peers + avatar row + leftover dir (`POST /api/hermes/agents`, `action: "kill"`) |
| Stale served entries for deleted profiles | `kill` outside the app, or profile deleted by hand | Self-repair `staleServed`; doctor marks them BASI, never counts them ready |
| Duplicate avatar rows for one agent | Retried spawns creating rows | Self-repair `dupAvatar` (keeps `agent:<name>`); a name with no profile at all gets Sembunyikan (membership only), not Kill |
| Cron panel says "no jobs" though jobs exist | `jobs.json` unreadable — displayed as empty | Now `502 cron_unreadable` with the real error (`readJobList().failure`); "belum ada job" renders only when the read genuinely succeeded empty |
| Writes 403 from a real browser, reads fine | `local-guard.ts`: Origin≠Host or host not in `ALLOWed_ORIGINS` | Open via the same address; add host to `ALLOWED_ORIGINS` in `.env.local`, restart app. The 403 message names the fix |
| Chat send fails "cannot read session_id" | `session_id` arrives on **stderr**, answer on stdout (§6.6-adjacent) | Already handled in `chat.ts:cli()` — recorded so nobody "simplifies" it back to stdout-only |
| SSE-shaped replies fail every meeting turn | Gateway returns SSE frames (or glued `data: [DONE]`) though `stream` was never requested | `extractContent()` in `meeting.ts` handles all three shapes; `complete()` retries 429/5xx with backoff (`MEETING_TURN_*` envs) |
| Empty-body 405 on meeting start | A rewrite dropped the POST handler; TS cannot see a missing method | Self-test asserts each route's exported methods (`scripts/selftest.ts`) |
| Provider "down" hides orchestration bugs | Nothing to call, so nothing verified | `scripts/mock-provider.py` reproduces the awkward glued-`[DONE]` shape and counts calls — a clean stub would prove nothing |
| Office shows the wrong board (0 tasks) | Unpinned board follows CLI active board | `HERMES_KANBAN_BOARD=default` in `.env.local` (§7) |
| Meeting transcript shows agent voice twice | `status.message` and `artifacts` carry the same text | `parseSendResult()` reads message first, artifacts only as fallback |

## A recurring lesson, restated as a checklist

Before writing "X behaves like Y" in any doc here: measure twice (two
independent reads), record both numbers, and where possible add a self-test
that compares them (`scripts/selftest.ts`). The `--archived` correction (§6.8)
is what happens when this is skipped — including by the author of this file.
