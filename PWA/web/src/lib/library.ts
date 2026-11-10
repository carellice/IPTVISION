import type { Category, Channel, CompactLive, CompactMovies, CompactSeries, Movie, Series } from '../../../shared/model.ts'
import { type Entry, groupVariants, initials, joinMeta, normalize, stars } from '../../../shared/text.ts'

// The catalog as in AppViewModel: libraries per section, the lists of a category with their sort,
// and the search over channels, films, series and categories.

export type Section = 'Live' | 'Movies' | 'Series' | 'Search' | 'Settings'

export const sectionTitle: Record<Section, string> = {
  Live: 'TV in diretta', Movies: 'Film', Series: 'Serie TV', Search: 'Cerca', Settings: 'Impostazioni',
}

export type ListSort = 'Default' | 'Number' | 'NameAsc' | 'NameDesc' | 'Recent' | 'Year' | 'Rating'

export const sortLabel: Record<ListSort, string> = {
  Default: 'Predefinito', Number: 'Numero', NameAsc: 'Nome (A-Z)', NameDesc: 'Nome (Z-A)',
  Recent: 'Aggiunti di recente', Year: 'Anno (più recenti)', Rating: 'Voto',
}

export function sortOptions(section: Section): ListSort[] {
  if (section === 'Live') return ['Default', 'Number', 'NameAsc', 'NameDesc']
  if (section === 'Movies') return ['Default', 'Recent', 'NameAsc', 'NameDesc', 'Year', 'Rating']
  return ['Default', 'NameAsc', 'NameDesc', 'Year', 'Rating']
}

export type SearchScope = 'All' | 'Channels' | 'Movies' | 'Series'
export const scopeLabel: Record<SearchScope, string> = { All: 'Tutto', Channels: 'Canali', Movies: 'Film', Series: 'Serie' }

export type Library<T> = { categories: Category[]; items: T[]; byCategory: Map<string | null, T[]> }

export const ALL_ID = '__all'
export const FAVORITES_ID = '__fav'
export const CONTINUE_ID = '__continue'
export const MYLIST_ID = '__mylist'

// --- from the compact lists of the server ---------------------------------------------------------

const cats = (c: [string, string][]): Category[] => c.map(([id, name]) => ({ id, name }))

export function toChannels(l: CompactLive): { categories: Category[]; items: Channel[] } {
  return {
    categories: cats(l.categories),
    items: l.items.map(([streamId, num, name, logo, categoryId, epgId]) => ({
      streamId, num, name, logo, categoryId, epgId, searchKey: normalize(name), initials: initials(name),
    })),
  }
}

export function toMovies(l: CompactMovies): { categories: Category[]; items: Movie[] } {
  return {
    categories: cats(l.categories),
    items: l.items.map(([streamId, name, poster, categoryId, extension, year, rating, added]) => ({
      streamId, name, poster, categoryId, ext: extension && extension.trim() ? extension : 'mp4', year, rating, added,
      searchKey: normalize(name), initials: initials(name), key: `m:${streamId}`, meta: joinMeta(year, stars(rating)),
    })),
  }
}

export function toSeries(l: CompactSeries): { categories: Category[]; items: Series[] } {
  return {
    categories: cats(l.categories),
    items: l.items.map(([seriesId, name, cover, categoryId, year, rating, plot, genre]) => ({
      seriesId, name, cover, categoryId, year, rating, plot, genre,
      searchKey: normalize(name), initials: initials(name), key: `s:${seriesId}`, meta: joinMeta(year, genre, stars(rating)),
    })),
  }
}

/** "Nascondi XXX": away the categories with XXX in the name and all they hold, from Tutti and search too. */
export function library<T>(categories: Category[], items: T[], catOf: (t: T) => string | null, hideAdult: boolean): Library<T> {
  const hidden = hideAdult ? new Set(categories.filter((c) => c.name.toLowerCase().includes('xxx')).map((c) => c.id)) : new Set<string>()
  const visible = hidden.size === 0 ? items : items.filter((i) => !hidden.has(catOf(i) ?? ''))
  const by = new Map<string | null, T[]>()
  for (const i of visible) {
    const k = catOf(i)
    const g = by.get(k)
    if (g) g.push(i)
    else by.set(k, [i])
  }
  return { categories: categories.filter((c) => !hidden.has(c.id) && (by.get(c.id)?.length ?? 0) > 0), items: visible, byCategory: by }
}

// --- sorting (Kotlin's sortedBy is stable, like Array.prototype.sort) ---------------------------------

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const yearValue = (y: string | null) => {
  const n = parseInt(y ?? '', 10)
  return Number.isNaN(n) ? 0 : n
}

export function sortChannels(list: Channel[], sort: ListSort): Channel[] {
  switch (sort) {
    case 'Number': return [...list].sort((a, b) => (a.num <= 0 ? Infinity : a.num) - (b.num <= 0 ? Infinity : b.num))
    case 'NameAsc': return [...list].sort((a, b) => cmp(a.searchKey, b.searchKey))
    case 'NameDesc': return [...list].sort((a, b) => cmp(b.searchKey, a.searchKey))
    default: return list
  }
}

export function sortMovies(list: Movie[], sort: ListSort): Movie[] {
  switch (sort) {
    case 'Recent': return [...list].sort((a, b) => b.added - a.added)
    case 'NameAsc': return [...list].sort((a, b) => cmp(a.searchKey, b.searchKey))
    case 'NameDesc': return [...list].sort((a, b) => cmp(b.searchKey, a.searchKey))
    case 'Year': return [...list].sort((a, b) => yearValue(b.year) - yearValue(a.year) || cmp(a.searchKey, b.searchKey))
    case 'Rating': return [...list].sort((a, b) => b.rating - a.rating || cmp(a.searchKey, b.searchKey))
    default: return list
  }
}

export function sortSeries(list: Series[], sort: ListSort): Series[] {
  switch (sort) {
    case 'NameAsc': return [...list].sort((a, b) => cmp(a.searchKey, b.searchKey))
    case 'NameDesc': return [...list].sort((a, b) => cmp(b.searchKey, a.searchKey))
    case 'Year': return [...list].sort((a, b) => yearValue(b.year) - yearValue(a.year) || cmp(a.searchKey, b.searchKey))
    case 'Rating': return [...list].sort((a, b) => b.rating - a.rating || cmp(a.searchKey, b.searchKey))
    default: return list
  }
}

// --- search ------------------------------------------------------------------------------------------

/** A category found by the search: opening it goes to its section with that category open. */
export type CategoryHit = { section: Section; id: string; name: string; count: number }

export type SearchResults = {
  channels: Channel[]
  movies: Entry<Movie>[]
  series: Entry<Series>[]
  categories: CategoryHit[]
  total: number
}

export function search(
  q: string, scope: SearchScope,
  live: Library<Channel> | null, movies: Library<Movie> | null, series: Library<Series> | null,
): SearchResults {
  const tokens = normalize(q).split(' ').filter((t) => t !== '')
  if (tokens.length === 0) return { channels: [], movies: [], series: [], categories: [], total: 0 }
  const ok = (key: string) => tokens.every((t) => key.includes(t))
  const wants = (s: SearchScope) => scope === 'All' || scope === s
  // Categories with at least one item too: "azione", "sport", "bambini"...
  const catHits = <T>(sec: Section, l: Library<T> | null): CategoryHit[] =>
    l?.categories.flatMap((c) => {
      const n = l.byCategory.get(c.id)?.length ?? 0
      return n > 0 && ok(normalize(c.name)) ? [{ section: sec, id: c.id, name: c.name, count: n }] : []
    }) ?? []
  const categories = [
    ...(wants('Channels') ? catHits('Live', live) : []),
    ...(wants('Movies') ? catHits('Movies', movies) : []),
    ...(wants('Series') ? catHits('Series', series) : []),
  ].slice(0, 60)
  // The copies of the same title become one result.
  const channels = wants('Channels') ? (live?.items.filter((c) => ok(c.searchKey)).slice(0, 60) ?? []) : []
  const ms = wants('Movies') ? groupVariants(movies?.items.filter((m) => ok(m.searchKey)) ?? [], (m) => m.name).slice(0, 60) : []
  const ss = wants('Series') ? groupVariants(series?.items.filter((s) => ok(s.searchKey)) ?? [], (s) => s.name).slice(0, 60) : []
  return { channels, movies: ms, series: ss, categories, total: channels.length + ms.length + ss.length + categories.length }
}
