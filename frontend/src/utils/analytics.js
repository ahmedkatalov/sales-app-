import { businessISO, num } from "./format.js";

export const analyticsNumber = (value) => Number.isFinite(num(value)) ? num(value) : 0;
export const analyticsQuantity = (value) => analyticsNumber(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
export const analyticsPercent = (value) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
export const validAnalyticsMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 100;
export const analyticsMonth = (value, short = false) => validAnalyticsMonth(value) ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1, 12).toLocaleDateString("ru-RU", { month: short ? "short" : "long", year: "numeric" }) : "Месяц не указан";
export function shiftAnalyticsMonth(value, offset) {
  const index = Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}
export function analyticsPresets(month = businessISO().slice(0, 7)) {
  return [
    { id: "month", label: "Этот месяц", from: month, to: month },
    { id: "quarter", label: "3 месяца", from: shiftAnalyticsMonth(month, -2), to: month },
    { id: "year", label: "Этот год", from: `${month.slice(0, 4)}-01`, to: month },
    { id: "all", label: "Всё время", from: "", to: "" },
  ];
}
export function analyticsPeriodError({ from, to }) {
  if (from && !validAnalyticsMonth(from) || to && !validAnalyticsMonth(to)) return "Укажите корректные месяцы";
  return from && to && from > to ? "Начало периода должно быть не позже окончания" : "";
}
export function analyticsPeriodLabel({ from, to }) {
  if (!from && !to) return "За всё время";
  if (from === to) return analyticsMonth(from);
  if (!from) return `По ${analyticsMonth(to)}`;
  if (!to) return `С ${analyticsMonth(from)}`;
  return `${analyticsMonth(from, true)} — ${analyticsMonth(to, true)}`;
}
const emptyTotals = () => ({ qty: 0, revenue: 0, cost: 0, gross: 0, expenses: 0, net: 0, revenueAfterExpenses: 0, margin: null });
function addRecord(totals, record) {
  for (const item of record.items) { const qty = analyticsNumber(item.qty); totals.qty += qty; totals.revenue += analyticsNumber(item.price) * qty; totals.cost += analyticsNumber(item.cost) * qty; }
  for (const expense of record.expenses) totals.expenses += analyticsNumber(expense.amount);
  totals.gross = totals.revenue - totals.cost; totals.net = totals.gross - totals.expenses;
  totals.revenueAfterExpenses = totals.revenue - totals.expenses;
  totals.margin = totals.revenue > 0 ? totals.net / totals.revenue * 100 : null;
}
export function aggregateAnalytics(records, period) {
  const monthly = new Map(), workspaces = new Map(), products = new Map(), expenses = new Map();
  const totals = emptyTotals();
  records.forEach((record) => {
    const month = monthly.get(record.month) || { month: record.month, hasData: true, records: 0, ...emptyTotals() };
    month.records++; addRecord(month, record); monthly.set(record.month, month); addRecord(totals, record);
    const workspace = workspaces.get(record.dataAccountId) || { id: record.dataAccountId, name: record.workspaceName, ...emptyTotals() };
    addRecord(workspace, record); workspaces.set(record.dataAccountId, workspace);
    record.items.forEach((item) => {
      const name = item.name || "Без названия", qty = analyticsNumber(item.qty);
      const row = products.get(name) || { name, qty: 0, revenue: 0, cost: 0, profit: 0 };
      row.qty += qty; row.revenue += analyticsNumber(item.price) * qty; row.cost += analyticsNumber(item.cost) * qty; row.profit = row.revenue - row.cost;
      products.set(name, row);
    });
    record.expenses.forEach((expense) => {
      const name = expense.type || ({ products: "Продукты", household: "Хозяйственные расходы" }[expense.category]) || expense.category || "Без категории";
      const row = expenses.get(name) || { name, amount: 0, count: 0 };
      row.amount += analyticsNumber(expense.amount); row.count++; expenses.set(name, row);
    });
  });
  const keys = [...monthly.keys()].sort(), first = period.from || keys[0], last = period.to || keys.at(-1);
  const rows = [];
  if (first && last) {
    for (let month = first; month <= last && validAnalyticsMonth(month); month = shiftAnalyticsMonth(month, 1)) {
      rows.push(monthly.get(month) || { month, hasData: false, records: 0, qty: null, revenue: null, cost: null, gross: null, expenses: null, net: null, margin: null, revenueAfterExpenses: null });
      if (month === last) break;
    }
  }
  const actual = rows.filter((row) => row.hasData);
  return { totals, rows, workspaces: [...workspaces.values()], products: [...products.values()].sort((a, b) => b.revenue - a.revenue), expenses: [...expenses.values()].sort((a, b) => b.amount - a.amount), monthsWithData: actual.length, best: actual.reduce((best, row) => !best || row.net > best.net ? row : best, null), lossMonths: actual.filter((row) => row.net < 0).length };
}
export function analyticsProductSeries(records, months, name) {
  const grouped = new Map();
  records.forEach((record) => record.items.filter((item) => (item.name || "Без названия") === name).forEach((item) => {
    const row = grouped.get(record.month) || { qty: 0, revenue: 0, costTotal: 0, entries: 0 };
    const qty = analyticsNumber(item.qty); row.qty += qty; row.revenue += analyticsNumber(item.price) * qty; row.costTotal += analyticsNumber(item.cost) * qty; row.entries++;
    grouped.set(record.month, row);
  }));
  return months.map(({ month }) => { const row = grouped.get(month); return { month, label: analyticsMonth(month, true), qty: row?.qty ?? null, profit: row ? row.revenue - row.costTotal : null, price: row?.qty ? row.revenue / row.qty : null, cost: row?.qty ? row.costTotal / row.qty : null }; });
}

async function mapLimited(rows, limit, mapper, isStale) {
  let index = 0, failed = false;
  const result = new Array(rows.length);
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (index < rows.length && !failed) {
      if (isStale()) return;
      const position = index++;
      try { result[position] = await mapper(rows[position]); } catch (error) { failed = true; throw error; }
    }
  }));
  return result;
}
const checkArray = (rows, label) => { if (!Array.isArray(rows)) throw new Error(`Не удалось получить ${label}${label.endsWith(".") ? "" : "."} Обновите отчёт.`); return rows; };
export async function fetchAnalyticsReport(fetcher, { isOwner, current, workspaceFilter, folderFilter, period, isStale = () => false, onCatalog = () => {} }) {
  const listed = isOwner ? checkArray(await fetcher("/workspaces"), "список точек") : [current];
  if (isStale()) return null;
  let targets = !isOwner || workspaceFilter === "current" ? [current] : workspaceFilter === "all" ? listed : listed.filter((workspace) => String(workspace.id) === workspaceFilter);
  if (!targets.length || targets.some((workspace) => !workspace?.dataAccountId)) throw new Error("Точка недоступна. Выберите точку и обновите отчёт.");
  targets = [...new Map(targets.map((workspace) => [String(workspace.dataAccountId), workspace])).values()];
  const lists = await mapLimited(targets, 4, async (workspace) => {
    const folders = checkArray(await fetcher("/folders", { dataAccountId: workspace.dataAccountId }), `папки точки «${workspace.name}»`);
    return folders.map((folder) => ({ ...folder, workspaceName: workspace.name, dataAccountId: workspace.dataAccountId, filterKey: `${workspace.dataAccountId}:${folder.id}` }));
  }, isStale);
  if (isStale()) return null;
  const folders = lists.flat(); onCatalog({ workspaces: listed, folders });
  const selected = folderFilter === "all" ? folders : folders.filter((folder) => folder.filterKey === folderFilter);
  if (folderFilter !== "all" && !selected.length) throw new Error("Выбранная папка недоступна. Выберите другую папку.");
  const batches = await mapLimited(selected, 4, async (folder) => {
    const months = checkArray(await fetcher(`/months/${folder.id}`, { dataAccountId: folder.dataAccountId }), `месяцы папки «${folder.name}»`);
    if (months.some((month) => !month?.id || !validAnalyticsMonth(month.month))) throw new Error(`Некорректные месяцы в папке «${folder.name}». Обновите отчёт.`);
    return months.filter((month) => (!period.from || month.month >= period.from) && (!period.to || month.month <= period.to)).map((month) => ({ ...month, folder }));
  }, isStale);
  if (isStale()) return null;
  const records = await mapLimited(batches.flat(), 3, async ({ id, month, folder }) => {
    const options = { dataAccountId: folder.dataAccountId };
    const [items, expenses] = await Promise.all([fetcher(`/items/${id}`, options), fetcher(`/expenses/${folder.id}/${id}`, options)]);
    checkArray(items, `товары за ${analyticsMonth(month)}`); checkArray(expenses, `расходы за ${analyticsMonth(month)}`);
    const valid = (value) => value !== undefined && value !== null && Number.isFinite(Number(value));
    if (items.some((item) => !item || ![item.qty, item.cost, item.price].every(valid)) || expenses.some((expense) => !expense || !valid(expense.amount))) throw new Error(`Неполные данные в папке «${folder.name}» за ${analyticsMonth(month)}. Обновите отчёт.`);
    return { month, monthId: id, folderId: folder.id, folderName: folder.name, workspaceName: folder.workspaceName, dataAccountId: folder.dataAccountId, items, expenses };
  }, isStale);
  return isStale() ? null : { records, folders, workspaces: listed, targets };
}
