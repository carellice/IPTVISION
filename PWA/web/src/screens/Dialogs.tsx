import { useMemo, useState } from 'react'
import type { Movie, Series } from '../../../shared/model.ts'
import * as quiz from '../../../shared/quiz.ts'
import { qualityOf } from '../../../shared/text.ts'
import { Artwork, Badge, Clickable, Dialog, Pill, Spinner } from '../components/ui.tsx'
import { app, closeVariants, openMovie, openPick, openSeries, progress, recommend, useApp } from '../lib/app.ts'

// VariantDialog (ui/Browse.kt) and QuizDialog (ui/Quiz.kt).

const card = { borderRadius: 18, background: 'var(--panel)', padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%' } as const

/** A title published more than once: choose which version to open (quality read from the name). */
export function VariantDialog() {
  useApp()
  const choice = app.variantChoice
  const opts = choice?.kind === 'Films'
    ? choice.items.map((m: Movie) => ({ key: m.key, name: m.name, quality: qualityOf(m.name), meta: m.meta, url: m.poster, initials: m.initials, progress: progress(m.key), open: () => { closeVariants(); openMovie(m) } }))
    : choice?.kind === 'Shows'
      ? choice.items.map((s: Series) => ({ key: s.key, name: s.name, quality: qualityOf(s.name), meta: s.meta, url: s.cover, initials: s.initials, progress: 0, open: () => { closeVariants(); openSeries(s) } }))
      : []
  return (
    <Dialog open={choice != null} onDismiss={() => history.back()}>
      <div style={card}>
        <div style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>Scegli la versione</div>
        <div className="ellipsis" style={{ color: 'var(--text2)', fontSize: 13 }}>{choice?.title}</div>
        <div style={{ height: 12 }} />
        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 4 }}>
          {opts.map((o, i) => (
            <Clickable key={o.key} onClick={o.open} style={{ display: 'flex', alignItems: 'center', padding: 10, flexShrink: 0 }}>
              <Artwork url={o.url} initials={o.initials} fontSize={12} style={{ width: 44, aspectRatio: '2 / 3', borderRadius: 6 }} />
              <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge text={o.quality ?? `Versione ${i + 1}`} color="var(--accentSoft)" />
                  {o.progress > 0 && o.progress < 1 && <Badge text="Iniziato" />}
                  {o.progress >= 1 && <Badge text="Visto" color="var(--accent)" />}
                </div>
                <div style={{ height: 4 }} />
                <div className="clamp2" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>{o.name}</div>
                {o.meta && <div className="ellipsis" style={{ color: 'var(--text3)', fontSize: 12 }}>{o.meta}</div>}
              </div>
            </Clickable>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

/** "Cosa guardo?": multiple choice questions, then a few films or series to choose from. */
export function QuizDialog() {
  useApp()
  const open = app.quizOpen
  return (
    <Dialog open={open} onDismiss={() => history.back()}>
      {open && <QuizBody />}
    </Dialog>
  )
}

function QuizBody() {
  const [step, setStep] = useState(0)
  const [round, setRound] = useState(0) // "Altri consigli": a new draw
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const done = step >= quiz.questions.length
  const loading = done && (app.moviesLoading || app.seriesLoading)
  const result = useMemo(() => (done && !loading ? recommend(answers) : null), [done, round, loading, app.movies, app.series])
  return (
    <div style={card}>
      <div style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>Cosa guardo?</div>
      <div style={{ color: 'var(--text2)', fontSize: 13 }}>{done ? 'I nostri consigli' : `Domanda ${step + 1} di ${quiz.questions.length}`}</div>
      <div style={{ height: 14 }} />
      {!done ? (
        <>
          <div style={{ color: 'var(--text)', fontSize: 17, fontWeight: 600 }}>{quiz.questions[step].text}</div>
          <div style={{ height: 10 }} />
          <div key={step} className="scroll" style={{ maxHeight: 420, display: 'flex', flexDirection: 'column', gap: 6, padding: 4 }}>
            {quiz.questions[step].options.map((o) => (
              <Clickable key={o.value} onClick={() => { setAnswers({ ...answers, [quiz.questions[step].key]: o.value }); setStep(step + 1) }}
                style={{ padding: '12px 14px', flexShrink: 0 }}>
                <div style={{ color: 'var(--text)', fontSize: 15 }}>{o.label}</div>
              </Clickable>
            ))}
          </div>
        </>
      ) : loading || !result ? (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Spinner />
          <div style={{ marginLeft: 14, color: 'var(--text2)' }}>Cerco qualcosa per te…</div>
        </div>
      ) : (
        <>
          {result.note && <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 8 }}>{result.note}</div>}
          <div key={round} className="scroll" style={{ maxHeight: 400, display: 'flex', flexDirection: 'column', gap: 6, padding: 4 }}>
            {result.picks.map((p) => {
              const [poster, initials, meta, kind] = p.kind === 'film'
                ? [p.movie.poster, p.movie.initials, p.movie.meta, 'Film'] : [p.series.cover, p.series.initials, p.series.meta, 'Serie TV']
              return (
                <Clickable key={p.kind + (p.kind === 'film' ? p.movie.streamId : p.series.seriesId)} onClick={() => openPick(p)}
                  style={{ display: 'flex', alignItems: 'center', padding: 10, flexShrink: 0 }}>
                  <Artwork url={poster} initials={initials} fontSize={12} style={{ width: 44, aspectRatio: '2 / 3', borderRadius: 6 }} />
                  <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                    <div className="clamp2" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                    <div className="ellipsis" style={{ color: 'var(--text2)', fontSize: 12 }}>{[kind, meta || null].filter(Boolean).join(' · ')}</div>
                  </div>
                </Clickable>
              )
            })}
          </div>
          <div style={{ height: 12 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Pill text="Altri consigli" selected onClick={() => setRound(round + 1)} />
            <Pill text="Ricomincia" selected={false} onClick={() => { setAnswers({}); setStep(0) }} />
          </div>
        </>
      )}
    </div>
  )
}

