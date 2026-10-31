// ui/DetailScreens.kt
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { episodeDuration, episodeKey, episodeLabel, episodeTitle, type Episode, type Movie, type Series } from '../../../shared/model.ts'
import { formatTime, joinMeta } from '../../../shared/text.ts'
import { useVm, vm } from '../lib/app.ts'
import { ActionButton, Artwork, C, Clickable, Empty, Icon, IconButton, Loading, Pill, ProgressLine } from '../components/ui.tsx'

function DetailFrame({ children }: { children: (wide: boolean) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(window.innerWidth)
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const wide = w >= 720
  return (
    <div ref={ref} className="status-pad nav-pad" style={{ height: '100%', background: C.Bg }}>
      <div className="col" style={{ height: '100%', padding: `12px ${wide ? 40 : 16}px` }}>
        <div style={{ flex: 'none' }}><IconButton icon="arrow_back" label="Indietro" onClick={() => vm.back()} /></div>
        <div className="grow" style={{ minHeight: 0 }}>{children(wide)}</div>
      </div>
    </div>
  )
}

export function MovieDetailScreen({ m }: { m: Movie }) {
  const v = useVm()
  const resume = v.resumeMs(m.key)
  const info = v.vodInfo
  const body = (wide: boolean) => (
    <div className="col">
      <div style={{ color: C.Text, fontSize: wide ? 32 : 24, lineHeight: wide ? '40px' : '32px', fontWeight: 700 }}>{m.name}</div>
      <div style={{ height: 6 }} />
      <div style={{ color: C.Text2 }}>{joinMeta(info?.year ?? m.year, info?.genre, info?.duration, m.meta.split('·').slice(1).join('·').trim() || null)}</div>
      <div style={{ height: 18 }} />
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <ActionButton text={resume > 0 ? `Riprendi da ${formatTime(resume)}` : 'Guarda'} icon="play_arrow" primary onClick={() => v.playMovie(m)} />
        {resume > 0 && <ActionButton text="Dall'inizio" icon="replay" onClick={() => v.playMovie(m, true)} />}
      </div>
      <div style={{ height: 18 }} />
      {info?.plot && <div style={{ color: C.Text, fontSize: 15, lineHeight: '22px', userSelect: 'text' }}>{info.plot}</div>}
      {info?.director && <><div style={{ height: 10 }} /><div style={{ color: C.Text2, fontSize: 13 }}>Regia: {info.director}</div></>}
      {info?.cast && <><div style={{ height: 4 }} /><div className="clamp3" style={{ color: C.Text2, fontSize: 13 }}>Cast: {info.cast}</div></>}
    </div>
  )
  return (
    <DetailFrame>
      {(wide) => wide ? (
        <div className="row" style={{ height: '100%', paddingTop: 20, alignItems: 'flex-start' }}>
          <Artwork url={m.poster} initials={m.initials} fontSize={30} radius={14} style={{ width: 260, aspectRatio: '2 / 3' }} />
          <div style={{ width: 32 }} />
          <div className="grow scroll" style={{ height: '100%' }}>{body(true)}</div>
        </div>
      ) : (
        <div className="scroll" style={{ height: '100%' }}>
          <Artwork url={m.poster} initials={m.initials} fontSize={26} radius={12} style={{ width: 180, aspectRatio: '2 / 3', margin: '0 auto' }} />
          <div style={{ height: 16 }} />
          {body(false)}
        </div>
      )}
    </DetailFrame>
  )
}

export function SeriesDetailScreen({ s }: { s: Series }) {
  const v = useVm()
  const info = v.seriesInfo
  const episodes = info?.episodes ?? []
  const seasons = useMemo(() => [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b), [episodes])
  const resumeEp = useMemo(() => v.resumeEpisode(episodes, s.seriesId), [episodes, v.positionsVersion])
  const [picked, setSeason] = useState(-1)
  const season = picked < 0 && resumeEp ? resumeEp.season : picked
  const shown = episodes.filter((e) => e.season === season)
  const seasonsRow = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // La riga delle stagioni parte da quella dell'episodio da riprendere.
    const el = seasonsRow.current?.querySelector<HTMLElement>(`[data-season="${season}"]`)
    if (el && seasonsRow.current) seasonsRow.current.scrollLeft = el.offsetLeft
  }, [seasons.length > 0])

  return (
    <DetailFrame>
      {(wide) => (
        <div className="scroll col" style={{ height: '100%', padding: '8px 4px', gap: 6 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Artwork url={s.cover} initials={s.initials} fontSize={24} radius={12} style={{ width: wide ? 180 : 110, aspectRatio: '2 / 3' }} />
            <div style={{ width: 20 }} />
            <div className="col grow">
              <div style={{ color: C.Text, fontSize: wide ? 30 : 22, lineHeight: wide ? '38px' : '28px', fontWeight: 700 }}>{s.name}</div>
              <div style={{ height: 4 }} />
              <div style={{ color: C.Text2, fontSize: 13 }}>{joinMeta(info?.year ?? s.year, info?.genre ?? s.genre, seasons.length ? `${seasons.length} stagioni` : null)}</div>
              <div style={{ height: 10 }} />
              {(info?.plot ?? s.plot) && <div className={wide ? 'clamp6' : 'clamp4'} style={{ color: C.Text, fontSize: 14 }}>{info?.plot ?? s.plot}</div>}
              <div style={{ height: 14 }} />
              {resumeEp && (() => {
                const r = v.resumeMs(episodeKey(resumeEp))
                const label = r > 0 ? `Riprendi ${episodeLabel(resumeEp)} da ${formatTime(r)}` : `Guarda ${episodeLabel(resumeEp)}`
                return <div className="row"><ActionButton text={label} icon="play_arrow" primary onClick={() => v.playEpisode(s, resumeEp, episodes)} /></div>
              })()}
            </div>
          </div>
          {info == null ? (
            v.seriesInfoLoading ? <Loading text="Caricamento episodi…" style={{ padding: 30, height: 'auto' }} /> : <Empty text="Episodi non disponibili." style={{ height: 'auto' }} />
          ) : episodes.length === 0 ? (
            <Empty text="Nessun episodio." style={{ height: 'auto' }} />
          ) : (
            <>
              <div ref={seasonsRow} className="row hscroll" style={{ gap: 8, padding: '14px 0', flex: 'none' }}>
                {seasons.map((n) => <div key={n} data-season={n}><Pill text={`Stagione ${n}`} selected={n === season} onClick={() => setSeason(n)} /></div>)}
              </div>
              {shown.map((ep) => <EpisodeRow key={ep.id} s={s} ep={ep} all={episodes} current={ep.id === resumeEp?.id} />)}
            </>
          )}
        </div>
      )}
    </DetailFrame>
  )
}

function EpisodeRow({ s, ep, all, current }: { s: Series; ep: Episode; all: Episode[]; current: boolean }) {
  const progress = vm.progress(episodeKey(ep))
  const dur = episodeDuration(ep)
  return (
    <div style={{ flex: 'none' }}>
      <Clickable focusScale={1.02} onClick={() => vm.playEpisode(s, ep, all)}>
        <div className="row" style={{ padding: 10 }}>
          <div style={{ position: 'relative', flex: 'none' }}>
            <Artwork url={ep.image ?? s.cover} initials={episodeLabel(ep)} fontSize={14} radius={8} style={{ width: 150, aspectRatio: '16 / 9' }} />
            {progress > 0 && progress < 1 && <div style={{ position: 'absolute', left: 5, right: 5, bottom: 5 }}><ProgressLine progress={progress} /></div>}
          </div>
          <div style={{ width: 14 }} />
          <div className="col grow">
            <div className="row">
              <span style={{ color: current ? C.Accent2 : C.Text3, fontSize: 12, fontWeight: 700 }}>{episodeLabel(ep)}</span>
              {dur && <><div style={{ width: 8 }} /><span style={{ color: C.Text3, fontSize: 12 }}>{dur}</span></>}
              {progress >= 1 && <><div style={{ width: 8 }} /><Icon name="check_circle" size={16} color={C.Accent} /></>}
            </div>
            <div className="ellipsis" style={{ color: C.Text, fontWeight: 600, fontSize: 15 }}>{episodeTitle(ep)}</div>
            {ep.plot && <div className="clamp2" style={{ color: C.Text2, fontSize: 12 }}>{ep.plot}</div>}
          </div>
        </div>
      </Clickable>
    </div>
  )
}
