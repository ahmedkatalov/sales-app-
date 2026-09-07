// Cloudflare Worker — БЕСПЛАТНЫЙ релей к OpenRouter для серверов, откуда
// openrouter.ai заблокирован (curl https://openrouter.ai → 403).
//
// Воркер работает В СЕТИ Cloudflare (вне блокировки), поэтому до OpenRouter
// достаёт свободно. Серверу нужно лишь достучаться до <имя>.workers.dev.
//
// ─── Деплой (бесплатно, ~5 минут) ───────────────────────────────────────────
//  1. Зайди на https://dash.cloudflare.com → Workers & Pages → Create → Worker.
//  2. Дай имя (получишь адрес вида https://<имя>.<аккаунт>.workers.dev).
//  3. «Edit code» → вставь ВЕСЬ этот файл → Deploy.
//  4. В docker-compose.yml у сервиса backend (секция environment):
//       - OPENROUTER_BASE_URL=https://<имя>.<аккаунт>.workers.dev/api/v1
//       - OPENAI_API_KEY=<твой ключ OpenRouter, начинается на sk-or-...>
//  5. На сервере: cd /opt/sales-app && git pull && docker compose up -d --build
//  6. Открой «Помощник» и спроси что-нибудь.
//
// Безопасность: релей просто пробрасывает запрос на openrouter.ai вместе с твоим
// ключом в заголовке Authorization. Не публикуй адрес воркера где попало; при
// желании добавь простую проверку секрета (см. RELAY_SECRET ниже).

const UPSTREAM = "https://openrouter.ai";

// Необязательно: свой секрет. Если задашь, сервер должен слать заголовок
// "X-Relay-Secret: <то же значение>". Пусто = без проверки.
const RELAY_SECRET = "";

export default {
  async fetch(request) {
    if (RELAY_SECRET && request.headers.get("x-relay-secret") !== RELAY_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const inUrl = new URL(request.url);
    // Путь приходит как /api/v1/chat/completions → шлём на openrouter.ai тем же путём.
    const target = UPSTREAM + inUrl.pathname + inUrl.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("x-relay-secret");

    const method = request.method;
    const body = method === "GET" || method === "HEAD" ? undefined : await request.text();

    const resp = await fetch(target, { method, headers, body, redirect: "follow" });

    // Отдаём ответ OpenRouter как есть.
    const outHeaders = new Headers(resp.headers);
    outHeaders.delete("content-encoding"); // тело уже раскодировано fetch-ем
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: outHeaders });
  },
};
