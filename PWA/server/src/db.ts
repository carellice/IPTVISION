import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Op, UserState } from '../../shared/model.ts'
import { MAX_POSITIONS } from '../../shared/positions.ts'

// Data of one account. Every account has its own SQLite file under data/users/<id>/, picked per
// request with withUser(): the functions below never take a user id, they just read and write
// "the current account". The tables hold what the native apps keep in settings and positions.json.

export const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data')
mkdirSync(dataDir, { recursive: true })

const schema = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (streamId INTEGER PRIMARY KEY NOT NULL, u INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS positions (key TEXT PRIMARY KEY NOT NULL, p INTEGER NOT NULL, d INTEGER NOT NULL, u INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS watched (key TEXT PRIMARY KEY NOT NULL);
CREATE TABLE IF NOT EXISTS last_episode (seriesId INTEGER PRIMARY KEY NOT NULL, episodeId TEXT NOT NULL, u INTEGER NOT NULL);
`

// --- accounts: every account has its own database, picked per request -------------------------

type UserData = { id: number; db: DatabaseSync }

const opened = new Map<number, UserData>()
const current = new AsyncLocalStorage<UserData>()

export const userDir = (userId: number) => join(dataDir, 'users', String(userId))

function open(userId: number): UserData {
  const known = opened.get(userId)
  if (known) return known
  const dir = userDir(userId)
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'iptvision.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
  db.exec(schema)
  const data = { id: userId, db }
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

/** The database of the current account. */
export const db = {
  prepare: (sql: string) => user().db.prepare(sql),
  exec: (sql: string) => user().db.exec(sql),
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

/** Bumped on every change, so clients can tell when to reload (GET /api/state?since=<revision>). */
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

// --- the IPTV account (Xtream Codes) of this PWA account ---------------------------------------

export type XtreamAccount = { server: string; username: string; password: string }

export function xtreamAccount(): XtreamAccount | null {
  const server = getMeta('xtream_server')
  const username = getMeta('xtream_username')
  if (!server || !username) return null
  return { server, username, password: getMeta('xtream_password') ?? '' }
}

export function setXtreamAccount(a: XtreamAccount | null) {
  transaction(() => {
    setMeta('xtream_server', a?.server ?? null)
    setMeta('xtream_username', a?.username ?? null)
    setMeta('xtream_password', a?.password ?? null)
  })
}

/** A saved IPTV list: the active one is also in xtream_server/username/password. */
export type XtreamList = XtreamAccount & { alias: string; expiresAt: number | null }

const sameAccount = (a: XtreamAccount, b: XtreamAccount) => a.server.toLowerCase() === b.server.toLowerCase() && a.username === b.username

export function xtreamLists(): XtreamList[] {
  let lists: XtreamList[] = []
  try { lists = JSON.parse(getMeta('xtream_lists') ?? '[]') } catch { /* unreadable: start again */ }
  // Accounts from before the lists: the active one becomes the first list.
  const a = xtreamAccount()
  if (a && !lists.some((l) => sameAccount(l, a))) lists.unshift({ ...a, alias: a.username, expiresAt: null })
  return lists
}

export function isActiveList(l: XtreamAccount): boolean {
  const a = xtreamAccount()
  return a != null && sameAccount(a, l)
}

/** Adds the list, or updates the one with the same server and username. */
export function saveXtreamList(l: XtreamList) {
  const lists = xtreamLists()
  const i = lists.findIndex((x) => sameAccount(x, l))
  if (i >= 0) lists[i] = l
  else lists.push(l)
  setMeta('xtream_lists', JSON.stringify(lists))
}

export function removeXtreamList(index: number) {
  setMeta('xtream_lists', JSON.stringify(xtreamLists().filter((_, i) => i !== index)))
}

// --- favorites and positions -------------------------------------------------------------------

/** Everything the clients sync: the same shape as the native positions.json, plus favorites. */
export function state(): UserState {
  const positions: UserState['positions'] = {}
  for (const r of db.prepare('SELECT key, p, d, u FROM positions').all() as { key: string; p: number; d: number; u: number }[]) {
    positions[r.key] = { p: Number(r.p), d: Number(r.d), u: Number(r.u) }
  }
  const lastEpisode: UserState['lastEpisode'] = {}
  for (const r of db.prepare('SELECT seriesId, episodeId, u FROM last_episode').all() as { seriesId: number; episodeId: string; u: number }[]) {
    lastEpisode[String(r.seriesId)] = { id: r.episodeId, u: Number(r.u) }
  }
  const x = xtreamAccount()
  return {
    revision: revision(),
    favorites: (db.prepare('SELECT streamId FROM favorites ORDER BY u').all() as { streamId: number }[]).map((r) => Number(r.streamId)),
    positions,
    watched: (db.prepare('SELECT key FROM watched').all() as { key: string }[]).map((r) => r.key),
    lastEpisode,
    hideAdult: getMeta('hideAdult') === '1',
    xtream: x ? { server: x.server, username: x.username } : null,
  }
}

const validKey = (k: unknown): k is string => typeof k === 'string' && /^[mes]:[\w.-]{1,64}$/.test(k)
const validInt = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Applies the changes of a client in order, with the rules of the native PositionStore. */
export function applyOps(ops: Op[]) {
  if (!Array.isArray(ops) || ops.length === 0) return
  transaction(() => {
    const now = Date.now()
    for (const o of ops.slice(0, 500)) {
      switch (o?.op) {
        case 'position':
          if (!validKey(o.key) || !validInt(o.p) || !validInt(o.d)) break
          db.prepare('INSERT OR REPLACE INTO positions (key, p, d, u) VALUES (?, ?, ?, ?)').run(o.key, Math.round(o.p), Math.round(o.d), now)
          db.prepare('DELETE FROM watched WHERE key = ?').run(o.key)
          break
        case 'watched':
          if (!validKey(o.key)) break
          db.prepare('DELETE FROM positions WHERE key = ?').run(o.key)
          db.prepare('INSERT OR IGNORE INTO watched (key) VALUES (?)').run(o.key)
          break
        case 'forgetPosition':
          if (validKey(o.key)) db.prepare('DELETE FROM positions WHERE key = ?').run(o.key)
          break
        case 'lastEpisode':
          if (!validInt(o.seriesId) || typeof o.id !== 'string' || o.id.length > 64) break
          db.prepare('INSERT OR REPLACE INTO last_episode (seriesId, episodeId, u) VALUES (?, ?, ?)').run(o.seriesId, o.id, now)
          break
        case 'forgetSeries':
          if (validInt(o.seriesId)) db.prepare('DELETE FROM last_episode WHERE seriesId = ?').run(o.seriesId)
          break
        case 'favorite':
          if (!validInt(o.streamId)) break
          if (o.on) db.prepare('INSERT OR IGNORE INTO favorites (streamId, u) VALUES (?, ?)').run(o.streamId, now)
          else db.prepare('DELETE FROM favorites WHERE streamId = ?').run(o.streamId)
          break
        case 'hideAdult':
          setMeta('hideAdult', o.on ? '1' : '0')
          break
      }
    }
    // Like the native store: only the 600 most recent positions are kept.
    db.prepare(`DELETE FROM positions WHERE key NOT IN (SELECT key FROM positions ORDER BY u DESC LIMIT ${MAX_POSITIONS})`).run()
  })
}

/**
 * The data a native app had before it switched to server mode, in its positions.json shape:
 * merged in (newer position wins, watched and favorites added), never deleting what is on the server.
 */
export function importNative(input: {
  favorites?: unknown
  positions?: unknown
  watched?: unknown
  lastEpisode?: unknown
}) {
  transaction(() => {
    if (Array.isArray(input.favorites)) {
      for (const id of input.favorites) if (validInt(id)) db.prepare('INSERT OR IGNORE INTO favorites (streamId, u) VALUES (?, ?)').run(id, Date.now())
    }
    if (Array.isArray(input.watched)) {
      for (const k of input.watched) if (validKey(k)) {
        db.prepare('INSERT OR IGNORE INTO watched (key) VALUES (?)').run(k)
        db.prepare('DELETE FROM positions WHERE key = ?').run(k)
      }
    }
    if (input.positions && typeof input.positions === 'object') {
      for (const [k, v] of Object.entries(input.positions as Record<string, { p?: number; d?: number; u?: number }>)) {
        if (!validKey(k) || !v || !validInt(v.p) || !validInt(v.d)) continue
        if (db.prepare('SELECT 1 FROM watched WHERE key = ?').get(k)) continue
        const u = validInt(v.u) ? v.u : Date.now()
        const old = db.prepare('SELECT u FROM positions WHERE key = ?').get(k) as { u: number } | undefined
        if (!old || Number(old.u) < u) db.prepare('INSERT OR REPLACE INTO positions (key, p, d, u) VALUES (?, ?, ?, ?)').run(k, v.p, v.d, u)
      }
    }
    if (input.lastEpisode && typeof input.lastEpisode === 'object') {
      for (const [k, v] of Object.entries(input.lastEpisode as Record<string, { id?: string; u?: number }>)) {
        const sid = Number(k)
        if (!validInt(sid) || !v || typeof v.id !== 'string') continue
        const u = validInt(v.u) ? v.u : Date.now()
        const old = db.prepare('SELECT u FROM last_episode WHERE seriesId = ?').get(sid) as { u: number } | undefined
        if (!old || Number(old.u) < u) db.prepare('INSERT OR REPLACE INTO last_episode (seriesId, episodeId, u) VALUES (?, ?, ?)').run(sid, v.id, u)
      }
    }
  })
}
