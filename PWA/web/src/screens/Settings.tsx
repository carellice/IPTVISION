import { type ReactNode, useEffect, useState } from 'react'
import { ActionButton, Clickable, Dialog, SectionTitle, Switch, TextButton, TextField, toast } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { NetworkStatus } from '../components/network.tsx'
import { app, clearCache, logoutXtream, refreshAll, setHideAdult, updateSettings, useApp } from '../lib/app.ts'

// SettingsSection (ui/SearchSettings.kt) plus what the browser version adds: the account on the
// home server, the devices connected to it and how to use it from the IPTVISION apps.

type Device = { id: string; device: string; createdAt: number; lastSeen: number; current: boolean }

const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
const seenFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function SettingsSection() {
  useApp()
  const [expires, setExpires] = useState<string | null>(null)
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [update, setUpdate] = useState<string | null>(null)

  useEffect(() => {
    api<{ expiresAt: number | null }>('/api/xtream/info')
      .then((i) => setExpires(i.expiresAt ? dateFmt.format(i.expiresAt * 1000) : 'Nessuna'))
      .catch(() => setExpires(null))
    api<Device[]>('/api/devices').then(setDevices).catch(() => setDevices([]))
  }, [])

  const disconnect = async (d: Device) => {
    try { setDevices(await api<Device[]>(`/api/devices/${d.id}`, { method: 'DELETE' })) } catch (e) { toast((e as Error).message) }
  }

  const logout = async () => {
    try { await api('/api/logout', { method: 'POST' }) } catch { /* the cookie goes anyway */ }
    location.reload()
  }

  const checkUpdates = async () => {
    setUpdate('Controllo in corso…')
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
    if (!reg) { setUpdate(`Versione del server ${app.serverVersion}. Gli aggiornamenti arrivano da soli ogni notte.`); return }
    await reg.update().catch(() => {})
    await new Promise((r) => setTimeout(r, 1500))
    if (reg.waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload())
      reg.waiting.postMessage('skipWaiting')
      setUpdate('Nuova versione: la applico…')
    } else setUpdate(`Hai già l'ultima versione (${app.serverVersion}).`)
  }

  const address = location.origin
  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div style={{ maxWidth: 760 }}>
        <SectionTitle title="Impostazioni" />
        <div style={{ height: 16 }} />

        <Group title="Account" />
        <Info label="Server" value={app.xtream?.server ?? ''} />
        <Info label="Utente" value={app.xtream?.username ?? ''} />
        {expires && <Info label="Scadenza" value={expires} />}

        <Group title="Riproduzione" />
        <Toggle title="Riprendi l'ultimo canale all'avvio" subtitle="Apri l'app e il canale riparte da dov'eri rimasto."
          checked={app.settings.autoPlayLast} onChange={(v) => updateSettings({ autoPlayLast: v })} />
        <Toggle title="Nascondi XXX" subtitle="Toglie canali, film e serie delle categorie con XXX nel nome."
          checked={app.hideAdult} onChange={setHideAdult} />

        <Group title="Dati" />
        <Row>
          <ActionButton text="Aggiorna liste e guida" icon="refresh" onClick={() => { refreshAll(); toast('Aggiorno liste e guida…') }} />
          <ActionButton text="Svuota cache" icon="delete" onClick={() => { clearCache(); toast('Cache svuotata') }} />
        </Row>

        <Group title="Server di casa" />
        <Info label="Accesso" value={app.username} />
        <div style={{ padding: '6px 0' }}><NetworkStatus detail /></div>
        <Text>
          Per guardare dalle app IPTVISION di Android, Windows o dei TV LG e Samsung passando da questo server, apri nelle loro
          impostazioni "Server di casa" e scrivi <b style={{ color: 'var(--text)' }}>{address}</b> (oppure l'indirizzo IP del server
          con la porta), poi accedi con questo stesso account.
        </Text>
        {devices && devices.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
            {devices.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', borderRadius: 12, padding: '10px 14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 15 }}>{d.device}{d.current ? ' · questo' : ''}</div>
                  <div style={{ color: 'var(--text3)', fontSize: 12 }}>Ultimo uso {seenFmt.format(d.lastSeen)}</div>
                </div>
                {!d.current && <TextButton text="Scollega" color="var(--danger)" onClick={() => disconnect(d)} />}
              </div>
            ))}
          </div>
        )}
        <Row>
          <ActionButton text="Cambia password" icon="lock_reset" onClick={() => setPasswordOpen(true)} />
          <ActionButton text="Esci" icon="logout" onClick={logout} />
        </Row>

        <Group title="Aggiornamenti" />
        <Info label="Versione installata" value={app.serverVersion} />
        {update && <div style={{ color: 'var(--text2)', fontSize: 13, padding: '6px 0' }}>{update}</div>}
        <Row><ActionButton text="Controlla ora" icon="system_update" onClick={checkUpdates} /></Row>

        <Group title="" />
        <Row>
          <ActionButton text="Esci dall'account" icon="logout" onClick={logoutXtream} />
          <ActionButton text="Elimina account" icon="delete" onClick={() => setDeleteOpen(true)} />
        </Row>
        <div style={{ height: 8 }} />
        <div style={{ color: 'var(--text3)', fontSize: 12 }}>
          IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.
        </div>
        <div style={{ height: 24 }} />
      </div>
      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <DeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  )
}

function Group({ title }: { title: string }) {
  return (
    <div style={{ paddingTop: 18, paddingBottom: 6 }}>
      {title && <div style={{ color: 'var(--text3)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>{title.toUpperCase()}</div>}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '6px 0' }}>{children}</div>
}

function Text({ children }: { children: ReactNode }) {
  return <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: '20px', padding: '4px 0', userSelect: 'text' }}>{children}</div>
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', padding: '6px 0', minWidth: 0 }}>
      <div style={{ color: 'var(--text2)', minWidth: 160, flexShrink: 0 }}>{label}</div>
      <div className="ellipsis" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function Toggle({ title, subtitle, checked, onChange }: { title: string; subtitle?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Clickable onClick={() => onChange(!checked)} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', margin: '3px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--text)', fontSize: 15 }}>{title}</div>
        {subtitle && <div style={{ color: 'var(--text3)', fontSize: 12 }}>{subtitle}</div>}
      </div>
      <div style={{ width: 10 }} />
      <Switch checked={checked} />
    </Clickable>
  )
}

function FormDialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog open={open} onDismiss={onClose} width={420}>
      <div style={{ borderRadius: 18, background: 'var(--panel)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>{title}</div>
        {children}
      </div>
    </Dialog>
  )
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (password !== repeat) { setError('Le due password non coincidono.'); return }
    try {
      await api('/api/account/password', { method: 'POST', json: { current, password } })
      toast('Password cambiata')
      setCurrent(''); setPassword(''); setRepeat(''); setError(null)
      onClose()
    } catch (e) { setError((e as Error).message) }
  }
  return (
    <FormDialog open={open} onClose={onClose} title="Cambia password">
      <TextField value={current} onChange={setCurrent} label="Password attuale" type="password" autoComplete="current-password" />
      <TextField value={password} onChange={setPassword} label="Nuova password" type="password" autoComplete="new-password" />
      <TextField value={repeat} onChange={setRepeat} label="Ripeti la nuova password" type="password" autoComplete="new-password" onDone={save} />
      {error && <div style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</div>}
      <ActionButton text="Salva" primary onClick={save} style={{ width: '100%' }} />
    </FormDialog>
  )
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    try {
      await api('/api/account/delete', { method: 'POST', json: { password } })
      location.reload()
    } catch (e) { setError((e as Error).message) }
  }
  return (
    <FormDialog open={open} onClose={onClose} title="Elimina account">
      <div style={{ color: 'var(--text2)', fontSize: 14, lineHeight: '20px' }}>
        Vanno via account, preferiti, Continua a guardare e account IPTV salvato. Le app collegate a questo account si scollegano.
      </div>
      <TextField value={password} onChange={setPassword} label="Password" type="password" autoComplete="current-password" onDone={remove} />
      {error && <div style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</div>}
      <Clickable onClick={remove} radius={10} background="var(--danger)" style={{ padding: '12px 18px', textAlign: 'center' }}>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>Elimina per sempre</span>
      </Clickable>
    </FormDialog>
  )
}
