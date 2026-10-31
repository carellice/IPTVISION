// Liste, ordinamenti e ricerca di AppViewModel.kt.
import type { Category, Channel, Movie, Series } from '../../../shared/model.ts'
import { groupVariants, normalize, type Entry } from '../../../shared/text.ts'

export type Section = 'Live' | 'Movies' | 'Series' | 'Search' | 'Settings'
export const sectionTitle: Record<Section, string> = { Live: 'TV in diretta', Movies: 'Film', Series: 'Serie TV', Search: 'Cerca', Settings: 'Impostazioni' }
/** Sezioni del menu: i download non ci sono nella versione web. */
export const sections: Section[] = ['Live', 'Movies', 'Series', 'Search', 'Settings']

export type ListSort = 'Default' | 'Number' | 'NameAsc' | 'NameDesc' | 'Recent' | 'Year' | 'Rating'
export const sortLabel: Record<ListSort, string> = {
  Default: 'Predefinito', Number: 'Numero', NameAsc: 'Nome (A-Z)', NameDesc: 'Nome (Z-A)',
  Recent: 'Aggiunti di recente', Year: 'Anno (più recenti)', Rating: 'Voto',
}
export function sortOptionsFor(section: Section): ListSort[] {
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

export function library<T>(cats: Category[], items: T[], catOf: (t: T) => string | null, hideAdult: boolean): Library<T> {
  // "Nascondi XXX": via le categorie con XXX nel nome e tutto il loro contenuto, anche da Tutti e dalla ricerca.
  const hidden = hideAdult ? new Set(cats.filter((c) => c.name.toLowerCase().includes('xxx')).map((c) => c.id)) : new Set<string>()
  const visible = hidden.size === 0 ? items : items.filter((it) => !hidden.has(catOf(it) ?? '\u0000'))
  const by = new Map<string | null, T[]>()
  for (const it of visible) {
    const k = catOf(it)
    const l = by.get(k)
    if (l) l.push(it)
    else by.set(k, [it])
  }
  return { categories: cats.filter((c) => !hidden.has(c.id) && (by.get(c.id)?.length ?? 0) > 0), items: visible, byCategory: by }
}

// Kotlin sortedBy on strings: compares UTF-16 code units, stable.
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const yearValue = (y: string | null) => { const n = Number(y); return Number.isInteger(n) ? n : 0 }

export function sortChannels(list: Channel[], sort: ListSort): Channel[] {
  if (sort === 'Number') return [...list].sort((a, b) => (a.num <= 0 ? Infinity : a.num) - (b.num <= 0 ? Infinity : b.num))
  if (sort === 'NameAsc') return [...list].sort((a, b) => cmpStr(a.searchKey, b.searchKey))
  if (sort === 'NameDesc') return [...list].sort((a, b) => cmpStr(b.searchKey, a.searchKey))
  return list
}

export function sortMovies(list: Movie[], sort: ListSort): Movie[] {
  switch (sort) {
    case 'Recent': return [...list].sort((a, b) => b.added - a.added)
    case 'NameAsc': return [...list].sort((a, b) => cmpStr(a.searchKey, b.searchKey))
    case 'NameDesc': return [...list].sort((a, b) => cmpStr(b.searchKey, a.searchKey))
    case 'Year': return [...list].sort((a, b) => yearValue(b.year) - yearValue(a.year) || cmpStr(a.searchKey, b.searchKey))
    case 'Rating': return [...list].sort((a, b) => b.rating - a.rating || cmpStr(a.searchKey, b.searchKey))
    default: return list
  }
}

export function sortSeries(list: Series[], sort: ListSort): Series[] {
  switch (sort) {
    case 'NameAsc': return [...list].sort((a, b) => cmpStr(a.searchKey, b.searchKey))
    case 'NameDesc': return [...list].sort((a, b) => cmpStr(b.searchKey, a.searchKey))
    case 'Year': return [...list].sort((a, b) => yearValue(b.year) - yearValue(a.year) || cmpStr(a.searchKey, b.searchKey))
    case 'Rating': return [...list].sort((a, b) => b.rating - a.rating || cmpStr(a.searchKey, b.searchKey))
    default: return list
  }
}

/** Una categoria trovata dalla ricerca: aprendola si va alla sezione con quella categoria. */
export type CategoryHit = { section: Section; id: string; name: string; count: number }

export type SearchResults = { channels: Channel[]; movies: Entry<Movie>[]; series: Entry<Series>[]; categories: CategoryHit[]; total: number }

export function search(q: string, scope: SearchScope, live: Library<Channel> | null, movies: Library<Movie> | null, series: Library<Series> | null): SearchResults {
  const tokens = normalize(q).split(' ').filter((t) => t !== '')
  if (tokens.length === 0) return { channels: [], movies: [], series: [], categories: [], total: 0 }
  const ok = (key: string) => tokens.every((t) => key.includes(t))
  const wants = (s: SearchScope) => scope === 'All' || scope === s
  // Anche le categorie con almeno un contenuto: "azione", "sport", "bambini"...
  const cats = <T,>(sec: Section, l: Library<T> | null): CategoryHit[] => (l?.categories ?? []).flatMap((c) => {
    const n = l!.byCategory.get(c.id)?.length ?? 0
    return n > 0 && ok(normalize(c.name)) ? [{ section: sec, id: c.id, name: c.name, count: n }] : []
  })
  const categories = [
    ...(wants('Channels') ? cats('Live', live) : []),
    ...(wants('Movies') ? cats('Movies', movies) : []),
    ...(wants('Series') ? cats('Series', series) : []),
  ].slice(0, 60)
  // Le copie dello stesso titolo diventano un solo risultato.
  const channels = wants('Channels') ? (live?.items ?? []).filter((c) => ok(c.searchKey)).slice(0, 60) : []
  const ms = wants('Movies') ? groupVariants((movies?.items ?? []).filter((m) => ok(m.searchKey)), (m) => m.name).slice(0, 60) : []
  const ss = wants('Series') ? groupVariants((series?.items ?? []).filter((s) => ok(s.searchKey)), (s) => s.name).slice(0, 60) : []
  return { channels, movies: ms, series: ss, categories, total: channels.length + ms.length + ss.length + categories.length }
}
