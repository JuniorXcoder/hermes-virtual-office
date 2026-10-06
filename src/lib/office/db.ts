/**
 * Office database — the office's OWN store, separate from Hermes' kanban.db.
 *
 * Why a database at all: the office has state that outlives a page reload and
 * does not belong to Hermes' task board — the office NAME (editable from the 3D
 * lobby), where each avatar was standing and what it was doing last, which
 * division slots are still dummy avatars, and the Q&A threads between agents.
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
import type { AvatarKind, AvatarState, AvatarWrite, QaThread } from './types'

export type { AvatarKind, AvatarState, AvatarWrite, QaThread } from './types'

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
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qa_threads (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      asker        TEXT NOT NULL,
      responsible  TEXT NOT NULL,
      question     TEXT NOT NULL,
      answer       TEXT,
      status       TEXT NOT NULL DEFAULT 'open',
      created_at   TEXT NOT NULL,
      answered_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_qa_open ON qa_threads (status, responsible);
  `)
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
  updatedAt: r.updated_at,
})

export function listAvatars(): AvatarState[] {
  const rows = officeDb().prepare(`SELECT * FROM avatar_state ORDER BY division, name`).all() as AvatarRow[]
  return rows.map(toAvatar)
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
       (avatar_id, name, division, kind, x, z, level, activity, facing, spawned, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(avatar_id) DO UPDATE SET
       name = excluded.name, division = excluded.division, kind = excluded.kind,
       x = excluded.x, z = excluded.z, level = excluded.level,
       activity = excluded.activity, facing = excluded.facing,
       spawned = excluded.spawned, updated_at = excluded.updated_at`,
  )
  const ts = now()
  d.exec('BEGIN')
  try {
    for (const a of list) {
      stmt.run(
        a.avatarId, a.name, a.division, a.kind,
        a.x, a.z, a.level, a.activity, a.facing,
        a.spawned ? 1 : 0, ts,
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
    })),
  )
}

/* --------------------------------------------------------------------- qa -- */

type QaRow = {
  id: number
  asker: string
  responsible: string
  question: string
  answer: string | null
  status: string
  created_at: string
  answered_at: string | null
}

const toQa = (r: QaRow): QaThread => ({
  id: r.id,
  asker: r.asker,
  responsible: r.responsible,
  question: r.question,
  answer: r.answer,
  status: r.status as 'open' | 'answered',
  createdAt: r.created_at,
  answeredAt: r.answered_at,
})

export function listQa(): QaThread[] {
  const rows = officeDb()
    .prepare(`SELECT * FROM qa_threads ORDER BY status = 'answered', id DESC`)
    .all() as QaRow[]
  return rows.map(toQa)
}

export function askQuestion(asker: string, responsible: string, question: string): QaThread {
  const d = officeDb()
  const info = d
    .prepare(
      `INSERT INTO qa_threads (asker, responsible, question, status, created_at)
       VALUES (?, ?, ?, 'open', ?)`,
    )
    .run(asker, responsible, question.trim(), now())
  const row = d.prepare(`SELECT * FROM qa_threads WHERE id = ?`).get(Number(info.lastInsertRowid)) as QaRow
  return toQa(row)
}

/** Answering closes the thread — an open thread is the responsible's to-do (poin 12). */
export function answerQuestion(id: number, answer: string): QaThread | null {
  const d = officeDb()
  d.prepare(
    `UPDATE qa_threads SET answer = ?, status = 'answered', answered_at = ?
     WHERE id = ? AND status = 'open'`,
  ).run(answer.trim(), now(), id)
  const row = d.prepare(`SELECT * FROM qa_threads WHERE id = ?`).get(id) as QaRow | undefined
  return row ? toQa(row) : null
}

/** Open threads per responsible — the badge the UI shows. */
export function openQaCounts(): Record<string, number> {
  const rows = officeDb()
    .prepare(`SELECT responsible, COUNT(*) AS n FROM qa_threads WHERE status = 'open' GROUP BY responsible`)
    .all() as { responsible: string; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.responsible, r.n]))
}
