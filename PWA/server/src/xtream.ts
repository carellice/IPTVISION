// Client per le API "player_api.php" dei pannelli Xtream Codes (data/Xtream.kt). Le credenziali restano
// sul server: il browser riceve solo le liste e i flussi passano dal server.
import { createHash } from 'node:crypto'
import { createWriteStream, renameSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ChannelRow, Episode, MovieRow, Programme, SeriesInfo, SeriesRow, VodInfo } from '../../shared/model.ts'

export const USER_AGENT = 'IPTVISION/1.0'

export class XtreamError extends Error {
  isAuthError: boolean
  constructor(message: string, isAuthError = false) {
    super(message)
    this.isAuthError = isAuthError
  }
}

export type XtreamAccount = { server: string; username: string; password: string }

export const accountKey = (a: XtreamAccount) =>
  createHash('sha256').update(a.server.toLowerCase() + '|' + a.username).digest('hex').slice(0, 16)

/**
 * Accetta "host:porta", "http://host:porta/" o l'intero link M3U
 * (get.php?username=..&password=..) e restituisce server/utente/password separati.
 */
export function parseServerInput(input: string): { server: string; username: string | null; password: string | null } {
  let s = input.trim()
  if (s === '') return { server: '', username: null, password: null }
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  let url: URL
  try { url = new URL(s) } catch { return { server: s.replace(/\/+$/, ''), username: null, password: null } }
  let username: string | null = null
  let password: string | null = null
  for (const part of url.search.replace(/^\?/, '').split('&')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).toLowerCase()
    let v = part.slice(i + 1)
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')) } catch { /* lasciato com'è */ }
    if (k === 'username') username = v
    else if (k === 'password') password = v
  }
  // Rimuove get.php / player_api.php / xmltv.php dal percorso, tiene eventuali sottocartelle.
  let path = url.pathname
  const last = path.lastIndexOf('/')
  if (last >= 0 && path.slice(last + 1).toLowerCase().endsWith('.php')) path = path.slice(0, last)
  return { server: `${url.protocol}//${url.host}${path}`.replace(/\/+$/, ''), username, password }
}

const q = (v: string) => encodeURIComponent(v)

export function apiUrl(a: XtreamAccount, action: string | null, extra?: string) {
  let u = `${a.server}/player_api.php?username=${q(a.username)}&password=${q(a.password)}`
  if (action) u += `&action=${action}`
  if (extra) u += `&${extra}`
  return u
}

export const xmltvUrl = (a: XtreamAccount) => `${a.server}/xmltv.php?username=${q(a.username)}&password=${q(a.password)}`
export const liveUrl = (a: XtreamAccount, id: number, ext: string) => `${a.server}/live/${q(a.username)}/${q(a.password)}/${id}.${ext}`
export const movieUrl = (a: XtreamAccount, id: number, ext: string) => `${a.server}/movie/${q(a.username)}/${q(a.password)}/${id}.${ext}`
export const episodeUrl = (a: XtreamAccount, id: string, ext: string) => `${a.server}/series/${q(a.username)}/${q(a.password)}/${q(id)}.${ext}`

function checkResponse(status: number) {
  if (status === 401 || status === 403) throw new XtreamError('Accesso negato dal server (credenziali errate o account scaduto).', true)
  if (status < 200 || status > 299) throw new Error(`HTTP ${status}`)
}

export async function fetchUpstream(url: string, timeoutMs: number, headers: Record<string, string> = {}, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    redirect: 'follow',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
}

async function withRetry<T>(block: () => Promise<T>): Promise<T> {
  let last: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await block()
    } catch (e) {
      if (e instanceof XtreamError) throw e
      last = e
      console.warn(`Richiesta API fallita (tentativo ${attempt + 1})`, (e as Error).message)
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  console.warn('Server IPTV non raggiungibile', last)
  throw new XtreamError('Impossibile contattare il server. Controlla la connessione.')
}

async function getText(url: string, timeoutSec: number): Promise<string> {
  return withRetry(async () => {
    const r = await fetchUpstream(url, timeoutSec * 1000)
    checkResponse(r.status)
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
const nn = (s: unknown): string | null => { const t = str(s)?.trim(); return t ? t : null }
const intOf = (s: unknown): number | null => {
  const t = str(s)
  if (t == null || t.trim() === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function yearOf(year: unknown, date: unknown, name: string): string | null {
  for (const v of [year, date]) {
    const t = str(v)?.trim()
    if (t && t.length >= 4) {
      const y = Number(t.slice(0, 4))
      if (Number.isInteger(y) && y > 1880) return String(y)
    }
  }
  const m = /\((19|20)\d{2}\)/.exec(name)
  return m ? m[0].slice(1, 5) : null
}

function ratingOf(m: Record<string, unknown>): number {
  const r = Number(str(m.rating))
  if (r > 0) return Math.min(r, 10)
  const r5 = Number(str(m.rating_5based))
  if (r5 > 0) return Math.min(r5 * 2, 10)
  return 0
}

function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

function decodeB64(s: string | null): string | null {
  if (!s) return s
  try { return Buffer.from(s, 'base64').toString('utf8').trim() } catch { return s }
}

export async function authenticate(a: XtreamAccount) {
  const text = await getText(apiUrl(a, null), 15)
  let root: Record<string, unknown>
  try { root = JSON.parse(text) } catch {
    throw new XtreamError('Il server non ha risposto come un pannello Xtream Codes. Controlla l\'indirizzo.')
  }
  const ui = root?.user_info as Record<string, unknown> | undefined
  if (!ui || typeof ui !== 'object') throw new XtreamError('Il server non ha risposto come un pannello Xtream Codes. Controlla l\'indirizzo.')
  if (intOf(ui.auth) !== 1) throw new XtreamError('Nome utente o password non corretti.', true)
  const status = str(ui.status)
  if (status != null && status.toLowerCase() !== 'active') throw new XtreamError(`Account non attivo (stato: ${status}).`, true)
  return { status, expiresAt: intOf(ui.exp_date), maxConnections: intOf(ui.max_connections) ?? 0 }
}

/** Scarica una lista (canali, film, serie, categorie) direttamente su file. */
export async function download(a: XtreamAccount, action: string, target: string, timeoutSec: number) {
  const tmp = `${target}.part`
  await withRetry(async () => {
    const r = await fetchUpstream(apiUrl(a, action), timeoutSec * 1000)
    checkResponse(r.status)
    if (!r.body) throw new Error('Risposta vuota')
    await pipeline(Readable.fromWeb(r.body as never), createWriteStream(tmp))
  })
  try { renameSync(tmp, target) } catch {
    rmSync(target, { force: true })
    try { renameSync(tmp, target) } catch { throw new XtreamError('Impossibile salvare la lista sul server.') }
  }
}

// ---------- Liste: da JSON del pannello a righe compatte ----------

type Obj = Record<string, unknown>
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Obj[] : [])

export function parseCategories(v: unknown): [string, string][] {
  const out: [string, string][] = []
  for (const m of objects(v)) {
    const id = str(m.category_id)
    if (id == null) continue
    out.push([id, str(m.category_name)?.trim() || id])
  }
  return out
}

export function parseChannels(v: unknown): ChannelRow[] {
  const out: ChannelRow[] = []
  for (const m of objects(v)) {
    const id = intOf(m.stream_id)
    if (id == null) continue
    out.push([id, intOf(m.num) ?? 0, (str(m.name) ?? `Canale ${id}`).trim(), nn(m.stream_icon), str(m.category_id), nn(m.epg_channel_id)])
  }
  return out
}

export function parseMovies(v: unknown): MovieRow[] {
  const out: MovieRow[] = []
  for (const m of objects(v)) {
    const id = intOf(m.stream_id)
    if (id == null) continue
    const name = (str(m.name) ?? `Film ${id}`).trim()
    out.push([id, name, nn(m.stream_icon), str(m.category_id), nn(m.container_extension), yearOf(m.year, m.releasedate, name), ratingOf(m), intOf(m.added) ?? 0])
  }
  return out
}

export function parseSeries(v: unknown): SeriesRow[] {
  const out: SeriesRow[] = []
  for (const m of objects(v)) {
    const id = intOf(m.series_id)
    if (id == null) continue
    const name = (str(m.name) ?? `Serie ${id}`).trim()
    out.push([id, name, nn(m.cover), str(m.category_id), yearOf(m.year, m.releaseDate ?? m.release_date, name), ratingOf(m), nn(m.plot), nn(m.genre)])
  }
  return out
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
  const episodes: Episode[] = []
  // Alcuni pannelli restituiscono { "1": [...], "2": [...] }, altri [[...], [...]].
  const eps = root?.episodes
  const groups: unknown[] = Array.isArray(eps) ? eps : eps && typeof eps === 'object' ? Object.values(eps) : []
  for (const g of groups) for (const e of objects(g)) {
    const id = str(e.id)
    if (!id) continue
    const info = (e.info && typeof e.info === 'object' && !Array.isArray(e.info) ? e.info : null) as Obj | null
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
  episodes.sort((x, y) => x.season - y.season || x.number - y.number)
  const si = (root?.info && typeof root.info === 'object' && !Array.isArray(root.info) ? root.info : null) as Obj | null
  return {
    plot: si ? nn(si.plot) : null,
    genre: si ? nn(si.genre) : null,
    year: si ? yearOf(si.year, si.releaseDate ?? si.release_date, '') : null,
    cast: si ? nn(si.cast) : null,
    episodes,
  }
}

/** EPG breve di un singolo canale: usato quando xmltv.php non copre il canale. */
export async function shortEpg(a: XtreamAccount, streamId: number): Promise<Programme[]> {
  const root = JSON.parse(await getText(apiUrl(a, 'get_short_epg', `stream_id=${streamId}&limit=6`), 15))
  const list: Programme[] = []
  for (const e of objects(root?.epg_listings)) {
    const st = intOf(e.start_timestamp)
    const sp = intOf(e.stop_timestamp)
    if (st == null || sp == null) continue
    list.push({ start: st, stop: sp, title: decodeB64(str(e.title)) ?? '' })
  }
  return list.sort((x, y) => x.start - y.start)
}
