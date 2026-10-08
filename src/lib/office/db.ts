/**
 * Office database — the office's OWN store, separate from Hermes' kanban.db.
 *
 * Why a database at all: the office has state that outlives a page reload and
 * does not belong to Hermes' task board — the office NAME (editable from the 3D
 * lobby), where each avatar was standing and what it was doing last, which
 * division slots are still dummy avatars.
 *
 * Why `node:sqlite`: this project has NO SQLite driver (every Hermes read goes
 * through the CLI), and Node 22 ships `DatabaseSync` built in. Adding
 * better-sqlite3 would mean a native build step for one table set. Everything
 * database-shaped is therefore funnelled through this one module, so swapping the
 * engine later touches exactly one file.
 *
 * SERVER ONLY. `node:sqlite` does not exist in the browser, so this module must
 * never be imported from a client component — the UI goes through
 * `/api/hermes/office`.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { AgentDivision } from '@/types/hermes'
import type { AvatarKind, AvatarState, AvatarWrite } from './types'

export type { AvatarKind, AvatarState, AvatarWrite } from './types'

/**
 * `data/` is inside the repo and already gitignored, so the file is portable
 * between machines without ever being committed. `OFFICE_DB_PATH` overrides it
 * for tests.
 */
const DB_PATH = process.env.OFFICE_DB_PATH ?? resolve(process.cwd(), 'data/office.db')

let db: DatabaseSync | null = null

/** Open (once) and migrate. Safe to call on every request. */
export function officeDb(): DatabaseSync {
  if (db) return db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const d = new DatabaseSync(DB_PATH)
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS office_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS avatar_state (
      avatar_id  TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      division   TEXT NOT NULL,
      kind       TEXT NOT NULL,
      x          REAL NOT NULL,
      z          REAL NOT NULL,
      level      INTEGER NOT NULL DEFAULT 0,
      activity   TEXT NOT NULL,
      facing     REAL NOT NULL DEFAULT 0,
      spawned    INTEGER NOT NULL DEFAULT 0,
      anchored   INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `)
  // Additive migrations for databases created by an earlier version.
  // `CREATE TABLE IF NOT EXISTS` does NOT add columns to a table that already
  // exists, so a new column needs its own ALTER — and it has to be guarded,
  // because SQLite has no `ADD COLUMN IF NOT EXISTS` and re-running would throw.
  const cols = new Set(
    (d.prepare(`PRAGMA table_info(avatar_state)`).all() as { name: string }[]).map((c) => c.name),
  )
  if (!cols.has('anchored')) {
    d.exec(`ALTER TABLE avatar_state ADD COLUMN anchored INTEGER NOT NULL DEFAULT 0`)
  }
  db = d
  return d
}

const now = () => new Date().toISOString()

/* ------------------------------------------------------------------ meta -- */

export const DEFAULT_OFFICE_NAME = 'Hermes Office'

/** The office name shown (and editable) in the lobby. */
export function getOfficeName(): string {
  const row = officeDb().prepare(`SELECT value FROM office_meta WHERE key = 'name'`).get() as
    | { value: string }
    | undefined
  return row?.value ?? DEFAULT_OFFICE_NAME
}

export function setOfficeName(value: string): string {
  const clean = value.trim().slice(0, 60) || DEFAULT_OFFICE_NAME
  officeDb()
    .prepare(
      `INSERT INTO office_meta (key, value, updated_at) VALUES ('name', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(clean, now())
  return clean
}

/* ----------------------------------------------------------------- avatars -- */

type AvatarRow = {
  avatar_id: string
  name: string
  division: string
  kind: string
  x: number
  z: number
  level: number
  activity: string
  facing: number
  spawned: number
  anchored: number
  updated_at: string
}

const toAvatar = (r: AvatarRow): AvatarState => ({
  avatarId: r.avatar_id,
  name: r.name,
  division: r.division as AgentDivision,
  kind: r.kind as AvatarKind,
  x: r.x,
  z: r.z,
  level: r.level,
  activity: r.activity,
  facing: r.facing,
  spawned: r.spawned === 1,
  anchored: r.anchored === 1,
  updatedAt: r.updated_at,
})

export function listAvatars(): AvatarState[] {
  const rows = officeDb().prepare(`SELECT * FROM avatar_state ORDER BY division, name`).all() as AvatarRow[]
  return rows.map(toAvatar)
}

/**
 * Hapus SATU baris avatar (`kill` membersihkan badan dari kantor).
 *
 * Id avatar agent = `agent:<nama>` (lihat syncAvatars di scene.ts:
 * baris sintetis memakai id itu). `default` tidak pernah punya baris —
 * false untuk nama itu adalah hasil sah, bukan error. Mengembalikan true
 * hanya bila sebuah baris benar-benar terhapus.
 */
export function deleteAvatar(avatarId: string): boolean {
  const clean = avatarId.trim()
  if (!clean) return false
  const r = officeDb().prepare(`DELETE FROM avatar_state WHERE avatar_id = ?`).run(clean) as { changes: number }
  return Number(r?.changes ?? 0) > 0
}

/**
 * Batch upsert. The scene calls this every few seconds for every avatar, so it
 * runs inside ONE transaction — a per-avatar round trip was measurably wasteful
 * and left the file open for longer than it needed to be.
 */
export function saveAvatars(list: AvatarWrite[]): number {
  if (!list.length) return 0
  const d = officeDb()
  const stmt = d.prepare(
    `INSERT INTO avatar_state
       (avatar_id, name, division, kind, x, z, level, activity, facing, spawned, anchored, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(avatar_id) DO UPDATE SET
       name = excluded.name, division = excluded.division, kind = excluded.kind,
       x = excluded.x, z = excluded.z, level = excluded.level,
       activity = excluded.activity, facing = excluded.facing,
       spawned = excluded.spawned, anchored = excluded.anchored,
       updated_at = excluded.updated_at`,
  )
  const ts = now()
  d.exec('BEGIN')
  try {
    for (const a of list) {
      stmt.run(
        a.avatarId, a.name, a.division, a.kind,
        a.x, a.z, a.level, a.activity, a.facing,
        a.spawned ? 1 : 0, a.anchored ? 1 : 0, ts,
      )
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return list.length
}

/* ---------------------------------------------------------------- seeding -- */

/**
 * The office ships with DUMMY avatars, not agents (poin 3 + 4): three per division
 * (one manager, two staff) plus a receptionist, all parked at their workstations.
 * They cost nothing — they are rows in this table and meshes in the scene, and no
 * model is ever called for them. Clicking one offers to spawn a REAL agent in its
 * place.
 *
 * Seeding runs once, when the table is empty, and is idempotent afterwards: a
 * dummy that has been spawned keeps `kind: 'agent'` and is never re-created.
 */
export type DummySpec = {
  avatarId: string
  name: string
  division: AgentDivision
  x: number
  z: number
  level: number
  activity: string
  facing: number
  /** Pinned in place forever — the receptionist never leaves the counter. */
  anchored?: boolean
}

export function seedAvatars(specs: DummySpec[]): number {
  const d = officeDb()
  const existing = d.prepare(`SELECT COUNT(*) AS n FROM avatar_state`).get() as { n: number }
  if (existing.n > 0) return 0
  return saveAvatars(
    specs.map((s) => ({
      avatarId: s.avatarId,
      name: s.name,
      division: s.division,
      kind: 'dummy' as const,
      x: s.x,
      z: s.z,
      level: s.level,
      activity: s.activity,
      facing: s.facing,
      spawned: false,
      anchored: !!s.anchored,
    })),
  )
}
