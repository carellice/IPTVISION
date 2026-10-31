// What the server answers on /api/state: the account's IPTV login (never the password) and the
// data that follows the person from one device to the other.
import type { PositionsData } from './positions.ts'

export type XtreamAccountInfo = { server: string; username: string }

export type AppState = {
  revision: number
  account: XtreamAccountInfo | null
  favorites: number[]
  positions: PositionsData
  /** ffmpeg is installed on the server (Docker image): audio conversion and remux are possible. */
  ffmpeg: boolean
}

/** ffprobe of a film or an episode: what the browser can play as is, and the audio tracks. */
export type ProbeResult = {
  durationMs: number
  /** The browser can open the file directly (MP4/WebM with codecs it reads). */
  direct: boolean
  video: string | null
  height: number
  audios: { index: number; label: string }[]
}
