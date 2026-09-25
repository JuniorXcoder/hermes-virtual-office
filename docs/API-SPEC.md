# 📡 Hermes Virtual Office — API Specification

This document defines the REST endpoints, Server-Sent Events (SSE) protocol, and data schemas exposed by the Next.js backend.

---

## 1. Authentication & Headers

Requests between the browser client and Next.js backend are authenticated via standard session cookies or local bearer tokens.
Outbound requests from Next.js to Hermes Agent use:

```http
Authorization: Bearer <HERMES_API_KEY>
Content-Type: application/json
```

---

## 2. Server-Sent Events (SSE) Stream

### `GET /api/hermes/sync`

Establishes a persistent realtime event stream for office telemetry.

#### Connection
```http
GET /api/hermes/sync HTTP/1.1
Accept: text/event-stream
Cache-Control: no-cache
```

#### Event Payloads

##### 1. `initial_state`
Sent immediately upon connection with the current snapshot of all office entities.
```json
event: initial_state
data: {
  "agents": [
    {
      "name": "default",
      "displayName": "Orchestrator",
      "role": "orchestrator",
      "status": "running",
      "deskIndex": 0,
      "currentTaskId": "t_5ab8c0c8"
    }
  ],
  "tasks": [
    {
      "id": "t_5ab8c0c8",
      "title": "Build user auth endpoint",
      "status": "running",
      "assignee": "default",
      "priority": 1,
      "updatedAt": "2026-09-26T02:30:00Z"
    }
  ],
  "activeMeeting": null
}
```

##### 2. `task_updated`
Emitted whenever a task status or metadata changes.
```json
event: task_updated
data: {
  "taskId": "t_5ab8c0c8",
  "status": "review",
  "assignee": "risko",
  "reviewer": "lulu",
  "updatedAt": "2026-09-26T02:45:12Z"
}
```

##### 3. `agent_steer`
Emitted when a live tool call or console activity starts.
```json
event: agent_activity
data: {
  "agent": "default",
  "action": "executing_command",
  "detail": "npm test -- --coverage",
  "timestamp": 1790365022000
}
```

##### 4. `meeting_turn`
Emitted during an active meeting when an agent speaks.
```json
event: meeting_turn
data: {
  "meetingId": "m_17903604",
  "speaker": "risko",
  "role": "moderator",
  "round": 1,
  "text": "Mari kita bahas skema idempotency pada payment callback.",
  "timestamp": 1790365035000
}
```

---

## 3. Kanban Task Management

### `GET /api/hermes/tasks`
Lists tasks from the Hermes board with optional filtering.

#### Query Parameters
- `status` *(optional)*: `todo` | `ready` | `running` | `review` | `done` | `blocked`
- `assignee` *(optional)*: Agent profile name (e.g. `risko`)
- `limit` *(optional)*: Default `50`, max `200`

#### Response (`200 OK`)
```json
{
  "tasks": [
    {
      "id": "t_c108f582",
      "title": "Implement QRIS webhook handler",
      "status": "running",
      "assignee": "risko",
      "priority": 2,
      "body": "Ensure unique index on (invoice_id, callback_id).",
      "createdAt": "2026-09-26T01:00:00Z",
      "updatedAt": "2026-09-26T02:15:00Z"
    }
  ],
  "total": 1
}
```

---

### `POST /api/hermes/tasks`
Dispatches a new task into the Hermes Kanban queue.

#### Request Body
```json
{
  "title": "Write unit tests for refund idempotency",
  "assignee": "lulu",
  "priority": 1,
  "body": "Coverage threshold must be at least 90% across edge cases.",
  "parents": []
}
```

#### Response (`201 Created`)
```json
{
  "success": true,
  "task": {
    "id": "t_78a1bc23",
    "title": "Write unit tests for refund idempotency",
    "status": "ready",
    "assignee": "lulu"
  }
}
```

---

### `POST /api/hermes/tasks/[id]/steer`
Injects mid-flight guidance into a running agent task.

#### Request Body
```json
{
  "message": "Focus only on postgres schema tests, skip integration tests for now."
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "steered": true,
  "taskId": "t_78a1bc23"
}
```

---

## 4. Multi-Agent Meeting Protocol

### `POST /api/hermes/meeting/start`
Initiates a structured round-table discussion between agents.

#### Request Body
```json
{
  "topic": "Migrate database from MySQL to PostgreSQL without downtime",
  "participants": ["default", "risko", "lulu"],
  "moderator": "default",
  "mode": "auto",
  "maxRounds": 2
}
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `topic` | `string` | Yes | Subject of discussion (10-300 characters) |
| `participants` | `string[]` | Yes | Array of 2 to 4 agent profile names |
| `moderator` | `string` | No | Opening speaker. Defaults to first participant |
| `mode` | `string` | No | `auto` (round-robin), `directed`, or `manual` |
| `maxRounds` | `number` | No | Default `2`, maximum `3` |

#### Response (`200 OK`)
```json
{
  "meetingId": "meet_179036100",
  "status": "started",
  "participants": ["default", "risko", "lulu"],
  "moderator": "default",
  "mode": "auto"
}
```

---

### `GET /api/hermes/meeting/[id]`
Retrieves live transcript, speaker turn, and final synthesized minutes.

#### Response (`200 OK`)
```json
{
  "id": "meet_179036100",
  "state": "done",
  "phase": "minutes",
  "topic": "Migrate database from MySQL to PostgreSQL without downtime",
  "currentSpeaker": null,
  "turns": [
    {
      "round": 1,
      "speaker": "default",
      "text": "We need zero-downtime replication before switching connection strings."
    },
    {
      "round": 1,
      "speaker": "risko",
      "text": "Dual-write middleware is safer than logical replication across heterogenous engines."
    }
  ],
  "minutes": "## 🎯 Decisions\n- Use dual-write adapter pattern.\n\n## 📋 Action Items\n- Risko: Build migration adapter by Monday.\n\n## ⚠️ Risks\n- Partial rollback if target DB connection drops."
}
```

---

## 5. Direct & Group Chat

### `POST /api/hermes/chat`
Sends a direct message to one agent or broadcasts to the office group channel.

#### Request Body
```json
{
  "recipient": "risko",
  "channel": "dm",
  "message": "Can you check why the RouterOS NAT rule was deleted?"
}
```

#### Response (`200 OK`)
```json
{
  "messageId": "msg_8912739",
  "status": "sent",
  "timestamp": 1790365200000
}
```

---

## 6. Error Response Convention

All endpoints return uniform error envelopes:

```json
{
  "error": {
    "code": "agent_busy",
    "message": "Agent 'risko' is currently participating in an active meeting.",
    "status": 409
  }
}
```

| HTTP Code | Error Code | Meaning |
|---|---|---|
| `400` | `invalid_request` | Missing or malformed parameters |
| `401` | `unauthorized` | Missing or invalid API key |
| `404` | `not_found` | Task, meeting, or agent profile not found |
| `409` | `conflict` | Resource locked or agent already engaged |
| `503` | `upstream_unavailable` | LLM provider upstream error / timeout |
