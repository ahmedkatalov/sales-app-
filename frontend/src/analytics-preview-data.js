import { analyticsPresets, shiftAnalyticsMonth } from "./utils/analytics";

export const analyticsPreviewWorkspaces = [
  { id: 101, dataAccountId: 900101, name: "Noor Coffee · Центр", isMain: true },
  { id: 102, dataAccountId: 900102, name: "Noor Coffee · Парк", isMain: false },
  { id: 103, dataAccountId: 900103, name: "Noor Coffee · Набережная", isMain: false },
];
export const analyticsPreviewWorkspace = analyticsPreviewWorkspaces[0];
const current = analyticsPresets()[0].from;
const menu = [
  { name: "Капучино", price: 280, cost: 84 }, { name: "Латте", price: 310, cost: 96 },
  { name: "Флэт уайт", price: 270, cost: 64 }, { name: "Раф ванильный", price: 350, cost: 126 },
  { name: "Круассан с миндалём", price: 240, cost: 113 }, { name: "Чизкейк", price: 320, cost: 142 },
  { name: "Сэндвич с индейкой", price: 360, cost: 198 },
];
const datasets = new Map(analyticsPreviewWorkspaces.map((workspace, index) => {
  const folders = [{ id: 11, name: "Бар", accountId: workspace.dataAccountId }, { id: 12, name: "Кухня", accountId: workspace.dataAccountId }];
  const months = new Map(), items = new Map(), expenses = new Map();
  for (const folder of folders) {
    const list = [];
    for (let ago = 0; ago < 18; ago++) {
      if (ago === 10 || index === 2 && ago === 1 || folder.id === 12 && ago === 5) continue;
      const month = { id: folder.id * 1000 + ago + 1, folderId: folder.id, month: shiftAnalyticsMonth(current, -ago) };
      list.push(month);
      const products = (folder.id === 11 ? menu.slice(0, 4) : menu.slice(4)).map((product, i) => {
        const qty = Math.round((folder.id === 11 ? 200 : 90) * (1 + i * .28) * (1 - index * .19) * (1 + (17 - ago) * .018) * (1 + Math.sin(ago * 1.6 + i) * .2));
        return { ...product, id: i + 1, folderId: folder.id, monthId: month.id, qty, price: product.price - Math.floor(ago / 6) * 15 + index * 10, cost: product.cost - Math.floor(ago / 6) * 5 + index * 3 };
      });
      items.set(month.id, products);
      expenses.set(month.id, [
        { id: 1, category: "household", type: "Аренда", name: "Доля аренды помещения", amount: (folder.id === 11 ? 42000 : 18000) - index * 4000 },
        { id: 2, category: "household", type: "Оплата труда", name: "Смена команды", amount: (folder.id === 11 ? 65000 : 31000) - index * 7000 + ago % 3 * 1500 },
        { id: 3, category: "household", type: "Коммунальные услуги", name: "Свет и вода", amount: 4700 + index * 600 + ago % 4 * 700 },
        { id: 4, category: "household", type: "Прочее", name: "Обслуживание и расходники", amount: 2300 + ago % 3 * 850 },
      ].map((expense) => ({ ...expense, folderId: folder.id, monthId: month.id })));
    }
    months.set(folder.id, list);
  }
  return [String(workspace.dataAccountId), { folders, months, items, expenses }];
}));
let scenario = "normal", rounds = 0;
export function setAnalyticsPreviewScenario(value) { scenario = value; rounds = 0; }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
export function analyticsPreviewResponse(url, options = {}) {
  const location = new URL(window.location.href);
  if (location.searchParams.get("page") !== "analytics" && location.pathname !== "/analytics") return null;
  const parsed = new URL(url, location.origin), path = parsed.pathname.replace(/^\/api/, "");
  if (!(path === "/workspaces" || path === "/folders" || /^\/(months|items|expenses)\//.test(path))) return null;
  if (options.method && options.method !== "GET") return json({ error: "Предпросмотр аналитики доступен только для чтения" }, 400);
  const headers = new Headers(options.headers);
  const dataId = headers.get("X-Data-Account-ID") || parsed.searchParams.get("accountId") || parsed.searchParams.get("dataAccountId") || String(analyticsPreviewWorkspace.dataAccountId);
  if (path === "/workspaces") return scenario === "worker" ? json({ error: "Нет доступа к другим точкам" }, 403) : json(analyticsPreviewWorkspaces);
  if (path === "/folders" && dataId === String(analyticsPreviewWorkspace.dataAccountId)) rounds++;
  if (scenario === "load-error" || scenario === "refresh-error" && rounds > 1) return json({ error: "Демонстрационный сбой. Аналитика временно недоступна." }, 503);
  const dataset = datasets.get(dataId);
  if (!dataset) return json({ error: "Точка предпросмотра не найдена" }, 404);
  if (scenario === "point-error" && dataId === "900102" && path.startsWith("/items/")) return json({ error: "Данные точки «Парк» временно недоступны. Отчёт не собран полностью." }, 503);
  if (path === "/folders") return json(dataset.folders);
  const [, type, rawId, monthId] = path.split("/"), id = Number(rawId);
  if (type === "months") return json(scenario === "empty" ? [] : dataset.months.get(id) || []);
  if (type === "items") {
    if (scenario === "invalid") return json({ rows: [] });
    const rows = dataset.items.get(id) || [];
    return json(rows.map((row) => ({ ...row, ...(scenario === "loss" ? { cost: row.price * 1.35 } : scenario === "zero" ? { qty: 0 } : {}) })));
  }
  if (type === "expenses") return json((dataset.expenses.get(Number(monthId)) || []).map((expense) => ({ ...expense, amount: scenario === "zero" ? 0 : expense.amount })));
  return null;
}
