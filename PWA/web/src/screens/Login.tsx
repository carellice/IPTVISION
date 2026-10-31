// ui/LoginScreen.kt
import { useState } from 'react'
import { useVm } from '../lib/app.ts'
import { ActionButton, C, Loading, TextField } from '../components/ui.tsx'

export function LoginScreen() {
  const vm = useVm()
  const [server, setServer] = useState(vm.account?.server ?? '')
  const [user, setUser] = useState(vm.account?.username ?? '')
  const [pass, setPass] = useState('')
  const go = () => void vm.login(server, user, pass)

  return (
    <div className="scroll status-pad nav-pad" style={{ height: '100%', background: `linear-gradient(to bottom, #0F1830, ${C.Bg})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="col" style={{ maxWidth: 520, width: '100%', padding: 24, gap: 14, margin: 'auto 0' }}>
        <div className="row">
          <img src="/logo.png" alt="" style={{ width: 52, height: 52, borderRadius: 12 }} />
          <div style={{ width: 14 }} />
          <div className="col">
            <span style={{ color: C.Text, fontSize: 28, fontWeight: 700 }}>IPTVISION</span>
            <span style={{ color: C.Text2, fontSize: 14 }}>Accedi al tuo account Xtream Codes</span>
          </div>
        </div>
        <div style={{ height: 6 }} />
        <TextField value={server} onChange={setServer} label="Server o link M3U" placeholder="http://server:porta oppure il link get.php completo" inputMode="url" enterKeyHint="next" />
        <TextField value={user} onChange={setUser} label="Nome utente" enterKeyHint="next" />
        <TextField value={pass} onChange={setPass} label="Password" type="password" autoComplete="off" enterKeyHint="done" onDone={go} />
        {vm.loginError && <span style={{ color: C.Danger, fontSize: 14 }}>{vm.loginError}</span>}
        {vm.loginBusy
          ? <Loading text="Accesso in corso…" style={{ padding: 8, height: 'auto' }} />
          : <ActionButton text="Accedi" icon="login" primary onClick={go} style={{ width: '100%' }} />}
        <span style={{ color: C.Text3, fontSize: 12 }}>
          Se incolli il link M3U completo, nome utente e password si compilano da soli. IPTVISION è solo un lettore e non contiene canali.
        </span>
      </div>
    </div>
  )
}
