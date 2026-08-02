import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Когда сайт открыт по HTTPS (okvionsales.ru за nginx), HMR-клиент Vite должен
// подключаться по wss на внешний порт 443, иначе живая перезагрузка «молча» ломается.
// Включается ТОЛЬКО на сервере переменной HMR_PUBLIC_WSS=1 (её задаём в docker-compose
// одновременно с переходом на HTTPS). Локально (http) остаётся обычный ws — ничего не ломаем.
const publicWss = process.env.HMR_PUBLIC_WSS === '1'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  server: {
    allowedHosts: ['okvionsales.ru', 'www.okvionsales.ru'],
    host: '0.0.0.0',
    port: 5173,
    ...(publicWss ? { hmr: { protocol: 'wss', clientPort: 443 } } : {}),
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
 