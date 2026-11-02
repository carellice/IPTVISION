import { USER_AGENT } from './xtream.ts'

// The network the server goes out to the Internet with, so the apps can show whether the home
// server is behind the VPN. The check runs from inside the container: it is the same route the
// IPTV lists and streams take. NordVPN's own endpoint also says whether the address is one of
// its servers; if it doesn't answer, a generic service gives at least address and country.

export type NetworkInfo = {
  ip: string | null
  country: string | null
  countryCode: string | null
  city: string | null
  isp: string | null
  /** true behind NordVPN, false on the home connection, null when it can't be told. */
  vpn: boolean | null
  /** Ready to show: "VPN attiva · Svizzera · 185.1.2.3". */
  label: string
  checkedAt: number
}

const countries = new Intl.DisplayNames(['it'], { type: 'region' })

function countryName(code: string | null, fallback: string | null): string | null {
  if (code && /^[A-Z]{2}$/i.test(code)) {
    try { return countries.of(code.toUpperCase()) ?? fallback } catch { /* unknown code */ }
  }
  return fallback
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as Record<string, unknown>
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

async function lookup(): Promise<Omit<NetworkInfo, 'label' | 'checkedAt'>> {
  try {
    const o = await getJson('https://api.nordvpn.com/v1/helpers/ips/insights')
    const code = str(o.country_code)
    return {
      ip: str(o.ip), countryCode: code, country: countryName(code, str(o.country)), city: str(o.city), isp: str(o.isp),
      vpn: typeof o.protected === 'boolean' ? o.protected : null,
    }
  } catch {
    const o = await getJson('https://ipwho.is/?fields=ip,success,country,country_code,city,connection')
    if (o.success === false) throw new Error('Servizio non disponibile')
    const code = str(o.country_code)
    const conn = (o.connection ?? {}) as Record<string, unknown>
    return { ip: str(o.ip), countryCode: code, country: countryName(code, str(o.country)), city: str(o.city), isp: str(conn.isp), vpn: null }
  }
}

function label(n: Omit<NetworkInfo, 'label' | 'checkedAt'>): string {
  const place = [n.country, n.ip].filter(Boolean).join(' · ')
  if (n.vpn === true) return `VPN attiva · ${place}`
  if (n.vpn === false) return `VPN non attiva · ${place}`
  return [place, n.isp].filter(Boolean).join(' · ')
}

let cached: NetworkInfo | null = null
let pending: Promise<NetworkInfo> | null = null

/** Asked at most once a minute, whatever the number of devices. */
export function networkInfo(): Promise<NetworkInfo> {
  if (cached && Date.now() - cached.checkedAt < 60_000) return Promise.resolve(cached)
  pending ??= lookup()
    .then((n) => (cached = { ...n, label: label(n), checkedAt: Date.now() }))
    .catch(() => (cached = {
      ip: null, country: null, countryCode: null, city: null, isp: null, vpn: null,
      label: 'Il server non raggiunge Internet', checkedAt: Date.now(),
    }))
    .finally(() => { pending = null })
  return pending
}
