// ui/PlayerScreen.kt
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { episodeLabel, episodeTitle, progressAt, type Channel } from '../../../shared/model.ts'
import { clock, formatTime } from '../../../shared/text.ts'
import { useBackHandler } from '../lib/back.ts'
import { useVm, vm, type Playing } from '../lib/app.ts'
import { player, playerStore, video } from '../lib/player.ts'
import { ActionButton, Artwork, Badge, C, Clickable, Icon, ProgressLine, Spinner, type IconName } from '../components/ui.tsx'
import { spring } from '../components/motion.ts'

type Overlay = 'None' | 'Info' | 'Controls'

const usePlayer = () => {
  useSyncExternalStore(playerStore.subscribe, () => playerStore.version)
  return player
}

const touchDevice = () => window.matchMedia('(pointer: coarse)').matches

export function PlayerScreen() {
  const v = useVm()
  const pc = usePlayer()
  const p = v.playing
  const host = useRef<HTMLDivElement>(null)
  const [overlay, setOverlay] = useState<Overlay>('Info')
  const [interaction, setInteraction] = useState(0)
  const [panel, setPanel] = useState(false)
  const [tracks, setTracks] = useState(false)
  const [digits, setDigits] = useState('')
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement)

  const show = (o: Overlay) => { setOverlay(o); setInteraction((n) => n + 1) }

  // Il video vive fuori da React: lo si appoggia in questa schermata finché si guarda.
  useLayoutEffect(() => {
    host.current?.appendChild(video)
    return () => { video.remove() }
  }, [])

  // Telefono: orizzontale e a schermo intero finché si guarda.
  useEffect(() => {
    let wake: { release(): Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }
    nav.wakeLock?.request('screen').then((w) => { wake = w }).catch(() => { /* non disponibile */ })
    if (touchDevice()) {
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => { /* il browser non lo permette */ })
    }
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      void wake?.release().catch(() => {})
      try { (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.() } catch { /* niente */ }
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  // In background la TV non deve continuare a suonare, tranne in picture-in-picture.
  useEffect(() => {
    let resumeOnShow = false
    const vis = () => {
      if (document.visibilityState === 'hidden') {
        if (document.pictureInPictureElement) return
        vm.savePosition()
        resumeOnShow = player.pauseForBackground()
      } else if (resumeOnShow) {
        resumeOnShow = false
        player.togglePause()
      }
    }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])

  // Le informazioni compaiono a ogni cambio di canale/episodio e spariscono da sole.
  const itemKey = !p ? '' : p.kind === 'Live' ? `c${p.channel.streamId}` : p.kind === 'Film' ? p.movie.key : `e:${p.episode.id}`
  useEffect(() => { if (overlay === 'None') show('Info') }, [itemKey])
  useEffect(() => {
    if (overlay !== 'None' && pc.state === 'Playing' && !tracks) {
      const t = setTimeout(() => setOverlay('None'), overlay === 'Info' ? 4000 : 6000)
      return () => clearTimeout(t)
    }
  }, [overlay, interaction, pc.state, tracks])
  useEffect(() => {
    if (!digits) return
    const t = setTimeout(() => {
      const n = Number(digits)
      if (Number.isInteger(n)) vm.playChannelNumber(n)
      setDigits('')
    }, 1500)
    return () => clearTimeout(t)
  }, [digits])
  useEffect(() => { if (pc.state === 'Reconnecting') show('Info') }, [pc.state])
  useEffect(() => {
    // I comandi prendono il focus sul pulsante di pausa, come col telecomando.
    if (overlay === 'Controls' && !panel && !tracks) document.querySelector<HTMLElement>('[data-play]')?.focus({ preventScroll: true })
  }, [overlay, panel, tracks])

  useBackHandler(tracks, () => setTracks(false))
  useBackHandler(panel && !tracks, () => setPanel(false))
  useBackHandler(overlay === 'Controls' && !panel && !tracks, () => setOverlay('None'))

  // Tastiera e telecomando del PC.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!vm.playing || panel || tracks) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT') return
      const inControls = !!t.closest?.('[data-controls]')
      if (inControls && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const buttons = [...document.querySelectorAll<HTMLElement>('[data-controls] [role="button"]')]
        const i = buttons.indexOf(t.closest('[role="button"]') as HTMLElement)
        buttons[Math.min(buttons.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus()
        e.preventDefault()
        return
      }
      const isLive = vm.playing.kind === 'Live'
      let handled = true
      switch (e.key) {
        case 'ArrowUp': if (isLive) vm.zap(+1); else { player.seekBy(60_000); show('Info') } break
        case 'ArrowDown': if (isLive) vm.zap(-1); else { player.seekBy(-60_000); show('Info') } break
        case 'PageUp': case 'ChannelUp': case 'MediaTrackNext': if (isLive) vm.zap(+1); else vm.playEpisodeOffset(+1); break
        case 'PageDown': case 'ChannelDown': case 'MediaTrackPrevious': if (isLive) vm.zap(-1); else vm.playEpisodeOffset(-1); break
        case 'ArrowLeft': if (isLive) setPanel(true); else { player.seekBy(-10_000); show('Info') } break
        case 'ArrowRight': if (isLive) show('Info'); else { player.seekBy(10_000); show('Info') } break
        case 'MediaFastForward': player.seekBy(30_000); show('Info'); break
        case 'MediaRewind': player.seekBy(-30_000); show('Info'); break
        case 'Enter': if (inControls) handled = false; else show('Controls'); break
        case ' ': case 'MediaPlayPause': case 'MediaPlay': case 'MediaPause': player.togglePause(); show('Info'); break
        case 'i': case 'I': case 'Info': show(overlay === 'None' ? 'Info' : 'None'); break
        case 'f': case 'F': toggleFullscreen(); break
        case 'Escape': vm.back(); break
        case 'ContextMenu': if (isLive) { vm.toggleFavorite((vm.playing as Extract<Playing, { kind: 'Live' }>).channel); show('Info') } else show('Controls'); break
        default:
          if (/^[0-9]$/.test(e.key) && isLive) setDigits((d) => (d.length < 5 ? d + e.key : d))
          else handled = false
      }
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [panel, tracks, overlay])

  if (!p) return <div style={{ height: '100%', background: '#000' }} />
  const loading = pc.state === 'Connecting' || pc.state === 'Buffering' || pc.state === 'Reconnecting'

  return (
    <div style={{ position: 'relative', height: '100%', background: '#000', overflow: 'clip' }}
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'VIDEO' || (e.target as HTMLElement).dataset.tap) show(overlay === 'Controls' ? 'None' : 'Controls') }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />

      {loading && (
        <div className="col" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Spinner color={C.White} />
          {pc.state === 'Reconnecting' && (
            <div style={{ marginTop: 12, color: C.White, background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '6px 10px' }}>Riconnessione… tentativo {pc.attempt}</div>
          )}
        </div>
      )}

      {digits && (
        <div style={{ position: 'absolute', top: 'calc(28px + env(safe-area-inset-top))', right: 'calc(28px + env(safe-area-inset-right))', color: C.White, fontSize: 48, lineHeight: '56px', fontWeight: 700, background: 'rgba(0,0,0,0.667)', borderRadius: 12, padding: '6px 18px' }}>{digits}</div>
      )}

      <AnimatePresence>
        {overlay !== 'None' && (
          <motion.div key="overlay" data-tap="1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring(1, 400)}
            style={{ position: 'absolute', inset: 0 }}>
            {/* Sfumature in alto e in basso per leggere il testo su qualsiasi immagine. */}
            <div data-tap="1" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '35%', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)' }} />
            <div data-tap="1" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.933))' }} />
            <TopBar p={p} fullscreen={fullscreen} />
            <div className="col" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px calc(28px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(28px + env(safe-area-inset-left))' }}>
              <InfoBlock p={p} />
              {overlay === 'Controls' && (
                <>
                  <div style={{ height: 14 }} />
                  <Controls p={p} onChannels={() => setPanel(true)} onTracks={() => setTracks(true)} onAny={() => setInteraction((n) => n + 1)} />
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel && p.kind === 'Live' && (
          <motion.div key="panel" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={spring(1, 400)}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 5 }}>
            <ChannelPanel channel={p.channel} list={p.playlist} close={() => setPanel(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {tracks && <TracksPanel close={() => setTracks(false)} />}

      {v.nextEpisodeCountdown != null && <NextEpisodeCard seconds={v.nextEpisodeCountdown} />}
    </div>
  )
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  else void document.documentElement.requestFullscreen?.().catch(() => {})
}

function RoundIcon({ icon, label, onClick, color = C.White, size = 24 }: { icon: IconName; label: string; onClick: () => void; color?: string; size?: number }) {
  return (
    <Clickable radius={999} background={C.Transparent} focusedBackground="rgba(255,255,255,0.2)" onClick={onClick} label={label} rippleColor="rgba(255,255,255,0.2)">
      <div style={{ padding: 10, display: 'flex' }}><Icon name={icon} size={size} color={color} /></div>
    </Clickable>
  )
}

function TopBar({ p, fullscreen }: { p: Playing; fullscreen: boolean }) {
  const pc = usePlayer()
  const title = p.kind === 'Live' ? 'TV in diretta' : p.kind === 'Film' ? 'Film' : p.series.name
  const pip = document.pictureInPictureEnabled && !video.disablePictureInPicture
  return (
    <div className="row" style={{ position: 'absolute', left: 0, right: 0, top: 0, padding: 'calc(12px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) 12px calc(20px + env(safe-area-inset-left))' }}>
      <RoundIcon icon="arrow_back" label="Indietro" onClick={() => vm.back()} />
      <div style={{ width: 8 }} />
      <div className="grow ellipsis" style={{ color: C.Text2, fontSize: 14 }}>{title}</div>
      {pip && <RoundIcon icon="picture_in_picture_alt" label="Picture-in-picture" onClick={() => { video.requestPictureInPicture().catch(() => {}) }} />}
      {!touchDevice() && document.fullscreenEnabled && <RoundIcon icon={fullscreen ? 'fullscreen_exit' : 'fullscreen'} label="Schermo intero" onClick={toggleFullscreen} />}
      {pc.videoSize !== '' && <><div style={{ width: 4 }} /><Badge text={pc.videoSize} /><div style={{ width: 12 }} /></>}
      <span style={{ color: C.White, fontSize: 20, fontWeight: 700 }}>{clock(Date.now() / 1000)}</span>
    </div>
  )
}

function InfoBlock({ p }: { p: Playing }) {
  const pc = usePlayer()
  if (p.kind === 'Live') {
    const ch = p.channel
    const [now, next] = vm.nowNext(ch)
    return (
      <div className="row">
        <Artwork url={ch.logo} initials={ch.initials} fit="contain" radius={10} style={{ width: 96, height: 64 }} />
        <div style={{ width: 16 }} />
        <div className="col grow">
          <div className="row">
            <div style={{ width: 8, height: 8, borderRadius: 4, background: C.Live, flex: 'none' }} />
            <div style={{ width: 8 }} />
            {ch.num > 0 && <><span style={{ color: C.Text2, fontSize: 18 }}>{ch.num}</span><div style={{ width: 10 }} /></>}
            <span className="ellipsis" style={{ color: C.White, fontSize: 24, fontWeight: 700 }}>{ch.name}</span>
            {vm.favorites.has(ch.streamId) && <><div style={{ width: 8 }} /><Icon name="star" size={20} color={C.Star} /></>}
          </div>
          {now && (
            <>
              <div className="ellipsis" style={{ color: C.Text, fontSize: 15 }}>{clock(now.start)} – {clock(now.stop)}  {now.title}</div>
              <div style={{ height: 5 }} />
              <ProgressLine progress={progressAt(now, Date.now() / 1000)} style={{ width: '50%' }} />
            </>
          )}
          {next && (
            <>
              <div style={{ height: 4 }} />
              <div className="ellipsis" style={{ color: C.Text2, fontSize: 13 }}>Dopo: {clock(next.start)}  {next.title}</div>
            </>
          )}
        </div>
      </div>
    )
  }
  const title = p.kind === 'Film' ? p.movie.name : `${episodeLabel(p.episode)} · ${episodeTitle(p.episode)}`
  const dur = pc.durationMs
  return (
    <>
      <div className="ellipsis" style={{ color: C.White, fontSize: 22, fontWeight: 700 }}>{title}</div>
      <div style={{ height: 8 }} />
      <div className="row">
        <span style={{ color: C.Text, fontSize: 13 }}>{formatTime(pc.positionMs)}</span>
        <div style={{ width: 12 }} />
        <ProgressLine progress={dur > 0 ? pc.positionMs / dur : 0} height={4} style={{ flex: 1 }} />
        <div style={{ width: 12 }} />
        <span style={{ color: C.Text, fontSize: 13 }}>{dur > 0 ? formatTime(dur) : '--:--'}</span>
      </div>
    </>
  )
}

function RoundButton({ icon, label, big = false, color = C.White, onClick, play }: { icon: IconName; label: string; big?: boolean; color?: string; onClick: () => void; play?: boolean }) {
  return (
    <div data-play={play ? '1' : undefined} style={{ display: 'contents' }}>
      <Clickable radius={999} focusScale={1.12} background="rgba(255,255,255,0.2)" focusedBackground={C.Accent} onClick={onClick} label={label}
        rippleColor="rgba(255,255,255,0.2)" style={{ flex: 'none' }}>
        <div style={{ padding: big ? 16 : 12, display: 'flex' }}><Icon name={icon} size={big ? 32 : 26} color={color} /></div>
      </Clickable>
    </div>
  )
}

function Controls({ p, onChannels, onTracks, onAny }: { p: Playing; onChannels: () => void; onTracks: () => void; onAny: () => void }) {
  const pc = usePlayer()
  const paused = pc.state === 'Paused'
  const [dragging, setDragging] = useState<number | null>(null)
  const act = (f: () => void) => () => { onAny(); f() }
  const dur = pc.durationMs
  const value = dragging ?? (dur > 0 ? pc.positionMs / dur : 0)
  let buttons: ReactNode
  if (p.kind === 'Live') {
    const fav = vm.favorites.has(p.channel.streamId)
    buttons = (
      <>
        <RoundButton icon="keyboard_arrow_down" label="Canale precedente" onClick={act(() => vm.zap(-1))} />
        <RoundButton icon={paused ? 'play_arrow' : 'pause'} label="Pausa" big play onClick={act(() => pc.togglePause())} />
        <RoundButton icon="keyboard_arrow_up" label="Canale successivo" onClick={act(() => vm.zap(+1))} />
        <RoundButton icon="list" label="Canali" onClick={act(onChannels)} />
        <RoundButton icon={fav ? 'star' : 'star_border'} label="Preferito" color={fav ? C.Star : C.White} onClick={act(() => vm.toggleFavorite(p.channel))} />
      </>
    )
  } else {
    buttons = (
      <>
        {p.kind === 'Ep' && <RoundButton icon="skip_previous" label="Episodio precedente" onClick={act(() => vm.playEpisodeOffset(-1))} />}
        <RoundButton icon="replay_10" label="Indietro 10 s" onClick={act(() => pc.seekBy(-10_000))} />
        <RoundButton icon={paused ? 'play_arrow' : 'pause'} label="Pausa" big play onClick={act(() => pc.togglePause())} />
        <RoundButton icon="forward_10" label="Avanti 10 s" onClick={act(() => pc.seekBy(10_000))} />
        {p.kind === 'Ep' && <RoundButton icon="skip_next" label="Episodio successivo" onClick={act(() => vm.playEpisodeOffset(+1))} />}
      </>
    )
  }
  return (
    <div data-controls="1" onClick={(e) => e.stopPropagation()}>
      {p.kind !== 'Live' && dur > 0 && (
        <input type="range" className="slider" min={0} max={1000} value={Math.round(value * 1000)} style={{ ['--p' as string]: `${value * 100}%` }}
          onChange={(e) => { setDragging(Number(e.target.value) / 1000); onAny() }}
          onPointerUp={() => { if (dragging != null) pc.seekTo(dragging * dur); setDragging(null) }}
          onKeyUp={() => { if (dragging != null) pc.seekTo(dragging * dur); setDragging(null) }} />
      )}
      <div className="row" style={{ gap: 10 }}>
        {buttons}
        <RoundButton icon="subtitles" label="Audio e sottotitoli" onClick={act(onTracks)} />
      </div>
    </div>
  )
}

function ChannelPanel({ channel, list, close }: { channel: Channel; list: Channel[]; close: () => void }) {
  const idx = Math.max(0, list.findIndex((c) => c.streamId === channel.streamId))
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-i="${Math.max(0, idx - 3)}"]`)
    if (el && ref.current) ref.current.scrollTop = el.offsetTop - 4
    setTimeout(() => ref.current?.querySelector<HTMLElement>(`[data-i="${idx}"] [role="button"]`)?.focus({ preventScroll: true }), 50)
  }, [])
  return (
    <div className="col" onClick={(e) => e.stopPropagation()}
      style={{ width: 380, maxWidth: '100vw', height: '100%', background: 'rgba(17,19,24,0.941)', padding: 'calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left))' }}>
      <div style={{ color: C.Text, fontSize: 20, fontWeight: 700, padding: 8 }}>Canali</div>
      <div ref={ref} className="scroll col" style={{ gap: 4, padding: 4, position: 'relative' }}>
        {list.map((ch, i) => {
          const now = vm.nowNext(ch)[0]
          return (
            <div key={ch.streamId} data-i={i} style={{ flex: 'none' }}>
              <Clickable focusScale={1.02} background={i === idx ? C.AccentSoft : C.Transparent} onClick={() => { vm.playChannel(ch, list); close() }}>
                <div className="row" style={{ padding: 8 }}>
                  <Artwork url={ch.logo} initials={ch.initials} fit="contain" fontSize={12} radius={6} style={{ width: 54, height: 36 }} />
                  <div style={{ width: 10 }} />
                  <div className="col grow">
                    <div className="ellipsis" style={{ color: C.Text, fontSize: 14 }}>{(ch.num > 0 ? `${ch.num}  ` : '') + ch.name}</div>
                    {now && <div className="ellipsis" style={{ color: C.Text2, fontSize: 12 }}>{now.title}</div>}
                  </div>
                </div>
              </Clickable>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TracksPanel({ close }: { close: () => void }) {
  const pc = usePlayer()
  const audio = pc.audios
  return (
    <div onClick={(e) => { e.stopPropagation(); close() }}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 6 }}>
      <div className="scroll col" onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100% - 32px)', borderRadius: 16, background: C.Panel, padding: 16, gap: 4 }}>
        <div style={{ color: C.Text2, fontWeight: 700, padding: 6 }}>Audio</div>
        {audio.length <= 1 && <div style={{ color: C.Text3, padding: 6 }}>Una sola traccia</div>}
        {audio.length > 1 && audio.map((t, i) => (
          <TrackRow key={t.index} label={t.label} selected={t.index === pc.audioIndex} autoFocus={i === 0} onClick={() => { pc.selectAudio(t.index); close() }} />
        ))}
        <div style={{ color: C.Text2, fontWeight: 700, padding: '14px 6px 6px' }}>Sottotitoli</div>
        <TrackRow label="Disattivati" selected autoFocus={audio.length <= 1} onClick={close} />
        <div style={{ color: C.Text3, fontSize: 12, padding: 6 }}>Nella versione web i sottotitoli non sono disponibili.</div>
      </div>
    </div>
  )
}

function TrackRow({ label, selected, onClick, autoFocus }: { label: string; selected: boolean; onClick: () => void; autoFocus?: boolean }) {
  return (
    <div style={{ flex: 'none' }}>
      <Clickable focusScale={1.02} background={selected ? C.AccentSoft : C.Transparent} onClick={onClick} autoFocus={autoFocus}>
        <div style={{ padding: 12, color: selected ? C.Accent2 : C.Text, fontWeight: selected ? 600 : 400 }}>{label}</div>
      </Clickable>
    </div>
  )
}

function NextEpisodeCard({ seconds }: { seconds: number }) {
  const next = vm.nextEpisode()
  if (!next) return null
  return (
    <div className="col" onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', right: 'calc(28px + env(safe-area-inset-right))', bottom: 'calc(28px + env(safe-area-inset-bottom))', width: 360, maxWidth: 'calc(100% - 56px)', borderRadius: 16, background: 'rgba(17,19,24,0.933)', padding: 18, zIndex: 4 }}>
      <div style={{ color: C.Text2, fontSize: 13 }}>Prossimo episodio tra {seconds} s</div>
      <div className="clamp2" style={{ color: C.White, fontSize: 17, fontWeight: 600 }}>{episodeLabel(next)} · {episodeTitle(next)}</div>
      <div style={{ height: 12 }} />
      <div className="row" style={{ gap: 10 }}>
        <ActionButton text="Riproduci ora" icon="play_arrow" primary autoFocus onClick={() => vm.playEpisodeOffset(+1)} />
        <ActionButton text="Annulla" onClick={() => { vm.cancelCountdown(); vm.back() }} />
      </div>
    </div>
  )
}
