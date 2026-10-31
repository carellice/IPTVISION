// Ricerca vocale: sul telefono era RecognizerIntent di Google in italiano; nel browser la Web Speech API
// (Chrome su Android e su PC, Safari, Edge). Dove non c'è, lo stesso avviso dell'app.
import { toast } from '../components/ui.tsx'

type Recognition = {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
}

export function startVoice(onText: (text: string) => void) {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) {
    toast('Ricerca vocale non disponibile su questo dispositivo')
    return
  }
  const r = new Ctor()
  r.lang = 'it-IT'
  r.interimResults = false
  r.maxAlternatives = 1
  r.continuous = false
  r.onresult = (e) => {
    const text = e.results[0]?.[0]?.transcript?.trim()
    if (text) onText(text)
  }
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Consenti il microfono al browser per la ricerca vocale', true)
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Ricerca vocale non disponibile su questo dispositivo')
  }
  try {
    r.start()
    toast('Cosa vuoi guardare?')
  } catch {
    toast('Ricerca vocale non disponibile su questo dispositivo')
  }
}
