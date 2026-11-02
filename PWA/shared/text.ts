// TextHelpers of the native app (data/Models.kt), line by line.

/** Lowercase, no accents nor punctuation: search doesn't tell "Città" from "citta". */
export function normalize(s: string): string {
  const d = s.normalize('NFD').replace(/\p{Mn}+/gu, '')
  let out = ''
  for (const c of d) {
    if (/[\p{L}\p{N}]/u.test(c)) out += c.toLowerCase()
    else if (out.length > 0 && out[out.length - 1] !== ' ') out += ' '
  }
  return out.trim()
}

const letterOrDigit = (c: string) => /[\p{L}\p{N}]/u.test(c)

export function initials(name: string): string {
  const parts = name.split(/[ \-_|:]/).filter((p) => [...p].some(letterOrDigit))
  if (parts.length === 0) return 'TV'
  if (parts.length === 1) return [...parts[0]].filter(letterOrDigit).slice(0, 2).join('').toUpperCase()
  return parts.slice(0, 2).map((p) => [...p].find(letterOrDigit)!.toUpperCase()).join('')
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(ms: number): string {
  const t = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function clock(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function joinMeta(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p != null && p.trim() !== '').join('  ·  ')
}

// Quality, codec and language tags that panels add to titles ("Film (2020) FHD", "Film 4K HDR").
const qualityTags = new Set([
  '4k', 'uhd', '2160p', 'fhd', '1080p', '1080i', 'hd', '720p', 'sd', '576p', '480p',
  'hdr', 'hdr10', 'dv', 'hevc', 'h265', 'x265', 'h264', 'x264', '10bit',
  '3d', 'ita', 'eng', 'subita', 'multisub', 'bluray', 'bdrip', 'webdl', 'webrip', 'dvdrip',
])
const langPrefix = /^\s*[[(|]?\s*[A-Z]{2,3}\s*[\])|:-]\s*/

/** Key that recognizes the same title published more than once. */
export function variantKey(name: string): string {
  const words = normalize(name.replace(langPrefix, '')).split(' ').filter((w) => w !== '' && !qualityTags.has(w))
  return words.length === 0 ? normalize(name) : words.join(' ')
}

/** The quality tags in the title, to tell the versions apart ("4K HDR", "FHD"). */
export function qualityOf(name: string): string | null {
  const tags = [...new Set(normalize(name).split(' ').filter((w) => qualityTags.has(w)))]
  return tags.length ? tags.map((t) => t.toUpperCase()).join(' ') : null
}

/** A title in the lists: if it is published more than once it collects every version. */
export type Entry<T> = { item: T; variants: T[] }

export const hasVariants = <T>(e: Entry<T>) => e.variants.length > 1
export const variantsText = <T>(e: Entry<T>) => `${e.variants.length} versioni`

/** Groups the copies of the same title; the first in list order stays. */
export function groupVariants<T>(items: T[], name: (t: T) => string): Entry<T>[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const k = variantKey(name(it))
    const g = groups.get(k)
    if (g) g.push(it)
    else groups.set(k, [it])
  }
  return [...groups.values()].map((v) => ({ item: v[0], variants: v }))
}

/** "★ 7.5" like String.format(Locale.ROOT, "%.1f"). */
export const stars = (rating: number) => (rating > 0 ? '★ ' + rating.toFixed(1) : null)

export function episodeLabel(e: { season: number; number: number }) {
  return `S${e.season} E${e.number}`
}

export function episodeTitle(e: { title: string; number: number }) {
  return e.title.trim() === '' ? `Episodio ${e.number}` : e.title
}

export function episodeDuration(e: { durationSecs: number }) {
  return e.durationSecs > 0 ? `${Math.max(1, Math.round(e.durationSecs / 60))} min` : ''
}
