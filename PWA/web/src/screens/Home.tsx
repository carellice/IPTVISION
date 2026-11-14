import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clickable, Icon, type IconName, useWide } from '../components/ui.tsx'
import { tween } from '../components/motion.ts'
import { app, sections, setSection, useApp } from '../lib/app.ts'
import { type Section, sectionTitle } from '../lib/library.ts'
import { NetworkStatus } from '../components/network.tsx'
import { useSkin } from '../lib/skin.ts'
import { LiveSection, MoviesSection, SeriesSection } from './Browse.tsx'
import { SearchSection } from './Search.tsx'
import { SettingsSection } from './Settings.tsx'

const icons: Record<Section, IconName> = { Live: 'tv', Movies: 'movie', Series: 'view_module', Search: 'search', Settings: 'settings' }

/** HomeScreen.kt: bottom bar on the phone, side menu with the clock from 720 px. */
export function Home() {
  useApp()
  const wide = useWide()
  if (useSkin() === 'metro') return <Pivot wide={wide} />
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

const pivotLabel: Record<Section, string> = { Live: 'tv', Movies: 'film', Series: 'serie', Search: 'cerca', Settings: 'impostazioni' }

/**
 * Modern UI (Windows Phone pivot): app name in small caps, the sections as big lowercase headers
 * with the current one first and in white, the page sliding in from the right. A horizontal swipe on
 * the headers moves to the next or previous section.
 */
function Pivot({ wide }: { wide: boolean }) {
  const i = sections.indexOf(app.section)
  const ordered = [...sections.slice(i), ...sections.slice(0, i)]
  const [dir, setDir] = useState(1)
  const go = (s: Section) => { setDir(sections.indexOf(s) >= i ? 1 : -1); setSection(s) }
  const step = (d: number) => { setDir(d); setSection(sections[(i + d + sections.length) % sections.length]) }
  const x0 = useRef<number | null>(null)
  const pad = wide ? 24 : 12
  return (
    <div className="safe" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: `${wide ? 14 : 10}px ${pad}px 0` }}>
        <div style={{ flex: 1, color: 'var(--text)', fontSize: 14, lineHeight: '20px', fontWeight: 600, letterSpacing: 1 }}>IPTVISION</div>
        {wide && <MetroClock />}
        <NetworkStatus />
      </div>
      <div role="tablist" style={{ display: 'flex', overflow: 'hidden', padding: `0 ${pad}px`, flexShrink: 0, touchAction: 'pan-y' }}
        onPointerDown={(e) => { x0.current = e.clientX }}
        onPointerUp={(e) => {
          const dx = x0.current == null ? 0 : e.clientX - x0.current
          x0.current = null
          if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1)
        }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1) }}>
        {ordered.map((s) => {
          const selected = s === app.section
          return (
            <motion.div key={s} layout="position" transition={tween(300)} role="tab" aria-selected={selected} tabIndex={0}
              onClick={() => go(s)} onKeyDown={(e) => { if (e.key === 'Enter') go(s) }}
              style={{ flexShrink: 0, marginRight: wide ? 28 : 20, cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap',
                fontSize: wide ? 56 : 42, lineHeight: wide ? '76px' : '58px', fontWeight: 300, letterSpacing: -1,
                color: selected ? 'var(--text)' : 'var(--text3)', transition: 'color 200ms' }}>
              {pivotLabel[s]}
            </motion.div>
          )
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', padding: `8px ${pad}px 0` }}>
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div key={app.section} custom={dir}
            variants={{ in: (d: number) => ({ x: 80 * d, opacity: 0 }), on: { x: 0, opacity: 1 }, out: (d: number) => ({ x: -80 * d, opacity: 0 }) }}
            initial="in" animate="on" exit="out" transition={{ type: 'tween', duration: 0.28, ease: [0.1, 0.9, 0.2, 1] }}
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Content />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function MetroClock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  return <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: '20px', fontWeight: 300 }}>{timeFmt.format(now)}</div>
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
      <div style={{ padding: '0 6px 6px' }}><NetworkStatus /></div>
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
