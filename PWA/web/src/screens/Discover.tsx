import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { groupVariants } from '../../../shared/text.ts'
import { AlertDialog, Artwork, Clickable, Dialog, Empty, Icon, type IconName, Loading, Pill, ProgressLine, useWide } from '../components/ui.tsx'
import { VirtualGrid } from '../components/virtual.tsx'
import {
  app, closeCategory, entryProgress, inMyList, lastEpisode, moviesFor, openCategory, openMovieEntry, openSeriesEntry, playMovie,
  removeMovieFromContinue, removeSeriesFromContinue, seriesFor, toggleMyList, useApp,
} from '../lib/app.ts'
import { ALL_ID, CONTINUE_ID, MYLIST_ID } from '../lib/library.ts'
import { type Kind, type Title, type Tmdb, type TmdbRow, checkKey, findInCatalog, img, indexCatalog, loadRows, tmdbKey, useLookup } from '../lib/tmdb.ts'
import { Poster } from './Browse.tsx'

// "Film e serie" with a TMDB key: one screen for films and series, like the streaming apps.
// A rotating hero, then rows: continue watching, my list, trends, genres, and the provider's categories.

type Filter = 'all' | Kind

/** What the screen had when a category or a title was opened, to come back to the same place. */
const saved = { filter: 'all' as Filter, scroll: 0 }

const keyOf = (t: Title) => t.entry.item.key
const nameOf = (t: Title) => t.entry.item.name

function openTitle(t: Title) {
  if (t.kind === 'movie') openMovieEntry(t.entry)
  else openSeriesEntry(t.entry)
}

/** Films start at once (from where they were left), series open their episodes. */
function playTitle(t: Title) {
  if (t.kind === 'movie' && t.entry.variants.length === 1) playMovie(t.entry.item)
  else openTitle(t)
}

export function DiscoverSection() {
  useApp()
  const open = app.open.Discover
  return open ? <CategoryGrid id={open} /> : <DiscoverHome />
}

function DiscoverHome() {
  const wide = useWide()
  const [filter, setFilterState] = useState<Filter>(saved.filter)
  const setFilter = (f: Filter) => { saved.filter = f; setFilterState(f) }
  const [rows, setRows] = useState<TmdbRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState(false)
  const [remove, setRemove] = useState<{ t: Title; from: 'continue' | 'list' } | null>(null)
  const k = tmdbKey()

  useEffect(() => {
    let alive = true
    setError(null)
    checkKey(k).catch((e: Error) => { if (alive) setError(e.message) })
    loadRows().then((r) => { if (alive) setRows(r) })
    return () => { alive = false }
  }, [k])

  const movies = app.movies
  const series = app.series
  const index = useMemo(() => (movies && series ? indexCatalog(movies.items, series.items) : null), [movies, series])

  // The TMDB lists turned into titles of the catalog, each title once per row.
  const matched = useMemo(() => {
    if (!index || !rows) return null
    return rows.map((r) => {
      const seen = new Set<string>()
      const titles = r.items.flatMap((t) => {
        const hit = findInCatalog(t, index)
        if (!hit || seen.has(keyOf(hit))) return []
        seen.add(keyOf(hit))
        return [hit]
      })
      return { ...r, titles }
    })
  }, [index, rows])

  /** TMDB cards already found by the rows, for the other rows. */
  const known = useMemo(() => {
    const m = new Map<string, Tmdb>()
    for (const r of matched ?? []) for (const t of r.titles) if (t.tmdb) m.set(keyOf(t), t.tmdb)
    return m
  }, [matched])

  const pass = (t: Title) => filter === 'all' || t.kind === filter

  const continueRow = useMemo<Title[]>(() => {
    if (!movies || !series) return []
    const ms = moviesFor(CONTINUE_ID).map((e) => ({ t: { kind: 'movie', entry: e, tmdb: null } as Title, u: Math.max(...e.variants.map((m) => app.pos.positions[m.key]?.u ?? 0)) }))
    const ss = seriesFor(CONTINUE_ID).map((e) => ({ t: { kind: 'tv', entry: e, tmdb: null } as Title, u: lastEpisode(e.item.seriesId)?.u ?? 0 }))
    return [...ms, ...ss].sort((a, b) => b.u - a.u).map((x) => x.t)
  }, [movies, series, app.positionsVersion])

  const listRow = useMemo<Title[]>(() => {
    if (!movies || !series) return []
    const ms = moviesFor(MYLIST_ID).map((e): Title => ({ kind: 'movie', entry: e, tmdb: null }))
    const ss = seriesFor(MYLIST_ID).map((e): Title => ({ kind: 'tv', entry: e, tmdb: null }))
    return [...ms, ...ss].sort((a, b) => (app.myList[keyOf(b)] ?? 0) - (app.myList[keyOf(a)] ?? 0))
  }, [movies, series, app.positionsVersion])

  const recent = useMemo<Title[]>(() => movies
    ? groupVariants([...movies.items].sort((a, b) => b.added - a.added).slice(0, 80), (m) => m.name).slice(0, 30).map((e) => ({ kind: 'movie', entry: e, tmdb: null }))
    : [], [movies])

  const hero = useMemo(() => (matched?.find((r) => r.id === 'trend')?.titles ?? []).filter((t) => pass(t) && t.tmdb?.backdrop).slice(0, 6), [matched, filter])

  const scroller = useRef<HTMLDivElement>(null)
  const ready = movies != null && series != null && matched != null
  useEffect(() => { if (ready && scroller.current) scroller.current.scrollTop = saved.scroll }, [ready])

  if (!movies || !series) return <Loading text="Caricamento film e serie…" />

  const providerRows = [
    ...(filter !== 'tv' ? movies.categories.map((c) => ({ kind: 'movie' as Kind, id: c.id, name: c.name })) : []),
    ...(filter !== 'movie' ? series.categories.map((c) => ({ kind: 'tv' as Kind, id: c.id, name: c.name })) : []),
  ]
  const tmdbRows = (matched ?? []).map((r) => ({ ...r, titles: r.titles.filter(pass) })).filter((r) => r.titles.length >= (r.top ? 5 : 4))

  return (
    <div ref={scroller} className="scroll" style={{ flex: 1, paddingBottom: 30 }} onScroll={(e) => { saved.scroll = e.currentTarget.scrollTop }}>
      <div className="hscroll" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 2px 14px', overflowX: 'auto', flexShrink: 0 }}>
        <Pill text="Tutto" selected={filter === 'all'} onClick={() => setFilter('all')} />
        <Pill text="Film" selected={filter === 'movie'} onClick={() => setFilter('movie')} />
        <Pill text="Serie TV" selected={filter === 'tv'} onClick={() => setFilter('tv')} />
        <Pill text="Categorie" icon="keyboard_arrow_down" selected={false} onClick={() => setCategories(true)} />
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 14, padding: '0 2px 12px' }}>{error} Controlla la chiave in Impostazioni → TMDB.</div>}
      {matched == null && !error && <div style={{ height: wide ? 'clamp(340px, 42vw, 560px)' : 460, borderRadius: 16, background: 'var(--surface)' }} />}
      {hero.length > 0 && <Hero items={hero} wide={wide} />}

      {continueRow.filter(pass).length > 0 && (
        <Row title="Continua a guardare">
          {continueRow.filter(pass).map((t) => <WideTile key={keyOf(t)} t={t} known={known.get(keyOf(t))} onLong={() => setRemove({ t, from: 'continue' })} />)}
        </Row>
      )}
      {listRow.filter(pass).length > 0 && (
        <Row title="La mia lista">
          {listRow.filter(pass).map((t) => <PosterTile key={keyOf(t)} t={t} known={known.get(keyOf(t))} lookup onLong={() => setRemove({ t, from: 'list' })} />)}
        </Row>
      )}
      {tmdbRows.map((r, i) => (
        <div key={r.id}>
          <Row title={r.top ? `${r.title} in Italia` : r.title}>
            {r.top
              ? r.titles.slice(0, 10).map((t, n) => <TopTile key={keyOf(t)} t={t} n={n + 1} />)
              : r.titles.slice(0, 40).map((t) => <PosterTile key={keyOf(t)} t={t} known={t.tmdb} />)}
          </Row>
          {i === 1 && filter !== 'tv' && recent.length > 0 && (
            <Row title="Aggiunti di recente" onAll={() => openCategory('Discover', `m:${ALL_ID}`)}>
              {recent.map((t) => <PosterTile key={keyOf(t)} t={t} known={known.get(keyOf(t))} lookup />)}
            </Row>
          )}
        </div>
      ))}
      {matched != null && tmdbRows.length === 0 && !error && (
        <div style={{ color: 'var(--text2)', fontSize: 14, padding: '20px 2px 0' }}>Nessun titolo di TMDB trovato nel catalogo: sotto ci sono le categorie della lista.</div>
      )}

      <div style={{ color: 'var(--text)', fontSize: wide ? 24 : 20, fontWeight: 800, padding: `${wide ? 44 : 32}px 2px 0` }}>Le categorie della lista</div>
      {providerRows.map((c) => <CategoryRow key={c.kind + c.id} kind={c.kind} catId={c.id} name={c.name} />)}

      <CategoriesDialog open={categories} filter={filter} onDismiss={() => setCategories(false)} />
      <AlertDialog open={remove != null} title={remove?.from === 'list' ? 'Rimuovere dalla mia lista?' : 'Rimuovere da Continua a guardare?'}
        text={remove ? nameOf(remove.t) : undefined} confirm="Rimuovi" confirmColor="var(--danger)" onDismiss={() => setRemove(null)}
        onConfirm={() => {
          const r = remove
          setRemove(null)
          if (!r) return
          if (r.from === 'list') toggleMyList(r.t.entry.item)
          else if (r.t.kind === 'movie') removeMovieFromContinue(r.t.entry)
          else removeSeriesFromContinue(r.t.entry)
        }} />
    </div>
  )
}

// --- hero ----------------------------------------------------------------------------------------------

function Hero({ items, wide }: { items: Title[]; wide: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (items.length < 2) return
    const timer = setInterval(() => setI((x) => (x + 1) % items.length), 9000)
    return () => clearInterval(timer)
  }, [items.length, i])
  const t = items[i % items.length]
  const tm = t.tmdb!
  const meta = [t.kind === 'movie' ? 'Film' : 'Serie TV', tm.year, tm.vote ? `★ ${tm.vote.toFixed(1)}` : null].filter(Boolean).join('  ·  ')
  const picture = wide ? img(tm.backdrop, 'w1280') : img(tm.poster, 'w780') ?? img(tm.backdrop, 'w780')
  const listed = inMyList(t.entry.item)
  return (
    <div style={{ position: 'relative', borderRadius: wide ? 18 : 16, overflow: 'hidden', height: wide ? 'clamp(340px, 42vw, 560px)' : 'min(132vw, 560px)', background: '#000' }}>
      <AnimatePresence initial={false}>
        <motion.img key={tm.id} src={picture ?? undefined} alt="" draggable={false}
          initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: wide ? 'center 25%' : 'center top' }} />
      </AnimatePresence>
      <div style={{
        position: 'absolute', inset: 0,
        background: wide
          ? 'linear-gradient(90deg, rgba(0,0,0,.88) 0%, rgba(0,0,0,.55) 35%, rgba(0,0,0,0) 68%), linear-gradient(0deg, rgba(0,0,0,.75) 0%, rgba(0,0,0,0) 40%)'
          : 'linear-gradient(0deg, rgba(0,0,0,.95) 0%, rgba(0,0,0,.55) 38%, rgba(0,0,0,0) 62%)',
      }} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tm.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35 }}
          style={{
            position: 'absolute', left: wide ? 44 : 18, right: wide ? '42%' : 18, bottom: wide ? 46 : 22,
            display: 'flex', flexDirection: 'column', alignItems: wide ? 'flex-start' : 'center', textAlign: wide ? 'left' : 'center', color: '#fff',
          }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: 'var(--accent2)', textTransform: 'uppercase' }}>N. {i + 1} di tendenza</div>
          <div className="clamp2" style={{ fontSize: wide ? 46 : 32, lineHeight: wide ? '52px' : '38px', fontWeight: 800, letterSpacing: -0.5, margin: '6px 0 8px', textShadow: '0 2px 16px rgba(0,0,0,.5)' }}>{tm.title || nameOf(t)}</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.8)', fontWeight: 500 }}>{meta}</div>
          {wide && tm.overview && <div className="clamp3" style={{ fontSize: 15, lineHeight: '22px', color: 'rgba(255,255,255,.88)', marginTop: 12, maxWidth: 560 }}>{tm.overview}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: wide ? 20 : 16, justifyContent: wide ? 'flex-start' : 'center' }}>
            <HeroButton text={t.kind === 'movie' ? 'Riproduci' : 'Episodi'} icon="play_arrow" primary onClick={() => playTitle(t)} />
            <HeroButton text="Altre info" icon="info_outline" onClick={() => openTitle(t)} />
            <HeroButton icon={listed ? 'check' : 'add'} title={listed ? 'Nella mia lista' : 'La mia lista'} onClick={() => toggleMyList(t.entry.item)} />
          </div>
        </motion.div>
      </AnimatePresence>
      {items.length > 1 && (
        <div style={{ position: 'absolute', right: wide ? 28 : 0, left: wide ? undefined : 0, bottom: wide ? 24 : 8, display: 'flex', gap: 6, justifyContent: 'center' }}>
          {items.map((x, n) => (
            <div key={keyOf(x)} onClick={() => setI(n)}
              style={{ width: n === i ? 22 : 7, height: 7, borderRadius: 4, cursor: 'pointer', background: n === i ? '#fff' : 'rgba(255,255,255,.4)', transition: 'width 300ms, background 300ms' }} />
          ))}
        </div>
      )}
    </div>
  )
}

function HeroButton({ text, icon, primary, title, onClick }: { text?: string; icon: IconName; primary?: boolean; title?: string; onClick: () => void }) {
  return (
    <Clickable onClick={onClick} title={title ?? text} radius={text ? 8 : '50%'}
      background={primary ? '#fff' : 'rgba(110,110,115,.55)'}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: text ? '9px 20px 9px 14px' : 9, backdropFilter: 'blur(8px)', border: text ? undefined : '1.5px solid rgba(255,255,255,.6)' }}>
      <Icon name={icon} size={24} color={primary ? '#000' : '#fff'} />
      {text && <div style={{ color: primary ? '#000' : '#fff', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>{text}</div>}
    </Clickable>
  )
}

// --- rows ------------------------------------------------------------------------------------------------

function Row({ title, onAll, children }: { title: string; onAll?: () => void; children: ReactNode }) {
  const wide = useWide()
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className="drow" style={{ marginTop: wide ? 26 : 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '0 2px 2px' }}>
        <div className="ellipsis" style={{ color: 'var(--text)', fontSize: wide ? 20 : 17, fontWeight: 700 }}>{title}</div>
        {onAll && (
          <div role="button" tabIndex={0} onClick={onAll} onKeyDown={(e) => { if (e.key === 'Enter') onAll() }}
            className="drow-all" style={{ color: 'var(--accent2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Vedi tutto ›</div>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <div ref={ref} className="hscroll" style={{ display: 'flex', gap: wide ? 10 : 8, overflowX: 'auto', overflowY: 'hidden', padding: '10px 2px 12px' }}>{children}</div>
        {wide && (['left', 'right'] as const).map((side) => (
          <div key={side} className="drow-arrow" role="button" onClick={() => scroll(side === 'left' ? -1 : 1)}
            style={{
              position: 'absolute', top: 10, bottom: 12, [side]: 0, width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 3,
              background: `linear-gradient(${side === 'left' ? 90 : 270}deg, rgba(0,0,0,.75), rgba(0,0,0,0))`,
            }}>
            <Icon name={side === 'left' ? 'chevron_left' : 'chevron_right'} size={36} color="#fff" />
          </div>
        ))}
      </div>
    </section>
  )
}

const posterOf = (t: Title) => (t.kind === 'movie' ? t.entry.item.poster : t.entry.item.cover)
const yearOf = (t: Title) => t.entry.item.year
const progressOf = (t: Title) => (t.kind === 'movie' ? entryProgress(t.entry) : 0)

function PosterTile({ t, known, lookup = false, caption = false, onLong }: { t: Title; known?: Tmdb | null; lookup?: boolean; caption?: boolean; onLong?: () => void }) {
  const wide = useWide()
  const tm = useLookup(t.kind, nameOf(t), yearOf(t), known, lookup)
  const p = progressOf(t)
  return (
    <Clickable onClick={() => openTitle(t)} onLongClick={onLong} title={nameOf(t)} background="transparent" radius={8} className="dtile" style={{ flexShrink: 0, width: wide ? 154 : 112 }}>
      <div style={{ position: 'relative' }}>
        <Artwork url={img(tm?.poster) ?? posterOf(t)} initials={t.entry.item.initials} fontSize={20} style={{ width: '100%', aspectRatio: '2 / 3', borderRadius: 8 }} />
        {p > 0 && p < 1 && <ProgressLine progress={p} style={{ position: 'absolute', left: 6, right: 6, bottom: 6 }} />}
        {t.kind === 'tv' && !caption && <KindBadge />}
      </div>
      {caption && <div className="clamp2" style={{ marginTop: 6, color: 'var(--text2)', fontSize: 12, lineHeight: '16px' }}>{nameOf(t)}</div>}
    </Clickable>
  )
}

function KindBadge() {
  return (
    <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,.7)', color: '#fff', fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: '2px 5px', borderRadius: 4 }}>SERIE</div>
  )
}

function TopTile({ t, n }: { t: Title; n: number }) {
  const wide = useWide()
  const h = wide ? 210 : 150
  return (
    <Clickable onClick={() => openTitle(t)} title={nameOf(t)} background="transparent" radius={8} className="dtile"
      style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', height: h, paddingRight: 4 }}>
      <div style={{
        fontSize: h * 0.95, lineHeight: `${h * 0.8}px`, fontWeight: 900, letterSpacing: n === 10 ? -h * 0.12 : 0, color: 'var(--bg)',
        WebkitTextStroke: '3px var(--text3)', marginRight: -h * 0.12, fontFamily: 'system-ui, sans-serif', userSelect: 'none',
      }}>{n}</div>
      <Artwork url={img(t.tmdb?.poster) ?? posterOf(t)} initials={t.entry.item.initials} fontSize={18}
        style={{ height: h, aspectRatio: '2 / 3', borderRadius: 8, position: 'relative', boxShadow: '-6px 0 14px rgba(0,0,0,.45)' }} />
    </Clickable>
  )
}

/** Continue watching: the picture of the scene with the progress, like the players do. */
function WideTile({ t, known, onLong }: { t: Title; known?: Tmdb; onLong: () => void }) {
  const wide = useWide()
  const tm = useLookup(t.kind, nameOf(t), yearOf(t), known)
  const p = progressOf(t)
  const le = t.kind === 'tv' ? lastEpisode(t.entry.item.seriesId) : null
  return (
    <Clickable onClick={() => playTitle(t)} onLongClick={onLong} title={nameOf(t)} background="transparent" radius={8} className="dtile" style={{ flexShrink: 0, width: wide ? 290 : 220 }}>
      <div style={{ position: 'relative' }}>
        <Artwork url={img(tm?.backdrop, 'w780') ?? posterOf(t)} initials={t.entry.item.initials} fontSize={20} style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 8 }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: 8, background: 'linear-gradient(0deg, rgba(0,0,0,.7), rgba(0,0,0,0) 55%)' }} />
        <div style={{ position: 'absolute', left: 10, bottom: 12, width: 34, height: 34, borderRadius: '50%', border: '2px solid #fff', background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="play_arrow" size={22} color="#fff" />
        </div>
        {p > 0 && p < 1 && <ProgressLine progress={p} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: 0 }} height={4} />}
      </div>
      <div className="ellipsis" style={{ marginTop: 6, color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>{tm?.title || nameOf(t)}</div>
      <div className="ellipsis" style={{ color: 'var(--text3)', fontSize: 12 }}>{t.kind === 'movie' ? 'Film' : le ? 'Serie TV · riprendi l\'episodio' : 'Serie TV'}</div>
    </Clickable>
  )
}

/** A category of the provider: drawn only when it gets near the screen. */
function CategoryRow({ kind, catId, name }: { kind: Kind; catId: string; name: string }) {
  const wide = useWide()
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); o.disconnect() } }, { rootMargin: '600px 0px' })
    o.observe(el)
    return () => o.disconnect()
  }, [seen])
  const titles = useMemo<Title[]>(() => !seen ? []
    : kind === 'movie' ? moviesFor(catId).slice(0, 30).map((e) => ({ kind: 'movie', entry: e, tmdb: null }))
      : seriesFor(catId).slice(0, 30).map((e) => ({ kind: 'tv', entry: e, tmdb: null })), [seen, app.movies, app.series, app.positionsVersion])
  return (
    <div ref={ref} style={{ minHeight: seen ? undefined : wide ? 300 : 230 }}>
      {titles.length > 0 && (
        <Row title={`${name}${kind === 'tv' ? ' · Serie' : ''}`} onAll={() => openCategory('Discover', `${kind === 'movie' ? 'm' : 's'}:${catId}`)}>
          {titles.map((t) => <PosterTile key={keyOf(t)} t={t} caption />)}
        </Row>
      )}
    </div>
  )
}

// --- every title of a category -------------------------------------------------------------------------------

function CategoryGrid({ id }: { id: string }) {
  const wide = useWide()
  const kind: Kind = id.startsWith('m:') ? 'movie' : 'tv'
  const catId = id.slice(2)
  const lib = kind === 'movie' ? app.movies : app.series
  const name = catId === ALL_ID ? (kind === 'movie' ? 'Tutti i film' : 'Tutte le serie') : lib?.categories.find((c) => c.id === catId)?.name ?? ''
  const list = useMemo<Title[]>(() => kind === 'movie'
    ? moviesFor(catId).map((e) => ({ kind: 'movie', entry: e, tmdb: null }))
    : seriesFor(catId).map((e) => ({ kind: 'tv', entry: e, tmdb: null })), [lib, catId, app.positionsVersion, app.settings.sorts])
  if (!lib) return <Loading text="Caricamento…" />
  const n = list.length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 8 }}>
        <Clickable onClick={() => closeCategory('Discover')} title="Indietro" radius="50%" background="transparent" style={{ padding: 10 }}>
          <Icon name="arrow_back" color="var(--text)" />
        </Clickable>
        <div style={{ flex: 1, minWidth: 0, marginLeft: 6 }}>
          <div className="ellipsis" style={{ color: 'var(--text)', fontSize: wide ? 24 : 20, fontWeight: 700 }}>{name}</div>
          <div style={{ color: 'var(--text2)', fontSize: 12 }}>{kind === 'movie' ? (n === 1 ? '1 film' : `${n} film`) : n === 1 ? '1 serie' : `${n} serie`}</div>
        </div>
      </div>
      {n === 0 ? <Empty text="Nessun contenuto." /> : (
        <VirtualGrid key={id} count={n} minCell={wide ? 150 : 110} gap={12} rowGap={14} padding={[12, 12]}
          rowHeight={(w) => 4 + (w - 8) * 1.5 + 6 + 48 + 24 + 2 + 4}
          keyOf={(i) => keyOf(list[i])}
          render={(i) => {
            const t = list[i]
            const it = t.entry.item
            return <Poster title={it.name} meta={it.meta} url={posterOf(t)} initials={it.initials} progress={progressOf(t)}
              badge={t.entry.variants.length > 1 ? `${t.entry.variants.length} versioni` : null} onClick={() => openTitle(t)} />
          }} />
      )}
    </div>
  )
}

function CategoriesDialog({ open, filter, onDismiss }: { open: boolean; filter: Filter; onDismiss: () => void }) {
  const groups: { kind: Kind; title: string; all: string; cats: { id: string; name: string }[] }[] = [
    ...(filter !== 'tv' ? [{ kind: 'movie' as Kind, title: 'Film', all: 'Tutti i film', cats: app.movies?.categories ?? [] }] : []),
    ...(filter !== 'movie' ? [{ kind: 'tv' as Kind, title: 'Serie TV', all: 'Tutte le serie', cats: app.series?.categories ?? [] }] : []),
  ]
  const go = (kind: Kind, id: string) => { onDismiss(); openCategory('Discover', `${kind === 'movie' ? 'm' : 's'}:${id}`) }
  return (
    <Dialog open={open} onDismiss={onDismiss} width={520}>
      <div className="scroll" style={{ maxHeight: '70vh', padding: '8px 0' }}>
        {groups.map((g) => (
          <div key={g.kind}>
            <div style={{ color: 'var(--text3)', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', padding: '12px 20px 6px' }}>{g.title}</div>
            {[{ id: ALL_ID, name: g.all }, ...g.cats].map((c) => (
              <Clickable key={c.id} onClick={() => go(g.kind, c.id)} background="transparent" radius={0} style={{ padding: '11px 20px' }}>
                <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 15, fontWeight: c.id === ALL_ID ? 700 : 400 }}>{c.name}</div>
              </Clickable>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  )
}
