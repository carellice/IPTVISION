import type { Category, Movie, Series } from './model.ts'
import { normalize, variantKey } from './text.ts'

// "Cosa guardo?" (data/Quiz.kt): a few multiple choice questions and some films or series.
// Same questions and same rules as the Windows, Android and TV versions.

export type Option = { label: string; value: string }
export type Question = { key: string; text: string; options: Option[] }

export const questions: Question[] = [
  { key: 'type', text: 'Cosa ti va di guardare?', options: [
    { label: 'Un film', value: 'movie' },
    { label: 'Una serie TV', value: 'series' },
    { label: 'Fa lo stesso', value: 'any' },
  ] },
  { key: 'mood', text: 'Che emozioni cerchi?', options: [
    { label: 'Ridere', value: 'comedy' },
    { label: 'Azione e adrenalina', value: 'action' },
    { label: 'Paura e brividi', value: 'horror' },
    { label: 'Emozioni e amore', value: 'drama' },
    { label: 'Fantascienza e fantasy', value: 'fantasy' },
    { label: 'Gialli, crimini e storie vere', value: 'crime' },
    { label: 'Animazione e famiglia', value: 'family' },
    { label: 'Sorprendimi', value: 'any' },
  ] },
  { key: 'period', text: 'Di che periodo?', options: [
    { label: 'Uscito di recente', value: 'recent' },
    { label: 'Anni 2000 e 2010', value: '2000s' },
    { label: 'Un classico', value: 'classic' },
    { label: 'Fa lo stesso', value: 'any' },
  ] },
  { key: 'rating', text: 'Vuoi andare sul sicuro?', options: [
    { label: 'Sì, solo titoli molto votati', value: 'top' },
    { label: 'Fa lo stesso', value: 'any' },
  ] },
]

/** Words (already normalized) that recognize the genre in the category name or in the genre. */
const moodWords: Record<string, string[]> = {
  comedy: ['commedi', 'comed', 'comic', 'umor', 'sitcom', 'parodi'],
  action: ['azion', 'action', 'avventur', 'adventur', 'thriller', 'guerra', 'war', 'western', 'spionag', 'marzial', 'martial'],
  horror: ['horror', 'terror', 'paura', 'brivid', 'zombi', 'slasher', 'soprannatural', 'supernatural'],
  drama: ['dramm', 'drama', 'romant', 'romanc', 'amore', 'love', 'sentiment'],
  fantasy: ['fantasy', 'fantasc', 'sci fi', 'scifi', 'science fiction', 'fantastic', 'supereroi', 'superhero', 'marvel'],
  crime: ['crime', 'crimin', 'giall', 'poliz', 'mister', 'myster', 'document', 'docu', 'biograf', 'true story', 'storic'],
  family: ['animaz', 'animat', 'cartoon', 'cartoni', 'bambin', 'kids', 'famigl', 'family', 'disney', 'ragazz'],
}

export type Pick = { kind: 'film'; movie: Movie; name: string } | { kind: 'show'; series: Series; name: string }

export type Result = { picks: Pick[]; note: string | null }

type Candidate = { pick: Pick; text: string; year: number; rating: number }

const yearOf = (y: string | null) => {
  const n = parseInt((y ?? '').slice(0, 4), 10)
  return Number.isNaN(n) ? 0 : n
}

export function recommend(
  answers: Record<string, string>,
  movies: Movie[], movieCats: Category[],
  series: Series[], seriesCats: Category[],
  isNew: (p: Pick) => boolean,
  rnd: () => number = Math.random,
): Result {
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
  const maxRating = Math.max(...pool.map((c) => c.rating))
  const moodOk = (c: Candidate) => mood === 'any' || (moodWords[mood] ?? []).some((w) => c.text.includes(w))
  const periodOk = (c: Candidate) => {
    switch (period) {
      case 'recent': return c.year >= now - 3
      case '2000s': return c.year >= 2000 && c.year < now - 3
      case 'classic': return c.year >= 1901 && c.year <= 1999
      default: return true
    }
  }
  const ratingOk = (c: Candidate) => !top || maxRating <= 0 || c.rating >= maxRating * 0.7

  // If no title meets every answer, first the rating goes, then the period, then the genre.
  let note: string | null = null
  let picks = pool.filter((c) => moodOk(c) && periodOk(c) && ratingOk(c))
  if (picks.length === 0) { picks = pool.filter((c) => moodOk(c) && periodOk(c)); note = 'Nessun titolo con tutte le risposte: ecco i più vicini.' }
  if (picks.length === 0) picks = pool.filter(moodOk)
  if (picks.length === 0) { picks = pool; note = 'Nel catalogo non ho trovato quel genere: ecco qualcosa da scoprire.' }

  // A bit of chance, but the best rated titles are more likely to come out.
  const scored = picks.map((c) => [c, (c.rating > 0 ? c.rating : maxRating * 0.4) * (0.5 + rnd())] as const)
  scored.sort((a, b) => b[1] - a[1])
  const seen = new Set<string>()
  const chosen: Pick[] = []
  for (const [c] of scored) {
    const k = variantKey(c.pick.name)
    if (seen.has(k)) continue
    seen.add(k)
    chosen.push(c.pick)
    if (chosen.length === 6) break
  }
  return { picks: chosen, note }
}
