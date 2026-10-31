// I flussi video passano dal server: il fornitore IPTV parla quasi sempre HTTP senza CORS (il browser
// non potrebbe aprirlo da una pagina HTTPS) e le credenziali restano qui. Quello che il browser non legge
// (MKV, audio AC3/MP2, HLS su Chrome desktop) lo sistema ffmpeg: il video si copia così com'è, si converte
// solo l'audio in AAC, che pesa poco anche su un Raspberry Pi.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { ProbeResult } from '../../shared/api.ts'
import { fetchUpstream, USER_AGENT } from './xtream.ts'

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

export const hasFfmpeg = (() => {
  try {
    return spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync(FFPROBE, ['-version'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
})()

// Molti servizi IPTV accettano una sola connessione per account: ogni utente ha al massimo un flusso
// aperto verso il fornitore. Uno nuovo (cambio canale, nuovo film) chiude subito il precedente.
const active = new Map<number, AbortController>()

function claim(userId: number, req: IncomingMessage): AbortController {
  active.get(userId)?.abort()
  const ctl = new AbortController()
  active.set(userId, ctl)
  const release = () => {
    ctl.abort()
    if (active.get(userId) === ctl) active.delete(userId)
  }
  req.on('close', release)
  return ctl
}

/** Inoltra il flusso così com'è; per film ed episodi passa anche le richieste di un intervallo (Range). */
export async function proxy(req: IncomingMessage, res: ServerResponse, userId: number, url: string, contentType: string | null) {
  const ctl = claim(userId, req)
  const headers: Record<string, string> = {}
  if (req.headers.range) headers.Range = req.headers.range
  let upstream: Response
  try {
    upstream = await fetchUpstream(url, 20_000, headers, ctl.signal)
  } catch (e) {
    if (!ctl.signal.aborted) console.warn('Flusso non raggiungibile', (e as Error).message)
    if (!res.headersSent) { res.writeHead(502); res.end() }
    return
  }
  if (!upstream.ok || !upstream.body) {
    res.writeHead(upstream.status === 404 ? 404 : 502)
    res.end()
    return
  }
  const out: Record<string, string> = { 'Cache-Control': 'no-store' }
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h)
    if (v) out[h] = v
  }
  out['content-type'] = contentType ?? upstream.headers.get('content-type') ?? 'application/octet-stream'
  res.writeHead(upstream.status, out)
  const body = Readable.fromWeb(upstream.body as never)
  body.on('error', () => res.end())
  body.pipe(res)
  ctl.signal.addEventListener('abort', () => body.destroy())
}

function run(args: string[], res: ServerResponse, ctl: AbortController, contentType: string) {
  const child: ChildProcess = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''
  child.stderr!.on('data', (d: Buffer) => { errors = (errors + d.toString()).slice(-2000) })
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' })
  child.stdout!.pipe(res)
  const stop = () => { if (child.exitCode == null) child.kill('SIGKILL') }
  ctl.signal.addEventListener('abort', stop)
  child.on('error', (e) => { console.warn('ffmpeg non si avvia', e.message); res.end() })
  child.on('close', (code) => {
    if (code && !ctl.signal.aborted) console.warn(`ffmpeg terminato (${code}): ${errors.trim().split('\n').slice(-3).join(' | ')}`)
    res.end()
  })
}

const inputArgs = (url: string, live: boolean) => [
  '-hide_banner', '-loglevel', 'error', '-nostdin',
  '-user_agent', USER_AGENT,
  ...(live ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4'] : []),
  '-fflags', '+genpts+discardcorrupt',
]

/** Diretta in MPEG-TS per mpegts.js: video copiato, audio sempre in AAC (MP2 e AC3 del digitale non si sentirebbero). */
export function liveRemux(req: IncomingMessage, res: ServerResponse, userId: number, url: string) {
  const ctl = claim(userId, req)
  run([
    ...inputArgs(url, true), '-i', url,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
    '-f', 'mpegts', '-muxdelay', '0', 'pipe:1',
  ], res, ctl, 'video/mp2t')
}

const browserVideo = new Set(['h264', 'vp8', 'vp9', 'av1'])
const copyableVideo = new Set(['h264', 'hevc', 'vp9', 'av1'])
const browserAudio = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const directContainers = new Set(['mp4', 'm4v', 'mov', 'webm'])

type ProbeStream = { index: number; codec_type?: string; codec_name?: string; height?: number; channels?: number; tags?: Record<string, string> }
const probes = new Map<string, { at: number; result: ProbeResult & { videoCodec: string | null } }>()

function languageName(code: string | undefined): string | null {
  if (!code || code === 'und') return null
  try {
    const name = new Intl.DisplayNames(['it'], { type: 'language' }).of(code)
    return name && name !== code ? name.charAt(0).toUpperCase() + name.slice(1) : code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const channelsName = (n: number | undefined) =>
  n === 1 ? 'Mono' : n === 2 ? 'Stereo' : n === 6 ? '5.1 surround' : n === 8 ? '7.1 surround' : n && n > 2 ? 'Audio surround' : null

/** ffprobe del file: durata, codifiche e tracce audio. Resta in memoria per un giorno. */
export async function probe(req: IncomingMessage, userId: number, url: string, ext: string, cacheKey: string): Promise<ProbeResult & { videoCodec: string | null }> {
  const known = probes.get(cacheKey)
  if (known && Date.now() - known.at < 24 * 3600_000) return known.result
  const ctl = claim(userId, req)
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFPROBE, [
      '-v', 'error', '-user_agent', USER_AGENT, '-of', 'json',
      '-show_entries', 'format=duration:stream=index,codec_type,codec_name,height,channels:stream_tags=language,title',
      '-i', url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => { out += d.toString() })
    const timer = setTimeout(() => child.kill('SIGKILL'), 40_000)
    ctl.signal.addEventListener('abort', () => child.kill('SIGKILL'))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`ffprobe ${code}`))
    })
  })
  const json = JSON.parse(text) as { format?: { duration?: string }; streams?: ProbeStream[] }
  const streams = json.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png')
  const audios = streams.filter((s) => s.codec_type === 'audio')
  const firstAudio = audios[0]?.codec_name
  const result = {
    durationMs: Math.round(Number(json.format?.duration ?? 0) * 1000),
    direct: directContainers.has(ext.toLowerCase()) && (!video || browserVideo.has(video.codec_name ?? '')) &&
      (!firstAudio || browserAudio.has(firstAudio)),
    video: video?.codec_name ?? null,
    videoCodec: video?.codec_name ?? null,
    height: video?.height ?? 0,
    audios: audios.map((s, i) => ({
      index: i,
      label: [languageName(s.tags?.language), s.tags?.title, channelsName(s.channels)].filter(Boolean).join(', ') || `Traccia ${i + 1}`,
    })),
  }
  probes.set(cacheKey, { at: Date.now(), result })
  return result
}

/**
 * Film ed episodi che il browser non apre: MP4 frammentato da ffmpeg, a partire da [startSec].
 * Il video si copia (si ricodifica solo se è in un formato che il browser non conosce, come XviD).
 */
export function vodRemux(req: IncomingMessage, res: ServerResponse, userId: number, url: string, startSec: number, audio: number, videoCodec: string | null) {
  const ctl = claim(userId, req)
  const copy = videoCodec == null || copyableVideo.has(videoCodec)
  run([
    ...inputArgs(url, false),
    ...(startSec > 0 ? ['-ss', String(startSec)] : []),
    '-i', url,
    '-map', '0:v:0?', '-map', `0:a:${audio}?`,
    ...(copy ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']),
    ...(videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1',
  ], res, ctl, 'video/mp4')
}
