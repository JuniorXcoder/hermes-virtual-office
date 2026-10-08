# 🏢 Hermes Virtual Office

<div align="center">

**An Open-Source 3D Virtual Workspace & Meeting Simulator for Autonomous AI Agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14+-black?logo=next.js)](https://nextjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r160+-orange?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Hermes Agent](https://img.shields.io/badge/Powered%20By-Hermes%20Agent-purple)](https://github.com/NousResearch/Hermes-Agent)

[Features](#-key-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Documentation](#-documentation) • [Contributing](#-contributing)

</div>

---

## 🌟 Overview

**Hermes Virtual Office** transforms your autonomous AI agents into an interactive, living 3D office. Instead of staring at dry terminal logs or static dashboard rows, watch your fleet work in real-time:

- 💻 **Every division has its own desks.** An agent with work at its desk *stops wandering* and goes to sit down.
- 🗣️ **Agents hold round-table meetings** in one of five named rooms, chosen by the participants' divisions.
- 🤝 **Agents talk to each other directly** over the A2A protocol — the caller's avatar walks over to the callee's desk, and the transcript is readable in the office.
- 🔍 **QA reviewers walk across the office** to inspect work at the owner's desk.
- ☕ **Idle agents relax** — pool, daybeds, gym, BBQ courtyard, lounge sofas, darts. An idle avatar never calls a model.
- 📋 **Integrated Kanban board**, 100% synchronized with Hermes tasks, plus approvals, evidence and independent verification.
- 📱 **Fullscreen panels on any screen size**, desktop or phone.

Built with **Next.js**, **Three.js**, and **TypeScript**. It reads and drives your
installation through the official `hermes` CLI — with one read-only exception, stated plainly
below — so it works against any local Hermes install without a bespoke API layer.

---

## ✨ Key Features

### 1. Interactive 3D Low-Poly Office

- **Three floors of real geometry**: ground-floor lobby, courtyard and one work room per division; an upper level carrying the CEO suite and five named meeting rooms; a walkable external stair linking them.
- **Three desks per division** — one manager, two staff — each with a monitor, status light and role badge.
- **The CEO suite** admits only a CEO or a division manager; everyone else is refused by the navigation grid, not by a visual trick.
- **Courtyard with four coherent zones**: gym (north), planting, daybeds (west), seats (south) and BBQ (east). The pool is swimmable; the daybeds are for lying on.
- **A duty state machine decides where a body belongs**, in this strict order:

  | Priority | Duty | Meaning |
  |---|---|---|
  | 1 | `meeting` | Participating in a live meeting |
  | 2 | `a2a` | In an agent-to-agent conversation — **stops desk work** |
  | 3 | `desk` | Has a task, a live chat, or a cron run at its desk |
  | 4 | `review` | Walking over to inspect someone else's work |
  | 5 | `idle` | Genuinely free — may relax |

  The order is the point: an agent that has work is never allowed to keep lounging. `review` and `idle` also never *preempt* real work; they only apply to a body that is otherwise free.
- **Idle avatars never call a model.** There is no chat bridge in the render path — verified by a self-test, because "cheap ambience" that silently burns tokens is not cheap.

### 2. Agent-to-Agent (A2A)

- **Discovery**: every served agent answers an A2A agent card, so callers can see what it is and what it can do before talking to it.
- **Direct calls between agents**, with conversation history that survives the office app restarting.
- **The transcript panel reads Hermes' own session store** — only sessions whose source is genuinely A2A. A human's chat that happens to mention a call is deliberately *not* read, so the two are never confused.
- **The caller's avatar walks to the callee's desk** while the conversation is live. If the peer has no desk, the trip is cancelled rather than sent to a place that does not exist.
- **Honest discovery**: asking "who owns this domain?" returns `null` when nobody owns it. The office displays that as-is and never invents an owner.
- **Loopback only.** The A2A server binds `127.0.0.1`; it is not reachable from the network.

### 3. Multi-Agent AI Meeting Room

- Trigger collaborative discussions between 2 to 4 agents on any topic.
- **Room routing by division** — a single division meets in its own room, an exec-heavy meeting takes another, and a cross-division meeting takes the ten-seat room. Rooms are not random.
- **Speech bubbles & gestures**: CSS2D balloons synchronized with the active speaker.
- **Auto-generated minutes** containing **Decisions**, **Action Items** and **Identified Risks**, with a parser stable enough to survive a heading rewrite.

### 4. Live Screen Peeking & Interventions

- Click any working agent's monitor to open a **live terminal modal** with the real commands, tool calls and progress.
- Send a course correction, or cancel a stalled loop, straight from the office.

### 5. Direct Chat with Memory, and a Model Picker

Talk to any agent from the office with real memory: each agent has one thread, stored in
Hermes' own session store, so the conversation survives a restart of this app.
`hermes chat -q` answers and returns a session id; `--resume` continues it.

An agent and a profile are the same thing: chatting with a profile runs that profile and
stores the thread in its memory. The **Agent** panel creates a profile the same way the CLI does:

```bash
hermes profile create <name> --no-skills
```

Each agent's **Description** becomes the text other agents see when they discover it, and
**Keahlian / domain** is a domain map used by the office to work out who owns what. That map
is deliberately *office-only* — it is not advertised over A2A, because what an agent can really
do is decided by its toolsets, not by a label.

The install's own `default` profile is hidden from the office and cannot be spawned back —
it is the profile the app itself runs under.

### 6. Command Control, Not Just a Pretty Dashboard

The office is meant to be where you *run* the fleet, so the controls refuse to lie to you:

- **A real approval queue.** What is waiting on a human decision is a queue, and a waiting
  approval stops the agent — it does not quietly keep going.
- **Evidence, not a checkmark.** A finished task's diff and artifacts can be inspected from
  the office. There are several real sources for that evidence, and "done ✓" alone is not one of them.
- **Claim ≠ verified.** Independent verification is a first-class state: a worker's own
  summary is not proof, and the reviewer's verdict is recorded as a trail that can be reopened
  when changes are requested.
- **Per-agent limits**, and **every refusal is audited.** A staff agent attempting a
  privileged action is refused *and* the refusal is written down.

### 7. Three View Modes, Fullscreen Panels, Mobile-Friendly

- **3D** isometric mode, an accessible **Kanban** board, and a low-cost **Sprite** mode for
  machines that should not render a full scene.
- Every top-bar control — **+ Tugas, Ruang rapat, Agent, Cron, Papan, Sistem, Chat, A2A** —
  opens a **fullscreen panel**, so a small screen gets the whole panel instead of a cramped drawer.
- The 3D / Kanban / Sprite switch is intentionally kept **outside** the scrolling button row,
  so the view choice never slides off a phone screen.
- Mobile viewport is handled honestly: `viewportFit: cover` plus safe-area insets, because
  without it a notched phone reports `env(safe-area-inset-*)` as `0` and the chat input ends up
  under the keyboard.

### 8. Talks to the Hermes CLI, not a private schema

- Drives the board through `hermes kanban ... --json`, and A2A history through
  `hermes sessions export --format jsonl --source a2a`, the CLI's documented surface, rather
  than reading `kanban.db` directly. Board layout and storage format can change without
  breaking this app.
- **One stated exception, because calling this "no database access" would be a lie:**
  the observability panel reads Hermes' `state.db` **read-only** (`node:sqlite`) for
  per-session token, cost and model figures, which the CLI has no surface for. Nothing
  ever *writes* to a Hermes database.
- **The office keeps its own store, separately** — office-only state (the office name, where
  each avatar was last standing, which division slots are still dummies) lives in the
  office's own SQLite file, not in Hermes' data.
- No vendored copy of Hermes internals.
- Ships a mock LLM provider (`scripts/mock-provider.py`) for testing meetings without
  spending tokens. It deliberately reproduces a *misbehaving* gateway's response shape, so
  tests fail loudly instead of passing on a well-behaved mock.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18.17+ or 20+
- A local Hermes install (the board is driven through its CLI)
- npm, pnpm, or bun

### 1. Clone the repository
```bash
git clone <this-repo-url>
cd hermes-virtual-office
```

### 2. Configure Environment
```bash
cp .env.example .env.local
```

Edit `.env.local` to configure your Hermes instance:
```env
# REQUIRED: path to the hermes executable (the board is driven through its CLI)
HERMES_BIN=/usr/local/bin/hermes

# Optional: pin a board, or set a CLI timeout
# HERMES_KANBAN_BOARD=default
# KANBAN_TIMEOUT_MS=20000

# LLM provider — only needed for meetings. The 3D office runs without it;
# starting a meeting returns a clear "not configured" error instead.
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_llm_key
AI_MODEL=gpt-4o-mini
```

Every variable in `.env.example` is read by the code — there are no decorative
settings. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what each drives.

### 3. Install & Run
```bash
npm install
npm run dev
```

`npm run dev` binds **http://127.0.0.1:3001** (dev only, loopback). For a production
build use `npm run build && npm start`, which serves on **http://127.0.0.1:3000**.

---

## 🐳 Docker Deployment

Run with Docker Compose in a single command:

```bash
docker compose up -d
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production guidelines with Nginx/Traefik and SSL.

---

## 📐 Architecture

The office is a thin UI over Hermes, with one server layer in between:

```
┌────────────────────────────────────────────────────────────┐
│                      Browser Client                        │
│        Next.js UI + 3D/Sprite scene + fullscreen panels    │
└───────────────────────────┬────────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼────────────────────────────────┐
│                  Next.js App Server                        │
│  board & tasks   /api/hermes/tasks[/{id}]                  │
│                  /api/hermes/tasks/{id}/evidence           │
│                  /api/hermes/tasks/{id}/verification       │
│                  /api/hermes/board · /approvals            │
│  agents          /api/hermes/agents · /models · /toolsets  │
│  meetings        /api/hermes/meeting[/actions]             │
│  agent-to-agent  /api/hermes/a2a/live · /a2a/transcript    │
│  operations      /api/hermes/cron[/actions] · /chat        │
│                  /api/hermes/control · /observability      │
│  scene           /api/hermes/office                        │
└───────────────────────────┬────────────────────────────────┘
                            │ CLI (hermes ... --json)
┌───────────────────────────▼────────────────────────────────┐
│                     Hermes installation                    │
│   kanban · chat sessions · profiles · cron · approvals     │
│   A2A server (loopback) → peer agents, incl. other offices │
│   state.db → read-only, token & cost panel only            │
└────────────────────────────────────────────────────────────┘
```

Detailed architectural specifications are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 📐 Layout

![office room](docs/office%20room.png)

The plan is a real building, and the navigation grid is generated from it:

- **Ground level** — lobby with the receptionist, a courtyard, and one work room per
  division (**Developer & Infrastructure**, **Marketing & SEO**, **Content Creator**),
  plus pantry, lounge and the courtyard's four zones.
- **Upper level** — the **CEO suite** and five named meeting rooms (**Bromo**, **Merapi**,
  **Semeru**, **Rinjani**, **Cikurai**), reached by an external stair the avatars walk up and
  down continuously — no teleporting, no dead end.
- Every enclosed room has a doorway that is open in **both** the model and the navigation
  grid, so nothing is walkable-only-on-paper.

![standby room](docs/standby%20room.png)
![new meeting](docs/new%20meeting.png)
![meeting room](docs/meeting%20room.png)

---

## ⚠️ Prerequisites you should know

- **Kanban is not exposed on the Hermes API server (`:8642`).** The board lives in
  the dashboard plugin on `:9119`, gated by dashboard-cookie auth. This app
  therefore drives the official `hermes kanban ... --json` CLI, which means **it
  must run on the same host as Hermes.** See
  [docs/notes-backend.md](docs/notes-backend.md) for the route-table evidence and the
  one-file seam (`src/lib/hermes/kanban.ts`) where an HTTP driver would slot in.
- **The A2A server binds loopback only**, and a served agent is registered with
  `local: false` so the *peer's own profile* answers. With `local: true` the call is
  handled by the gateway's live session instead and you get the wrong agent's identity
  back — a bug that looks like success until you read who replied.
- **Editing the served-agent list needs a gateway restart.** The list is read once at
  startup and there is no hot reload, so a newly toggled agent is not reachable until
  Hermes restarts. The UI says so rather than showing a green light that means nothing yet.
- The CLI refuses to run inside a delegated agent context; the bridge strips those
  environment markers for you.
- Some OpenAI-compatible gateways reply with SSE frames even when `stream` is not
  requested. The client tolerates plain JSON, SSE, and a glued `data: [DONE]` tail.

---

## ✅ Verifying a change

Two commands cover the invariants a screenshot cannot:

```bash
npm run typecheck   # types, including the layout and pose tables
npm run selftest    # 102 measured invariants
```

`npm run selftest` asserts what actually broke while this was built. It covers four kinds of
things, and each one was a real bug first:

- **Geometry and layout** — a chair modelled 9 cm taller than a seated avatar's legs could
  reach, every window cut-out falling inside the wall as built, no furniture overlapping
  furniture, every enclosed room reachable, the stair walkable in both directions, the pool
  not walkable because it is water.
- **Behaviour** — an idle avatar never calling a model, a spawned agent always getting a
  body, a walking body keeping its destination, duty priority holding (work beats rest).
- **The Hermes boundary** — chat CLI arguments matching the real profile/fresh/resume
  syntax, cron output parsing, junk query parameters falling back instead of reaching the
  CLI as `NaN`, every API route keeping the methods the UI actually calls.
- **Honesty of the panels** — an owner map returning `null` instead of inventing an owner,
  the transcript being read from the column that is really populated, model catalogue
  deduplication, and the "hide a profile" list being membership-only and reversible.

The numbers are the point: a lane 1.8 m wide for a 1.8 m car is invisible at normal zoom, so
it is a number now instead of an opinion.

CI runs typecheck, the self-test and a production build on every push, plus a
publish-hygiene job that fails if a private identifier or an authoring-machine
path reaches a published file.

---

## 📚 Documentation

- [System Architecture](docs/ARCHITECTURE.md) — Component map, the 3D coordinate contract, and how the server reaches Hermes.
- [API Specification](docs/API-SPEC.md) — REST endpoints, payloads, error codes, and server limits — described from the implementation.
- [Meeting Protocol](docs/MEETING-PROTOCOL.md) — Turn management, prompt guardrails, and the auto-notulen engine.
- [Production Deployment](docs/DEPLOYMENT.md) — Docker, systemd, reverse proxy, and hardening guides.
- [Security Policy](SECURITY.md) — What the office does and does not do with credentials, and the no-auth caveat.
- [Contributing Guidelines](CONTRIBUTING.md) — Code style, pull request workflow, and issue templates.

### Implementation notes

The reasoning behind the code, split by area. These record real bugs, what the
measurement showed, and what changed — not a changelog.

- [Index](docs/IMPLEMENTATION-NOTES.md) — start here.
- [Backend & Hermes integration](docs/notes-backend.md) — Kanban CLI, cron store, meetings, cross-menu links.
- [3D scene, layout & animation](docs/notes-3d.md) — footprint, collision, facade, seats, poses, textures, street.
- [Product & UI](docs/notes-product.md) — what to show, hide, and confirm.
- [Command-control plan](PLAN-command-control.md) — the staged plan from "nice office" to command control, and what it changed.

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

<div align="center">
Built with ❤️ for the <b>Hermes Agent</b> autonomous AI community.
</div>
