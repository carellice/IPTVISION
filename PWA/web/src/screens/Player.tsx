import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import { AnimatePresence, motion } from 'framer-motion'
import { progressAt, timeRange } from '../../../shared/epg.ts'
import { clock, episodeLabel, episodeTitle, formatTime } from '../../../shared/text.ts'
import { ActionButton, Artwork, Badge, Clickable, Icon, type IconName, ProgressLine, Spinner } from '../components/ui.tsx'
import { spring } from '../components/motion.ts'
import {
  addBackHandler, app, back, cancelCountdown, guideOf, nextEpisode, playChannel, playChannelNumber, playEpisodeOffset, player, toggleFavorite, useApp, zap,
} from '../lib/app.ts'

// ui/PlayerScreen.kt: full screen video, info and controls overlays that hide by themselves,
// the channel list on the left, audio tracks and the next episode card.

type Overlay = 'None' | 'Info' | 'Controls'

export function Player() {
  useApp()
  const p = app.playing
  const video = useRef<HTMLVideoElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [overlay, setOverlay] = useState<Overlay>('Info')
  const [interaction, setInteraction] = useState(0)
  const [panel, setPanel] = useState(false)
  const [tracks, setTracks] = useState(false)
  const [info, setInfo] = useState(false)
  const [digits, setDigits] = useState('')
  const [full, setFull] = useState(!!document.fullscreenElement)
  const live = p?.kind === 'Live'

  const show = useCallback((o: Overlay) => { setOverlay(o); setInteraction((n) => n + 1) }, [])

  useEffect(() => {
    player.attach(video.current)
    return () => player.attach(null)
  }, [])

  // Phone: landscape and full screen while watching, like the native player.
  useEffect(() => {
    const el = document.documentElement
    if (matchMedia('(pointer: coarse)').matches && !document.fullscreenElement) {
      el.requestFullscreen?.().then(() => (screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.('landscape')).catch(() => { /* not allowed */ })
    }
    const onFull = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFull)
    let lock: { release: () => Promise<void> } | null = null
    ;(navigator as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    return () => {
      document.removeEventListener('fullscreenchange', onFull)
      lock?.release().catch(() => {})
      try { screen.orientation.unlock() } catch { /* not supported */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [])

  // In the background the TV must not keep playing.
  useEffect(() => {
    let resume = false
    const on = () => {
      if (document.visibilityState === 'hidden') {
        resume = player.state !== 'Paused'
        if (resume) player.togglePause()
      } else if (resume) {
        resume = false
        player.togglePause()
      }
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // The info shows at every change of channel or episode and goes away by itself.
  const itemKey = p?.kind === 'Live' ? `c${p.channel.streamId}` : p?.kind === 'Film' ? p.movie.key : p?.kind === 'Ep' ? p.episode.id : ''
  useEffect(() => { show('Info') }, [itemKey, show])
  useEffect(() => {
    if (overlay === 'None' || player.state !== 'Playing' || tracks) return
    const t = setTimeout(() => setOverlay('None'), overlay === 'Info' ? 4000 : 6000)
    return () => clearTimeout(t)
  }, [overlay, interaction, player.state, tracks])
  useEffect(() => { if (player.state === 'Reconnecting') show('Info') }, [player.state, show])
  useEffect(() => {
    if (!digits) return
    const t = setTimeout(() => {
      const n = parseInt(digits, 10)
      if (!Number.isNaN(n)) playChannelNumber(n)
      setDigits('')
    }, 1500)
    return () => clearTimeout(t)
  }, [digits])

  // Back closes the panels first, then the controls, then the player.
  const state = useRef({ tracks, panel, overlay })
  state.current = { tracks, panel, overlay }
  useEffect(() => addBackHandler(() => {
    const s = state.current
    if (s.tracks) { setTracks(false); return true }
    if (s.panel) { setPanel(false); return true }
    if (s.overlay === 'Controls') { setOverlay('None'); return true }
    return false
  }), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.current.tracks || state.current.panel) { if (e.key === 'Escape') { e.preventDefault(); history.back() } return }
      const k = e.key
      const handled = () => e.preventDefault()
      if (k === 'ArrowUp' || k === 'PageUp' || k === 'MediaTrackNext') { handled(); if (live) zap(+1); else if (k === 'ArrowUp') { player.seekBy(60_000); show('Info') } else playEpisodeOffset(+1) }
      else if (k === 'ArrowDown' || k === 'PageDown' || k === 'MediaTrackPrevious') { handled(); if (live) zap(-1); else if (k === 'ArrowDown') { player.seekBy(-60_000); show('Info') } else playEpisodeOffset(-1) }
      else if (k === 'ArrowLeft') { handled(); if (live) setPanel(true); else { player.seekBy(-10_000); show('Info') } }
      else if (k === 'ArrowRight') { handled(); if (live) show('Info'); else { player.seekBy(10_000); show('Info') } }
      else if (k === 'Enter') { handled(); show('Controls') }
      else if (k === ' ' || k === 'MediaPlayPause') { handled(); player.togglePause(); show('Info') }
      else if (k === 'i' || k === 'I') { handled(); setOverlay((o) => (o === 'None' ? 'Info' : 'None')) }
      else if (k === 'Escape') { handled(); history.back() }
      else if (k === 'f' || k === 'F') { handled(); toggleFull() }
      else if (/^[0-9]$/.test(k) && live) { handled(); setDigits((d) => (d.length < 5 ? d + k : d)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, show])

  if (!p) return null
  const busy = player.state === 'Connecting' || player.state === 'Buffering' || player.state === 'Reconnecting'

  return (
    <div ref={root} style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}
      onClick={() => show(overlay === 'Controls' ? 'None' : 'Controls')}>
      <video ref={video} playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />

      {busy && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Spinner color="#fff" />
          {player.state === 'Reconnecting' && (
            <div style={{ marginTop: 12, color: '#fff', background: '#00000099', borderRadius: 8, padding: '6px 10px' }}>Riconnessione… tentativo {player.attempt}</div>
          )}
        </div>
      )}

      {digits && (
        <div className="safe" style={{ position: 'absolute', top: 0, right: 0, pointerEvents: 'none' }}>
          <div style={{ margin: 28, color: '#fff', fontSize: 48, lineHeight: '56px', fontWeight: 700, background: '#000000AA', borderRadius: 12, padding: '6px 18px' }}>{digits}</div>
        </div>
      )}

      <AnimatePresence>
        {overlay !== 'None' && (
          <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring()}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {/* Shades top and bottom to read the text on any picture. */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '35%', background: 'linear-gradient(#000000CC, transparent)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(transparent, #000000EE)' }} />
            <TopBar full={full} onInfo={() => setInfo(true)} />
            <div className="safe" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
              <div style={{ padding: '18px 28px', pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <InfoBlock />
                {overlay === 'Controls' && (
                  <div style={{ marginTop: 14 }}>
                    <Controls onChannels={() => setPanel(true)} onTracks={() => setTracks(true)} onAny={() => setInteraction((n) => n + 1)} />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel && p.kind === 'Live' && (
          <motion.div key="panel" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={spring()}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0 }} onClick={(e) => e.stopPropagation()}>
            <ChannelPanel close={() => setPanel(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {tracks && <TracksPanel close={() => setTracks(false)} />}
      {info && <InfoPanel close={() => setInfo(false)} />}

      {app.nextEpisodeCountdown != null && <NextEpisodeCard seconds={app.nextEpisodeCountdown} />}
    </div>
  )
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  else document.documentElement.requestFullscreen?.().catch(() => {})
}

function TopBar({ full, onInfo }: { full: boolean; onInfo: () => void }) {
  const p = app.playing!
  const title = p.kind === 'Live' ? 'TV in diretta' : p.kind === 'Film' ? 'Film' : p.series.name
  return (
    <div className="safe" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <Clickable onClick={() => back()} title="Indietro" radius="50%" background="transparent" style={{ padding: 10 }}>
          <Icon name="arrow_back" color="#fff" />
        </Clickable>
        <div style={{ width: 8 }} />
        <div className="ellipsis" style={{ flex: 1, color: 'var(--text2)', fontSize: 14 }}>{title}</div>
        <Clickable onClick={onInfo} title="Informazioni tecniche" radius="50%" background="transparent" style={{ padding: 8, marginRight: 8 }}>
          <Icon name="info_outline" color="#fff" />
        </Clickable>
        {player.videoSize && <><Badge text={player.videoSize} /><div style={{ width: 12 }} /></>}
        <Clickable onClick={toggleFull} title={full ? 'Esci da schermo intero' : 'Schermo intero'} radius="50%" background="transparent" style={{ padding: 8, marginRight: 8 }}>
          <Icon name={full ? 'fullscreen_exit' : 'fullscreen'} color="#fff" />
        </Clickable>
        <div style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>{clock(Date.now() / 1000)}</div>
      </div>
    </div>
  )
}

function InfoBlock() {
  const p = app.playing!
  if (p.kind === 'Live') {
    const ch = p.channel
    const [now, next] = guideOf(ch)
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Artwork url={ch.logo} initials={ch.initials} fit="contain" fontSize={18} style={{ width: 96, height: 64, borderRadius: 10 }} />
        <div style={{ flex: 1, minWidth: 0, marginLeft: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--live)', flexShrink: 0 }} />
            <div style={{ width: 8 }} />
            {ch.num > 0 && <div style={{ color: 'var(--text2)', fontSize: 18, marginRight: 10 }}>{ch.num}</div>}
            <div className="ellipsis" style={{ color: '#fff', fontSize: 24, fontWeight: 700 }}>{ch.name}</div>
            {app.favorites.has(ch.streamId) && <Icon name="star" size={20} color="var(--star)" style={{ marginLeft: 8 }} />}
          </div>
          {now && (
            <>
              <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 15 }}>{`${timeRange(now)}  ${now.title}`}</div>
              <ProgressLine progress={progressAt(now, Date.now() / 1000)} style={{ width: '50%', marginTop: 5 }} />
            </>
          )}
          {next && <div className="ellipsis" style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>{`Dopo: ${timeRange(next).split(' ')[0]}  ${next.title}`}</div>}
        </div>
      </div>
    )
  }
  const title = p.kind === 'Film' ? p.movie.name : `${episodeLabel(p.episode)} · ${episodeTitle(p.episode)}`
  const dur = player.durationMs
  return (
    <>
      <div className="ellipsis" style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>{title}</div>
      <div style={{ height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ color: 'var(--text)', fontSize: 13 }}>{formatTime(player.positionMs)}</div>
        <ProgressLine progress={dur > 0 ? player.positionMs / dur : 0} height={4} style={{ flex: 1, margin: '0 12px' }} />
        <div style={{ color: 'var(--text)', fontSize: 13 }}>{dur > 0 ? formatTime(dur) : '--:--'}</div>
      </div>
    </>
  )
}

function Controls({ onChannels, onTracks, onAny }: { onChannels: () => void; onTracks: () => void; onAny: () => void }) {
  const p = app.playing!
  const paused = player.state === 'Paused'
  const act = (f: () => void) => () => { onAny(); f() }
  return (
    <>
      {p.kind !== 'Live' && player.durationMs > 0 && <Slider onAny={onAny} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {p.kind === 'Live' ? (
          <>
            <RoundButton icon="keyboard_arrow_down" title="Canale precedente" onClick={act(() => zap(-1))} />
            <RoundButton icon={paused ? 'play_arrow' : 'pause'} title="Pausa" big onClick={act(() => player.togglePause())} />
            <RoundButton icon="keyboard_arrow_up" title="Canale successivo" onClick={act(() => zap(+1))} />
            <RoundButton icon="list" title="Canali" onClick={act(onChannels)} />
            {(() => {
              const fav = app.favorites.has(p.channel.streamId)
              return <RoundButton icon={fav ? 'star' : 'star_border'} title="Preferito" tint={fav ? 'var(--star)' : '#fff'} onClick={act(() => toggleFavorite(p.channel))} />
            })()}
          </>
        ) : (
          <>
            {p.kind === 'Ep' && <RoundButton icon="skip_previous" title="Episodio precedente" onClick={act(() => playEpisodeOffset(-1))} />}
            <RoundButton icon="replay_10" title="Indietro 10 s" onClick={act(() => player.seekBy(-10_000))} />
            <RoundButton icon={paused ? 'play_arrow' : 'pause'} title="Pausa" big onClick={act(() => player.togglePause())} />
            <RoundButton icon="forward_10" title="Avanti 10 s" onClick={act(() => player.seekBy(10_000))} />
            {p.kind === 'Ep' && <RoundButton icon="skip_next" title="Episodio successivo" onClick={act(() => playEpisodeOffset(+1))} />}
          </>
        )}
        <RoundButton icon="subtitles" title="Audio e sottotitoli" onClick={act(onTracks)} />
      </div>
    </>
  )
}

/** M3 Slider: white thumb, Accent active track, StrokeStrong inactive. */
function Slider({ onAny }: { onAny: () => void }) {
  const [drag, setDrag] = useState<number | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const value = drag ?? (player.durationMs > 0 ? player.positionMs / player.durationMs : 0)
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (x - r.left) / r.width))
  }
  return (
    <div ref={track} style={{ height: 48, position: 'relative', touchAction: 'none', cursor: 'pointer' }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(at(e.clientX)); onAny() }}
      onPointerMove={(e) => { if (drag != null) { setDrag(at(e.clientX)); onAny() } }}
      onPointerUp={() => { if (drag != null) player.seekTo(drag * player.durationMs); setDrag(null) }}
      onPointerCancel={() => setDrag(null)}>
      <div style={{ position: 'absolute', left: 10, right: 10, top: 22, height: 4, borderRadius: 2, background: 'var(--strokeStrong)' }}>
        <div style={{ width: `${value * 100}%`, height: 4, borderRadius: 2, background: 'var(--accent)' }} />
      </div>
      <div style={{ position: 'absolute', top: 14, left: `calc(10px + (100% - 20px) * ${value} - 10px)`, width: 20, height: 20, borderRadius: '50%', background: '#fff' }} />
    </div>
  )
}

function RoundButton({ icon, title, big, tint = '#fff', onClick }: { icon: IconName; title: string; big?: boolean; tint?: string; onClick: () => void }) {
  return (
    <Clickable onClick={onClick} title={title} radius="50%" background="#FFFFFF33" style={{ padding: big ? 16 : 12 }}>
      <Icon name={icon} size={big ? 32 : 26} color={tint} />
    </Clickable>
  )
}

function ChannelPanel({ close }: { close: () => void }) {
  const p = app.playing
  const list = p?.kind === 'Live' ? p.playlist : []
  const idx = Math.max(0, list.findIndex((c) => p?.kind === 'Live' && c.streamId === p.channel.streamId))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'center' })
  }, [])
  if (p?.kind !== 'Live') return null
  return (
    <div className="safe" style={{ width: 380, maxWidth: '100vw', height: '100%', background: '#111318F0', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        <div style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700, padding: 8 }}>Canali</div>
        <div ref={ref} className="scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: 4 }}>
          {list.map((ch, i) => {
            const [now] = guideOf(ch)
            return (
              <div key={ch.streamId} data-current={i === idx}>
                <Clickable onClick={() => { playChannel(ch, list); close() }} background={i === idx ? 'var(--accentSoft)' : 'transparent'}
                  style={{ display: 'flex', alignItems: 'center', padding: 8 }}>
                  <Artwork url={ch.logo} initials={ch.initials} fit="contain" fontSize={12} style={{ width: 54, height: 36, borderRadius: 6 }} />
                  <div style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                    <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 14 }}>{(ch.num > 0 ? `${ch.num}  ` : '') + ch.name}</div>
                    {now && <div className="ellipsis" style={{ color: 'var(--text2)', fontSize: 12 }}>{now.title}</div>}
                  </div>
                </Clickable>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TracksPanel({ close }: { close: () => void }) {
  const audio = player.audioTracks
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#00000099', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { e.stopPropagation(); close() }}>
      <div className="scroll" onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)', borderRadius: 16, background: 'var(--panel)', padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ color: 'var(--text2)', fontWeight: 700, padding: 6 }}>Audio</div>
        {audio.length <= 1 && <div style={{ color: 'var(--text3)', padding: 6 }}>Una sola traccia</div>}
        {audio.length > 1 && audio.map((t) => (
          <TrackRow key={t.index} label={t.label} selected={t.selected} onClick={() => { player.selectAudio(t.index); close() }} />
        ))}
        <div style={{ color: 'var(--text2)', fontWeight: 700, padding: '14px 6px 6px' }}>Sottotitoli</div>
        <TrackRow label="Disattivati" selected onClick={close} />
      </div>
    </div>
  )
}

/** Technical details of the playback, to understand why a film doesn't play on a device. */
function InfoPanel({ close }: { close: () => void }) {
  const [server, setServer] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const load = () => api<{ ffmpeg: string }>('/api/play/log').then((r) => setServer(r.ffmpeg)).catch((e) => setServer(`non disponibile: ${e instanceof Error ? e.message : e}`))
    load()
    const t = window.setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])
  const rows = player.details()
  const text = [...rows.map(([k, v]) => `${k}: ${v}`), '', 'Registro:', ...player.log, '', `Server: ${server || 'nessun errore'}`].join('\n')
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => { /* not allowed: the text can be selected */ })
  }
  const mono: CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text' }
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#00000099', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { e.stopPropagation(); close() }}>
      <div className="scroll" onClick={(e) => e.stopPropagation()}
        style={{ width: 640, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)', borderRadius: 16, background: 'var(--panel)', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, color: 'var(--text2)', fontWeight: 700, padding: 6 }}>Informazioni tecniche</div>
          <Clickable onClick={copy} background="transparent" style={{ padding: '8px 12px' }}>
            <div style={{ color: 'var(--accent2)', fontWeight: 600 }}>{copied ? 'Copiato' : 'Copia'}</div>
          </Clickable>
          <Clickable onClick={close} title="Chiudi" radius="50%" background="transparent" style={{ padding: 8 }}>
            <Icon name="close" color="var(--text)" />
          </Clickable>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 10, padding: '0 6px' }}>
            <div style={{ width: 120, flexShrink: 0, color: 'var(--text3)', fontSize: 13 }}>{k}</div>
            <div style={mono}>{v}</div>
          </div>
        ))}
        <div style={{ color: 'var(--text2)', fontWeight: 700, padding: '10px 6px 0' }}>Registro</div>
        <div style={{ ...mono, padding: '0 6px' }}>{player.log.join('\n') || 'vuoto'}</div>
        <div style={{ color: 'var(--text2)', fontWeight: 700, padding: '10px 6px 0' }}>Server (ffmpeg)</div>
        <div style={{ ...mono, padding: '0 6px' }}>{server || 'nessun errore'}</div>
      </div>
    </div>
  )
}

function TrackRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <Clickable onClick={onClick} background={selected ? 'var(--accentSoft)' : 'transparent'} style={{ padding: 12 }}>
      <div style={{ color: selected ? 'var(--accent2)' : 'var(--text)', fontWeight: selected ? 600 : 400 }}>{label}</div>
    </Clickable>
  )
}

function NextEpisodeCard({ seconds }: { seconds: number }) {
  const next = nextEpisode()
  if (!next) return null
  return (
    <motion.div className="safe" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring(1, 400)}
      style={{ position: 'absolute', right: 0, bottom: 0 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ margin: 28, width: 360, maxWidth: 'calc(100vw - 56px)', borderRadius: 16, background: '#111318EE', padding: 18 }}>
        <div style={{ color: 'var(--text2)', fontSize: 13 }}>Prossimo episodio tra {seconds} s</div>
        <div className="clamp2" style={{ color: '#fff', fontSize: 17, fontWeight: 600 }}>{`${episodeLabel(next)} · ${episodeTitle(next)}`}</div>
        <div style={{ height: 12 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <ActionButton text="Riproduci ora" icon="play_arrow" primary onClick={() => playEpisodeOffset(+1)} />
          <ActionButton text="Annulla" onClick={() => { cancelCountdown(); back() }} />
        </div>
      </div>
    </motion.div>
  )
}
