import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import * as data from './db.ts'
import * as accounts from './accounts.ts'
import * as xtream from './xtream.ts'
import * as relay from './relay.ts'
import * as play from './play.ts'
import { guide } from './epg.ts'
import { networkInfo } from './network.ts'
import type { Op } from '../../shared/model.ts'

const PORT = Number(process.env.PORT ?? 8080)
const publicDir = process.env.PUBLIC_DIR ?? join(import.meta.dirname, '..', 'public')
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

async function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<Buffer> {
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
    return JSON.parse(body.toString('utf8') || '{}') as T
  } catch {
    throw new HttpError(400, 'Richiesta non valida')
  }
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) {
      try { out[k] = decodeURIComponent(v.join('=')) } catch { /* broken cookie */ }
    }
  }
  return out
}

const secure = (req: IncomingMessage) =>
  (req.socket as { encrypted?: boolean }).encrypted === true || req.headers['x-forwarded-proto'] === 'https'

// --- auth: one account per person; browsers use a cookie, the native apps the same token as a header ---

const SESSION = 'iptvision_session'

function requestToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  return cookies(req)[SESSION]
}

const sessionUser = (req: IncomingMessage) => accounts.sessionUser(requestToken(req))

/** "Chrome su Android": how a browser appears in the devices list. */
function browserName(req: IncomingMessage): string {
  const ua = req.headers['user-agent'] ?? ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} su ${os}` : browser
}

function startCookieSession(req: IncomingMessage, res: ServerResponse, userId: number) {
  const token = accounts.startSession(userId, browserName(req))
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 400}${secure(req) ? '; Secure' : ''}`
  res.setHeader('Set-Cookie', `${SESSION}=${token}; ${flags}`)
}

function clearSession(res: ServerResponse) {
  res.setHeader('Set-Cookie', `${SESSION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

/** Account mistakes (name taken, short password...) reach the user as they are. */
function accountCall<T>(work: () => T): T {
  try {
    return work()
  } catch (e) {
    if (e instanceof accounts.AccountError) throw new HttpError(400, e.message)
    throw e
  }
}

async function wrongPassword(): Promise<never> {
  await new Promise((r) => setTimeout(r, 800))
  throw new HttpError(401, 'Nome utente o password sbagliati')
}

/** The IPTV account of the current PWA account, or a clear message for the screens. */
function requireXtream(): data.XtreamAccount {
  const a = data.xtreamAccount()
  if (!a) throw new HttpError(409, 'Account IPTV non impostato: aggiungilo da IPTVISION nel browser.')
  return a
}

/** Errors of the provider become messages for the user (502: the provider, not this server). */
async function provider<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (e) {
    if (e instanceof xtream.XtreamError) throw new HttpError(e.isAuthError ? 403 : 502, e.message)
    if (e instanceof SyntaxError) throw new HttpError(502, 'Risposta non valida dal server IPTV.')
    throw e
  }
}

// --- static files ----------------------------------------------------------------------------

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
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
  const index = join(publicDir, 'index.html')
  if (!existsSync(index)) throw new HttpError(404, 'Interfaccia non compilata: esegui npm run build in web/')
  // Single page app: every other path gets the shell.
  sendFile(req, res, index, 'no-cache')
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

type Credentials = { username?: string; password?: string; invite?: string; device?: string }

route('POST', '/api/register', async (req, res) => {
  const b = await readJson<Credentials>(req)
  const user = accountCall(() => accounts.register(String(b.username ?? ''), String(b.password ?? ''), String(b.invite ?? '')))
  startCookieSession(req, res, user.id)
  json(res, 200, { username: user.username })
})

route('POST', '/api/login', async (req, res) => {
  const b = await readJson<Credentials>(req)
  const user = accounts.login(String(b.username ?? ''), String(b.password ?? ''))
  if (!user) await wrongPassword()
  startCookieSession(req, res, user!.id)
  json(res, 200, { username: user!.username })
})

/**
 * Login of a native app in server mode. The token works as the Xtream password and as a
 * "Bearer" header; it is a session like a browser's, so it shows up among the devices.
 */
route('POST', '/api/device/login', async (req, res) => {
  const b = await readJson<Credentials & { register?: boolean }>(req)
  const device = String(b.device ?? '').trim() || 'App IPTVISION'
  const user = b.register
    ? accountCall(() => accounts.register(String(b.username ?? ''), String(b.password ?? ''), String(b.invite ?? '')))
    : accounts.login(String(b.username ?? ''), String(b.password ?? ''))
  if (!user) await wrongPassword()
  const token = accounts.startSession(user!.id, device)
  const hasXtream = data.withUser(user!.id, () => data.xtreamAccount() != null)
  json(res, 200, { username: user!.username, token, hasXtream, version: VERSION })
})

route('POST', '/api/logout', (req, res) => {
  const token = requestToken(req)
  if (token) {
    play.stopAll(token)
    accounts.endSession(token)
  }
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

route('GET', '/api/devices', (_req, res, _p, _u, user) => json(res, 200, accounts.devices(user.id, user.token)))

route('DELETE', '/api/devices/:id', (_req, res, p, _u, user) => {
  accounts.endDevice(user.id, p[0])
  json(res, 200, accounts.devices(user.id, user.token))
})

/** How the server reaches the Internet: through the VPN or not, with country and address. */
route('GET', '/api/network', async (_req, res) => json(res, 200, await networkInfo()))

// --- favorites and positions, shared by the browser and the native apps ---------------------------

/** Favorites, positions, watched, last episodes; "unchanged" when the client has this revision already. */
route('GET', '/api/state', (_req, res, _p, url) => {
  const rev = data.revision()
  if (url.searchParams.get('since') === String(rev)) {
    json(res, 200, { revision: rev, unchanged: true })
    return
  }
  json(res, 200, data.state())
})

route('POST', '/api/ops', async (req, res) => {
  const { ops } = await readJson<{ ops?: Op[] }>(req)
  data.applyOps(ops ?? [])
  json(res, 200, data.state())
})

/** The favorites and positions a native app had before connecting: added to the server's. */
route('POST', '/api/import-native', async (req, res) => {
  const b = await readJson<{ lists?: unknown }>(req)
  data.importNative(b)
  data.addXtreamLists(b.lists)
  json(res, 200, data.state())
})

// --- the IPTV account ----------------------------------------------------------------------------

route('POST', '/api/xtream', async (req, res) => {
  const b = await readJson<{ server?: string; username?: string; password?: string; alias?: string }>(req)
  const parsed = xtream.parseServerInput(String(b.server ?? ''))
  const username = String(b.username ?? '').trim() || parsed.username || ''
  const password = String(b.password ?? '') || parsed.password || ''
  if (!parsed.server || !username) throw new HttpError(400, 'Inserisci server e nome utente, oppure il link M3U completo.')
  const account = { server: parsed.server, username, password }
  const info = await provider(() => xtream.authenticate(account))
  data.saveXtreamList({ ...account, alias: String(b.alias ?? '').trim().slice(0, 60) || username, expiresAt: info.expiresAt })
  data.setXtreamAccount(account)
  json(res, 200, { server: account.server, username, expiresAt: info.expiresAt, maxConnections: info.maxConnections })
})

/** The saved IPTV lists, without passwords. */
const listsView = () => data.xtreamLists().map((l, index) => ({
  index, alias: l.alias, server: l.server, username: l.username, expiresAt: l.expiresAt, active: data.isActiveList(l),
}))

const listAt = (p: string[]) => {
  const l = data.xtreamLists()[Number(p[0])]
  if (!l) throw new HttpError(404, 'Lista non trovata.')
  return l
}

route('GET', '/api/xtream/lists', (_req, res) => json(res, 200, listsView()))

route('POST', '/api/xtream/lists/:i/use', (_req, res, p, _u, user) => {
  const l = listAt(p)
  play.stopAll(user.token)
  data.setXtreamAccount({ server: l.server, username: l.username, password: l.password })
  json(res, 200, data.state())
})

route('DELETE', '/api/xtream/lists/:i', (_req, res, p, _u, user) => {
  const active = data.isActiveList(listAt(p))
  data.removeXtreamList(Number(p[0]))
  if (active) { play.stopAll(user.token); data.setXtreamAccount(null) }
  json(res, 200, listsView())
})

route('DELETE', '/api/xtream', (_req, res, _p, _u, user) => {
  play.stopAll(user.token)
  data.setXtreamAccount(null)
  json(res, 200, data.state())
})

route('GET', '/api/xtream/info', async (_req, res) => {
  const account = requireXtream()
  const info = await provider(() => xtream.authenticate(account))
  data.setActiveExpiry(info.expiresAt)
  json(res, 200, { status: info.status, expiresAt: info.expiresAt, maxConnections: info.maxConnections })
})

// --- catalog and guide -----------------------------------------------------------------------------

const force = (url: URL) => url.searchParams.get('force') === '1'

route('GET', '/api/lists/live', async (_req, res, _p, url) => json(res, 200, await provider(() => xtream.compactLive(requireXtream(), force(url)))))
route('GET', '/api/lists/movies', async (_req, res, _p, url) => json(res, 200, await provider(() => xtream.compactMovies(requireXtream(), force(url)))))
route('GET', '/api/lists/series', async (_req, res, _p, url) => json(res, 200, await provider(() => xtream.compactSeries(requireXtream(), force(url)))))
route('GET', '/api/epg', async (_req, res, _p, url) => json(res, 200, await guide(requireXtream(), force(url))))

route('GET', '/api/epg/short/:id', async (_req, res, p) => {
  json(res, 200, await provider(() => xtream.shortEpg(requireXtream(), Number(p[0]))).catch(() => []))
})
route('GET', '/api/vod/:id', async (_req, res, p) => {
  json(res, 200, await provider(() => xtream.vodInfo(requireXtream(), Number(p[0]))).catch(() => null))
})
route('GET', '/api/series/:id', async (_req, res, p) => {
  json(res, 200, await provider(() => xtream.seriesInfo(requireXtream(), Number(p[0]))))
})

/** "Svuota cache": the server's copy of lists and guide of this IPTV account. */
route('POST', '/api/cache/clear', (_req, res) => {
  xtream.clearCache(requireXtream())
  json(res, 200, { ok: true })
})

// --- playback in the browser ------------------------------------------------------------------------

const kindOf = (s: string): xtream.Kind => {
  if (s === 'movie' || s === 'series') return s
  throw new HttpError(400, 'Richiesta non valida')
}
const safeId = (s: string) => {
  if (!/^[\w-]{1,64}$/.test(s)) throw new HttpError(400, 'Richiesta non valida')
  return s
}
const safeExt = (s: string | null) => (s && /^[a-z0-9]{1,6}$/i.test(s) ? s : 'mp4')
const intParam = (url: URL, name: string) => Math.max(0, Math.floor(Number(url.searchParams.get(name)) || 0))

route('GET', '/api/play/live/:id', (req, res, p, url, user) => {
  play.live(req, res, user.token, requireXtream(), safeId(p[0]), intParam(url, 'audio'), url.searchParams.get('video') ?? '')
})

route('GET', '/api/probe/:kind/:id', async (_req, res, p, url) => {
  try {
    json(res, 200, await play.probe(requireXtream(), kindOf(p[0]), safeId(p[1]), safeExt(url.searchParams.get('ext'))))
  } catch (e) {
    throw new HttpError(502, (e as Error).message)
  }
})

route('GET', '/api/play/:kind/:id', (req, res, p, url, user) => {
  play.vod(req, res, user.token, requireXtream(), kindOf(p[0]), safeId(p[1]), safeExt(url.searchParams.get('ext')),
    intParam(url, 'start'), intParam(url, 'audio'), url.searchParams.get('hevc') === '1', url.searchParams.get('video') === 'h264')
})

route('GET', '/api/hls/:kind/:id', async (_req, res, p, url, user) => {
  await play.vodHls(res, user.token, url.pathname + url.search, requireXtream(), kindOf(p[0]), safeId(p[1]), safeExt(url.searchParams.get('ext')),
    intParam(url, 'start'), intParam(url, 'audio'), url.searchParams.get('hevc') === '1', url.searchParams.get('video') === 'h264',
    url.searchParams.get('aac') === '1')
})

route('GET', '/api/hls-seg/:name', (_req, res, p, _u, user) => {
  play.hlsFile(res, user.token, p[0])
})

route('GET', '/api/raw/:kind/:id', async (req, res, p, url, user) => {
  await play.raw(req, res, user.token, requireXtream(), kindOf(p[0]), safeId(p[1]), safeExt(url.searchParams.get('ext')))
})

route('GET', '/api/play/log', (_req, res, _p, _u, user) => {
  json(res, 200, { ffmpeg: play.errorsFor(user.token) })
})

route('POST', '/api/play/stop', (_req, res, _p, _u, user) => {
  play.stopAll(user.token)
  json(res, 200, { ok: true })
})

// --- Xtream Codes API for the native apps in server mode ------------------------------------------

/** The caller of an Xtream address: PWA username and device token in place of the provider's. */
function xtreamCaller(username: string | null, token: string | null): relay.Caller | null {
  const user = accounts.sessionUser(token ?? undefined)
  if (!user || !username || user.username.toLowerCase() !== username.toLowerCase()) return null
  const account = data.withUser(user.id, data.xtreamAccount)
  return account ? { username: user.username, token: user.token, account, userId: user.id } : null
}

async function handleXtream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname
  if (path === '/player_api.php' || path === '/xmltv.php') {
    const c = xtreamCaller(url.searchParams.get('username'), url.searchParams.get('password'))
    if (!c) {
      if (path === '/player_api.php') relay.denied(res)
      else { res.writeHead(401); res.end() }
      return true
    }
    if (path === '/player_api.php') await relay.playerApi(req, res, url, c)
    else await relay.xmltv(req, res, c)
    return true
  }
  const m = /^\/(live|movie|series|hls)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path)
  if (!m) return false
  let parts: string[]
  try { parts = m.slice(2).map(decodeURIComponent) } catch { return false }
  const c = xtreamCaller(parts[0], parts[1])
  if (!c) { res.writeHead(401); res.end(); return true }
  if (m[1] === 'hls') await relay.hls(req, res, c, parts[2])
  else await relay.stream(req, res, c, m[1] as 'live' | 'movie' | 'series', parts[2])
  return true
}

// --- server ----------------------------------------------------------------------------------

const open = new Set(['/api/session', '/api/register', '/api/login', '/api/logout', '/api/device/login'])

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  // The TV apps call from their own origin with the token in a header, never with cookies:
  // "*" without credentials exposes nothing a browser session could leak.
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range')
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  try {
    if (await handleXtream(req, res, url)) return
    if (path.startsWith('/api/')) {
      const user = sessionUser(req)
      if (!open.has(path) && !user) throw new HttpError(401, 'Accesso richiesto')
      for (const [method, pattern, handler] of routes) {
        const match = pattern.exec(path)
        if (match && method === req.method) {
          // Everything the handler reads or writes belongs to the logged in account.
          if (user) await data.withUser(user.id, () => handler(req, res, match.slice(1), url, user))
          else await handler(req, res, match.slice(1), url, { id: 0, username: '', token: '' })
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

// A dropped connection in the middle of a stream must never take the whole server down.
process.on('uncaughtException', (e) => console.error('Errore non gestito', e))
process.on('unhandledRejection', (e) => console.error('Promessa rifiutata', e))

const server = createServer(handle)
// Live channels and films stay open for hours: no timeout on requests.
server.requestTimeout = 0
server.on('error', (e) => {
  console.error(`Impossibile avviare il server sulla porta ${PORT}:`, (e as Error).message)
  process.exit(1)
})
server.listen(PORT, () => console.log(`IPTVISION ${VERSION} su http://0.0.0.0:${PORT}`))
