import { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { closeUser, dataDir, userDir } from './db.ts'

// Family accounts: each one has its own IPTVISION (its own IPTV account, favorites and positions),
// reached with a username and a password. No email: the server lives at home.
// A session is a browser (cookie) or a device in server mode (the same token, sent as the Xtream
// password), so every phone or TV can be seen and disconnected from the settings.

const db = new DatabaseSync(join(dataDir, 'accounts.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hash TEXT NOT NULL, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY NOT NULL, userId INTEGER NOT NULL, createdAt INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS index_sessions_userId ON sessions (userId);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`)
// Added after the first version: which device a session is and when it was last used.
const sessionColumns = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name)
if (!sessionColumns.includes('device')) db.exec("ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT ''")
if (!sessionColumns.includes('lastSeen')) db.exec('ALTER TABLE sessions ADD COLUMN lastSeen INTEGER NOT NULL DEFAULT 0')

export class AccountError extends Error {}

export type User = { id: number; username: string; token: string }

/** Set by the installer: who knows it can create an account. Empty = anyone who reaches the server. */
const INVITE_CODE = (process.env.INVITE_CODE ?? '').trim()
export const inviteRequired = INVITE_CODE !== ''

// --- passwords --------------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`
}

function passwordMatches(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length)
  return timingSafeEqual(expected, actual)
}

function checkPassword(password: string) {
  if (password.length < 6) throw new AccountError('La password deve avere almeno 6 caratteri.')
  if (password.length > 200) throw new AccountError('Password troppo lunga.')
}

function sameText(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// --- accounts ---------------------------------------------------------------------------------

const userRow = (id: number) =>
  db.prepare('SELECT id, username, hash FROM users WHERE id = ?').get(id) as { id: number; username: string; hash: string } | undefined

export function userIds(): number[] {
  return (db.prepare('SELECT id FROM users ORDER BY id').all() as { id: number }[]).map((r) => Number(r.id))
}

export function register(rawUsername: string, password: string, invite: string): { id: number; username: string } {
  if (inviteRequired && !sameText(invite.trim(), INVITE_CODE)) throw new AccountError('Codice invito sbagliato: chiedilo a chi ha installato il server.')
  const username = rawUsername.trim()
  if (!/^[\p{L}\p{N}._-]{3,24}$/u.test(username)) {
    throw new AccountError('Il nome utente deve avere da 3 a 24 caratteri: lettere, numeri, punto, trattino o trattino basso.')
  }
  checkPassword(password)
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new AccountError('Nome utente già usato, scegline un altro.')
  const id = Number(db.prepare('INSERT INTO users (username, hash, createdAt) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), Date.now()).lastInsertRowid)
  return { id, username }
}

export function login(username: string, password: string): { id: number; username: string } | null {
  const row = db.prepare('SELECT id, username, hash FROM users WHERE username = ?').get(username.trim()) as
    { id: number; username: string; hash: string } | undefined
  if (!row || !passwordMatches(password, row.hash)) return null
  return { id: Number(row.id), username: row.username }
}

export function changePassword(userId: number, current: string, password: string) {
  const row = userRow(userId)
  if (!row || !passwordMatches(current, row.hash)) throw new AccountError('La password attuale non è corretta.')
  checkPassword(password)
  db.prepare('UPDATE users SET hash = ? WHERE id = ?').run(hashPassword(password), userId)
}

/** Removes the account with all its data and disconnects every device. */
export function deleteAccount(userId: number, password: string) {
  const row = userRow(userId)
  if (!row || !passwordMatches(password, row.hash)) throw new AccountError('La password non è corretta.')
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(userId)
  db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  closeUser(userId)
  rmSync(userDir(userId), { recursive: true, force: true })
}

// --- sessions ---------------------------------------------------------------------------------

export function startSession(userId: number, device: string): string {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token, userId, createdAt, device, lastSeen) VALUES (?, ?, ?, ?, ?)')
    .run(token, userId, now, device.slice(0, 80), now)
  return token
}

const seen = new Map<string, number>()

export function sessionUser(token: string | undefined): User | null {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null
  const row = db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.userId WHERE s.token = ?').get(token) as
    { id: number; username: string } | undefined
  if (!row) return null
  // "Last used" for the devices list, written at most every 10 minutes per session.
  const now = Date.now()
  if (now - (seen.get(token) ?? 0) > 10 * 60_000) {
    seen.set(token, now)
    db.prepare('UPDATE sessions SET lastSeen = ? WHERE token = ?').run(now, token)
  }
  return { id: Number(row.id), username: row.username, token }
}

export function endSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export type Device = { id: string; device: string; createdAt: number; lastSeen: number; current: boolean }

/** Browsers and apps logged in to this account; the id is a short hash, never the token. */
export function devices(userId: number, currentToken: string): Device[] {
  const rows = db.prepare('SELECT token, device, createdAt, lastSeen FROM sessions WHERE userId = ? ORDER BY lastSeen DESC').all(userId) as
    { token: string; device: string; createdAt: number; lastSeen: number }[]
  return rows.map((r) => ({
    id: r.token.slice(0, 12),
    device: r.device || 'Browser',
    createdAt: Number(r.createdAt),
    lastSeen: Number(r.lastSeen),
    current: r.token === currentToken,
  }))
}

export function endDevice(userId: number, id: string) {
  if (!/^[0-9a-f]{12}$/.test(id)) return
  db.prepare("DELETE FROM sessions WHERE userId = ? AND substr(token, 1, 12) = ?").run(userId, id)
}
