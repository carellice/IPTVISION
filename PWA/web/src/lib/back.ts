// BackHandler di Compose: un dialogo o un pannello aperto prende per sé il gesto Indietro.
import { useEffect, useRef } from 'react'

const handlers: (() => void)[] = []
let changed = () => {}

export const setBackListener = (f: () => void) => { changed = f }
export const hasBackHandlers = () => handlers.length > 0

/** Il gestore più recente consuma l'Indietro; restituisce false se non ce n'è nessuno. */
export function consumeBack(): boolean {
  const h = handlers[handlers.length - 1]
  if (!h) return false
  h()
  return true
}

export function useBackHandler(enabled: boolean, handler: () => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    const h = () => ref.current()
    handlers.push(h)
    changed()
    return () => {
      const i = handlers.indexOf(h)
      if (i >= 0) handlers.splice(i, 1)
      changed()
    }
  }, [enabled])
}
