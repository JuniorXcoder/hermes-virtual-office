/**
 * Office membership: which Hermes profiles appear in the 3D office.
 *
 * The office is driven by the assignee list, so every profile would otherwise be
 * in the room at once. This module adds a kill-list on top: a profile that is
 * killed stops being returned (its avatar walks out and despawns), and spawning it
 * brings it back in through the front door.
 *
 * Killed names live in memory for the life of the server process. That is a
 * deliberate trade: persisting it would mean writing office state into the Hermes
 * install, which this app otherwise never does. A restart restores the default
 * (everyone visible). Documented in docs/API-SPEC.md.
 */

const killed = new Set<string>()

/** Names currently removed from the office. */
export function killedNames(): string[] {
  return [...killed].sort()
}

export function isKilled(name: string): boolean {
  return killed.has(name)
}

/** Remove a profile from the office. Returns false if it was already gone. */
export function kill(name: string): boolean {
  if (killed.has(name)) return false
  killed.add(name)
  return true
}

/** Bring a profile back. Returns false if it was not killed. */
export function spawn(name: string): boolean {
  return killed.delete(name)
}

/** Filter a list of names down to those the office should show. */
export function visible<T extends { name: string }>(list: T[]): T[] {
  return list.filter((x) => !killed.has(x.name))
}
