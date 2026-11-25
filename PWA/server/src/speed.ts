import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { USER_AGENT } from './xtream.ts'

// Quick speed test before a live channel starts, to pick the quality the connection can carry.
// The server measures its own way out to the Internet (the one the streams take from the provider);
// the apps measure the way from the server to them with /api/speedtest/down.

const TEST_URL = 'https://speed.cloudflare.com/__down?bytes=50000000'
const TEST_MS = 1500

/** Mb/s of a download, counted from the first byte and stopped after [TEST_MS]. */
async function measure(): Promise<number | null> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), TEST_MS + 3000)
  try {
    const res = await fetch(TEST_URL, { signal: stop.signal, headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    let start = 0
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!start) start = performance.now()
      else bytes += value.length
      if (performance.now() - start > TEST_MS) break
    }
    stop.abort()
    const seconds = (performance.now() - start) / 1000
    return start && seconds > 0.05 ? Math.round((bytes * 8) / seconds / 1e5) / 10 : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

let cached: { mbps: number | null; at: number } | null = null
let pending: Promise<number | null> | null = null

/** The server's Internet speed in Mb/s, measured at most every 30 seconds whatever the number of devices. */
export function serverSpeed(): Promise<number | null> {
  if (cached && Date.now() - cached.at < 30_000) return Promise.resolve(cached.mbps)
  pending ??= measure().then((mbps) => { cached = { mbps, at: Date.now() }; return mbps }).finally(() => { pending = null })
  return pending
}

const CHUNK = randomBytes(256 * 1024)
const MAX_BYTES = 64 * 1024 * 1024

/** [bytes] of noise for the apps to time the way from the server to them. */
export function sendNoise(res: ServerResponse, bytes: number) {
  let left = Math.min(Math.max(bytes, 1), MAX_BYTES)
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': left, 'Cache-Control': 'no-store' })
  const write = () => {
    while (left > 0) {
      const part = left >= CHUNK.length ? CHUNK : CHUNK.subarray(0, left)
      left -= part.length
      if (!res.write(part)) return void res.once('drain', write)
    }
    res.end()
  }
  res.on('close', () => { left = 0 })
  write()
}
