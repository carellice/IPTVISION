import { useMemo } from 'react'
import { hasVariants, initials, joinMeta, variantsText } from '../../../shared/text.ts'
import { Artwork, Badge, Clickable, Empty, Icon, IconButton, Pill, SectionTitle, TextField, toast } from '../components/ui.tsx'
import { app, changeScope, openCategoryHit, openMovieEntry, openQuiz, openSeriesEntry, search, setQuery, useApp } from '../lib/app.ts'
import { type SearchScope, scopeLabel } from '../lib/library.ts'
import { ChannelRow } from './Browse.tsx'

// SearchSection: one search for channels, films and series together.

const placeholders: Record<SearchScope, string> = {
  Channels: 'Nome del canale', Movies: 'Titolo del film', Series: 'Titolo della serie', All: 'Nome del canale, del film o della serie',
}

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void; start: () => void }

/** Voice search: RecognizerIntent with it-IT on the phone, the Web Speech API here. */
function voiceSearch() {
  const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
  if (!Ctor) { toast('Ricerca vocale non disponibile su questo dispositivo'); return }
  try {
    const r = new Ctor()
    r.lang = 'it-IT'
    r.interimResults = false
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript; if (t) setQuery(t) }
    r.onerror = () => toast('Ricerca vocale non disponibile su questo dispositivo')
    r.start()
    toast('Cosa vuoi guardare?')
  } catch {
    toast('Ricerca vocale non disponibile su questo dispositivo')
  }
}

export function SearchSection() {
  useApp()
  const q = app.searchQuery
  const scope = app.searchScope
  const results = useMemo(() => search(q, scope), [q, scope, app.live, app.movies, app.series])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <SectionTitle title="Cerca" subtitle={q.trim() === '' ? 'Canali, film e serie insieme' : `${results.total} risultati`} />
      <div style={{ height: 12 }} />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <TextField value={q} onChange={setQuery} placeholder={placeholders[scope]} type="search" inputMode="search" radius={14} style={{ flex: 1, minWidth: 0 }}
          onDone={() => (document.activeElement as HTMLElement | null)?.blur()}
          leading={<Icon name="search" color="var(--text2)" />}
          trailing={q ? <IconButton icon="close" title="Cancella" color="var(--text2)" onClick={() => setQuery('')} /> : undefined} />
        <div style={{ width: 10 }} />
        <Clickable onClick={voiceSearch} radius={14} background="var(--accentSoft)" title="Ricerca vocale" style={{ padding: 16 }}>
          <Icon name="mic" color="var(--accent)" />
        </Clickable>
        <div style={{ width: 10 }} />
        <Clickable onClick={openQuiz} radius={14} background="var(--accentSoft)" title="Cosa guardo?" style={{ padding: 16 }}>
          <Icon name="lightbulb" color="var(--accent)" />
        </Clickable>
      </div>
      <div style={{ height: 10 }} />
      {/* Where to search: everything together or only channels, films or series. */}
      <div className="scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexShrink: 0 }}>
        {(Object.keys(scopeLabel) as SearchScope[]).map((s) => <Pill key={s} text={scopeLabel[s]} selected={s === scope} onClick={() => changeScope(s)} />)}
      </div>
      <div style={{ height: 8 }} />
      {(app.moviesLoading || app.seriesLoading) && scope !== 'Channels' && <div style={{ color: 'var(--text3)', fontSize: 12 }}>Carico anche film e serie…</div>}
      <div className="scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 4px' }}>
        {results.categories.length > 0 && <>
          <Header title="Categorie" count={results.categories.length} />
          {results.categories.map((c) => (
            <Hit key={`k${c.section}${c.id}`} title={c.name} kind="Categoria" url={null} initials={initials(c.name)} onClick={() => openCategoryHit(c)}
              meta={c.section === 'Movies' ? `Film · ${c.count} titoli` : c.section === 'Series' ? `Serie TV · ${c.count} serie` : `TV in diretta · ${c.count} canali`} />
          ))}
        </>}
        {results.channels.length > 0 && <>
          <Header title="Canali" count={results.channels.length} />
          {results.channels.map((ch) => <div key={`c${ch.streamId}`} style={{ flexShrink: 0 }}><ChannelRow ch={ch} playlist={results.channels} current={false} /></div>)}
        </>}
        {results.movies.length > 0 && <>
          <Header title="Film" count={results.movies.length} />
          {results.movies.map((e) => (
            <Hit key={`m${e.item.streamId}`} title={e.item.name} kind="Film" url={e.item.poster} initials={e.item.initials}
              meta={hasVariants(e) ? joinMeta(e.item.meta, variantsText(e)) : e.item.meta} onClick={() => openMovieEntry(e)} />
          ))}
        </>}
        {results.series.length > 0 && <>
          <Header title="Serie TV" count={results.series.length} />
          {results.series.map((e) => (
            <Hit key={`s${e.item.seriesId}`} title={e.item.name} kind="Serie" url={e.item.cover} initials={e.item.initials}
              meta={hasVariants(e) ? joinMeta(e.item.meta, variantsText(e)) : e.item.meta} onClick={() => openSeriesEntry(e)} />
          ))}
        </>}
        {q.trim() !== '' && results.total === 0 && !app.moviesLoading && !app.seriesLoading && <Empty text={`Nessun risultato per "${q}".`} />}
      </div>
    </div>
  )
}

function Header({ title, count }: { title: string; count: number }) {
  return <div style={{ color: 'var(--text2)', fontWeight: 600, fontSize: 13, padding: '10px 0 2px', flexShrink: 0 }}>{`${title} · ${count}`}</div>
}

function Hit({ title, meta, kind, url, initials, onClick }: { title: string; meta: string; kind: string; url: string | null; initials: string; onClick: () => void }) {
  return (
    <Clickable onClick={onClick} style={{ display: 'flex', alignItems: 'center', padding: 10, flexShrink: 0 }}>
      <Artwork url={url} initials={initials} fontSize={14} style={{ width: 48, height: 72, borderRadius: 6 }} />
      <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <div className="ellipsis" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>{title}</div>
        <div style={{ height: 4 }} />
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <Badge text={kind} />
          {meta && <div className="ellipsis" style={{ marginLeft: 8, color: 'var(--text2)', fontSize: 12 }}>{meta}</div>}
        </div>
      </div>
    </Clickable>
  )
}
