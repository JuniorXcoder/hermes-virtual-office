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

**Hermes Virtual Office** transforms your autonomous AI coding agents into an interactive, living 3D office space. Instead of staring at dry terminal logs or static dashboard rows, watch your AI fleet work in real-time:

- 💻 **Engineers sit at workstations**, typing code with real matrix-style terminal displays.
- 🗣️ **Agents hold round-table meetings**, debate technical trade-offs, and generate structured markdown minutes.
- 🔍 **QA reviewers walk across the office** to review pull requests directly at developer desks.
- ☕ **Idle agents grab coffee**, relax on lounge sofas, or play darts when waiting for new tasks.
- 📋 **Integrated Kanban Board**: 100% synchronized with Hermes tasks, supporting instant dispatch and live task inspection.

Built with **Next.js**, **Three.js**, and **TypeScript**. It reads and drives your board through the official `hermes kanban` CLI, so it works against any local or remote Hermes install without a bespoke API layer.

---

## ✨ Key Features

### 1. Interactive 3D Low-Poly Office
- **8 Dedicated Workstations**: Structured in 4 facing pairs with monitor glow, status lights, coffee mugs, and dynamic role badges.
- **Dynamic Avatar State Machine**:
  - `idle`: Lounging, resting on sofas, walking around office zones.
  - `running`: Seated, focused typing animations, active monitor screens.
  - `meeting`: Seated at conference table with hand gestures and live speech bubbles.
  - `review`: Walking over to developer workstations to inspect commits.
  - `blocked`: Pacing with an alert indicator, signaling human help is needed.

### 2. Multi-Agent AI Meeting Room
- Trigger collaborative technical discussions between 2 to 4 agents on any topic.
- **Speech Bubbles & Gestures**: CSS2D floating speech bubbles synchronized with audio/text turns.
- **Auto-Generated Meeting Minutes**: Synthesizes discussions into clear markdown containing **Decisions**, **Action Items**, and **Identified Risks**.

### 3. Live Screen Peeking & Interventions
- Click on any active agent's monitor to open a **Live Terminal Modal**, viewing real-time commands, tool calls, and progress.
- Send course corrections or cancel stalled loops directly from the office interface.

### 4. Direct Chat with Memory

Talk to any agent from the office, with real memory: each agent has one thread, stored
in Hermes' own session store, so the conversation survives a restart of this app.
`hermes chat -q` answers and returns a session id; `--resume` continues it.

An agent and a profile are the same thing: talking to `jun` runs the `jun` profile
and stores the thread in its memory. The panel has a **+ Agent** button, which creates
a profile the same way the CLI does:

```bash
hermes profile create <name> --no-skills
```

Creating an agent this way gives it a 2 KB config. The install's own `default`
profile may carry a very large `system_prompt` sent on every message, so chatting
with a purpose-made agent is faster and cheaper.

### 5. Dual View Modes
- **3D Isometric Mode**: Full 3D camera controls, orbit, zoom, ambient day/night lighting.
- **2D Kanban Mode**: High-efficiency, accessible, mobile-friendly Kanban board for rapid management.

### 6. Talks to the Hermes CLI, not a private schema
- Drives the board through `hermes kanban ... --json`, the CLI's documented
  surface, rather than reading `kanban.db` directly. Board layout and database
  format can change without breaking this app.
- No database access, no vendored copy of Hermes internals.
- Ships a mock LLM provider (`scripts/mock-provider.py`) for testing meetings
  without spending tokens. It deliberately reproduces a misbehaving gateway's
  response shape, so tests fail loudly instead of passing on a well-behaved mock.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18.17+ or 20+
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

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🐳 Docker Deployment

Run with Docker Compose in a single command:

```bash
docker compose up -d
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production guidelines with Nginx/Traefik and SSL.

---

## 📐 Architecture

Hermes Virtual Office is designed with clean boundary layers:

```
┌────────────────────────────────────────────────────────┐
│                   Browser Client                       │
│    Next.js UI + Three.js 3D Isometric View + HUD      │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼─────────────────────────────┐
│                 Next.js App Server                     │
│  ├── /api/hermes/tasks        (board; POST = create)   │
│  ├── /api/hermes/tasks/{id}   (log tail; steer/cancel) │
│  ├── /api/hermes/meeting      (orchestrator + actions) │
│  ├── /api/hermes/agents       (spawn / kill profiles)  │
│  └── /api/hermes/cron         (jobs + actions)         │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
[Driver: Hermes API Server]     [Driver: Mock Preview]
  • OpenAI-Compatible :8642       • Offline Demo
  • Remote / Local                • UI Testing
```

Detailed architectural specifications are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 📐 Layout
![office room](docs/office%20room.png)

The floor is laid out as a real office: an enclosed glass meeting room (west), an
open-plan workstation bay under ceiling strips (centre), a lounge with sofa, TV
and pantry (east), and a corridor along the entrance that links them.

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
- The CLI refuses to run inside a delegated agent context; the bridge strips those
  environment markers for you.
- Some OpenAI-compatible gateways reply with SSE frames even when `stream` is not
  requested. The client tolerates plain JSON, SSE, and a glued `data: [DONE]` tail.

---

## ✅ Verifying a change

Two commands cover the invariants a screenshot cannot:

```bash
npm run typecheck   # types, including the layout and pose tables
npm run selftest    # 22 measured invariants
```

`npm run selftest` asserts what actually broke while this was built: the Kanban
board fits both its room and the ceiling, every window cut-out falls inside the
wall as built, no artwork is buried inside a wall, no furniture overlaps another
piece, the building is not walkable from outside, every seated pose plants the
avatar's feet on its seat, and no API reply can throw while being read.

Each of those was once a real bug that looked fine in a screenshot — which is why
they are numbers now. A chair modelled 9 cm taller than the avatar's legs could
reach, a label that never left the doorway, a lane 1.8 m wide for a 1.8 m car:
none were visible at normal zoom.

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
