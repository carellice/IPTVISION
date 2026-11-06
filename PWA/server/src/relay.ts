import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { type XtreamAccount, setActiveExpiry, withUser } from './db.ts'
import { xmltvFile } from './epg.ts'
import { LIST_ACTIONS, type ListAction, USER_AGENT, apiUrl, getText, listFile, streamUrl, XtreamError } from './xtream.ts'

// The Xtream Codes API, spoken by this server to the native IPTVISION apps in server mode.
// The app uses the CasaOS address as its Xtream server, the account name as user and its device
// token as password: lists, guide and streams come from here, and the provider's address and
// credentials never reach the phone or the TV.

export type Caller = { username: string; token: string; account: XtreamAccount; userId: number }

/** Pipes a provider response to the client, passing Range so films can be seeked and resumed. */
export async function pipeUpstream(req: IncomingMessage, res: ServerResponse, url: string, onBody?: (r: Response) => Promise<boolean>) {
  const controller = new AbortController()
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  for (const h of ['range', 'if-range', 'accept']) {
    const v = req.headers[h]
    if (typeof v === 'string') headers[h] = v
  }
  // Only the connection has a deadline: a live channel can run for hours.
  const timer = setTimeout(() => controller.abort(), 20_000)
  res.on('close', () => controller.abort())
  let upstream: Response
  try {
    upstream = await fetch(url, { headers, redirect: 'follow', signal: controller.signal, method: req.method === 'HEAD' ? 'HEAD' : 'GET' })
  } catch {
    clearTimeout(timer)
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Server IPTV non raggiungibile') }
    return
  }
  clearTimeout(timer)
  if (onBody && upstream.ok && (await onBody(upstream))) return
  const out: Record<string, string> = {}
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = upstream.headers.get(h)
    if (v) out[h] = v
  }
  out['cache-control'] = 'no-store'
  res.writeHead(upstream.status, out)
  if (!upstream.body || req.method === 'HEAD') { res.end(); return }
  Readable.fromWeb(upstream.body as never).on('error', () => res.destroy()).pipe(res)
}

// --- HLS: the playlists point to the provider, so their addresses are swapped with short ids ---

const hlsTargets = new Map<string, string>()

function hlsId(target: string): string {
  const id = randomBytes(9).toString('base64url')
  hlsTargets.set(id, target)
  // Live playlists refresh every few seconds: only the most recent addresses are kept.
  if (hlsTargets.size > 20_000) hlsTargets.delete(hlsTargets.keys().next().value!)
  return id
}

function rewritePlaylist(text: string, base: string, prefix: string): string {
  const map = (u: string) => `${prefix}/${hlsId(new URL(u, base).toString())}`
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim()
    if (t === '') return line
    if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${map(u)}"`)
    return map(t)
  }).join('\n')
}

async function maybePlaylist(req: IncomingMessage, res: ServerResponse, r: Response, c: Caller): Promise<boolean> {
  const type = r.headers.get('content-type') ?? ''
  const isPlaylist = /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(new URL(r.url).pathname)
  if (!isPlaylist) return false
  const text = await r.text()
  res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' })
  res.end(req.method === 'HEAD' ? undefined : rewritePlaylist(text, r.url, `/hls/${encodeURIComponent(c.username)}/${c.token}`))
  return true
}

export async function hls(req: IncomingMessage, res: ServerResponse, c: Caller, id: string) {
  const target = hlsTargets.get(id)
  if (!target) { res.writeHead(404); res.end(); return }
  await pipeUpstream(req, res, target, (r) => maybePlaylist(req, res, r, c))
}

// --- player_api.php, xmltv.php and the streams ----------------------------------------------------

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** What a wrong user or token gets: the shape native clients read as "wrong credentials". */
export function denied(res: ServerResponse) {
  json(res, 200, { user_info: { auth: 0, status: 'Disabled', message: 'Sessione del server scaduta: ricollega il server dalle impostazioni.' } })
}

export async function playerApi(req: IncomingMessage, res: ServerResponse, url: URL, c: Caller) {
  const action = url.searchParams.get('action')
  try {
    if (!action) {
      // The login check: the provider's answer with this server's address and the caller's credentials.
      const root = JSON.parse(await getText(apiUrl(c.account, null), 15)) as Record<string, Record<string, unknown>>
      if (root.user_info && typeof root.user_info === 'object') {
        const exp = parseInt(String(root.user_info.exp_date), 10)
        withUser(c.userId, () => setActiveExpiry(exp > 0 ? exp : null))
        root.user_info.username = c.username
        root.user_info.password = c.token
      }
      const host = (req.headers.host ?? '').split(':')
      if (root.server_info && typeof root.server_info === 'object') {
        root.server_info.url = host[0]
        root.server_info.port = host[1] ?? '80'
        root.server_info.server_protocol = 'http'
      }
      json(res, 200, root)
      return
    }
    const extra = [...url.searchParams].filter(([k]) => !['username', 'password', 'action'].includes(k))
    if (action in LIST_ACTIONS && extra.length === 0) {
      // Whole lists come from the server's copy: shared by every device, fresh like on the phone.
      const file = await listFile(c.account, action as ListAction)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' })
      createReadStream(file).pipe(res)
      return
    }
    if (!/^[a-z_]{3,40}$/.test(action)) { json(res, 400, []); return }
    const query = extra.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    await pipeUpstream(req, res, apiUrl(c.account, action, query || undefined))
  } catch (e) {
    if (e instanceof XtreamError && e.isAuthError) json(res, 200, { user_info: { auth: 0, message: e.message } })
    else json(res, 502, { error: e instanceof Error ? e.message : 'Errore del server' })
  }
}

export async function xmltv(req: IncomingMessage, res: ServerResponse, c: Caller) {
  const file = await xmltvFile(c.account)
  if (!file) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file).pipe(res)
}

export async function stream(req: IncomingMessage, res: ServerResponse, c: Caller, kind: 'live' | 'movie' | 'series', file: string) {
  const dot = file.lastIndexOf('.')
  const id = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot + 1) : 'ts'
  if (!/^[\w-]{1,64}$/.test(id) || !/^[a-z0-9]{1,6}$/i.test(ext)) { res.writeHead(400); res.end(); return }
  await pipeUpstream(req, res, streamUrl(c.account, kind, id, ext), (r) => maybePlaylist(req, res, r, c))
}
