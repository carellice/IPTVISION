import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = '../server/public'

/** Stamps the service worker with this build and the files to keep offline. */
function serviceWorker(): Plugin {
  return {
    name: 'iptvision-sw',
    apply: 'build',
    closeBundle() {
      const assets = readdirSync(join(outDir, 'assets')).map((f) => `/assets/${f}`)
      const files = ['/', '/manifest.webmanifest', '/roboto.woff2', '/icon-192.png', '/badge.png', '/icon-512.png',
        '/skeuo/linen.png', '/skeuo/leather.png', '/skeuo/metal-dark.png', ...assets]
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
  build: { outDir, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:8080',
      '/images': 'http://localhost:8080',
    },
  },
})
