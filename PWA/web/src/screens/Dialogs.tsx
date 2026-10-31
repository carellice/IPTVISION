// VariantDialog di ui/Browse.kt e QuizDialog di ui/Quiz.kt.
import { useEffect, useMemo, useState } from 'react'
import * as Quiz from '../../../shared/quiz.ts'
import { qualityOf } from '../../../shared/text.ts'
import { useVm } from '../lib/app.ts'
import { Artwork, Badge, C, Clickable, Dialog, Pill, Spinner } from '../components/ui.tsx'

/** Titolo pubblicato più volte: si sceglie quale versione aprire (qualità letta dal nome). */
export function VariantDialog() {
  const vm = useVm()
  const choice = vm.variantChoice
  const [last, setLast] = useState(choice)
  useEffect(() => { if (choice) setLast(choice) }, [choice])
  const c = choice ?? last
  type Opt = { key: string; name: string; quality: string | null; meta: string; url: string | null; initials: string; progress: number; open: () => void }
  const opts: Opt[] = !c ? [] : c.kind === 'Films'
    ? c.items.map((m) => ({ key: m.key, name: m.name, quality: qualityOf(m.name), meta: m.meta, url: m.poster, initials: m.initials, progress: vm.progress(m.key), open: () => { vm.variantChoice = null; vm.openMovie(m) } }))
    : c.items.map((s) => ({ key: s.key, name: s.name, quality: qualityOf(s.name), meta: s.meta, url: s.cover, initials: s.initials, progress: 0, open: () => { vm.variantChoice = null; vm.openSeries(s) } }))
  return (
    <Dialog open={choice != null} onDismiss={() => { vm.variantChoice = null; vm.emit() }}>
      <div className="col" style={{ background: C.Panel, borderRadius: 18, padding: 20, minHeight: 0 }}>
        <div style={{ color: C.Text, fontSize: 20, fontWeight: 700 }}>Scegli la versione</div>
        <div className="ellipsis" style={{ color: C.Text2, fontSize: 13 }}>{c?.title}</div>
        <div style={{ height: 12 }} />
        <div className="scroll col" style={{ gap: 6, padding: 4, minHeight: 0 }}>
          {opts.map((o, i) => (
            <div key={o.key} style={{ flex: 'none' }}>
              <Clickable focusScale={1.02} onClick={o.open}>
                <div className="row" style={{ padding: 10 }}>
                  <Artwork url={o.url} initials={o.initials} fontSize={12} radius={6} style={{ width: 44, aspectRatio: '2 / 3' }} />
                  <div style={{ width: 12 }} />
                  <div className="col grow">
                    <div className="row" style={{ gap: 6 }}>
                      <Badge text={o.quality ?? `Versione ${i + 1}`} color={C.AccentSoft} />
                      {o.progress > 0 && o.progress < 1 && <Badge text="Iniziato" />}
                      {o.progress >= 1 && <Badge text="Visto" color={C.Accent} />}
                    </div>
                    <div style={{ height: 4 }} />
                    <div className="clamp2" style={{ color: C.Text, fontWeight: 600, fontSize: 14 }}>{o.name}</div>
                    {o.meta !== '' && <div className="ellipsis" style={{ color: C.Text3, fontSize: 12 }}>{o.meta}</div>}
                  </div>
                </div>
              </Clickable>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

/** "Cosa guardo?": domande a risposta multipla, poi qualche film o serie da scegliere. */
export function QuizDialog() {
  const vm = useVm()
  const [step, setStep] = useState(0)
  const [round, setRound] = useState(0) // "Altri consigli": nuova estrazione
  const [answers, setAnswers] = useState<Record<string, string>>({})
  useEffect(() => { if (vm.quizOpen) { setStep(0); setAnswers({}) } }, [vm.quizOpen])
  const done = step >= Quiz.questions.length
  const loading = done && (vm.moviesLoading || vm.seriesLoading)
  const result = useMemo(() => (done && !loading ? vm.recommend(answers) : null), [done, loading, round, vm.movies, vm.series])

  return (
    <Dialog open={vm.quizOpen} onDismiss={() => { vm.quizOpen = false; vm.emit() }}>
      <div className="col" style={{ background: C.Panel, borderRadius: 18, padding: 20, minHeight: 0 }}>
        <div style={{ color: C.Text, fontSize: 20, fontWeight: 700 }}>Cosa guardo?</div>
        <div style={{ color: C.Text2, fontSize: 13 }}>{done ? 'I nostri consigli' : `Domanda ${step + 1} di ${Quiz.questions.length}`}</div>
        <div style={{ height: 14 }} />
        {!done ? (
          <>
            <div style={{ color: C.Text, fontSize: 17, fontWeight: 600 }}>{Quiz.questions[step].text}</div>
            <div style={{ height: 10 }} />
            <div key={step} className="scroll col" style={{ maxHeight: 420, gap: 6, padding: 4 }}>
              {Quiz.questions[step].options.map((o) => (
                <div key={o.value} style={{ flex: 'none' }}>
                  <Clickable focusScale={1.02} onClick={() => { setAnswers({ ...answers, [Quiz.questions[step].key]: o.value }); setStep(step + 1) }}>
                    <div style={{ color: C.Text, fontSize: 15, padding: '12px 14px' }}>{o.label}</div>
                  </Clickable>
                </div>
              ))}
            </div>
          </>
        ) : loading || !result ? (
          <div className="row">
            <Spinner />
            <div style={{ width: 14 }} />
            <span style={{ color: C.Text2 }}>Cerco qualcosa per te…</span>
          </div>
        ) : (
          <>
            {result.note && <><div style={{ color: C.Text2, fontSize: 13 }}>{result.note}</div><div style={{ height: 8 }} /></>}
            <div key={round} className="scroll col" style={{ maxHeight: 400, gap: 6, padding: 4, minHeight: 0 }}>
              {result.picks.map((p) => {
                const [poster, initials, meta, kind] = p.kind === 'film'
                  ? [p.movie.poster, p.movie.initials, p.movie.meta, 'Film']
                  : [p.series.cover, p.series.initials, p.series.meta, 'Serie TV']
                return (
                  <div key={p.kind === 'film' ? p.movie.key : p.series.key} style={{ flex: 'none' }}>
                    <Clickable focusScale={1.02} onClick={() => vm.openPick(p)}>
                      <div className="row" style={{ padding: 10 }}>
                        <Artwork url={poster} initials={initials} fontSize={12} radius={6} style={{ width: 44, aspectRatio: '2 / 3' }} />
                        <div style={{ width: 12 }} />
                        <div className="col grow">
                          <div className="clamp2" style={{ color: C.Text, fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                          <div className="ellipsis" style={{ color: C.Text2, fontSize: 12 }}>{[kind, meta].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </Clickable>
                  </div>
                )
              })}
            </div>
            <div style={{ height: 12 }} />
            <div className="row" style={{ gap: 8 }}>
              <Pill text="Altri consigli" selected onClick={() => setRound(round + 1)} />
              <Pill text="Ricomincia" selected={false} onClick={() => { setAnswers({}); setStep(0) }} />
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
