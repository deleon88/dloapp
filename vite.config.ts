import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * En desarrollo, sirve las funciones de api/ (las que en producción ejecuta
 * Vercel) para que `npm run dev` funcione sin `vercel dev`: GET y POST (con su
 * cuerpo). Las rutas sin archivo en api/ (como /api/mlb) siguen al proxy de abajo.
 */
function devApiFunctions(): Plugin {
  return {
    name: 'dev-api-functions',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const file = resolve(__dirname, `.${url.pathname}.ts`)
        const method = req.method ?? 'GET'
        if (!url.pathname.startsWith('/api/') || !['GET', 'POST'].includes(method) || !existsSync(file)) return next()
        try {
          const mod = await server.ssrLoadModule(file)
          if (typeof mod[method] !== 'function') { res.statusCode = 405; res.end(); return }
          let body: Buffer | undefined
          if (method === 'POST') {
            const chunks: Buffer[] = []
            for await (const c of req) chunks.push(c as Buffer)
            body = Buffer.concat(chunks)
          }
          const response: Response = await mod[method](new Request(url, { method, headers: req.headers as HeadersInit, body }))
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Variables sin prefijo VITE_ (POSTGRES_URL…) para las funciones de api/ en desarrollo.
  // Nunca llegan al navegador: solo se usan en el proceso de Node del servidor de Vite.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [react(), devApiFunctions()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api/mlb': {
          target: 'https://statsapi.mlb.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/mlb/, '/api/v1'),
        },
        '/api/mlb-v11': {
          target: 'https://statsapi.mlb.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/mlb-v11/, '/api/v1.1'),
        },
        '/api/lmb': {
          target: 'https://lmb.com.mx',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/lmb/, '/juegos/api'),
        },
      },
    },
  }
})
