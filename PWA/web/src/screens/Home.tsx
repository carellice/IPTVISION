// ui/HomeScreen.kt: barra in basso sul telefono, menu laterale con orologio da 720 px in su.
import { motion } from 'framer-motion'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVm } from '../lib/app.ts'
import { sections, sectionTitle, type Section } from '../lib/library.ts'
import { C, Clickable, Icon, type IconName } from '../components/ui.tsx'
import { tween } from '../components/motion.ts'
import { LiveSection, MoviesSection, SeriesSection } from './Browse.tsx'
import { SearchSection } from './Search.tsx'
import { SettingsSection } from './Settings.tsx'

const sectionIcon: Record<Section, IconName> = { Live: 'tv', Movies: 'movie', Series: 'view_module', Search: 'search', Settings: 'settings' }

/** Larghezza da tablet/TV: categorie a griglia e menu laterale; sotto, layout da telefono. */
export const WideContext = createContext(false)
export const useWide = () => useContext(WideContext)

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(window.innerWidth)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function HomeScreen() {
  const vm = useVm()
  const [ref, width] = useWidth()
  const wide = width >= 720

  return (
    <WideContext.Provider value={wide}>
      <div ref={ref} style={{ height: '100%', background: C.Bg }}>
        {wide ? (
          <div className="row status-pad nav-pad" style={{ height: '100%', alignItems: 'stretch' }}>
            <SideNav />
            <div className="col grow" style={{ padding: '20px 24px 0 8px', minHeight: 0 }}><Content /></div>
          </div>
        ) : (
          <div className="col status-pad" style={{ height: '100%' }}>
            <div className="col grow" style={{ padding: '12px 14px 0', minHeight: 0 }}><Content /></div>
            <NavigationBar section={vm.section} onSelect={(s) => vm.setSection(s)} />
          </div>
        )}
      </div>
    </WideContext.Provider>
  )
}

function Content() {
  const vm = useVm()
  return (
    <>
      {vm.status && <div style={{ color: C.Text2, fontSize: 13, paddingBottom: 6, flex: 'none' }}>{vm.status}</div>}
      <div className="col grow" style={{ minHeight: 0 }}>
        {vm.section === 'Live' && <LiveSection />}
        {vm.section === 'Movies' && <MoviesSection />}
        {vm.section === 'Series' && <SeriesSection />}
        {vm.section === 'Search' && <SearchSection />}
        {vm.section === 'Settings' && <SettingsSection />}
      </div>
    </>
  )
}

/** Material 3 NavigationBar: 80 dp, indicatore a pillola sotto l'icona selezionata. */
function NavigationBar({ section, onSelect }: { section: Section; onSelect: (s: Section) => void }) {
  return (
    <nav className="row nav-pad" style={{ background: C.Panel, flex: 'none', alignItems: 'stretch' }}>
      {sections.map((s) => {
        const selected = s === section
        const label = s === 'Live' ? 'TV' : s === 'Settings' ? 'Altro' : sectionTitle[s]
        return (
          <div key={s} role="tab" aria-selected={selected} tabIndex={0} onClick={() => onSelect(s)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(s) }}
            className="col" style={{ flex: 1, height: 80, alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', outline: 'none' }}>
            <div style={{ position: 'relative', width: 64, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <motion.div initial={false} animate={{ opacity: selected ? 1 : 0, scaleX: selected ? 1 : 0.5 }} transition={tween(100)}
                style={{ position: 'absolute', inset: 0, borderRadius: 16, background: C.Accent }} />
              <Icon name={sectionIcon[s]} color={selected ? C.White : C.Text2} style={{ position: 'relative' }} />
            </div>
            <span style={{ fontSize: 11, lineHeight: '16px', fontWeight: 500, letterSpacing: 0.5, color: selected ? C.Text : C.Text2 }}>{label}</span>
          </div>
        )
      })}
    </nav>
  )
}

function SideNav() {
  const vm = useVm()
  return (
    <div className="col" style={{ width: 220, flex: 'none', background: C.Panel, padding: 14, gap: 6 }}>
      <div className="row" style={{ padding: '8px 0 18px 6px' }}>
        <img src="/logo.png" alt="" style={{ width: 34, height: 34, borderRadius: 8 }} />
        <div style={{ width: 10 }} />
        <span style={{ color: C.Text, fontWeight: 700, fontSize: 19 }}>IPTVISION</span>
      </div>
      {sections.map((s) => {
        const selected = vm.section === s
        return (
          <Clickable key={s} focusScale={1.02} background={selected ? C.AccentSoft : C.Transparent} focusedBackground={C.SurfacePressed}
            onClick={() => vm.setSection(s)} style={{ width: '100%' }}>
            <div className="row" style={{ padding: '12px 14px' }}>
              <Icon name={sectionIcon[s]} size={22} color={selected ? C.Accent : C.Text2} />
              <div style={{ width: 12 }} />
              <span style={{ color: selected ? C.Text : C.Text2, fontWeight: selected ? 600 : 400 }}>{sectionTitle[s]}</span>
            </div>
          </Clickable>
        )
      })}
      <div style={{ flex: 1 }} />
      <Clock />
    </div>
  )
}

export function Clock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  const d = new Date(now)
  const day = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(d)
  return (
    <div className="col" style={{ padding: 6 }}>
      <span style={{ color: C.Text, fontSize: 24, fontWeight: 700 }}>
        {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
      </span>
      <span style={{ color: C.Text2, fontSize: 12 }}>{day.charAt(0).toUpperCase() + day.slice(1)}</span>
    </div>
  )
}
