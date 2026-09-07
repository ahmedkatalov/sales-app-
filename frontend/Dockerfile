FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# Собираем ПРОДАКШН-бандл (минифицированный, чанками) вместо dev-сервера —
# переходы между страницами становятся мгновенными (dev-сервер отдавал сотни
# несобранных модулей на каждый переход → секундные лаги на планшете).
RUN npm run build

EXPOSE 5173

# Отдаём собранный dist через vite preview (быстрый статик-сервер + SPA-fallback +
# прокси /api → backend, см. preview в vite.config.js).
CMD ["npm", "run", "preview", "--", "--host", "--port", "5173"]
