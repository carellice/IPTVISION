// ui/Browse.kt: prima l'elenco delle categorie; scelta la categoria, il suo contenuto con
// ordinamento ed elenco/griglia.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { Channel, Movie, Series } from '../../../shared/model.ts'
import { hasVariants, variantsText, type Entry } from '../../../shared/text.ts'
import { useVm, vm } from '../lib/app.ts'
import { ALL_ID, CONTINUE_ID, FAVORITES_ID, sectionTitle, sortLabel, sortOptionsFor, type Section } from '../lib/library.ts'
import {
  AlertDialog, Artwork, Badge, C, Clickable, Empty, Icon, IconButton, LazyGrid, Loading, Menu, MenuItem, ProgressLine, SectionTitle,
  type IconName,
} from '../components/ui.tsx'
import { progressAt } from '../../../shared/model.ts'
import { useWide } from './Home.tsx'

type CatEntry = { id: string; name: string; count: number; icon: IconName }

function cats(categories: { id: string; name: string }[], counts: (id: string) => number, extra: CatEntry[]): CatEntry[] {
  return [...extra, ...categories.map((c) => ({ id: c.id, name: c.name, count: counts(c.id), icon: 'folder' as IconName }))]
}

const catTint = (id: string) => (id === FAVORITES_ID ? C.Star : id === CONTINUE_ID ? C.Accent : C.Text2)

function LibrarySection({ section, entries, unit, count, children }: {
  section: Section; entries: CatEntry[]; unit: (n: number) => string; count: (catId: string) => number
  children: (catId: string, grid: boolean) => ReactNode
}) {
  const open = vm.openCategory(section)
  const entry = entries.find((e) => e.id === open)
  if (open == null || !entry) return <CategoryBrowser section={section} entries={entries} />
  return (
    <div className="col" style={{ height: '100%' }}>
      <ListHeader section={section} title={entry.name} count={unit(count(open))} />
      <div className="grow" style={{ minHeight: 0, position: 'relative' }}>{children(open, vm.isGrid(section))}</div>
    </div>
  )
}

function CategoryBrowser({ section, entries }: { section: Section; entries: CatEntry[] }) {
  const wide = useWide()
  const last = vm.lastCategory[section]
  const lastIndex = Math.max(0, entries.findIndex((e) => e.id === last))
  return (
    <div className="col" style={{ height: '100%' }}>
      <SectionTitle title={sectionTitle[section]} subtitle={entries.length === 1 ? '1 categoria' : `${entries.length} categorie`} style={{ padding: '0 0 10px 4px', flex: 'none' }} />
      <div className="grow" style={{ minHeight: 0 }}>
        {wide ? (
          <LazyGrid items={entries} itemKey={(c) => c.id} initialIndex={lastIndex}
            spec={{ minWidth: 200, gap: 12, rowGap: 12, padding: [8, 8], estimate: () => 96 }}
            render={(c) => (
              <Clickable onClick={() => vm.openCategoryId(section, c.id)}>
                <div className="col" style={{ height: 96, padding: 14, justifyContent: 'space-between' }}>
                  <div className="row">
                    <Icon name={c.icon} size={20} color={catTint(c.id)} />
                    <div style={{ flex: 1 }} />
                    <span style={{ color: C.Text3, fontSize: 13 }}>{c.count}</span>
                  </div>
                  <div className="clamp2" style={{ color: C.Text, fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                </div>
              </Clickable>
            )} />
        ) : (
          <LazyGrid items={entries} itemKey={(c) => c.id} initialIndex={lastIndex}
            spec={{ minWidth: 0, gap: 0, rowGap: 6, padding: [4, 2], estimate: () => 52 }}
            render={(c) => (
              <Clickable focusScale={1.02} onClick={() => vm.openCategoryId(section, c.id)}>
                <div className="row" style={{ padding: 14 }}>
                  <Icon name={c.icon} size={20} color={catTint(c.id)} />
                  <div style={{ width: 14 }} />
                  <div className="grow ellipsis" style={{ color: C.Text, fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                  <span style={{ color: C.Text3, fontSize: 13 }}>{c.count}</span>
                  <div style={{ width: 6 }} />
                  <Icon name="keyboard_arrow_right" size={20} color={C.Text3} />
                </div>
              </Clickable>
            )} />
        )}
      </div>
    </div>
  )
}

/** Intestazione della categoria aperta: indietro, nome, ordinamento ed elenco/griglia. */
function ListHeader({ section, title, count }: { section: Section; title: string; count: string }) {
  const wide = useWide()
  return (
    <div className="row" style={{ paddingBottom: 8, flex: 'none' }}>
      <Clickable radius={999} background={C.Transparent} onClick={() => vm.closeCategory(section)} label="Categorie" rippleColor="rgba(255,255,255,0.12)">
        <div style={{ padding: 10, display: 'flex' }}><Icon name="arrow_back" color={C.Text} /></div>
      </Clickable>
      <div style={{ width: 6 }} />
      <div className="col grow">
        <div className="ellipsis" style={{ color: C.Text, fontSize: wide ? 24 : 20, fontWeight: 700 }}>{title}</div>
        <div style={{ color: C.Text2, fontSize: 12 }}>{count}</div>
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
  const current = vm.sortOf(section)
  return (
    <div ref={anchor}>
      <Clickable radius={10} onClick={() => setOpen(true)} label="Ordina">
        <div className="row" style={{ padding: '9px 12px' }}>
          <Icon name="sort" size={18} color={C.Text2} />
          {!compact && <><div style={{ width: 8 }} /><span style={{ color: C.Text, fontSize: 13, whiteSpace: 'nowrap' }}>{sortLabel[current]}</span></>}
        </div>
      </Clickable>
      <Menu open={open} anchor={anchor.current} onDismiss={() => setOpen(false)}>
        <div style={{ color: C.Text3, fontSize: 12, fontWeight: 700, padding: '6px 16px' }}>Ordina per</div>
        {sortOptionsFor(section).map((s, i) => (
          <MenuItem key={s} text={sortLabel[s]} color={s === current ? C.Accent2 : C.Text} autoFocus={i === 0}
            leading={s === current ? <Icon name="check" color={C.Accent2} /> : null}
            onClick={() => { vm.setSort(section, s); setOpen(false) }} />
        ))}
      </Menu>
    </div>
  )
}

function ViewToggle({ section }: { section: Section }) {
  const grid = vm.isGrid(section)
  return (
    <div className="row" style={{ borderRadius: 10, padding: 1, gap: 4 }}>
      {([[false, 'view_list'], [true, 'grid_view']] as [boolean, IconName][]).map(([g, icon]) => {
        const sel = g === grid
        return (
          <Clickable key={icon} radius={10} background={sel ? C.AccentSoft : C.Surface} onClick={() => vm.setGrid(section, g)} label={g ? 'Griglia' : 'Elenco'}>
            <div style={{ padding: 9, display: 'flex' }}><Icon name={icon} size={20} color={sel ? C.Accent : C.Text2} /></div>
          </Clickable>
        )
      })}
    </div>
  )
}

// ---------- TV in diretta ----------

export function LiveSection() {
  const v = useVm()
  const lib = v.live
  const entries = useMemo(() => lib ? cats(lib.categories, (id) => lib.byCategory.get(id)?.length ?? 0, [
    { id: FAVORITES_ID, name: 'Preferiti', count: lib.items.filter((c) => v.favorites.has(c.streamId)).length, icon: 'star' },
    { id: ALL_ID, name: 'Tutti', count: lib.items.length, icon: 'apps' },
  ]) : [], [lib, v.favorites])
  if (!lib) return v.error ? <Empty text={v.error} /> : <Loading text="Caricamento canali…" />
  const unit = (n: number) => (n === 1 ? '1 canale' : `${n} canali`)
  return (
    <LibrarySection section="Live" entries={entries} unit={unit} count={(id) => v.channelsFor(id).length}>
      {(catId, grid) => <LiveList catId={catId} grid={grid} />}
    </LibrarySection>
  )
}

function LiveList({ catId, grid }: { catId: string; grid: boolean }) {
  const v = useVm()
  const wide = useWide()
  const list = useMemo(() => v.channelsFor(catId), [v.live, catId, v.favorites, v.sortOf('Live')])
  if (list.length === 0) {
    return <Empty text={catId === FAVORITES_ID ? 'Nessun preferito. Tieni premuto un canale (o premi Menu sul telecomando) per aggiungerlo.' : 'Nessun canale.'} />
  }
  const playingId = v.playing?.kind === 'Live' ? v.playing.channel.streamId : v.settings.lastStreamId
  const start = Math.max(0, list.findIndex((c) => c.streamId === playingId))
  return grid ? (
    <LazyGrid key={`g${catId}`} items={list} itemKey={(c) => c.streamId} initialIndex={start}
      spec={{ minWidth: wide ? 170 : 108, gap: 10, rowGap: 10, padding: [10, 10], estimate: (w) => 16 + (w - 16) * 0.625 + 6 + 24 + 24 + 7 }}
      render={(ch) => <ChannelTile ch={ch} playlist={list} current={ch.streamId === playingId} />} />
  ) : (
    <LazyGrid key={`l${catId}`} items={list} itemKey={(c) => c.streamId} initialIndex={start}
      spec={{ minWidth: 0, gap: 0, rowGap: 6, padding: [6, 4], estimate: () => 75 }}
      render={(ch) => <ChannelRow ch={ch} playlist={list} current={ch.streamId === playingId} />} />
  )
}

export function ChannelRow({ ch, playlist, current }: { ch: Channel; playlist: Channel[]; current: boolean }) {
  const [now, next] = vm.nowNext(ch)
  const fav = vm.favorites.has(ch.streamId)
  return (
    <Clickable focusScale={1.02} onLongClick={() => vm.toggleFavorite(ch)} onClick={() => vm.playChannel(ch, playlist)}>
      <div className="row" style={{ padding: 10 }}>
        <Artwork url={ch.logo} initials={ch.initials} fit="contain" fontSize={15} radius={8} style={{ width: 72, height: 48 }} />
        <div style={{ width: 12 }} />
        <div className="col grow">
          <div className="row">
            {ch.num > 0 && <><span style={{ color: C.Text3, fontSize: 13 }}>{ch.num}</span><div style={{ width: 8 }} /></>}
            <span className="ellipsis" style={{ color: current ? C.Accent2 : C.Text, fontWeight: 600, fontSize: 15 }}>{ch.name}</span>
          </div>
          {now ? (
            <>
              <div className="ellipsis" style={{ color: C.Text2, fontSize: 13 }}>{now.title}</div>
              <div style={{ height: 4 }} />
              <ProgressLine progress={progressAt(now, Date.now() / 1000)} style={{ width: '60%' }} />
            </>
          ) : next ? (
            <div className="ellipsis" style={{ color: C.Text3, fontSize: 13 }}>Alle {clockOf(next.start)}: {next.title}</div>
          ) : null}
        </div>
        <div onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <IconButton icon={fav ? 'star' : 'star_border'} label="Preferito" color={fav ? C.Star : C.Text3} onClick={() => vm.toggleFavorite(ch)} />
        </div>
      </div>
    </Clickable>
  )
}

const clockOf = (sec: number) => {
  const d = new Date(sec * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function ChannelTile({ ch, playlist, current }: { ch: Channel; playlist: Channel[]; current: boolean }) {
  const now = vm.nowNext(ch)[0]
  return (
    <Clickable focusScale={1.06} background={current ? C.AccentSoft : C.Surface} onLongClick={() => vm.toggleFavorite(ch)} onClick={() => vm.playChannel(ch, playlist)}>
      <div className="col" style={{ padding: 8 }}>
        <div style={{ position: 'relative' }}>
          <Artwork url={ch.logo} initials={ch.initials} fit="contain" radius={8} style={{ width: '100%', aspectRatio: '16 / 10' }} />
          {vm.favorites.has(ch.streamId) && <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex' }}><Icon name="star" size={16} color={C.Star} /></div>}
        </div>
        <div style={{ height: 6 }} />
        <div className="ellipsis" style={{ color: current ? C.Accent2 : C.Text, fontSize: 13, fontWeight: 600 }}>{(ch.num > 0 ? `${ch.num}  ` : '') + ch.name}</div>
        <div className="ellipsis" style={{ color: C.Text3, fontSize: 11 }}>{now?.title ?? ' '}</div>
        {now && <><div style={{ height: 4 }} /><ProgressLine progress={progressAt(now, Date.now() / 1000)} /></>}
      </div>
    </Clickable>
  )
}

// ---------- Film e serie ----------

export function MoviesSection() {
  const v = useVm()
  const lib = v.movies
  const cont = useMemo(() => v.moviesFor(CONTINUE_ID), [lib, v.positionsVersion])
  const entries = useMemo(() => lib ? cats(lib.categories, (id) => lib.byCategory.get(id)?.length ?? 0, [
    ...(cont.length ? [{ id: CONTINUE_ID, name: 'Continua a guardare', count: cont.length, icon: 'history' as IconName }] : []),
    { id: ALL_ID, name: 'Tutti', count: lib.items.length, icon: 'apps' },
  ]) : [], [lib, cont.length])
  const [remove, setRemove] = useState<Entry<Movie> | null>(null)
  if (!lib) return <Loading text={v.moviesLoading ? 'Caricamento film…' : null} />
  return (
    <>
      <LibrarySection section="Movies" entries={entries} unit={(n) => (n === 1 ? '1 film' : `${n} film`)} count={(id) => v.moviesFor(id).length}>
        {(catId, grid) => (
          <EntryList key={catId} list={v.moviesFor(catId)} grid={grid} itemKey={(m) => m.streamId}
            item={(e, g) => {
              const m = e.item
              // In "Continua a guardare" la pressione lunga (o il tasto Menu) toglie il titolo dall'elenco.
              const long = catId === CONTINUE_ID ? () => setRemove(e) : undefined
              const badge = hasVariants(e) ? variantsText(e) : null
              return g
                ? <Poster title={m.name} meta={m.meta} url={m.poster} initials={m.initials} progress={v.progressOf(e)} badge={badge} onLongClick={long} onClick={() => v.openMovieEntry(e)} />
                : <MediaRow title={m.name} meta={m.meta} url={m.poster} initials={m.initials} progress={v.progressOf(e)} badge={badge} onLongClick={long} onClick={() => v.openMovieEntry(e)} />
            }} />
        )}
      </LibrarySection>
      <RemoveContinueDialog title={remove?.item.name ?? null} onDismiss={() => setRemove(null)} onConfirm={() => { if (remove) v.removeMovieFromContinue(remove); setRemove(null) }} />
    </>
  )
}

export function SeriesSection() {
  const v = useVm()
  const lib = v.series
  const cont = useMemo(() => v.seriesFor(CONTINUE_ID), [lib, v.positionsVersion])
  const entries = useMemo(() => lib ? cats(lib.categories, (id) => lib.byCategory.get(id)?.length ?? 0, [
    ...(cont.length ? [{ id: CONTINUE_ID, name: 'Continua a guardare', count: cont.length, icon: 'history' as IconName }] : []),
    { id: ALL_ID, name: 'Tutte', count: lib.items.length, icon: 'apps' },
  ]) : [], [lib, cont.length])
  const [remove, setRemove] = useState<Entry<Series> | null>(null)
  if (!lib) return <Loading text={v.seriesLoading ? 'Caricamento serie…' : null} />
  return (
    <>
      <LibrarySection section="Series" entries={entries} unit={(n) => (n === 1 ? '1 serie' : `${n} serie`)} count={(id) => v.seriesFor(id).length}>
        {(catId, grid) => (
          <EntryList key={catId} list={v.seriesFor(catId)} grid={grid} itemKey={(s) => s.seriesId}
            item={(e, g) => {
              const s = e.item
              const long = catId === CONTINUE_ID ? () => setRemove(e) : undefined
              const badge = hasVariants(e) ? variantsText(e) : null
              return g
                ? <Poster title={s.name} meta={s.meta} url={s.cover} initials={s.initials} progress={0} badge={badge} onLongClick={long} onClick={() => v.openSeriesEntry(e)} />
                : <MediaRow title={s.name} meta={s.meta} url={s.cover} initials={s.initials} progress={0} badge={badge} onLongClick={long} onClick={() => v.openSeriesEntry(e)} />
            }} />
        )}
      </LibrarySection>
      <RemoveContinueDialog title={remove?.item.name ?? null} onDismiss={() => setRemove(null)} onConfirm={() => { if (remove) v.removeSeriesFromContinue(remove); setRemove(null) }} />
    </>
  )
}

function RemoveContinueDialog({ title, onDismiss, onConfirm }: { title: string | null; onDismiss: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={title != null} onDismiss={onDismiss} title="Rimuovere da Continua a guardare?" text={title ?? ''}
      confirm={{ label: 'Rimuovi', color: C.Danger, onClick: onConfirm }} dismiss={{ label: 'Indietro', color: C.Text2, onClick: onDismiss }} />
  )
}

function EntryList<T>({ list, grid, itemKey, item }: {
  list: Entry<T>[]; grid: boolean; itemKey: (t: T) => number; item: (e: Entry<T>, grid: boolean) => ReactNode
}) {
  const wide = useWide()
  if (list.length === 0) return <Empty text="Nessun contenuto." />
  return grid ? (
    <LazyGrid items={list} itemKey={(e) => itemKey(e.item)}
      // Spazio attorno per il riquadro che si ingrandisce quando ha il focus.
      spec={{ minWidth: wide ? 150 : 110, gap: 12, rowGap: 14, padding: [12, 12], estimate: (w) => 8 + (w - 8) * 1.5 + 6 + 48 + 24 + 2 }}
      render={(e) => item(e, true)} />
  ) : (
    <LazyGrid items={list} itemKey={(e) => itemKey(e.item)}
      spec={{ minWidth: 0, gap: 0, rowGap: 6, padding: [6, 4], estimate: () => 98 }}
      render={(e) => item(e, false)} />
  )
}

export function Poster({ title, meta, url, initials, progress, badge, onLongClick, onClick }: {
  title: string; meta: string; url: string | null; initials: string; progress: number; badge: string | null; onLongClick?: () => void; onClick: () => void
}) {
  return (
    <Clickable focusScale={1.06} background={C.Transparent} focusedBackground={C.Surface} onLongClick={onLongClick} onClick={onClick}>
      <div className="col" style={{ padding: 4 }}>
        <div style={{ position: 'relative' }}>
          <Artwork url={url} initials={initials} fontSize={22} radius={10} style={{ width: '100%', aspectRatio: '2 / 3' }} />
          {progress > 0 && progress < 1 && <div style={{ position: 'absolute', left: 6, right: 6, bottom: 6 }}><ProgressLine progress={progress} /></div>}
          <div className="col" style={{ position: 'absolute', top: 6, right: 6, alignItems: 'flex-end', gap: 4 }}>
            {badge && <Badge text={badge} color="rgba(17,19,24,0.816)" />}
            {progress >= 1 && <Badge text="Visto" color={C.Accent} />}
          </div>
        </div>
        <div style={{ height: 6 }} />
        <div className="clamp2" style={{ color: C.Text, fontSize: 13, fontWeight: 500 }}>{title}</div>
        {meta !== '' && <div className="ellipsis" style={{ color: C.Text3, fontSize: 11 }}>{meta}</div>}
        <div style={{ height: 2 }} />
      </div>
    </Clickable>
  )
}

/** Film o serie in vista elenco: locandina piccola, titolo e dati. */
export function MediaRow({ title, meta, url, initials, progress, badge, onLongClick, onClick }: {
  title: string; meta: string; url: string | null; initials: string; progress: number; badge: string | null; onLongClick?: () => void; onClick: () => void
}) {
  return (
    <Clickable focusScale={1.02} onLongClick={onLongClick} onClick={onClick}>
      <div className="row" style={{ padding: 10 }}>
        <Artwork url={url} initials={initials} fontSize={14} radius={6} style={{ width: 52, aspectRatio: '2 / 3' }} />
        <div style={{ width: 14 }} />
        <div className="col grow">
          <div className="clamp2" style={{ color: C.Text, fontWeight: 600, fontSize: 15 }}>{title}</div>
          {meta !== '' && <div className="ellipsis" style={{ color: C.Text2, fontSize: 12 }}>{meta}</div>}
          {(badge != null || progress >= 1) && (
            <>
              <div style={{ height: 5 }} />
              <div className="row" style={{ gap: 6 }}>
                {badge && <Badge text={badge} />}
                {progress >= 1 && <Badge text="Visto" color={C.Accent} />}
              </div>
            </>
          )}
          {progress > 0 && progress < 1 && <><div style={{ height: 6 }} /><ProgressLine progress={progress} style={{ width: 140 }} /></>}
        </div>
      </div>
    </Clickable>
  )
}

