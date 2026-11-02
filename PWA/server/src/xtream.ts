import { createHash } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CompactLive, CompactMovies, CompactSeries, Episode, Programme, SeriesInfo, VodInfo } from '../../shared/model.ts'
import { dataDir, type XtreamAccount } from './db.ts'

// Client of the "player_api.php" API of Xtream Codes panels (data/Xtream.kt), used only by the
// server: the browser and the native apps in server mode never talk to the provider.

export const USER_AGENT = 'IPTVISION/1.0'

export class XtreamError extends Error {
  isAuthError: boolean
  constructor(message: string, isAuthError = false) {
    super(message)
    this.isAuthError = isAuthError
  }
}

/**
 * Accepts "host:port", "http://host:port/" or the whole M3U link (get.php?username=..&password=..)
 * and returns server, user and password apart.
 */
export function parseServerInput(input: string): { server: string; username: string | null; password: string | null } {
  let s = input.trim()
  if (s === '') return { server: '', username: null, password: null }
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  let url: URL
  try { url = new URL(s) } catch { return { server: s.replace(/\/+$/, ''), username: null, password: null } }
  let username: string | null = null
  let password: string | null = null
  for (const [k, v] of url.searchParams) {
    if (k.toLowerCase() === 'username') username = v
    else if (k.toLowerCase() === 'password') password = v
  }
  // Drops get.php / player_api.php / xmltv.php from the path, keeps any subfolder.
  let path = url.pathname
  const last = path.lastIndexOf('/')
  if (last >= 0 && /\.php$/i.test(path.slice(last + 1))) path = path.slice(0, last)
  return { server: `${url.protocol}//${url.host}${path}`.replace(/\/+$/, ''), username, password }
}

/** Same key as the native apps: the first 8 bytes of SHA-256(server|username). */
export function accountKey(a: XtreamAccount): string {
  return createHash('sha256').update(a.server.toLowerCase() + '|' + a.username).digest().subarray(0, 8).toString('hex')
}

const q = (v: string) => encodeURIComponent(v)

export function apiUrl(a: XtreamAccount, action: string | null, extra?: string): string {
  let u = `${a.server}/player_api.php?username=${q(a.username)}&password=${q(a.password)}`
  if (action) u += `&action=${action}`
  if (extra) u += `&${extra}`
  return u
}

export const xmltvUrl = (a: XtreamAccount) => `${a.server}/xmltv.php?username=${q(a.username)}&password=${q(a.password)}`

export type Kind = 'live' | 'movie' | 'series'

export function streamUrl(a: XtreamAccount, kind: Kind, id: string, ext: string): string {
  return `${a.server}/${kind}/${q(a.username)}/${q(a.password)}/${q(id)}.${ext}`
}

// --- requests --------------------------------------------------------------------------------

export async function providerFetch(url: string, timeoutSec: number, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('User-Agent', USER_AGENT)
  return fetch(url, { ...init, headers, redirect: 'follow', signal: init.signal ?? AbortSignal.timeout(timeoutSec * 1000) })
}

function checkStatus(status: number) {
  if (status === 401 || status === 403) throw new XtreamError('Accesso negato dal server (credenziali errate o account scaduto).', true)
  if (status < 200 || status > 299) throw new Error(`HTTP ${status}`)
}

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await work()
    } catch (e) {
      if (e instanceof XtreamError) throw e
      last = e
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  console.warn('Richiesta al provider fallita', last)
  throw new XtreamError('Impossibile contattare il server IPTV. Controlla la connessione del server di casa.')
}

export function getText(url: string, timeoutSec: number): Promise<string> {
  return withRetry(async () => {
    const r = await providerFetch(url, timeoutSec)
    checkStatus(r.status)
    return r.text()
  })
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return null
}
const nn = (v: unknown) => {
  const s = str(v)?.trim()
  return s ? s : null
}
const intOf = (v: unknown): number | null => {
  const s = str(v)
  if (s == null) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export type AuthInfo = { status: string | null; expiresAt: number | null; maxConnections: number; raw: Record<string, unknown> }

export async function authenticate(a: XtreamAccount): Promise<AuthInfo> {
  const text = await getText(apiUrl(a, null), 15)
  let root: Record<string, unknown>
  try { root = JSON.parse(text) } catch {
    throw new XtreamError("Il server non ha risposto come un pannello Xtream Codes. Controlla l'indirizzo.")
  }
  const ui = root?.user_info as Record<string, unknown> | undefined
  if (!ui || typeof ui !== 'object') throw new XtreamError("Il server non ha risposto come un pannello Xtream Codes. Controlla l'indirizzo.")
  if (intOf(ui.auth) !== 1) throw new XtreamError('Nome utente o password non corretti.', true)
  const status = str(ui.status)
  if (status != null && status.toLowerCase() !== 'active') throw new XtreamError(`Account non attivo (stato: ${status}).`, true)
  const exp = Number(str(ui.exp_date))
  return { status, expiresAt: exp > 0 ? exp : null, maxConnections: intOf(ui.max_connections) ?? 0, raw: root }
}

// --- lists, cached on the server for every device of every account ----------------------------

export const LIST_ACTIONS = {
  get_live_categories: 30 * 60_000,
  get_live_streams: 30 * 60_000,
  get_vod_categories: 12 * 3600_000,
  get_vod_streams: 12 * 3600_000,
  get_series_categories: 12 * 3600_000,
  get_series: 12 * 3600_000,
} as const

export type ListAction = keyof typeof LIST_ACTIONS

export const cacheDir = (a: XtreamAccount) => {
  const dir = join(dataDir, 'cache', accountKey(a))
  mkdirSync(dir, { recursive: true })
  return dir
}

const downloading = new Map<string, Promise<string>>()

/** The first non blank character of a file, without reading it all. */
function firstChar(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(64)
    const n = readSync(fd, buf, 0, 64, 0)
    return buf.subarray(0, n).toString('utf8').trimStart().slice(0, 1)
  } finally {
    closeSync(fd)
  }
}

/**
 * The provider's JSON for [action], from the cache while fresh. Several devices asking at once
 * share one download. On failure an older copy is better than nothing.
 */
export function listFile(a: XtreamAccount, action: ListAction, force = false): Promise<string> {
  const file = join(cacheDir(a), `${action}.json`)
  const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < LIST_ACTIONS[action]
  if (fresh && !force) return Promise.resolve(file)
  const known = downloading.get(file)
  if (known) return known
  const timeout = action === 'get_vod_streams' || action === 'get_series' ? 180 : action === 'get_live_streams' ? 90 : 30
  const job = withRetry(async () => {
    const r = await providerFetch(apiUrl(a, action), timeout)
    checkStatus(r.status)
    if (!r.body) throw new Error('Risposta vuota')
    const part = file + '.part'
    await pipeline(Readable.fromWeb(r.body as never), createWriteStream(part))
    // A list that isn't JSON (an HTML error page) must not replace a good copy.
    const head = firstChar(part)
    if (head !== '[' && head !== '{') { rmSync(part, { force: true }); throw new Error('Lista non valida') }
    renameSync(part, file)
    return file
  }).catch((e) => {
    if (existsSync(file)) return file
    throw e
  }).finally(() => downloading.delete(file))
  downloading.set(file, job)
  return job
}

export function clearCache(a: XtreamAccount) {
  rmSync(join(dataDir, 'cache', accountKey(a)), { recursive: true, force: true })
}

function readArray(file: string): Record<string, unknown>[] {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []
  } catch {
    rmSync(file, { force: true })
    throw new XtreamError('Lista illeggibile: riprova tra poco.')
  }
}

function yearOf(year: unknown, date: unknown, name: string): string | null {
  for (const s of [year, date]) {
    const t = str(s)?.trim()
    if (!t || t.length < 4) continue
    const y = Number(t.slice(0, 4))
    if (Number.isInteger(y) && y > 1880) return String(y)
  }
  const m = /\((19|20)\d{2}\)/.exec(name)
  return m ? m[0].slice(1, -1) : null
}

function ratingOf(m: Record<string, unknown>): number {
  const r = Number(str(m.rating))
  if (r > 0) return Math.min(r, 10)
  const r5 = Number(str(m.rating_5based))
  if (r5 > 0) return Math.min(r5 * 2, 10)
  return 0
}

const categories = (file: string): [string, string][] =>
  readArray(file).flatMap((m) => {
    const id = str(m.category_id)
    return id == null ? [] : [[id, str(m.category_name)?.trim() ?? id] as [string, string]]
  })

// Compact lists for the browser: parsed once per download, kept in memory.
const compactCache = new Map<string, { mtime: number; value: unknown }>()

function memo<T>(key: string, files: string[], build: () => T): T {
  const mtime = files.reduce((t, f) => t + statSync(f).mtimeMs, 0)
  const hit = compactCache.get(key)
  if (hit && hit.mtime === mtime) return hit.value as T
  const value = build()
  compactCache.set(key, { mtime, value })
  if (compactCache.size > 30) compactCache.delete(compactCache.keys().next().value!)
  return value
}

export async function compactLive(a: XtreamAccount, force = false): Promise<CompactLive> {
  const [cats, items] = await Promise.all([listFile(a, 'get_live_categories', force), listFile(a, 'get_live_streams', force)])
  return memo(items, [cats, items], () => ({
    categories: categories(cats),
    items: readArray(items).flatMap((m) => {
      const id = intOf(m.stream_id)
      if (id == null) return []
      return [[id, intOf(m.num) ?? 0, (str(m.name) ?? `Canale ${id}`).trim(), nn(m.stream_icon), str(m.category_id), nn(m.epg_channel_id)] as CompactLive['items'][number]]
    }),
  }))
}

export async function compactMovies(a: XtreamAccount, force = false): Promise<CompactMovies> {
  const [cats, items] = await Promise.all([listFile(a, 'get_vod_categories', force), listFile(a, 'get_vod_streams', force)])
  return memo(items, [cats, items], () => ({
    categories: categories(cats),
    items: readArray(items).flatMap((m) => {
      const id = intOf(m.stream_id)
      if (id == null) return []
      const name = (str(m.name) ?? `Film ${id}`).trim()
      return [[id, name, nn(m.stream_icon), str(m.category_id), nn(m.container_extension), yearOf(m.year, m.releasedate, name),
        ratingOf(m), Number(str(m.added)) || 0] as CompactMovies['items'][number]]
    }),
  }))
}

export async function compactSeries(a: XtreamAccount, force = false): Promise<CompactSeries> {
  const [cats, items] = await Promise.all([listFile(a, 'get_series_categories', force), listFile(a, 'get_series', force)])
  return memo(items, [cats, items], () => ({
    categories: categories(cats),
    items: readArray(items).flatMap((m) => {
      const id = intOf(m.series_id)
      if (id == null) return []
      const name = (str(m.name) ?? `Serie ${id}`).trim()
      return [[id, name, nn(m.cover), str(m.category_id), yearOf(m.year, m.releaseDate ?? m.release_date, name), ratingOf(m),
        nn(m.plot), nn(m.genre)] as CompactSeries['items'][number]]
    }),
  }))
}

// --- details ----------------------------------------------------------------------------------

function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

export async function vodInfo(a: XtreamAccount, streamId: number): Promise<VodInfo | null> {
  const root = JSON.parse(await getText(apiUrl(a, 'get_vod_info', `vod_id=${streamId}`), 20))
  const info = root?.info
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null
  const secs = intOf(info.duration_secs) ?? 0
  return {
    plot: nn(info.plot ?? info.description),
    genre: nn(info.genre),
    year: yearOf(info.year, info.releasedate, ''),
    duration: secs > 0 ? formatDuration(secs) : nn(info.duration),
    director: nn(info.director),
    cast: nn(info.cast ?? info.actors),
  }
}

export async function seriesInfo(a: XtreamAccount, seriesId: number): Promise<SeriesInfo> {
  const root = JSON.parse(await getText(apiUrl(a, 'get_series_info', `series_id=${seriesId}`), 30))
  // Some panels return { "1": [...], "2": [...] }, others [[...], [...]].
  const eps = root?.episodes
  const groups: unknown[] = Array.isArray(eps) ? eps : eps && typeof eps === 'object' ? Object.values(eps) : []
  const episodes: Episode[] = []
  for (const g of groups) {
    if (!Array.isArray(g)) continue
    for (const e of g as Record<string, unknown>[]) {
      if (!e || typeof e !== 'object') continue
      const id = str(e.id)
      if (!id) continue
      const info = (e.info && typeof e.info === 'object' ? e.info : null) as Record<string, unknown> | null
      episodes.push({
        id,
        seriesId,
        season: intOf(e.season) ?? 1,
        number: intOf(e.episode_num) ?? 0,
        title: (str(e.title) ?? '').trim(),
        extension: nn(e.container_extension) ?? 'mp4',
        durationSecs: info ? intOf(info.duration_secs) ?? 0 : 0,
        plot: info ? nn(info.plot) : null,
        image: info ? nn(info.movie_image) : null,
      })
    }
  }
  episodes.sort((x, y) => x.season - y.season || x.number - y.number)
  const si = root?.info && typeof root.info === 'object' ? root.info : null
  return {
    plot: si ? nn(si.plot) : null,
    genre: si ? nn(si.genre) : null,
    year: si ? yearOf(si.year, si.releaseDate ?? si.release_date, '') : null,
    cast: si ? nn(si.cast) : null,
    episodes,
  }
}

function decodeB64(s: string | null): string | null {
  if (!s) return s
  try { return Buffer.from(s, 'base64').toString('utf8').trim() } catch { return s }
}

/** Short EPG of one channel: used when xmltv.php doesn't cover it. */
export async function shortEpg(a: XtreamAccount, streamId: number): Promise<Programme[]> {
  const root = JSON.parse(await getText(apiUrl(a, 'get_short_epg', `stream_id=${streamId}&limit=6`), 15))
  const arr = Array.isArray(root?.epg_listings) ? root.epg_listings : []
  const list: Programme[] = []
  for (const e of arr) {
    const st = Number(str(e?.start_timestamp))
    const sp = Number(str(e?.stop_timestamp))
    if (!st || !sp) continue
    list.push({ start: st, stop: sp, title: decodeB64(str(e.title)) ?? '', description: decodeB64(str(e.description)) })
  }
  return list.sort((x, y) => x.start - y.start)
}
