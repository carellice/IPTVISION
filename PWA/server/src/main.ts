import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttps } from 'node:https'
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import * as data from './db.ts'
import * as accounts from './accounts.ts'
import * as xtream from './xtream.ts'
import { epgFile, cachedGz, downloadLibrary, libraryFile, readCached, vodLibrary } from './library.ts'
import { loadEpg } from './epg.ts'
import { hasFfmpeg, liveRemux, probe, proxy, vodRemux } from './stream.ts'
import * as pos from '../../shared/positions.ts'
import type { AppState } from '../../shared/api.ts'
import type { ChannelRow, LibraryKind } from '../../shared/model.ts'

const PORT = Number(process.env.PORT ?? 8080)
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 8443)
const publicDir = process.env.PUBLIC_DIR ?? join(import.meta.dirname, '..', 'public')
const certDir = join(data.dataDir, 'certs')
// The version the updater compares with GitHub: bump it in package.json to release.
const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version as string

// Node runs this file with type stripping: no enums, namespaces or parameter properties.
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// --- helpers ---------------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

/** Big JSON (lists, guide): compressed, the phone may be on mobile data. */
function jsonGz(req: IncomingMessage, res: ServerResponse, gz: Buffer) {
  const accepts = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
  if (!accepts) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(gunzipSync(gz))
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': gz.length, 'Cache-Control': 'no-store' })
  res.end(gz)
}

async function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'Richiesta troppo grande')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req)
  try {
    return JSON.parse(body.toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'Richiesta non valida')
  }
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) out[k] = decodeURIComponent(v.join('='))
  }
  return out
}

const secure = (req: IncomingMessage) =>
  (req.socket as { encrypted?: boolean }).encrypted === true || req.headers['x-forwarded-proto'] === 'https'

// --- auth: one account per person, each with its own data -----------------------------------

const SESSION = 'iptvision_session'

const sessionUser = (req: IncomingMessage) => accounts.sessionUser(cookies(req)[SESSION])

function startSession(req: IncomingMessage, res: ServerResponse, userId: number) {
  const token = accounts.startSession(userId)
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 400}${secure(req) ? '; Secure' : ''}`
  res.setHeader('Set-Cookie', `${SESSION}=${token}; ${flags}`)
}

function clearSession(res: ServerResponse) {
  res.setHeader('Set-Cookie', `${SESSION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

/** Account mistakes (name taken, short password...) reach the user as they are. */
function accountCall(work: () => void) {
  try {
    work()
  } catch (e) {
    if (e instanceof accounts.AccountError) throw new HttpError(400, e.message)
    throw e
  }
}

/** Errors of the IPTV provider reach the user with the same words as on the phone. */
async function iptv<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (e) {
    if (e instanceof xtream.XtreamError) throw new HttpError(e.isAuthError ? 403 : 502, e.message)
    console.warn('Errore del fornitore IPTV', (e as Error).message)
    throw new HttpError(502, 'Impossibile contattare il server. Controlla la connessione.')
  }
}

function account(): xtream.XtreamAccount {
  const a = data.xtreamAccount()
  if (!a) throw new HttpError(409, 'Nessun account IPTV: accedi con server, utente e password.')
  return a
}

// --- static files ----------------------------------------------------------------------------

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.crt': 'application/x-x509-ca-cert', '.txt': 'text/plain; charset=utf-8',
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cache: string) {
  const stat = statSync(file)
  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304)
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
    ETag: etag,
  })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
}

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  const clean = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  const file = join(publicDir, clean)
  if (file.startsWith(publicDir) && clean && existsSync(file) && statSync(file).isFile()) {
    const immutable = clean.startsWith('assets')
    sendFile(req, res, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    return
  }
  // Single page app: every other path gets the shell.
  sendFile(req, res, join(publicDir, 'index.html'), 'no-cache')
}

// --- API -------------------------------------------------------------------------------------

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL, user: accounts.User) => Promise<void> | void
const routes: [string, RegExp, Handler][] = []
const route = (method: string, pattern: string, handler: Handler) =>
  routes.push([method, new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), handler])

route('GET', '/api/session', (req, res) => {
  const user = sessionUser(req)
  json(res, 200, { loggedIn: user != null, username: user?.username ?? null, version: VERSION, inviteRequired: accounts.inviteRequired })
})

route('POST', '/api/register', async (req, res) => {
  const { username, password, code } = await readJson<{ username?: string; password?: string; code?: string }>(req)
  accountCall(() => {
    const user = accounts.register(String(username ?? ''), String(password ?? ''), String(code ?? ''))
    startSession(req, res, user.id)
    json(res, 200, { username: user.username })
  })
})

route('POST', '/api/login', async (req, res) => {
  const { username, password } = await readJson<{ username?: string; password?: string }>(req)
  const user = accounts.login(String(username ?? ''), String(password ?? ''))
  if (!user) {
    await new Promise((r) => setTimeout(r, 800))
    throw new HttpError(401, 'Nome utente o password sbagliati')
  }
  startSession(req, res, user.id)
  json(res, 200, { username: user.username })
})

route('POST', '/api/logout', (req, res) => {
  const token = cookies(req)[SESSION]
  if (token) accounts.endSession(token)
  clearSession(res)
  json(res, 200, { ok: true })
})

route('POST', '/api/account/password', async (req, res, _p, _u, user) => {
  const { current, password } = await readJson<{ current?: string; password?: string }>(req)
  accountCall(() => accounts.changePassword(user.id, String(current ?? ''), String(password ?? '')))
  json(res, 200, { ok: true })
})

route('POST', '/api/account/delete', async (req, res, _p, _u, user) => {
  const { password } = await readJson<{ password?: string }>(req)
  accountCall(() => accounts.deleteAccount(user.id, String(password ?? '')))
  clearSession(res)
  json(res, 200, { ok: true })
})

function state(): AppState {
  const a = data.xtreamAccount()
  return {
    revision: data.revision(),
    account: a ? { server: a.server, username: a.username } : null,
    favorites: data.favorites(),
    positions: data.positions(),
    ffmpeg: hasFfmpeg,
  }
}

/** Account, favorites and positions; "unchanged" when the client already has this revision. */
route('GET', '/api/state', (_req, res, _p, url) => {
  const rev = data.revision()
  if (url.searchParams.get('since') === String(rev)) {
    json(res, 200, { revision: rev, unchanged: true })
    return
  }
  json(res, 200, state())
})

// --- IPTV account ----------------------------------------------------------------------------

route('POST', '/api/xtream/login', async (req, res) => {
  const body = await readJson<{ server?: string; username?: string; password?: string }>(req)
  const parsed = xtream.parseServerInput(String(body.server ?? ''))
  const username = String(body.username ?? '').trim() || parsed.username || ''
  const password = String(body.password ?? '') || parsed.password || ''
  if (parsed.server === '' || username === '') throw new HttpError(400, 'Inserisci server e nome utente, oppure il link M3U completo.')
  const a = { server: parsed.server, username, password }
  try {
    await xtream.authenticate(a)
  } catch (e) {
    if (e instanceof xtream.XtreamError) throw new HttpError(400, e.message)
    throw new HttpError(400, 'Impossibile contattare il server. Controlla la connessione.')
  }
  data.setXtreamAccount(a)
  json(res, 200, state())
})

route('POST', '/api/xtream/logout', (_req, res) => {
  data.setXtreamAccount(null)
  json(res, 200, state())
})

route('POST', '/api/favorites', async (req, res) => {
  const { streamId, on } = await readJson<{ streamId?: number; on?: boolean }>(req)
  if (!Number.isInteger(streamId)) throw new HttpError(400, 'Canale non valido')
  data.setFavorite(streamId!, on === true)
  json(res, 200, { revision: data.revision(), favorites: data.favorites() })
})

/** Same rules as PositionStore on the phone, applied to the account's copy. */
function changePositions(work: (p: pos.PositionsData) => unknown) {
  const before = data.positions()
  const after = structuredClone(before)
  const result = work(after)
  data.savePositions(before, after)
  return { result, revision: data.revision(), positions: data.positions() }
}

route('POST', '/api/positions/update', async (req, res) => {
  const { key, p, d } = await readJson<{ key?: string; p?: number; d?: number }>(req)
  if (typeof key !== 'string' || !/^[me]:/.test(key)) throw new HttpError(400, 'Contenuto non valido')
  const { result, ...rest } = changePositions((x) => pos.update(x, key, Number(p), Number(d)))
  json(res, 200, { finished: result, ...rest })
})

route('POST', '/api/positions/watched', async (req, res) => {
  const { key } = await readJson<{ key?: string }>(req)
  if (typeof key !== 'string') throw new HttpError(400, 'Contenuto non valido')
  json(res, 200, changePositions((x) => pos.markWatched(x, key)))
})

route('POST', '/api/positions/last-episode', async (req, res) => {
  const { seriesId, episodeId } = await readJson<{ seriesId?: number; episodeId?: string }>(req)
  if (!Number.isInteger(seriesId) || typeof episodeId !== 'string') throw new HttpError(400, 'Episodio non valido')
  json(res, 200, changePositions((x) => pos.setLastEpisode(x, seriesId!, episodeId)))
})

/** Toglie titoli da "Continua a guardare" (tutte le versioni dello stesso titolo). */
route('POST', '/api/positions/remove', async (req, res) => {
  const { keys, seriesIds } = await readJson<{ keys?: string[]; seriesIds?: number[] }>(req)
  json(res, 200, changePositions((x) => {
    for (const k of keys ?? []) pos.forgetPosition(x, String(k))
    for (const id of seriesIds ?? []) pos.forgetSeries(x, Number(id))
  }))
})

// --- lists, guide, details ---------------------------------------------------------------------

const kinds = new Set<LibraryKind>(['live', 'vod', 'series'])

/**
 * Canali: "?cached=1" restituisce subito la copia salvata (o 204), senza parametro si riscarica.
 * Film e serie: la copia se ha meno di 12 ore, altrimenti si riscarica.
 */
route('GET', '/api/library/:kind', async (req, res, [kind], url) => {
  if (!kinds.has(kind as LibraryKind)) throw new HttpError(404, 'Non trovato')
  const a = account()
  const k = kind as LibraryKind
  if (url.searchParams.get('cached') === '1') {
    const gz = readCached(a, k) ? cachedGz(a, k) : null
    if (!gz) { res.writeHead(204); res.end(); return }
    jsonGz(req, res, gz)
    return
  }
  const gz = await iptv(() => (k === 'live' ? downloadLibrary(a, k) : vodLibrary(a, k)))
  jsonGz(req, res, gz)
})

/** "Aggiorna liste e guida": film e serie si riscaricano alla prossima apertura. */
route('POST', '/api/library/refresh', (_req, res) => {
  const a = account()
  rmSync(libraryFile(a, 'vod'), { force: true })
  rmSync(libraryFile(a, 'series'), { force: true })
  json(res, 200, { ok: true })
})

route('POST', '/api/cache/clear', (_req, res) => {
  data.clearCache()
  json(res, 200, { ok: true })
})

route('GET', '/api/epg', async (req, res, _p, url) => {
  const a = account()
  const live = readCached<ChannelRow>(a, 'live')
  const ids = [...new Set((live?.items ?? []).map((c) => c[5]).filter((id): id is string => id != null))]
  const epg = await loadEpg(a, epgFile(a), ids, url.searchParams.get('force') === '1')
  jsonGz(req, res, gzipSync(JSON.stringify(epg)))
})

route('GET', '/api/epg/short/:id', async (_req, res, [id]) => {
  const a = account()
  json(res, 200, await iptv(() => xtream.shortEpg(a, Number(id))))
})

route('GET', '/api/vod/:id', async (_req, res, [id]) => {
  const a = account()
  json(res, 200, await iptv(() => xtream.vodInfo(a, Number(id))))
})

route('GET', '/api/series/:id', async (_req, res, [id]) => {
  const a = account()
  json(res, 200, await iptv(() => xtream.seriesInfo(a, Number(id))))
})

// --- streams ----------------------------------------------------------------------------------

const safeExt = (ext: string | null) => (ext && /^[a-z0-9]{1,5}$/i.test(ext) ? ext : 'mp4')

function vodUrl(a: xtream.XtreamAccount, kind: string, id: string, ext: string) {
  if (kind === 'movie' && /^\d+$/.test(id)) return xtream.movieUrl(a, Number(id), ext)
  if (kind === 'episode' && /^[\w.-]+$/.test(id)) return xtream.episodeUrl(a, id, ext)
  throw new HttpError(404, 'Non trovato')
}

route('GET', '/api/probe/:kind/:id', async (req, res, [kind, id], url, user) => {
  if (!hasFfmpeg) { json(res, 200, null); return }
  const a = account()
  const ext = safeExt(url.searchParams.get('ext'))
  try {
    const { videoCodec: _v, ...result } = await probe(req, user.id, vodUrl(a, kind, id, ext), ext, `${user.id}:${kind}:${id}`)
    json(res, 200, result)
  } catch (e) {
    console.warn('ffprobe non riuscito', (e as Error).message)
    json(res, 200, null)
  }
})

/** Diretta: MPEG-TS per mpegts.js, inoltrato o passato da ffmpeg. */
route('GET', '/api/stream/live/:id', async (req, res, [id], url, user) => {
  const a = account()
  if (!/^\d+$/.test(id)) throw new HttpError(404, 'Non trovato')
  const fmt = url.searchParams.get('fmt') === 'm3u8' ? 'm3u8' : 'ts'
  const upstream = xtream.liveUrl(a, Number(id), fmt)
  // HLS si converte sempre: il browser riceve comunque MPEG-TS.
  if (hasFfmpeg && (url.searchParams.get('aac') === '1' || fmt === 'm3u8')) liveRemux(req, res, user.id, upstream)
  else await proxy(req, res, user.id, upstream, 'video/mp2t')
})

/** Film ed episodi: inoltrati come sono (con Range) o rimontati da ffmpeg in MP4 a partire da "start". */
route('GET', '/api/stream/:kind/:id', async (req, res, [kind, id], url, user) => {
  const a = account()
  const ext = safeExt(url.searchParams.get('ext'))
  const upstream = vodUrl(a, kind, id, ext)
  if (hasFfmpeg && url.searchParams.get('mode') === 'remux') {
    const known = await probe(req, user.id, upstream, ext, `${user.id}:${kind}:${id}`).catch(() => null)
    vodRemux(req, res, user.id, upstream, Math.max(0, Number(url.searchParams.get('start') ?? 0)), Math.max(0, Number(url.searchParams.get('audio') ?? 0)), known?.videoCodec ?? null)
  } else {
    await proxy(req, res, user.id, upstream, ext === 'mp4' || ext === 'm4v' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : null)
  }
})

// --- server ----------------------------------------------------------------------------------

const open = new Set(['/api/session', '/api/register', '/api/login', '/api/logout'])

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  try {
    if (path === '/certificato' || path === '/iptvision-ca.crt') {
      const ca = join(certDir, 'iptvision-ca.crt')
      if (!existsSync(ca)) throw new HttpError(404, 'HTTPS locale non attivo')
      if (path === '/iptvision-ca.crt') sendFile(req, res, ca, 'no-cache')
      else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(certificatePage(req))
      }
      return
    }
    if (path.startsWith('/api/')) {
      const user = sessionUser(req)
      if (!open.has(path) && !user) throw new HttpError(401, 'Accesso richiesto')
      for (const [method, pattern, handler] of routes) {
        const match = pattern.exec(path)
        if (match && method === req.method) {
          // Everything the handler reads or writes belongs to the logged in account.
          if (user) await data.withUser(user.id, () => handler(req, res, match.slice(1), url, user))
          else await handler(req, res, match.slice(1), url, { id: 0, username: '' })
          return
        }
      }
      throw new HttpError(404, 'Non trovato')
    }
    serveStatic(req, res, path)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    if (!res.headersSent) json(res, status, { error: e instanceof HttpError ? e.message : 'Errore del server' })
    else res.end()
  }
}

/** How to trust the local certificate authority, for the "HTTPS in casa" mode. */
function certificatePage(req: IncomingMessage): string {
  const host = (req.headers.host ?? '').split(':')[0]
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IPTVISION · certificato</title><style>body{font-family:system-ui,sans-serif;background:#0A0B0F;color:#F1F3F7;max-width:560px;margin:auto;padding:24px;line-height:1.5}
a.b{display:inline-block;background:#3D7BFF;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:600}li{margin:6px 0}</style></head><body>
<h1>Installa il certificato di IPTVISION</h1><p>Serve una volta sola per telefono: dopo, IPTVISION si apre in HTTPS e si può installare come app.</p>
<p><a class="b" href="/iptvision-ca.crt">Scarica il certificato</a></p>
<h3>Android</h3><ol><li>Scarica il file qui sopra.</li><li>Impostazioni → Sicurezza e privacy → Altre impostazioni di sicurezza → Installa da memoria → <b>Certificato CA</b>.</li><li>Scegli <i>iptvision-ca.crt</i> e conferma.</li></ol>
<h3>iPhone</h3><ol><li>Apri questa pagina con Safari e scarica il file.</li><li>Impostazioni → Profilo scaricato → Installa.</li><li>Impostazioni → Generali → Info → Impostazioni attendibilità certificati → attiva <i>IPTVISION CA</i>.</li></ol>
<p>Poi apri <b>https://${host}:${HTTPS_PORT}</b></p></body></html>`
}

if (!hasFfmpeg) console.warn('ffmpeg non trovato: i film in MKV e l\'audio AC3/MP2 potrebbero non partire nel browser.')

createHttp(handle).listen(PORT, () => console.log(`IPTVISION ${VERSION} su http://0.0.0.0:${PORT}`))

const cert = join(certDir, 'server.crt')
const key = join(certDir, 'server.key')
if (existsSync(cert) && existsSync(key)) {
  createHttps({ cert: readFileSync(cert), key: readFileSync(key) }, handle)
    .listen(HTTPS_PORT, () => console.log(`IPTVISION in HTTPS su https://0.0.0.0:${HTTPS_PORT}`))
}
