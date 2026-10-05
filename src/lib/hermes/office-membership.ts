/**
 * Office membership: which Hermes profiles appear in the 3D office.
 *
 * The office is driven by the assignee list, so every profile would otherwise be
 * in the room at once. This module adds a hide list on top: a hidden profile stops
 * being returned (its avatar walks out and despawns), and spawning it brings it
 * back in through the front door. The profile itself is never touched here — that
 * is the destructive `kill` action in the agents route.
 *
 * Hidden names live in memory for the life of the server process. That is a
 * deliberate trade: persisting it would mean writing office state into the Hermes
 * install, which this app otherwise never does. A restart restores the default
 * (everyone visible). Documented in docs/API-SPEC.md.
 */

const hidden = new Set<string>()

/** Names currently removed from the office. */
export function hiddenNames(): string[] {
  return [...hidden].sort()
}

export function isHidden(name: string): boolean {
  return hidden.has(name)
}

/** Remove a profile from the office. Returns false if it was already gone. */
export function hide(name: string): boolean {
  if (hidden.has(name)) return false
  hidden.add(name)
  return true
}

/** Bring a profile back. Returns false if it was not hidden. */
export function show(name: string): boolean {
  return hidden.delete(name)
}

/** Filter a list of names down to those the office should show. */
export function visible<T extends { name: string }>(list: T[]): T[] {
  return list.filter((x) => !hidden.has(x.name))
}
