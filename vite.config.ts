import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
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
})
