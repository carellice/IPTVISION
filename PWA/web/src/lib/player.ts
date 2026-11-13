import mpegts from 'mpegts.js'
import { api } from './api.ts'

// player/PlayerController.kt for the browser: the <video> element with automatic reconnection.
// A watchdog checks that the stream really advances: if it stops without errors (typical of IPTV)
// the channel is reopened, waiting a bit longer each time.
// Live channels: MPEG-TS from the server's ffmpeg, played with mpegts.js. Films and episodes: the
// file as it is when the browser reads it, otherwise fragmented MP4 from ffmpeg starting where
// the user wants (seeking restarts the conversion from there).

export type PlaybackState = 'Idle' | 'Connecting' | 'Buffering' | 'Playing' | 'Paused' | 'Reconnecting'

export type Source = { kind: 'live'; id: number } | { kind: 'movie' | 'series'; id: string; ext: string }

type Probe = {
  duration: number
  video: { codec: string; height: number; tenBit?: boolean; detail?: string } | null
  audio: { index: number; codec: string; label: string }[]
  direct: boolean
}

// What each codec ffprobe names is called for the browser, to ask whether it decodes it.
const CODEC_TYPES: Record<string, (tenBit: boolean) => string> = {
  h264: () => 'video/mp4; codecs="avc1.640028"',
  hevc: (tenBit) => `video/mp4; codecs="${tenBit ? 'hvc1.2.4.L150.90' : 'hvc1.1.6.L150.90'}"`,
  vp9: (tenBit) => `video/mp4; codecs="vp09.${tenBit ? '02.40.10' : '00.40.08'}"`,
  av1: (tenBit) => `video/mp4; codecs="av01.0.08M.${tenBit ? '10' : '08'}"`,
}

/**
 * Whether this browser shows the video of a file as it is. Xvid/DivX, MPEG-2, VC-1 and 10-bit H.264
 * never; HEVC, VP9 and AV1 depend on the phone. What it doesn't show the server re-encodes in H.264.
 */
function browserDecodes(video: HTMLVideoElement, v: Probe['video']): boolean {
  if (!v) return true
  const type = CODEC_TYPES[v.codec]
  if (!type || (v.codec === 'h264' && v.tenBit)) return false
  const t = type(!!v.tenBit)
  try { if (window.MediaSource?.isTypeSupported(t)) return true } catch { /* old browser */ }
  return video.canPlayType(t) === 'probably'
}

/**
 * Safari (iPhone, iPad, Mac) and LG webOS don't play a fragmented MP4 of unknown length streamed
 * by ffmpeg, but play HLS by themselves: for them the server converts to HLS instead.
 */
function nativeHls(video: HTMLVideoElement): boolean {
  const ua = navigator.userAgent
  const webkit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Android/.test(ua)
  return (webkit || /Web0S|webOS|NetCast/i.test(ua) || /CriOS|FxiOS|EdgiOS/.test(ua)) && video.canPlayType('application/vnd.apple.mpegurl') !== ''
}

export type Track ={ index: number; label: string; selected: boolean }

export class PlayerController {
  state: PlaybackState = 'Idle'
  attempt = 0
  positionMs = 0
  durationMs = 0
  videoSize = ''
  audioTracks: Track[] = []
  /** What happened during this playback, shown by the player's info panel. */
  log: string[] = []

  /** A film or an episode reached its end. */
  onEnded: (() => void) | null = null
  /** A film or an episode doesn't open despite the attempts. */
  onFailed: (() => void) | null = null
  onChange: (() => void) | null = null

  private video: HTMLVideoElement | null = null
  private source: Source | null = null
  private ts: mpegts.Player | null = null
  private probe: Probe | null = null
  private offsetSec = 0
  private audio = 0
  private reencode = false
  private resumeMs = 0
  private lastPos = -1
  private lastProgressAt = 0
  private startedAt = 0
  private userPaused = false
  private everPlayed = false
  private lastFrames = -1
  private lastFrameAt = 0
  private retryTimer: number | undefined
  private session = 0

  get isActive() { return this.source != null }
  get isLive() { return this.source?.kind === 'live' }

  constructor() {
    window.setInterval(() => this.watchdog(), 1000)
  }

  private emit() { this.onChange?.() }

  private note(text: string) {
    const t = new Date().toLocaleTimeString('it-IT')
    this.log = [...this.log.slice(-79), `${t} ${text}`]
  }

  /** Technical details for the info panel: what the browser got and how it is doing. */
  details(): [string, string][] {
    const v = this.video
    const q = v?.getVideoPlaybackQuality?.()
    const can = (t: string) => {
      let mse = '-'
      try { mse = window.MediaSource?.isTypeSupported(t) ? 'sì' : 'no' } catch { /* old browser */ }
      return `canPlay "${v?.canPlayType(t) ?? ''}" · MSE ${mse}`
    }
    const pr = this.probe
    const mode = !this.source ? '-' : this.ts ? 'mpegts.js' : pr?.direct ? 'diretto (file originale)' : v && nativeHls(v) ? 'HLS dal server' : 'MP4 dal server'
    const buffered = v && v.buffered.length ? `${v.buffered.start(0).toFixed(1)}–${v.buffered.end(v.buffered.length - 1).toFixed(1)} s` : '-'
    return [
      ['Stato', `${this.state} · tentativo ${this.attempt}`],
      ['Modalità', `${mode}${this.reencode ? ' · ricodifica H.264' : ''}`],
      ['Sorgente', this.source ? `${this.source.kind} ${this.source.id}${'ext' in this.source ? '.' + this.source.ext : ''}` : '-'],
      ['Video (file)', pr?.video ? `${pr.video.codec} ${pr.video.height}p${pr.video.tenBit ? ' 10 bit' : ''}${pr.video.detail ? ` (${pr.video.detail})` : ''}` : pr ? 'nessuno' : '-'],
      ['Audio (file)', pr ? pr.audio.map((a) => `${a.codec} ${a.label}`).join(', ') || 'nessuno' : '-'],
      ['Durata (file)', pr ? `${Math.round(pr.duration)} s` : '-'],
      ['Indirizzo', v?.currentSrc ? new URL(v.currentSrc).pathname + new URL(v.currentSrc).search : '-'],
      ['Elemento video', v ? `ready ${v.readyState} · network ${v.networkState} · ${v.paused ? 'in pausa' : 'in riproduzione'}` : '-'],
      ['Immagine', v ? `${v.videoWidth}×${v.videoHeight}` : '-'],
      ['Tempo', v ? `${v.currentTime.toFixed(1)} s · durata ${Number.isFinite(v.duration) ? v.duration.toFixed(1) : v.duration} · offset ${this.offsetSec} s` : '-'],
      ['Buffer', buffered],
      ['Fotogrammi', q ? `${q.totalVideoFrames} totali · ${q.droppedVideoFrames} persi` : '-'],
      ['Errore', v?.error ? `${v.error.code} ${v.error.message}` : 'nessuno'],
      ['H.264', can('video/mp4; codecs="avc1.640028"')],
      ['HEVC', can('video/mp4; codecs="hvc1.1.6.L150.90"')],
      ['HLS nativo', v ? `"${v.canPlayType('application/vnd.apple.mpegurl')}" · usato ${nativeHls(v) ? 'sì' : 'no'}` : '-'],
      ['Browser', navigator.userAgent],
    ]
  }

  private setState(s: PlaybackState) {
    if (this.state !== s) { this.state = s; this.emit() }
  }

  attach(video: HTMLVideoElement | null) {
    if (this.video === video) return
    this.video = video
    if (!video) return
    video.addEventListener('loadedmetadata', () => this.note(`metadati: ${video.videoWidth}×${video.videoHeight}, durata ${video.duration}`))
    video.addEventListener('stalled', () => this.note('stalled: il browser non riceve dati'))
    video.addEventListener('playing', () => { this.note(`playing dopo ${((Date.now() - this.startedAt) / 1000).toFixed(1)} s`) })
    video.addEventListener('playing', () => { this.everPlayed = true; this.lastProgressAt = Date.now(); this.setState('Playing') })
    video.addEventListener('pause', () => { if (this.source && this.userPaused) this.setState('Paused') })
    video.addEventListener('waiting', () => { if (this.state !== 'Reconnecting') this.setState(this.everPlayed ? 'Buffering' : 'Connecting') })
    video.addEventListener('ended', () => this.ended())
    video.addEventListener('error', () => {
      if (this.source) this.note(`errore video ${video.error?.code ?? '?'} ${video.error?.message ?? ''}`)
      if (!this.source || this.ts) return
      // The browser can't decode the video: the next attempt has it re-encoded by the server.
      const code = video.error?.code
      if ((code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) && this.useH264()) {
        this.scheduleRetry('video non decodificabile dal browser')
        return
      }
      this.scheduleRetry('errore di riproduzione')
    })
    video.addEventListener('resize', () => { this.videoSize = video.videoHeight > 0 ? `${video.videoHeight}p` : ''; this.emit() })
    if (this.source) this.start()
  }

  play(source: Source, resumeMs = 0) {
    clearTimeout(this.retryTimer)
    this.source = source
    this.resumeMs = resumeMs
    this.attempt = 0
    this.everPlayed = false
    this.userPaused = false
    this.positionMs = resumeMs
    this.durationMs = 0
    this.probe = null
    this.audio = 0
    this.reencode = false
    this.audioTracks = []
    this.log = []
    this.start()
  }

  private async start() {
    const src = this.source
    const video = this.video
    if (!src || !video) return
    const session = ++this.session
    this.release()
    this.setState(this.attempt > 0 ? 'Reconnecting' : 'Connecting')
    this.lastPos = -1
    this.startedAt = Date.now()
    this.lastProgressAt = this.startedAt
    this.lastFrames = -1
    this.lastFrameAt = this.startedAt
    if (src.kind === 'live') {
      this.startLive(src.id, video)
      return
    }
    if (!this.probe) {
      try {
        this.probe = await api<Probe>(`/api/probe/${src.kind}/${encodeURIComponent(src.id)}?ext=${src.ext}`)
        this.note(`probe in ${((Date.now() - this.startedAt) / 1000).toFixed(1)} s: ${JSON.stringify(this.probe)}`)
      } catch (e) {
        this.note(`probe fallito: ${e instanceof Error ? e.message : e}`)
        if (session === this.session) this.scheduleRetry('file non leggibile')
        return
      }
      if (session !== this.session) return
      if (!this.reencode && !browserDecodes(video, this.probe.video)) this.reencode = true
      // HLS carries only H.264 and HEVC: anything else is re-encoded for Safari and webOS.
      if (nativeHls(video) && this.probe.video && !['h264', 'hevc'].includes(this.probe.video.codec)) this.reencode = true
      // Safari plays the provider's MP4 only if its server answers Range exactly: HLS always works.
      if (this.reencode || nativeHls(video)) this.probe = { ...this.probe, direct: false }
      this.durationMs = Math.round(this.probe.duration * 1000)
      this.audioTracks = this.probe.audio.map((a) => ({ index: a.index, label: a.label, selected: a.index === this.audio }))
      this.emit()
    }
    const startSec = Math.floor(this.resumeMs / 1000)
    if (this.probe.direct) {
      this.offsetSec = 0
      video.src = `/api/raw/${src.kind}/${encodeURIComponent(src.id)}?ext=${src.ext}${startSec > 0 ? `#t=${startSec}` : ''}`
    } else {
      this.offsetSec = startSec
      const codec = this.reencode ? '&video=h264' : this.probe.video?.codec === 'hevc' ? '&hevc=1' : ''
      // [s]: each attempt is a new conversion; Safari's playlist reloads repeat the same address.
      video.src = nativeHls(video)
        ? `/api/hls/${src.kind}/${encodeURIComponent(src.id)}?ext=${src.ext}&start=${startSec}&audio=${this.audio}${codec}${this.probe.audio[this.audio]?.codec === 'aac' ? '&aac=1' : ''}&s=${session}`
        : `/api/play/${src.kind}/${encodeURIComponent(src.id)}?ext=${src.ext}&start=${startSec}&audio=${this.audio}${codec}`
    }
    this.note(`apro ${video.src}`)
    this.go(video)
  }

  private startLive(id: number, video: HTMLVideoElement) {
    if (!mpegts.isSupported()) {
      this.source = null
      this.setState('Idle')
      this.onFailed?.()
      return
    }
    const p = mpegts.createPlayer(
      // Absolute address: mpegts.js fetches from a worker, which has no base URL.
      { type: 'mpegts', isLive: true, url: new URL(`/api/play/live/${id}?audio=${this.audio}${this.reencode ? '&video=h264' : ''}`, location.href).href },
      { enableWorker: true, enableStashBuffer: true, stashInitialSize: 384 * 1024, liveBufferLatencyChasing: false, lazyLoad: false },
    )
    p.on(mpegts.Events.ERROR, (type: string, detail: string, info: { msg?: string }) => {
      // Video the browser can't decode (MPEG-2 of some DTT channels): the server re-encodes it.
      const codec = type === mpegts.ErrorTypes.MEDIA_ERROR && /codec|unsupported|not supported/i.test(`${detail} ${info?.msg ?? ''}`)
      if (codec && !this.reencode) this.reencode = true
      this.scheduleRetry(`errore ${type} ${detail}`)
    })
    p.attachMediaElement(video)
    p.load()
    this.ts = p
    this.go(video)
  }

  private go(video: HTMLVideoElement) {
    if (this.userPaused) return
    video.play().catch(() => { /* autoplay refused: the user taps play */ })
  }

  private release() {
    if (this.ts) {
      try { this.ts.pause(); this.ts.unload(); this.ts.detachMediaElement(); this.ts.destroy() } catch { /* already gone */ }
      this.ts = null
    }
    if (this.video) {
      this.video.removeAttribute('src')
      try { this.video.load() } catch { /* nothing loaded */ }
    }
  }

  private ended() {
    if (!this.source) return
    // A live channel that "ends" is a dropped stream: it is reopened.
    if (this.isLive) { this.scheduleRetry('flusso terminato'); return }
    // The conversion stopped early (connection dropped): carry on from there.
    if (this.durationMs > 0 && this.currentPosition() < this.durationMs - 30_000) { this.scheduleRetry('flusso interrotto'); return }
    this.setState('Idle')
    this.onEnded?.()
  }

  private scheduleRetry(reason: string) {
    if (!this.source) return
    clearTimeout(this.retryTimer)
    if (!this.isLive) {
      const p = this.currentPosition()
      if (p > 0) this.resumeMs = p
      if (this.attempt >= 6) { this.stop(); this.onFailed?.(); return }
    }
    this.attempt++
    this.setState('Reconnecting')
    const delay = Math.min(15_000, 1000 << Math.min(this.attempt - 1, 4))
    console.warn(`Riconnessione (${reason}), tentativo ${this.attempt} tra ${delay}ms`)
    this.note(`riconnessione (${reason}), tentativo ${this.attempt} tra ${delay} ms`)
    this.release()
    this.retryTimer = window.setTimeout(() => { if (this.source) this.start() }, delay)
  }

  private watchdog() {
    const video = this.video
    if (!this.source || !video) return
    const pos = video.currentTime * 1000
    if (!this.isLive) {
      this.positionMs = this.currentPosition()
      if (this.probe?.direct && Number.isFinite(video.duration) && video.duration > 0) this.durationMs = Math.round(video.duration * 1000)
      this.emit()
    }
    if (this.state === 'Reconnecting' && video.paused) return
    if (this.userPaused) { this.lastProgressAt = Date.now(); return }
    const buffered = video.buffered.length ? video.buffered.end(video.buffered.length - 1) * 1000 : 0
    const starved = this.isLive && pos > buffered + 3000
    if (!video.paused && pos !== this.lastPos && !starved) {
      this.lastPos = pos
      this.lastProgressAt = Date.now()
      if (this.videoFrozen(video)) {
        // Sound without pictures, more than once: the browser doesn't really decode this video.
        if (this.attempt > 0) this.useH264()
        this.scheduleRetry('video fermo, audio regolare')
        return
      }
      // After a minute of regular watching the attempts start over.
      if (this.attempt > 0 && Date.now() - this.startedAt > 60_000) this.attempt = 0
      if (this.state !== 'Playing') this.setState('Playing')
      return
    }
    const limit = this.isLive && this.everPlayed ? 12_000 : this.isLive ? 25_000 : this.everPlayed ? 20_000 : 35_000
    if (Date.now() - this.lastProgressAt > limit) {
      // A film that never started: the browser can't really show its video (black screen).
      if (!this.isLive && !this.everPlayed) this.useH264()
      this.scheduleRetry('flusso bloccato')
    }
  }

  /** Re-encodes the video in H.264 from the next attempt on; false when it already is. */
  private useH264(): boolean {
    if (this.reencode) return false
    this.reencode = true
    this.note('passo alla ricodifica H.264')
    if (this.probe) this.probe = { ...this.probe, direct: false }
    return true
  }

  /** Time follows the audio: if no frame is shown for 4 s while it advances, the stream is reopened. */
  private videoFrozen(video: HTMLVideoElement): boolean {
    // A file with a video whose pictures never came: the browser plays only its sound.
    if (!video.videoWidth && this.probe?.video && this.everPlayed && Date.now() - this.startedAt > 8_000) return true
    if (!video.videoWidth || !video.getVideoPlaybackQuality) return false
    const q = video.getVideoPlaybackQuality()
    const frames = q.totalVideoFrames - q.droppedVideoFrames
    const t = Date.now()
    if (frames !== this.lastFrames) {
      this.lastFrames = frames
      this.lastFrameAt = t
      return false
    }
    return this.everPlayed && t - this.startedAt > 8_000 && t - this.lastFrameAt > 4_000
  }

  togglePause() {
    const video = this.video
    if (!this.source || !video) return
    this.userPaused = !this.userPaused
    if (this.userPaused) {
      video.pause()
      this.setState('Paused')
    } else {
      // A paused live channel jumps back to now, like a TV.
      if (this.ts && video.buffered.length) video.currentTime = Math.max(video.currentTime, video.buffered.end(video.buffered.length - 1) - 1)
      this.go(video)
    }
  }

  seekBy(deltaMs: number) {
    if (this.isLive || !this.source) return
    const d = this.durationMs > 0 ? this.durationMs : Number.MAX_SAFE_INTEGER
    this.seekTo(Math.min(Math.max(0, this.currentPosition() + deltaMs), Math.max(0, d - 1000)))
  }

  seekTo(ms: number) {
    const video = this.video
    if (this.isLive || !this.source || !video) return
    const target = Math.max(0, ms)
    this.positionMs = target
    if (this.probe?.direct) {
      video.currentTime = target / 1000
    } else {
      this.resumeMs = target
      this.start()
    }
    this.emit()
  }

  selectAudio(index: number) {
    if (!this.source || index === this.audio) return
    this.audio = index
    this.audioTracks = this.audioTracks.map((t) => ({ ...t, selected: t.index === index }))
    if (!this.isLive) this.resumeMs = this.currentPosition()
    if (this.probe) this.probe = { ...this.probe, direct: false }
    this.start()
  }

  stop() {
    clearTimeout(this.retryTimer)
    this.session++
    this.source = null
    this.release()
    this.attempt = 0
    this.setState('Idle')
    api('/api/play/stop', { method: 'POST' }).catch(() => { /* server unreachable: ffmpeg stops when the connection closes */ })
  }

  currentPosition(): number {
    const video = this.video
    if (!this.source || !video) return 0
    if (this.state === 'Connecting' || this.state === 'Reconnecting') return this.isLive ? 0 : this.resumeMs
    return Math.round((this.offsetSec + video.currentTime) * 1000)
  }

  currentDuration(): number {
    return this.durationMs
  }
}
