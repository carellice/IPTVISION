import { useEffect, useState } from 'react'
import { api, authEvents } from './lib/api.ts'
import { useVm, vm } from './lib/app.ts'
import { C, Loading, ToastHost, toast } from './components/ui.tsx'
import { Gate } from './screens/Gate.tsx'
import { LoginScreen } from './screens/Login.tsx'
import { HomeScreen } from './screens/Home.tsx'
import { MovieDetailScreen, SeriesDetailScreen } from './screens/Details.tsx'
import { PlayerScreen } from './screens/Player.tsx'
import { QuizDialog, VariantDialog } from './screens/Dialogs.tsx'

type Session = { loggedIn: boolean; username: string | null; version: string; inviteRequired: boolean }

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const check = () => {
    api<Session>('/api/session')
      .then(async (s) => {
        setSession(s)
        if (s.loggedIn && s.username) {
          await vm.start(s.username, s.version)
          setReady(true)
        }
      })
      .catch((e) => setFailed(e.message))
  }

  useEffect(check, [])
  useEffect(() => {
    // Una risposta 401 da qualsiasi chiamata: si torna all'accesso.
    const out = () => { setReady(false); setSession((s) => (s ? { ...s, loggedIn: false } : s)) }
    authEvents.addEventListener('logout', out)
    return () => authEvents.removeEventListener('logout', out)
  }, [])

  if (failed) return <div className="app"><Loading text={failed} /></div>
  if (!session) return <div className="app" style={{ background: C.Bg }} />
  if (!session.loggedIn || !ready) {
    if (session.loggedIn) return <div className="app"><Loading /></div>
    return (
      <div className="app">
        <Gate inviteRequired={session.inviteRequired} onDone={() => { setSession(null); check() }} />
        <ToastHost />
      </div>
    )
  }
  return <Main />
}

function Main() {
  const v = useVm()
  const s = v.screen

  // Errori: con i canali già caricati diventano un avviso, come i Toast di MainActivity.
  useEffect(() => {
    if (v.error && v.live) {
      toast(v.error, true)
      v.error = null
    }
  }, [v.error, v.live])

  return (
    <div className="app" style={{ background: C.Bg }}>
      {s.kind === 'Login' && <LoginScreen />}
      {s.kind === 'Home' && <HomeScreen />}
      {s.kind === 'MovieDetail' && <MovieDetailScreen key={s.movie.key} m={s.movie} />}
      {s.kind === 'SeriesDetail' && <SeriesDetailScreen key={s.series.key} s={s.series} />}
      {s.kind === 'Player' && <PlayerScreen />}
      <VariantDialog />
      <QuizDialog />
      <ToastHost />
    </div>
  )
}
