// Accesso alla PWA: ogni persona di casa ha il suo account, con il suo IPTV, i suoi preferiti e
// Continua a guardare. Stesso stile della schermata di accesso dell'app (LoginScreen.kt).
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { api, ApiError } from '../lib/api.ts'
import { ActionButton, C, Loading, TextField } from '../components/ui.tsx'
import { spring } from '../components/motion.ts'

export function Gate({ inviteRequired, onDone }: { inviteRequired: boolean; onDone: () => void }) {
  const [register, setRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    setError(null)
    if (register && password !== repeat) { setError('Le due password non coincidono.'); return }
    setBusy(true)
    try {
      await api(register ? '/api/register' : '/api/login', { method: 'POST', json: { username, password, code } })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Errore')
      setBusy(false)
    }
  }

  return (
    <div className="scroll status-pad nav-pad" style={{ height: '100%', background: `linear-gradient(to bottom, #0F1830, ${C.Bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form className="col" onSubmit={(e) => { e.preventDefault(); void submit() }}
        style={{ maxWidth: 520, width: '100%', padding: 24, gap: 14, margin: 'auto 0' }}>
        <div className="row">
          <img src="/logo.png" alt="" style={{ width: 52, height: 52, borderRadius: 12 }} />
          <div style={{ width: 14 }} />
          <div className="col">
            <span style={{ color: C.Text, fontSize: 28, fontWeight: 700 }}>IPTVISION</span>
            <span style={{ color: C.Text2, fontSize: 14 }}>
              {register ? 'Crea il tuo account IPTVISION' : 'Bentornato: accedi al tuo account'}
            </span>
          </div>
        </div>
        <div style={{ height: 6 }} />
        <TextField value={username} onChange={setUsername} label="Nome utente" autoComplete="username" name="username" enterKeyHint="next" />
        <TextField value={password} onChange={setPassword} label="Password" type="password" autoComplete={register ? 'new-password' : 'current-password'} name="password"
          enterKeyHint={register ? 'next' : 'go'} onDone={register ? undefined : () => void submit()} />
        <AnimatePresence initial={false}>
          {register && (
            <motion.div key="extra" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={spring(1, 400)} style={{ overflow: 'hidden' }}>
              <div className="col" style={{ gap: 14, paddingTop: 6 }}>
                <TextField value={repeat} onChange={setRepeat} label="Ripeti la password" type="password" autoComplete="new-password" enterKeyHint={inviteRequired ? 'next' : 'go'}
                  onDone={inviteRequired ? undefined : () => void submit()} />
                {inviteRequired && <TextField value={code} onChange={setCode} label="Codice invito" enterKeyHint="go" onDone={() => void submit()} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {error && <span style={{ color: C.Danger, fontSize: 14 }}>{error}</span>}
        {busy
          ? <Loading text={register ? 'Creazione dell\'account…' : 'Accesso in corso…'} style={{ padding: 8, height: 'auto' }} />
          : <ActionButton text={register ? 'Crea account' : 'Entra'} icon="login" primary onClick={() => void submit()} style={{ width: '100%' }} />}
        <button type="submit" hidden />
        <span onClick={() => { setRegister(!register); setError(null) }} role="button" tabIndex={0}
          style={{ color: C.Accent2, fontSize: 14, textAlign: 'center', padding: 8, cursor: 'pointer' }}>
          {register ? 'Hai già un account? Entra' : 'Prima volta qui? Crea un account'}
        </span>
        <span style={{ color: C.Text3, fontSize: 12 }}>
          L'account IPTVISION resta su questo server: dopo l'accesso inserisci i dati del tuo servizio IPTV. IPTVISION è solo un lettore e non contiene canali.
        </span>
      </form>
    </div>
  )
}
