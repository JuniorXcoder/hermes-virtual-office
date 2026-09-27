# Security Policy

## Reporting a vulnerability

Report security issues privately — please do not open a public issue for them.

Include what you can: the affected version or commit, a description of the
issue, and a minimal way to reproduce it. You will get an acknowledgement, and
an update if the report is accepted.

## What this project does with your credentials

This is worth stating plainly, because the app sits between a browser and a
machine that runs autonomous agents.

**The office does not hold or store any credential.** There is no database, no
session store, no user accounts. It reads and writes through the Hermes CLI on
the host it runs on, using whatever permissions that host already has.

Specifically:

- **Hermes keys live in `.env.local`** (gitignored, never committed) and are read
  server-side only. The meeting engine uses them to reach the configured model
  provider. They are never sent to the browser.
- **No credential is ever rendered into the page.** The office shows agent names,
  task titles, cron schedules and logs. If your workflow puts a secret in a task
  title or a log line, it will be displayed — that is the same data the CLI shows.
- **The browser never talks to the Hermes CLI directly.** All calls go through the
  Next.js route handlers in `src/app/api/hermes/`, which strip the agent-session
  markers before invoking the CLI and return only the fields the UI needs.

## Deploying it

**The office has no authentication.** Anyone who can reach the port can read the
board, create tasks, start meetings, create and delete cron jobs, and create or
delete agent profiles. That is the intended design for a local control surface,
and it is why the deployment docs put it behind a reverse proxy with TLS and, if
it is exposed beyond localhost, an auth layer.

Do not expose it to the public internet without putting authentication in front
of it. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Scope

In scope:

- Anything that leaks a secret to the browser or into a log
- Command injection through any field the UI sends to the Hermes CLI
- Path traversal in the meeting archive reader, which reads files under `DATA_DIR`

Out of scope:

- The absence of authentication (documented and intentional — see above)
- Vulnerabilities in the Hermes CLI, the model provider, or three.js
- Anything requiring an attacker to already have shell access to the host
