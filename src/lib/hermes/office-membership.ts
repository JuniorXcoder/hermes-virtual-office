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

/**
 * Profiles that are NEVER part of the office, no matter what.
 *
 * `default` is not a colleague — it is the install's own orchestrator profile,
 * living at the Hermes root (~/.hermes/config.yaml). It shows up in the assignee
 * list because the base profile owns housekeeping work, so without this it walked
 * onto the floor as an avatar, sat in the spawn panel, appeared in the chat list
 * and could be picked as a meeting participant. None of those are meaningful: you
 * cannot hire the building's own machinery.
 *
 * This is a CONSTANT, not an entry in `hidden`: the runtime hide list is cleared
 * by a restart (which is fine for a real colleague you hid by mistake) but `default`
 * must stay gone across restarts, and `show('default')` must not bring it back.
 */
export const BUILTIN_HIDDEN = new Set(['default'])

const hidden = new Set<string>()

/** Names currently removed from the office (runtime hides + the built-in ones). */
export function hiddenNames(): string[] {
  return [...new Set([...BUILTIN_HIDDEN, ...hidden])].sort()
}

export function isHidden(name: string): boolean {
  return BUILTIN_HIDDEN.has(name) || hidden.has(name)
}

/** Remove a profile from the office. Returns false if it was already gone. */
export function hide(name: string): boolean {
  if (isHidden(name)) return false
  hidden.add(name)
  return true
}

/** Bring a profile back. Returns false if it was not hidden. */
export function show(name: string): boolean {
  // A built-in exclusion cannot be undone from the UI. Without this guard the
  // "spawn" button would put `default` back on the floor and the bug would return.
  if (BUILTIN_HIDDEN.has(name)) return false
  return hidden.delete(name)
}

/** Filter a list of names down to those the office should show. */
export function visible<T extends { name: string }>(list: T[]): T[] {
  return list.filter((x) => !isHidden(x.name))
}

/** Filter a list of plain names, for the routes that only carry strings. */
export function visibleNames(list: string[]): string[] {
  return list.filter((n) => !isHidden(n))
}
