import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { XtreamAccount } from './xtream.ts'
import { MAX_POSITIONS, type PositionsData } from '../../shared/positions.ts'

// Data of one account. Every account has its own SQLite file under data/users/<id>/, picked per
// request with withUser(): the functions below never take a user id, they just read and write
// "the current account".

export const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data')
mkdirSync(dataDir, { recursive: true })

// What the phone keeps in the SharedPreferences "settings" (account, favorites) and in
// positions.json (positions, watched, lastEpisode), one table per part.
const schema = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (streamId INTEGER PRIMARY KEY NOT NULL);
CREATE TABLE IF NOT EXISTS positions (key TEXT PRIMARY KEY NOT NULL, p INTEGER NOT NULL, d INTEGER NOT NULL, u INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS watched (key TEXT PRIMARY KEY NOT NULL);
CREATE TABLE IF NOT EXISTS last_episode (seriesId INTEGER PRIMARY KEY NOT NULL, episodeId TEXT NOT NULL, u INTEGER NOT NULL);
`

// --- accounts: every account has its own database, picked per request -------------------------

type UserData = { id: number; db: DatabaseSync; cacheDir: string }

const opened = new Map<number, UserData>()
const current = new AsyncLocalStorage<UserData>()

export const userDir = (userId: number) => join(dataDir, 'users', String(userId))

function open(userId: number): UserData {
  const known = opened.get(userId)
  if (known) return known
  const dir = userDir(userId)
  const cacheDir = join(dir, 'cache')
  mkdirSync(cacheDir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'iptvision.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
  db.exec(schema)
  const data = { id: userId, db, cacheDir }
  opened.set(userId, data)
  return data
}

/** Runs [work] on the data of [userId]: every function of this module then reads and writes there. */
export function withUser<T>(userId: number, work: () => T): T {
  return current.run(open(userId), work)
}

export function closeUser(userId: number) {
  opened.get(userId)?.db.close()
  opened.delete(userId)
}

function user(): UserData {
  const data = current.getStore()
  if (!data) throw new Error('Nessun account attivo')
  return data
}

export const currentUserId = () => user().id

/** The database of the current account. */
export const db = {
  prepare: (sql: string) => user().db.prepare(sql),
  exec: (sql: string) => user().db.exec(sql),
}

/** Lists, guide and other files downloaded from the IPTV provider for the current account. */
export const cacheDir = () => user().cacheDir

export function clearCache() {
  for (const f of readdirSync(cacheDir())) rmSync(join(cacheDir(), f), { recursive: true, force: true })
}

// --- meta ------------------------------------------------------------------------------------

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(key: string, value: string | null) {
  if (value == null) db.prepare('DELETE FROM meta WHERE key = ?').run(key)
  else db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

/** Bumped on every change, so other devices can tell when to reload (GET /api/state?since=<revision>). */
export function revision(): number {
  return Number(getMeta('revision') ?? '0')
}

function touch() {
  setMeta('revision', String(revision() + 1))
}

export function transaction<T>(work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    touch()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

// --- IPTV account (the password never leaves the server) ---------------------------------------

export function xtreamAccount(): XtreamAccount | null {
  const server = getMeta('server')
  const username = getMeta('username')
  const password = getMeta('password')
  if (!server || !username || password == null) return null
  return { server, username, password }
}

export function setXtreamAccount(a: XtreamAccount | null) {
  transaction(() => {
    setMeta('server', a?.server ?? null)
    setMeta('username', a?.username ?? null)
    setMeta('password', a?.password ?? null)
  })
}

// --- favorites ---------------------------------------------------------------------------------

export function favorites(): number[] {
  return (db.prepare('SELECT streamId FROM favorites ORDER BY rowid').all() as { streamId: number }[]).map((r) => Number(r.streamId))
}

export function setFavorite(streamId: number, on: boolean) {
  transaction(() => {
    if (on) db.prepare('INSERT OR IGNORE INTO favorites (streamId) VALUES (?)').run(streamId)
    else db.prepare('DELETE FROM favorites WHERE streamId = ?').run(streamId)
  })
}

// --- positions ---------------------------------------------------------------------------------

export function positions(): PositionsData {
  const data: PositionsData = { positions: {}, watched: [], lastEpisode: {} }
  for (const r of db.prepare('SELECT key, p, d, u FROM positions').all() as { key: string; p: number; d: number; u: number }[]) {
    data.positions[r.key] = { p: Number(r.p), d: Number(r.d), u: Number(r.u) }
  }
  data.watched = (db.prepare('SELECT key FROM watched ORDER BY rowid').all() as { key: string }[]).map((r) => r.key)
  for (const r of db.prepare('SELECT seriesId, episodeId, u FROM last_episode').all() as { seriesId: number; episodeId: string; u: number }[]) {
    data.lastEpisode[String(r.seriesId)] = { id: r.episodeId, u: Number(r.u) }
  }
  return data
}

/** Writes back what the shared PositionStore rules changed (only the keys involved). */
export function savePositions(before: PositionsData, after: PositionsData) {
  transaction(() => {
    for (const k of Object.keys(before.positions)) if (!after.positions[k]) db.prepare('DELETE FROM positions WHERE key = ?').run(k)
    for (const [k, e] of Object.entries(after.positions)) {
      const old = before.positions[k]
      if (!old || old.p !== e.p || old.d !== e.d || old.u !== e.u) {
        db.prepare('INSERT OR REPLACE INTO positions (key, p, d, u) VALUES (?, ?, ?, ?)').run(k, e.p, e.d, e.u)
      }
    }
    for (const k of before.watched) if (!after.watched.includes(k)) db.prepare('DELETE FROM watched WHERE key = ?').run(k)
    for (const k of after.watched) if (!before.watched.includes(k)) db.prepare('INSERT OR IGNORE INTO watched (key) VALUES (?)').run(k)
    for (const k of Object.keys(before.lastEpisode)) if (!after.lastEpisode[k]) db.prepare('DELETE FROM last_episode WHERE seriesId = ?').run(Number(k))
    for (const [k, v] of Object.entries(after.lastEpisode)) {
      const old = before.lastEpisode[k]
      if (!old || old.id !== v.id || old.u !== v.u) {
        db.prepare('INSERT OR REPLACE INTO last_episode (seriesId, episodeId, u) VALUES (?, ?, ?)').run(Number(k), v.id, v.u)
      }
    }
    // Come sul telefono: si tengono le 600 posizioni più recenti.
    db.prepare(`DELETE FROM positions WHERE key NOT IN (SELECT key FROM positions ORDER BY u DESC LIMIT ${MAX_POSITIONS})`).run()
  })
}
