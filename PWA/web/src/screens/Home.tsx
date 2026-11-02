import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clickable, Icon, type IconName, useWide } from '../components/ui.tsx'
import { tween } from '../components/motion.ts'
import { app, sections, setSection, useApp } from '../lib/app.ts'
import { type Section, sectionTitle } from '../lib/library.ts'
import { LiveSection, MoviesSection, SeriesSection } from './Browse.tsx'
import { SearchSection } from './Search.tsx'
import { SettingsSection } from './Settings.tsx'

const icons: Record<Section, IconName> = { Live: 'tv', Movies: 'movie', Series: 'view_module', Search: 'search', Settings: 'settings' }

/** HomeScreen.kt: bottom bar on the phone, side menu with the clock from 720 px. */
export function Home() {
  useApp()
  const wide = useWide()
  if (wide) {
    return (
      <div className="safe" style={{ display: 'flex', height: '100%' }}>
        <SideNav />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '20px 24px 0 8px' }}>
          <Content />
        </div>
      </div>
    )
  }
  return (
    <div className="status-pad" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 14px 0' }}>
        <Content />
      </div>
      <NavBar />
    </div>
  )
}

function Content() {
  return (
    <>
      {app.status && <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: '18px', paddingBottom: 6 }}>{app.status}</div>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {app.section === 'Live' && <LiveSection />}
        {app.section === 'Movies' && <MoviesSection />}
        {app.section === 'Series' && <SeriesSection />}
        {app.section === 'Search' && <SearchSection />}
        {app.section === 'Settings' && <SettingsSection />}
      </div>
    </>
  )
}

/** M3 NavigationBar: 80 dp, pill indicator 64×32 in Accent, labels 11 sp. */
function NavBar() {
  return (
    <div className="nav-pad" style={{ background: 'var(--panel)', flexShrink: 0 }}>
      <div style={{ display: 'flex', height: 80 }}>
        {sections.map((s) => {
          const selected = app.section === s
          const label = s === 'Live' ? 'TV' : s === 'Settings' ? 'Altro' : sectionTitle[s]
          return (
            <div key={s} role="tab" aria-selected={selected} tabIndex={0} onClick={() => setSection(s)}
              onKeyDown={(e) => { if (e.key === 'Enter') setSection(s) }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' }}>
              <div style={{ position: 'relative', width: 64, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <motion.div initial={false} animate={{ opacity: selected ? 1 : 0, scaleX: selected ? 1 : 0.5 }} transition={tween(100)}
                  style={{ position: 'absolute', inset: 0, borderRadius: 16, background: 'var(--accent)' }} />
                <Icon name={icons[s]} color={selected ? '#fff' : 'var(--text2)'} style={{ position: 'relative' }} />
              </div>
              <div style={{ fontSize: 11, lineHeight: '16px', fontWeight: 500, color: selected ? 'var(--text)' : 'var(--text2)' }}>{label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SideNav() {
  return (
    <div style={{ width: 220, flexShrink: 0, height: '100%', background: 'var(--panel)', padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0 18px 6px' }}>
        <img src="/logo.png" alt="" style={{ width: 34, height: 34, borderRadius: 8 }} />
        <div style={{ marginLeft: 10, color: 'var(--text)', fontWeight: 700, fontSize: 19, lineHeight: '24px' }}>IPTVISION</div>
      </div>
      {sections.map((s) => {
        const selected = app.section === s
        return (
          <Clickable key={s} onClick={() => setSection(s)} background={selected ? 'var(--accentSoft)' : 'transparent'}
            style={{ display: 'flex', alignItems: 'center', padding: '12px 14px' }}>
            <Icon name={icons[s]} size={22} color={selected ? 'var(--accent)' : 'var(--text2)'} />
            <div style={{ marginLeft: 12, color: selected ? 'var(--text)' : 'var(--text2)', fontWeight: selected ? 600 : 400 }}>{sectionTitle[s]}</div>
          </Clickable>
        )
      })}
      <div style={{ flex: 1 }} />
      <Clock />
    </div>
  )
}

const timeFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })

export function Clock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  const date = dateFmt.format(now)
  return (
    <div style={{ padding: 6 }}>
      <div style={{ color: 'var(--text)', fontSize: 24, lineHeight: '32px', fontWeight: 700 }}>{timeFmt.format(now)}</div>
      <div style={{ color: 'var(--text2)', fontSize: 12, lineHeight: '16px' }}>{date[0].toUpperCase() + date.slice(1)}</div>
    </div>
  )
}
