// Graphic style of this browser: the current one, skeuomorphic, Modern UI, Dueffe or Nothing (styles.css, html[data-skin]).
import { useSyncExternalStore } from 'react'

const KEY = 'iptvision.skin'

export type Skin = 'classic' | 'skeuo' | 'metro' | 'dueffe' | 'nothing'

export function applySkin() {
  try {
    const s = localStorage.getItem(KEY)
    if (s === 'skeuo' || s === 'metro' || s === 'dueffe' || s === 'nothing') document.documentElement.dataset.skin = s
  } catch { /* private mode */ }
}

export const getSkin = (): Skin => (document.documentElement.dataset.skin as Skin | undefined) ?? 'classic'

const listeners = new Set<() => void>()

export function setSkin(s: Skin) {
  if (s === 'classic') delete document.documentElement.dataset.skin
  else document.documentElement.dataset.skin = s
  try { localStorage.setItem(KEY, s) } catch { /* private mode */ }
  listeners.forEach((l) => l())
}

/** The skin as React state: Modern UI also changes the layout (pivot instead of the bars). */
export const useSkin = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, getSkin)
