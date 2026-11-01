import { financePresets, validFinanceDate } from "./utils/finance";
import { localISO } from "./utils/format";

export const financePreviewWorkspace = { dataAccountId: 900101, name: "Noor Coffee · Центр" };
const today = financePresets()[0].to, baseDate = new Date(`${today}T12:00:00`);
const dayAgo = (days) => { const date = new Date(baseDate); date.setDate(date.getDate() - days); return localISO(date); };
const openingSeed = { asOfDate: dayAgo(70), cash: 15000, bank: 25000, owedToOwner: 3500, inventoryValue: 18000, customerDebts: 6500, supplierDebts: 9000, revenue: 19000, expenses: 8000, note: "Остатки при переходе на учёт", isSet: true, updatedAt: `${dayAgo(70)}T12:00:00Z` };
const events = [];
for (let ago = 64; ago >= 0; ago--) {
  const day = dayAgo(ago), scale = .82 + (ago * 7 % 11) / 20;
  for (const [method, total, cost] of [["cash", 3900, 1320], ["transfer", 6700, 2100], ["debt", ago % 4 === 0 ? 650 : 0, 180]]) if (total) events.push({ day, type: "sale", method, amount: Math.round(total * scale), cost: Math.round(cost * scale) });
  if (ago % 3 === 0) events.push({ day, type: "expense", method: "cash", amount: 2400 + ago % 5 * 100 });
  if (ago % 4 === 0) events.push({ day, type: "expense", method: "card", amount: 3400 });
  if (ago % 9 === 0) events.push({ day, type: "expense", method: "owner", amount: 1800 });
  if (ago % 6 === 0) events.push({ day, type: "debt-payment", method: ago % 12 === 0 ? "cash" : "transfer", amount: 1200 });
  if (ago % 21 === 0) events.push({ day, type: "contribution", amount: 5000 });
  if (ago % 19 === 0) events.push({ day, type: "reimbursement", amount: 2000 });
  if (ago % 14 === 0) events.push({ day, type: "withdrawal", amount: 6000 });
}
let scenario = "normal", reportReads = 0, failedAfterSave = false, opening = structuredClone(openingSeed);
export function setFinancePreviewScenario(value) {
  scenario = value; reportReads = 0; failedAfterSave = false;
  opening = value === "empty" ? { ...openingSeed, asOfDate: "", cash: 0, bank: 0, owedToOwner: 0, inventoryValue: 0, customerDebts: 0, supplierDebts: 0, revenue: 0, expenses: 0, note: "", isSet: false } : structuredClone(openingSeed);
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
export function financePreviewResponse(url, options = {}) {
  const location = new URL(window.location.href);
  if (location.searchParams.get("page") !== "finance" && location.pathname !== "/finance") return null;
  const parsed = new URL(url, location.origin), path = parsed.pathname.replace(/^\/api/, ""), method = options.method || "GET";
  if (!["/finance/report", "/finance/opening"].includes(path)) return null;
  if (scenario === "denied") return json({ error: "Финансовый отчёт недоступен для этой роли." }, 403);
  if (path === "/finance/opening") {
    if (method === "GET") return scenario === "opening-error" ? json({ error: "Не удалось загрузить стартовые балансы. Попробуйте ещё раз." }, 503) : json(opening);
    if (method !== "PUT") return json({ error: "Доступно только изменение стартовых балансов" }, 400);
    if (scenario === "save-error") return json({ error: "Демонстрационная ошибка. Балансы не сохранены." }, 503);
    const body = JSON.parse(options.body || "{}");
    if (!validFinanceDate(body.asOfDate) || ["cash", "bank", "owedToOwner", "inventoryValue", "customerDebts", "supplierDebts", "revenue", "expenses"].some((key) => !Number.isFinite(body[key]))) return json({ error: "Проверьте дату и суммы балансов" }, 400);
    opening = { ...body, isSet: true, updatedAt: new Date().toISOString() };
    if (scenario === "after-save-error") failedAfterSave = true;
    return json(opening);
  }
  reportReads++;
  if (scenario === "load-error" || scenario === "refresh-error" && reportReads > 1 || failedAfterSave) return json({ error: "Демонстрационный сбой. Не удалось обновить финансовый отчёт." }, 503);
  const period = { from: parsed.searchParams.get("from") || "", to: parsed.searchParams.get("to") || "" };
  let source = scenario === "empty" ? [] : events;
  if (scenario === "overdrawn") source = [...source, { day: today, type: "withdrawal", amount: 600000 }];
  const selected = source.filter((row) => (!period.from || row.day >= period.from) && (!period.to || row.day <= period.to));
  const cumulative = source.filter((row) => (!opening.asOfDate || row.day >= opening.asOfDate) && (!period.to || row.day <= period.to));
  const sum = (rows, type, method = null) => rows.filter((row) => row.type === type && (!method || row.method === method)).reduce((total, row) => total + row.amount, 0);
  const pnl = { revenueCash: sum(selected, "sale", "cash"), revenueCard: sum(selected, "sale", "transfer"), revenueDebt: sum(selected, "sale", "debt"), expenseCash: sum(selected, "expense", "cash"), expenseCard: sum(selected, "expense", "card"), expenseOwner: sum(selected, "expense", "owner") };
  pnl.revenue = pnl.revenueCash + pnl.revenueCard + pnl.revenueDebt;
  pnl.cogs = selected.filter((row) => row.type === "sale").reduce((total, row) => total + (scenario === "loss" ? row.amount * 1.8 : row.cost), 0);
  pnl.grossProfit = pnl.revenue - pnl.cogs; pnl.expenses = pnl.expenseCash + pnl.expenseCard + pnl.expenseOwner; pnl.netProfit = pnl.grossProfit - pnl.expenses;
  const cash = { inSales: pnl.revenueCash, inDebt: sum(selected, "debt-payment", "cash"), inOwner: sum(selected, "contribution"), outExpenses: pnl.expenseCash, outReimburse: sum(selected, "reimbursement"), outWithdraw: sum(selected, "withdrawal") };
  cash.net = cash.inSales + cash.inDebt + cash.inOwner - cash.outExpenses - cash.outReimburse - cash.outWithdraw;
  const position = { cashNow: opening.cash + sum(cumulative, "sale", "cash") + sum(cumulative, "debt-payment", "cash") + sum(cumulative, "contribution") - sum(cumulative, "expense", "cash") - sum(cumulative, "reimbursement") - sum(cumulative, "withdrawal"), bank: opening.bank + sum(cumulative, "debt-payment", "transfer"), inventory: scenario === "empty" ? 0 : 57320, receivables: scenario === "empty" ? 0 : 18450, payables: opening.supplierDebts, owedToOwner: opening.owedToOwner + sum(cumulative, "expense", "owner") + sum(cumulative, "contribution") - sum(cumulative, "reimbursement") };
  position.netPosition = position.cashNow + position.bank + position.inventory + position.receivables - position.payables - position.owedToOwner;
  if (scenario === "invalid") delete pnl.netProfit;
  return json({ period, pnl, cash, position, opening });
}
