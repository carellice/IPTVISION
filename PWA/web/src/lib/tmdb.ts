// TMDB (themoviedb.org): artwork, trends and genres for the "Film e serie" screen.
// The key is per device, like the graphic style; the catalog stays the provider's, TMDB only picks and dresses it.
import { useEffect, useState } from 'react'
import type { Movie, Series } from '../../../shared/model.ts'
import { type Entry, groupVariants, variantKey } from '../../../shared/text.ts'

const KEY = 'iptvision.tmdb'

let key = (() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })()

export const tmdbKey = () => key
export const hasTmdb = () => key !== ''

export function setTmdbKey(k: string) {
  key = k.trim()
  try { if (key) localStorage.setItem(KEY, key); else localStorage.removeItem(KEY) } catch { /* private mode */ }
  cache.clear()
}

// --- requests ----------------------------------------------------------------------------------------

// shortcut: answers cached in memory only (a reload asks again, ~60 requests), add IndexedDB if TMDB starts throttling.
const cache = new Map<string, Promise<unknown>>()

function request<T>(k: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  // v4 read access tokens are JWTs ("eyJ..."), v3 API keys are 32 hex characters.
  const bearer = k.startsWith('eyJ')
  const q = new URLSearchParams({ language: 'it-IT', ...Object.fromEntries(Object.entries(params).map(([a, b]) => [a, String(b)])) })
  if (!bearer) q.set('api_key', k)
  const url = `https://api.themoviedb.org/3/${path}?${q}`
  let p = cache.get(url) as Promise<T> | undefined
  if (!p) {
    p = slot(() => fetchJson<T>(url, bearer ? { Authorization: `Bearer ${k}` } : {}))
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}

async function fetchJson<T>(url: string, headers: Record<string, string>, tries = 3): Promise<T> {
  let r: Response
  try { r = await fetch(url, { headers }) } catch { throw new Error('TMDB non raggiungibile.') }
  // Too many requests at once: wait as TMDB says (or a second) and try again.
  if (r.status === 429 && tries > 0) {
    await new Promise((ok) => setTimeout(ok, (Number(r.headers.get('Retry-After')) || 1) * 1000))
    return fetchJson(url, headers, tries - 1)
  }
  if (r.status === 401) throw new Error('Chiave TMDB non valida.')
  if (!r.ok) throw new Error(`TMDB: errore ${r.status}`)
  return r.json() as Promise<T>
}

// At most 6 requests at a time: the home asks ~60 lists and TMDB answers 429 to bursts.
let running = 0
const waiting: (() => void)[] = []
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 6) await new Promise<void>((ok) => waiting.push(ok))
  running++
  try { return await work() } finally {
    running--
    waiting.shift()?.()
  }
}

const get = <T>(path: string, params?: Record<string, string | number>) => request<T>(key, path, params)

/** Throws with the reason if the key doesn't work. */
export const checkKey = (k: string) => request(k.trim(), 'configuration').then(() => undefined)

export const img = (path: string | null | undefined, size: 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original' = 'w342') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null

// --- titles --------------------------------------------------------------------------------------------

export type Kind = 'movie' | 'tv'

export type Tmdb = {
  id: number
  type: Kind
  title: string
  year: string | null
  overview: string
  poster: string | null
  backdrop: string | null
  vote: number
  keys: string[]
}

type Raw = {
  id: number; media_type?: string; title?: string; name?: string; original_title?: string; original_name?: string
  release_date?: string; first_air_date?: string; overview?: string; poster_path?: string | null; backdrop_path?: string | null; vote_average?: number
}
type Page = { results: Raw[] }

/** Same title, whatever the panel added: language prefix, quality tags, year. */
export const matchKey = (name: string) => variantKey(name).replace(/\b(19|20)\d\d\b/g, ' ').replace(/\s+/g, ' ').trim()

function toTmdb(r: Raw, type?: Kind): Tmdb | null {
  const t: Kind | undefined = type ?? (r.media_type === 'movie' ? 'movie' : r.media_type === 'tv' ? 'tv' : undefined)
  if (!t) return null
  const title = r.title ?? r.name ?? ''
  const original = r.original_title ?? r.original_name ?? ''
  const date = r.release_date ?? r.first_air_date ?? ''
  return {
    id: r.id, type: t, title, year: date.slice(0, 4) || null, overview: r.overview ?? '',
    poster: r.poster_path ?? null, backdrop: r.backdrop_path ?? null, vote: r.vote_average ?? 0,
    keys: [...new Set([matchKey(title), matchKey(original)].filter((k) => k !== ''))],
  }
}

// --- the catalog of the provider, findable by title -----------------------------------------------------

/** A title of the catalog with its TMDB card, when found. */
export type Title =
  | { kind: 'movie'; entry: Entry<Movie>; tmdb: Tmdb | null }
  | { kind: 'tv'; entry: Entry<Series>; tmdb: Tmdb | null }

export type CatalogIndex = { movies: Map<string, Entry<Movie>>; series: Map<string, Entry<Series>> }

export function indexCatalog(movies: Movie[], series: Series[]): CatalogIndex {
  const byKey = <T>(entries: Entry<T>[], name: (t: T) => string) => {
    const m = new Map<string, Entry<T>>()
    for (const e of entries) {
      const k = matchKey(name(e.item))
      if (k && !m.has(k)) m.set(k, e)
    }
    return m
  }
  return { movies: byKey(groupVariants(movies, (m) => m.name), (m) => m.name), series: byKey(groupVariants(series, (s) => s.name), (s) => s.name) }
}

/** Remakes share the title: the years must agree when both are known. */
function yearsClose(a: string | null, b: string | null) {
  const x = parseInt(a ?? '', 10)
  const y = parseInt(b ?? '', 10)
  return Number.isNaN(x) || Number.isNaN(y) || Math.abs(x - y) <= 1
}

export function findInCatalog(t: Tmdb, index: CatalogIndex): Title | null {
  for (const k of t.keys) {
    if (t.type === 'movie') {
      const e = index.movies.get(k)
      if (e && yearsClose(e.item.year, t.year)) return { kind: 'movie', entry: e, tmdb: t }
    } else {
      const e = index.series.get(k)
      if (e && yearsClose(e.item.year, t.year)) return { kind: 'tv', entry: e, tmdb: t }
    }
  }
  return null
}

// --- the rows of the home --------------------------------------------------------------------------------

export type TmdbRow = { id: string; title: string; items: Tmdb[]; top?: boolean }

type Source = [Kind, string, Record<string, string | number>?]

const pages = (s: Source, n: number): Source[] => Array.from({ length: n }, (_, i) => [s[0], s[1], { ...s[2], page: i + 1 }])

const discover = (type: Kind, genre: number): Source => [type, `discover/${type}`, {
  with_genres: genre, sort_by: 'popularity.desc', 'vote_count.gte': type === 'movie' ? 150 : 60,
}]

/** Title, movie genre, tv genre (the two lists of genres of TMDB differ). */
const genres: [string, number | null, number | null][] = [
  ['Azione e avventura', 28, 10759], ['Commedie', 35, 35], ['Fantascienza e fantasy', 878, 10765], ['Crime', 80, 80],
  ['Thriller e mistero', 53, 9648], ['Drammi', 18, 18], ['Animazione', 16, 16], ['Horror', 27, null],
  ['Romantici', 10749, null], ['Per tutta la famiglia', 10751, 10751], ['Documentari', 99, 99],
]

const rowDefs: { id: string; title: string; top?: boolean; sources: Source[] }[] = [
  { id: 'top', title: 'Top 10 di oggi', top: true, sources: pages(['movie', 'trending/all/day'], 3) },
  { id: 'trend', title: 'Di tendenza questa settimana', sources: pages(['movie', 'trending/all/week'], 3) },
  { id: 'popm', title: 'Film popolari', sources: pages(['movie', 'movie/popular'], 3) },
  { id: 'popt', title: 'Serie TV popolari', sources: pages(['tv', 'tv/popular'], 3) },
  { id: 'best', title: 'I più acclamati', sources: [...pages(['movie', 'movie/top_rated'], 3), ...pages(['tv', 'tv/top_rated'], 3)] },
  ...genres.map(([title, m, t]) => ({
    id: `g:${title}`, title,
    sources: [...(m ? pages(discover('movie', m), 2) : []), ...(t ? pages(discover('tv', t), 2) : [])],
  })),
]

/** Movie and tv lists side by side: first of one, first of the other, and so on. */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i])
  return out
}

export async function loadRows(): Promise<TmdbRow[]> {
  return Promise.all(rowDefs.map(async (d) => {
    const answers = await Promise.all(d.sources.map(([type, path, params]) => get<Page>(path, params)
      // trending/all mixes both: the kind comes with each result.
      .then((p) => p.results.map((r) => toTmdb(r, path.startsWith('trending') ? undefined : type)).filter((t): t is Tmdb => t != null))
      .catch(() => [] as Tmdb[])))
    // Pages of the same kind in a row, then the two kinds side by side.
    const byKind = [answers.filter((_, i) => d.sources[i][0] === 'movie').flat(), answers.filter((_, i) => d.sources[i][0] === 'tv').flat()]
    return { id: d.id, title: d.title, top: d.top, items: d.sources.some(([, p]) => p.startsWith('trending')) ? answers.flat() : interleave(byKind) }
  }))
}

/** The TMDB card of one catalog title (continue watching, detail screens), asked once per title. */
export function lookup(type: Kind, name: string, year: string | null): Promise<Tmdb | null> {
  const query = matchKey(name)
  if (!query || !key) return Promise.resolve(null)
  return get<Page>(`search/${type}`, { query }).then((p) => {
    const list = p.results.map((r) => toTmdb(r, type)).filter((t): t is Tmdb => t != null && t.keys.includes(query))
    return list.find((t) => year && t.year === year.slice(0, 4)) ?? list[0] ?? null
  }).catch(() => null)
}

/** The card already known (from the rows), else asked to TMDB; nothing when `enabled` is false. */
export function useLookup(type: Kind, name: string, year: string | null, known?: Tmdb | null, enabled = true): Tmdb | null {
  const [t, setT] = useState<Tmdb | null>(known ?? null)
  useEffect(() => {
    if (known || !enabled) { setT(known ?? null); return }
    let alive = true
    setT(null)
    lookup(type, name, year).then((r) => { if (alive) setT(r) })
    return () => { alive = false }
  }, [type, name, year, known, enabled, key])
  return t
}
