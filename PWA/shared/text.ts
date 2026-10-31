// TextHelpers of data/Models.kt: the same rules on the server and in the browser.

const letterOrDigit = /[\p{L}\p{Nd}]/u

/** Minuscolo, senza accenti né punteggiatura: la ricerca non distingue "Città" da "citta". */
export function normalize(s: string): string {
  const d = s.normalize('NFD').replace(/\p{Mn}+/gu, '')
  let out = ''
  for (const c of d) {
    if (letterOrDigit.test(c)) out += c.toLowerCase()
    else if (out.length > 0 && out[out.length - 1] !== ' ') out += ' '
  }
  return out.trim()
}

export function initials(name: string): string {
  const parts = name.split(/[ \-_|:]/).filter((p) => [...p].some((c) => letterOrDigit.test(c)))
  if (parts.length === 0) return 'TV'
  if (parts.length === 1) return [...parts[0]].filter((c) => letterOrDigit.test(c)).slice(0, 2).join('').toUpperCase()
  return parts.slice(0, 2).map((p) => [...p].find((c) => letterOrDigit.test(c))!.toUpperCase()).join('')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function formatTime(ms: number): string {
  const t = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

export function clock(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export const joinMeta = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => p != null && p.trim() !== '').join('  ·  ')

// Sigle di qualità, codifica e lingua che i pannelli aggiungono al titolo ("Film (2020) FHD", "Film 4K HDR").
const qualityTags = new Set([
  '4k', 'uhd', '2160p', 'fhd', '1080p', '1080i', 'hd', '720p', 'sd', '576p', '480p',
  'hdr', 'hdr10', 'dv', 'hevc', 'h265', 'x265', 'h264', 'x264', '10bit',
  '3d', 'ita', 'eng', 'subita', 'multisub', 'bluray', 'bdrip', 'webdl', 'webrip', 'dvdrip',
])
const langPrefix = /^\s*[[(|]?\s*[A-Z]{2,3}\s*[\])|:-]\s*/

/**
 * Chiave per riconoscere lo stesso titolo pubblicato più volte: nome senza sigle di qualità,
 * senza prefisso di lingua ("IT | ") e senza accenti o punteggiatura.
 */
export function variantKey(name: string): string {
  const words = normalize(name.replace(langPrefix, '')).split(' ').filter((w) => w !== '' && !qualityTags.has(w))
  return words.length === 0 ? normalize(name) : words.join(' ')
}

/** Le sigle di qualità presenti nel titolo, per distinguere le versioni ("4K HDR", "FHD"). */
export function qualityOf(name: string): string | null {
  const tags = [...new Set(normalize(name).split(' ').filter((w) => qualityTags.has(w)))]
  return tags.length ? tags.map((t) => t.toUpperCase()).join(' ') : null
}

/** Un titolo nelle liste: se è pubblicato più volte (per esempio in FHD e in 4K) raccoglie tutte le versioni. */
export type Entry<T> = { item: T; variants: T[] }

export const hasVariants = (e: Entry<unknown>) => e.variants.length > 1
export const variantsText = (e: Entry<unknown>) => `${e.variants.length} versioni`

/** Raggruppa le copie dello stesso titolo; resta il primo nell'ordine della lista. */
export function groupVariants<T>(items: T[], name: (t: T) => string): Entry<T>[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const k = variantKey(name(it))
    const g = groups.get(k)
    if (g) g.push(it)
    else groups.set(k, [it])
  }
  return [...groups.values()].map((g) => ({ item: g[0], variants: g }))
}

/** "★ 7.5" con il punto, come String.format(Locale.ROOT, "%.1f"). */
export const ratingText = (r: number) => (r > 0 ? `★ ${r.toFixed(1)}` : null)
