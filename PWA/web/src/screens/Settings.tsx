// Impostazioni di ui/SearchSettings.kt, con in più l'account IPTVISION di questo server.
import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api.ts'
import { useVm } from '../lib/app.ts'
import { appVersion, checkUpdate, installUpdate } from '../lib/updates.ts'
import { ActionButton, C, Clickable, Dialog, SectionTitle, Switch, TextButton, TextField, toast } from '../components/ui.tsx'

let checkedAtStart = false

export function SettingsSection() {
  const vm = useVm()
  const s = vm.settings
  const [update, setUpdate] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'password' | 'delete' | null>(null)

  const check = async (silent: boolean) => {
    if (!silent) setMessage('Controllo in corso…')
    try {
      const v = await checkUpdate()
      setUpdate(v)
      setMessage(v == null && !silent ? `Hai già l'ultima versione (${appVersion}).` : null)
    } catch {
      setMessage(silent ? null : 'Impossibile controllare gli aggiornamenti.')
    }
  }

  useEffect(() => {
    if (s.autoCheckUpdates && !checkedAtStart) { checkedAtStart = true; void check(true) }
  }, [])

  const leave = async () => {
    try { await api('/api/logout', { method: 'POST' }) } catch { /* comunque fuori */ }
    location.reload()
  }

  return (
    <div className="scroll" style={{ height: '100%' }}>
      <div className="col" style={{ maxWidth: 760 }}>
        <SectionTitle title="Impostazioni" />
        <div style={{ height: 16 }} />

        <Group title="Account" />
        <Info label="Server" value={vm.account?.server ?? ''} />
        <Info label="Utente" value={vm.account?.username ?? ''} />

        <Group title="Riproduzione" />
        <Toggle title="Formato HLS (m3u8) per la TV in diretta" subtitle="Di solito MPEG-TS è più stabile; prova HLS se un canale non parte."
          checked={s.outputFormat === 'm3u8'} onChange={(on) => vm.updateSettings({ outputFormat: on ? 'm3u8' : 'ts' })} />
        {vm.ffmpeg && (
          <Toggle title="Converti l'audio della TV in diretta" subtitle="Molti canali del digitale hanno l'audio in MP2 o AC3, che il browser non riproduce: il server lo converte."
            checked={s.convertLiveAudio} onChange={(on) => vm.updateSettings({ convertLiveAudio: on })} />
        )}
        <Toggle title="Riprendi l'ultimo canale all'avvio" subtitle="Apri l'app e il canale riparte da dov'eri rimasto."
          checked={s.autoPlayLastChannel} onChange={(on) => vm.updateSettings({ autoPlayLastChannel: on })} />
        <Toggle title="Nascondi XXX" subtitle="Toglie canali, film e serie delle categorie con XXX nel nome." checked={s.hideAdult} onChange={(on) => vm.setHideAdult(on)} />

        <Group title="Dati" />
        <div className="row" style={{ gap: 10, padding: '6px 0', flexWrap: 'wrap' }}>
          <ActionButton text="Aggiorna liste e guida" icon="refresh" onClick={() => void vm.refreshAll()} />
          <ActionButton text="Svuota cache" icon="delete" onClick={() => void vm.clearCache()} />
        </div>

        <Group title="Aggiornamenti" />
        <Info label="Versione installata" value={appVersion} />
        <Toggle title="Controlla aggiornamenti all'avvio" subtitle={null} checked={s.autoCheckUpdates} onChange={(on) => vm.updateSettings({ autoCheckUpdates: on })} />
        {update && <div style={{ color: C.Accent2, fontWeight: 600, paddingTop: 8 }}>Disponibile IPTVISION {update}</div>}
        {message && <div style={{ color: C.Text2, fontSize: 13, padding: '6px 0' }}>{message}</div>}
        <div className="row" style={{ gap: 10, padding: '6px 0' }}>
          {update
            ? <ActionButton text={`Aggiorna a ${update}`} icon="system_update" primary onClick={() => void installUpdate()} />
            : <ActionButton text="Controlla ora" icon="system_update" onClick={() => void check(false)} />}
        </div>

        <Group title="Account IPTVISION" />
        <div style={{ color: C.Text2, fontSize: 13, paddingBottom: 6 }}>Sei entrato come {vm.username}</div>
        <div className="row" style={{ gap: 10, padding: '6px 0', flexWrap: 'wrap' }}>
          <ActionButton text="Cambia password" icon="lock" onClick={() => setSheet('password')} />
          <ActionButton text="Esci da IPTVISION" icon="person" onClick={() => void leave()} />
        </div>
        <div className="row" style={{ padding: '6px 0' }}>
          <TextButton label="Elimina account" color={C.Danger} onClick={() => setSheet('delete')} />
        </div>

        <Group title="" />
        <div className="row" style={{ padding: '6px 0' }}>
          <ActionButton text="Esci dall'account" icon="logout" onClick={() => void vm.logout()} />
        </div>
        <div style={{ height: 8 }} />
        <div style={{ color: C.Text3, fontSize: 12 }}>
          IPTVISION è solo un lettore e non contiene canali. Va usato con un servizio IPTV a cui si ha diritto di accedere.
        </div>
        <div style={{ height: 24 }} />
      </div>
      <PasswordDialog open={sheet === 'password'} onClose={() => setSheet(null)} />
      <DeleteDialog open={sheet === 'delete'} onClose={() => setSheet(null)} />
    </div>
  )
}

function Group({ title }: { title: string }) {
  return (
    <>
      <div style={{ height: 18 }} />
      {title !== '' && <div style={{ color: C.Text3, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>{title.toUpperCase()}</div>}
      <div style={{ height: 6 }} />
    </>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ padding: '6px 0' }}>
      <span style={{ color: C.Text2, minWidth: 160, flex: 'none' }}>{label}</span>
      <span className="ellipsis" style={{ color: C.Text }}>{value}</span>
    </div>
  )
}

function Toggle({ title, subtitle, checked, onChange }: { title: string; subtitle: string | null; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ padding: '3px 0' }}>
      <Clickable focusScale={1.01} onClick={() => onChange(!checked)}>
        <div className="row" style={{ padding: '10px 14px' }}>
          <div className="col grow">
            <span style={{ color: C.Text, fontSize: 15 }}>{title}</span>
            {subtitle && <span style={{ color: C.Text3, fontSize: 12 }}>{subtitle}</span>}
          </div>
          <div style={{ width: 10 }} />
          <Switch checked={checked} />
        </div>
      </Clickable>
    </div>
  )
}

function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="col" style={{ background: C.Panel, borderRadius: 18, padding: 20, gap: 14 }}>
      <div style={{ color: C.Text, fontSize: 20, fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  )
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setCurrent(''); setNext(''); setRepeat(''); setError(null) } }, [open])
  const save = async () => {
    if (next !== repeat) { setError('Le due password non coincidono.'); return }
    try {
      await api('/api/account/password', { method: 'POST', json: { current, password: next } })
      toast('Password cambiata')
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Errore')
    }
  }
  return (
    <Dialog open={open} onDismiss={onClose}>
      <Sheet title="Cambia password">
        <TextField value={current} onChange={setCurrent} label="Password attuale" type="password" autoComplete="current-password" />
        <TextField value={next} onChange={setNext} label="Nuova password" type="password" autoComplete="new-password" />
        <TextField value={repeat} onChange={setRepeat} label="Ripeti la nuova password" type="password" autoComplete="new-password" onDone={() => void save()} />
        {error && <span style={{ color: C.Danger, fontSize: 14 }}>{error}</span>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <TextButton label="Indietro" color={C.Text2} onClick={onClose} />
          <TextButton label="Salva" onClick={() => void save()} />
        </div>
      </Sheet>
    </Dialog>
  )
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setPassword(''); setError(null) } }, [open])
  const remove = async () => {
    try {
      await api('/api/account/delete', { method: 'POST', json: { password } })
      try { localStorage.clear() } catch { /* niente */ }
      location.reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Errore')
    }
  }
  return (
    <Dialog open={open} onDismiss={onClose}>
      <Sheet title="Elimina account">
        <div style={{ color: C.Text2, fontSize: 14 }}>Si cancellano dal server l'accesso IPTV, i preferiti e Continua a guardare di questo account. Non si torna indietro.</div>
        <TextField value={password} onChange={setPassword} label="Password" type="password" autoComplete="current-password" onDone={() => void remove()} />
        {error && <span style={{ color: C.Danger, fontSize: 14 }}>{error}</span>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <TextButton label="Indietro" color={C.Text2} onClick={onClose} />
          <TextButton label="Elimina" color={C.Danger} onClick={() => void remove()} />
        </div>
      </Sheet>
    </Dialog>
  )
}
