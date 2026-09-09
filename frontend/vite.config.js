import process from 'node:process'
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
  },
  // Прод: отдаём СОБРАННЫЙ бандл через `vite preview` (быстро, чанками), а не dev-сервер.
  // Тот же прокси /api → backend и те же разрешённые хосты, что и в dev.
  preview: {
    allowedHosts: ['okvionsales.ru', 'www.okvionsales.ru'],
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true,
        // Vision-распознавание фото накладной может отвечать дольше дефолта —
        // держим до 120с, иначе прокси отдаёт 5xx на медленный ответ бэкенда.
        timeout: 120000,
        proxyTimeout: 120000,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
 