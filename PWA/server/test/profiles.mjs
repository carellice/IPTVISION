// Profiles end to end: starts the server on a temporary data folder and checks that every profile
// has its own data, PINs are enforced and the main profile keeps the data from before.
// Run: npm test (in PWA/server).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'iptvision-test-'))
const port = 18000 + Math.floor(Math.random() * 1000)
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '..', 'src', 'main.ts')],
  { env: { ...process.env, DATA_DIR: dir, PORT: String(port) }, stdio: 'ignore' })
const B = `http://localhost:${port}`
for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/session'); break } catch { await new Promise((r) => setTimeout(r, 100)) } }

let failed = false
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed = true }
const call = async (path, method = 'GET', body, tok) => {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return [r.status, await r.json()]
}
try {
  let [s,u]=await call('/api/device/login','POST',{username:'mario',password:'secret12',register:true,device:'test'})
  const t=u.token
  let [,p]=await call('/api/profiles','GET',null,t); assert(p.profiles.length===1&&p.current===0,'main profile only')
  await call('/api/ops','POST',{ops:[{op:'favorite',streamId:5,on:true},{op:'myList',key:'m:1',on:true}]},t)
  ;[s,p]=await call('/api/profiles','POST',{name:'Bimbi',pin:'1234'},t); assert(s===200&&p.profiles.length===2&&p.profiles[1].hasPin,'add with pin')
  ;[s]=await call('/api/profiles','POST',{name:'x',pin:'12'},t); assert(s===400,'bad pin rejected')
  ;[s]=await call('/api/profiles/1/use','POST',{pin:'0000'},t); assert(s===403,'wrong pin')
  ;[s,p]=await call('/api/profiles/1/use','POST',{pin:'1234'},t); assert(s===200&&p.current===1&&p.state.favorites.length===0,'switch: empty state')
  await call('/api/ops','POST',{ops:[{op:'favorite',streamId:9,on:true},{op:'hideAdult',on:true}]},t)
  let [,st]=await call('/api/state','GET',null,t); assert(st.favorites.join()==='9'&&st.hideAdult===true,'profile 1 own data')
  ;[s]=await call('/api/profiles/0','POST',{name:'y'},t); assert(s===403,'edit only current')
  ;[s,p]=await call('/api/profiles/0/use','POST',{},t); assert(p.state.favorites.join()==='5'&&p.state.hideAdult===false&&'m:1' in p.state.myList,'main data intact')
  ;[s,p]=await call('/api/profiles/0','POST',{name:'Papà',pin:'5678'},t); assert(s===200&&p.profiles[0].name==='Papà'&&p.profiles[0].hasPin,'edit main')
  ;[s]=await call('/api/profiles/1/delete','POST',{pin:'1'},t); assert(s===403,'delete wrong pin')
  ;[s,p]=await call('/api/profiles/1/delete','POST',{pin:'1234'},t); assert(s===200&&p.profiles.length===1,'delete')
  ;[s]=await call('/api/profiles/0/delete','POST',{pin:'5678'},t); assert(s===400,'cannot delete current/main')

} finally {
  server.kill()
  await new Promise((r) => server.once('exit', r))
  // Windows may keep the database files locked for a moment after the server exits.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
process.exit(failed ? 1 : 0)
