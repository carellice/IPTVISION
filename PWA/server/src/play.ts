import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
/** The last ffmpeg messages of each browser, shown by the player's info panel. */
const lastErrors = new Map<string, string>()
export const errorsFor = (owner: string) => lastErrors.get(owner) ?? ''

function stopFor(owner: string) {
  const old = running.get(owner)
  if (old) { old.kill('SIGKILL'); running.delete(owner) }
  const h = hlsRuns.get(owner)
  if (h) { clearInterval(h.timer); h.child.kill('SIGKILL'); rmSync(h.dir, { recursive: true, force: true }); hlsRuns.delete(owner) }
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
    if (errors) lastErrors.set(owner, `${new Date().toISOString()} ffmpeg (uscita ${code}): ${errors.trim()}`)
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
  /** [tenBit]: 10-bit pictures, which browsers don't decode in H.264. */
  video: { codec: string; height: number; tenBit: boolean; detail: string } | null
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

/** Files already read: reopening, resuming and retrying don't ask the provider again (a few seconds each). */
const probes = new Map<string, Promise<Probe>>()

export function probe(a: XtreamAccount, kind: Kind, id: string, ext: string): Promise<Probe> {
  const key = `${a.server} ${a.username} ${kind} ${id} ${ext}`
  let p = probes.get(key)
  if (!p) {
    p = probeFile(a, kind, id, ext)
    p.catch(() => probes.delete(key))
    probes.set(key, p)
    if (probes.size > 500) probes.delete(probes.keys().next().value!)
  }
  return p
}

function probeFile(a: XtreamAccount, kind: Kind, id: string, ext: string): Promise<Probe> {
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
        const j = JSON.parse(out) as { format?: { duration?: string; format_name?: string }; streams?: { codec_type: string; codec_name: string; height?: number; width?: number; pix_fmt?: string; profile?: string; level?: number; field_order?: string; r_frame_rate?: string; codec_tag_string?: string; tags?: Record<string, string> }[] }
        const streams = j.streams ?? []
        const v = streams.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png')
        const audio = streams.filter((s) => s.codec_type === 'audio').map((s, index) => {
          const label = [s.tags?.title, language(s.tags?.language)].filter(Boolean).join(' · ')
          return { index, codec: s.codec_name, label: label || `Traccia ${index + 1}` }
        })
        const mp4 = /mp4|mov/.test(j.format?.format_name ?? '')
        const tenBit = /10|12/.test(v?.pix_fmt ?? '')
        const direct = mp4 && (!v || (v.codec_name === 'h264' && !tenBit)) && audio.every((s) => s.codec === 'aac' || s.codec === 'mp3') && audio.length <= 1
        resolve({ duration: Number(j.format?.duration) || 0, video: v ? { codec: v.codec_name, height: v.height ?? 0, tenBit, detail: [j.format?.format_name, v.codec_tag_string, v.profile, v.level, v.pix_fmt, v.field_order, `${v.width}×${v.height}`, v.r_frame_rate].filter((x) => x != null && x !== '').join(' · ') } : null, audio, direct })
      } catch {
        reject(new Error('Impossibile leggere il file dal server IPTV'))
      }
    })
  })
}

/**
 * A film or an episode from [start] seconds, as fragmented MP4 with AAC audio. [h264] re-encodes the
 * video the browser can't decode (Xvid/DivX, MPEG-2, VC-1, 10-bit H.264, HEVC on phones without it).
 */
export function vod(req: IncomingMessage, res: ServerResponse, owner: string, a: XtreamAccount, kind: Kind, id: string, ext: string,
  start: number, audio: number, hevc: boolean, h264 = false) {
  const v = h264
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-g', '50', '-vf', "scale='min(1920,iw)':-2"]
    : ['-c:v', 'copy', ...(hevc ? ['-tag:v', 'hvc1'] : [])]
  run(req, res, owner, [
    ...input, ...(start > 0 ? ['-ss', String(start)] : []), '-i', streamUrl(a, kind, id, ext),
    '-map', '0:v:0?', '-map', `0:a:${audio}?`, ...v,
    '-c:a', 'aac', '-ac', '2', '-b:a', '192k', '-sn', '-dn',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', 'pipe:1',
  ], 'video/mp4')
}

/** The file as the provider has it (MP4 the browser reads by itself, seekable with Range). */
export function raw(req: IncomingMessage, res: ServerResponse, owner: string, a: XtreamAccount, kind: Kind, id: string, ext: string) {
  stopFor(owner)
  return pipeUpstream(req, res, streamUrl(a, kind, id, ext))
}

// --- HLS for Safari (iPhone, iPad, Mac) and LG webOS: their <video> doesn't play a fragmented MP4
// of unknown length coming from a pipe, but plays HLS by itself. ffmpeg writes the segments to a
// temporary folder; it stops when the browser asks for nothing for two minutes (pause, closed tab).

type HlsRun = { key: string; child: ChildProcess; dir: string; lastUse: number; timer: NodeJS.Timeout; exited: boolean; errors: string }
const hlsRuns = new Map<string, HlsRun>()
const hlsRoot = join(tmpdir(), 'iptvision-hls')

/**
 * Starts the conversion and answers with the playlist once its first segment is ready. Safari reloads
 * the playlist from this same address every few seconds: the same request ([key]) gets the running
 * conversion's playlist instead of restarting it.
 */
export async function vodHls(res: ServerResponse, owner: string, key: string, a: XtreamAccount, kind: Kind, id: string, ext: string,
  start: number, audio: number, hevc: boolean, h264 = false, aacCopy = false) {
  const same = hlsRuns.get(owner)
  if (same?.key === key) { same.lastUse = Date.now(); return answerPlaylist(res, owner, same) }
  stopFor(owner)
  const dir = join(hlsRoot, createHash('sha256').update(owner).digest('hex').slice(0, 16))
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // Re-encoding must keep up with playback on a small home server: fastest preset, at most 720p.
  // Copied H.264 gets its SPS/PPS before every keyframe: files with open GOPs (MKV) have them only
  // in the header, and after a seek Safari would never see them (black picture, size 0×0).
  const v = h264
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '48', '-vf', "scale='min(1280,iw)':-2"]
    : hevc ? ['-c:v', 'copy', '-tag:v', 'hvc1'] : ['-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb,dump_extra=freq=keyframe']
  // HEVC in HLS only works in fMP4 segments; everything else in MPEG-TS, which every TV reads.
  const seg = hevc && !h264 ? ['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'] : ['-hls_segment_type', 'mpegts']
  const child = spawn(FFMPEG, [
    // A Raspberry Pi can't convert a whole film at full speed: after a 30 s head start ffmpeg reads
    // at twice real time, enough to stay ahead without loading the CPU and the SD card.
    // The streams are already known from the probe: ffmpeg looks at 1 MB instead of 5 before starting.
    ...input, '-probesize', '1000000', '-analyzeduration', '1000000', '-readrate', '2', '-readrate_initial_burst', '30',
    ...(start > 0 ? ['-ss', String(start)] : []), '-i', streamUrl(a, kind, id, ext),
    '-map', '0:v:0?', '-map', `0:a:${audio}?`, ...v,
    ...(aacCopy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']), '-sn', '-dn',
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'event', ...seg,
    '-hls_flags', 'temp_file+independent_segments', '-hls_base_url', '/api/hls-seg/', join(dir, 'index.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  child.on('error', () => { /* answered below: no playlist */ })
  const run: HlsRun = { key, child, dir, lastUse: Date.now(), exited: false, errors: '', timer: setInterval(() => {
    if (Date.now() - run.lastUse > 120_000) stopFor(owner)
  }, 15_000) }
  child.stderr!.on('data', (d: Buffer) => { run.errors = (run.errors + d.toString()).slice(-2000) })
  hlsRuns.set(owner, run)
  child.on('exit', (code) => {
    run.exited = true
    if (run.errors) lastErrors.set(owner, `${new Date().toISOString()} ffmpeg hls (uscita ${code}): ${run.errors.trim()}`)
    if (code && code !== 255 && run.errors) console.warn('ffmpeg hls:', run.errors.trim().split('\n').slice(-3).join(' | '))
  })
  return answerPlaylist(res, owner, run)
}

async function answerPlaylist(res: ServerResponse, owner: string, run: HlsRun) {
  const file = join(run.dir, 'index.m3u8')
  for (let i = 0; i < 300 && !existsSync(file) && !run.exited && hlsRuns.get(owner) === run; i++) await new Promise((r) => setTimeout(r, 100))
  if (!existsSync(file)) {
    if (hlsRuns.get(owner) === run) stopFor(owner)
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Impossibile convertire il file')
    lastErrors.set(owner, `${new Date().toISOString()} ffmpeg hls: nessuna playlist dopo 30 s. ${run.errors.trim()}`)
    return
  }
  res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' })
  res.end(playlist(file))
}

// An EVENT playlist would start near its end in Safari: playback starts from its beginning.
const playlist = (file: string) => readFileSync(file, 'utf8').replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES')

/** The playlist as it grows and its segments, for the browser that started the conversion. */
export function hlsFile(res: ServerResponse, owner: string, name: string) {
  const run = hlsRuns.get(owner)
  const file = run && /^[\w.-]{1,40}$/.test(name) ? join(run.dir, name) : ''
  if (!run || !existsSync(file)) { res.writeHead(404); res.end(); return }
  run.lastUse = Date.now()
  if (name.endsWith('.m3u8')) {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' })
    res.end(playlist(file))
    return
  }
  const body = readFileSync(file)
  res.writeHead(200, { 'Content-Type': name.endsWith('.ts') ? 'video/mp2t' : 'video/mp4', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
  res.end(body)
}

export function stopAll(owner: string) {
  stopFor(owner)
}
