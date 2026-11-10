import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { Episode, Movie, Series } from '../../../shared/model.ts'
import { episodeDuration, episodeLabel, episodeTitle, formatTime, joinMeta } from '../../../shared/text.ts'
import { ActionButton, Artwork, Empty, Icon, IconButton, Loading, Pill, ProgressLine, Clickable, useWide } from '../components/ui.tsx'
import { app, back, inMyList, playEpisode, playMovie, progress, resumeEpisode, resumeMs, toggleMyList, useApp } from '../lib/app.ts'

// ui/DetailScreens.kt: the card of a film and of a series with its seasons and episodes.

function DetailFrame({ children }: { children: (wide: boolean) => ReactNode }) {
  const wide = useWide()
  return (
    <div className="safe" style={{ height: '100%', background: 'var(--bg)' }}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: `12px ${wide ? 40 : 16}px` }}>
        <IconButton icon="arrow_back" title="Indietro" onClick={() => back()} />
        {children(wide)}
      </div>
    </div>
  )
}

export function MovieDetail({ movie: m }: { movie: Movie }) {
  useApp()
  const resume = resumeMs(m.key)
  const info = app.vodInfo
  const body = (wide: boolean) => (
    <div>
      <div style={{ color: 'var(--text)', fontSize: wide ? 32 : 24, lineHeight: wide ? '40px' : '32px', fontWeight: 700 }}>{m.name}</div>
      <div style={{ height: 6 }} />
      <div style={{ color: 'var(--text2)' }}>
        {joinMeta(info?.year ?? m.year, info?.genre, info?.duration, m.meta.includes('·') ? m.meta.slice(m.meta.indexOf('·') + 1).trim() || null : null)}
      </div>
      <div style={{ height: 18 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <ActionButton text={resume > 0 ? `Riprendi da ${formatTime(resume)}` : 'Guarda'} icon="play_arrow" primary onClick={() => playMovie(m)} />
        {resume > 0 && <ActionButton text="Dall'inizio" icon="replay" onClick={() => playMovie(m, true)} />}
        <MyListButton item={m} />
      </div>
      <div style={{ height: 18 }} />
      {info?.plot && <div style={{ color: 'var(--text)', fontSize: 15, lineHeight: '22px', userSelect: 'text' }}>{info.plot}</div>}
      {info?.director && <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 10 }}>Regia: {info.director}</div>}
      {info?.cast && <div className="clamp3" style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Cast: {info.cast}</div>}
    </div>
  )
  return (
    <DetailFrame>
      {(wide) => wide ? (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, paddingTop: 20 }}>
          <Artwork url={m.poster} initials={m.initials} fontSize={30} style={{ width: 260, aspectRatio: '2 / 3', borderRadius: 14, alignSelf: 'flex-start' }} />
          <div className="scroll" style={{ flex: 1, marginLeft: 32 }}>{body(wide)}</div>
        </div>
      ) : (
        <div className="scroll" style={{ flex: 1 }}>
          <Artwork url={m.poster} initials={m.initials} fontSize={26} style={{ width: 180, aspectRatio: '2 / 3', borderRadius: 12, margin: '0 auto' }} />
          <div style={{ height: 16 }} />
          {body(wide)}
        </div>
      )}
    </DetailFrame>
  )
}

export function SeriesDetail({ series: s }: { series: Series }) {
  useApp()
  const info = app.seriesInfo
  const episodes = info?.episodes ?? []
  const seasons = useMemo(() => [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b), [episodes])
  const resumeEp = useMemo(() => resumeEpisode(episodes, s.seriesId), [episodes, app.positionsVersion])
  const [season, setSeason] = useState(-1)
  const current = season < 0 && resumeEp ? resumeEp.season : season
  const shown = episodes.filter((e) => e.season === current)
  const pills = useRef<HTMLDivElement>(null)
  useEffect(() => {
    pills.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [seasons.length])

  return (
    <DetailFrame>
      {(wide) => (
        <div className="scroll" style={{ flex: 1, padding: '8px 4px' }}>
          <div style={{ display: 'flex' }}>
            <Artwork url={s.cover} initials={s.initials} fontSize={24} style={{ width: wide ? 180 : 110, aspectRatio: '2 / 3', borderRadius: 12 }} />
            <div style={{ flex: 1, minWidth: 0, marginLeft: 20 }}>
              <div style={{ color: 'var(--text)', fontSize: wide ? 30 : 22, lineHeight: wide ? '38px' : '28px', fontWeight: 700 }}>{s.name}</div>
              <div style={{ height: 4 }} />
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                {joinMeta(info?.year ?? s.year, info?.genre ?? s.genre, seasons.length ? `${seasons.length} stagioni` : null)}
              </div>
              <div style={{ height: 10 }} />
              {(info?.plot ?? s.plot) && <div className={wide ? 'clamp6' : 'clamp4'} style={{ color: 'var(--text)', fontSize: 14 }}>{info?.plot ?? s.plot}</div>}
              <div style={{ height: 14 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {resumeEp && (() => {
                  const r = resumeMs(`e:${resumeEp.id}`)
                  const label = r > 0 ? `Riprendi ${episodeLabel(resumeEp)} da ${formatTime(r)}` : `Guarda ${episodeLabel(resumeEp)}`
                  return <ActionButton text={label} icon="play_arrow" primary onClick={() => playEpisode(s, resumeEp, episodes)} />
                })()}
                <MyListButton item={s} />
              </div>
            </div>
          </div>
          {!info ? (
            app.seriesInfoLoading ? <Loading text="Caricamento episodi…" style={{ padding: 30, height: 'auto' }} /> : <Empty text="Episodi non disponibili." style={{ height: 'auto' }} />
          ) : episodes.length === 0 ? (
            <Empty text="Nessun episodio." style={{ height: 'auto' }} />
          ) : (
            <>
              <div ref={pills} className="scroll" style={{ display: 'flex', gap: 8, padding: '14px 0', overflowX: 'auto', overflowY: 'hidden' }}>
                {seasons.map((n) => (
                  <div key={n} data-selected={n === current}>
                    <Pill text={`Stagione ${n}`} selected={n === current} onClick={() => setSeason(n)} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {shown.map((ep) => <EpisodeRow key={ep.id} s={s} ep={ep} all={episodes} current={ep.id === resumeEp?.id} />)}
              </div>
            </>
          )}
        </div>
      )}
    </DetailFrame>
  )
}

/** Adds or removes the title from "La mia lista"; once watched it leaves by itself. */
function MyListButton({ item }: { item: Movie | Series }) {
  const on = inMyList(item)
  return <ActionButton text={on ? 'Nella mia lista' : 'La mia lista'} icon={on ? 'check' : 'add'} onClick={() => toggleMyList(item)} />
}

function EpisodeRow({ s, ep, all, current }: { s: Series; ep: Episode; all: Episode[]; current: boolean }) {
  const p = progress(`e:${ep.id}`)
  return (
    <Clickable onClick={() => playEpisode(s, ep, all)} style={{ display: 'flex', alignItems: 'center', padding: 10 }}>
      <div style={{ position: 'relative' }}>
        <Artwork url={ep.image ?? s.cover} initials={episodeLabel(ep)} fontSize={14} style={{ width: 150, aspectRatio: '16 / 9', borderRadius: 8 }} />
        {p > 0 && p < 1 && <ProgressLine progress={p} style={{ position: 'absolute', left: 5, right: 5, bottom: 5 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ color: current ? 'var(--accent2)' : 'var(--text3)', fontSize: 12, fontWeight: 700 }}>{episodeLabel(ep)}</div>
          {episodeDuration(ep) && <div style={{ marginLeft: 8, color: 'var(--text3)', fontSize: 12 }}>{episodeDuration(ep)}</div>}
          {p >= 1 && <Icon name="check_circle" size={16} color="var(--accent)" style={{ marginLeft: 8 }} />}
        </div>
        <div className="ellipsis" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>{episodeTitle(ep)}</div>
        {ep.plot && <div className="clamp2" style={{ color: 'var(--text2)', fontSize: 12 }}>{ep.plot}</div>}
      </div>
    </Clickable>
  )
}
