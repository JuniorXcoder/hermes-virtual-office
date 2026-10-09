# 🗣️ Multi-Agent Meeting Protocol & Notulen Engine

> Specification for collaborative multi-agent discussions, turn management, rate-limiting, and structured minutes generation in **Hermes Virtual Office**.

---

## 1. Architectural Philosophy

Traditional AI multi-agent chats suffer from two common failure modes:
1. **Echo Chambers / Infinite Agreement**: Agents simply validate each other's opinions with pleasantries (*"Great point, I completely agree!"*).
2. **Upstream Rate-Limit Collapses**: Launching parallel prompts to all participating agents simultaneously floods LLM providers, resulting in `HTTP 503 / 429` errors and aborted tasks.

The **Hermes Meeting Protocol** solves this with:
- **Strictly Serialized Execution**: Agents speak one-by-one.
- **Role-Grounded Prompts**: Agents are instructed to debate technical invariants, challenge edge cases, and propose concrete schema/code solutions.
- **Hard Turn Budgets**: Capped at `2 rounds` (maximum 8-10 turns total).
- **Separated Synthesis Pipeline**: Meeting minutes are generated in an independent completion step, preventing context explosion during live debate.

---

## 2. Meeting Lifecycle

```
[UI Trigger] -> [Validate & Lock Participants]
                     |
                     v
             [Phase 1: Opening]
             Moderator sets the problem statement
                     |
                     v
             [Phase 2: Round 1 Discussion]
             Each participant states their thesis
                     |
                     v
             [Phase 3: Round 2 Cross-Debate]
             Participants address previous points by name
                     |
                     v
             [Phase 4: Synthesis / Minutes]
             Summarizer produces structured Markdown
                     |
                     v
             [Phase 5: Conclusion & Return]
             Chairs unlocked, agents return to desks/lounge
```

---

## 3. Turn Management & Modes

> **KOREKSI 2026-10-09: tabel `auto`/`directed`/`manual` di bawah ini BASI —
> tidak ada di kode** (`grep directed|manual src/` hanya kena kata "manual"
> yang artinya "by hand", bukan mode rapat). Mode yang benar-benar ada:
> `simulasi` (default, apa pun selain `a2a`) vs `a2a` — lihat §7. Tabel lama
> dibiarkan apa adanya supaya diff jujur, tapi JANGAN dipakai.

### Supported Modes

| Mode | Behavior | Ideal Use Case |
|---|---|---|
| **`auto`** *(Default)* | Round-robin sequence. Moderator opens, then Agent A, B, C speak in fixed order for 2 rounds. | General design review, sprint planning. |
| **`directed`** | Current speaker explicitly names the next respondent using `@AgentName`. | Technical debugging, root cause analysis. |
| **`manual`** | Speaker only responds when user or moderator directly pings them. | Q&A sessions, stakeholder demos. |

### Turn Budget & Timing

- **Maximum Participants**: 4 agents (optimal for low latency and focused discussion).
- **Turn Limit**: 10 turns maximum per meeting session.
- **Turn Timeout**: 60 seconds per agent turn.
- **Visual Bubble Duration**: Calculated dynamically based on text length:
  $$\text{Duration (ms)} = \min(14000, \max(4000, \text{length} \times 60))$$

---

## 4. Prompt Engineering & System Instructions

### Meeting Participant System Prompt

```jinja
You are {{agent.name}}, an expert autonomous engineer participating in a technical meeting.

MEETING TOPIC: {{meeting.topic}}
PARTICIPANTS: {{meeting.participants}}
CURRENT ROUND: {{meeting.round}} of {{meeting.maxRounds}}

RULES:
1. Be direct, dense, and pragmatic. Strip filler greetings ("Good morning team", "I agree with everyone").
2. Focus on technical trade-offs: data consistency, failure modes, race conditions, latency, and operational cost.
3. If disagreeing with another agent, cite their name and specific technical argument directly (e.g. "Bob's unique index does not prevent cumulative over-refunds").
4. Propose concrete implementation primitives: column names, locking mechanisms, SQL constraints, or HTTP retry semantics.
5. Keep your response under 100 words.
```

### Auto-Notulen (Minutes) Synthesis Prompt

```jinja
Synthesize the meeting transcript below into structured, actionable engineering minutes.

TOPIC: {{meeting.topic}}
TRANSCRIPT:
{{meeting.full_transcript}}

OUTPUT FORMAT:
## 🎯 KEPUTUSAN (Decisions)
- State agreements reached. If no consensus was reached, explicitly write "Belum ada kesepakatan final" and list the competing options.

## 📋 TINDAK LANJUT (Action Items)
- Bullet points formatted as: **[Owner]**: [Specific verifiable deliverable] — [Deadline / Milestone]

## ⚠️ RISIKO & MITIGASI (Risks)
- Technical or operational risks identified during debate and agreed mitigations.
```

---

## 5. Visual 3D Synchronization

During an active meeting, the 3D scene engine enforces visual realism:

1. **Seating Anchor**:
   - Meeting table center at `(-8.5, 0, 2.0)`.
   - 4 chair positions calculated via radial distribution:
     $$x_i = -8.5 + \cos(\theta_i) \times 2.2, \quad z_i = 2.0 + \sin(\theta_i) \times 2.2$$
   - Agents move along waypoints to their designated chair before Phase 1 begins.

2. **Speaking Gestures**:
   - The active speaker tilts their torso slightly forward (`chest.rotation.x = -0.07 rad`).
   - The right arm gestures forward/upward (`shoulder.rotation.x = -1.6 rad`) with subtle periodic wrist oscillation.
   - Non-speaking avatars rotate their heads toward the speaking avatar's position.

3. **Speech Bubble Rendering**:
   - Generated via Three.js `CSS2DObject` positioned 2.3 units above the avatar's root position.
   - Plain text only (HTML tags stripped to prevent XSS and raw tag rendering).
   - Styled with backdrop blur, subtle green glow, and directional speech tail pointing to the avatar's head.

---

## 6. Storage & Audit Trail

All completed meetings are archived persistently on the host:
- **Location**: `/data/meetings/{YYYY-MM-DD}-{meeting_id}.md`
- **Metadata Log**: Stored in SQLite table `meeting_sessions` containing:
  - `id`: Unique meeting ID
  - `topic`: Discussion topic
  - `participants`: JSON array of agent names
  - `turn_count`: Total turns executed
  - `duration_seconds`: Total elapsed time
  - `minutes_markdown`: Generated minutes text

> **KOREKSI 2026-10-09 (terbukti via grep): tabel `meeting_sessions` TIDAK ADA
> di kode** — `grep -rn meeting_sessions src/` nol hasil. Yang benar: arsip =
> berkas markdown di `DATA_DIR/meetings/` + cache in-memory (`listArchived` /
> `readArchived` di `src/lib/hermes/meeting.ts`). `DATA_DIR` default
> `<repo>/data` (`process.env.DATA_DIR || path.join(process.cwd(), 'data')`).
> Daftar di bawah (§7–§11) mendokumentasikan perilaku yang benar-benar ada.

---

## 7. Dua mode dan bedanya, tanpa eufemisme

`MeetingMode = 'auto' | 'simulasi' | 'a2a'` (`src/types/hermes.ts`).
`normalizeMeetingMode` (`src/lib/hermes/meeting-a2a.ts`): `raw === 'a2a' ?
'a2a' : 'simulasi'` — `auto` = alias lawas → `simulasi`, sampah → `simulasi`.

| Mode | Yang bicara | Syarat | Tanpa syarat |
|---|---|---|---|
| `simulasi` (default) | LLM gateway (`AI_BASE_URL`/`AI_API_KEY`, `complete()` di `meeting.ts`) — **BUKAN agent** | provider terisi, kalau tidak start menjawab `not configured` | — |
| `a2a` | agent nyata via protokol A2A (`sendA2a` → `message/send` ke `A2A_BASE_URL/<slug>`, default `http://127.0.0.1:9900`) | **setiap peserta harus di-serve** | rapat **DITOLAK** — `missingServed` + `formatReject` menyebut SIAPA + langkahnya (`src/lib/hermes/meeting.ts` `startMeeting`, `src/lib/hermes/meeting-a2a.ts`) |

Teks penolakan (verbatim dari `formatReject`):
`rapat A2A tidak dimulai — belum di-serve A2A: <nama>. Nyalakan toggle A2A di
form Agent untuk tiap nama itu, lalu restart gateway (daftar served-agent
dibaca sekali saat boot).`

Arsip menyimpan modenya (`- mode: a2a — …` / `- mode: simulasi — …`) supaya
rapat lama bisa dibedakan; berkas lama tanpa baris mode terbaca sebagai
`auto` (era teater, tak diketahui). Batas: `MAX_PARTICIPANTS = 4`,
`MAX_TURNS = 10` (default, via `MAX_MEETING_TURNS`), timeout giliran simulasi
120 s / A2A 280 s, retry upstream 3× (`meeting.ts` konstanta).

---

## 8. Mekanisme giliran silang (mode a2a)

1. **Ronde pembuka** (`runA2aOpening`): kantor memanggil tiap peserta lewat
   A2A (`baseUrl/<slug>`) dengan topik; pernyataan dicatat verbatim + `ctx`-nya.
2. **Ronde silang** (`runA2aCross`): kantor meminta pembicara S (lewat A2A)
   mengirim poinnya ke peserta berikutnya T memakai **`a2a_call` milik S
   sendiri**, lalu S melaporkan balasan T verbatim. Tiap giliran silang = hop
   agent→agent nyata, bukan kantor yang memerantarai.
3. **URL penuh dikirim, bukan cuma nama** (`buildCrossPrompt` di
   `meeting-a2a.ts`): prompt memerintahkan `Panggil dengan agent "<nextUrl>"`
   — `a2aEndpoint(peerBaseUrl(), next)` — karena `a2a_call` menerima URL
   langsung tanpa bergantung pada entri peer di config pemanggil (pelajaran
   RAPAT-A2A-2: hop "berhasil" kemarin cuma kebetulan model jatuh ke URL).
   Peer `<slug>-local` tetap didaftarkan juga (`ensureA2aPeer`) supaya nama
   pun resolvable — dua jalur.
4. **Notulen** (`runA2aMinutes`): moderator — agent nyata, lewat A2A —
   menyusun dari transkrip. Gagal = notulen darurat yang bilang gagal + "baca
   transkrip mentah", bukan karangan.
5. **`ctx-*` bisa diperiksa**: tiap giliran menyimpan `ctx`
   (`result.contextId`); arsip menulis `- ctx: ctx-…, ctx-…` + `[ctx-…]` per
   baris giliran; `GET /api/hermes/meeting` mengembalikan `ctxIds` per arsip;
   percakapan mentahnya di panel A2A (`GET /api/hermes/a2a/transcript`,
   `a2a_conversations/ctx-*.jsonl`).

---

## 9. Cabang TOLAK dan cabang GAGAL

- **TOLAK (start)**: peserta bukan agent A2A → rapat TIDAK DIMULAI, sebut
  siapa + langkahnya (§7). Lapisan route (`POST /api/hermes/meeting`) juga
  menolak duluan: nama tak dikenal disebut persis (`400`, mode a2a memakai
  teks serve-reject yang sama); `<2` peserta dikenal → `400 pilih minimal 2
  peserta yang dikenal`; satu rapat sudah jalan → `409 meeting_failed`
  (`masih ada rapat yang berjalan` — TIDAK antre).
- **GAGAL (giliran)**: `sendA2a` gagal (HTTP, timeout, format) = throw →
  pemanggil mencatat giliran `kind: 'failed'` + sebab nyata
  (`failedTurnText`: `GAGAL: <sebab> — giliran ini bukan karangan LLM dan
  tidak digantikan.`). **Tidak pernah diisi karangan** — jalur A2A tidak
  memanggil `complete()`, jadi karangan tidak mungkin terjadi diam-diam.
  Balasan kosong / bukan format `message/send` = throw dengan sebab yang
  sama. Noise transport (`Warning: Unknown toolsets: a2a`) dibuang barisnya
  (`stripTransportNoise`); teks diambil dari `result.status.message.parts[].text`
  (+ `artifacts` hanya sebagai cadangan bila message kosong — digabung
  keduanya dulu bikin tiap giliran duplikat verbatim, sudah diperbaiki).

---

## 10. Membatalkan rapat (`POST /api/hermes/meeting/cancel`)

`cancelMeeting(id?)` (`meeting.ts` 589–609) + route
(`src/app/api/hermes/meeting/cancel/route.ts`). Tanpa id = rapat yang memegang
slot eksekusi. Jujur tiga arah (semua ter-probe, lihat API-SPEC §22):
`200 cancel_requested` · `200 already_cancelled` (idempoten) ·
`404 no_running_meeting`.

- Berhenti di **batas giliran**: flag `cancelRequested` dibaca SEBELUM giliran
  berikutnya dimulai — giliran yang sedang berjalan diselesaikan dulu (fetch
  A2A tidak dibunuh di tengah), runner berhenti sesudahnya. Tidak pernah di
  tengah tulis arsip (`finalizeCancelled` hanya dipanggil dari batas giliran).
- Arsip bertanda **DIBATALKAN** (bukan selesai) + menyebut berhenti di giliran
  ke-N: `- status: DIBATALKAN — rapat dihentikan operator setelah ${doneCount}
  giliran berjalan; giliran berikutnya TIDAK dijalankan dan TIDAK dikarang`.
  Notulen diganti penanda batal ("bukan rapat selesai, tidak ada kesepakatan
  yang bisa dikutip dari sini"); rapat batal di tengah = TIDAK ada notulen
  utuh (tidak minta moderator menyimpulkan rapat separuh — itu karangan
  berkedok notulen).
- Giliran yang tidak jalan **tidak dihapus tanpa jejak**: transkrip hanya
  berisi giliran yang sempat berjalan + baris `**sistem** (minutes):
  Rapat dibatalkan — arsip bertanda DIBATALKAN.`; risiko memperingatkan
  "jangan mengutip beyond itu". `state` akhir = `cancelled`
  (`MeetingState`, `src/types/hermes.ts`); antrean 0-giliran difinalisasi
  langsung supaya operator tak menunggu runner yang tak kunjung mulai.

---

## 11. Di mana arsip & notulen hidup, dan arti tiap keadaan

- **Lokasi**: `DATA_DIR/meetings/{YYYY-MM-DD}-{meeting_id}.md` (default
  `DATA_DIR = <repo>/data`). Format: `# <topik>`, baris `- peserta:`,
  `- pembawa acara:`, `- mode:`, `- giliran:`, `- status:`,
  `- ctx:`, lalu `## Transkrip` (baris `**pembicara** (kind rN)[ctx]: teks`,
  giliran gagal berlabel `[GAGAL — bukan karangan LLM]`), lalu notulen.
- **Dibaca**: `GET /api/hermes/meeting` → `archived[]` (`{ id, topic,
  startedAt, participants, moderator, mode, turnCount, preview, archived: true,
  cancelled, ctxIds }`, terbaru dulu, toleran: berkas rusak = field lebih
  sedikit, satu berkas buruk tak mengosongkan daftar) dan
  `GET /api/hermes/meeting?id=<id>` → `{ id, body }` verbatim
  (`404` bila tak ada di disk). `GET /api/hermes/meeting/actions?from=<id>`
  mem-parsing `## TINDAK LANJUT` jadi kandidat task (proposal — tidak menulis).
- **Keadaan**: `queued` (menunggu slot) · `running` · `done` (arsip
  `- status: SELESAI`) · `cancelled` (arsip DIBATALKAN, §10) · `error`
  (crash + baris `Rapat gagal: <sebab>`) · `idle`. Live = peta in-memory
  (`meetings`, hilang saat restart — transkrip di disk tetap ada).
- **Contoh nyata**: `data/meetings/2026-10-08-m1791493240559.md` — rapat a2a
  `jun, mkt-1`, `giliran: 3`, `status: DIBATALKAN — … setelah 3 giliran`,
  `ctx: ctx-e2bf96df…, ctx-f58f3d86…, ctx-84e120f8…`.
