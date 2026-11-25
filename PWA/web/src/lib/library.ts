import type { Category, Channel, CompactLive, CompactMovies, CompactSeries, Movie, Series } from '../../../shared/model.ts'
import { type Entry, channelKey, groupVariants, initials, joinMeta, normalize, qualityRank, stars, withoutQuality } from '../../../shared/text.ts'

// The catalog as in AppViewModel: libraries per section, the lists of a category with their sort,
// and the search over channels, films, series and categories.

export type Section = 'Live' | 'Movies' | 'Series' | 'Discover' | 'MyList' | 'Search' | 'Settings'

export const sectionTitle: Record<Section, string> = {
  Live: 'TV in diretta', Movies: 'Film', Series: 'Serie TV', Discover: 'Film e serie', MyList: 'La mia lista', Search: 'Cerca', Settings: 'Impostazioni',
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

/**
 * The same channel in several qualities ("Rai 1 FHD", "Rai 1 HD", "Rai 1 4K") becomes one, "Rai 1", with the
 * others in alternates. Grouped inside its category; the favorite version leads, else the first in the list.
 */
export function groupChannels(items: Channel[], favorites: Set<number>, single = false): Channel[] {
  // Single list: the same channel joins across categories too and starts from the best quality;
  // when the stream stalls the player goes round the others, from best to worst.
  const groups = new Map<string, Channel[]>()
  for (const c of items) {
    const k = `${single ? '' : c.categoryId}|${channelKey(c.name)}`
    const g = groups.get(k)
    if (g) g.push(c)
    else groups.set(k, [c])
  }
  return [...groups.values()].map((g0) => {
    const g = single ? [...g0].sort((a, b) => qualityRank(b.name) - qualityRank(a.name)) : g0
    if (g.length === 1) return g[0]
    const main = single ? g[0] : g.find((c) => favorites.has(c.streamId)) ?? g[0]
    const name = withoutQuality(main.name)
    return {
      ...main, name, searchKey: normalize(name), initials: initials(name),
      logo: main.logo ?? g.find((c) => c.logo)?.logo ?? null,
      epgId: main.epgId ?? g.find((c) => c.epgId)?.epgId ?? null,
      alternates: g.filter((c) => c !== main).map((c) => c.streamId),
      ranks: [main, ...g.filter((c) => c !== main)].map((c) => qualityRank(c.name)),
    }
  })
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
  // The same channel in other qualities or categories is one result.
  const seen = new Set<string>()
  const channels = wants('Channels')
    ? (live?.items.filter((c) => {
      const k = channelKey(c.name)
      if (!ok(c.searchKey) || seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 60) ?? [])
    : []
  const ms = wants('Movies') ? groupVariants(movies?.items.filter((m) => ok(m.searchKey)) ?? [], (m) => m.name).slice(0, 60) : []
  const ss = wants('Series') ? groupVariants(series?.items.filter((s) => ok(s.searchKey)) ?? [], (s) => s.name).slice(0, 60) : []
  return { channels, movies: ms, series: ss, categories, total: channels.length + ms.length + ss.length + categories.length }
}
