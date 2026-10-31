// AppViewModel.kt nel browser: stato dell'app, navigazione, liste, riproduzione e posizioni.
// Le schermate leggono `vm` e si ridisegnano a ogni emit(), come con mutableStateOf in Compose.
import { useSyncExternalStore } from 'react'
import type { AppState } from '../../../shared/api.ts'
import {
  channelOf, episodeKey, movieOf, seriesOf,
  type Category, type Channel, type ChannelRow, type Episode, type LibraryPayload, type Movie, type MovieRow,
  type Programme, type Series, type SeriesInfo, type SeriesRow, type VodInfo,
} from '../../../shared/model.ts'
import * as P from '../../../shared/positions.ts'
import * as Quiz from '../../../shared/quiz.ts'
import { groupVariants, type Entry } from '../../../shared/text.ts'
import { api, ApiError } from './api.ts'
import {
  ALL_ID, CONTINUE_ID, FAVORITES_ID, library, search, sortChannels, sortMovies, sortSeries,
  type CategoryHit, type Library, type ListSort, type SearchScope, type Section,
} from './library.ts'
import { player } from './player.ts'
import { isGridDefault, loadSettings, saveSettings, type DeviceSettings } from './settings.ts'
import { toast } from '../components/ui.tsx'
import { consumeBack, hasBackHandlers, setBackListener } from './back.ts'

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

/** Un titolo pubblicato più volte: si sceglie quale versione aprire. */
export type VariantChoice = { kind: 'Films'; title: string; items: Movie[] } | { kind: 'Shows'; title: string; items: Series[] }

type Raw<T> = { categories: Category[]; items: T[] } | null

const listeners = new Set<() => void>()
let version = 0

class AppViewModel {
  // ---------- PWA account ----------
  username = ''
  serverVersion = ''

  // ---------- Stato ----------
  ffmpeg = false
  account: AppState['account'] = null
  revision = -1
  settings: DeviceSettings = loadSettings('')
  status: string | null = null
  error: string | null = null
  loginBusy = false
  loginError: string | null = null

  stack: Screen[] = [{ kind: 'Login' }]
  section: Section = 'Live'
  private liveOpen: string | null = null
  private moviesOpen: string | null = null
  private seriesOpen: string | null = null
  /** L'ultima categoria aperta per sezione: tornando all'elenco il focus riparte da lì. */
  lastCategory: Partial<Record<Section, string>> = {}

  private rawLive: Raw<Channel> = null
  private rawMovies: Raw<Movie> = null
  private rawSeries: Raw<Series> = null
  live: Library<Channel> | null = null
  movies: Library<Movie> | null = null
  series: Library<Series> | null = null
  moviesLoading = false
  seriesLoading = false

  favorites = new Set<number>()
  positions: P.PositionsData = P.emptyPositions()
  /** Cambia quando la guida TV o le posizioni si aggiornano: le liste si ridisegnano. */
  epgVersion = 0
  positionsVersion = 0

  private epgById = new Map<string, Programme[]>()
  private shortEpg = new Map<number, { at: number; list: Programme[] }>()

  variantChoice: VariantChoice | null = null
  quizOpen = false

  playing: Playing | null = null
  vodInfo: VodInfo | null = null
  seriesInfo: SeriesInfo | null = null
  seriesInfoLoading = false
  nextEpisodeCountdown: number | null = null
  private countdownTimer: number | null = null

  searchQuery = ''
  searchScope: SearchScope = 'All'

  private accountToken = 0

  constructor() {
    player.onEnded = () => this.onPlaybackEnded()
    player.onFailed = () => { toast('Impossibile riprodurre il contenuto.', true); this.back() }
    window.setInterval(() => {
      // Avanzamento dei programmi in onda e salvataggio periodico delle posizioni.
      this.epgVersion++
      this.savePosition()
      this.emit()
    }, 30_000)
    window.setInterval(() => { void this.syncState() }, 30_000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.syncState() })
  }

  emit() {
    version++
    listeners.forEach((l) => l())
    syncHistory()
  }

  // ---------- Navigazione ----------
  get screen(): Screen { return this.stack[this.stack.length - 1] }

  push(s: Screen) { this.stack = [...this.stack, s]; this.emit() }

  /** Restituisce false se non c'è niente da chiudere. */
  back(): boolean {
    if (consumeBack()) return true
    if (this.quizOpen) { this.quizOpen = false; this.emit(); return true }
    if (this.variantChoice) { this.variantChoice = null; this.emit(); return true }
    if (this.stack.length > 1) {
      const top = this.stack[this.stack.length - 1]
      this.stack = this.stack.slice(0, -1)
      if (top.kind === 'Player') this.leavePlayer()
      this.emit()
      return true
    }
    if (this.screen.kind === 'Home' && this.openCategory(this.section) != null) { this.closeCategory(this.section); return true }
    if (this.screen.kind === 'Home' && this.section !== 'Live') { this.setSection('Live'); return true }
    return false
  }

  /** C'è qualcosa da chiudere con Indietro prima di uscire dall'app. */
  get canGoBack(): boolean {
    return hasBackHandlers() || this.quizOpen || this.variantChoice != null || this.stack.length > 1 ||
      (this.screen.kind === 'Home' && (this.openCategory(this.section) != null || this.section !== 'Live'))
  }

  setSection(s: Section) {
    this.section = s
    if (s === 'Movies') this.ensureMovies()
    if (s === 'Series') this.ensureSeries()
    this.emit()
  }

  openCategory(s: Section): string | null {
    return s === 'Live' ? this.liveOpen : s === 'Movies' ? this.moviesOpen : s === 'Series' ? this.seriesOpen : null
  }

  openCategoryId(s: Section, id: string) {
    this.lastCategory[s] = id
    if (s === 'Live') { this.liveOpen = id; this.settings.lastCategoryId = id; saveSettings(this.settings) }
    if (s === 'Movies') this.moviesOpen = id
    if (s === 'Series') this.seriesOpen = id
    this.emit()
  }

  closeCategory(s: Section) {
    if (s === 'Live') this.liveOpen = null
    if (s === 'Movies') this.moviesOpen = null
    if (s === 'Series') this.seriesOpen = null
    this.emit()
  }

  // ---------- Ordinamento ed elenco/griglia, ricordati per sezione ----------
  sortOf(s: Section): ListSort { return (this.settings.sorts[s] as ListSort | undefined) ?? 'Default' }
  setSort(s: Section, v: ListSort) { this.settings.sorts = { ...this.settings.sorts, [s]: v }; saveSettings(this.settings); this.emit() }
  isGrid(s: Section): boolean { return this.settings.grids[s] ?? isGridDefault(s) }
  setGrid(s: Section, v: boolean) { this.settings.grids = { ...this.settings.grids, [s]: v }; saveSettings(this.settings); this.emit() }

  updateSettings(change: Partial<DeviceSettings>) {
    this.settings = { ...this.settings, ...change }
    saveSettings(this.settings)
    this.emit()
  }

  // ---------- Sessione e stato dal server ----------
  async start(username: string, serverVersion: string) {
    this.username = username
    this.serverVersion = serverVersion
    this.settings = loadSettings(username)
    const s = await api<AppState>('/api/state')
    this.applyState(s)
    if (this.account) {
      this.stack = [{ kind: 'Home' }]
      this.openAccount(this.settings.autoPlayLastChannel)
    } else {
      this.stack = [{ kind: 'Login' }]
    }
    this.emit()
  }

  private applyState(s: AppState) {
    this.revision = s.revision
    this.account = s.account
    this.ffmpeg = s.ffmpeg
    this.favorites = new Set(s.favorites)
    this.positions = s.positions
    this.positionsVersion++
  }

  /** Preferiti e posizioni cambiati da un altro dispositivo dello stesso account. */
  private async syncState() {
    if (!this.username || this.revision < 0) return
    try {
      const s = await api<AppState & { unchanged?: boolean }>(`/api/state?since=${this.revision}`)
      if (s.unchanged) return
      const hadAccount = this.account != null
      this.applyState(s)
      if (hadAccount && !this.account) this.resetAccount()
      this.emit()
    } catch { /* offline: si riprova */ }
  }

  // ---------- Account IPTV ----------
  async login(server: string, user: string, pass: string) {
    this.loginBusy = true
    this.loginError = null
    this.emit()
    try {
      const s = await api<AppState>('/api/xtream/login', { method: 'POST', json: { server, username: user, password: pass } })
      this.applyState(s)
      this.stack = [{ kind: 'Home' }]
      this.section = 'Live'
      this.openAccount(false)
    } catch (e) {
      this.loginError = e instanceof ApiError ? e.message : 'Impossibile contattare il server. Controlla la connessione.'
    } finally {
      this.loginBusy = false
      this.emit()
    }
  }

  async logout() {
    try {
      const s = await api<AppState>('/api/xtream/logout', { method: 'POST' })
      this.applyState(s)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Errore', true)
      return
    }
    this.settings.lastStreamId = null
    this.settings.lastCategoryId = null
    saveSettings(this.settings)
    this.resetAccount()
    this.emit()
  }

  private resetAccount() {
    player.stop()
    this.playing = null
    this.accountToken++
    this.rawLive = this.rawMovies = this.rawSeries = null
    this.live = this.movies = this.series = null
    this.liveOpen = this.moviesOpen = this.seriesOpen = null
    this.epgById.clear()
    this.shortEpg.clear()
    this.stack = [{ kind: 'Login' }]
  }

  private openAccount(autoPlay: boolean) {
    const token = ++this.accountToken
    void (async () => {
      // Prima la lista salvata: l'app è pronta subito, anche se il server IPTV è lento.
      let cached: LibraryPayload<ChannelRow> | null = null
      try { cached = await api<LibraryPayload<ChannelRow> | null>('/api/library/live?cached=1') } catch { /* nessuna copia */ }
      if (token !== this.accountToken) return
      if (cached) {
        this.setLive(cached)
        if (autoPlay) this.autoPlayLast()
        void this.loadEpg(false)
      }
      this.status = cached ? null : 'Caricamento canali…'
      this.emit()
      try {
        const fresh = await api<LibraryPayload<ChannelRow>>('/api/library/live')
        if (token !== this.accountToken) return
        this.setLive(fresh)
        if (!cached) {
          if (autoPlay) this.autoPlayLast()
          void this.loadEpg(false)
        }
        this.status = null
      } catch (e) {
        if (token !== this.accountToken) return
        this.status = null
        if (!cached || (e instanceof ApiError && e.status === 403)) this.error = e instanceof ApiError ? e.message : 'Impossibile caricare i canali.'
      }
      this.emit()
    })()
  }

  private setLive(p: LibraryPayload<ChannelRow>) {
    this.rawLive = { categories: p.categories.map(([id, name]) => ({ id, name })), items: p.items.map(channelOf) }
    this.rebuild()
  }

  private rebuild() {
    const h = this.settings.hideAdult
    this.live = this.rawLive ? library(this.rawLive.categories, this.rawLive.items, (c) => c.categoryId, h) : null
    this.movies = this.rawMovies ? library(this.rawMovies.categories, this.rawMovies.items, (m) => m.categoryId, h) : null
    this.series = this.rawSeries ? library(this.rawSeries.categories, this.rawSeries.items, (s) => s.categoryId, h) : null
  }

  async refreshAll() {
    try {
      await api('/api/library/refresh', { method: 'POST' })
    } catch { /* si riscarica comunque */ }
    this.rawMovies = this.rawSeries = null
    this.movies = this.series = null
    this.openAccount(false)
    void this.loadEpg(true)
    if (this.section === 'Movies') this.ensureMovies()
    if (this.section === 'Series') this.ensureSeries()
    this.emit()
  }

  async clearCache() {
    try { await api('/api/cache/clear', { method: 'POST' }) } catch { /* niente */ }
    this.epgById.clear()
    this.shortEpg.clear()
    await this.refreshAll()
  }

  setHideAdult(value: boolean) {
    this.settings.hideAdult = value
    saveSettings(this.settings)
    this.liveOpen = this.moviesOpen = this.seriesOpen = null
    this.rebuild()
    this.emit()
  }

  ensureMovies() {
    if (!this.account || this.rawMovies || this.moviesLoading) return
    this.moviesLoading = true
    const token = this.accountToken
    api<LibraryPayload<MovieRow>>('/api/library/vod')
      .then((p) => {
        if (token !== this.accountToken) return
        this.rawMovies = { categories: p.categories.map(([id, name]) => ({ id, name })), items: p.items.map(movieOf) }
        this.rebuild()
      })
      .catch((e) => { this.error = e instanceof ApiError ? e.message : 'Impossibile caricare i film.' })
      .finally(() => { this.moviesLoading = false; this.emit() })
    this.emit()
  }

  ensureSeries() {
    if (!this.account || this.rawSeries || this.seriesLoading) return
    this.seriesLoading = true
    const token = this.accountToken
    api<LibraryPayload<SeriesRow>>('/api/library/series')
      .then((p) => {
        if (token !== this.accountToken) return
        this.rawSeries = { categories: p.categories.map(([id, name]) => ({ id, name })), items: p.items.map(seriesOf) }
        this.rebuild()
      })
      .catch((e) => { this.error = e instanceof ApiError ? e.message : 'Impossibile caricare le serie.' })
      .finally(() => { this.seriesLoading = false; this.emit() })
    this.emit()
  }

  // ---------- Guida TV ----------
  private async loadEpg(force: boolean) {
    try {
      const r = await api<{ savedAt: number; data: Record<string, [number, number, string][]> }>(`/api/epg${force ? '?force=1' : ''}`)
      const map = new Map<string, Programme[]>()
      for (const [k, rows] of Object.entries(r.data)) map.set(k, rows.map(([start, stop, title]) => ({ start, stop, title })))
      this.epgById = map
      this.epgVersion++
      this.emit()
    } catch { /* senza guida */ }
  }

  private listFor(ch: Channel): Programme[] | null {
    if (ch.epgId) {
      const l = this.epgById.get(ch.epgId.toLowerCase())
      if (l && l.length) return l
    }
    return this.shortEpg.get(ch.streamId)?.list ?? null
  }

  nowNext(ch: Channel, nowSec = Date.now() / 1000): [Programme | null, Programme | null] {
    const list = this.listFor(ch)
    if (!list) return [null, null]
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (p.start <= nowSec && p.stop > nowSec) return [p, list[i + 1] ?? null]
      if (p.start > nowSec) return [null, p]
    }
    return [null, null]
  }

  /** Se xmltv non copre il canale, chiede l'EPG breve (al massimo ogni 20 minuti). */
  ensureShortEpg(ch: Channel) {
    if (this.nowNext(ch)[0]) return
    const known = this.shortEpg.get(ch.streamId)
    if (known && Date.now() - known.at < 20 * 60_000) return
    this.shortEpg.set(ch.streamId, { at: Date.now(), list: known?.list ?? [] })
    api<Programme[]>(`/api/epg/short/${ch.streamId}`)
      .then((list) => { this.shortEpg.set(ch.streamId, { at: Date.now(), list }); if (list.length) { this.epgVersion++; this.emit() } })
      .catch(() => { /* EPG breve non disponibile */ })
  }

  // ---------- Liste ----------
  channelsFor(categoryId: string): Channel[] {
    const l = this.live
    if (!l) return []
    const list = categoryId === ALL_ID ? l.items : categoryId === FAVORITES_ID ? l.items.filter((c) => this.favorites.has(c.streamId)) : l.byCategory.get(categoryId) ?? []
    return sortChannels(list, this.sortOf('Live'))
  }

  moviesFor(categoryId: string): Entry<Movie>[] {
    const l = this.movies
    if (!l) return []
    const list = categoryId === ALL_ID ? l.items
      : categoryId === CONTINUE_ID ? l.items.filter((m) => P.resumeMs(this.positions, m.key) > 0).sort((a, b) => (P.updatedAt(this.positions, b.key) ?? 0) - (P.updatedAt(this.positions, a.key) ?? 0))
      : l.byCategory.get(categoryId) ?? []
    return groupVariants(sortMovies(list, this.sortOf('Movies')), (m) => m.name)
  }

  seriesFor(categoryId: string): Entry<Series>[] {
    const l = this.series
    if (!l) return []
    const list = categoryId === ALL_ID ? l.items
      : categoryId === CONTINUE_ID ? l.items.flatMap((s) => { const le = P.lastEpisode(this.positions, s.seriesId); return le ? [{ s, u: le.u }] : [] }).sort((a, b) => b.u - a.u).map((x) => x.s)
      : l.byCategory.get(categoryId) ?? []
    return groupVariants(sortSeries(list, this.sortOf('Series')), (s) => s.name)
  }

  /** Avanzamento di un titolo raggruppato: il più avanti tra le sue versioni. */
  progressOf(e: Entry<Movie>): number { return Math.max(...e.variants.map((m) => P.progress(this.positions, m.key))) }
  progress(key: string) { return P.progress(this.positions, key) }
  resumeMs(key: string) { return P.resumeMs(this.positions, key) }

  private applyPositions(r: { positions: P.PositionsData; revision: number }) {
    this.positions = r.positions
    this.revision = r.revision
    this.positionsVersion++
    this.emit()
  }

  private postPositions(path: string, body: unknown) {
    api<{ positions: P.PositionsData; revision: number }>(path, { method: 'POST', json: body })
      .then((r) => this.applyPositions(r))
      .catch(() => { /* resta la copia locale */ })
  }

  /** Toglie un film da "Continua a guardare" (tutte le versioni dello stesso titolo). */
  removeMovieFromContinue(e: Entry<Movie>) {
    for (const m of e.variants) P.forgetPosition(this.positions, m.key)
    this.positionsVersion++
    this.emit()
    this.postPositions('/api/positions/remove', { keys: e.variants.map((m) => m.key) })
  }

  /** Toglie una serie da "Continua a guardare" (tutte le versioni dello stesso titolo). */
  removeSeriesFromContinue(e: Entry<Series>) {
    for (const s of e.variants) P.forgetSeries(this.positions, s.seriesId)
    this.positionsVersion++
    this.emit()
    this.postPositions('/api/positions/remove', { seriesIds: e.variants.map((s) => s.seriesId) })
  }

  toggleFavorite(ch: Channel) {
    const on = !this.favorites.has(ch.streamId)
    const next = new Set(this.favorites)
    if (on) next.add(ch.streamId)
    else next.delete(ch.streamId)
    this.favorites = next
    this.emit()
    api<{ favorites: number[]; revision: number }>('/api/favorites', { method: 'POST', json: { streamId: ch.streamId, on } })
      .then((r) => { this.revision = r.revision })
      .catch(() => toast('Impossibile salvare il preferito.'))
  }

  openMovieEntry(e: Entry<Movie>) {
    if (e.variants.length > 1) { this.variantChoice = { kind: 'Films', title: e.item.name, items: e.variants }; this.emit() } else this.openMovie(e.item)
  }

  openSeriesEntry(e: Entry<Series>) {
    if (e.variants.length > 1) { this.variantChoice = { kind: 'Shows', title: e.item.name, items: e.variants }; this.emit() } else this.openSeries(e.item)
  }

  // ---------- Cosa guardo? ----------
  openQuiz() {
    this.quizOpen = true
    // Il catalogo serve alla fine: si carica mentre si risponde.
    this.ensureMovies()
    this.ensureSeries()
    this.emit()
  }

  /** Consigli per le risposte date; solo titoli nuovi (film non iniziati, serie mai aperte). */
  recommend(answers: Record<string, string>): Quiz.QuizResult {
    return Quiz.recommend(
      answers,
      this.movies?.items ?? [], this.movies?.categories ?? [],
      this.series?.items ?? [], this.series?.categories ?? [],
      (p) => (p.kind === 'film' ? P.progress(this.positions, p.movie.key) === 0 : P.lastEpisode(this.positions, p.series.seriesId) == null),
    )
  }

  openPick(p: Quiz.Pick) {
    this.quizOpen = false
    if (p.kind === 'film') this.openMovie(p.movie)
    else this.openSeries(p.series)
  }

  // ---------- Ricerca ----------
  openCategoryHit(c: CategoryHit) {
    this.setSection(c.section)
    this.openCategoryId(c.section, c.id)
  }

  setQuery(q: string) {
    this.searchQuery = q
    if (q.trim() !== '' && this.searchScope !== 'Channels') { this.ensureMovies(); this.ensureSeries() }
    this.emit()
  }

  changeScope(s: SearchScope) {
    this.searchScope = s
    this.setQuery(this.searchQuery)
  }

  search(q: string, scope: SearchScope) { return search(q, scope, this.live, this.movies, this.series) }

  // ---------- Riproduzione ----------
  private autoPlayLast() {
    const id = this.settings.lastStreamId
    if (id == null || this.playing) return
    const ch = this.live?.items.find((c) => c.streamId === id)
    if (!ch) return
    const cat = this.settings.lastCategoryId ?? ALL_ID
    const list = this.channelsFor(cat)
    this.playChannel(ch, list.some((c) => c.streamId === id) ? list : this.live!.items)
  }

  playChannel(ch: Channel, playlist: Channel[]) {
    this.savePosition()
    this.cancelCountdown()
    this.playing = { kind: 'Live', channel: ch, playlist }
    this.settings.lastStreamId = ch.streamId
    saveSettings(this.settings)
    void player.play({ kind: 'live', id: ch.streamId, fmt: this.settings.outputFormat, aac: this.ffmpeg && this.settings.convertLiveAudio }, true, 0, this.ffmpeg)
    this.ensureShortEpg(ch)
    if (this.screen.kind !== 'Player') this.push({ kind: 'Player' })
    else this.emit()
  }

  /** Canale successivo (+1) o precedente (-1) nella lista da cui è stato aperto. */
  zap(delta: number) {
    const p = this.playing
    if (p?.kind !== 'Live' || p.playlist.length === 0) return
    const list = p.playlist
    const i = list.findIndex((c) => c.streamId === p.channel.streamId)
    const n = list.length
    this.playChannel(list[((((i < 0 ? 0 : i) + delta) % n) + n) % n], list)
  }

  playChannelNumber(num: number): boolean {
    const ch = this.live?.items.find((c) => c.num === num)
    if (!ch) return false
    this.playChannel(ch, this.playing?.kind === 'Live' ? this.playing.playlist : this.live!.items)
    return true
  }

  openMovie(m: Movie) {
    this.vodInfo = null
    this.push({ kind: 'MovieDetail', movie: m })
    api<VodInfo | null>(`/api/vod/${m.streamId}`).then((i) => { this.vodInfo = i; this.emit() }).catch(() => { /* senza dettagli */ })
  }

  playMovie(m: Movie, fromStart = false) {
    this.savePosition()
    this.cancelCountdown()
    this.playing = { kind: 'Film', movie: m }
    void player.play({ kind: 'movie', id: m.streamId, ext: m.ext }, false, fromStart ? 0 : P.resumeMs(this.positions, m.key), this.ffmpeg)
    if (this.screen.kind !== 'Player') this.push({ kind: 'Player' })
    else this.emit()
  }

  openSeries(s: Series) {
    this.seriesInfo = null
    this.seriesInfoLoading = true
    this.push({ kind: 'SeriesDetail', series: s })
    api<SeriesInfo>(`/api/series/${s.seriesId}`)
      .then((i) => { this.seriesInfo = i })
      .catch(() => { this.error = 'Impossibile caricare gli episodi.' })
      .finally(() => { this.seriesInfoLoading = false; this.emit() })
  }

  /** L'episodio da cui riprendere: l'ultimo aperto se non finito, altrimenti il successivo. */
  resumeEpisode(eps: Episode[], seriesId: number): Episode | null {
    if (eps.length === 0) return null
    const last = P.lastEpisode(this.positions, seriesId)?.id
    if (last == null) return eps[0]
    const i = eps.findIndex((e) => e.id === last)
    if (i < 0) return eps[0]
    return P.isWatched(this.positions, episodeKey(eps[i])) ? eps[i + 1] ?? eps[i] : eps[i]
  }

  playEpisode(s: Series, ep: Episode, episodes: Episode[], fromStart = false) {
    this.savePosition()
    this.cancelCountdown()
    this.playing = { kind: 'Ep', series: s, episode: ep, episodes }
    P.setLastEpisode(this.positions, s.seriesId, ep.id)
    this.positionsVersion++
    this.postPositions('/api/positions/last-episode', { seriesId: s.seriesId, episodeId: ep.id })
    void player.play({ kind: 'episode', id: ep.id, ext: ep.extension }, false, fromStart ? 0 : P.resumeMs(this.positions, episodeKey(ep)), this.ffmpeg)
    if (this.screen.kind !== 'Player') this.push({ kind: 'Player' })
    else this.emit()
  }

  nextEpisode(): Episode | null {
    const p = this.playing
    if (p?.kind !== 'Ep') return null
    const i = p.episodes.findIndex((e) => e.id === p.episode.id)
    return p.episodes[i + 1] ?? null
  }

  /** Episodio successivo (+1) o precedente (-1) della serie in riproduzione. */
  playEpisodeOffset(delta: number) {
    const p = this.playing
    if (p?.kind !== 'Ep') return
    const i = p.episodes.findIndex((e) => e.id === p.episode.id)
    const ep = p.episodes[i + delta]
    if (!ep) return
    this.playEpisode(p.series, ep, p.episodes, delta > 0)
  }

  private onPlaybackEnded() {
    const p = this.playing
    if (p?.kind === 'Film') {
      this.markWatched(p.movie.key)
      this.back()
    } else if (p?.kind === 'Ep') {
      this.markWatched(episodeKey(p.episode))
      if (!this.nextEpisode()) { this.back(); return }
      // Alla fine di un episodio parte il successivo dopo 10 secondi, annullabile.
      let s = 10
      this.nextEpisodeCountdown = s
      this.emit()
      this.countdownTimer = window.setInterval(() => {
        s--
        if (s <= 0) {
          this.cancelCountdown()
          this.playEpisodeOffset(+1)
        } else {
          this.nextEpisodeCountdown = s
          this.emit()
        }
      }, 1000)
    }
  }

  private markWatched(key: string) {
    P.markWatched(this.positions, key)
    this.positionsVersion++
    this.postPositions('/api/positions/watched', { key })
  }

  cancelCountdown() {
    if (this.countdownTimer != null) clearInterval(this.countdownTimer)
    this.countdownTimer = null
    if (this.nextEpisodeCountdown != null) { this.nextEpisodeCountdown = null; this.emit() }
  }

  savePosition() {
    const p = this.playing
    const key = p?.kind === 'Film' ? p.movie.key : p?.kind === 'Ep' ? episodeKey(p.episode) : null
    if (!key || !player.isActive) return
    const pos = player.positionMs
    const dur = player.durationMs
    if (dur <= 0 || pos <= 0) return
    if (P.update(this.positions, key, pos, dur)) this.positionsVersion++
    this.postPositions('/api/positions/update', { key, p: Math.round(pos), d: Math.round(dur) })
  }

  private leavePlayer() {
    this.savePosition()
    this.positionsVersion++
    this.cancelCountdown()
    player.stop()
    this.playing = null
  }
}

export const vm = new AppViewModel()

export function useVm() {
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => version)
  return vm
}

// ---------- Indietro del telefono e del browser ----------
// Quando c'è qualcosa da chiudere si tiene una voce in più nella cronologia: il gesto Indietro la
// consuma e chiama vm.back(), come BackHandler(enabled = vm.canGoBack) in MainActivity.
let guard = false
let ignorePop = false

function syncHistory() {
  const want = vm.canGoBack && vm.username !== ''
  if (want && !guard) {
    history.pushState({ iptvision: true }, '')
    guard = true
  } else if (!want && guard) {
    guard = false
    ignorePop = true
    history.back()
  }
}

setBackListener(() => syncHistory())

window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return }
  guard = false
  if (vm.canGoBack) vm.back()
  syncHistory()
})
