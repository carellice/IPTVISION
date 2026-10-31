// The data of data/Models.kt, as the server sends it (compact rows) and the browser uses it.
import { initials, joinMeta, normalize, ratingText } from './text.ts'

export type Category = { id: string; name: string }

export type Channel = {
  streamId: number; num: number; name: string; logo: string | null; categoryId: string | null; epgId: string | null
  searchKey: string; initials: string
}

export type Movie = {
  streamId: number; name: string; poster: string | null; categoryId: string | null; extension: string | null
  year: string | null; rating: number; added: number
  searchKey: string; initials: string; key: string; ext: string; meta: string
}

export type Series = {
  seriesId: number; name: string; cover: string | null; categoryId: string | null; year: string | null
  rating: number; plot: string | null; genre: string | null
  searchKey: string; initials: string; key: string; meta: string
}

export type Episode = {
  id: string; seriesId: number; season: number; number: number; title: string; extension: string
  durationSecs: number; plot: string | null; image: string | null
}

export const episodeKey = (e: Episode) => `e:${e.id}`
export const episodeLabel = (e: Episode) => `S${e.season} E${e.number}`
export const episodeTitle = (e: Episode) => e.title.trim() === '' ? `Episodio ${e.number}` : e.title
export const episodeDuration = (e: Episode) => e.durationSecs > 0 ? `${Math.max(1, Math.round(e.durationSecs / 60))} min` : ''

/** Orari in secondi Unix. */
export type Programme = { start: number; stop: number; title: string }

export function progressAt(p: Programme, nowSec: number): number {
  const total = p.stop - p.start
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, (nowSec - p.start) / total))
}

export type VodInfo = { plot: string | null; genre: string | null; year: string | null; duration: string | null; director: string | null; cast: string | null }
export type SeriesInfo = { plot: string | null; genre: string | null; year: string | null; cast: string | null; episodes: Episode[] }

// --- compact rows on the wire -------------------------------------------------------------------

export type ChannelRow = [streamId: number, num: number, name: string, logo: string | null, categoryId: string | null, epgId: string | null]
export type MovieRow = [streamId: number, name: string, poster: string | null, categoryId: string | null, extension: string | null, year: string | null, rating: number, added: number]
export type SeriesRow = [seriesId: number, name: string, cover: string | null, categoryId: string | null, year: string | null, rating: number, plot: string | null, genre: string | null]

export type LibraryKind = 'live' | 'vod' | 'series'
export type LibraryPayload<R> = { savedAt: number; categories: [string, string][]; items: R[] }

export const channelOf = (r: ChannelRow): Channel => ({
  streamId: r[0], num: r[1], name: r[2], logo: r[3], categoryId: r[4], epgId: r[5], searchKey: normalize(r[2]), initials: initials(r[2]),
})

export const movieOf = (r: MovieRow): Movie => ({
  streamId: r[0], name: r[1], poster: r[2], categoryId: r[3], extension: r[4], year: r[5], rating: r[6], added: r[7],
  searchKey: normalize(r[1]), initials: initials(r[1]), key: `m:${r[0]}`, ext: r[4] && r[4].trim() !== '' ? r[4] : 'mp4',
  meta: joinMeta(r[5], ratingText(r[6])),
})

export const seriesOf = (r: SeriesRow): Series => ({
  seriesId: r[0], name: r[1], cover: r[2], categoryId: r[3], year: r[4], rating: r[5], plot: r[6], genre: r[7],
  searchKey: normalize(r[1]), initials: initials(r[1]), key: `s:${r[0]}`, meta: joinMeta(r[4], r[7], ratingText(r[5])),
})
