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

## A recurring lesson

Most entries below describe the same failure mode, and it is worth naming up front:
**a number was asserted from one reading instead of being checked against a second
measurement.** A chair modelled 9 cm taller than the avatar's legs could reach; a
label that never left the doorway because a three.js event does not fire on children;
a lane 1.8 m wide for a 1.8 m car. None were visible in a screenshot at normal zoom.

Where it was possible, the fix is a self-test that compares two numbers
(`npm run selftest`, 36 checks) rather than a comment asking the next person to be
careful.
