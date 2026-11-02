import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Programme } from '../../shared/model.ts'
import type { XtreamAccount } from './db.ts'
import { cacheDir, compactLive, providerFetch, xmltvUrl } from './xtream.ts'

// TV guide (data/Epg.kt). Main source: xmltv.php, one request for every channel, kept on the
// server for 6 hours. The native apps in server mode get the same file as it is; the browser gets
// it parsed and cut down to its channels and to the hours around now.

const SIX_HOURS = 6 * 3600_000
const downloading = new Map<string, Promise<string | null>>()

/** The provider's xmltv.php saved on the server, or null when the provider has none. */
export function xmltvFile(a: XtreamAccount, force = false): Promise<string | null> {
  const file = join(cacheDir(a), 'xmltv.xml')
  if (!force && existsSync(file) && Date.now() - statSync(file).mtimeMs < SIX_HOURS) return Promise.resolve(file)
  const known = downloading.get(file)
  if (known) return known
  const job = (async () => {
    try {
      const r = await providerFetch(xmltvUrl(a), 180)
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)
      const part = file + '.part'
      await pipeline(Readable.fromWeb(r.body as never), createWriteStream(part))
      if (statSync(part).size < 100) { rmSync(part, { force: true }); throw new Error('Guida vuota') }
      renameSync(part, file)
      return file
    } catch (e) {
      console.warn('Download EPG fallito', (e as Error).message)
      return existsSync(file) ? file : null
    }
  })().finally(() => downloading.delete(file))
  downloading.set(file, job)
  return job
}

/** XMLTV time "20261028203000 +0100" → Unix seconds. */
export function parseXmltvTime(s: string | undefined): number | null {
  if (!s || s.length < 14) return null
  const n = (a: number, b: number) => Number(s.slice(a, b))
  const [y, mo, d, h, mi, se] = [n(0, 4), n(4, 6), n(6, 8), n(8, 10), n(10, 12), n(12, 14)]
  if ([y, mo, d, h, mi, se].some((v) => !Number.isInteger(v))) return null
  let offsetMin = 0
  const rest = s.slice(14).trim()
  if (rest.length >= 5 && (rest[0] === '+' || rest[0] === '-')) {
    const hh = Number(rest.slice(1, 3))
    const mm = Number(rest.slice(3, 5))
    if (Number.isInteger(hh) && Number.isInteger(mm)) offsetMin = (hh * 60 + mm) * (rest[0] === '-' ? -1 : 1)
  }
  return Date.UTC(y, mo - 1, d, h, mi, se) / 1000 - offsetMin * 60
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return entities[e.toLowerCase()] ?? m
    })
    .trim()
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] ?? new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`).exec(tag)?.[1]

/** Reads the guide in pieces (it can be hundreds of MB) and keeps only [wanted] channels near now. */
async function parse(file: string, wanted: Set<string>): Promise<Record<string, Programme[]>> {
  const nowSec = Date.now() / 1000
  const from = nowSec - 3 * 3600
  const to = nowSec + 36 * 3600
  const result: Record<string, Programme[]> = {}
  let buf = ''
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    buf += chunk as string
    let pos = 0
    for (;;) {
      const start = buf.indexOf('<programme', pos)
      if (start < 0) { pos = Math.max(pos, buf.length - 12); break }
      const end = buf.indexOf('</programme>', start)
      if (end < 0) { pos = start; break }
      const block = buf.slice(start, end)
      pos = end + 12
      const open = block.slice(0, block.indexOf('>') + 1)
      const channel = attr(open, 'channel')?.toLowerCase()
      if (!channel || !wanted.has(channel)) continue
      const st = parseXmltvTime(attr(open, 'start'))
      const sp = parseXmltvTime(attr(open, 'stop'))
      if (st == null || sp == null || sp < from || st > to) continue
      const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(block)?.[1]
      const desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(block)?.[1]
      ;(result[channel] ??= []).push({ start: st, stop: sp, title: title ? decode(title) : '', description: desc ? decode(desc) : null })
    }
    buf = buf.slice(pos)
  }
  for (const l of Object.values(result)) l.sort((x, y) => x.start - y.start)
  return result
}

const parsing = new Map<string, Promise<Record<string, Programme[]>>>()

/** The guide of this account's channels, for the browser. Saved for 6 hours like on the phone. */
export function guide(a: XtreamAccount, force = false): Promise<Record<string, Programme[]>> {
  const file = join(cacheDir(a), 'epg.json')
  if (!force && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { savedAt: number; data: Record<string, Programme[]> }
      if (Date.now() - saved.savedAt < SIX_HOURS) return Promise.resolve(saved.data)
    } catch { /* rebuilt below */ }
  }
  const known = parsing.get(file)
  if (known) return known
  const job = (async () => {
    const live = await compactLive(a)
    const wanted = new Set(live.items.map((c) => c[5]).filter((id): id is string => !!id).map((id) => id.toLowerCase()))
    const xml = wanted.size ? await xmltvFile(a, force) : null
    if (!xml) return {}
    const data = await parse(xml, wanted)
    if (Object.keys(data).length) writeFileSync(file, JSON.stringify({ savedAt: Date.now(), data }))
    return data
  })().finally(() => parsing.delete(file))
  parsing.set(file, job)
  return job
}
