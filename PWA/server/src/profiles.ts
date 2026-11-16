import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getMeta, setMeta, removeProfileData } from './db.ts'

// Profiles of an account, like Netflix: each one has its own favorites, "Continua a guardare",
// "La mia lista" and "Nascondi XXX". The main profile (id 0) always exists and owns the data from
// before profiles. A profile can have a 4 to 8 digit PIN, asked when switching to it.
// The list lives in the account database (meta "profiles"); call these inside withUser().

export class ProfileError extends Error {}

type Stored = { id: number; name: string; pin?: string }
export type Profile = { id: number; name: string; hasPin: boolean }

const MAX = 8

function stored(username: string): Stored[] {
  let list: Stored[] = []
  try { list = JSON.parse(getMeta('profiles') ?? '[]') } catch { /* unreadable: only the main profile */ }
  if (!list.some((p) => p.id === 0)) list.unshift({ id: 0, name: username })
  return list
}

const save = (list: Stored[]) => setMeta('profiles', JSON.stringify(list))
const view = (p: Stored): Profile => ({ id: p.id, name: p.name, hasPin: !!p.pin })

export const profiles = (username: string): Profile[] => stored(username).map(view)

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > 24) throw new ProfileError('Il nome del profilo deve avere da 1 a 24 caratteri.')
  return name
}

function hashPin(raw: unknown): string | undefined {
  const pin = String(raw ?? '')
  if (pin === '') return undefined
  if (!/^\d{4,8}$/.test(pin)) throw new ProfileError('Il PIN deve avere da 4 a 8 cifre.')
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, 32).toString('hex')}`
}

export function pinMatches(p: { pin?: string }, raw: unknown): boolean {
  if (!p.pin) return true
  const [, salt, hash] = p.pin.split('$')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  return timingSafeEqual(expected, scryptSync(String(raw ?? ''), Buffer.from(salt, 'hex'), expected.length))
}

function find(username: string, id: number): Stored {
  const p = stored(username).find((x) => x.id === id)
  if (!p) throw new ProfileError('Profilo non trovato.')
  return p
}

export function addProfile(username: string, name: unknown, pin: unknown): Profile {
  const list = stored(username)
  if (list.length >= MAX) throw new ProfileError(`Al massimo ${MAX} profili per account.`)
  const n = cleanName(name)
  if (list.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new ProfileError('Esiste già un profilo con questo nome.')
  const p: Stored = { id: Math.max(...list.map((x) => x.id)) + 1, name: n, pin: hashPin(pin) }
  save([...list, p])
  return view(p)
}

/** True when [pin] opens profile [id] (always, without a PIN). */
export function canUse(username: string, id: number, pin: unknown): boolean {
  return pinMatches(find(username, id), pin)
}

/** Name and PIN of a profile; [pin] undefined keeps the PIN, "" removes it. */
export function editProfile(username: string, id: number, name: unknown, pin: unknown) {
  const list = stored(username)
  const p = list.find((x) => x.id === id)
  if (!p) throw new ProfileError('Profilo non trovato.')
  const n = cleanName(name)
  if (list.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new ProfileError('Esiste già un profilo con questo nome.')
  p.name = n
  if (pin !== undefined) p.pin = hashPin(pin)
  save(list)
}

/** Removes a profile and its data; the main profile cannot be removed. */
export function removeProfile(userId: number, username: string, id: number) {
  if (id === 0) throw new ProfileError('Il profilo principale non si può eliminare.')
  find(username, id)
  save(stored(username).filter((p) => p.id !== id))
  removeProfileData(userId, id)
}
