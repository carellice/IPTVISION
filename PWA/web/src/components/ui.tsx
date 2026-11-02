import { type CSSProperties, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { uiIcons } from '../lib/icons.gen.ts'
import { spring, tween } from './motion.ts'

// The components of ui/Components.kt and the Material 3 pieces the app uses, hand built.

export type IconName = keyof typeof uiIcons

export function Icon({ name, size = 24, color, style }: { name: IconName; size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={color ?? 'currentColor'} style={{ flexShrink: 0, display: 'block', ...style }}
      aria-hidden dangerouslySetInnerHTML={{ __html: uiIcons[name] }} />
  )
}

/**
 * tvClickable: the same element works with the finger, the mouse and the keyboard. A long press
 * (or the context menu key) is the native onLongClick.
 */
export function Clickable({
  children, onClick, onLongClick, style, className, radius = 12, background = 'var(--surface)', title, disabled,
}: {
  children: ReactNode
  onClick?: () => void
  onLongClick?: () => void
  style?: CSSProperties
  className?: string
  radius?: number | string
  background?: string
  title?: string
  disabled?: boolean
}) {
  const timer = useRef<number | null>(null)
  const longDone = useRef(false)
  const start = useRef<[number, number]>([0, 0])
  const cancel = () => {
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={title}
      title={title}
      className={'click ' + (className ?? '')}
      style={{ borderRadius: radius, background, ...style, opacity: disabled ? 0.5 : style?.opacity }}
      onPointerDown={(e) => {
        longDone.current = false
        start.current = [e.clientX, e.clientY]
        if (!onLongClick) return
        cancel()
        timer.current = window.setTimeout(() => {
          longDone.current = true
          try { navigator.vibrate?.(25) } catch { /* not supported */ }
          onLongClick()
        }, 500)
      }}
      onPointerMove={(e) => {
        if (Math.abs(e.clientX - start.current[0]) > 10 || Math.abs(e.clientY - start.current[1]) > 10) cancel()
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        if (!onLongClick) return
        e.preventDefault()
        if (!longDone.current) onLongClick()
        longDone.current = true
      }}
      onClick={() => {
        if (disabled) return
        if (longDone.current) { longDone.current = false; return }
        onClick?.()
      }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() }
        if (e.key === 'ContextMenu' && onLongClick) { e.preventDefault(); onLongClick() }
      }}
    >
      {children}
    </div>
  )
}

/** Remote image with the initials as placeholder (channel logos, posters). */
export function Artwork({ url, initials, style, fit = 'cover', fontSize = 18 }: {
  url: string | null | undefined; initials: string; style?: CSSProperties; fit?: 'cover' | 'contain'; fontSize?: number
}) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { setFailed(false); setLoaded(false) }, [url])
  const show = !!url && !failed
  return (
    <div style={{ position: 'relative', background: 'var(--surfaceHover)', overflow: 'hidden', flexShrink: 0, ...style }}>
      {(!show || !loaded) && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontWeight: 700, fontSize, lineHeight: 1.2, textAlign: 'center' }}>
          {initials}
        </div>
      )}
      {show && (
        <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit, opacity: loaded ? 1 : 0 }} />
      )}
    </div>
  )
}

export function ProgressLine({ progress, style, color = 'var(--accent)', height = 3 }: { progress: number; style?: CSSProperties; color?: string; height?: number }) {
  return (
    <div style={{ height, borderRadius: 2, background: 'var(--strokeStrong)', overflow: 'hidden', ...style }}>
      <div style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%`, height, background: color }} />
    </div>
  )
}

export function Pill({ text, selected, icon, onClick, style }: { text: string; selected: boolean; icon?: IconName; onClick: () => void; style?: CSSProperties }) {
  return (
    <Clickable onClick={onClick} radius={999} background={selected ? 'var(--accent)' : 'var(--surface)'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', flexShrink: 0, ...style }}>
      {icon && <Icon name={icon} size={18} color={selected ? '#fff' : 'var(--text2)'} />}
      <span style={{ color: selected ? '#fff' : 'var(--text)', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>{text}</span>
    </Clickable>
  )
}

export function ActionButton({ text, icon, primary, onClick, style, disabled }: {
  text: string; icon?: IconName | null; primary?: boolean; onClick: () => void; style?: CSSProperties; disabled?: boolean
}) {
  return (
    <Clickable onClick={onClick} radius={10} background={primary ? 'var(--accent)' : 'var(--surface)'} disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: style?.width ? 'center' : undefined, gap: 8, padding: '12px 18px', ...style }}>
      {icon && <Icon name={icon} size={20} color="#fff" />}
      <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{text}</span>
    </Clickable>
  )
}

/** M3 CircularProgressIndicator (indeterminate, 40 dp, 4 dp stroke). */
export function Spinner({ size = 40, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" style={{ animation: 'spin 1.4s linear infinite', flexShrink: 0 }}>
      <circle cx="25" cy="25" r="20" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" style={{ animation: 'dash 1.4s ease-in-out infinite' }} />
    </svg>
  )
}

export function Loading({ text, style }: { text?: string | null; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', ...style }}>
      <Spinner />
      {text && <div style={{ marginTop: 14, color: 'var(--text2)' }}>{text}</div>}
    </div>
  )
}

export function Empty({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, ...style }}>
      <div style={{ color: 'var(--text2)', textAlign: 'center' }}>{text}</div>
    </div>
  )
}

export function SectionTitle({ title, subtitle, style }: { title: string; subtitle?: string | null; style?: CSSProperties }) {
  return (
    <div style={style}>
      <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 26, fontWeight: 700 }}>{title}</div>
      {subtitle != null && <div style={{ color: 'var(--text2)', fontSize: 13 }}>{subtitle}</div>}
    </div>
  )
}

export function Badge({ text, color = 'var(--surfacePressed)' }: { text: string; color?: string }) {
  return (
    <span style={{ color: 'var(--text)', fontSize: 11, fontWeight: 600, borderRadius: 4, background: color, padding: '2px 6px', whiteSpace: 'nowrap', display: 'inline-block' }}>
      {text}
    </span>
  )
}

/** M3 OutlinedTextField: label inside that floats on the border, Panel fill, Accent when focused. */
export function TextField({
  value, onChange, label, placeholder, type = 'text', autoComplete, inputMode, onDone, leading, trailing, radius = 4, style, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  label?: string
  placeholder?: string
  type?: string
  autoComplete?: string
  inputMode?: 'url' | 'text' | 'search'
  onDone?: () => void
  leading?: ReactNode
  trailing?: ReactNode
  radius?: number
  style?: CSSProperties
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ''
  return (
    <div style={{ position: 'relative', ...style }}>
      <div style={{
        display: 'flex', alignItems: 'center', minHeight: 56, borderRadius: radius, background: 'var(--panel)',
        border: `${focused ? 2 : 1}px solid ${focused ? 'var(--accent)' : 'var(--strokeStrong)'}`, padding: focused ? 0 : 1,
      }}>
        {leading && <div style={{ paddingLeft: 12, display: 'flex' }}>{leading}</div>}
        <div style={{ position: 'relative', flex: 1, minWidth: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
          {label && (
            <label style={{
              position: 'absolute', left: 14, pointerEvents: 'none', transformOrigin: 'left center',
              transition: 'transform 150ms, top 150ms, color 150ms', top: floating ? -10 : 16,
              transform: floating ? 'scale(0.75)' : 'none', color: focused ? 'var(--accent)' : 'var(--text2)',
              background: floating ? 'var(--panel)' : 'transparent', padding: '0 4px', fontSize: 16, lineHeight: '24px',
            }}>{label}</label>
          )}
          <input
            value={value}
            type={type}
            autoComplete={autoComplete}
            inputMode={inputMode}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={autoFocus}
            enterKeyHint={onDone ? (type === 'search' ? 'search' : 'done') : 'next'}
            placeholder={!label || focused ? placeholder : undefined}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') onDone?.() }}
            style={{
              flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)',
              fontSize: 16, lineHeight: '24px', padding: '16px', letterSpacing: '0.03125em',
            }}
          />
        </div>
        {trailing && <div style={{ paddingRight: 4, display: 'flex' }}>{trailing}</div>}
      </div>
    </div>
  )
}

/** M3 Switch 52×32: Accent track when on, SurfaceHover when off. */
export function Switch({ checked }: { checked: boolean }) {
  return (
    <div style={{
      width: 52, height: 32, borderRadius: 16, flexShrink: 0, position: 'relative',
      background: checked ? 'var(--accent)' : 'var(--surfaceHover)', border: `2px solid ${checked ? 'var(--accent)' : 'var(--strokeStrong)'}`,
      transition: 'background-color 150ms, border-color 150ms',
    }}>
      <motion.div
        animate={{ x: checked ? 20 : 0, width: checked ? 24 : 16, height: checked ? 24 : 16, top: checked ? 2 : 6, left: checked ? 2 : 6 }}
        transition={spring(1, 1500)}
        style={{ position: 'absolute', borderRadius: '50%', background: checked ? '#fff' : 'var(--text2)' }}
      />
    </div>
  )
}

export function IconButton({ icon, title, onClick, color = 'var(--text)', size = 24 }: { icon: IconName; title: string; onClick: () => void; color?: string; size?: number }) {
  return (
    <Clickable onClick={onClick} title={title} radius="50%" background="transparent" style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name={icon} size={size} color={color} />
    </Clickable>
  )
}

// --- overlays: rendered in a portal so no screen clips them --------------------------------------

function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

/** Android dialog window: scrim, fade + scale 0.9 → 1. */
export function Dialog({ open, onDismiss, children, width = 560 }: { open: boolean; onDismiss: () => void; children: ReactNode; width?: number }) {
  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <motion.div key="dialog" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween(150)}
            onClick={onDismiss}
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} transition={tween(150)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', minWidth: 0, maxWidth: width, maxHeight: '100%', display: 'flex', flexDirection: 'column' }}>
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}

/** M3 AlertDialog: title, text, text buttons on the right. */
export function AlertDialog({ open, title, text, confirm, confirmColor = 'var(--accent)', dismiss = 'Indietro', onConfirm, onDismiss }: {
  open: boolean; title: string; text?: string; confirm: string; confirmColor?: string; dismiss?: string; onConfirm: () => void; onDismiss: () => void
}) {
  return (
    <Dialog open={open} onDismiss={onDismiss} width={360}>
      <div style={{ background: 'var(--panel)', borderRadius: 28, padding: 24 }}>
        <div style={{ color: 'var(--text)', fontSize: 24, lineHeight: '32px' }}>{title}</div>
        {text && <div style={{ color: 'var(--text2)', fontSize: 14, lineHeight: '20px', marginTop: 16 }}>{text}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <TextButton text={dismiss} color="var(--text2)" onClick={onDismiss} />
          <TextButton text={confirm} color={confirmColor} onClick={onConfirm} />
        </div>
      </div>
    </Dialog>
  )
}

export function TextButton({ text, color, onClick }: { text: string; color: string; onClick: () => void }) {
  return (
    <Clickable onClick={onClick} radius={20} background="transparent" style={{ padding: '10px 12px', minHeight: 40 }}>
      <span style={{ color, fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>{text}</span>
    </Clickable>
  )
}

/** M3 DropdownMenu under its anchor: scale 0.8 → 1 + fade, 120 ms in, 75 ms out. */
export function Menu({ open, anchor, onDismiss, children }: { open: boolean; anchor: HTMLElement | null; onDismiss: () => void; children: ReactNode }) {
  const r = anchor?.getBoundingClientRect()
  const right = r ? Math.max(8, window.innerWidth - r.right) : 8
  const top = r ? r.bottom + 4 : 0
  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <motion.div key="menu-scrim" style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onDismiss} exit={{ opacity: 1 }} transition={tween(75)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1, transition: tween(120) }} exit={{ opacity: 0, transition: tween(75) }}
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'fixed', right, top, transformOrigin: 'top right', background: 'var(--panel)', borderRadius: 4, padding: '8px 0',
                minWidth: 200, boxShadow: '0 3px 8px rgba(0,0,0,0.5)', maxHeight: `calc(100% - ${top + 8}px)`, overflowY: 'auto' }}>
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}

export function MenuItem({ text, color = 'var(--text)', leading, onClick }: { text: string; color?: string; leading?: ReactNode; onClick: () => void }) {
  return (
    <Clickable onClick={onClick} radius={0} background="transparent" style={{ display: 'flex', alignItems: 'center', gap: 12, height: 48, padding: '0 12px' }}>
      <div style={{ width: 24, height: 24 }}>{leading}</div>
      <span style={{ color, fontSize: 14, lineHeight: '20px', fontWeight: 500, whiteSpace: 'nowrap', paddingRight: 12 }}>{text}</span>
    </Clickable>
  )
}

// --- toast (Android Toast: dark pill near the bottom, 2 s or 3.5 s) ----------------------------------

let toastState: { text: string; id: number } | null = null
const toastListeners = new Set<() => void>()
let toastTimer: number | undefined

export function toast(text: string, long = false) {
  toastState = { text, id: Date.now() }
  toastListeners.forEach((l) => l())
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastState = null
    toastListeners.forEach((l) => l())
  }, long ? 3500 : 2000)
}

export function ToastHost() {
  const t = useSyncExternalStore((l) => { toastListeners.add(l); return () => toastListeners.delete(l) }, () => toastState)
  return (
    <Portal>
      <AnimatePresence>
        {t && (
          <motion.div key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tween(250)}
            style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(96px + env(safe-area-inset-bottom))', zIndex: 60, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 24px' }}>
            <div style={{ background: '#2b2d31', color: '#f1f3f7', borderRadius: 22, padding: '10px 18px', fontSize: 14, lineHeight: '20px', maxWidth: 420, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
              {t.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}

/** Width from tablet/TV: categories as cards and a side menu; below, the phone layout. */
export function useWide(): boolean {
  const q = '(min-width: 720px)'
  return useSyncExternalStore(
    (l) => { const m = matchMedia(q); m.addEventListener('change', l); return () => m.removeEventListener('change', l) },
    () => matchMedia(q).matches,
  )
}
