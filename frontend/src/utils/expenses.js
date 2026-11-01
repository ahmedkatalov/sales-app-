import { localISO, num } from "./format.js";

export const HOUSEHOLD_TYPES = ["Уборка", "Коммуналка", "Зарплата", "Аренда", "Доставка", "Прочее"];
export const BASE_PRODUCT_TYPE = "Общий продуктовый расход";
export const SOURCE_LABELS = { cash: "Из кассы", card: "С карты", owner: "Личные владельца" };
export const OWNER_KINDS = {
  contribution: { label: "Вклад в кассу", action: "Внести в кассу", sign: "+", hint: "Наличные в кассе и долг бизнеса перед владельцем увеличатся на эту сумму." },
  reimbursement: { label: "Возврат владельцу", action: "Вернуть владельцу", sign: "−", hint: "Наличные в кассе и долг перед владельцем уменьшатся на эту сумму." },
  withdrawal: { label: "Изъятие прибыли", action: "Изъять прибыль", sign: "−", hint: "Наличные в кассе уменьшатся. Долг перед владельцем останется прежним." },
};
export const OPENING_FIELDS = [
  ["cash", "Наличные в кассе"], ["bank", "На карте / счёте"],
  ["owedToOwner", "Долг перед владельцем"], ["inventoryValue", "Стоимость склада"],
  ["customerDebts", "Долги клиентов"], ["supplierDebts", "Долги поставщикам"],
];
export const parseExpenseAmount = (value) => Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
export const expenseSource = (expense) => Object.hasOwn(SOURCE_LABELS, expense.paymentSource) ? expense.paymentSource : "cash";
export const expenseDay = (expense) => {
  const raw = String(expense.createdAt || "");
  // A date without a time is already a calendar day. Timestamps use local time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? localISO(date) : "";
};
export function expensePeriod(preset, now = new Date()) {
  const year = now.getFullYear(), month = now.getMonth();
  if (preset === "today") return { from: localISO(now), to: localISO(now) };
  if (preset === "month") return { from: localISO(new Date(year, month, 1)), to: localISO(new Date(year, month + 1, 0)) };
  if (preset === "previous") return { from: localISO(new Date(year, month - 1, 1)), to: localISO(new Date(year, month, 0)) };
  return { from: "", to: "" };
}
export function filterExpenses(expenses, { from = "", to = "", query = "", category = "all", type = "all", source = "all", withPhoto = false } = {}) {
  if (from && to && from > to) return [];
  const search = query.trim().toLocaleLowerCase("ru");
  return expenses.filter((expense) => {
    const date = expenseDay(expense);
    if ((from || to) && !date) return false;
    if (from && date < from || to && date > to) return false;
    if (category !== "all" && (expense.category || "household") !== category) return false;
    if (type !== "all" && expense.type !== type) return false;
    if (source !== "all" && expenseSource(expense) !== source) return false;
    if (withPhoto && !expense.hasPhoto) return false;
    return !search || [expense.name, expense.comment, expense.type, expense.employeeName].some((value) => String(value || "").toLocaleLowerCase("ru").includes(search));
  });
}
export function summarizeExpenses(expenses) {
  const sources = { cash: 0, card: 0, owner: 0 };
  const types = new Map();
  let total = 0, photos = 0;
  for (const expense of expenses) {
    const amount = num(expense.amount);
    total += amount;
    sources[expenseSource(expense)] += amount;
    if (expense.hasPhoto) photos++;
    const category = expense.category || "household";
    const type = expense.type || "Прочее";
    const key = JSON.stringify([category, type]);
    const row = types.get(key) || { key, type, category, amount: 0, count: 0 };
    row.amount += amount;
    row.count++;
    types.set(key, row);
  }
  return { total, sources, photos, count: expenses.length, types: [...types.values()].sort((a, b) => b.amount - a.amount) };
}
