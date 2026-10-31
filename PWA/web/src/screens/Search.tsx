// Ricerca unica di ui/SearchSettings.kt: canali, film e serie insieme, anche a voce.
import { useMemo, type ReactNode } from 'react'
import { initials, joinMeta } from '../../../shared/text.ts'
import { useVm } from '../lib/app.ts'
import { scopeLabel, type SearchScope } from '../lib/library.ts'
import { startVoice } from '../lib/voice.ts'
import { Artwork, Badge, C, Clickable, Empty, Icon, IconButton, LazyGrid, Pill, SectionTitle, TextField } from '../components/ui.tsx'
import { ChannelRow } from './Browse.tsx'

const placeholders: Record<SearchScope, string> = {
  Channels: 'Nome del canale', Movies: 'Titolo del film', Series: 'Titolo della serie', All: 'Nome del canale, del film o della serie',
}

type Row = { key: string; node: ReactNode }

export function SearchSection() {
  const vm = useVm()
  const q = vm.searchQuery
  const scope = vm.searchScope
  const results = useMemo(() => vm.search(q, scope), [q, scope, vm.live, vm.movies, vm.series])

  const rows: Row[] = []
  const header = (title: string, count: number) => rows.push({
    key: `h${title}`,
    node: <div style={{ color: C.Text2, fontWeight: 600, fontSize: 13, padding: '10px 0 2px' }}>{title} · {count}</div>,
  })
  if (results.categories.length) {
    header('Categorie', results.categories.length)
    for (const c of results.categories) {
      const where = c.section === 'Movies' ? `Film · ${c.count} titoli` : c.section === 'Series' ? `Serie TV · ${c.count} serie` : `TV in diretta · ${c.count} canali`
      rows.push({ key: `k${c.section}${c.id}`, node: <Hit title={c.name} meta={where} kind="Categoria" url={null} initials={initials(c.name)} onClick={() => vm.openCategoryHit(c)} /> })
    }
  }
  if (results.channels.length) {
    header('Canali', results.channels.length)
    for (const ch of results.channels) rows.push({ key: `c${ch.streamId}`, node: <ChannelRow ch={ch} playlist={results.channels} current={false} /> })
  }
  if (results.movies.length) {
    header('Film', results.movies.length)
    for (const e of results.movies) {
      const m = e.item
      rows.push({ key: `m${m.streamId}`, node: <Hit title={m.name} meta={e.variants.length > 1 ? joinMeta(m.meta, `${e.variants.length} versioni`) : m.meta} kind="Film" url={m.poster} initials={m.initials} onClick={() => vm.openMovieEntry(e)} /> })
    }
  }
  if (results.series.length) {
    header('Serie TV', results.series.length)
    for (const e of results.series) {
      const s = e.item
      rows.push({ key: `s${s.seriesId}`, node: <Hit title={s.name} meta={e.variants.length > 1 ? joinMeta(s.meta, `${e.variants.length} versioni`) : s.meta} kind="Serie" url={s.cover} initials={s.initials} onClick={() => vm.openSeriesEntry(e)} /> })
    }
  }

  return (
    <div className="col" style={{ height: '100%' }}>
      <SectionTitle title="Cerca" subtitle={q.trim() === '' ? 'Canali, film e serie insieme' : `${results.total} risultati`} />
      <div style={{ height: 12 }} />
      <div className="row" style={{ flex: 'none' }}>
        <TextField value={q} onChange={(t) => vm.setQuery(t)} placeholder={placeholders[scope]} inputMode="search" enterKeyHint="search" radius={14} style={{ flex: 1 }}
          leading={<Icon name="search" color={C.Text2} />}
          trailing={q !== '' ? <IconButton icon="close" label="Cancella" color={C.Text2} onClick={() => vm.setQuery('')} /> : undefined} />
        <div style={{ width: 10 }} />
        <Clickable radius={14} background={C.AccentSoft} onClick={() => startVoice((t) => vm.setQuery(t))} label="Ricerca vocale">
          <div style={{ padding: 16, display: 'flex' }}><Icon name="mic" color={C.Accent} /></div>
        </Clickable>
        <div style={{ width: 10 }} />
        <Clickable radius={14} background={C.AccentSoft} onClick={() => vm.openQuiz()} label="Cosa guardo?">
          <div style={{ padding: 16, display: 'flex' }}><Icon name="lightbulb" color={C.Accent} /></div>
        </Clickable>
      </div>
      <div style={{ height: 10 }} />
      {/* Dove cercare: tutto insieme oppure solo canali, film o serie. */}
      <div className="row hscroll" style={{ gap: 8, flex: 'none' }}>
        {(Object.keys(scopeLabel) as SearchScope[]).map((s) => <Pill key={s} text={scopeLabel[s]} selected={s === scope} onClick={() => vm.changeScope(s)} />)}
      </div>
      <div style={{ height: 8 }} />
      {(vm.moviesLoading || vm.seriesLoading) && scope !== 'Channels' && <div style={{ color: C.Text3, fontSize: 12, flex: 'none' }}>Carico anche film e serie…</div>}
      <div className="grow" style={{ minHeight: 0 }}>
        {q.trim() !== '' && results.total === 0 && !vm.moviesLoading && !vm.seriesLoading
          ? <Empty text={`Nessun risultato per "${q}".`} style={{ height: 'auto', alignItems: 'flex-start' }} />
          : <LazyGrid key={`${q}|${scope}`} items={rows} itemKey={(r) => r.key} spec={{ minWidth: 0, gap: 0, rowGap: 6, padding: [6, 4], estimate: () => 92 }} render={(r) => r.node} />}
      </div>
    </div>
  )
}

function Hit({ title, meta, kind, url, initials, onClick }: { title: string; meta: string; kind: string; url: string | null; initials: string; onClick: () => void }) {
  return (
    <Clickable focusScale={1.02} onClick={onClick}>
      <div className="row" style={{ padding: 10 }}>
        <Artwork url={url} initials={initials} fontSize={14} radius={6} style={{ width: 48, height: 72 }} />
        <div style={{ width: 12 }} />
        <div className="col grow">
          <div className="ellipsis" style={{ color: C.Text, fontWeight: 600, fontSize: 15 }}>{title}</div>
          <div style={{ height: 4 }} />
          <div className="row">
            <Badge text={kind} />
            {meta !== '' && <><div style={{ width: 8 }} /><span className="ellipsis" style={{ color: C.Text2, fontSize: 12 }}>{meta}</span></>}
          </div>
        </div>
      </div>
    </Clickable>
  )
}
