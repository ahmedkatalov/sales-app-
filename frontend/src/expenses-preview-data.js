// Isolated demonstration API. No expense or finance request reaches the server.
const dateAt = (offset, day = null) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  if (day !== null) date.setDate(day);
  else date.setDate(date.getDate() - offset);
  return date.toISOString();
};
const expenseSeed = [
  { id: 101, name: "Молоко для кофейни", category: "products", type: "Молочные", amount: 3600, paymentSource: "cash", comment: "12 упаковок · поставщик «Молочная ферма»", hasPhoto: true, createdAt: dateAt(0) },
  { id: 102, name: "Уборка помещения", category: "household", type: "Уборка", amount: 1200, paymentSource: "cash", comment: "Генеральная уборка после смены", createdAt: dateAt(0) },
  { id: 103, name: "Кофе в зёрнах · Бразилия", category: "products", type: "Кофе", amount: 9850, paymentSource: "card", comment: "5 кг, средняя обжарка", hasPhoto: true, createdAt: dateAt(1) },
  { id: 104, name: "Доставка продуктов", category: "household", type: "Доставка", amount: 650, paymentSource: "owner", createdAt: dateAt(1) },
  { id: 105, name: "Бумажные стаканы и крышки", category: "products", type: "Общий продуктовый расход", amount: 1800, paymentSource: "owner", comment: "Владелец оплатил личной картой", hasPhoto: true, createdAt: dateAt(2) },
  { id: 106, name: "Круассаны и десерты", category: "products", type: "Кухня", amount: 5400, paymentSource: "card", createdAt: dateAt(3) },
  { id: 107, name: "Молоко и сливки", category: "products", type: "Молочные", amount: 2100, paymentSource: "cash", createdAt: dateAt(4) },
  { id: 108, name: "Зарплата за первую половину месяца", category: "household", type: "Зарплата", amount: 18000, paymentSource: "cash", comment: "Анна · 12 смен", createdAt: dateAt(0, 15) },
  { id: 109, name: "Электричество и вода", category: "household", type: "Коммуналка", amount: 6400, paymentSource: "card", hasPhoto: true, createdAt: dateAt(0, 10) },
  { id: 110, name: "Аренда кофейни", category: "household", type: "Аренда", amount: 45000, paymentSource: "card", comment: "Аренда помещения за текущий месяц", hasPhoto: true, createdAt: dateAt(0, 1) },
].map((expense, index) => ({ hasPhoto: false, comment: "", employeeId: index % 2 + 1, employeeName: index % 2 ? "Михаил" : "Анна", ...expense }));
const previousDate = new Date();
previousDate.setDate(0);
expenseSeed.push({ id: 99, name: "Хозяйственные мелочи", category: "household", type: "Прочее", amount: 850, paymentSource: "cash", employeeName: "Анна", createdAt: previousDate.toISOString() });
const entrySeed = [
  { id: 201, kind: "contribution", amount: 10000, note: "Размен и закупки на начало месяца", createdAt: dateAt(0, 1), employeeName: "Анна" },
  { id: 202, kind: "reimbursement", amount: 2500, note: "Частичный возврат личных расходов", createdAt: dateAt(2), employeeName: "Анна" },
  { id: 203, kind: "withdrawal", amount: 5000, note: "Прибыль за неделю", createdAt: dateAt(1), employeeName: "Анна" },
];
const openingSeed = { isSet: true, asOfDate: new Date().toISOString().slice(0, 7) + "-01", cash: 15000, bank: 25000, owedToOwner: 3500, inventoryValue: 18000, customerDebts: 6500, supplierDebts: 0, revenue: 19000, expenses: 8000, note: "Переход на новую систему" };
let expenses = structuredClone(expenseSeed), entries = structuredClone(entrySeed), opening = { ...openingSeed };
let scenario = "normal", failRefresh = false, nextId = 300;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const owner = () => {
  const fromExpenses = expenses.filter((expense) => expense.paymentSource === "owner").reduce((sum, expense) => sum + expense.amount, 0);
  const sum = (kind) => entries.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amount, 0);
  return { owed: opening.owedToOwner + fromExpenses + sum("contribution") - sum("reimbursement"), fromExpenses, openingOwed: opening.owedToOwner, contributions: sum("contribution"), reimbursements: sum("reimbursement"), withdrawals: sum("withdrawal"), entries: [...entries].sort((a, b) => b.id - a.id) };
};
export function setExpensesPreviewScenario(value) {
  scenario = value;
  failRefresh = false;
  expenses = value === "empty" ? [] : structuredClone(expenseSeed);
  entries = structuredClone(entrySeed);
  opening = { ...openingSeed };
}
export function expensesPreviewResponse(url, options = {}) {
  const path = new URL(url, window.location.origin).pathname.replace(/^\/api/, "");
  if (!["/global-expenses", "/finance/owner", "/finance/opening"].includes(path) && !/^\/(global-expenses|finance\/owner)\/\d+(\/photo)?$/.test(path)) return null;
  const method = options.method || "GET";
  if (method === "GET") {
    if (scenario === "load-error" || failRefresh) return json({ error: "Демонстрационный сбой загрузки. Обновите данные." }, 503);
    if (path.startsWith("/finance/") && ["finance-error", "worker"].includes(scenario)) return json({ error: "Расчёты с владельцем недоступны в этом режиме." }, 403);
    if (path === "/global-expenses") return json(expenses);
    if (path === "/finance/owner") return json(owner());
    if (path === "/finance/opening") return json(opening);
    if (path.endsWith("/photo")) {
      if (scenario === "photo-error") return json({ error: "Не удалось загрузить фото" }, 503);
      const expense = expenses.find((item) => item.id === Number(path.split("/")[2]));
      const receipt = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="520" viewBox="0 0 420 520"><rect width="420" height="520" fill="#fff"/><g fill="#253043" font-family="sans-serif" text-anchor="middle"><text x="210" y="65" font-size="24">НАКЛАДНАЯ · ДЕМО</text><text x="210" y="110" font-size="14">Кофейня / поставка</text><text x="210" y="210" font-size="18">${expense?.name || "Расход"}</text><text x="210" y="300" font-size="32">${expense?.amount || 0} ₽</text><text x="210" y="430" font-size="13">Демонстрационное изображение</text></g><path d="M45 145h330M45 350h330" stroke="#cbd5e1" stroke-dasharray="5 4"/></svg>`;
      return new Response(receipt, { headers: { "Content-Type": "image/svg+xml" } });
    }
  }
  if (scenario === "save-error") return json({ error: "Демонстрационная ошибка. Запись не сохранена." }, 503);
  const body = JSON.parse(options.body || "{}");
  if (path.endsWith("/photo") && method === "POST") {
    if (scenario === "photo-error") return json({ error: "Фото не загрузилось. Попробуйте снова." }, 503);
    const expense = expenses.find((item) => item.id === Number(path.split("/")[2]));
    if (expense) expense.hasPhoto = true;
    return json({ ok: true });
  }
  if (path === "/global-expenses" && method === "POST") {
    if (!Number.isFinite(body.amount) || body.amount <= 0 || !body.name?.trim()) return json({ error: "Проверьте название и сумму" }, 400);
    const expense = { ...body, id: ++nextId, employeeName: "Анна", createdAt: new Date().toISOString(), hasPhoto: false };
    expenses.unshift(expense);
    if (scenario === "refresh-error") failRefresh = true;
    return json(expense);
  }
  if (path === "/finance/owner" && method === "POST") {
    if (!(body.amount > 0) || !Object.hasOwn({ contribution: 1, reimbursement: 1, withdrawal: 1 }, body.kind)) return json({ error: "Проверьте операцию" }, 400);
    entries.push({ ...body, id: ++nextId, employeeName: "Анна", createdAt: body.date ? `${body.date}T12:00:00Z` : new Date().toISOString() });
    return json(owner());
  }
  if (path === "/finance/opening" && method === "PUT") {
    opening = { ...body, isSet: true };
    return json(opening);
  }
  if (method === "DELETE") {
    const id = Number(path.split("/").pop());
    if (path.startsWith("/global-expenses/")) expenses = expenses.filter((expense) => expense.id !== id);
    else entries = entries.filter((entry) => entry.id !== id);
    return json({ ok: true });
  }
  return json({ error: "Неизвестный запрос предпросмотра" }, 400);
}
