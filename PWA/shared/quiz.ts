// "Cosa guardo?" of data/Quiz.kt: poche domande a risposta multipla e qualche film o serie consigliati.
// Il genere si riconosce dal nome della categoria e dal genere della serie (i cataloghi Xtream
// di solito dividono i film per genere); si escludono i titoli già visti o iniziati.
import type { Category, Movie, Series } from './model.ts'
import { normalize, variantKey } from './text.ts'

export type QuizOption = { label: string; value: string }
export type QuizQuestion = { key: string; text: string; options: QuizOption[] }

const o = (label: string, value: string): QuizOption => ({ label, value })

export const questions: QuizQuestion[] = [
  { key: 'type', text: 'Cosa ti va di guardare?', options: [o('Un film', 'movie'), o('Una serie TV', 'series'), o('Fa lo stesso', 'any')] },
  {
    key: 'mood', text: 'Che emozioni cerchi?', options: [
      o('Ridere', 'comedy'), o('Azione e adrenalina', 'action'), o('Paura e brividi', 'horror'), o('Emozioni e amore', 'drama'),
      o('Fantascienza e fantasy', 'fantasy'), o('Gialli, crimini e storie vere', 'crime'), o('Animazione e famiglia', 'family'), o('Sorprendimi', 'any'),
    ],
  },
  { key: 'period', text: 'Di che periodo?', options: [o('Uscito di recente', 'recent'), o('Anni 2000 e 2010', '2000s'), o('Un classico', 'classic'), o('Fa lo stesso', 'any')] },
  { key: 'rating', text: 'Vuoi andare sul sicuro?', options: [o('Sì, solo titoli molto votati', 'top'), o('Fa lo stesso', 'any')] },
]

/** Parole (già normalizzate) che riconoscono il genere nel nome della categoria o nel genere. */
const moodWords: Record<string, string[]> = {
  comedy: ['commedi', 'comed', 'comic', 'umor', 'sitcom', 'parodi'],
  action: ['azion', 'action', 'avventur', 'adventur', 'thriller', 'guerra', 'war', 'western', 'spionag', 'marzial', 'martial'],
  horror: ['horror', 'terror', 'paura', 'brivid', 'zombi', 'slasher', 'soprannatural', 'supernatural'],
  drama: ['dramm', 'drama', 'romant', 'romanc', 'amore', 'love', 'sentiment'],
  fantasy: ['fantasy', 'fantasc', 'sci fi', 'scifi', 'science fiction', 'fantastic', 'supereroi', 'superhero', 'marvel'],
  crime: ['crime', 'crimin', 'giall', 'poliz', 'mister', 'myster', 'document', 'docu', 'biograf', 'true story', 'storic'],
  family: ['animaz', 'animat', 'cartoon', 'cartoni', 'bambin', 'kids', 'famigl', 'family', 'disney', 'ragazz'],
}

/** Un consiglio: un film oppure una serie. */
export type Pick = { kind: 'film'; movie: Movie; name: string } | { kind: 'show'; series: Series; name: string }

export type QuizResult = { picks: Pick[]; note: string | null }

type Candidate = { pick: Pick; text: string; year: number; rating: number }

const yearOf = (y: string | null) => (y ? Number.parseInt(y.slice(0, 4), 10) || 0 : 0)

export function recommend(
  answers: Record<string, string>,
  movies: Movie[], movieCats: Category[],
  series: Series[], seriesCats: Category[],
  isNew: (p: Pick) => boolean,
  rnd: () => number = Math.random,
): QuizResult {
  const type = answers.type ?? 'any'
  const mood = answers.mood ?? 'any'
  const period = answers.period ?? 'any'
  const top = answers.rating === 'top'
  const vodNames = new Map(movieCats.map((c) => [c.id, c.name]))
  const seriesNames = new Map(seriesCats.map((c) => [c.id, c.name]))

  const pool: Candidate[] = []
  if (type !== 'series') for (const m of movies) {
    const p: Pick = { kind: 'film', movie: m, name: m.name }
    if (isNew(p)) pool.push({ pick: p, text: normalize(vodNames.get(m.categoryId ?? '') ?? ''), year: yearOf(m.year), rating: m.rating })
  }
  if (type !== 'movie') for (const s of series) {
    const p: Pick = { kind: 'show', series: s, name: s.name }
    if (isNew(p)) pool.push({ pick: p, text: normalize(`${seriesNames.get(s.categoryId ?? '') ?? ''} ${s.genre ?? ''}`), year: yearOf(s.year), rating: s.rating })
  }
  if (pool.length === 0) return { picks: [], note: 'Il catalogo non è ancora disponibile: riprova tra poco.' }

  const now = new Date().getFullYear()
  const maxRating = pool.reduce((m, c) => Math.max(m, c.rating), -Infinity)
  const moodOk = (c: Candidate) => mood === 'any' || (moodWords[mood] ?? []).some((w) => c.text.includes(w))
  const periodOk = (c: Candidate) => {
    if (period === 'recent') return c.year >= now - 3
    if (period === '2000s') return c.year >= 2000 && c.year < now - 3
    if (period === 'classic') return c.year >= 1901 && c.year <= 1999
    return true
  }
  const ratingOk = (c: Candidate) => !top || maxRating <= 0 || c.rating >= maxRating * 0.7

  // Se nessun titolo soddisfa tutte le risposte si rinuncia prima al voto, poi al periodo, poi al genere.
  let note: string | null = null
  let picks = pool.filter((c) => moodOk(c) && periodOk(c) && ratingOk(c))
  if (picks.length === 0) { picks = pool.filter((c) => moodOk(c) && periodOk(c)); note = 'Nessun titolo con tutte le risposte: ecco i più vicini.' }
  if (picks.length === 0) picks = pool.filter(moodOk)
  if (picks.length === 0) { picks = pool; note = 'Nel catalogo non ho trovato quel genere: ecco qualcosa da scoprire.' }

  // Un po' di caso, ma i titoli più votati hanno più probabilità di uscire.
  const scored = picks
    .map((c) => ({ c, s: (c.rating > 0 ? c.rating : maxRating * 0.4) * (0.5 + rnd()) }))
    .sort((a, b) => b.s - a.s)
  const seen = new Set<string>()
  const chosen: Pick[] = []
  for (const { c } of scored) {
    if (chosen.length >= 6) break
    const k = variantKey(c.pick.name)
    if (seen.has(k)) continue
    seen.add(k)
    chosen.push(c.pick)
  }
  return { picks: chosen, note }
}
