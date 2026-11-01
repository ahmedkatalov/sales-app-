// All assistant requests in the design preview stay in this in-memory fixture.
export const assistantPreviewWorkspace = { id: 9001, dataAccountId: 9001, name: "Noor Coffee" };
const workspaces = [assistantPreviewWorkspace, { id: 9002, dataAccountId: 9002, name: "Merenda · Центр" }];
const itemSeed = [
  { id: 1, name: "Молоко", quantity: 2200, unit: "ml", minQuantity: 3000, unitCost: .09 },
  { id: 2, name: "Кофе в зёрнах", quantity: 4200, unit: "g", minQuantity: 1500, unitCost: 1.2 },
  { id: 3, name: "Стаканы 250 мл", quantity: 45, unit: "pcs", minQuantity: 100, unitCost: 6 },
  { id: 4, name: "Сироп ванильный", quantity: 1800, unit: "ml", minQuantity: 500, unitCost: .5 },
  { id: 5, name: "Сливки", quantity: 1500, unit: "ml", minQuantity: 1000, unitCost: .2 },
];
let itemsByPoint = {}, demoExpenses = [], scenario = "normal", nextId = 100;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const items = (point) => itemsByPoint[point] ||= structuredClone(itemSeed).map((item) => ({ ...item, id: point === 9002 ? item.id + 20 : item.id, quantity: point === 9002 ? item.quantity * 2 : item.quantity }));
const movements = (point) => [
  { id: 1, itemName: "Кофе в зёрнах", quantity: 2000, unit: "g", movementType: "in", createdAt: new Date().toISOString() },
  { id: 2, itemName: "Молоко", quantity: point === 9002 ? 8000 : 4000, unit: "ml", movementType: "in", createdAt: new Date(Date.now() - 86400000).toISOString() },
];
export function setAssistantPreviewScenario(value) {
  scenario = value;
  itemsByPoint = {};
  demoExpenses = [];
}
function preparedPurchase(name, quantity, unit, price, extra = {}) {
  const storageUnit = unit === "l" ? "ml" : unit === "kg" ? "g" : "g";
  const multiplier = ["l", "kg"].includes(unit) ? 1000 : 120;
  const form = { name, purchaseQuantity: String(quantity), quantity: String(quantity), purchaseUnit: unit, unit: storageUnit, price: String(price), unitsPerPackage: "1", basePerUnit: String(multiplier === 120 ? 120 : 1), packagingQuantity: "1", controlMode: "approximate", lossPercent: 3, inventoryMethod: "average" };
  return { form, payload: { name, quantity: quantity * multiplier, unit: storageUnit, price }, computed: { quantity: quantity * multiplier, unit: storageUnit, detail: `${quantity} ${unit === "l" ? "л" : unit === "kg" ? "кг" : "шт"} × ${multiplier}` }, result: { name, ...extra }, matched: name === "Молоко" ? itemSeed[0] : null, questions: [] };
}
export function assistantPreviewChat(value) {
  const history = [
    { role: "user", text: "Покажи продажи за сегодня" },
    { role: "bot", text: "**Продажи за сегодня**\n\nВыручка — **48 750 ₽**, оформлено **76 чеков**. Средний чек — **641 ₽**.\n\n**Как платили**\n- Картой и переводом — 29 500 ₽\n- Наличными — 19 250 ₽\n\nЧаще всего заказывали капучино, латте и круассаны. Эти позиции стоит проверить перед вечерней сменой." },
    { role: "user", text: "Что стоит заказать на склад?" },
    { role: "bot", text: "На складе ниже минимального остатка две позиции:\n\n- **Молоко** — 2 200 мл при минимуме 3 000 мл.\n- **Стаканы 250 мл** — 45 шт. при минимуме 100 шт.\n\nНачните с них. Остальные позиции из списка пока выше заданного минимума." },
  ];
  if (value === "history") return { messages: history };
  if (["purchase", "many-purchase"].includes(value)) {
    const prepared = value === "many-purchase" ? Array.from({ length: 18 }, (_, index) => preparedPurchase(`Позиция ${index + 1}`, 1, "kg", 250)) : [preparedPurchase("Молоко", 4, "l", 420), preparedPurchase("Бананы", 5, "pcs", 350, { assumedWeight: true, assumedNote: "120 г за штуку" })];
    return { messages: [{ role: "user", text: "Проверь закупку перед записью" }, { role: "bot", text: "Подготовил позиции. Проверьте количество, стоимость и выбранную точку. При необходимости уточните вес." }], pendingPurchaseConfirmation: { wsName: assistantPreviewWorkspace.name, items: prepared } };
  }
  if (value === "clarification") {
    const prepared = preparedPurchase("Молоко", 4, "l", 0);
    return { messages: [{ role: "user", text: "Купили молоко 4 л" }, { role: "bot", text: "Уточните стоимость молока, чтобы подготовить закупку." }], pendingItems: [{ ...prepared, originalText: "Молоко 4 л", questions: ["За сколько купили молоко?"] }] };
  }
  return undefined;
}
export function assistantPreviewResponse(url, options = {}) {
  const location = new URL(window.location.href);
  if (location.searchParams.get("page") !== "assistant" && location.pathname !== "/ai-warehouse") return null;
  const parsed = new URL(url, location.origin);
  const path = parsed.pathname.replace(/^\/api/, "");
  const point = Number(parsed.searchParams.get("accountId")) || 9001;
  const method = options.method || "GET";
  if (method === "GET") {
    if (path === "/my-workspaces") return json(workspaces);
    if (["/warehouse/items", "/warehouse/movements", "/product-types", "/product-categories"].includes(path) && scenario === "context-error") return json({ error: "Не удалось загрузить данные точки. Проверьте соединение." }, 503);
    if (path === "/warehouse/items") return json(scenario === "empty-stock" ? [] : items(point));
    if (path === "/warehouse/movements") return json(scenario === "empty-stock" ? [] : movements(point));
    if (path === "/product-types") return json([{ id: 1, name: "Бар" }, { id: 2, name: "Кухня" }]);
    if (path === "/product-categories") return json([{ id: 1, typeId: 1, name: "Кофе" }, { id: 2, typeId: 2, name: "Десерты" }]);
    if (path === "/global-expenses") return json(demoExpenses);
    return null;
  }
  const body = JSON.parse(options.body || "{}");
  if (path.startsWith("/ai/") && scenario === "response-error") return json({ error: "Помощник временно недоступен. Попробуйте отправить запрос позже." }, 503);
  if (path === "/ai/intent") {
    if (/купили|закупк|молоко.*(?:л|пачк)/i.test(body.text)) return json({ intent: "purchase", items: [{ name: "Молоко", purchaseQuantity: 4, quantity: 4, purchaseUnit: "l", unit: "ml", price: 420, matchedItemId: point === 9002 ? 21 : 1, questions: [] }] });
    if (/запиши расход/i.test(body.text)) return json({ intent: "expense", expense: { name: "Доставка продуктов", category: "household", type: "Доставка", amount: 650, questions: [] } });
    return json({ intent: "question" });
  }
  if (path === "/ai/warehouse/ask") {
    const branch = workspaces.find((workspace) => workspace.id === point)?.name || assistantPreviewWorkspace.name;
    if (/продаж|выручк/i.test(body.text)) return json({ answer: `**Продажи за сегодня · ${branch}**\n\nВыручка — **48 750 ₽**, оформлено **76 чеков**. Средний чек — **641 ₽**.\n\n- Картой и переводом — 29 500 ₽\n- Наличными — 19 250 ₽\n\nСамые популярные позиции — капучино, латте и круассаны.` });
    if (/заканч|остат|склад/i.test(body.text)) return json({ answer: scenario === "empty-stock" ? "На выбранной точке пока нет складских позиций." : `**Остатки · ${branch}**\n\n${point === 9002 ? "Все позиции из списка выше заданного минимума." : "Пора пополнить две позиции:\n- **Молоко** — 2 200 мл, минимум 3 000 мл.\n- **Стаканы 250 мл** — 45 шт., минимум 100 шт."}\n\nМожно записать закупку сообщением или прикрепить фото накладной.` });
    return json({ answer: "**Разберём задачу по шагам**\n\nНачните с самых продаваемых позиций. Проверьте их состав и себестоимость, затем сравните расходы на сырьё с выручкой.\n\nМогу помочь с остатками, продажами, меню и расходами. Напишите, какой период или товар вас интересует." });
  }
  if (path === "/global-expenses" && method === "POST") { const expense = { ...body, id: ++nextId }; demoExpenses.push(expense); return json(expense); }
  if (path === "/warehouse/items" && method === "POST") { const item = { ...body, id: ++nextId, batchId: ++nextId }; items(point).push(item); return json(item); }
  const purchaseMatch = path.match(/^\/warehouse\/items\/(\d+)\/purchase$/);
  if (purchaseMatch && method === "POST") {
    const item = items(point).find((item) => item.id === Number(purchaseMatch[1]));
    if (!item) return json({ error: "Товар не найден в выбранной точке" }, 404);
    item.quantity += Number(body.quantity);
    return json({ ...item, batchId: ++nextId });
  }
  return json({ error: "Этот сценарий доступен в рабочем приложении." }, 400);
}
