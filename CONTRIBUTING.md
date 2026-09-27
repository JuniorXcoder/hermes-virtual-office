# 🤝 Contributing to Hermes Virtual Office

Thank you for your interest in contributing to **Hermes Virtual Office**! This project is an open-source initiative to visualize and orchestrate autonomous AI agent workflows.

---

## Code of Conduct

We are committed to providing a welcoming, constructive, and inclusive environment. Treat everyone with respect, focus on technical merits, and help newcomers onboard smoothly.

---

## Getting Started

### Local Development Setup

1. **Fork and Clone**:
   ```bash
   git clone https://github.com/<your-username>/hermes-virtual-office.git
   cd hermes-virtual-office
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment for Development**:
   ```bash
   cp .env.example .env.local
   ```
   Set at minimum `HERMES_BIN` to your `hermes` executable — the board is read
   through its CLI, so the office cannot run without it. Meetings are optional:
   leave the `AI_*` variables unset and the 3D office still works, while starting a
   meeting returns a clear "not configured" error instead of failing halfway.

   `npm run selftest` needs no configuration at all: it only asserts geometry and
   reachability invariants.

4. **Start the Dev Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to see the hot-reloading office.

---

## Architectural Principles

1. **Adapter-First**: Any interaction with external agent frameworks must pass through an interface in `src/types/hermes.ts`. Never hardcode raw endpoint URLs directly inside UI components.
2. **Three.js Encapsulation**: Keep 3D scene code isolated inside `src/components/office3d/`. React components should interface with the 3D world via standard event handlers and state hooks.
3. **TypeScript Strictness**: No implicit `any`. All API requests and responses must validate against typed interfaces.
4. **Clean Asset Management**: Avoid heavy 3D GLTF files unless optimized. Prefer procedural low-poly geometries (`BoxGeometry`, `CylinderGeometry`) with stylized palette materials for high framerates across low-end GPUs and mobile browsers.

---

## Pull Request Guidelines

1. **Create a Feature Branch**:
   ```bash
   git checkout -b feat/add-meeting-recording
   ```
2. **Follow Commit Message Conventions**:
   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: Add interactive coffee machine prop`
   - `fix: Correct avatar orientation when walking west`
   - `docs: Update API specification for SSE payload`
   - `refactor: Modularize meeting turn manager`
3. **Run Checks Before Pushing**:
   ```bash
   npm run lint
   npm run build
   ```
4. **Submit PR**: Provide a clear description of changes, link related issues, and attach a screenshot/GIF if modifying visual components.
