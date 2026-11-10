import { useSyncExternalStore } from 'react'
import type { Category, Channel, CompactLive, CompactMovies, CompactSeries, Episode, Movie, Op, Programme, Series, SeriesInfo, UserState, VodInfo } from '../../../shared/model.ts'
import { type Positions, positionOp, progress as progressOf, resumeMs as resumeOf, MAX_POSITIONS } from '../../../shared/positions.ts'
import { listFor, nowNext } from '../../../shared/epg.ts'
import * as quiz from '../../../shared/quiz.ts'
import { type Entry, groupVariants } from '../../../shared/text.ts'
import { ApiError, api } from './api.ts'
import {
  ALL_ID, CONTINUE_ID, FAVORITES_ID, MYLIST_ID, type CategoryHit, type Library, type ListSort, type SearchScope, type Section,
  library, search as searchLib, sortChannels, sortMovies, sortSeries, toChannels, toMovies, toSeries,
} from './library.ts'
import { PlayerController } from './player.ts'
import { toast } from '../components/ui.tsx'

// AppViewModel.kt for the browser: navigation, catalog, favorites and positions, playback.
// One module-level state read by the screens with useApp(); every change calls emit().

export type Screen =
  | { kind: 'Login' }
  | { kind: 'Home' }
  | { kind: 'MovieDetail'; movie: Movie }
  | { kind: 'SeriesDetail'; series: Series }
  | { kind: 'Player' }

export type Playing =
  | { kind: 'Live'; channel: Channel; playlist: Channel[] }
  | { kind: 'Film'; movie: Movie }
  | { kind: 'Ep'; series: Series; episode: Episode; episodes: Episode[] }

export type VariantChoice = { kind: 'Films'; title: string; items: Movie[] } | { kind: 'Shows'; title: string; items: Series[] }

export const sections: Section[] = ['Live', 'Movies', 'Series', 'Search', 'Settings']

// --- per device settings (SharedPreferences "settings" of the phone) ---------------------------------

type DeviceSettings = {
  autoPlayLast: boolean
  lastStreamId: number | null
  lastCategoryId: string | null
  sorts: Partial<Record<Section, ListSort>>
  grids: Partial<Record<Section, boolean>>
}

const settingsKey = (user: string) => `iptvision.settings.${user.toLowerCase()}`

function loadSettings(user: string): DeviceSettings {
  const defaults: DeviceSettings = { autoPlayLast: false, lastStreamId: null, lastCategoryId: null, sorts: {}, grids: {} }
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(settingsKey(user)) ?? '{}') } } catch { return defaults }
}

// --- lists saved in the browser (IndexedDB): the app is ready at once, even if the provider is slow ---

let dbp: Promise<IDBDatabase> | null = null
function idb(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('iptvision', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('lists')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  return dbp
}
function idbDo<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return idb().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction('lists', mode)
    const req = work(t.objectStore('lists'))
    t.oncomplete = () => resolve(req.result)
    t.onerror = t.onabort = () => reject(t.error)
  })).catch(() => null)
}
const cacheGet = <T>(key: string) => idbDo<T>('readonly', (s) => s.get(key) as IDBRequest<T>)
const cachePut = (key: string, v: unknown) => idbDo('readwrite', (s) => s.put(v, key))
const cacheClear = () => idbDo('readwrite', (s) => s.clear())

// --- state ----------------------------------------------------------------------------------------

type Raw<T> = { categories: Category[]; items: T[] }

export const app = {
  version: 0,
  username: '',
  serverVersion: '',
  inviteRequired: false,
  settings: loadSettings(''),

  stack: [{ kind: 'Home' }] as Screen[],
  section: 'Live' as Section,
  open: {} as Partial<Record<Section, string | null>>,
  lastCategory: {} as Partial<Record<Section, string>>,

  status: null as string | null,
  error: null as string | null,
  loginBusy: false,
  loginError: null as string | null,

  xtream: null as UserState['xtream'],
  hideAdult: false,
  favorites: new Set<number>(),
  /** "La mia lista": films ("m:{id}") and series ("s:{id}") with when they were added. */
  myList: {} as Record<string, number>,
  pos: { positions: {}, watched: new Set(), lastEpisode: {} } as Positions,
  revision: -1,
  positionsVersion: 0,

  rawLive: null as Raw<Channel> | null,
  rawMovies: null as Raw<Movie> | null,
  rawSeries: null as Raw<Series> | null,
  live: null as Library<Channel> | null,
  movies: null as Library<Movie> | null,
  series: null as Library<Series> | null,
  moviesLoading: false,
  seriesLoading: false,

  epg: {} as Record<string, Programme[]>,
  shortEpg: {} as Record<number, Programme[]>,
  epgVersion: 0,

  playing: null as Playing | null,
  vodInfo: null as VodInfo | null,
  seriesInfo: null as SeriesInfo | null,
  seriesInfoLoading: false,
  nextEpisodeCountdown: null as number | null,

  searchQuery: '',
  searchScope: 'All' as SearchScope,
  variantChoice: null as VariantChoice | null,
  quizOpen: false,
}

export const player = new PlayerController()

const listeners = new Set<() => void>()
export function emit() {
  app.version++
  listeners.forEach((l) => l())
  syncHistory()
}

/** Re-renders the caller whenever the state changes; read the fields from `app`. */
export function useApp(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => app.version)
}

player.onChange = emit

export const screen = () => app.stack[app.stack.length - 1]

function saveSettings() {
  try { localStorage.setItem(settingsKey(app.username), JSON.stringify(app.settings)) } catch { /* private mode */ }
}

export function updateSettings(patch: Partial<DeviceSettings>) {
  app.settings = { ...app.settings, ...patch }
  saveSettings()
  emit()
}

// --- navigation, mirrored on the browser history (back gesture, back button) -------------------------

function push(s: Screen) {
  app.stack = [...app.stack, s]
}

/** Things Back closes, in the order of AppViewModel.back(). */
function depth(): number {
  let d = 0
  if (app.variantChoice) d++
  if (app.quizOpen) d++
  d += app.stack.length - 1
  if (screen().kind === 'Home' && app.open[app.section] != null) d++
  if (screen().kind === 'Home' && app.section !== 'Live') d++
  return d
}

let pushed = 0
let ignorePops = 0
/** Screens with panels of their own (the player) take Back first, like BackHandler. */
const backHandlers: (() => boolean)[] = []

function syncHistory() {
  const want = depth()
  while (pushed < want) { history.pushState({ iptv: ++pushed }, ''); }
  if (pushed > want) {
    ignorePops++
    history.go(want - pushed)
    pushed = want
  }
}

window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return }
  pushed = Math.max(0, pushed - 1)
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    if (backHandlers[i]()) { history.pushState({ iptv: ++pushed }, ''); return }
  }
  back()
})

export function addBackHandler(h: () => boolean): () => void {
  backHandlers.push(h)
  return () => {
    const i = backHandlers.indexOf(h)
    if (i >= 0) backHandlers.splice(i, 1)
  }
}

/** Returns false when there is nothing to close. */
export function back(): boolean {
  if (app.variantChoice) { app.variantChoice = null; emit(); return true }
  if (app.quizOpen) { app.quizOpen = false; emit(); return true }
  if (app.stack.length > 1) {
    const top = app.stack[app.stack.length - 1]
    app.stack = app.stack.slice(0, -1)
    if (top.kind === 'Player') leavePlayer()
    emit()
    return true
  }
  if (screen().kind === 'Home' && app.open[app.section] != null) { closeCategory(app.section); return true }
  if (screen().kind === 'Home' && app.section !== 'Live') { setSection('Live'); return true }
  return false
}

export function setSection(s: Section) {
  app.section = s
  if (s === 'Movies') ensureMovies()
  if (s === 'Series') ensureSeries()
  emit()
}

export function openCategory(s: Section, id: string) {
  app.lastCategory[s] = id
  app.open = { ...app.open, [s]: id }
  if (s === 'Live') updateSettings({ lastCategoryId: id })
  emit()
}

export function closeCategory(s: Section) {
  app.open = { ...app.open, [s]: null }
  emit()
}

export const sortOf = (s: Section): ListSort => app.settings.sorts[s] ?? 'Default'
export const setSort = (s: Section, v: ListSort) => updateSettings({ sorts: { ...app.settings.sorts, [s]: v } })
/** Without a choice: grid for films and series, list for channels. */
export const isGrid = (s: Section) => app.settings.grids[s] ?? s !== 'Live'
export const setGrid = (s: Section, v: boolean) => updateSettings({ grids: { ...app.settings.grids, [s]: v } })

// --- session and account ---------------------------------------------------------------------------

/** After the PWA login: this account's settings, its data, its IPTV account. */
export async function start(username: string) {
  app.username = username
  app.settings = loadSettings(username)
  app.stack = [{ kind: 'Home' }]
  emit()
  try {
    applyState(await api<UserState>('/api/state'))
  } catch (e) {
    app.error = (e as Error).message
  }
  if (!app.xtream) {
    app.stack = [{ kind: 'Login' }]
    emit()
    return
  }
  openAccount(app.settings.autoPlayLast)
}

function applyState(s: UserState & { unchanged?: boolean }) {
  if (s.unchanged) return
  if (pendingOps.length > 0) return // ours first: the next answer brings them back
  const hideChanged = app.hideAdult !== s.hideAdult
  app.revision = s.revision
  app.xtream = s.xtream
  app.hideAdult = s.hideAdult
  app.favorites = new Set(s.favorites)
  app.myList = s.myList ?? {}
  app.pos = { positions: s.positions, watched: new Set(s.watched), lastEpisode: s.lastEpisode }
  app.positionsVersion++
  if (hideChanged) rebuildLibraries()
  emit()
}

export async function loginXtream(server: string, username: string, password: string, alias = '') {
  if (server.trim() === '' && username.trim() === '') { app.loginError = 'Inserisci server e nome utente, oppure il link M3U completo.'; emit(); return }
  app.loginBusy = true
  app.loginError = null
  emit()
  try {
    const r = await api<{ server: string; username: string }>('/api/xtream', { method: 'POST', json: { server, username, password, alias } })
    app.xtream = { server: r.server, username: r.username }
    app.stack = [{ kind: 'Home' }]
    app.section = 'Live'
    resetCatalog()
    openAccount(false)
  } catch (e) {
    app.loginError = (e as Error).message
  } finally {
    app.loginBusy = false
    emit()
  }
}

/** A saved IPTV list (Impostazioni → Liste IPTV); the password stays on the server. */
export type XtreamList = { index: number; alias: string; server: string; username: string; expiresAt: number | null; active: boolean }

/** Opens the login screen over the app to add one more list (Indietro goes back). */
export function addXtreamList() {
  app.loginError = null
  push({ kind: 'Login' })
}

/** Switches to another saved list: lists, guide and player start again from that account. */
export async function switchXtreamList(index: number) {
  player.stop()
  app.playing = null
  let s: UserState
  try { s = await api<UserState>(`/api/xtream/lists/${index}/use`, { method: 'POST' }) } catch (e) { toast((e as Error).message, true); return }
  applyState(s)
  app.xtream = s.xtream
  updateSettings({ lastStreamId: null, lastCategoryId: null })
  app.stack = [{ kind: 'Home' }]
  app.section = 'Live'
  resetCatalog()
  openAccount(false)
  emit()
}

export async function logoutXtream() {
  player.stop()
  app.playing = null
  try { await api('/api/xtream', { method: 'DELETE' }) } catch (e) { toast((e as Error).message, true); return }
  app.xtream = null
  updateSettings({ lastStreamId: null, lastCategoryId: null })
  resetCatalog()
  await cacheClear()
  app.stack = [{ kind: 'Login' }]
  emit()
}

function resetCatalog() {
  app.rawLive = app.rawMovies = app.rawSeries = null
  app.live = app.movies = app.series = null
  app.epg = {}
  app.shortEpg = {}
  app.open = {}
  app.error = null
}

const cacheKey = (kind: string) => `${app.username.toLowerCase()}|${app.xtream?.server}|${app.xtream?.username}|${kind}`

function rebuildLibraries() {
  const h = app.hideAdult
  if (app.rawLive) app.live = library(app.rawLive.categories, app.rawLive.items, (c) => c.categoryId, h)
  if (app.rawMovies) app.movies = library(app.rawMovies.categories, app.rawMovies.items, (m) => m.categoryId, h)
  if (app.rawSeries) app.series = library(app.rawSeries.categories, app.rawSeries.items, (s) => s.categoryId, h)
}

async function openAccount(autoPlay: boolean) {
  // First the saved list: the app is ready at once, even when the server is slow.
  const cached = await cacheGet<CompactLive>(cacheKey('live'))
  if (cached) {
    app.rawLive = toChannels(cached)
    rebuildLibraries()
    if (autoPlay) autoPlayLast()
    loadEpg(false)
  }
  app.status = cached ? null : 'Caricamento canali…'
  emit()
  try {
    const fresh = await api<CompactLive>('/api/lists/live')
    cachePut(cacheKey('live'), fresh)
    app.rawLive = toChannels(fresh)
    rebuildLibraries()
    if (!cached) {
      if (autoPlay) autoPlayLast()
      loadEpg(false)
    }
    app.status = null
  } catch (e) {
    app.status = null
    const auth = e instanceof ApiError && e.status === 403
    if (!cached || auth) app.error = (e as Error).message
  }
  emit()
}

export function refreshAll() {
  app.rawMovies = app.rawSeries = null
  app.movies = app.series = null
  ;(async () => {
    try {
      const fresh = await api<CompactLive>('/api/lists/live?force=1')
      cachePut(cacheKey('live'), fresh)
      app.rawLive = toChannels(fresh)
      rebuildLibraries()
      emit()
    } catch (e) { toast((e as Error).message, true) }
    loadEpg(true)
    if (app.section === 'Movies') ensureMovies(true)
    if (app.section === 'Series') ensureSeries(true)
  })()
  emit()
}

export async function clearCache() {
  try { await api('/api/cache/clear', { method: 'POST' }) } catch (e) { toast((e as Error).message, true) }
  await cacheClear()
  refreshAll()
}

async function loadEpg(force: boolean) {
  try {
    app.epg = await api<Record<string, Programme[]>>(`/api/epg${force ? '?force=1' : ''}`)
    app.epgVersion++
    emit()
  } catch { /* no guide: the lists work without it */ }
}

export function ensureMovies(force = false) {
  if (!app.xtream || (app.movies && !force) || app.moviesLoading) return
  app.moviesLoading = true
  emit()
  ;(async () => {
    try {
      const cached = force ? null : await cacheGet<CompactMovies & { at: number }>(cacheKey('movies'))
      // Films and series: from the browser's copy if it has less than 12 hours, else from the server.
      const fresh = cached && Date.now() - cached.at < 12 * 3600_000 ? cached
        : await api<CompactMovies>(`/api/lists/movies${force ? '?force=1' : ''}`).then((r) => { cachePut(cacheKey('movies'), { ...r, at: Date.now() }); return r })
          .catch((e) => { if (cached) return cached; throw e })
      app.rawMovies = toMovies(fresh)
      rebuildLibraries()
    } catch (e) {
      app.error = (e as Error).message || 'Impossibile caricare i film.'
      toast(app.error, true)
    } finally {
      app.moviesLoading = false
      emit()
    }
  })()
}

export function ensureSeries(force = false) {
  if (!app.xtream || (app.series && !force) || app.seriesLoading) return
  app.seriesLoading = true
  emit()
  ;(async () => {
    try {
      const cached = force ? null : await cacheGet<CompactSeries & { at: number }>(cacheKey('series'))
      const fresh = cached && Date.now() - cached.at < 12 * 3600_000 ? cached
        : await api<CompactSeries>(`/api/lists/series${force ? '?force=1' : ''}`).then((r) => { cachePut(cacheKey('series'), { ...r, at: Date.now() }); return r })
          .catch((e) => { if (cached) return cached; throw e })
      app.rawSeries = toSeries(fresh)
      rebuildLibraries()
    } catch (e) {
      app.error = (e as Error).message || 'Impossibile caricare le serie.'
      toast(app.error, true)
    } finally {
      app.seriesLoading = false
      emit()
    }
  })()
}

export function setHideAdult(value: boolean) {
  app.hideAdult = value
  app.open = {}
  rebuildLibraries()
  queue({ op: 'hideAdult', on: value }, true)
  emit()
}

// --- favorites and positions: applied here at once, sent to the server in batches ---------------------

let pendingOps: Op[] = []
let flushTimer: number | undefined

function queue(op: Op, now = false) {
  pendingOps.push(op)
  clearTimeout(flushTimer)
  flushTimer = window.setTimeout(flush, now ? 0 : 15_000)
}

export async function flush() {
  clearTimeout(flushTimer)
  if (pendingOps.length === 0) return
  const ops = pendingOps
  pendingOps = []
  try {
    applyState(await api<UserState>('/api/ops', { method: 'POST', json: { ops } }))
  } catch {
    // Offline: they are sent again with the next ones.
    pendingOps = [...ops, ...pendingOps]
    flushTimer = window.setTimeout(flush, 30_000)
  }
}

export async function pull() {
  if (!app.username || pendingOps.length) return
  try { applyState(await api<UserState>(`/api/state?since=${app.revision}`)) } catch { /* next time */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { savePosition(true); flush() } else pull()
})
window.setInterval(() => {
  // Programmes in progress move on, positions are saved, other devices' changes arrive.
  app.epgVersion++
  savePosition()
  if (document.visibilityState === 'visible') pull()
  emit()
}, 30_000)

export const resumeMs = (key: string) => resumeOf(app.pos, key)
export const progress = (key: string) => progressOf(app.pos, key)
export const isWatched = (key: string) => app.pos.watched.has(key)
export const lastEpisode = (seriesId: number) => app.pos.lastEpisode[String(seriesId)] ?? null

function recordPosition(key: string, p: number, d: number): boolean {
  const op = positionOp(key, p, d)
  if (!op) return false
  if (op.op !== 'position') {
    markWatched(key)
    return true
  }
  app.pos.positions = { ...app.pos.positions, [key]: { p: op.p, d: op.d, u: Date.now() } }
  app.pos.watched.delete(key)
  const keys = Object.keys(app.pos.positions)
  if (keys.length > MAX_POSITIONS) {
    keys.sort((a, b) => app.pos.positions[a].u - app.pos.positions[b].u)
    for (const k of keys.slice(0, keys.length - MAX_POSITIONS)) delete app.pos.positions[k]
  }
  queue(op)
  return false
}

function markWatched(key: string) {
  const { [key]: _gone, ...rest } = app.pos.positions
  app.pos.positions = rest
  app.pos.watched.add(key)
  queue({ op: 'watched', key }, true)
}

function setLastEpisode(seriesId: number, id: string) {
  app.pos.lastEpisode = { ...app.pos.lastEpisode, [String(seriesId)]: { id, u: Date.now() } }
  queue({ op: 'lastEpisode', seriesId, id })
}

export function toggleFavorite(ch: Channel) {
  const on = !app.favorites.has(ch.streamId)
  const next = new Set(app.favorites)
  if (on) next.add(ch.streamId)
  else next.delete(ch.streamId)
  app.favorites = next
  queue({ op: 'favorite', streamId: ch.streamId, on }, true)
  emit()
}

// --- "La mia lista" (AppViewModel.kt) ----------------------------------------------------------------

const seriesKey = (s: Series) => `s:${s.seriesId}`

/** The keys of every version of the same title: one of them in the list is enough. */
const movieKeys = (m: Movie) => [...new Set([...(app.movies?.items.filter((x) => x.name === m.name).map((x) => x.key) ?? []), m.key])]
const seriesKeys = (s: Series) => [...new Set([...(app.series?.items.filter((x) => x.name === s.name).map(seriesKey) ?? []), seriesKey(s)])]

export const inMyList = (item: Movie | Series) => ('streamId' in item ? movieKeys(item) : seriesKeys(item)).some((k) => k in app.myList)

function setMyList(keys: string[], key: string, on: boolean) {
  const next = { ...app.myList }
  for (const k of on ? [key] : keys) {
    if (on === k in next) continue
    if (on) next[k] = Date.now()
    else delete next[k]
    queue({ op: 'myList', key: k, on }, true)
  }
  app.myList = next
  app.positionsVersion++
  emit()
}

export function toggleMyList(item: Movie | Series) {
  const on = !inMyList(item)
  if ('streamId' in item) setMyList(movieKeys(item), item.key, on)
  else setMyList(seriesKeys(item), seriesKey(item), on)
}

/** The titles of the list, the last added first. */
const inListOrder = <T>(items: T[], key: (t: T) => string) =>
  items.filter((it) => key(it) in app.myList).sort((a, b) => app.myList[key(b)] - app.myList[key(a)])

/** A film watched to the end, or the last episode of a series, leaves "La mia lista". */
function leaveMyListIfFinished() {
  const p = app.playing
  if (p?.kind === 'Film') setMyList(movieKeys(p.movie), p.movie.key, false)
  if (p?.kind === 'Ep' && !nextEpisode()) {
    // Only with every episode of the series at hand.
    const all = app.seriesInfo?.episodes ?? []
    const last = all.reduce<Episode | null>((a, e) => (!a || e.season > a.season || (e.season === a.season && e.number > a.number) ? e : a), null)
    if (last?.id === p.episode.id) setMyList(seriesKeys(p.series), seriesKey(p.series), false)
  }
}

/** Removes a film from "Continua a guardare" (every version of the same title). */
export function removeMovieFromContinue(e: Entry<Movie>) {
  const positions = { ...app.pos.positions }
  for (const m of e.variants) {
    delete positions[m.key]
    pendingOps.push({ op: 'forgetPosition', key: m.key })
  }
  app.pos.positions = positions
  app.positionsVersion++
  flush()
  emit()
}

export function removeSeriesFromContinue(e: Entry<Series>) {
  const last = { ...app.pos.lastEpisode }
  for (const s of e.variants) {
    delete last[String(s.seriesId)]
    pendingOps.push({ op: 'forgetSeries', seriesId: s.seriesId })
  }
  app.pos.lastEpisode = last
  app.positionsVersion++
  flush()
  emit()
}

// --- lists ------------------------------------------------------------------------------------------

export function channelsFor(categoryId: string): Channel[] {
  const l = app.live
  if (!l) return []
  const list = categoryId === ALL_ID ? l.items : categoryId === FAVORITES_ID ? l.items.filter((c) => app.favorites.has(c.streamId)) : l.byCategory.get(categoryId) ?? []
  return sortChannels(list, sortOf('Live'))
}

export function moviesFor(categoryId: string): Entry<Movie>[] {
  const l = app.movies
  if (!l) return []
  const list = categoryId === ALL_ID ? l.items
    : categoryId === CONTINUE_ID ? l.items.filter((m) => resumeMs(m.key) > 0).sort((a, b) => (app.pos.positions[b.key]?.u ?? 0) - (app.pos.positions[a.key]?.u ?? 0))
      : categoryId === MYLIST_ID ? inListOrder(l.items, (m) => m.key)
        : l.byCategory.get(categoryId) ?? []
  return groupVariants(sortMovies(list, sortOf('Movies')), (m) => m.name)
}

export function seriesFor(categoryId: string): Entry<Series>[] {
  const l = app.series
  if (!l) return []
  const list = categoryId === ALL_ID ? l.items
    : categoryId === CONTINUE_ID ? l.items.flatMap((s) => { const le = lastEpisode(s.seriesId); return le ? [[s, le.u] as const] : [] })
      .sort((a, b) => b[1] - a[1]).map((x) => x[0])
      : categoryId === MYLIST_ID ? inListOrder(l.items, seriesKey)
        : l.byCategory.get(categoryId) ?? []
  return groupVariants(sortSeries(list, sortOf('Series')), (s) => s.name)
}

/** Progress of a grouped title: the furthest of its versions. */
export const entryProgress = (e: Entry<Movie>) => Math.max(...e.variants.map((m) => progress(m.key)))

export function openMovieEntry(e: Entry<Movie>) {
  if (e.variants.length > 1) { app.variantChoice = { kind: 'Films', title: e.item.name, items: e.variants }; emit() } else openMovie(e.item)
}

export function openSeriesEntry(e: Entry<Series>) {
  if (e.variants.length > 1) { app.variantChoice = { kind: 'Shows', title: e.item.name, items: e.variants }; emit() } else openSeries(e.item)
}

export function closeVariants() {
  app.variantChoice = null
  emit()
}

// --- guide ------------------------------------------------------------------------------------------

export const guideOf = (ch: Channel, nowSec = Date.now() / 1000) => nowNext(listFor(ch, app.epg, app.shortEpg), nowSec)

const shortAsked = new Map<number, number>()

/** If xmltv doesn't cover the channel, the short EPG is asked (at most every 20 minutes). */
export function ensureShortEpg(ch: Channel) {
  if (guideOf(ch)[0]) return
  const now = Date.now()
  if (now - (shortAsked.get(ch.streamId) ?? 0) < 20 * 60_000) return
  shortAsked.set(ch.streamId, now)
  api<Programme[]>(`/api/epg/short/${ch.streamId}`).then((list) => {
    app.shortEpg = { ...app.shortEpg, [ch.streamId]: list }
    if (list.length) { app.epgVersion++; emit() }
  }).catch(() => { /* none */ })
}

// --- search -----------------------------------------------------------------------------------------

export function setQuery(q: string) {
  app.searchQuery = q
  if (q.trim() !== '' && app.searchScope !== 'Channels') { ensureMovies(); ensureSeries() }
  emit()
}

export function changeScope(s: SearchScope) {
  app.searchScope = s
  setQuery(app.searchQuery)
}

export const search = (q: string, scope: SearchScope) => searchLib(q, scope, app.live, app.movies, app.series)

export function openCategoryHit(c: CategoryHit) {
  app.section = c.section
  openCategory(c.section, c.id)
}

// --- Cosa guardo? -----------------------------------------------------------------------------------

export function openQuiz() {
  app.quizOpen = true
  // The catalog is needed at the end: it loads while answering.
  ensureMovies()
  ensureSeries()
  emit()
}

export function closeQuiz() {
  app.quizOpen = false
  emit()
}

/** Suggestions for the answers; only new titles (films not started, series never opened). */
export const recommend = (answers: Record<string, string>) => quiz.recommend(
  answers,
  app.movies?.items ?? [], app.movies?.categories ?? [],
  app.series?.items ?? [], app.series?.categories ?? [],
  (p) => (p.kind === 'film' ? progress(p.movie.key) === 0 : lastEpisode(p.series.seriesId) == null),
)

export function openPick(p: quiz.Pick) {
  app.quizOpen = false
  if (p.kind === 'film') openMovie(p.movie)
  else openSeries(p.series)
}

// --- playback ---------------------------------------------------------------------------------------

function autoPlayLast() {
  const id = app.settings.lastStreamId
  if (id == null || app.playing || !app.live) return
  const ch = app.live.items.find((c) => c.streamId === id)
  if (!ch) return
  const list = channelsFor(app.settings.lastCategoryId ?? ALL_ID)
  playChannel(ch, list.some((c) => c.streamId === id) ? list : app.live.items)
}

export function playChannel(ch: Channel, playlist: Channel[]) {
  savePosition()
  cancelCountdown()
  app.playing = { kind: 'Live', channel: ch, playlist }
  app.settings = { ...app.settings, lastStreamId: ch.streamId }
  saveSettings()
  player.play({ kind: 'live', id: ch.streamId })
  ensureShortEpg(ch)
  if (screen().kind !== 'Player') push({ kind: 'Player' })
  emit()
}

/** Next (+1) or previous (-1) channel in the list it was opened from. */
export function zap(delta: number) {
  const p = app.playing
  if (p?.kind !== 'Live' || p.playlist.length === 0) return
  const list = p.playlist
  const i = list.findIndex((c) => c.streamId === p.channel.streamId)
  const n = list.length
  playChannel(list[((((i < 0 ? 0 : i) + delta) % n) + n) % n], list)
}

export function playChannelNumber(num: number): boolean {
  const ch = app.live?.items.find((c) => c.num === num)
  if (!ch) return false
  playChannel(ch, app.playing?.kind === 'Live' ? app.playing.playlist : app.live!.items)
  return true
}

export function openMovie(m: Movie) {
  app.vodInfo = null
  push({ kind: 'MovieDetail', movie: m })
  emit()
  api<VodInfo | null>(`/api/vod/${m.streamId}`).then((v) => { app.vodInfo = v; emit() }).catch(() => { /* no details */ })
}

export function playMovie(m: Movie, fromStart = false) {
  savePosition()
  cancelCountdown()
  app.playing = { kind: 'Film', movie: m }
  player.play({ kind: 'movie', id: String(m.streamId), ext: m.ext }, fromStart ? 0 : resumeMs(m.key))
  if (screen().kind !== 'Player') push({ kind: 'Player' })
  emit()
}

export function openSeries(s: Series) {
  app.seriesInfo = null
  app.seriesInfoLoading = true
  push({ kind: 'SeriesDetail', series: s })
  emit()
  api<SeriesInfo>(`/api/series/${s.seriesId}`)
    .then((info) => { app.seriesInfo = info })
    .catch(() => { toast('Impossibile caricare gli episodi.', true) })
    .finally(() => { app.seriesInfoLoading = false; emit() })
}

/** The episode to resume from: the last opened if not finished, else the next one. */
export function resumeEpisode(eps: Episode[], seriesId: number): Episode | null {
  if (eps.length === 0) return null
  const last = lastEpisode(seriesId)?.id
  if (last == null) return eps[0]
  const i = eps.findIndex((e) => e.id === last)
  if (i < 0) return eps[0]
  return isWatched(`e:${eps[i].id}`) ? eps[i + 1] ?? eps[i] : eps[i]
}

export function playEpisode(s: Series, ep: Episode, episodes: Episode[], fromStart = false) {
  savePosition()
  cancelCountdown()
  app.playing = { kind: 'Ep', series: s, episode: ep, episodes }
  setLastEpisode(s.seriesId, ep.id)
  player.play({ kind: 'series', id: ep.id, ext: ep.extension }, fromStart ? 0 : resumeMs(`e:${ep.id}`))
  if (screen().kind !== 'Player') push({ kind: 'Player' })
  emit()
}

export function nextEpisode(): Episode | null {
  const p = app.playing
  if (p?.kind !== 'Ep') return null
  const i = p.episodes.findIndex((e) => e.id === p.episode.id)
  return p.episodes[i + 1] ?? null
}

/** Next (+1) or previous (-1) episode of the series playing. */
export function playEpisodeOffset(delta: number) {
  const p = app.playing
  if (p?.kind !== 'Ep') return
  const i = p.episodes.findIndex((e) => e.id === p.episode.id)
  const ep = p.episodes[i + delta]
  if (ep) playEpisode(p.series, ep, p.episodes, delta > 0)
}

let countdownTimer: number | undefined

player.onEnded = () => {
  const p = app.playing
  if (p?.kind === 'Film') { markWatched(p.movie.key); leaveMyListIfFinished(); app.positionsVersion++; back(); return }
  if (p?.kind === 'Ep') {
    markWatched(`e:${p.episode.id}`)
    leaveMyListIfFinished()
    app.positionsVersion++
    if (!nextEpisode()) { back(); return }
    // At the end of an episode the next one starts after 10 seconds, unless cancelled.
    app.nextEpisodeCountdown = 10
    emit()
    countdownTimer = window.setInterval(() => {
      if (app.nextEpisodeCountdown == null) return
      if (app.nextEpisodeCountdown <= 1) {
        cancelCountdown()
        playEpisodeOffset(+1)
        return
      }
      app.nextEpisodeCountdown--
      emit()
    }, 1000)
  }
}

player.onFailed = () => {
  toast('Impossibile riprodurre il contenuto.', true)
  if (screen().kind === 'Player') back()
}

export function cancelCountdown() {
  clearInterval(countdownTimer)
  countdownTimer = undefined
  if (app.nextEpisodeCountdown != null) { app.nextEpisodeCountdown = null; emit() }
}

export function savePosition(force = false) {
  const p = app.playing
  const key = p?.kind === 'Film' ? p.movie.key : p?.kind === 'Ep' ? `e:${p.episode.id}` : null
  if (key && player.isActive && player.state !== 'Connecting' && player.state !== 'Reconnecting') {
    if (recordPosition(key, player.currentPosition(), player.currentDuration())) { leaveMyListIfFinished(); app.positionsVersion++ }
  }
  if (force) flush()
}

function leavePlayer() {
  savePosition(true)
  app.positionsVersion++
  cancelCountdown()
  player.stop()
  app.playing = null
}
