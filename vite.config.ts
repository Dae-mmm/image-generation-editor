import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite'
import path from 'path'
import dns from 'node:dns'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

try {
  dns.setDefaultResultOrder('ipv4first')
} catch { /* ignore */ }

function falGenerateDevApi(): Plugin {
  return {
    name: 'fal-generate-dev-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      if (env.FAL_KEY) {
        process.env.FAL_KEY = env.FAL_KEY
        console.log('[fal] FAL_KEY caricata (.length=' + env.FAL_KEY.length + ')')
      } else {
        console.warn('[fal] FAL_KEY mancante in .env.local')
      }
      if (env.FAL_TLS_INSECURE === '1' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
        console.warn('[fal] TLS verify disabilitato (solo locale)')
      }

      server.middlewares.use('/api/proxy-image', (req, res) => {
        void (async () => {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: 'Method not allowed' }))
            return
          }

          const rawUrl = (req as Connect.IncomingMessage & { originalUrl?: string }).originalUrl || req.url || ''
          const imageUrl = new URL(rawUrl, 'http://localhost').searchParams.get('url') || ''
          try {
            const { fetchAllowedImage } = await import('./lib/proxy-fal-image')
            const { buffer, contentType } = await fetchAllowedImage(imageUrl)
            res.statusCode = 200
            res.setHeader('Content-Type', contentType)
            res.setHeader('Cache-Control', 'private, max-age=3600')
            res.end(buffer)
          } catch (err) {
            console.error('[api/proxy-image]', err)
            const e = err as Error & { status?: number }
            res.statusCode = e.status && e.status >= 400 && e.status < 600 ? e.status : 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: e.message || 'Proxy immagine fallito' }))
          }
        })().catch((err: Error) => {
          console.error('[api/proxy-image] handler', err)
          if (!(res as Connect.ServerResponse).headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: err.message || 'Proxy error' }))
          } else {
            res.end()
          }
        })
      })

      server.middlewares.use('/api/generate', (req, res) => {
        void (async () => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: 'Method not allowed' }))
            return
          }

          const chunks: Buffer[] = []
          await new Promise<void>((resolve) => {
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => resolve())
          })
          const raw = Buffer.concat(chunks).toString('utf8')
          const body = raw ? JSON.parse(raw) : {}

          const { runFalGenerate, formatServerFalError } = await import('./lib/run-fal-generate')
          try {
            const url = await runFalGenerate({
              imageDataUrl: body.imageDataUrl,
              imageUrl: body.imageUrl,
              prompt: String(body.prompt || ''),
            })
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ url }))
          } catch (err) {
            console.error('[api/generate]', err)
            const formatted = formatServerFalError(err)
            res.statusCode = formatted.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              message: formatted.message,
              error: formatted.message,
              body: formatted.body,
            }))
          }
        })().catch((err: Error) => {
          console.error('[api/generate] handler', err)
          if (!(res as Connect.ServerResponse).headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: err.message || 'Proxy error', error: err.message }))
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
    falGenerateDevApi(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
