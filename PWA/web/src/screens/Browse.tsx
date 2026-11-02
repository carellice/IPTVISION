import { type ReactNode, useMemo, useRef, useState } from 'react'
import type { Channel, Movie, Series } from '../../../shared/model.ts'
import { progressAt, timeRange } from '../../../shared/epg.ts'
import { type Entry, hasVariants, variantsText } from '../../../shared/text.ts'
import {
  AlertDialog, Artwork, Badge, Clickable, Empty, Icon, IconButton, type IconName, Loading, Menu, MenuItem, ProgressLine, SectionTitle, useWide,
} from '../components/ui.tsx'
import { VirtualGrid } from '../components/virtual.tsx'
import {
  app, channelsFor, closeCategory, entryProgress, guideOf, isGrid, moviesFor, openCategory, openMovieEntry, openSeriesEntry, playChannel,
  removeMovieFromContinue, removeSeriesFromContinue, seriesFor, setGrid, setSort, sortOf, toggleFavorite, useApp,
} from '../lib/app.ts'
import { ALL_ID, CONTINUE_ID, FAVORITES_ID, type Section, sectionTitle, sortLabel, sortOptions } from '../lib/library.ts'

// ui/Browse.kt: first the categories of a section, then the content of the chosen one,
// with its sort and list/grid view.

type CatEntry = { id: string; name: string; count: number; icon: IconName }

const catTint = (id: string) => (id === FAVORITES_ID ? 'var(--star)' : id === CONTINUE_ID ? 'var(--accent)' : 'var(--text2)')

function LibrarySection({ section, entries, unit, count, children }: {
  section: Section
  entries: CatEntry[]
  unit: (n: number) => string
  count: (catId: string) => number
  children: (catId: string, grid: boolean) => ReactNode
}) {
  const open = app.open[section]
  const entry = entries.find((e) => e.id === open)
  if (open == null || !entry) return <CategoryBrowser section={section} entries={entries} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ListHeader section={section} title={entry.name} count={unit(count(open))} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children(open, isGrid(section))}</div>
    </div>
  )
}

function CategoryBrowser({ section, entries }: { section: Section; entries: CatEntry[] }) {
  const wide = useWide()
  const last = app.lastCategory[section]
  const lastIndex = Math.max(0, entries.findIndex((e) => e.id === last))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <SectionTitle title={sectionTitle[section]} subtitle={entries.length === 1 ? '1 categoria' : `${entries.length} categorie`} style={{ padding: '0 0 10px 4px' }} />
      {wide ? (
        <VirtualGrid count={entries.length} minCell={200} gap={12} padding={[8, 8]} rowHeight={() => 96} initialIndex={lastIndex}
          keyOf={(i) => entries[i].id}
          render={(i) => {
            const c = entries[i]
            return (
              <Clickable onClick={() => openCategory(section, c.id)} style={{ height: 96, padding: 14, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Icon name={c.icon} size={20} color={catTint(c.id)} />
                  <div style={{ flex: 1 }} />
                  <div style={{ color: 'var(--text3)', fontSize: 13 }}>{c.count}</div>
                </div>
                <div className="clamp2" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15, lineHeight: '20px' }}>{c.name}</div>
              </Clickable>
            )
          }} />
      ) : (
        <VirtualGrid count={entries.length} gap={6} padding={[2, 4]} rowHeight={() => 52} initialIndex={lastIndex}
          keyOf={(i) => entries[i].id}
          render={(i) => {
            const c = entries[i]
            return (
              <Clickable onClick={() => openCategory(section, c.id)} style={{ height: 52, display: 'flex', alignItems: 'center', padding: '14px' }}>
                <Icon name={c.icon} size={20} color={catTint(c.id)} />
                <div className="ellipsis" style={{ flex: 1, marginLeft: 14, color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                <div style={{ color: 'var(--text3)', fontSize: 13 }}>{c.count}</div>
                <Icon name="keyboard_arrow_right" size={20} color="var(--text3)" style={{ marginLeft: 6 }} />
              </Clickable>
            )
          }} />
      )}
    </div>
  )
}

/** Header of the open category: back, name, sort and list/grid. */
function ListHeader({ section, title, count }: { section: Section; title: string; count: string }) {
  const wide = useWide()
  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 8 }}>
      <Clickable onClick={() => closeCategory(section)} title="Categorie" radius="50%" background="transparent" style={{ padding: 10 }}>
        <Icon name="arrow_back" color="var(--text)" />
      </Clickable>
      <div style={{ flex: 1, minWidth: 0, marginLeft: 6 }}>
        <div className="ellipsis" style={{ color: 'var(--text)', fontSize: wide ? 24 : 20, fontWeight: 700 }}>{title}</div>
        <div style={{ color: 'var(--text2)', fontSize: 12 }}>{count}</div>
      </div>
      <SortButton section={section} compact={!wide} />
      <div style={{ width: 8 }} />
      <ViewToggle section={section} />
    </div>
  )
}

function SortButton({ section, compact }: { section: Section; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const current = sortOf(section)
  return (
    <div ref={anchor}>
      <Clickable onClick={() => setOpen(true)} radius={10} title="Ordina" style={{ display: 'flex', alignItems: 'center', padding: '9px 12px' }}>
        <Icon name="sort" size={18} color="var(--text2)" />
        {!compact && <div style={{ marginLeft: 8, color: 'var(--text)', fontSize: 13, whiteSpace: 'nowrap' }}>{sortLabel[current]}</div>}
      </Clickable>
      <Menu open={open} anchor={anchor.current} onDismiss={() => setOpen(false)}>
        <div style={{ color: 'var(--text3)', fontSize: 12, fontWeight: 700, padding: '6px 16px' }}>Ordina per</div>
        {sortOptions(section).map((s) => (
          <MenuItem key={s} text={sortLabel[s]} color={s === current ? 'var(--accent2)' : 'var(--text)'}
            leading={s === current ? <Icon name="check" color="var(--accent2)" /> : null}
            onClick={() => { setSort(section, s); setOpen(false) }} />
        ))}
      </Menu>
    </div>
  )
}

function ViewToggle({ section }: { section: Section }) {
  const grid = isGrid(section)
  return (
    <div style={{ display: 'flex', gap: 4, padding: 1, borderRadius: 10 }}>
      {([[false, 'view_list'], [true, 'grid_view']] as const).map(([g, icon]) => {
        const sel = g === grid
        return (
          <Clickable key={icon} onClick={() => setGrid(section, g)} radius={10} title={g ? 'Griglia' : 'Elenco'}
            background={sel ? 'var(--accentSoft)' : 'var(--surface)'} style={{ padding: 9 }}>
            <Icon name={icon} size={20} color={sel ? 'var(--accent)' : 'var(--text2)'} />
          </Clickable>
        )
      })}
    </div>
  )
}

// --- TV in diretta ---------------------------------------------------------------------------------

const nowSec = () => Date.now() / 1000

export function LiveSection() {
  useApp()
  const wide = useWide()
  const lib = app.live
  const entries = useMemo<CatEntry[]>(() => lib ? [
    { id: FAVORITES_ID, name: 'Preferiti', count: lib.items.filter((c) => app.favorites.has(c.streamId)).length, icon: 'star' },
    { id: ALL_ID, name: 'Tutti', count: lib.items.length, icon: 'apps' },
    ...lib.categories.map((c) => ({ id: c.id, name: c.name, count: lib.byCategory.get(c.id)?.length ?? 0, icon: 'folder' as IconName })),
  ] : [], [lib, app.favorites])
  const open = app.open.Live
  const list = useMemo(() => (open ? channelsFor(open) : []), [lib, open, app.favorites, app.settings.sorts.Live])
  if (!lib) return app.error ? <Empty text={app.error} /> : <Loading text="Caricamento canali…" />
  const hasEpg = lib.items.some((c) => c.epgId)
  return (
    <LibrarySection section="Live" entries={entries} unit={(n) => (n === 1 ? '1 canale' : `${n} canali`)} count={() => list.length}>
      {(catId, grid) => {
        if (list.length === 0) {
          return <Empty text={catId === FAVORITES_ID ? 'Nessun preferito. Tieni premuto un canale (o premi Menu sul telecomando) per aggiungerlo.' : 'Nessun canale.'} />
        }
        const playingId = app.playing?.kind === 'Live' ? app.playing.channel.streamId : app.settings.lastStreamId
        const start = Math.max(0, list.findIndex((c) => c.streamId === playingId))
        return grid ? (
          <VirtualGrid key={catId + 'g'} count={list.length} minCell={wide ? 170 : 108} gap={10} padding={[10, 10]} initialIndex={start}
            rowHeight={(w) => 8 + (w - 16) * 0.625 + 6 + 24 + 24 + 7 + 8} keyOf={(i) => list[i].streamId}
            render={(i) => <ChannelTile ch={list[i]} playlist={list} current={list[i].streamId === playingId} />} />
        ) : (
          <VirtualGrid key={catId + 'l'} count={list.length} gap={6} padding={[4, 6]} initialIndex={start}
            rowHeight={() => (hasEpg ? 75 : 68)} keyOf={(i) => list[i].streamId}
            render={(i) => <ChannelRow ch={list[i]} playlist={list} current={list[i].streamId === playingId} />} />
        )
      }}
    </LibrarySection>
  )
}

export function ChannelRow({ ch, playlist, current }: { ch: Channel; playlist: Channel[]; current: boolean }) {
  const [now, next] = guideOf(ch)
  const fav = app.favorites.has(ch.streamId)
  return (
    <Clickable onClick={() => playChannel(ch, playlist)} onLongClick={() => toggleFavorite(ch)}
      style={{ display: 'flex', alignItems: 'center', padding: 10, height: '100%' }}>
      <Artwork url={ch.logo} initials={ch.initials} fit="contain" fontSize={15} style={{ width: 72, height: 48, borderRadius: 8 }} />
      <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {ch.num > 0 && <div style={{ color: 'var(--text3)', fontSize: 13, marginRight: 8 }}>{ch.num}</div>}
          <div className="ellipsis" style={{ color: current ? 'var(--accent2)' : 'var(--text)', fontWeight: 600, fontSize: 15 }}>{ch.name}</div>
        </div>
        {now ? (
          <>
            <div className="ellipsis" style={{ color: 'var(--text2)', fontSize: 13 }}>{now.title}</div>
            <ProgressLine progress={progressAt(now, nowSec())} style={{ width: '60%', marginTop: 4 }} />
          </>
        ) : next ? (
          <div className="ellipsis" style={{ color: 'var(--text3)', fontSize: 13 }}>{`Alle ${timeRange(next).split(' ')[0]}: ${next.title}`}</div>
        ) : null}
      </div>
      <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <IconButton icon={fav ? 'star' : 'star_border'} title="Preferito" color={fav ? 'var(--star)' : 'var(--text3)'} onClick={() => toggleFavorite(ch)} />
      </div>
    </Clickable>
  )
}

function ChannelTile({ ch, playlist, current }: { ch: Channel; playlist: Channel[]; current: boolean }) {
  const [now] = guideOf(ch)
  return (
    <Clickable onClick={() => playChannel(ch, playlist)} onLongClick={() => toggleFavorite(ch)}
      background={current ? 'var(--accentSoft)' : 'var(--surface)'} style={{ padding: 8, height: '100%' }}>
      <div style={{ position: 'relative' }}>
        <Artwork url={ch.logo} initials={ch.initials} fit="contain" style={{ width: '100%', aspectRatio: '16 / 10', borderRadius: 8 }} />
        {app.favorites.has(ch.streamId) && <Icon name="star" size={16} color="var(--star)" style={{ position: 'absolute', top: 4, right: 4 }} />}
      </div>
      <div className="ellipsis" style={{ marginTop: 6, color: current ? 'var(--accent2)' : 'var(--text)', fontSize: 13, fontWeight: 600 }}>
        {(ch.num > 0 ? `${ch.num}  ` : '') + ch.name}
      </div>
      <div className="ellipsis" style={{ color: 'var(--text3)', fontSize: 11 }}>{now?.title ?? ' '}</div>
      {now && <ProgressLine progress={progressAt(now, nowSec())} style={{ marginTop: 4 }} />}
    </Clickable>
  )
}

// --- Film e serie --------------------------------------------------------------------------------

export function MoviesSection() {
  useApp()
  const lib = app.movies
  const cont = useMemo(() => (lib ? moviesFor(CONTINUE_ID) : []), [lib, app.positionsVersion])
  const entries = useMemo<CatEntry[]>(() => lib ? [
    ...(cont.length ? [{ id: CONTINUE_ID, name: 'Continua a guardare', count: cont.length, icon: 'history' as IconName }] : []),
    { id: ALL_ID, name: 'Tutti', count: lib.items.length, icon: 'apps' },
    ...lib.categories.map((c) => ({ id: c.id, name: c.name, count: lib.byCategory.get(c.id)?.length ?? 0, icon: 'folder' as IconName })),
  ] : [], [lib, cont.length])
  const open = app.open.Movies
  const list = useMemo(() => (open ? moviesFor(open) : []), [lib, open, app.positionsVersion, app.settings.sorts.Movies])
  const [remove, setRemove] = useState<Entry<Movie> | null>(null)
  if (!lib) return <Loading text={app.moviesLoading ? 'Caricamento film…' : null} />
  return (
    <LibrarySection section="Movies" entries={entries} unit={(n) => (n === 1 ? '1 film' : `${n} film`)} count={() => list.length}>
      {(catId, grid) => (
        <>
          <EntryList list={list} grid={grid} keyOf={(m) => m.streamId} catId={catId}
            item={(e, g) => {
              const m = e.item
              // In "Continua a guardare" the long press (or the Menu key) removes the title from the list.
              const long = catId === CONTINUE_ID ? () => setRemove(e) : undefined
              const badge = hasVariants(e) ? variantsText(e) : null
              return g ? <Poster title={m.name} meta={m.meta} url={m.poster} initials={m.initials} progress={entryProgress(e)} badge={badge} onLongClick={long} onClick={() => openMovieEntry(e)} />
                : <MediaRow title={m.name} meta={m.meta} url={m.poster} initials={m.initials} progress={entryProgress(e)} badge={badge} onLongClick={long} onClick={() => openMovieEntry(e)} />
            }} />
          <AlertDialog open={remove != null} title="Rimuovere da Continua a guardare?" text={remove?.item.name} confirm="Rimuovi" confirmColor="var(--danger)"
            onDismiss={() => setRemove(null)} onConfirm={() => { if (remove) removeMovieFromContinue(remove); setRemove(null) }} />
        </>
      )}
    </LibrarySection>
  )
}

export function SeriesSection() {
  useApp()
  const lib = app.series
  const cont = useMemo(() => (lib ? seriesFor(CONTINUE_ID) : []), [lib, app.positionsVersion])
  const entries = useMemo<CatEntry[]>(() => lib ? [
    ...(cont.length ? [{ id: CONTINUE_ID, name: 'Continua a guardare', count: cont.length, icon: 'history' as IconName }] : []),
    { id: ALL_ID, name: 'Tutte', count: lib.items.length, icon: 'apps' },
    ...lib.categories.map((c) => ({ id: c.id, name: c.name, count: lib.byCategory.get(c.id)?.length ?? 0, icon: 'folder' as IconName })),
  ] : [], [lib, cont.length])
  const open = app.open.Series
  const list = useMemo(() => (open ? seriesFor(open) : []), [lib, open, app.positionsVersion, app.settings.sorts.Series])
  const [remove, setRemove] = useState<Entry<Series> | null>(null)
  if (!lib) return <Loading text={app.seriesLoading ? 'Caricamento serie…' : null} />
  return (
    <LibrarySection section="Series" entries={entries} unit={(n) => (n === 1 ? '1 serie' : `${n} serie`)} count={() => list.length}>
      {(catId, grid) => (
        <>
          <EntryList list={list} grid={grid} keyOf={(s) => s.seriesId} catId={catId}
            item={(e, g) => {
              const s = e.item
              const long = catId === CONTINUE_ID ? () => setRemove(e) : undefined
              const badge = hasVariants(e) ? variantsText(e) : null
              return g ? <Poster title={s.name} meta={s.meta} url={s.cover} initials={s.initials} progress={0} badge={badge} onLongClick={long} onClick={() => openSeriesEntry(e)} />
                : <MediaRow title={s.name} meta={s.meta} url={s.cover} initials={s.initials} progress={0} badge={badge} onLongClick={long} onClick={() => openSeriesEntry(e)} />
            }} />
          <AlertDialog open={remove != null} title="Rimuovere da Continua a guardare?" text={remove?.item.name} confirm="Rimuovi" confirmColor="var(--danger)"
            onDismiss={() => setRemove(null)} onConfirm={() => { if (remove) removeSeriesFromContinue(remove); setRemove(null) }} />
        </>
      )}
    </LibrarySection>
  )
}

function EntryList<T>({ list, grid, keyOf, item, catId }: {
  list: Entry<T>[]; grid: boolean; keyOf: (t: T) => number; item: (e: Entry<T>, grid: boolean) => ReactNode; catId: string
}) {
  const wide = useWide()
  if (list.length === 0) return <Empty text="Nessun contenuto." />
  return grid ? (
    <VirtualGrid key={catId + 'g'} count={list.length} minCell={wide ? 150 : 110} gap={12} rowGap={14} padding={[12, 12]}
      rowHeight={(w) => 4 + (w - 8) * 1.5 + 6 + 48 + 24 + 2 + 4} keyOf={(i) => keyOf(list[i].item)} render={(i) => item(list[i], true)} />
  ) : (
    <VirtualGrid key={catId + 'l'} count={list.length} gap={6} padding={[4, 6]} rowHeight={() => 98}
      keyOf={(i) => keyOf(list[i].item)} render={(i) => item(list[i], false)} />
  )
}

export function Poster({ title, meta, url, initials, progress, badge, onLongClick, onClick }: {
  title: string; meta: string; url: string | null; initials: string; progress: number; badge: string | null; onLongClick?: () => void; onClick: () => void
}) {
  return (
    <Clickable onClick={onClick} onLongClick={onLongClick} background="transparent" style={{ padding: 4, height: '100%' }}>
      <div style={{ position: 'relative' }}>
        <Artwork url={url} initials={initials} fontSize={22} style={{ width: '100%', aspectRatio: '2 / 3', borderRadius: 10 }} />
        {progress > 0 && progress < 1 && <ProgressLine progress={progress} style={{ position: 'absolute', left: 6, right: 6, bottom: 6 }} />}
        <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          {badge && <Badge text={badge} color="#111318D0" />}
          {progress >= 1 && <Badge text="Visto" color="var(--accent)" />}
        </div>
      </div>
      <div className="clamp2" style={{ marginTop: 6, color: 'var(--text)', fontSize: 13, fontWeight: 500 }}>{title}</div>
      {meta && <div className="ellipsis" style={{ color: 'var(--text3)', fontSize: 11 }}>{meta}</div>}
    </Clickable>
  )
}

/** Film or series in list view: small poster, title and details. */
export function MediaRow({ title, meta, url, initials, progress, badge, onLongClick, onClick }: {
  title: string; meta: string; url: string | null; initials: string; progress: number; badge: string | null; onLongClick?: () => void; onClick: () => void
}) {
  return (
    <Clickable onClick={onClick} onLongClick={onLongClick} style={{ display: 'flex', alignItems: 'center', padding: 10, height: '100%' }}>
      <Artwork url={url} initials={initials} fontSize={14} style={{ width: 52, aspectRatio: '2 / 3', borderRadius: 6 }} />
      <div style={{ flex: 1, minWidth: 0, marginLeft: 14, maxHeight: '100%', overflow: 'hidden' }}>
        <div className="clamp2" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>{title}</div>
        {meta && <div className="ellipsis" style={{ color: 'var(--text2)', fontSize: 12 }}>{meta}</div>}
        {(badge || progress >= 1) && (
          <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
            {badge && <Badge text={badge} />}
            {progress >= 1 && <Badge text="Visto" color="var(--accent)" />}
          </div>
        )}
        {progress > 0 && progress < 1 && <ProgressLine progress={progress} style={{ width: 140, marginTop: 6 }} />}
      </div>
    </Clickable>
  )
}
