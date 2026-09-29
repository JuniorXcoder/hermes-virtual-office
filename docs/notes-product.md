# Produk & UI

Decisions about the interface: what to show, what to hide, and what the user
must confirm before anything irreversible happens.

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

`meeting-engine.ts` (now `lib/hermes/meeting.ts`) fell back to a provider-specific key variable named after the
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
GET /tasks              -> agents: budi, default, bob, carol
create budi (again)     -> 400 'profil "budi" sudah ada'
create "Budi Dua"       -> 400 name-format error
kill budi               -> office: default, bob, carol
spawn budi              -> office: budi, default, bob, carol
```

The probe profiles were deleted afterwards; `~/.hermes/profiles` is back to the
original two.

---

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

---

## 23. Helper text removed, and the two kinds that were kept

Removed every explanatory blurb from the UI:

- "Profil dibuat kosong (tanpa model/kunci) dan langsung masuk kantor. Tidak
  meng-clone kredensial profil lain." (Agent panel)
- "Spawn dan kill mengubah keanggotaan kantor saja — tugas agent tidak dihapus…"
  (Agent panel — and it was wrong: at the time that text was written, `kill`
  deleted the profile and purged its tasks. The membership-only path is now the
  separate `hide` action, and the panel says so.)
- "format: 30m, every 2h, atau cron 0 9 * * *" (Cron panel — the placeholder
  already shows all three)
- The 3D control legend ("seret = putar · scroll = zoom · …") and its CSS.
- Explanatory clauses in placeholders: "nama (huruf kecil, mis. budi)" became
  "budi", "deskripsi (opsional) — dipakai router kanban" became "deskripsi", and
  so on. Examples stay, explanations go.

Two kinds of text were deliberately kept, because removing them would hide
something the user needs at the moment they need it:

1. **Warnings that gate an action.** The meeting panel still says the LLM is not
   configured when it is not — without it the start button is disabled for no
   visible reason.
2. **Results of an action.** "Arahan terkirim ke worker.", "Dibuat: t_…", and the
   error messages. These are feedback, not explanation, and they appear only after
   something happened.

The distinction is the point: helper text tells you how the system works, feedback
tells you what it just did. The first is clutter once you know it; the second is
never safe to remove.

Everything reasoned above was also removed from the CSS (`.vp-hint`, `.vp-hint kbd`,
and its media-query rule) so no dead rules remain.

---

---

## 25. One collapsible block, applied everywhere

Long output — worker logs, transcripts, minutes, task bodies, run history, cron
prompts — rendered straight into its panel. A single chatty log pushed everything
else off screen and the panel became one wall of monospace.

There is now one `Collapsible` component, used in eight places:

| Panel | Collapsed by default |
|---|---|
| Task | Uraian, Log worker |
| Peek (screen) | Log terakhir (open), Riwayat run |
| Meeting | Transkrip (open while live), Notulen (open), archived transcript (open) |
| Cron | Prompt |

### `<pre>`, not `<textarea>`

The request was for a textarea, and that is what the look needed — a fixed-height
scrolling block of monospace. The element is a `<pre>`: this is read-only output,
and a textarea would add a focus ring, a blinking caret, spellcheck squiggles and
text-selection quirks for no benefit. What was wanted was the appearance, so the
appearance is what was built.

### Two things that make long text behave

- `overflow-wrap: anywhere` in addition to `pre-wrap`. Worker logs contain long
  unbroken tokens — absolute paths, base64, URLs — and `pre-wrap` alone lets those
  widen the panel instead of wrapping.
- `max-height: 380px` with `overflow: auto`, so an enormous log scrolls inside its
  own box rather than making the whole panel enormous.

### Structured content keeps its markup

`Collapsible` takes either `text` (rendered in a `<pre>`) or `children`. The meeting
transcript needs its own markup — one styled block per speaker, with the current
speaker highlighted — and forcing that into a monospace string would have lost it.
Collapsing a section should not change what the section is.

The first attempt did exactly that: it rendered the live transcript twice, once as
plain text and once as structured turns. Replaced with a single `children` usage.

---

## 26. Why a task sat in `ready` and nothing happened

`ready` is not a state the board runs. It means "a worker may take this" — the
dispatcher that actually spawns workers lives in the **gateway**, not in the office
app. Two consequences the UI had no answer for:

1. With the gateway down, every `ready` task sat there forever. The board looked
   healthy, the diagnostics only said `stranded_in_ready`, and nothing in the office
   explained why or offered a way out.
2. Even with the gateway up, a click could not ask for "this one, now".

So the task panel gained a **Jalankan** button (`POST /api/hermes/tasks/{id}` with
`action: "run"`): it lifts a parked task (`blocked`/`scheduled`, which the
dispatcher ignores entirely), then runs ONE dispatcher pass
(`hermes kanban dispatch --max 1`). The spawned worker is detached and outlives the
request, so the panel does not hold a connection open for a job that runs for
minutes.

`--max 1` matters: without it, one click on a six-task backlog spawns six workers
at once.

### The gateway has to be able to start

A gateway that dies at startup takes the dispatcher with it, and the failure is
invisible from the office. The concrete cause here: `WHATSAPP_ENABLED=true` with no
paired session is a **non-retryable startup conflict** (`exit 78/CONFIG`), so the
whole gateway refused to boot — cron never fired either. Commenting the flag out in
`~/.hermes/.env` and setting `platforms.whatsapp.enabled: false` let it come up.
`hermes gateway status` and `hermes cron status` are the two commands that show it.

### Model per agent, and per task

Two different scopes, both driven from the office:

| Scope | Where | CLI | Applies to |
|---|---|---|---|
| Profile default | Agent panel dropdown | `hermes -p <name> config set model.default` | that profile's workers and chats, unless overridden |
| One task | Task panel dropdown | `hermes kanban set-model <task> <model> --provider <p>` | the next spawn of that task |

Both catalogues come from `hermes config get custom_providers --json` (masked), so
the pickers cannot drift from `config.yaml`. The profile write stores the provider
**qualified** (`custom:9router`) because that is what `hermes model` writes; a bare
name is accepted by `kanban set-model` (its own resolver) but not by
`config set model.provider`.

---
