import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'

// How the home server goes out to the Internet: through the VPN or not, country and address.

type NetworkInfo = { vpn: boolean | null; label: string; ip: string | null; isp: string | null; city: string | null }

let last: NetworkInfo | null = null

function useNetwork(): NetworkInfo | null {
  const [info, setInfo] = useState(last)
  useEffect(() => {
    let alive = true
    const load = () => {
      if (document.visibilityState !== 'visible') return
      api<NetworkInfo>('/api/network').then((n) => { last = n; if (alive) setInfo(n) }).catch(() => { /* next time */ })
    }
    load()
    const t = setInterval(load, 60_000)
    document.addEventListener('visibilitychange', load)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', load) }
  }, [])
  return info
}

export const vpnColor = (vpn: boolean | null) => (vpn === true ? '#3DDC97' : vpn === false ? 'var(--danger)' : 'var(--text3)')

/** A dot (green VPN on, red VPN off) and the line from the server. */
export function NetworkStatus({ detail = false }: { detail?: boolean }) {
  const n = useNetwork()
  if (!n) return null
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: vpnColor(n.vpn), flexShrink: 0, marginTop: 8 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--text2)', fontSize: 12, lineHeight: '24px' }}>{n.label}</div>
        {detail && (n.city || n.isp) && (
          <div style={{ color: 'var(--text3)', fontSize: 12, lineHeight: '16px' }}>{[n.city, n.isp].filter(Boolean).join(' · ')}</div>
        )}
      </div>
    </div>
  )
}
