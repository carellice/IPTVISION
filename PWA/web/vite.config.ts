import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = '../server/public'
// The app shows the version of the server it was built with (Impostazioni → Aggiornamenti).
const version = JSON.parse(readFileSync('../server/package.json', 'utf8')).version as string

/** Stamps the service worker with this build and the files to keep offline. */
function serviceWorker(): Plugin {
  return {
    name: 'iptvision-sw',
    apply: 'build',
    closeBundle() {
      const assets = readdirSync(join(outDir, 'assets')).map((f) => `/assets/${f}`)
      const files = ['/', '/manifest.webmanifest', '/roboto.woff2', '/logo.png', '/icon-192.png', '/icon-512.png', ...assets]
      const file = join(outDir, 'sw.js')
      const source = readFileSync(file, 'utf8')
        .replace('__BUILD__', String(Date.now()))
        .replace('__FILES__', JSON.stringify(files))
      writeFileSync(file, source)
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
