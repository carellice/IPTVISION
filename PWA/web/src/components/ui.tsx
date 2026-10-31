// ui/Components.kt and the Material 3 pieces the screens use, drawn by hand so they look like the phone.
import { AnimatePresence, motion } from 'framer-motion'
import {
  useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { uiIcons } from '../lib/icons.gen.ts'
import { spring, tween } from './motion.ts'
import { useBackHandler } from '../lib/back.ts'

export const C = {
  Accent: '#3D7BFF', Accent2: '#00C2FF', Bg: '#0A0B0F', Panel: '#111318', Surface: '#191C23',
  SurfaceHover: '#21252E', SurfacePressed: '#2A2F3A', Stroke: '#20242D', StrokeStrong: '#2E3340',
  Text: '#F1F3F7', Text2: '#9099A8', Text3: '#5C6473', AccentSoft: 'rgba(61,123,255,0.133)',
  Danger: '#FF5D6C', Star: '#FFC94D', Live: '#FF4D5E', White: '#FFFFFF', Transparent: 'transparent',
}

export type IconName = keyof typeof uiIcons

export function Icon({ name, size = 24, color = 'currentColor', style }: { name: IconName; size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}
      aria-hidden="true" dangerouslySetInnerHTML={{ __html: uiIcons[name] }} />
  )
}

// --- tvClickable ---------------------------------------------------------------------------------

type ClickableProps = {
  onClick?: () => void
  onLongClick?: () => void
  radius?: number | string
  focusScale?: number
  background?: string
  focusedBackground?: string
  onFocus?: () => void
  className?: string
  style?: CSSProperties
  children?: ReactNode
  label?: string
  autoFocus?: boolean
  disabled?: boolean
  rippleColor?: string
  dataKey?: string
}

/**
 * Modifier.tvClickable: ripple al tocco, pressione prolungata (o tasto Menu) e, con la tastiera o il
 * telecomando, si ingrandisce un poco e prende un bordo chiaro, come nella modalità TV di Windows.
 */
export function Clickable({
  onClick, onLongClick, radius = 12, focusScale = 1.04, background = C.Surface, focusedBackground = C.SurfacePressed,
  onFocus, className = '', style, children, label, autoFocus, disabled, rippleColor, dataKey,
}: ClickableProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const timer = useRef<number | null>(null)
  const long = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const ripple = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: false })
  }, [autoFocus])

  const endRipple = () => {
    const r = ripple.current
    if (!r) return
    r.classList.add('out')
    setTimeout(() => r.remove(), 460)
    ripple.current = null
  }

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return
    const el = ref.current!
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = 2 * Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y))
    const r = document.createElement('span')
    r.className = 'ripple'
    if (rippleColor) r.style.background = rippleColor
    r.style.width = r.style.height = `${size}px`
    r.style.left = `${x - size / 2}px`
    r.style.top = `${y - size / 2}px`
    el.appendChild(r)
    ripple.current = r
    long.current = false
    start.current = { x: e.clientX, y: e.clientY }
    if (onLongClick) {
      // ViewConfiguration.getLongPressTimeout(): 400 ms.
      timer.current = window.setTimeout(() => {
        long.current = true
        try { navigator.vibrate?.(25) } catch { /* not supported */ }
        onLongClick()
        endRipple()
      }, 400)
    }
  }

  const cancelTimer = () => {
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = null
  }

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) {
      cancelTimer()
      endRipple()
      start.current = null
    }
  }

  const up = () => {
    cancelTimer()
    const wasTap = start.current != null && !long.current
    start.current = null
    endRipple()
    if (wasTap && !disabled) onClick?.()
  }

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      onClick?.()
    } else if (e.key === 'ContextMenu' && onLongClick) {
      e.preventDefault()
      onLongClick()
    }
  }

  return (
    <motion.div
      ref={ref}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      data-key={dataKey}
      className={`clk ${className}`}
      style={{
        borderRadius: radius,
        background: focused ? focusedBackground : background,
        boxShadow: focused ? 'inset 0 0 0 2px #fff' : undefined,
        ...style,
      }}
      animate={{ scale: focused ? focusScale : 1 }}
      transition={spring()}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => { cancelTimer(); endRipple(); start.current = null }}
      onPointerLeave={() => { cancelTimer(); endRipple(); start.current = null }}
      onContextMenu={(e) => { if (onLongClick) e.preventDefault() }}
      onKeyDown={key}
      onFocus={(e) => {
        const visible = (e.target as HTMLElement).matches(':focus-visible')
        setFocused(visible)
        if (e.target === ref.current) onFocus?.()
      }}
      onBlur={() => setFocused(false)}
    >
      {children}
    </motion.div>
  )
}

// --- small pieces of Components.kt ---------------------------------------------------------------

/** Immagine remota con le iniziali come segnaposto (loghi dei canali, locandine). */
export function Artwork({ url, initials, style, fit = 'cover', fontSize = 18, radius = 0 }: {
  url: string | null; initials: string; style?: CSSProperties; fit?: 'cover' | 'contain'; fontSize?: number; radius?: number
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  useEffect(() => setState('loading'), [url])
  const showInitials = !url || state !== 'ok'
  return (
    <div style={{ position: 'relative', background: C.SurfaceHover, overflow: 'hidden', borderRadius: radius, flex: 'none', ...style }}>
      {showInitials && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.Text2, fontWeight: 700, fontSize, textAlign: 'center' }}>
          {initials}
        </div>
      )}
      {url && state !== 'error' && (
        <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onLoad={() => setState('ok')} onError={() => setState('error')}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit, opacity: state === 'ok' ? 1 : 0 }} />
      )}
    </div>
  )
}

export function ProgressLine({ progress, color = C.Accent, height = 3, style }: { progress: number; color?: string; height?: number; style?: CSSProperties }) {
  const p = Math.min(1, Math.max(0, progress))
  return (
    <div style={{ height, borderRadius: 2, background: C.StrokeStrong, overflow: 'hidden', ...style }}>
      <div style={{ width: `${p * 100}%`, height, background: color }} />
    </div>
  )
}

export function Pill({ text, selected, icon, onClick, onFocus, autoFocus }: {
  text: string; selected: boolean; icon?: IconName; onClick: () => void; onFocus?: () => void; autoFocus?: boolean
}) {
  return (
    <Clickable radius={999} background={selected ? C.Accent : C.Surface} focusedBackground={selected ? C.Accent : C.SurfacePressed}
      onClick={onClick} onFocus={onFocus} autoFocus={autoFocus} style={{ flex: 'none' }}>
      <div className="row" style={{ padding: '9px 16px', gap: 8 }}>
        {icon && <Icon name={icon} size={18} color={selected ? C.White : C.Text2} />}
        <span style={{ color: selected ? C.White : C.Text, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>{text}</span>
      </div>
    </Clickable>
  )
}

export function ActionButton({ text, icon, primary = false, onClick, style, autoFocus }: {
  text: string; icon?: IconName | null; primary?: boolean; onClick: () => void; style?: CSSProperties; autoFocus?: boolean
}) {
  return (
    <Clickable radius={10} background={primary ? C.Accent : C.Surface} focusedBackground={primary ? '#5A90FF' : C.SurfacePressed}
      onClick={onClick} style={style} autoFocus={autoFocus}>
      <div className="row" style={{ padding: '12px 18px', gap: 8, justifyContent: style?.width ? 'center' : undefined }}>
        {icon && <Icon name={icon} size={20} color={C.White} />}
        <span style={{ color: C.White, fontWeight: 600, fontSize: 15 }}>{text}</span>
      </div>
    </Clickable>
  )
}

export function Spinner({ color = C.Accent, size = 40 }: { color?: string; size?: number }) {
  return (
    <svg className="spinner" viewBox="0 0 48 48" style={{ width: size, height: size }} aria-label="Caricamento">
      <circle cx="24" cy="24" r="20" stroke={color} />
    </svg>
  )
}

export function Loading({ text, style }: { text?: string | null; style?: CSSProperties }) {
  return (
    <div className="col" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', height: '100%', ...style }}>
      <Spinner />
      {text && <div style={{ marginTop: 14, color: C.Text2 }}>{text}</div>}
    </div>
  )
}

export function Empty({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, height: '100%', flex: 1, ...style }}>
      <div style={{ color: C.Text2, textAlign: 'center' }}>{text}</div>
    </div>
  )
}

export function SectionTitle({ title, subtitle, style }: { title: string; subtitle?: string | null; style?: CSSProperties }) {
  return (
    <div style={style}>
      <div className="ellipsis" style={{ color: C.Text, fontSize: 26, fontWeight: 700 }}>{title}</div>
      {subtitle && <div style={{ color: C.Text2, fontSize: 13 }}>{subtitle}</div>}
    </div>
  )
}

export function Badge({ text, color = C.SurfacePressed }: { text: string; color?: string }) {
  return (
    <span style={{ color: C.Text, fontSize: 11, fontWeight: 600, borderRadius: 4, background: color, padding: '2px 6px', whiteSpace: 'nowrap', flex: 'none' }}>
      {text}
    </span>
  )
}

export function IconButton({ icon, label, color = C.Text, onClick, size = 24 }: { icon: IconName; label: string; color?: string; onClick: () => void; size?: number }) {
  return (
    <Clickable radius={999} background={C.Transparent} focusedBackground={C.SurfacePressed} onClick={onClick} label={label}
      rippleColor="rgba(255,255,255,0.12)" style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <Icon name={icon} size={size} color={color} />
    </Clickable>
  )
}

// --- Material 3 text field, switch -----------------------------------------------------------------

export function TextField({
  value, onChange, label, placeholder, type = 'text', inputMode, autoComplete, onDone, leading, trailing, radius = 4, style, enterKeyHint, autoFocus, name,
}: {
  value: string; onChange: (v: string) => void; label?: string; placeholder?: string | null; type?: string
  inputMode?: 'text' | 'url' | 'search'; autoComplete?: string; onDone?: () => void; leading?: ReactNode; trailing?: ReactNode
  radius?: number; style?: CSSProperties; enterKeyHint?: 'done' | 'next' | 'search' | 'go'; autoFocus?: boolean; name?: string
}) {
  const [focused, setFocused] = useState(false)
  const floated = focused || value !== ''
  return (
    <div className={`tf ${focused ? 'focused' : ''} ${floated ? 'floated' : ''} ${label ? 'with-label' : ''}`} style={{ borderRadius: radius, ...style }}>
      {leading && <div style={{ position: 'absolute', left: 12, top: 16, display: 'flex' }}>{leading}</div>}
      <input
        value={value} type={type} inputMode={inputMode} autoComplete={autoComplete ?? 'off'} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        name={name} enterKeyHint={enterKeyHint} autoFocus={autoFocus}
        placeholder={placeholder ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === 'Enter') { onDone?.(); if (enterKeyHint === 'search') (e.target as HTMLInputElement).blur() } }}
        style={{ paddingLeft: leading ? 52 : 16, paddingRight: trailing ? 52 : 16 }}
      />
      {label && <span className="tf-label" style={{ left: leading ? 48 : 12 }}>{label}</span>}
      {trailing && <div style={{ position: 'absolute', right: 4, top: 4, display: 'flex' }}>{trailing}</div>}
      <span className="tf-border" />
    </div>
  )
}

export function Switch({ checked }: { checked: boolean }) {
  return (
    <div style={{
      width: 52, height: 32, borderRadius: 16, flex: 'none', position: 'relative', transition: 'background-color 150ms, border-color 150ms',
      background: checked ? C.Accent : C.SurfaceHover, border: `2px solid ${checked ? C.Accent : C.StrokeStrong}`,
    }}>
      <motion.div
        initial={false}
        animate={{ x: checked ? 20 : 0, width: checked ? 24 : 16, height: checked ? 24 : 16, top: checked ? 2 : 6, left: checked ? 2 : 6 }}
        transition={spring(1, 1500)}
        style={{ position: 'absolute', borderRadius: 12, background: checked ? C.White : C.StrokeStrong }}
      />
    </div>
  )
}

// --- overlays: dialogs, menus, toasts --------------------------------------------------------------

const overlayRoot = () => document.getElementById('overlays') ?? document.body

/** androidx.compose.ui.window.Dialog: scrim, scale + fade like the platform dialog window. */
export function Dialog({ open, onDismiss, children, width = 560 }: { open: boolean; onDismiss: () => void; children: ReactNode; width?: number }) {
  useEscape(open, onDismiss)
  useBackHandler(open, onDismiss)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween(150)}
          onPointerDown={(e) => { if (e.target === e.currentTarget) onDismiss() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={tween(150)}
            style={{ width: `min(${width}px, calc(100% - 32px))`, maxHeight: '100%', display: 'flex', flexDirection: 'column' }}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    overlayRoot(),
  )
}

/** Material 3 AlertDialog. */
export function AlertDialog({ open, title, text, confirm, dismiss, onDismiss }: {
  open: boolean; title: string; text: string; onDismiss: () => void
  confirm: { label: string; color?: string; onClick: () => void }; dismiss?: { label: string; color?: string; onClick: () => void }
}) {
  return (
    <Dialog open={open} onDismiss={onDismiss} width={560}>
      <div style={{ background: C.Panel, borderRadius: 28, padding: 24, maxWidth: 560, minWidth: 280, alignSelf: 'center', width: '100%' }}>
        <div style={{ color: C.Text, fontSize: 24, lineHeight: '32px', letterSpacing: 0 }}>{title}</div>
        <div style={{ color: C.Text2, fontSize: 14, lineHeight: '20px', letterSpacing: 0.25, marginTop: 16 }}>{text}</div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          {dismiss && <TextButton label={dismiss.label} color={dismiss.color} onClick={dismiss.onClick} />}
          <TextButton label={confirm.label} color={confirm.color} onClick={confirm.onClick} autoFocus />
        </div>
      </div>
    </Dialog>
  )
}

export function TextButton({ label, color = C.Accent, onClick, autoFocus }: { label: string; color?: string; onClick: () => void; autoFocus?: boolean }) {
  return (
    <Clickable radius={20} background={C.Transparent} focusedBackground={C.SurfacePressed} onClick={onClick} autoFocus={autoFocus} focusScale={1}
      rippleColor="rgba(255,255,255,0.12)" style={{ height: 40, padding: '0 12px', display: 'flex', alignItems: 'center' }}>
      <span style={{ color, fontSize: 14, fontWeight: 500, letterSpacing: 0.1, lineHeight: '20px' }}>{label}</span>
    </Clickable>
  )
}

function useEscape(open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onDismiss() }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [open, onDismiss])
}

/** Material 3 DropdownMenu, under its anchor. */
export function Menu({ open, anchor, onDismiss, children }: { open: boolean; anchor: HTMLElement | null; onDismiss: () => void; children: ReactNode }) {
  useEscape(open, onDismiss)
  useBackHandler(open, onDismiss)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !anchor) return
    const r = anchor.getBoundingClientRect()
    setPos({ top: r.bottom, right: Math.max(8, window.innerWidth - r.right) })
  }, [open, anchor])
  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <div key="menu" style={{ position: 'fixed', inset: 0, zIndex: 60 }} onPointerDown={(e) => { if (e.target === e.currentTarget) onDismiss() }}>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1, transition: tween(120) }} exit={{ opacity: 0, transition: tween(75) }}
            className="scroll"
            style={{
              position: 'absolute', top: pos.top, right: pos.right, transformOrigin: 'top right', background: C.Panel, borderRadius: 4,
              padding: '8px 0', minWidth: 112, maxWidth: 280, maxHeight: `calc(100% - ${pos.top + 8}px)`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.5), 0 4px 8px 3px rgba(0,0,0,0.3)',
            }}>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    overlayRoot(),
  )
}

export function MenuItem({ text, color = C.Text, leading, onClick, autoFocus }: { text: string; color?: string; leading?: ReactNode; onClick: () => void; autoFocus?: boolean }) {
  return (
    <Clickable radius={0} background={C.Transparent} focusedBackground={C.SurfacePressed} focusScale={1} onClick={onClick} autoFocus={autoFocus}
      rippleColor="rgba(255,255,255,0.12)" style={{ height: 48, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 24, height: 24, display: 'flex' }}>{leading}</div>
      <span className="ellipsis" style={{ color, fontSize: 14, fontWeight: 500, letterSpacing: 0.1, lineHeight: '20px', paddingRight: 12 }}>{text}</span>
    </Clickable>
  )
}

// Toast di Android: un messaggio per volta in basso, 2 s (breve) o 3,5 s (lungo).
type ToastMsg = { id: number; text: string }
let toastMsg: ToastMsg | null = null
const toastListeners = new Set<() => void>()
let toastTimer: number | undefined
let toastId = 0

export function toast(text: string, long = false) {
  toastMsg = { id: ++toastId, text }
  toastListeners.forEach((l) => l())
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMsg = null
    toastListeners.forEach((l) => l())
  }, long ? 3500 : 2000)
}

export function ToastHost() {
  const msg = useSyncExternalStore((l) => { toastListeners.add(l); return () => toastListeners.delete(l) }, () => toastMsg)
  return createPortal(
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(96px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 90 }}>
      <AnimatePresence>
        {msg && (
          <motion.div key={msg.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween(200)}
            style={{ maxWidth: 'calc(100% - 48px)', background: '#E8E8EC', color: '#1B1B1F', borderRadius: 24, padding: '10px 16px', fontSize: 14, lineHeight: '20px', letterSpacing: 0.25, boxShadow: '0 2px 6px rgba(0,0,0,0.35)', textAlign: 'center' }}>
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    overlayRoot(),
  )
}

// --- Lazy lists: only the rows on screen exist (catalogs reach 50 000 films) ------------------------

export type GridSpec = {
  /** GridCells.Adaptive(min): as many columns as fit. 0 = LazyColumn (one item per row). */
  minWidth: number
  gap: number
  rowGap: number
  /** contentPadding: [vertical, horizontal]. */
  padding: [number, number]
  /** Height of a row before it is measured, for a given item width. */
  estimate: (itemWidth: number) => number
}

/**
 * LazyColumn / LazyVerticalGrid: rows are measured once on screen (titles on one or two lines,
 * programme or not), the others use the estimate.
 */
export function LazyGrid<T>({ items, spec, render, initialIndex = 0, itemKey, header, style }: {
  items: T[]; spec: GridSpec; render: (item: T, index: number) => ReactNode; initialIndex?: number
  itemKey: (item: T) => string | number; header?: ReactNode; style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [scroll, setScroll] = useState(0)
  const [, bump] = useState(0)
  const heights = useRef(new Map<number, number>())
  const headerH = useRef(0)
  const restored = useRef(false)
  const ro = useRef<ResizeObserver | null>(null)
  const [pv, ph] = spec.padding

  const inner = Math.max(0, size.w - 2 * ph)
  const cols = spec.minWidth > 0 ? Math.max(1, Math.floor((inner + spec.gap) / (spec.minWidth + spec.gap))) : 1
  const itemW = (inner - spec.gap * (cols - 1)) / cols
  const rows = Math.ceil(items.length / cols)
  const estimate = spec.estimate(itemW)
  const layoutKey = `${cols}:${Math.round(itemW)}:${items.length}:${items.length ? itemKey(items[0]) : ''}`
  const lastLayout = useRef('')
  if (lastLayout.current !== layoutKey) {
    lastLayout.current = layoutKey
    heights.current = new Map()
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    obs.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    ro.current = new ResizeObserver((entries) => {
      let changed = false
      for (const e of entries) {
        const t = e.target as HTMLElement
        const h = t.offsetHeight
        if (t.dataset.row === 'header') { if (headerH.current !== h) { headerH.current = h; changed = true } continue }
        const r = Number(t.dataset.row)
        if (heights.current.get(r) !== h) { heights.current.set(r, h); changed = true }
      }
      if (changed) bump((n) => n + 1)
    })
    return () => { obs.disconnect(); ro.current?.disconnect() }
  }, [])

  // Prefix sums of the row heights.
  const offsets = new Float64Array(rows + 1)
  for (let r = 0; r < rows; r++) offsets[r + 1] = offsets[r] + (heights.current.get(r) ?? estimate) + spec.rowGap
  const top0 = pv + headerH.current
  const total = top0 + Math.max(0, offsets[rows] - (rows ? spec.rowGap : 0)) + pv

  // rememberLazyListState(initialFirstVisibleItemIndex): opens at the given item.
  useLayoutEffect(() => {
    if (restored.current || size.w === 0) return
    restored.current = true
    if (initialIndex > 0 && ref.current) {
      const t = top0 + offsets[Math.min(rows, Math.floor(initialIndex / cols))]
      ref.current.scrollTop = t
      setScroll(t)
    }
  })

  const find = (y: number) => {
    let lo = 0
    let hi = rows
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (offsets[mid + 1] <= y) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const first = Math.max(0, find(scroll - top0) - 2)
  const last = Math.min(rows - 1, find(scroll - top0 + size.h) + 2)

  const observe = (el: HTMLDivElement | null) => { if (el) ro.current?.observe(el) }
  const out: ReactNode[] = []
  if (size.w > 0) {
    for (let r = first; r <= last; r++) {
      const cells: ReactNode[] = []
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        if (i >= items.length) break
        cells.push(<div key={itemKey(items[i])} style={{ width: itemW, flex: 'none' }}>{render(items[i], i)}</div>)
      }
      out.push(
        <div key={itemKey(items[r * cols])} data-row={r} ref={observe}
          style={{ position: 'absolute', left: ph, right: ph, top: top0 + offsets[r], display: 'flex', gap: spec.gap, alignItems: 'flex-start' }}>
          {cells}
        </div>,
      )
    }
  }

  return (
    <div ref={ref} className="scroll" onScroll={() => ref.current && setScroll(ref.current.scrollTop)} style={{ position: 'relative', height: '100%', ...style }}>
      <div style={{ position: 'relative', height: total }}>
        {header != null && <div data-row="header" ref={observe} style={{ position: 'absolute', left: ph, right: ph, top: pv }}>{header}</div>}
        {out}
      </div>
    </div>
  )
}
