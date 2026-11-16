import { type ReactNode, useEffect, useState } from 'react'
import { ActionButton, Clickable, Dialog, Pill, SectionTitle, Switch, TextButton, TextField, toast } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { NetworkStatus } from '../components/network.tsx'
import { type Skin, setSkin, useSkin } from '../lib/skin.ts'
import { type XtreamList, addXtreamList, app, clearCache, logoutXtream, refreshAll, setHideAdult, setTmdb, updateSettings, useApp, switchXtreamList } from '../lib/app.ts'
import { checkKey, hasTmdb } from '../lib/tmdb.ts'
import { ProfilesSettings } from './Profiles.tsx'

// SettingsSection (ui/SearchSettings.kt) plus what the browser version adds: the account on the
// home server, the devices connected to it and how to use it from the IPTVISION apps.

type Device = { id: string; device: string; createdAt: number; lastSeen: number; current: boolean }

const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
const seenFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function SettingsSection() {
  useApp()
  const [expires, setExpires] = useState<string | null>(null)
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [lists, setLists] = useState<XtreamList[]>([])
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [update, setUpdate] = useState<string | null>(null)
  const skin = useSkin()

  useEffect(() => {
    api<{ expiresAt: number | null }>('/api/xtream/info')
      .then((i) => setExpires(i.expiresAt ? dateFmt.format(i.expiresAt * 1000) : 'Nessuna'))
      .catch(() => setExpires(null))
      // After /info: it has just written the expiry of the active list.
      .finally(() => api<XtreamList[]>('/api/xtream/lists').then(setLists).catch(() => {}))
    api<Device[]>('/api/devices').then(setDevices).catch(() => setDevices([]))
  }, [])

  const disconnect = async (d: Device) => {
    try { setDevices(await api<Device[]>(`/api/devices/${d.id}`, { method: 'DELETE' })) } catch (e) { toast((e as Error).message) }
  }

  const removeList = async (l: XtreamList) => {
    if (!confirm(`Rimuovere la lista "${l.alias}"?`)) return
    try { setLists(await api<XtreamList[]>(`/api/xtream/lists/${l.index}`, { method: 'DELETE' })) } catch (e) { toast((e as Error).message); return }
    if (l.active) await logoutXtream()
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

        <Group title="Profili" />
        <ProfilesSettings />

        <Group title="Liste IPTV" />
        {lists.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '4px 0' }}>
            {lists.map((l) => (
              <div key={l.index} style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', borderRadius: 12, padding: '10px 14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis" style={{ color: 'var(--text)', fontSize: 15 }}>{l.alias}{l.active ? ' · in uso' : ''}</div>
                  <div className="ellipsis" style={{ color: 'var(--text3)', fontSize: 12 }}>
                    {l.username} · {l.server} · {l.expiresAt ? `scade il ${dateFmt.format(l.expiresAt * 1000)}` : 'nessuna scadenza'}
                  </div>
                </div>
                {!l.active && <TextButton text="Usa" color="var(--accent2)" onClick={() => switchXtreamList(l.index)} />}
                <TextButton text="Rimuovi" color="var(--danger)" onClick={() => removeList(l)} />
              </div>
            ))}
          </div>
        )}
        <Row><ActionButton text="Aggiungi lista" icon="list" onClick={addXtreamList} /></Row>

        <Group title="Aspetto" />
        <Text>Stile grafico di questo dispositivo.</Text>
        <Row>
          {skins.map(([s, label]) => <Pill key={s} text={label} selected={skin === s} onClick={() => setSkin(s)} />)}
        </Row>
        <Text>{skinNotes[skin]}</Text>

        <Group title="TMDB" />
        <TmdbKey />

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

const skins: [Skin, string][] = [['classic', 'Moderno'], ['skeuo', 'Skeuomorfico'], ['metro', 'Modern UI'], ['dueffe', 'Dueffe'], ['nothing', 'Nothing']]
const skinNotes: Record<Skin, string> = {
  classic: 'Lo stile di sempre: scuro, arrotondato, menu in basso o di lato.',
  skeuo: 'Pelle, lino, metallo spazzolato e pulsanti lucidi.',
  metro: 'Lo stile di Windows Phone: nero, piatto, angoli vivi, titoli grandi e sezioni da scorrere in alto.',
  dueffe: 'Fondo quasi nero, superfici calde, avorio e oro, angoli morbidi e pulsanti che rimbalzano.',
  nothing: 'Nero OLED, bianco e un solo rosso, caratteri a matrice di punti e monospazio, linee sottili al posto delle ombre.',
}

/** The TMDB key of this device: with it films and series become one screen with artwork, trends and genres. */
function TmdbKey() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    if (value.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await checkKey(value)
      setTmdb(value)
      setValue('')
      toast('Chiave TMDB salvata: trovi tutto in "Film e serie"')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <Text>
        Con una chiave di themoviedb.org (la "Chiave API" o il "Token di accesso in lettura" che trovi nel tuo profilo TMDB,
        alla voce API) film e serie diventano una sola schermata, con copertine, tendenze e generi. La chiave vale per tutto l'account: la ricevono anche le app collegate a questo server.
      </Text>
      {hasTmdb() ? (
        <>
          <Info label="Chiave" value="Inserita" />
          <Row><ActionButton text="Rimuovi chiave" icon="delete" onClick={() => setTmdb('')} /></Row>
        </>
      ) : (
        <>
          <TextField value={value} onChange={setValue} label="Chiave API o token TMDB" type="password" autoComplete="off" onDone={save} style={{ maxWidth: 520, marginTop: 6 }} />
          {error && <div style={{ color: 'var(--danger)', fontSize: 14, paddingTop: 6 }}>{error}</div>}
          <Row><ActionButton text={busy ? 'Controllo…' : 'Salva chiave'} icon="check" primary disabled={busy} onClick={save} /></Row>
        </>
      )}
    </>
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
