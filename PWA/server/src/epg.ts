// Guida TV (data/Epg.kt). Fonte principale: xmltv.php (una sola richiesta per tutti i canali),
// filtrata ai soli canali dell'account e salvata su disco per 6 ore. Il file XMLTV può superare i
// 100 MB: si legge a pezzi, tenendo in memoria solo un programma alla volta.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Programme } from '../../shared/model.ts'
import { fetchUpstream, xmltvUrl, type XtreamAccount } from './xtream.ts'

export type EpgData = Record<string, [number, number, string][]>

/** Formato XMLTV: "20261028203000 +0100". Restituisce secondi Unix. */
export function parseXmltvTime(s: string | null | undefined): number | null {
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
function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : all
      }
      return entities[e.toLowerCase()] ?? all
    })
    .trim()
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)
  return m ? decodeXml(m[2] ?? m[3] ?? '') : null
}

async function downloadAndParse(url: string, wanted: Set<string>): Promise<EpgData> {
  const nowSec = Date.now() / 1000
  const from = nowSec - 3 * 3600
  const to = nowSec + 36 * 3600
  const result: EpgData = {}
  const r = await fetchUpstream(url, 3 * 60_000)
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  const take = (block: string) => {
    const end = block.indexOf('>')
    const head = block.slice(0, end)
    const channel = attr(head, 'channel')?.toLowerCase()
    if (!channel || !wanted.has(channel)) return
    const start = parseXmltvTime(attr(head, 'start'))
    const stop = parseXmltvTime(attr(head, 'stop'))
    if (start == null || stop == null || stop < from || start > to) return
    const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(block)
    ;(result[channel] ??= []).push([start, stop, t ? decodeXml(t[1]) : ''])
  }
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    let pos = 0
    for (;;) {
      const s = buf.indexOf('<programme', pos)
      if (s < 0) { pos = Math.max(pos, buf.length - 16); break }
      const e = buf.indexOf('</programme>', s)
      if (e < 0) { pos = s; break }
      take(buf.slice(s, e))
      pos = e + 12
    }
    buf = buf.slice(pos)
  }
  for (const list of Object.values(result)) list.sort((a, b) => a[0] - b[0])
  return result
}

/** Dalla copia salvata se ha meno di 6 ore, altrimenti da xmltv.php. */
export async function loadEpg(a: XtreamAccount, file: string, wantedIds: string[], force: boolean): Promise<{ savedAt: number; data: EpgData }> {
  let cached: { savedAt: number; data: EpgData } | null = null
  if (existsSync(file)) {
    try {
      cached = JSON.parse(readFileSync(file, 'utf8'))
      if (!force && cached && Date.now() - cached.savedAt < 6 * 3600_000) return cached
    } catch (e) {
      console.warn('Cache EPG illeggibile', e)
    }
  }
  const wanted = new Set(wantedIds.map((id) => id.toLowerCase()))
  if (wanted.size === 0) return cached ?? { savedAt: 0, data: {} }
  try {
    const data = await downloadAndParse(xmltvUrl(a), wanted)
    if (Object.keys(data).length === 0) return cached ?? { savedAt: 0, data: {} }
    const fresh = { savedAt: Date.now(), data }
    writeFileSync(file, JSON.stringify(fresh))
    return fresh
  } catch (e) {
    console.warn('Download EPG fallito', (e as Error).message)
    return cached ?? { savedAt: 0, data: {} }
  }
}

export const toProgrammes = (rows: [number, number, string][]): Programme[] => rows.map(([start, stop, title]) => ({ start, stop, title }))
