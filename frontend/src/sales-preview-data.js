import { businessISO, getDayStartHour } from "./utils/format";

// This report uses only synthetic receipts. Every request stays in memory.
const menu = [
  { name: "Капучино", price: 280, cost: 78 }, { name: "Латте", price: 310, cost: 92 },
  { name: "Флэт уайт", price: 270, cost: 65 }, { name: "Американо", price: 190, cost: 39 },
  { name: "Круассан с миндалём", price: 240, cost: 115 }, { name: "Раф ванильный", price: 350, cost: 124 },
  { name: "Чизкейк", price: 320, cost: 135 }, { name: "Матча на овсяном", price: 340, cost: 105 },
];
const seed = [];
let id = 4000;
for (let ago = 89; ago >= 0; ago--) {
  const date = new Date(); date.setDate(date.getDate() - ago);
  if (date.getDate() % 13 === 0) continue;
  const count = 8 + (ago * 7 + date.getDate()) % 19;
  for (let i = 0; i < count; i++) {
    const product = menu[(i * 3 + ago) % menu.length];
    const items = [{ ...product, qty: i % 5 === 0 ? 2 : 1, productId: (i * 3 + ago) % menu.length + 1, isExtra: false }];
    if (i % 4 === 0) items.push({ name: "Круассан с миндалём", price: 240, cost: 115, qty: 1, productId: 5, isExtra: false });
    if (i % 6 === 0) items.push({ name: "Сироп к напитку", price: 40, cost: 8, qty: 1, productId: 20, isExtra: true });
    items.forEach((item) => { item.total = item.price * item.qty; });
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const discountPercent = i % 7 === 0 ? 10 : 0, discountAmount = subtotal * discountPercent / 100, total = subtotal - discountAmount;
    const created = new Date(date); created.setHours(Math.max(getDayStartHour(), [8, 9, 10, 12, 13, 13, 14, 16, 17, 18, 19][i % 11]), i * 7 % 60, 0, 0);
    const paymentType = i % 3 === 0 ? "cash" : "transfer";
    const cashGiven = paymentType === "cash" ? Math.ceil(total / 500) * 500 : 0;
    seed.push({ id: ++id, createdAt: created.toISOString(), paymentType, cardName: paymentType === "transfer" ? i % 2 ? "Сбер · основная" : "Т-Банк" : "", employeeName: i % 2 ? "Анна" : "Михаил", employeeId: i % 2 + 1, subtotal, discountPercent, discountAmount, total, cashGiven, changeAmount: paymentType === "cash" ? cashGiven - total : 0, items });
  }
}
let scenario = "normal", reads = 0;
export function setSalesPreviewScenario(value) { scenario = value; reads = 0; }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
export function salesPreviewResponse(url, options = {}) {
  const location = new URL(window.location.href);
  if (location.searchParams.get("page") !== "sales" && location.pathname !== "/sales-analytics") return null;
  const parsed = new URL(url, location.origin), path = parsed.pathname.replace(/^\/api/, "");
  if (!["/sales", "/sales/stats"].includes(path)) return null;
  if (options.method && options.method !== "GET") return json({ error: "Предпросмотр продаж доступен только для чтения" }, 400);
  reads++;
  if (scenario === "load-error" || scenario === "refresh-error" && reads > 2) return json({ error: "Демонстрационный сбой. Не удалось загрузить продажи." }, 503);
  const from = parsed.searchParams.get("from"), to = parsed.searchParams.get("to");
  const sales = scenario === "empty" ? [] : seed.filter((sale) => { const day = businessISO(new Date(sale.createdAt)); return (!from || day >= from) && (!to || day <= to); }).map((sale) => {
    if (!["loss", "zero-cost", "zero-revenue"].includes(scenario)) return sale;
    return { ...sale, ...(scenario === "zero-revenue" ? { total: 0, discountPercent: 100, discountAmount: sale.subtotal, cashGiven: 0, changeAmount: 0 } : {}), items: sale.items.map((item) => ({ ...item, cost: scenario === "loss" ? item.price * 1.5 : scenario === "zero-cost" ? 0 : item.cost })) };
  }).sort((a, b) => b.id - a.id);
  if (path === "/sales") return json(sales);
  const stats = { totalRevenue: 0, totalCost: 0, cleanProfit: 0, salesCount: sales.length, cashTotal: 0, transferTotal: 0, totalDiscount: 0, topProducts: [], extraItems: [], extraRevenue: 0, extraQty: 0 };
  const products = new Map(), extras = new Map();
  sales.forEach((sale) => {
    stats.totalRevenue += sale.total; stats.totalDiscount += sale.discountAmount;
    stats[sale.paymentType === "cash" ? "cashTotal" : "transferTotal"] += sale.total;
    sale.items.forEach((item) => {
      stats.totalCost += item.cost * item.qty;
      const map = item.isExtra ? extras : products;
      const row = map.get(item.name) || { name: item.name, qty: 0, revenue: 0 };
      row.qty += item.qty; row.revenue += item.total; map.set(item.name, row);
    });
  });
  stats.cleanProfit = stats.totalRevenue - stats.totalCost;
  stats.topProducts = [...products.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 10);
  stats.extraItems = [...extras.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  stats.extraRevenue = stats.extraItems.reduce((sum, item) => sum + item.revenue, 0);
  stats.extraQty = stats.extraItems.reduce((sum, item) => sum + item.qty, 0);
  return json(stats);
}
