import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, Loading, TextField } from '../components/ui.tsx'
import { spring } from '../components/motion.ts'
import { api } from '../lib/api.ts'
import { app } from '../lib/app.ts'

/** The account on the home server, in the style of LoginScreen.kt (gradient, logo, fields). */
export function Gate({ onIn }: { onIn: (username: string) => void }) {
  const [register, setRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    if (register && password !== repeat) { setError('Le due password non coincidono.'); return }
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ username: string }>(register ? '/api/register' : '/api/login', { method: 'POST', json: { username, password, invite } })
      onIn(r.username)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="safe scroll" style={{ height: '100%', background: 'linear-gradient(to bottom, #0F1830, var(--bg))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 520, width: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="" style={{ width: 52, height: 52, borderRadius: 12 }} />
          <div style={{ marginLeft: 14 }}>
            <div style={{ color: 'var(--text)', fontSize: 28, lineHeight: '36px', fontWeight: 700 }}>IPTVISION</div>
            <div style={{ color: 'var(--text2)', fontSize: 14, lineHeight: '20px' }}>
              {register ? 'Crea il tuo account sul server di casa' : 'Accedi al server di casa'}
            </div>
          </div>
        </div>
        <div style={{ height: 6 }} />
        <TextField value={username} onChange={setUsername} label="Nome utente" autoComplete="username" />
        <TextField value={password} onChange={setPassword} label="Password" type="password"
          autoComplete={register ? 'new-password' : 'current-password'} onDone={register ? undefined : submit} />
        <AnimatePresence initial={false}>
          {register && (
            <motion.div key="reg" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={spring(1, 400)} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <TextField value={repeat} onChange={setRepeat} label="Ripeti la password" type="password" autoComplete="new-password"
                onDone={app.inviteRequired ? undefined : submit} style={{ marginTop: 2 }} />
              {app.inviteRequired && <TextField value={invite} onChange={setInvite} label="Codice invito" onDone={submit} />}
            </motion.div>
          )}
        </AnimatePresence>
        {error && <div style={{ color: 'var(--danger)', fontSize: 14, lineHeight: '20px' }}>{error}</div>}
        {busy ? <Loading text={register ? 'Creo l’account…' : 'Accesso in corso…'} style={{ padding: 8, height: 'auto' }} />
          : <ActionButton text={register ? 'Crea account' : 'Accedi'} icon="login" primary onClick={submit} style={{ width: '100%' }} />}
        <div role="button" tabIndex={0} onClick={() => { setRegister(!register); setError(null) }}
          style={{ color: 'var(--accent2)', fontSize: 14, lineHeight: '20px', cursor: 'pointer', textAlign: 'center', padding: 6 }}>
          {register ? 'Ho già un account' : 'Non hai un account? Creane uno'}
        </div>
        <div style={{ color: 'var(--text3)', fontSize: 12, lineHeight: '16px' }}>
          Ogni persona di casa ha il suo account: preferiti, Continua a guardare e account IPTV restano separati.
          IPTVISION è solo un lettore e non contiene canali.
        </div>
      </div>
    </div>
  )
}
