import { spawn, type ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { XtreamAccount } from './db.ts'
import { pipeUpstream } from './relay.ts'
import { USER_AGENT, streamUrl, type Kind } from './xtream.ts'

// Playback in the browser. A browser reads neither MPEG-TS nor MKV nor AC3/MP2 audio, which IPTV
// streams are made of: ffmpeg on the server copies the video as it is and turns the audio into AAC,
// in MPEG-TS for live channels (played with mpegts.js) and in fragmented MP4 for films and episodes.
// Films that are already MP4 with H.264 and AAC go through untouched, so the browser seeks by itself.

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE ?? 'ffprobe'

/** One stream per browser: many providers allow a single connection per account. */
const running = new Map<string, ChildProcess>()

function stopFor(owner: string) {
  const old = running.get(owner)
  if (old) { old.kill('SIGKILL'); running.delete(owner) }
}

const input = ['-hide_banner', '-loglevel', 'error', '-user_agent', USER_AGENT,
  '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '4']

function run(req: IncomingMessage, res: ServerResponse, owner: string, args: string[], type: string) {
  stopFor(owner)
  const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  running.set(owner, child)
  let errors = ''
  child.stderr.on('data', (d: Buffer) => { errors = (errors + d.toString()).slice(-2000) })
  child.on('error', () => {
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('ffmpeg non disponibile sul server') }
  })
  child.on('exit', (code) => {
    if (running.get(owner) === child) running.delete(owner)
    if (code && code !== 255 && errors) console.warn('ffmpeg:', errors.trim().split('\n').slice(-3).join(' | '))
  })
  // The browser may hang up at any moment (seek, next channel): never let that reach the server.
  res.on('error', () => child.kill('SIGKILL'))
  child.stdout.on('error', () => res.destroy())
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
  child.stdout.pipe(res)
  const stop = () => child.kill('SIGKILL')
  req.on('close', stop)
  res.on('close', stop)
}

/** Live channel as MPEG-TS with AAC audio; [video] "h264" re-encodes channels the browser can't decode (MPEG-2). */
export function live(req: IncomingMessage, res: ServerResponse, owner: string, a: XtreamAccount, id: string, audio: number, video: string) {
  const v = video === 'h264'
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-vf', 'yadif', '-b:v', '4M', '-maxrate', '5M', '-bufsize', '8M']
    : ['-c:v', 'copy']
  run(req, res, owner, [
    ...input, '-fflags', '+genpts+discardcorrupt', '-i', streamUrl(a, 'live', id, 'ts'),
    '-map', '0:v:0?', '-map', `0:a:${audio}?`, ...v, '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-sn', '-dn',
    '-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1',
  ], 'video/mp2t')
}

export type Probe = {
  duration: number
  video: { codec: string; height: number } | null
  audio: { index: number; codec: string; label: string }[]
  /** The browser can read the file as it is (MP4, H.264, AAC/MP3). */
  direct: boolean
}

const langNames = new Intl.DisplayNames(['it'], { type: 'language' })
function language(code: string | undefined): string | null {
  if (!code || code === 'und') return null
  try {
    const name = langNames.of(code)
    return name ? name[0].toUpperCase() + name.slice(1) : null
  } catch { return null }
}

export function probe(a: XtreamAccount, kind: Kind, id: string, ext: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE, ['-v', 'error', '-user_agent', USER_AGENT, '-print_format', 'json', '-show_format', '-show_streams',
      streamUrl(a, kind, id, ext)], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 25_000)
    child.stdout.on('data', (d: Buffer) => { out += d.toString() })
    child.on('error', () => { clearTimeout(timer); reject(new Error('ffprobe non disponibile sul server')) })
    child.on('exit', () => {
      clearTimeout(timer)
      try {
        const j = JSON.parse(out) as { format?: { duration?: string; format_name?: string }; streams?: { codec_type: string; codec_name: string; height?: number; tags?: Record<string, string> }[] }
        const streams = j.streams ?? []
        const v = streams.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png')
        const audio = streams.filter((s) => s.codec_type === 'audio').map((s, index) => {
          const label = [s.tags?.title, language(s.tags?.language)].filter(Boolean).join(' · ')
          return { index, codec: s.codec_name, label: label || `Traccia ${index + 1}` }
        })
        const mp4 = /mp4|mov/.test(j.format?.format_name ?? '')
        const direct = mp4 && (!v || v.codec_name === 'h264') && audio.every((s) => s.codec === 'aac' || s.codec === 'mp3') && audio.length <= 1
        resolve({ duration: Number(j.format?.duration) || 0, video: v ? { codec: v.codec_name, height: v.height ?? 0 } : null, audio, direct })
      } catch {
        reject(new Error('Impossibile leggere il file dal server IPTV'))
      }
    })
  })
}

/** A film or an episode from [start] seconds, as fragmented MP4 with AAC audio. */
export function vod(req: IncomingMessage, res: ServerResponse, owner: string, a: XtreamAccount, kind: Kind, id: string, ext: string,
  start: number, audio: number, hevc: boolean) {
  run(req, res, owner, [
    ...input, ...(start > 0 ? ['-ss', String(start)] : []), '-i', streamUrl(a, kind, id, ext),
    '-map', '0:v:0?', '-map', `0:a:${audio}?`, '-c:v', 'copy', ...(hevc ? ['-tag:v', 'hvc1'] : []),
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-sn', '-dn',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', 'pipe:1',
  ], 'video/mp4')
}

/** The file as the provider has it (MP4 the browser reads by itself, seekable with Range). */
export function raw(req: IncomingMessage, res: ServerResponse, owner: string, a: XtreamAccount, kind: Kind, id: string, ext: string) {
  stopFor(owner)
  return pipeUpstream(req, res, streamUrl(a, kind, id, ext))
}

export function stopAll(owner: string) {
  stopFor(owner)
}
