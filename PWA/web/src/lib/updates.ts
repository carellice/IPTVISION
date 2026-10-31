// "Aggiornamenti": sul telefono si scaricava l'APK da GitHub. Qui il server si aggiorna da solo ogni
// notte; l'app nel telefono si allinea alla versione del server ricaricando la pagina.
import { api } from './api.ts'

declare const __APP_VERSION__: string
export const appVersion = __APP_VERSION__

const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** La versione del server se è più nuova di questa app, altrimenti null. */
export async function checkUpdate(): Promise<string | null> {
  const s = await api<{ version: string }>('/api/session')
  try { await (await navigator.serviceWorker?.getRegistration())?.update() } catch { /* senza service worker */ }
  return newer(s.version, appVersion) ? s.version : null
}

/** Attiva la nuova versione e ricarica. */
export async function installUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  if (reg?.waiting) {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
    reg.waiting.postMessage('skipWaiting')
    setTimeout(() => location.reload(), 3000)
  } else {
    location.reload()
  }
}
