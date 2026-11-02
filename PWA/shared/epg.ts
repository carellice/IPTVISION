import type { Channel, Programme } from './model.ts'
import { clock } from './text.ts'

// Now/next of the guide (data/Epg.kt).

export function progressAt(p: Programme, nowSec: number): number {
  const total = p.stop - p.start
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, (nowSec - p.start) / total))
}

export const timeRange = (p: Programme) => `${clock(p.start)} – ${clock(p.stop)}`

export function nowNext(list: Programme[] | undefined, nowSec: number): [Programme | null, Programme | null] {
  if (!list) return [null, null]
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    if (p.start <= nowSec && p.stop > nowSec) return [p, list[i + 1] ?? null]
    if (p.start > nowSec) return [null, p]
  }
  return [null, null]
}

/** The guide of a channel: xmltv by epg id, else the short EPG asked for that stream. */
export function listFor(
  ch: Channel,
  byEpgId: Record<string, Programme[]>,
  short: Record<number, Programme[]>,
): Programme[] | undefined {
  if (ch.epgId) {
    const l = byEpgId[ch.epgId.toLowerCase()]
    if (l && l.length) return l
  }
  return short[ch.streamId]
}
