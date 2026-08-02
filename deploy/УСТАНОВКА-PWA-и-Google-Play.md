# NoorCoffe → приложение на телефон (PWA) и Google Play

Коротко: приложение теперь можно **устанавливать на домашний экран** (Android/iPhone), а
затем — при желании — **выложить обёртку в Google Play**. Код уже готов в репозитории.
Осталось задеплоить и включить HTTPS (без него телефон установить приложение не даёт).

Порядок такой:
1. **Задеплоить код** (git pull) — появится плашка «Установить приложение».
2. **Включить HTTPS** на сервере — это обязательный ключ ко всему (установка + Play).
3. Проверить установку на телефоне.
4. (Опционально) Собрать APK/AAB и выложить в Google Play.

---

## Что уже сделано в коде (деплоить, ничего не устанавливая через npm)

- `frontend/public/manifest.webmanifest` — манифест приложения (имя, иконки, цвета).
- `frontend/public/sw.js` — сервис-воркер: делает приложение устанавливаемым и даёт
  офлайн-заглушку. **Не ломает** Vite/HMR (не трогает `/api`, `/@vite`, `/src`).
- `frontend/public/pwa-192.png`, `pwa-512.png`, `maskable-512.png`, `apple-touch-icon.png`
  — иконки (синий квадрат с корзиной, как в шапке).
- `frontend/src/pwa.js` + `frontend/src/components/InstallPrompt.jsx` — плашка
  «Установить приложение» (Android/десктоп — системная установка; iPhone — подсказка).
- `frontend/index.html` — подключены манифест, иконки, мета-теги.
- `frontend/vite.config.js` — HMR по `wss` (включается только на сервере, см. шаг 2).

> Новых npm-зависимостей нет → **пересборка контейнера не нужна**, хватает `git pull`.

---

## Шаг 1. Задеплоить код

```bash
cd ~/sales-app- && git pull
```

Проверить, что файлы отдаются (пока по http — это нормально):

```bash
curl -I http://okvionsales.ru/manifest.webmanifest   # ожидаем 200 + application/manifest+json
curl -I http://okvionsales.ru/sw.js                  # ожидаем 200
curl -I http://okvionsales.ru/pwa-512.png            # ожидаем 200
```

> ⚠️ Пока сайт по **http**, кнопка установки на телефоне **не появится** — так работает
> любой браузер (сервис-воркер и установка требуют https). Поэтому дальше — HTTPS.

---

## Шаг 2. Включить HTTPS (обязательно)

Всё делается на сервере, безопасно и обратимо (сертификат добавляется отдельно,
старый конфиг nginx сохраняем в бэкап).

### 2.1. Проверить DNS и открыть порт 443
```bash
dig +short okvionsales.ru
dig +short www.okvionsales.ru      # оба должны указывать на IP этого сервера
sudo ufw allow 443/tcp             # если используется ufw; иначе откройте 443 в панели хостинга
```

### 2.2. Поставить certbot
```bash
sudo apt update && sudo apt install -y certbot python3-certbot-nginx
```

### 2.3. Сохранить текущий конфиг nginx (чтобы можно было откатиться)
```bash
sudo grep -Rl okvionsales /etc/nginx/                 # найдёт файл вашего сайта
# подставьте найденный путь вместо <путь>:
sudo cp <путь> /root/okvionsales.nginx.bak
```

### 2.4. Получить сертификат (без переписывания вашего конфига)
```bash
sudo mkdir -p /var/www/certbot
sudo certbot certonly --nginx \
  -d okvionsales.ru -d www.okvionsales.ru \
  --agree-tos -m aaaakk12123@gmail.com --no-eff-email
sudo ls /etc/letsencrypt/live/okvionsales.ru/         # должны быть fullchain.pem и privkey.pem
```

### 2.5. Поставить готовый HTTPS-конфиг nginx
В репозитории лежит `deploy/nginx-okvionsales-https.conf` — он уже включает:
редирект http→https, тот же проксинг `/` и `/api/`, ВебСокет для HMR и отдачу
`assetlinks.json` для Google Play.

```bash
# заменить содержимое вашего файла сайта на этот (путь — из шага 2.3):
sudo cp ~/sales-app-/deploy/nginx-okvionsales-https.conf <путь>
sudo nginx -t && sudo systemctl reload nginx           # если nginx -t ругается — сайт не тронут, чините конфиг
```

### 2.6. Включить HMR по wss (одновременно с HTTPS, не раньше)
Чтобы правки продолжали «на лету» подтягиваться на боевом сайте, добавьте переменную
в сервис `frontend` в `docker-compose.yaml`:

```yaml
  frontend:
    build: ./frontend
    environment:
      - HMR_PUBLIC_WSS=1        # ← добавить эту строку
    ports:
      - "8081:5173"
    ...
```

Применить:
```bash
cd ~/sales-app- && docker compose up -d frontend
```

### 2.7. Проверить
Открыть **https://okvionsales.ru** — замок в адресной строке, сайт работает, касса
открывается. `http://okvionsales.ru` теперь редиректит на https.

> Продление сертификата работает само (certbot ставит таймер). Проверка:
> `sudo certbot renew --dry-run`.

---

## Шаг 3. Установить на телефон

**Android (Chrome):** открыть https://okvionsales.ru → внизу появится плашка
**«Установить приложение»** (или меню ⋮ → «Установить приложение»). После установки
иконка NoorCoffe — на домашнем экране, открывается без адресной строки.

**iPhone (Safari):** открыть https://okvionsales.ru → кнопка **«Поделиться»** →
**«На экран „Домой“»**. (На iPhone так работает у всех сайтов — своей кнопки установки
у iOS нет, поэтому приложение показывает подсказку.)

На этом «приложение на телефоне» уже готово и ничего не стоит. Дальше — только если
нужен именно **листинг в Google Play**.

---

## Шаг 4. (Опционально) Обёртка для Google Play

Технология — **TWA** (Trusted Web Activity): Android-приложение, которое открывает ваш
сайт на весь экран без браузерной рамки. Это официальный путь Google «PWA → Play».
Приложение реальное (касса, склад, офлайн, уведомления), поэтому проходит правило Play
о «минимальной функциональности» (пустые обёртки-сайты отклоняют).

### Что нужно (честно про роли)
- **Я (в коде)** уже подготовил: `deploy/twa-manifest.json`, `deploy/assetlinks.template.json`,
  отдачу `assetlinks.json` в nginx-конфиге.
- **Вам** нужно сделать всё, что связано с деньгами, аккаунтом, ключом подписи и загрузкой —
  это Google не разрешает делать за вас.

### 4.1. Собрать приложение (на компьютере/сервере, не в Docker)
Нужны Node 20 и JDK 17 — Bubblewrap умеет доустановить их сам.
```bash
npm i -g @bubblewrap/cli
bubblewrap doctor                     # даст доустановить JDK 17 + Android SDK
bubblewrap init --manifest https://okvionsales.ru/manifest.webmanifest
# при init сверьте значения с deploy/twa-manifest.json (packageId ru.okvionsales.app,
# targetSdkVersion 36 — обязательно для новых приложений с 31.08.2026)
bubblewrap build                      # создаст app-release-bundle.aab (+ assetlinks.json)
```
> 🔐 Файл ключа `android.keystore` и пароли — **сохраните и сделайте бэкап**. Потеря ключа
> усложняет будущие обновления.

### 4.2. Положить assetlinks.json на сервер
```bash
sudo mkdir -p /var/www/okvion/.well-known
sudo cp assetlinks.json /var/www/okvion/.well-known/assetlinks.json
sudo systemctl reload nginx
curl -sS https://okvionsales.ru/.well-known/assetlinks.json   # должен отдаться JSON
```

### 4.3. Google Play Console (делает владелец)
1. Регистрация на play.google.com/console, разовый взнос **$25**, проверка личности.
2. «Создать приложение», заполнить: описание (упомянуть офлайн/установку/уведомления —
   чтобы пройти модерацию), реальные скриншоты, иконка 512×512, политика
   конфиденциальности, возрастной рейтинг, форма «Безопасность данных».
3. Загрузить `app-release-bundle.aab` в трек **закрытого тестирования** (только AAB, APK не
   принимают). Play App Signing включится автоматически.

### 4.4. Самая частая ошибка — исправить assetlinks.json
Play **переподписывает** приложение своим ключом. Поэтому в `assetlinks.json` нужен
**SHA-256 ключа подписи Google** (Play Console → приложение → *Test and release → Setup →
App integrity → App signing*), а не только вашего upload-ключа. Скопируйте **оба**
отпечатка в `sha256_cert_fingerprints` (шаблон — `deploy/assetlinks.template.json`),
снова залейте файл (шаг 4.2). Если этого не сделать — приложение откроется, но **с
браузерной рамкой** вместо полноэкранного вида.

### 4.5. Тестирование и продакшн
Для **личного** аккаунта Google (созданного после 13.11.2023) перед публикацией нужно
провести закрытый тест: **минимум 12 тестировщиков, непрерывно 14 дней**, затем «Запросить
доступ к production» (проверка обычно ≤7 дней). У **организационного** аккаунта (нужен
D-U-N-S) этого требования нет.

---

## Откат, если что-то пошло не так
- nginx: `sudo cp /root/okvionsales.nginx.bak <путь> && sudo systemctl reload nginx`.
- Код: изменения обратимы через `git revert` (данные не трогаются, контейнеры не пересобираются).
- Сертификат добавляется отдельно и на работу приложения не влияет.

---

## Частые вопросы
- **Пересобирать контейнеры для PWA?** Нет. Новых зависимостей нет → только `git pull`.
  Пересборка/`docker compose up -d` нужны только для шага 2.6 (переменная HMR) и обычных обновлений.
- **Плашка установки не появляется?** Проверьте: сайт по **https**, в DevTools → Application →
  Manifest нет ошибок, Service Worker «activated». На http её не будет никогда.
- **Стоит ли Google Play?** Установка на домашний экран (шаги 1–3) — бесплатно и сразу.
  Play нужен только если хотите присутствие в магазине; это $25 + время на тест.
