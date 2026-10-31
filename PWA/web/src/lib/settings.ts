// Settings of data/Store.kt that belong to the device (SharedPreferences on the phone): kept in
// localStorage per PWA account. The IPTV login, favorites and positions live on the server instead.

export type DeviceSettings = {
  /** "ts" (MPEG-TS) oppure "m3u8" (HLS). */
  outputFormat: 'ts' | 'm3u8'
  autoPlayLastChannel: boolean
  autoCheckUpdates: boolean
  /** Nasconde le categorie con "XXX" nel nome (canali, film e serie). */
  hideAdult: boolean
  /** Diretta passata da ffmpeg con l'audio in AAC: l'audio MP2/AC3 del digitale nel browser non si sente. */
  convertLiveAudio: boolean
  lastStreamId: number | null
  lastCategoryId: string | null
  sorts: Record<string, string>
  grids: Record<string, boolean>
}

const defaults: DeviceSettings = {
  outputFormat: 'ts',
  autoPlayLastChannel: false,
  autoCheckUpdates: true,
  hideAdult: false,
  convertLiveAudio: true,
  lastStreamId: null,
  lastCategoryId: null,
  sorts: {},
  grids: {},
}

let user = ''
const storageKey = () => `iptvision.settings.${user.toLowerCase()}`

export function loadSettings(username: string): DeviceSettings {
  user = username
  try {
    const raw = localStorage.getItem(storageKey())
    return { ...defaults, ...(raw ? JSON.parse(raw) : {}) }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(s: DeviceSettings) {
  try { localStorage.setItem(storageKey(), JSON.stringify(s)) } catch { /* private mode */ }
}

/** Griglia o elenco per una sezione; senza scelta: griglia per film e serie, elenco per i canali. */
export const isGridDefault = (section: string) => section !== 'Live'
