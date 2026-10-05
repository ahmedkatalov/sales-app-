# --- Сборка бандла ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# Продакшн-бандл (минифицированный, чанками) → dist/
RUN npm run build

# --- Отдача через nginx (продакшн-статик, многопроцессный) ---
# Раньше тут был `vite preview` — однопроцессный dev-preview, который захлёбывался
# на мобильных сетях/айфоне и ронял сайт. nginx раздаёт dist надёжно и быстро.
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
