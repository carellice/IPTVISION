import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { groupVariants } from '../../../shared/text.ts'
import { AlertDialog, Artwork, Clickable, Dialog, Empty, Icon, Loading, Pill, ProgressLine, useWide } from '../components/ui.tsx'
import { VirtualGrid } from '../components/virtual.tsx'
import {
  app, closeCategory, entryProgress, flush, pull, refreshAll, lastEpisode, moviesFor, openCategory, openMovieEntry, openSeriesEntry, playMovie,
  removeMovieFromContinue, removeSeriesFromContinue, seriesFor, toggleMyList, useApp,
} from '../lib/app.ts'
import { ALL_ID, CONTINUE_ID, MYLIST_ID } from '../lib/library.ts'
import { type Kind, type Title, type Tmdb, type TmdbRow, checkKey, findInCatalog, img, indexCatalog, loadRows, tmdbKey, useLookup } from '../lib/tmdb.ts'
import { Poster, SortButton } from './Browse.tsx'

// "Film e serie" with a TMDB key: one screen for films and series, like the streaming apps.
// Rows: continue watching, my list, trends, genres, and the provider's categories.

type Filter = 'all' | Kind

/** What the screen had when a category or a title was opened, to come back to the same place. */
// catSeries: with "Tutto", which provider categories are shown at the bottom (never movies and series together).
const saved = { filter: 'all' as Filter, catSeries: false, scroll: 0, rows: new Map<string, number>() }

let lastRows: { key: string; rows: TmdbRow[] | null } = { key: '', rows: null }

/** Opened from the menu, the page starts again from the top. */
export function resetDiscoverScroll() { saved.scroll = 0; saved.rows.clear() }

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
  // The rows already loaded with this key: coming back to the page they are there at once.
  const [rows, setRows] = useState<TmdbRow[] | null>(lastRows.key === tmdbKey() ? lastRows.rows : null)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState(false)
  const [remove, setRemove] = useState<{ t: Title; from: 'continue' | 'list' } | null>(null)
  const k = tmdbKey()

  useEffect(() => {
    let alive = true
    setError(null)
    checkKey(k).catch((e: Error) => { if (alive) setError(e.message) })
    loadRows().then((r) => { lastRows = { key: k, rows: r }; if (alive) setRows(r) })
    return () => { alive = false }
  }, [k])

  // Shown as soon as one of the two catalogs is there: the other one (and TMDB) come later, without blocking the page.
  const movies = app.movies
  const series = app.series
  const index = useMemo(() => (movies || series ? indexCatalog(movies?.items ?? [], series?.items ?? []) : null), [movies, series])

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
    if (!movies && !series) return []
    const ms = moviesFor(CONTINUE_ID).map((e) => ({ t: { kind: 'movie', entry: e, tmdb: null } as Title, u: Math.max(...e.variants.map((m) => app.pos.positions[m.key]?.u ?? 0)) }))
    const ss = seriesFor(CONTINUE_ID).map((e) => ({ t: { kind: 'tv', entry: e, tmdb: null } as Title, u: lastEpisode(e.item.seriesId)?.u ?? 0 }))
    return [...ms, ...ss].sort((a, b) => b.u - a.u).map((x) => x.t)
  }, [movies, series, app.positionsVersion])

  const listRow = useMemo<Title[]>(() => {
    if (!movies && !series) return []
    const ms = moviesFor(MYLIST_ID).map((e): Title => ({ kind: 'movie', entry: e, tmdb: null }))
    const ss = seriesFor(MYLIST_ID).map((e): Title => ({ kind: 'tv', entry: e, tmdb: null }))
    return [...ms, ...ss].sort((a, b) => (app.myList[keyOf(b)] ?? 0) - (app.myList[keyOf(a)] ?? 0))
  }, [movies, series, app.positionsVersion])

  const recent = useMemo<Title[]>(() => movies
    ? groupVariants([...movies.items].sort((a, b) => b.added - a.added).slice(0, 80), (m) => m.name).slice(0, 30).map((e) => ({ kind: 'movie', entry: e, tmdb: null }))
    : [], [movies])

  const scroller = useRef<HTMLDivElement>(null)
  // Back to where it was, once the page is as long as before (catalog and TMDB rows there).
  const restored = useRef(false)
  const ready = (movies != null || series != null) && (matched != null || error != null)
  useEffect(() => {
    if (restored.current || !ready || !scroller.current) return
    scroller.current.scrollTop = saved.scroll
    restored.current = true
  }, [ready])

  if (!movies && !series) return <><DiscoverSkeleton wide={wide} /><LoadingBadge /></>
  // TMDB lists still on their way: pulsing tiles in their place, the rest of the page is already usable.
  const tmdbPending = matched == null && !error

  // The provider's categories: a grid of tiles (name and how many titles), empty ones left out.
  const movieCats = (filter !== 'tv' && movies ? movies.categories.map((c) => ({ kind: 'movie' as Kind, id: c.id, name: c.name, count: movies.byCategory.get(c.id)?.length ?? 0 })) : []).filter((c) => c.count > 0)
  const seriesCats = (filter !== 'movie' && series ? series.categories.map((c) => ({ kind: 'tv' as Kind, id: c.id, name: c.name, count: series.byCategory.get(c.id)?.length ?? 0 })) : []).filter((c) => c.count > 0)
  // With "Tutto" a Film / Serie TV switch: one kind of category at a time.
  const catSwitch = movieCats.length > 0 && seriesCats.length > 0
  const [catSeries, setCatSeriesState] = useState(saved.catSeries)
  const setCatSeries = (v: boolean) => { saved.catSeries = v; setCatSeriesState(v) }
  const providerCats = (catSwitch ? catSeries : movieCats.length === 0) ? seriesCats : movieCats
  const tmdbRows = (matched ?? []).map((r) => ({ ...r, titles: r.titles.filter(pass) })).filter((r) => r.titles.length >= (r.top ? 5 : 4))

  return (
    <div ref={scroller} className="scroll" style={{ flex: 1, paddingBottom: 30, position: 'relative' }} onScroll={(e) => { saved.scroll = e.currentTarget.scrollTop }}>
      <LoadingBadge extra={tmdbPending ? 'Preparo le tendenze…' : null} />
      <div className="hscroll" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 2px 14px', overflowX: 'auto', flexShrink: 0 }}>
        <Pill text="Tutto" selected={filter === 'all'} onClick={() => setFilter('all')} />
        <Pill text="Film" selected={filter === 'movie'} onClick={() => setFilter('movie')} />
        <Pill text="Serie TV" selected={filter === 'tv'} onClick={() => setFilter('tv')} />
        <Pill text="Categorie" icon="keyboard_arrow_down" selected={false} onClick={() => setCategories(true)} />
        <div style={{ flex: 1 }} />
        {/* In alto a destra: cataloghi e posizioni di nuovo dal server, così "Continua a guardare" si aggiorna. */}
        <Pill text="Ricarica" icon="refresh" selected={false} onClick={() => { refreshAll(); void flush().then(pull) }} />
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 14, padding: '0 2px 12px' }}>{error} Controlla la chiave in Impostazioni → TMDB.</div>}
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
      {tmdbPending && [0, 1, 2].map((n) => <RowSkeleton key={n} wide={wide} />)}
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
      {catSwitch && (
        <div style={{ display: 'flex', gap: 8, padding: `${wide ? 14 : 10}px 2px 0` }}>
          <Pill text="Film" selected={!catSeries} onClick={() => setCatSeries(false)} />
          <Pill text="Serie TV" selected={catSeries} onClick={() => setCatSeries(true)} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${wide ? 200 : 150}px, 1fr))`, gap: wide ? 14 : 10, padding: '14px 2px 0' }}>
        {providerCats.map((c) => (
          <Clickable key={c.kind + c.id} onClick={() => openCategory('Discover', `${c.kind === 'movie' ? 'm' : 's'}:${c.id}`)}
            style={{ height: 96, padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Icon name={c.kind === 'movie' ? 'movie' : 'tv'} size={20} color="var(--text2)" />
              <div style={{ flex: 1 }} />
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>{c.count}</div>
            </div>
            <div className="clamp2" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15, lineHeight: '20px' }}>{c.name}</div>
          </Clickable>
        ))}
      </div>

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

// --- rows ------------------------------------------------------------------------------------------------

function Row({ title, onAll, captions = false, children }: { title: string; onAll?: () => void; captions?: boolean; children: ReactNode }) {
  const wide = useWide()
  const ref = useRef<HTMLDivElement>(null)
  // Coming back from "Guarda tutto" the row is scrolled as it was left.
  useEffect(() => { const x = saved.rows.get(title); if (x && ref.current) ref.current.scrollTo({ left: x, behavior: 'instant' }) }, [title])
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section className="drow" style={{ marginTop: wide ? 26 : 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, padding: '0 2px 2px' }}>
        <div className="ellipsis" style={{ color: 'var(--text)', fontSize: wide ? 20 : 17, fontWeight: 700 }}>{title}</div>
      </div>
      <div style={{ position: 'relative' }}>
        <div ref={ref} className="hscroll" style={{ display: 'flex', gap: wide ? 10 : 8, overflowX: 'auto', overflowY: 'hidden', padding: '10px 2px 12px' }}
          onScroll={(e) => { saved.rows.set(title, e.currentTarget.scrollLeft) }}>
          {children}
          {onAll && <SeeAllTile captions={captions} onClick={onAll} />}
        </div>
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

/** At the end of the row, as big as a poster: opens every title of the category. */
function SeeAllTile({ captions, onClick }: { captions: boolean; onClick: () => void }) {
  const wide = useWide()
  return (
    <Clickable onClick={onClick} title="Guarda tutto" background="transparent" radius={8} className="dtile" style={{ flexShrink: 0, width: wide ? 154 : 112 }}>
      <div style={{ width: '100%', aspectRatio: '2 / 3', borderRadius: 8, background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <div style={{ width: wide ? 46 : 38, height: wide ? 46 : 38, borderRadius: '50%', border: '2px solid var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow_forward" size={wide ? 24 : 20} color="var(--text)" />
        </div>
        <div style={{ color: 'var(--text)', fontSize: wide ? 15 : 13, fontWeight: 700 }}>Guarda tutto</div>
      </div>
      {captions && <div style={{ height: 38 }} />}
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
        <SortButton section={kind === 'movie' ? 'Movies' : 'Series'} compact={!wide} />
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

// --- loading ---------------------------------------------------------------------------------------------

function RowSkeleton({ wide }: { wide: boolean }) {
  return (
    <div style={{ marginTop: wide ? 26 : 20 }}>
      <div className="skeleton" style={{ width: wide ? 220 : 160, height: 18, borderRadius: 6, margin: '0 2px' }} />
      <div style={{ display: 'flex', gap: wide ? 10 : 8, padding: '12px 2px 10px', overflow: 'hidden' }}>
        {Array.from({ length: wide ? 8 : 4 }, (_, i) => <div key={i} className="skeleton" style={{ flexShrink: 0, width: wide ? 154 : 112, aspectRatio: '2 / 3', borderRadius: 8 }} />)}
      </div>
    </div>
  )
}

/** The page as it will be, with pulsing tiles: it is clear at once what is coming and where. */
function DiscoverSkeleton({ wide }: { wide: boolean }) {
  return (
    <div style={{ flex: 1, overflow: 'hidden' }}>
      {[0, 1, 2].map((n) => <RowSkeleton key={n} wide={wide} />)}
    </div>
  )
}

/** What is loading, always in sight at the top right. Nothing when nothing loads. */
function LoadingBadge({ extra = null }: { extra?: string | null }) {
  useApp()
  const text = app.moviesLoading && !app.movies ? 'Carico i film…'
    : app.seriesLoading && !app.series ? 'Carico le serie…'
      : app.catalogUpdating > 0 || app.moviesLoading || app.seriesLoading ? 'Cerco titoli nuovi…'
        : extra
  if (!text) return null
  return (
    <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 20, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ marginTop: 6, marginRight: 8, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 999, background: 'rgba(0,0,0,.85)', color: '#fff', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', height: 'fit-content' }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', animation: 'spin .8s linear infinite' }} />
        {text}
      </div>
    </div>
  )
}

// --- my list -------------------------------------------------------------------------------------------------

/** With a TMDB key: films and series added with +, in a page of their own, in the order they were added. */
export function MyListSection() {
  useApp()
  const wide = useWide()
  const [remove, setRemove] = useState<Title | null>(null)
  const list = useMemo<Title[]>(() => {
    if (!app.movies && !app.series) return []
    const ms = moviesFor(MYLIST_ID).map((e): Title => ({ kind: 'movie', entry: e, tmdb: null }))
    const ss = seriesFor(MYLIST_ID).map((e): Title => ({ kind: 'tv', entry: e, tmdb: null }))
    return [...ms, ...ss].sort((a, b) => (app.myList[keyOf(b)] ?? 0) - (app.myList[keyOf(a)] ?? 0))
  }, [app.movies, app.series, app.positionsVersion])
  if (!app.movies && !app.series) return <Loading text="Caricamento della tua lista…" />
  return (
    <div className="scroll" style={{ flex: 1, paddingBottom: 30 }}>
      <div style={{ color: 'var(--text)', fontSize: wide ? 28 : 22, fontWeight: 800, padding: '0 2px' }}>La mia lista</div>
      <div style={{ color: 'var(--text2)', fontSize: 14, padding: '2px 2px 8px' }}>{list.length === 1 ? '1 titolo' : `${list.length} titoli`}</div>
      {list.length === 0 ? <Empty text="La lista è vuota: aggiungi film e serie con + dalla loro scheda." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${wide ? 154 : 112}px)`, gap: wide ? '18px 10px' : '14px 8px', padding: '10px 2px' }}>
          {list.map((t) => <PosterTile key={keyOf(t)} t={t} lookup caption onLong={() => setRemove(t)} />)}
        </div>
      )}
      <AlertDialog open={remove != null} title="Rimuovere dalla mia lista?" text={remove ? nameOf(remove) : undefined} confirm="Rimuovi" confirmColor="var(--danger)"
        onDismiss={() => setRemove(null)} onConfirm={() => { const t = remove; setRemove(null); if (t) toggleMyList(t.entry.item) }} />
    </div>
  )
}
