// Liste di canali, film e serie dell'account IPTV (openAccount / loadOrDownload di AppViewModel.kt).
// Il server le scarica dal fornitore, le riduce a righe compatte e le salva compresse: il browser le
// riceve già pronte e la stessa copia serve a tutti i dispositivi dell'account.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { LibraryKind, LibraryPayload } from '../../shared/model.ts'
import { cacheDir, currentUserId } from './db.ts'
import { accountKey, download, parseCategories, parseChannels, parseMovies, parseSeries, type XtreamAccount } from './xtream.ts'

const actions: Record<LibraryKind, { cats: string; list: string; timeout: number; parse: (v: unknown) => unknown[] }> = {
  live: { cats: 'get_live_categories', list: 'get_live_streams', timeout: 90, parse: parseChannels },
  vod: { cats: 'get_vod_categories', list: 'get_vod_streams', timeout: 180, parse: parseMovies },
  series: { cats: 'get_series_categories', list: 'get_series', timeout: 180, parse: parseSeries },
}

export const libraryFile = (a: XtreamAccount, kind: LibraryKind) => join(cacheDir(), `${kind}_${accountKey(a)}.json.gz`)
export const epgFile = (a: XtreamAccount) => join(cacheDir(), `epg_${accountKey(a)}.json`)

/** The saved copy, already compressed, or null. */
export function cachedGz(a: XtreamAccount, kind: LibraryKind): Buffer | null {
  const f = libraryFile(a, kind)
  return existsSync(f) ? readFileSync(f) : null
}

export function readCached<R>(a: XtreamAccount, kind: LibraryKind): LibraryPayload<R> | null {
  const gz = cachedGz(a, kind)
  if (!gz) return null
  try { return JSON.parse(gunzipSync(gz).toString('utf8')) } catch { return null }
}

const inFlight = new Map<string, Promise<Buffer>>()

/** Scarica categorie e lista dal fornitore e salva la copia compatta (una sola volta alla volta). */
export function downloadLibrary(a: XtreamAccount, kind: LibraryKind): Promise<Buffer> {
  const key = `${currentUserId()}:${kind}`
  const running = inFlight.get(key)
  if (running) return running
  const work = (async () => {
    const act = actions[kind]
    const rawCats = join(cacheDir(), `${kind}_cats.raw`)
    const rawList = join(cacheDir(), `${kind}.raw`)
    try {
      await download(a, act.cats, rawCats, 30)
      await download(a, act.list, rawList, act.timeout)
      const payload: LibraryPayload<unknown> = {
        savedAt: Date.now(),
        categories: parseCategories(JSON.parse(readFileSync(rawCats, 'utf8'))),
        items: act.parse(JSON.parse(readFileSync(rawList, 'utf8'))),
      }
      const gz = gzipSync(JSON.stringify(payload))
      writeFileSync(libraryFile(a, kind), gz)
      return gz
    } finally {
      rmSync(rawCats, { force: true })
      rmSync(rawList, { force: true })
    }
  })()
  inFlight.set(key, work)
  work.then(() => inFlight.delete(key), () => inFlight.delete(key))
  return work
}

/** Film e serie: dalla copia salvata se ha meno di 12 ore, altrimenti dal server (o la copia, se il server non risponde). */
export async function vodLibrary(a: XtreamAccount, kind: LibraryKind): Promise<Buffer> {
  const f = libraryFile(a, kind)
  const fresh = existsSync(f) && Date.now() - statSync(f).mtimeMs < 12 * 3600_000
  if (fresh && readCached(a, kind)) return readFileSync(f)
  try {
    return await downloadLibrary(a, kind)
  } catch (e) {
    const old = cachedGz(a, kind)
    if (old && readCached(a, kind)) {
      console.warn(`Aggiornamento ${kind} fallito, uso la copia salvata`, (e as Error).message)
      return old
    }
    throw e
  }
}
