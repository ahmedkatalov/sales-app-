import { businessISO, formatMoney, localISO } from "./format.js";
import { escHtml } from "./print.js";

export const FINANCE_FIELDS = {
  pnl: [["revenueCash", "Выручка наличными"], ["revenueCard", "Выручка переводами"], ["revenueDebt", "Продажи в долг"], ["revenue", "Выручка"], ["cogs", "Себестоимость проданного"], ["grossProfit", "Валовая прибыль"], ["expenseCash", "Расходы из кассы"], ["expenseCard", "Расходы с карты"], ["expenseOwner", "Расходы из личных владельца"], ["expenses", "Всего расходов"], ["netProfit", "Чистая прибыль"]],
  cash: [["inSales", "Продажи наличными"], ["inDebt", "Погашения долгов наличными"], ["inOwner", "Вклады владельца"], ["outExpenses", "Расходы из кассы"], ["outReimburse", "Возвраты владельцу"], ["outWithdraw", "Изъятия прибыли"], ["net", "Чистое движение наличных"]],
  position: [["cashNow", "Расчётный остаток кассы"], ["bank", "Банк по данным отчёта"], ["inventory", "Текущий склад"], ["receivables", "Текущие долги клиентов"], ["payables", "Долги поставщикам"], ["owedToOwner", "Долг перед владельцем"], ["netPosition", "Расчётная чистая позиция"]],
};
export const FINANCE_SECTIONS = { pnl: "Прибыль за период", cash: "Движение наличных за период", position: "Расчётная позиция" };
export const FINANCE_OPENING_FIELDS = [["cash", "Наличные в кассе"], ["bank", "На карте / счёте"], ["owedToOwner", "Долг перед владельцем"], ["inventoryValue", "Стоимость склада"], ["customerDebts", "Долги клиентов"], ["supplierDebts", "Долги поставщикам"]];
export const FINANCE_POSITION_NOTE = "Касса и долг перед владельцем рассчитаны накопительно по дату окончания периода. Склад и долги клиентов показаны на момент обновления отчёта. Банк включает стартовый остаток и погашения долгов переводом; продажи и расходы по карте в этой сумме не учтены.";
export const financeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const financePercent = (value) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
export const financeAmount = (value) => Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
export function validFinanceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number), date = new Date(year, month - 1, day, 12);
  return year >= 100 && Number.isFinite(date.getTime()) && localISO(date) === value;
}
export const financeDate = (value) => validFinanceDate(value) ? new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "Дата не задана";
export function financePeriodLabel({ from, to }) {
  if (!from && !to) return "За всё время";
  if (from === to) return financeDate(from);
  if (!from) return `По ${financeDate(to)}`;
  if (!to) return `С ${financeDate(from)}`;
  return `${financeDate(from)} — ${financeDate(to)}`;
}
export function financePeriodError({ from, to }) {
  if (from && !validFinanceDate(from) || to && !validFinanceDate(to)) return "Укажите корректные даты";
  return from && to && from > to ? "Начало периода должно быть не позже окончания" : "";
}
export function financeOpeningPayload(form, original) {
  const amounts = Object.fromEntries(FINANCE_OPENING_FIELDS.map(([key]) => [key, financeAmount(form[key])]));
  if (!validFinanceDate(form.asOfDate) || Object.values(amounts).some((value) => !Number.isFinite(value))) throw new Error("Проверьте дату и суммы стартовых балансов.");
  if (!original || ["revenue", "expenses"].some((key) => original[key] == null || !Number.isFinite(Number(original[key])))) throw new Error("Исходные балансы загружены не полностью. Обновите их перед сохранением.");
  return { ...amounts, asOfDate: form.asOfDate, note: String(form.note || "").trim(), revenue: Number(original.revenue), expenses: Number(original.expenses) };
}
export function financePresets(today = businessISO()) {
  const [year, month] = today.split("-").map(Number);
  return [
    { id: "this", label: "Этот месяц", from: `${today.slice(0, 7)}-01`, to: today },
    { id: "prev", label: "Прошлый месяц", from: localISO(new Date(year, month - 2, 1, 12)), to: localISO(new Date(year, month - 1, 0, 12)) },
    { id: "today", label: "Сегодня", from: today, to: today },
    { id: "all", label: "Всё время", from: "", to: "" },
  ];
}
export function validateFinanceReport(value) {
  if (!value || typeof value !== "object" || !value.opening || typeof value.opening !== "object") throw new Error("Сервер вернул неполный отчёт. Обновите данные.");
  if (typeof value.opening.isSet !== "boolean" || FINANCE_OPENING_FIELDS.some(([key]) => value.opening[key] == null || !Number.isFinite(Number(value.opening[key])))) throw new Error("Не удалось получить стартовые остатки отчёта. Обновите данные.");
  for (const [section, fields] of Object.entries(FINANCE_FIELDS)) {
    if (!value[section] || fields.some(([key]) => value[section][key] == null || !Number.isFinite(Number(value[section][key])))) throw new Error(`Не удалось получить раздел «${FINANCE_SECTIONS[section]}». Обновите отчёт.`);
  }
  return value;
}
export function financeWaterfall(pnl) {
  const p = Object.fromEntries(FINANCE_FIELDS.pnl.map(([key]) => [key, financeNumber(pnl[key])]));
  const range = (a, b) => [Math.min(a, b), Math.max(a, b)];
  return [
    { key: "revenue", label: "Выручка", detail: "Все продажи после скидок", amount: p.revenue, range: range(0, p.revenue), color: "var(--brand)" },
    { key: "cogs", label: "Себест.", detail: "Себестоимость проданных товаров", amount: -p.cogs, range: range(p.grossProfit, p.revenue), color: "var(--color-amber-400)" },
    { key: "grossProfit", label: "Валовая", detail: "Выручка минус себестоимость", amount: p.grossProfit, range: range(0, p.grossProfit), color: p.grossProfit < 0 ? "var(--color-rose-400)" : "var(--brand-2)" },
    { key: "expenses", label: "Расходы", detail: "Все расходы периода", amount: -p.expenses, range: range(p.netProfit, p.grossProfit), color: "var(--color-amber-400)" },
    { key: "netProfit", label: "Чистая", detail: "Прибыль после расходов", amount: p.netProfit, range: range(0, p.netProfit), color: p.netProfit < 0 ? "var(--color-rose-400)" : "var(--color-emerald-400)" },
  ];
}
export function financeBridge(report) {
  const p = report.pnl, c = report.cash;
  const rows = [
    ["revenueCard", "Продажи переводами", "Деньги поступили безналично", -financeNumber(p.revenueCard)],
    ["revenueDebt", "Продажи в долг", "Деньги от клиента ещё не получены", -financeNumber(p.revenueDebt)],
    ["cogs", "Себестоимость", "Расход запасов не равен расходу наличных", financeNumber(p.cogs)],
    ["expenseCard", "Расходы с карты", "Эти расходы не уменьшали кассу", financeNumber(p.expenseCard)],
    ["expenseOwner", "Личные деньги владельца", "Владелец оплатил расходы вне кассы", financeNumber(p.expenseOwner)],
    ["inDebt", "Возвраты долгов наличными", "Приход в кассу по прежним продажам", financeNumber(c.inDebt)],
    ["inOwner", "Вклады владельца", "Пополнение кассы владельцем", financeNumber(c.inOwner)],
    ["outReimburse", "Возвраты владельцу", "Возврат вложений из кассы", -financeNumber(c.outReimburse)],
    ["outWithdraw", "Изъятия прибыли", "Деньги, которые забрали из кассы", -financeNumber(c.outWithdraw)],
  ];
  return rows.map(([key, label, note, amount]) => ({ key, label, note, amount }));
}
export function financeExportRows(report, period, workspaceName, updatedAt) {
  const rows = [["Раздел", "Показатель", "Значение"], ["Отчёт", "Точка", workspaceName], ["Отчёт", "Сформирован", updatedAt], ["Период", "С", period.from || "Начало учёта"], ["Период", "По", period.to || "Дата обновления"]];
  for (const [section, fields] of Object.entries(FINANCE_FIELDS)) for (const [key, label] of fields) rows.push([FINANCE_SECTIONS[section], label, financeNumber(report[section][key])]);
  rows.push(["Пояснение", "Позиция", FINANCE_POSITION_NOTE]);
  rows.push(["Стартовые балансы", "Дата старта", report.opening.asOfDate || "Не задана"]);
  for (const [key, label] of FINANCE_OPENING_FIELDS) rows.push(["Стартовые балансы", label, financeNumber(report.opening[key])]);
  return rows;
}
export function financePrintHtml(report, period, workspaceName, updatedAt) {
  const sections = Object.entries(FINANCE_FIELDS).map(([section, fields]) => `<section><h2>${escHtml(FINANCE_SECTIONS[section])}</h2><table><tbody>${fields.map(([key, label]) => `<tr class="${["revenue", "grossProfit", "netProfit", "net", "netPosition"].includes(key) ? "total" : ""}"><th scope="row">${escHtml(label)}</th><td>${escHtml(formatMoney(financeNumber(report[section][key])))} ₽</td></tr>`).join("")}</tbody></table>${section === "position" ? `<p class="note">${escHtml(FINANCE_POSITION_NOTE)}</p>` : ""}</section>`).join("");
  const opening = `<section><h2>Стартовые балансы</h2><p class="note">${escHtml(report.opening.isSet ? `Дата старта: ${financeDate(report.opening.asOfDate)}` : "Не заданы")}</p><table>${FINANCE_OPENING_FIELDS.map(([key, label]) => `<tr><th scope="row">${escHtml(label)}</th><td>${escHtml(formatMoney(financeNumber(report.opening[key])))} ₽</td></tr>`).join("")}</table></section>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Финансовый отчёт</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#18212f;background:#fff;max-width:820px;padding:24px;margin:auto}h1{font-size:27px;margin:0 0 6px}h2{font-size:17px;margin:26px 0 10px}p{margin:5px 0}.note{color:#566174;font-size:12px}table{width:100%;border-collapse:collapse}th,td{padding:7px 0;border-bottom:1px solid #e1e5eb}th{text-align:left;font-weight:400}td{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.total{font-weight:700}.total th{font-weight:700}section{break-inside:avoid}footer{margin-top:25px;font-size:11px;color:#566174}@media print{body{padding:0;margin:8mm auto}}</style></head><body><h1>Финансовый отчёт</h1><p>${escHtml(workspaceName)}</p><p class="note">${escHtml(financePeriodLabel(period))} · обновлено ${escHtml(updatedAt)}</p>${sections}${opening}<footer>Okvion Sales</footer></body></html>`;
}
