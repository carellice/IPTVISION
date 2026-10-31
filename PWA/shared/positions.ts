// PositionStore of data/Store.kt: where films and episodes were left, which were watched and the
// last episode opened of each series. Keys: "m:{id}" films, "e:{id}" episodes. The server keeps the
// account's copy in SQLite; the browser keeps the same object to draw the lists.

export type PositionEntry = { p: number; d: number; u: number }

/** Same JSON as positions.json on the phone. */
export type PositionsData = {
  positions: Record<string, PositionEntry>
  watched: string[]
  lastEpisode: Record<string, { id: string; u: number }>
}

export const emptyPositions = (): PositionsData => ({ positions: {}, watched: [], lastEpisode: {} })

/** Da dove riprendere (0 = dall'inizio). Non riprende i primi 30 s né gli ultimi 90 s. */
export function resumeMs(data: PositionsData, key: string): number {
  const e = data.positions[key]
  if (!e) return 0
  return e.p > 30_000 && (e.d <= 0 || e.d - e.p > 90_000) ? e.p : 0
}

export function progress(data: PositionsData, key: string): number {
  if (data.watched.includes(key)) return 1
  const e = data.positions[key]
  if (!e) return 0
  return e.d > 0 ? Math.min(0.99, Math.max(0, e.p / e.d)) : 0
}

export const isWatched = (data: PositionsData, key: string) => data.watched.includes(key)
export const updatedAt = (data: PositionsData, key: string) => data.positions[key]?.u ?? null

export function markWatched(data: PositionsData, key: string) {
  delete data.positions[key]
  if (!data.watched.includes(key)) data.watched.push(key)
}

/** Aggiorna la posizione. Restituisce true se il contenuto risulta finito. */
export function update(data: PositionsData, key: string, positionMs: number, durationMs: number, now = Date.now()): boolean {
  if (durationMs <= 0 || positionMs <= 0) return false
  if (positionMs >= durationMs * 0.95 || durationMs - positionMs < 90_000) {
    markWatched(data, key)
    return true
  }
  if (positionMs < 30_000) return false
  data.positions[key] = { p: Math.round(positionMs), d: Math.round(durationMs), u: now }
  data.watched = data.watched.filter((k) => k !== key)
  return false
}

export function setLastEpisode(data: PositionsData, seriesId: number, episodeId: string, now = Date.now()) {
  data.lastEpisode[String(seriesId)] = { id: episodeId, u: now }
}

export function lastEpisode(data: PositionsData, seriesId: number): { id: string; u: number } | null {
  return data.lastEpisode[String(seriesId)] ?? null
}

/** Toglie un film da "Continua a guardare": dimentica il punto raggiunto. */
export function forgetPosition(data: PositionsData, key: string) {
  delete data.positions[key]
}

/** Toglie una serie da "Continua a guardare". Gli episodi restano segnati come visti. */
export function forgetSeries(data: PositionsData, seriesId: number) {
  delete data.lastEpisode[String(seriesId)]
}

/** Si tengono le 600 posizioni più recenti, come sul telefono. */
export const MAX_POSITIONS = 600
