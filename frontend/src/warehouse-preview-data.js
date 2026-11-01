// The warehouse preview is an isolated in-memory workspace.
const dateAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
const seed = [
  { id: 1, name: "Молоко 3,2%", quantity: -300, unit: "ml", minQuantity: 3000, unitCost: .085, supplier: "Молочная ферма", packagingQuantity: 1000 },
  { id: 2, name: "Кофе в зёрнах · Бразилия", quantity: 4200, unit: "g", minQuantity: 1500, unitCost: 1.5, supplier: "Roast Coffee", note: "Средняя обжарка · эспрессо-смесь" },
  { id: 3, name: "Стаканы 250 мл", quantity: 45, unit: "pcs", minQuantity: 100, unitCost: 6.5, supplier: "Coffee Pack" },
  { id: 4, name: "Сахар белый", quantity: 0, unit: "g", minQuantity: 1000, unitCost: .07, supplier: "ПродуктСервис" },
  { id: 5, name: "Сироп ванильный", quantity: 1600, unit: "ml", minQuantity: 500, unitCost: .6, supplier: "Sweet Bar", packagingQuantity: 1000 },
  { id: 6, name: "Сливки 10%", quantity: 1500, unit: "ml", minQuantity: 800, unitCost: .25, supplier: "Молочная ферма", expiryDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) },
  { id: 7, name: "Бананы", quantity: 980, unit: "g", minQuantity: 1500, unitCost: .12, supplier: "Фруктовый дом", packagingQuantity: 120 },
  { id: 8, name: "Апельсины", quantity: 6500, unit: "g", minQuantity: 2500, unitCost: .11, supplier: "Фруктовый дом", packagingQuantity: 180 },
  { id: 9, name: "Молоко овсяное", quantity: 4000, unit: "ml", minQuantity: 2000, unitCost: .14, supplier: "Plant Milk", packagingQuantity: 1000 },
  { id: 10, name: "Бумажные фильтры", quantity: 1200, unit: "pcs", minQuantity: 100, unitCost: 1.2, supplier: "Coffee Pack" },
  { id: 11, name: "Сироп кленовый", quantity: 350, unit: "ml", minQuantity: 100, unitCost: .8, supplier: "Sweet Bar", hidden: true },
  { id: 12, name: "Чай жасминовый", quantity: 200, unit: "g", minQuantity: 500, unitCost: 2, supplier: "Tea House", hidden: true },
].map((item) => ({ hidden: false, note: "", createdAt: dateAgo(20), controlMode: item.unit === "pcs" ? "piece" : "approximate", lossPercent: item.unit === "ml" ? 5 : item.unit === "g" ? 3 : 0, inventoryMethod: item.unit === "pcs" ? "fifo" : "average", packagingQuantity: 1, ...item, price: item.quantity * item.unitCost }));
const movementSeed = [
  { id: 71, warehouseItemId: 1, itemName: "Молоко 3,2%", movementType: "sale", quantity: 1200, unit: "ml", reason: "Продажа по рецепту", createdAt: dateAgo(0) },
  { id: 70, warehouseItemId: 2, itemName: "Кофе в зёрнах · Бразилия", movementType: "in", quantity: 2000, unit: "g", reason: "Новая закупка", note: "Накладная №127", createdAt: dateAgo(1) },
  { id: 69, warehouseItemId: 7, itemName: "Бананы", movementType: "inventory", quantity: 120, unit: "g", reason: "Инвентаризация: недостача", createdAt: dateAgo(1) },
  { id: 68, warehouseItemId: 6, itemName: "Сливки 10%", movementType: "writeoff", quantity: 200, unit: "ml", reason: "Просрочилось", note: "После утренней проверки", createdAt: dateAgo(2) },
  { id: 67, warehouseItemId: 3, itemName: "Стаканы 250 мл", movementType: "inventory", quantity: 5, unit: "pcs", reason: "Инвентаризация: излишек", createdAt: dateAgo(3) },
  { id: 66, warehouseItemId: 8, itemName: "Апельсины", movementType: "inventory", quantity: 0, unit: "g", reason: "Инвентаризация: совпало", createdAt: dateAgo(3) },
];
let items, batches, movements, deleted, scenario = "normal", failRefresh = false, nextId = 300;
export function setWarehousePreviewScenario(value) {
  scenario = value;
  failRefresh = false;
  items = value === "empty" ? [] : structuredClone(seed);
  movements = value === "empty" ? [] : structuredClone(movementSeed);
  batches = Object.fromEntries(items.map((item) => [item.id, [{ id: 100 + item.id, quantity: Math.max(4000, item.quantity), remainingQuantity: item.quantity, purchasePrice: Math.max(4000, item.quantity) * item.unitCost, unitCost: item.unitCost, supplier: item.supplier, note: "Поставка по накладной", createdAt: dateAgo(5) }]]));
  if (batches[2]) batches[2] = [{ id: 202, quantity: 2000, remainingQuantity: 2000, purchasePrice: 3000, unitCost: 1.5, supplier: "Roast Coffee", note: "Накладная №127", createdAt: dateAgo(1) }, { id: 201, quantity: 3000, remainingQuantity: 2200, purchasePrice: 4500, unitCost: 1.5, supplier: "Roast Coffee", note: "Предыдущая поставка", createdAt: dateAgo(10) }];
  deleted = value === "empty" ? [] : [{ id: 90, name: "Какао для старого меню", quantity: 450, unit: "g", unitCost: .75, totalValue: 337.5, deletedAt: dateAgo(9), deleteReason: "Больше не используем", deleteNote: "Сняли напиток с сезонного меню" }];
}
setWarehousePreviewScenario("normal");
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const addMovement = (item, type, quantity, reason, note = "") => movements.unshift({ id: ++nextId, warehouseItemId: item.id, itemName: item.name, unit: item.unit, movementType: type, quantity, reason, note, createdAt: new Date().toISOString() });
const recalculate = (item) => {
  item.quantity = (batches[item.id] || []).reduce((sum, batch) => sum + batch.remainingQuantity, 0);
  item.price = (batches[item.id] || []).reduce((sum, batch) => sum + batch.remainingQuantity * batch.unitCost, 0);
  if (item.quantity > 0) item.unitCost = item.price / item.quantity;
};
const consume = (item, quantity) => {
  let remaining = quantity;
  for (const batch of [...(batches[item.id] || [])].reverse()) { const take = Math.min(Math.max(0, batch.remainingQuantity), remaining); batch.remainingQuantity -= take; remaining -= take; }
  recalculate(item);
};
export function warehousePreviewResponse(url, options = {}) {
  const location = new URL(window.location.href);
  if (location.searchParams.get("page") !== "warehouse" && location.pathname !== "/warehouse") return null;
  const parsed = new URL(url, location.origin), path = parsed.pathname.replace(/^\/api/, ""), method = options.method || "GET";
  const match = path.match(/^\/warehouse\/items\/(\d+)(?:\/(purchase|writeoff|inventory|hide|batches)(?:\/(\d+))?)?$/);
  const item = match ? items.find((entry) => entry.id === Number(match[1])) : null;
  if (method === "GET") {
    if (["/warehouse/items", "/warehouse/movements"].includes(path) && (scenario === "load-error" || failRefresh)) return json({ error: "Демонстрационный сбой. Не удалось обновить склад." }, 503);
    if (scenario === "history-error" && (path.endsWith("/batches") || path === "/warehouse/deleted-items")) return json({ error: "История временно недоступна. Попробуйте ещё раз." }, 503);
    if (path === "/warehouse/items") return json(items);
    if (path === "/warehouse/movements") return json(movements);
    if (path === "/warehouse/deleted-items") return json(deleted);
    if (path.endsWith("/batches")) return item ? json(batches[item.id] || []) : json({ error: "Сырьё не найдено" }, 404);
    if (path === "/warehouse/items/similar") {
      if (scenario === "duplicate-error") return json({ error: "Не удалось проверить похожее сырьё. Закупка не сохранена." }, 503);
      const name = parsed.searchParams.get("name")?.toLowerCase() || "";
      return json(items.filter((entry) => !entry.hidden && entry.unit === parsed.searchParams.get("unit") && (entry.name.toLowerCase().includes(name) || name.includes(entry.name.toLowerCase()))).map((entry) => ({ ...entry, score: .95 })));
    }
    return null;
  }
  const body = JSON.parse(options.body || "{}");
  if (path === "/ai/ingredient/suggest") return json({ suggestions: [] });
  if (!path.startsWith("/warehouse/")) return null;
  if (scenario === "save-error") return json({ error: "Демонстрационная ошибка. Изменения не сохранены." }, 503);
  if (method === "POST" && (path === "/warehouse/items" || match?.[2] === "purchase")) {
    if (!(body.quantity > 0) || !Number.isFinite(body.quantity) || !Number.isFinite(body.price) || body.price < 0) return json({ error: "Проверьте количество и стоимость" }, 400);
    let target = item || items.find((entry) => !entry.hidden && entry.name.toLowerCase() === body.name.toLowerCase() && entry.unit === body.unit);
    if (target && target.unit !== body.unit) return json({ error: "Единица хранения не совпадает" }, 400);
    if (!target) { target = { ...body, id: ++nextId, quantity: 0, unitCost: 0, hidden: false, createdAt: new Date().toISOString() }; items.push(target); batches[target.id] = []; }
    const batch = { ...body, id: ++nextId, quantity: body.quantity, remainingQuantity: body.quantity, purchasePrice: body.price, unitCost: body.price / body.quantity, createdAt: new Date().toISOString() };
    batches[target.id].unshift(batch);
    if (body.minQuantity > 0) target.minQuantity = body.minQuantity;
    target.packagingQuantity = body.packagingQuantity;
    recalculate(target);
    addMovement(target, "in", body.quantity, "Новая закупка", body.note);
    if (scenario === "refresh-error") failRefresh = true;
    return json(target);
  }
  if (!item) return json({ error: "Сырьё не найдено" }, 404);
  if (match[2] === "writeoff") {
    if (!(body.quantity > 0) || body.quantity > item.quantity) return json({ error: "Недостаточно остатка на складе" }, 400);
    consume(item, body.quantity);
    addMovement(item, "writeoff", body.quantity, body.reason, body.note);
  } else if (match[2] === "inventory") {
    if (!Number.isFinite(body.actualQuantity) || body.actualQuantity < 0) return json({ error: "Проверьте фактический остаток" }, 400);
    const difference = body.actualQuantity - item.quantity;
    if (difference < 0) consume(item, -difference);
    else if (difference > 0) { batches[item.id].unshift({ id: ++nextId, quantity: difference, remainingQuantity: difference, purchasePrice: difference * item.unitCost, unitCost: item.unitCost, note: "Инвентаризация: излишек", createdAt: new Date().toISOString() }); recalculate(item); }
    addMovement(item, "inventory", Math.abs(difference), difference < 0 ? "Инвентаризация: недостача" : difference > 0 ? "Инвентаризация: излишек" : "Инвентаризация: совпало", body.note);
  } else if (match[2] === "hide") item.hidden = !!body.hidden;
  else if (method === "DELETE" && match[2] === "batches") {
    const batch = batches[item.id].find((batch) => batch.id === Number(match[3]));
    if (!batch || batch.remainingQuantity < batch.quantity - .000001 || String(batch.note).includes("Инвентаризация")) return json({ error: "Эту партию нельзя отменить. Используйте пересчёт." }, 400);
    batches[item.id] = batches[item.id].filter((batch) => batch.id !== Number(match[3]));
    recalculate(item);
    addMovement(item, "out", batch.quantity, "Отмена закупки");
    return json({ success: true, expenseRemoved: 0 });
  } else if (method === "DELETE") {
    deleted.unshift({ ...item, deletedAt: new Date().toISOString(), deleteReason: body.reason, deleteNote: body.note, totalValue: item.price });
    items = items.filter((entry) => entry.id !== item.id);
    addMovement(item, "delete", item.quantity, body.reason, body.note);
  } else return json({ error: "Неизвестная операция" }, 400);
  return json({ success: true });
}
