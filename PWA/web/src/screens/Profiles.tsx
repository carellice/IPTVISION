import { useState } from 'react'
import { ActionButton, Clickable, Dialog, Icon, TextButton, TextField, toast } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { type Profile, app, chooseProfile, loadProfiles, switchProfile, useApp } from '../lib/app.ts'

// Profiles of the home server account, like Netflix: "Chi guarda?" at start and the list in Impostazioni.

/** Full screen "Chi guarda?": a tile per profile, the PIN asked for the locked ones. */
export function ProfilePicker() {
  useApp()
  const [locked, setLocked] = useState<Profile | null>(null)
  if (!app.choosingProfile) return null
  const pick = async (p: Profile) => {
    if (p.hasPin) { setLocked(p); return }
    try { await switchProfile(p.id) } catch (e) { toast((e as Error).message) }
  }
  return (
    <div className="safe" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 28 }}>
      <div style={{ color: 'var(--text)', fontSize: 28, fontWeight: 700 }}>Chi guarda?</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 20, maxWidth: 720 }}>
        {app.profiles.map((p) => (
          <Clickable key={p.id} onClick={() => pick(p)} radius={16} style={{ width: 120, padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Avatar profile={p} selected={p.id === app.profile} />
            <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 15, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 4 }}>
              {p.name}{p.hasPin && <Icon name="lock_reset" size={14} color="var(--text3)" />}
            </div>
          </Clickable>
        ))}
      </div>
      {app.choosingProfile === 'switch' && <TextButton text="Annulla" color="var(--text2)" onClick={() => chooseProfile(false)} />}
      <PinDialog profile={locked} onClose={() => setLocked(null)} onPin={async (pin) => { await switchProfile(locked!.id, pin); setLocked(null) }} />
    </div>
  )
}

function Avatar({ profile, selected, size = 88 }: { profile: Profile; selected?: boolean; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 4, background: selected ? 'var(--accent)' : 'var(--surface)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: selected ? 'var(--onAccent)' : 'var(--text)',
      fontSize: size * 0.42, fontWeight: 700,
    }}>{profile.name.slice(0, 1).toUpperCase()}</div>
  )
}

/** Asks the PIN; [onPin] throws on a wrong one and the message is shown. */
function PinDialog({ profile, onClose, onPin, title }: { profile: Profile | null; onClose: () => void; onPin: (pin: string) => Promise<void>; title?: string }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const close = () => { setPin(''); setError(null); onClose() }
  const done = async () => {
    try { await onPin(pin); setPin(''); setError(null) } catch (e) { setPin(''); setError((e as Error).message) }
  }
  return (
    <FormDialog open={profile != null} onClose={close} title={title ?? `PIN di ${profile?.name ?? ''}`}>
      <TextField value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} label="PIN" type="password" autoComplete="off" onDone={done} autoFocus />
      {error && <div style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</div>}
      <ActionButton text="Conferma" primary onClick={done} style={{ width: '100%' }} />
    </FormDialog>
  )
}

function FormDialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Dialog open={open} onDismiss={onClose} width={420}>
      <div style={{ borderRadius: 18, background: 'var(--panel)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>{title}</div>
        {children}
      </div>
    </Dialog>
  )
}

/** Impostazioni → Profili: who is watching, add, edit the profile in use, remove the others. */
export function ProfilesSettings() {
  useApp()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [removing, setRemoving] = useState<Profile | null>(null)

  const remove = async (p: Profile, pin = '') => {
    await api(`/api/profiles/${p.id}/delete`, { method: 'POST', json: { pin } })
    await loadProfiles()
    setRemoving(null)
    toast(`Profilo ${p.name} eliminato`)
  }
  const askRemove = (p: Profile) => {
    if (p.hasPin) { setRemoving(p); return }
    if (confirm(`Eliminare il profilo "${p.name}" con i suoi preferiti, Continua a guardare e La mia lista?`)) remove(p).catch((e) => toast((e as Error).message))
  }

  return (
    <>
      <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: '20px', padding: '4px 0' }}>
        Ogni profilo ha i suoi preferiti, Continua a guardare, La mia lista e "Nascondi XXX". Con più profili, all'apertura compare "Chi guarda?".
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0' }}>
        {app.profiles.map((p) => {
          const current = p.id === app.profile
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', borderRadius: 12, padding: '10px 14px' }}>
              <Avatar profile={p} selected={current} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 15 }}>{p.name}{current ? ' · in uso' : ''}</div>
                <div style={{ color: 'var(--text3)', fontSize: 12 }}>{p.hasPin ? 'Con PIN' : 'Senza PIN'}{p.id === 0 ? ' · principale' : ''}</div>
              </div>
              {current
                ? <TextButton text="Modifica" color="var(--accent2)" onClick={() => setEditing(p)} />
                : p.id !== 0 && <TextButton text="Elimina" color="var(--danger)" onClick={() => askRemove(p)} />}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '6px 0' }}>
        {app.profiles.length > 1 && <ActionButton text="Cambia profilo" icon="person" onClick={() => chooseProfile(true)} />}
        <ActionButton text="Aggiungi profilo" icon="add" onClick={() => setAdding(true)} />
      </div>
      <EditDialog open={adding} profile={null} onClose={() => setAdding(false)} />
      <EditDialog open={editing != null} profile={editing} onClose={() => setEditing(null)} />
      <PinDialog profile={removing} title={`Elimina ${removing?.name ?? ''}`} onClose={() => setRemoving(null)} onPin={(pin) => remove(removing!, pin)} />
    </>
  )
}

/** New profile ([profile] null) or name and PIN of the one in use. */
function EditDialog({ open, profile, onClose }: { open: boolean; profile: Profile | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState(false)
  if (open && !shown) { setShown(true); setName(profile?.name ?? ''); setPin(''); setError(null) }
  if (!open && shown) setShown(false)

  const send = async (pinValue: string | undefined) => {
    try {
      if (profile) await api(`/api/profiles/${profile.id}`, { method: 'POST', json: { name, ...(pinValue !== undefined ? { pin: pinValue } : {}) } })
      else await api('/api/profiles', { method: 'POST', json: { name, pin } })
      await loadProfiles()
      onClose()
    } catch (e) { setError((e as Error).message) }
  }
  return (
    <FormDialog open={open} onClose={onClose} title={profile ? 'Modifica profilo' : 'Nuovo profilo'}>
      <TextField value={name} onChange={setName} label="Nome" autoComplete="off" autoFocus />
      <TextField value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} label={profile?.hasPin ? 'Nuovo PIN (vuoto: resta quello di prima)' : 'PIN (facoltativo, 4-8 cifre)'}
        type="password" autoComplete="new-password" onDone={() => send(pin || undefined)} />
      {error && <div style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</div>}
      <ActionButton text="Salva" primary onClick={() => send(pin || undefined)} style={{ width: '100%' }} />
      {profile?.hasPin && <TextButton text="Togli il PIN" color="var(--danger)" onClick={() => send('')} />}
    </FormDialog>
  )
}
