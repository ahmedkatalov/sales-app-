import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  server: {
    allowedHosts: ['okvionsales.ru', 'www.okvionsales.ru'],
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: ['**/Dockerfile', '**/*.conf', '**/go.*', '**/*.go'],
    },
    proxy: {
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
 