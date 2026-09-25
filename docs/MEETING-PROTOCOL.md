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
3. If disagreeing with another agent, cite their name and specific technical argument directly (e.g. "Lulu's unique index does not prevent cumulative over-refunds").
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
