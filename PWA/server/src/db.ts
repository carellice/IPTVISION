import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
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
CREATE TABLE IF NOT EXISTS my_list (key TEXT PRIMARY KEY NOT NULL, u INTEGER NOT NULL);
`

// --- accounts: every account has its own database, picked per request -------------------------
// Profiles: the main one (0) keeps its data in the account database, as before profiles existed;
// every other profile has favorites, positions, lists and "Nascondi XXX" in profile-<id>.db.
// The IPTV account, the TMDB key and the profile list stay in the account database.

type UserData = { id: number; profile: number; db: DatabaseSync; pdb: DatabaseSync }

const files = new Map<string, DatabaseSync>()
const current = new AsyncLocalStorage<UserData>()

export const userDir = (userId: number) => join(dataDir, 'users', String(userId))
const profileFile = (userId: number, profile: number) => join(userDir(userId), profile === 0 ? 'iptvision.db' : `profile-${profile}.db`)

function openFile(userId: number, profile: number): DatabaseSync {
  const key = `${userId}:${profile}`
  const known = files.get(key)
  if (known) return known
  mkdirSync(userDir(userId), { recursive: true })
  const db = new DatabaseSync(profileFile(userId, profile))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
  db.exec(schema)
  files.set(key, db)
  return db
}

/** Runs [work] on the data of [userId] and its [profile]: every function of this module then reads and writes there. */
export function withUser<T>(userId: number, work: () => T, profile = 0): T {
  return current.run({ id: userId, profile, db: openFile(userId, 0), pdb: openFile(userId, profile) }, work)
}

export function closeUser(userId: number) {
  for (const [key, db] of files) {
    if (key.startsWith(`${userId}:`)) { db.close(); files.delete(key) }
  }
}

/** Closes and deletes the data of one profile (never the main one). */
export function removeProfileData(userId: number, profile: number) {
  if (profile === 0) return
  files.get(`${userId}:${profile}`)?.close()
  files.delete(`${userId}:${profile}`)
  for (const ext of ['', '-wal', '-shm']) rmSync(profileFile(userId, profile) + ext, { force: true })
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

/** The database of the current profile: the account's own one for the main profile. */
const pdb = {
  prepare: (sql: string) => user().pdb.prepare(sql),
}

/** The profile in use for this request. */
export const currentProfile = () => user().profile

function getProfileMeta(key: string): string | null {
  const row = pdb.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setProfileMeta(key: string, value: string) {
  pdb.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
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

/** One transaction on the account database and, for another profile, on the profile's too. */
export function transaction<T>(work: () => T): T {
  const u = user()
  const both = u.pdb !== u.db ? [u.db, u.pdb] : [u.db]
  for (const d of both) d.exec('BEGIN')
  try {
    const result = work()
    touch()
    for (const d of both) d.exec('COMMIT')
    return result
  } catch (e) {
    for (const d of both) d.exec('ROLLBACK')
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

/** Lists a native app had before connecting: the missing ones join the server's, which win on duplicates. */
export function addXtreamLists(input: unknown) {
  if (!Array.isArray(input)) return
  const lists = xtreamLists()
  for (const l of input as Partial<XtreamList>[]) {
    if (!l || typeof l.server !== 'string' || typeof l.username !== 'string' || !l.server || !l.username) continue
    const add = { server: l.server, username: l.username, password: String(l.password ?? ''), alias: String(l.alias || l.username).slice(0, 60), expiresAt: typeof l.expiresAt === 'number' ? l.expiresAt : null }
    if (!lists.some((x) => sameAccount(x, add))) lists.push(add)
  }
  setMeta('xtream_lists', JSON.stringify(lists))
}

/** The provider's expiry, read at every login check, saved on the list in use. */
export function setActiveExpiry(expiresAt: number | null) {
  const saved = xtreamLists().find(isActiveList)
  if (saved && saved.expiresAt !== expiresAt) saveXtreamList({ ...saved, expiresAt })
}

export function removeXtreamList(index: number) {
  setMeta('xtream_lists', JSON.stringify(xtreamLists().filter((_, i) => i !== index)))
}

// --- favorites and positions -------------------------------------------------------------------

/** Everything the clients sync: the same shape as the native positions.json, plus favorites. */
export function state(): UserState {
  const positions: UserState['positions'] = {}
  for (const r of pdb.prepare('SELECT key, p, d, u FROM positions').all() as { key: string; p: number; d: number; u: number }[]) {
    positions[r.key] = { p: Number(r.p), d: Number(r.d), u: Number(r.u) }
  }
  const lastEpisode: UserState['lastEpisode'] = {}
  for (const r of pdb.prepare('SELECT seriesId, episodeId, u FROM last_episode').all() as { seriesId: number; episodeId: string; u: number }[]) {
    lastEpisode[String(r.seriesId)] = { id: r.episodeId, u: Number(r.u) }
  }
  const myList: UserState['myList'] = {}
  for (const r of pdb.prepare('SELECT key, u FROM my_list').all() as { key: string; u: number }[]) myList[r.key] = Number(r.u)
  const x = xtreamAccount()
  return {
    revision: revision(),
    favorites: (pdb.prepare('SELECT streamId FROM favorites ORDER BY u').all() as { streamId: number }[]).map((r) => Number(r.streamId)),
    positions,
    watched: (pdb.prepare('SELECT key FROM watched').all() as { key: string }[]).map((r) => r.key),
    lastEpisode,
    myList,
    // Acceso finché il profilo non lo spegne.
    hideAdult: getProfileMeta('hideAdult') !== '0',
    // Never set: absent, so a device with its own key sends it; removed: "" and every device drops it.
    ...(getMeta('tmdbKey') ? { tmdbKey: getMeta('tmdbKey')! } : process.env.TMDB_KEY ? { tmdbKey: process.env.TMDB_KEY.trim() } : getMeta('tmdbKey') !== null ? { tmdbKey: '' } : {}),
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
          pdb.prepare('INSERT OR REPLACE INTO positions (key, p, d, u) VALUES (?, ?, ?, ?)').run(o.key, Math.round(o.p), Math.round(o.d), now)
          pdb.prepare('DELETE FROM watched WHERE key = ?').run(o.key)
          break
        case 'watched':
          if (!validKey(o.key)) break
          pdb.prepare('DELETE FROM positions WHERE key = ?').run(o.key)
          pdb.prepare('INSERT OR IGNORE INTO watched (key) VALUES (?)').run(o.key)
          break
        case 'forgetPosition':
          if (validKey(o.key)) pdb.prepare('DELETE FROM positions WHERE key = ?').run(o.key)
          break
        case 'lastEpisode':
          if (!validInt(o.seriesId) || typeof o.id !== 'string' || o.id.length > 64) break
          pdb.prepare('INSERT OR REPLACE INTO last_episode (seriesId, episodeId, u) VALUES (?, ?, ?)').run(o.seriesId, o.id, now)
          break
        case 'forgetSeries':
          if (validInt(o.seriesId)) pdb.prepare('DELETE FROM last_episode WHERE seriesId = ?').run(o.seriesId)
          break
        case 'favorite':
          if (!validInt(o.streamId)) break
          if (o.on) pdb.prepare('INSERT OR IGNORE INTO favorites (streamId, u) VALUES (?, ?)').run(o.streamId, now)
          else pdb.prepare('DELETE FROM favorites WHERE streamId = ?').run(o.streamId)
          break
        case 'myList':
          if (!validKey(o.key) || o.key.startsWith('e:')) break
          if (o.on) pdb.prepare('INSERT OR IGNORE INTO my_list (key, u) VALUES (?, ?)').run(o.key, now)
          else pdb.prepare('DELETE FROM my_list WHERE key = ?').run(o.key)
          break
        case 'hideAdult':
          setProfileMeta('hideAdult', o.on ? '1' : '0')
          break
        case 'tmdbKey':
          if (typeof o.key === 'string' && o.key.length <= 1024) setMeta('tmdbKey', o.key.trim())
          break
      }
    }
    // Like the native store: only the 600 most recent positions are kept.
    pdb.prepare(`DELETE FROM positions WHERE key NOT IN (SELECT key FROM positions ORDER BY u DESC LIMIT ${MAX_POSITIONS})`).run()
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
  myList?: unknown
}) {
  transaction(() => {
    if (Array.isArray(input.favorites)) {
      for (const id of input.favorites) if (validInt(id)) pdb.prepare('INSERT OR IGNORE INTO favorites (streamId, u) VALUES (?, ?)').run(id, Date.now())
    }
    if (Array.isArray(input.watched)) {
      for (const k of input.watched) if (validKey(k)) {
        pdb.prepare('INSERT OR IGNORE INTO watched (key) VALUES (?)').run(k)
        pdb.prepare('DELETE FROM positions WHERE key = ?').run(k)
      }
    }
    if (input.positions && typeof input.positions === 'object') {
      for (const [k, v] of Object.entries(input.positions as Record<string, { p?: number; d?: number; u?: number }>)) {
        if (!validKey(k) || !v || !validInt(v.p) || !validInt(v.d)) continue
        if (pdb.prepare('SELECT 1 FROM watched WHERE key = ?').get(k)) continue
        const u = validInt(v.u) ? v.u : Date.now()
        const old = pdb.prepare('SELECT u FROM positions WHERE key = ?').get(k) as { u: number } | undefined
        if (!old || Number(old.u) < u) pdb.prepare('INSERT OR REPLACE INTO positions (key, p, d, u) VALUES (?, ?, ?, ?)').run(k, v.p, v.d, u)
      }
    }
    if (input.lastEpisode && typeof input.lastEpisode === 'object') {
      for (const [k, v] of Object.entries(input.lastEpisode as Record<string, { id?: string; u?: number }>)) {
        const sid = Number(k)
        if (!validInt(sid) || !v || typeof v.id !== 'string') continue
        const u = validInt(v.u) ? v.u : Date.now()
        const old = pdb.prepare('SELECT u FROM last_episode WHERE seriesId = ?').get(sid) as { u: number } | undefined
        if (!old || Number(old.u) < u) pdb.prepare('INSERT OR REPLACE INTO last_episode (seriesId, episodeId, u) VALUES (?, ?, ?)').run(sid, v.id, u)
      }
    }
    if (input.myList && typeof input.myList === 'object') {
      for (const [k, u] of Object.entries(input.myList as Record<string, unknown>)) {
        if (validKey(k) && !k.startsWith('e:')) pdb.prepare('INSERT OR IGNORE INTO my_list (key, u) VALUES (?, ?)').run(k, validInt(u) ? u : Date.now())
      }
    }
  })
}
