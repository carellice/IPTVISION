import { useState } from 'react'
import { ActionButton, Loading, TextField } from '../components/ui.tsx'
import { app, loginXtream, useApp } from '../lib/app.ts'

/** LoginScreen.kt: the Xtream Codes account, saved on the server (its password never comes back). */
export function Login() {
  useApp()
  const [server, setServer] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const go = () => loginXtream(server, user, pass)
  return (
    <div className="safe scroll" style={{ height: '100%', background: 'linear-gradient(to bottom, #0F1830, var(--bg))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 520, width: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="" style={{ width: 52, height: 52, borderRadius: 12 }} />
          <div style={{ marginLeft: 14 }}>
            <div style={{ color: 'var(--text)', fontSize: 28, lineHeight: '36px', fontWeight: 700 }}>IPTVISION</div>
            <div style={{ color: 'var(--text2)', fontSize: 14, lineHeight: '20px' }}>Accedi al tuo account Xtream Codes</div>
          </div>
        </div>
        <div style={{ height: 6 }} />
        <TextField value={server} onChange={setServer} label="Server o link M3U" placeholder="http://server:porta oppure il link get.php completo" inputMode="url" type="url" />
        <TextField value={user} onChange={setUser} label="Nome utente" />
        <TextField value={pass} onChange={setPass} label="Password" type="password" autoComplete="off" onDone={go} />
        {app.loginError && <div style={{ color: 'var(--danger)', fontSize: 14, lineHeight: '20px' }}>{app.loginError}</div>}
        {app.loginBusy ? <Loading text="Accesso in corso…" style={{ padding: 8, height: 'auto' }} />
          : <ActionButton text="Accedi" icon="login" primary onClick={go} style={{ width: '100%' }} />}
        <div style={{ color: 'var(--text3)', fontSize: 12, lineHeight: '16px' }}>
          Se incolli il link M3U completo, nome utente e password si compilano da soli. IPTVISION è solo un lettore e non contiene canali.
        </div>
      </div>
    </div>
  )
}
