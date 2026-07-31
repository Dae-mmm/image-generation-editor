import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite'
import path from 'path'
import dns from 'node:dns'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { proxyFalRequest } from './api/fal/_proxyCore'

try {
  dns.setDefaultResultOrder('ipv4first')
} catch { /* ignore */ }

function falDevProxy(): Plugin {
  return {
    name: 'fal-dev-proxy',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      if (env.FAL_KEY) {
        process.env.FAL_KEY = env.FAL_KEY
        console.log('[fal] FAL_KEY caricata da .env (.length=' + env.FAL_KEY.length + ')')
      } else {
        console.warn('[fal] FAL_KEY mancante: crea .env.local con FAL_KEY=...')
      }

      // On some Windows setups Node fetch→Fal fails TLS verify ("fetch failed").
      // Opt in via .env.local: FAL_TLS_INSECURE=1  (or NODE_TLS_REJECT_UNAUTHORIZED=0)
      if (env.FAL_TLS_INSECURE === '1' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
        console.warn('[fal] TLS verify disabilitato (solo locale)')
      }

      server.middlewares.use('/api/fal/proxy', (req, res) => {
        void (async () => {
          const chunks: Buffer[] = []
          await new Promise<void>((resolve) => {
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => resolve())
          })
          const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined

          await proxyFalRequest({
            method: req.method,
            headers: req.headers,
            body,
            res,
          })
        })().catch((err: Error) => {
          console.error('[fal-proxy] handler error', err)
          if (!(res as Connect.ServerResponse).headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              message: err.message || 'Proxy error',
              error: err.message || 'Proxy error',
            }))
          } else {
            res.end()
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    falDevProxy(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
