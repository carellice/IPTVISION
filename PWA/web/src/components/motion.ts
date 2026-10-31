type Spring = { type: 'spring'; stiffness: number; damping: number; mass: number }
type Tween = { type: 'tween'; duration: number; ease: [number, number, number, number] | 'linear' }

/** Compose spring(dampingRatio, stiffness) as a framer-motion transition (mass 1). */
export function spring(dampingRatio = 1, stiffness = 1500): Spring {
  return { type: 'spring', stiffness, damping: 2 * dampingRatio * Math.sqrt(stiffness), mass: 1 }
}

/** Compose FastOutSlowInEasing. */
export const fastOutSlowIn: [number, number, number, number] = [0.4, 0, 0.2, 1]

export function tween(durationMs: number, ease: [number, number, number, number] | 'linear' = fastOutSlowIn): Tween {
  return { type: 'tween', duration: durationMs / 1000, ease }
}

/** Light tick like HapticFeedbackType.ContextClick, where the browser can vibrate. */
export function haptic(long = false) {
  try { navigator.vibrate?.(long ? 25 : 8) } catch { /* not supported */ }
}
