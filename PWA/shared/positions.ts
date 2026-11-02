import type { Op, PositionEntry } from './model.ts'

// PositionStore of the native apps (data/Store.kt): where films and episodes were left, which were
// watched and the last episode opened of each series. Keys: "m:{id}" films, "e:{id}" episodes.

export type Positions = {
  positions: Record<string, PositionEntry>
  watched: Set<string>
  lastEpisode: Record<string, { id: string; u: number }>
}

/** Where to resume from (0 = from the start). Never the first 30 s nor the last 90 s. */
export function resumeMs(s: Positions, key: string): number {
  const e = s.positions[key]
  if (!e) return 0
  return e.p > 30_000 && (e.d <= 0 || e.d - e.p > 90_000) ? e.p : 0
}

export function progress(s: Positions, key: string): number {
  if (s.watched.has(key)) return 1
  const e = s.positions[key]
  return e && e.d > 0 ? Math.min(0.99, Math.max(0, e.p / e.d)) : 0
}

/** The rule of PositionStore.update: what a reached position becomes (null = nothing to record). */
export function positionOp(key: string, p: number, d: number): Op | null {
  if (d <= 0 || p <= 0) return null
  if (p >= d * 0.95 || d - p < 90_000) return { op: 'watched', key }
  if (p < 30_000) return null
  return { op: 'position', key, p: Math.round(p), d: Math.round(d) }
}

export const MAX_POSITIONS = 600
