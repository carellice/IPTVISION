// The catalog as the screens use it, the same fields as the native data classes (data/Models.kt).
// Lists travel from the server as compact arrays (see the server's lists.ts) and become these.

export type Category = { id: string; name: string }

export type Channel = {
  streamId: number
  num: number
  name: string
  logo: string | null
  categoryId: string | null
  epgId: string | null
  searchKey: string
  initials: string
}

export type Movie = {
  streamId: number
  name: string
  poster: string | null
  categoryId: string | null
  ext: string
  year: string | null
  rating: number
  added: number
  searchKey: string
  initials: string
  key: string
  meta: string
}

export type Series = {
  seriesId: number
  name: string
  cover: string | null
  categoryId: string | null
  year: string | null
  rating: number
  plot: string | null
  genre: string | null
  searchKey: string
  initials: string
  key: string
  meta: string
}

export type Episode = {
  id: string
  seriesId: number
  season: number
  number: number
  title: string
  extension: string
  durationSecs: number
  plot: string | null
  image: string | null
}

/** Unix seconds. */
export type Programme = { start: number; stop: number; title: string; description: string | null }

export type VodInfo = {
  plot: string | null
  genre: string | null
  year: string | null
  duration: string | null
  director: string | null
  cast: string | null
}

export type SeriesInfo = {
  plot: string | null
  genre: string | null
  year: string | null
  cast: string | null
  episodes: Episode[]
}

/** Compact lists sent by GET /api/lists/<kind>: arrays instead of objects, a third of the size. */
export type CompactLive = { categories: [string, string][]; items: [number, number, string, string | null, string | null, string | null][] }
export type CompactMovies = { categories: [string, string][]; items: [number, string, string | null, string | null, string | null, string | null, number, number][] }
export type CompactSeries = { categories: [string, string][]; items: [number, string, string | null, string | null, string | null, number, string | null, string | null][] }

/** Per account data kept on the server: the same shape as the native positions.json, plus favorites. */
export type PositionEntry = { p: number; d: number; u: number }
export type UserState = {
  revision: number
  favorites: number[]
  positions: Record<string, PositionEntry>
  watched: string[]
  lastEpisode: Record<string, { id: string; u: number }>
  hideAdult: boolean
  /** The IPTV account is set (its password never leaves the server). */
  xtream: { server: string; username: string } | null
}

/** One change sent by a client (POST /api/ops), applied with the native rules. */
export type Op =
  | { op: 'position'; key: string; p: number; d: number }
  | { op: 'watched'; key: string }
  | { op: 'forgetPosition'; key: string }
  | { op: 'lastEpisode'; seriesId: number; id: string }
  | { op: 'forgetSeries'; seriesId: number }
  | { op: 'favorite'; streamId: number; on: boolean }
  | { op: 'hideAdult'; on: boolean }
