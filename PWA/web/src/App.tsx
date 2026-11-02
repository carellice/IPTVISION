import { useEffect, useState } from 'react'
import { ToastHost, Loading } from './components/ui.tsx'
import { api, authEvents } from './lib/api.ts'
import { app, screen, start, useApp } from './lib/app.ts'
import { Gate } from './screens/Gate.tsx'
import { Login } from './screens/Login.tsx'
import { Home } from './screens/Home.tsx'
import { MovieDetail, SeriesDetail } from './screens/Details.tsx'
import { Player } from './screens/Player.tsx'
import { QuizDialog, VariantDialog } from './screens/Dialogs.tsx'

type Session = { loggedIn: boolean; username: string | null; version: string; inviteRequired: boolean }

/** App gate: the PWA account first, then the screens of the Android app (MainActivity). */
export function App() {
  const [session, setSession] = useState<'loading' | 'out' | 'in'>('loading')
  useApp()

  useEffect(() => {
    api<Session>('/api/session').then((s) => {
      app.serverVersion = s.version
      app.inviteRequired = s.inviteRequired
      if (s.loggedIn && s.username) {
        setSession('in')
        start(s.username)
      } else setSession('out')
    }).catch(() => setSession('out'))
    const out = () => setSession('out')
    authEvents.addEventListener('logout', out)
    return () => authEvents.removeEventListener('logout', out)
  }, [])

  if (session === 'loading') return <div className="app" style={{ background: 'var(--bg)' }}><Loading /></div>
  if (session === 'out') {
    return (
      <div className="app">
        <Gate onIn={(username) => { setSession('in'); start(username) }} />
        <ToastHost />
      </div>
    )
  }
  const s = screen()
  return (
    <div className="app" style={{ background: 'var(--bg)' }}>
      {s.kind === 'Login' && <Login />}
      {s.kind === 'Home' && <Home />}
      {s.kind === 'MovieDetail' && <MovieDetail movie={s.movie} />}
      {s.kind === 'SeriesDetail' && <SeriesDetail series={s.series} />}
      {s.kind === 'Player' && <Player />}
      <VariantDialog />
      <QuizDialog />
      <ToastHost />
    </div>
  )
}
