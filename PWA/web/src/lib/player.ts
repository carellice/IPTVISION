// player/PlayerController.kt nel browser: un solo <video>, con riconnessione automatica.
// Un controllo ogni secondo verifica che il flusso avanzi davvero: se si blocca senza errori (caso tipico
// delle IPTV) lo si riapre, aspettando un po' di più a ogni tentativo.
// La diretta arriva in MPEG-TS e la legge mpegts.js; film ed episodi arrivano così come sono (MP4) o
// rimontati da ffmpeg sul server: in quel caso il server parte dal punto chiesto e qui si tiene lo scarto.
import mpegts from 'mpegts.js'
import type { ProbeResult } from '../../../shared/api.ts'
import { api } from './api.ts'

export type PlaybackState = 'Idle' | 'Connecting' | 'Buffering' | 'Playing' | 'Paused' | 'Reconnecting'

export type Source =
  | { kind: 'live'; id: number; fmt: 'ts' | 'm3u8'; aac: boolean }
  | { kind: 'movie' | 'episode'; id: string | number; ext: string }

export const video = document.createElement('video')
video.playsInline = true
video.preload = 'auto'
video.setAttribute('playsinline', '')
video.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;background:#000'

const listeners = new Set<() => void>()
let version = 0
const emit = () => { version++; listeners.forEach((l) => l()) }

export const playerStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  get version() { return version },
}

const now = () => Date.now()

class PlayerController {
  state: PlaybackState = 'Idle'
  attempt = 0
  videoSize = ''
  audios: { index: number; label: string }[] = []
  audioIndex = 0
  /** Un film o un episodio è arrivato alla fine. */
  onEnded: (() => void) | null = null
  /** Un film o un episodio non si apre nonostante i tentativi. */
  onFailed: (() => void) | null = null

  private source: Source | null = null
  private ffmpeg = false
  isLive = true
  private resumeMs = 0
  private remux = false
  private offsetMs = 0
  private probeDurationMs = 0
  private ts: mpegts.Player | null = null
  private retryTimer: number | null = null
  private lastPos = -1
  private lastProgressAt = 0
  private startedAt = 0
  private userPaused = false
  private everPlayed = false
  private lastFrames = -1
  private lastFrameAt = 0
  private token = 0

  constructor() {
    video.addEventListener('playing', () => {
      if (!this.source) return
      this.everPlayed = true
      this.set('Playing')
      this.lastProgressAt = now()
    })
    video.addEventListener('waiting', () => { if (this.source && this.state !== 'Reconnecting') this.set(this.everPlayed ? 'Buffering' : 'Connecting') })
    video.addEventListener('pause', () => { if (this.source && this.userPaused) this.set('Paused') })
    video.addEventListener('loadedmetadata', () => this.updateSize())
    video.addEventListener('resize', () => this.updateSize())
    video.addEventListener('error', () => {
      if (!this.source || this.retryTimer != null || !video.getAttribute('src')) return
      const code = video.error?.code
      // Il browser non legge questo file: ci pensa ffmpeg sul server.
      if (!this.isLive && !this.remux && this.ffmpeg && code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        console.log('Formato non letto dal browser: passo alla conversione sul server')
        this.remux = true
        this.offsetMs = this.resumeMs
        this.start()
        return
      }
      this.scheduleRetry('errore di riproduzione')
    })
    video.addEventListener('ended', () => {
      if (!this.source) return
      // Un canale in diretta che "finisce" è un flusso caduto: si riapre.
      if (this.isLive) { this.scheduleRetry('flusso terminato'); return }
      // Un flusso convertito che si chiude molto prima della fine è una connessione caduta.
      const d = this.durationMs
      if (d > 0 && d - this.positionMs > 90_000) { this.scheduleRetry('flusso interrotto'); return }
      this.set('Idle')
      this.onEnded?.()
    })
    window.setInterval(() => this.watchdog(), 1000)
  }

  private set(s: PlaybackState) {
    if (this.state === s) return
    this.state = s
    emit()
  }

  private updateSize() {
    const h = video.videoHeight
    const s = h > 0 ? `${h}p` : ''
    if (s !== this.videoSize) { this.videoSize = s; emit() }
  }

  get isActive() { return this.source != null }
  get paused() { return this.state === 'Paused' }

  get positionMs(): number {
    if (!this.source || this.isLive) return 0
    const t = Number.isFinite(video.currentTime) ? video.currentTime * 1000 : 0
    return this.remux ? this.offsetMs + t : t
  }

  get durationMs(): number {
    if (!this.source || this.isLive) return 0
    if (!this.remux && Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000
    return this.probeDurationMs
  }

  async play(source: Source, live: boolean, resumeMs = 0, ffmpeg = false) {
    this.clearRetry()
    const token = ++this.token
    this.source = source
    this.isLive = live
    this.ffmpeg = ffmpeg
    this.resumeMs = resumeMs
    this.attempt = 0
    this.everPlayed = false
    this.userPaused = false
    this.remux = false
    this.offsetMs = 0
    this.probeDurationMs = 0
    this.audios = []
    this.audioIndex = 0
    this.videoSize = ''
    this.teardown()
    this.set('Connecting')
    emit()
    if (!live && ffmpeg && source.kind !== 'live') {
      // ffprobe sul server: durata, tracce audio e se il browser lo legge così com'è.
      const p = await api<ProbeResult | null>(`/api/probe/${source.kind}/${encodeURIComponent(String(source.id))}?ext=${encodeURIComponent(source.ext)}`).catch(() => null)
      if (token !== this.token) return
      if (p) {
        this.probeDurationMs = p.durationMs
        this.audios = p.audios
        this.remux = !p.direct
        this.offsetMs = this.remux ? resumeMs : 0
      }
    }
    this.start()
  }

  private url(): string {
    const s = this.source!
    if (s.kind === 'live') return `/api/stream/live/${s.id}?fmt=${s.fmt}&aac=${s.aac ? 1 : 0}`
    const base = `/api/stream/${s.kind}/${encodeURIComponent(String(s.id))}?ext=${encodeURIComponent(s.ext)}`
    return this.remux ? `${base}&mode=remux&start=${Math.floor(this.offsetMs / 1000)}&audio=${this.audioIndex}` : base
  }

  private teardown() {
    if (this.ts) {
      try { this.ts.pause(); this.ts.unload(); this.ts.detachMediaElement(); this.ts.destroy() } catch { /* già chiuso */ }
      this.ts = null
    }
    video.pause()
    video.removeAttribute('src')
    try { video.load() } catch { /* niente da scaricare */ }
  }

  private start() {
    if (!this.source) return
    this.teardown()
    this.set(this.attempt > 0 ? 'Reconnecting' : 'Connecting')
    this.lastPos = -1
    this.startedAt = this.lastProgressAt = now()
    this.lastFrames = -1
    this.lastFrameAt = this.startedAt
    const url = this.url()
    if (this.isLive && mpegts.getFeatureList().mseLivePlayback) {
      // Come sui TV: si tengono solo 30 s già visti e niente inseguimento della latenza.
      // mpegts.js scarica in un worker: lì un indirizzo relativo non vale.
      const ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: new URL(url, location.href).href }, {
        enableWorker: true, lazyLoad: false, enableStashBuffer: true,
        autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 15,
        liveBufferLatencyChasing: false,
      })
      ts.on(mpegts.Events.ERROR, () => this.scheduleRetry('errore del flusso'))
      ts.attachMediaElement(video)
      ts.load()
      this.ts = ts
    } else {
      video.src = url
      if (!this.isLive && !this.remux && this.resumeMs > 0) {
        const seek = () => {
          video.removeEventListener('loadedmetadata', seek)
          try { video.currentTime = this.resumeMs / 1000 } catch { /* posizione non valida */ }
        }
        video.addEventListener('loadedmetadata', seek)
      }
    }
    if (!this.userPaused) this.resume()
  }

  private resume() {
    video.play().catch((e: DOMException) => {
      // Il browser non fa partire l'audio senza un tocco: si resta in pausa, basta premere play.
      if (e?.name === 'NotAllowedError') { this.userPaused = true; this.set('Paused') }
    })
  }

  private clearRetry() {
    if (this.retryTimer != null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private scheduleRetry(reason: string) {
    if (!this.source) return
    this.clearRetry()
    if (!this.isLive) {
      const p = this.positionMs
      if (p > 0) this.resumeMs = p
      if (this.remux) this.offsetMs = this.resumeMs
      if (this.attempt >= 6) { this.stop(); this.onFailed?.(); return }
    }
    this.attempt++
    this.set('Reconnecting')
    emit()
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(this.attempt - 1, 4))
    console.warn(`Riconnessione (${reason}), tentativo ${this.attempt} tra ${delay}ms`)
    // Si chiude subito il flusso: molti fornitori accettano una sola connessione.
    this.teardown()
    this.retryTimer = window.setTimeout(() => { this.retryTimer = null; this.start() }, delay)
  }

  togglePause() {
    if (!this.source) return
    this.userPaused = !this.userPaused
    if (this.userPaused) { video.pause(); this.set('Paused') } else { this.resume(); if (this.state === 'Paused') this.set(this.everPlayed ? 'Playing' : 'Connecting') }
  }

  /** Pausa senza cambiare la scelta dell'utente (app in background). */
  pauseForBackground(): boolean {
    if (!this.source || this.userPaused) return false
    this.togglePause()
    return true
  }

  seekTo(ms: number) {
    if (!this.source || this.isLive) return
    const d = this.durationMs
    const target = Math.max(0, d > 0 ? Math.min(ms, d - 1000) : ms)
    if (this.remux) {
      this.offsetMs = target
      this.resumeMs = target
      this.start()
    } else {
      try { video.currentTime = target / 1000 } catch { /* non ancora pronto */ }
    }
    emit()
  }

  seekBy(deltaMs: number) {
    this.seekTo(this.positionMs + deltaMs)
  }

  /** Traccia audio: la sceglie ffmpeg sul server, ripartendo dal punto attuale. */
  selectAudio(index: number) {
    if (!this.source || this.isLive || !this.ffmpeg || index === this.audioIndex) return
    const p = this.positionMs
    this.audioIndex = index
    this.remux = true
    this.offsetMs = p
    this.resumeMs = p
    this.start()
    emit()
  }

  stop() {
    this.clearRetry()
    this.token++
    this.source = null
    this.teardown()
    this.set('Idle')
    emit()
  }

  private videoFrozen(): boolean {
    // Il tempo segue l'audio: se per 4 secondi non arriva nessun fotogramma mentre l'audio va avanti,
    // l'immagine è ferma e si riapre il flusso.
    if (video.videoHeight === 0 || typeof video.getVideoPlaybackQuality !== 'function') return false
    const q = video.getVideoPlaybackQuality()
    const frames = q.totalVideoFrames - q.droppedVideoFrames
    const t = now()
    if (frames !== this.lastFrames) { this.lastFrames = frames; this.lastFrameAt = t; return false }
    return t - this.lastFrameAt > 4000
  }

  private watchdog() {
    if (!this.source) return
    if (!this.isLive) emit()
    if (this.retryTimer != null) { this.lastProgressAt = now(); return }
    if (this.userPaused) { this.lastProgressAt = now(); return }
    const pos = video.currentTime * 1000
    // Un flusso TS che smette di arrivare può restare "in riproduzione" con l'orologio che avanza oltre
    // i dati ricevuti: conta come avanzamento solo ciò che sta dentro il buffer.
    const b = video.buffered
    const bufferedEnd = b.length ? b.end(b.length - 1) * 1000 : 0
    const starved = this.isLive && pos > bufferedEnd + 3000
    if (!video.paused && pos !== this.lastPos && !starved) {
      this.lastPos = pos
      this.lastProgressAt = now()
      if (this.state !== 'Playing' && video.readyState >= 3) this.set('Playing')
      if (this.videoFrozen()) { this.scheduleRetry('video fermo, audio regolare'); return }
      // Dopo un minuto di visione regolare i tentativi ripartono da capo.
      if (this.attempt > 0 && now() - this.startedAt > 60_000) { this.attempt = 0; emit() }
      return
    }
    const limit = this.isLive && this.everPlayed ? 12_000 : this.isLive ? 25_000 : this.everPlayed ? 20_000 : 35_000
    if (now() - this.lastProgressAt > limit) this.scheduleRetry('flusso bloccato')
  }
}

export const player = new PlayerController()
