import { businessISO, getDayStartHour, localISO, num } from "./format.js";

const dateOf = (iso) => {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};
export const salesNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const salesQuantity = (value) => num(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
export const salesPercent = (value) => Number.isFinite(value) ? value.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "—";
export const shortSalesDate = (iso) => iso ? dateOf(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "";
export const fullSalesDate = (iso) => iso ? dateOf(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "";
export function salesPresets(today = businessISO()) {
  const date = dateOf(today);
  const ago = (days) => localISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() - days, 12));
  return [
    { id: "today", label: "Сегодня", from: today, to: today },
    { id: "yesterday", label: "Вчера", from: ago(1), to: ago(1) },
    { id: "week", label: "7 дней", from: ago(6), to: today },
    { id: "month", label: "Этот месяц", from: localISO(new Date(date.getFullYear(), date.getMonth(), 1, 12)), to: localISO(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)) },
    { id: "all", label: "Всё время", from: "", to: "" },
  ];
}
export const salesPeriodKey = ({ from, to }) => `${from}|${to}`;
export function salesPeriodError({ from, to }) {
  const valid = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(dateOf(iso).getTime()) && localISO(dateOf(iso)) === iso;
  if (from && !valid(from) || to && !valid(to)) return "Укажите корректные даты";
  return from && to && from > to ? "Начало периода должно быть не позже окончания" : "";
}
export function salesPeriodLabel({ from, to }) {
  if (!from && !to) return "За всё время";
  if (from === to) return fullSalesDate(from);
  if (!to) return `С ${fullSalesDate(from)}`;
  if (!from) return `По ${fullSalesDate(to)}`;
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${shortSalesDate(from)} ${from.slice(0, 4)} — ${shortSalesDate(to)} ${to.slice(0, 4)}`;
  return `${shortSalesDate(from)} — ${shortSalesDate(to)} ${to.slice(0, 4)}`;
}
export function normalizeSale(sale) {
  const date = new Date(sale.createdAt);
  const validDate = Number.isFinite(date.getTime());
  return {
    ...sale, total: salesNumber(sale.total), items: Array.isArray(sale.items) ? sale.items : [],
    day: validDate ? businessISO(date) : "", hour: validDate ? date.getHours() : null,
    dateLabel: validDate ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "Дата не указана",
    timeLabel: validDate ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "",
    timestamp: validDate ? date.getTime() : 0,
  };
}
export function salesMetrics(stats) {
  const revenue = salesNumber(stats.totalRevenue), count = salesNumber(stats.salesCount);
  const cost = stats.totalCost == null ? null : salesNumber(stats.totalCost);
  const profit = stats.cleanProfit == null ? cost == null ? null : revenue - cost : salesNumber(stats.cleanProfit);
  const discount = salesNumber(stats.totalDiscount);
  const cash = Math.max(0, salesNumber(stats.cashTotal)), transfer = Math.max(0, salesNumber(stats.transferTotal));
  const other = Math.max(0, revenue - cash - transfer);
  const paid = cash + transfer + other;
  return { revenue, count, cost, profit, discount, cash, transfer, other, paid, average: count ? revenue / count : 0, margin: revenue > 0 && profit != null ? profit / revenue * 100 : null, discountPercent: revenue + discount > 0 ? discount / (revenue + discount) * 100 : 0 };
}
export function salesHours(sales) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${String(hour).padStart(2, "0")}:00`, hour, revenue: 0, count: 0, average: null }));
  sales.forEach((sale) => { if (sale.hour !== null) { rows[sale.hour].revenue += sale.total; rows[sale.hour].count++; } });
  return rows.map((row) => ({ ...row, average: row.count ? row.revenue / row.count : null }));
}
function bucketStart(iso, mode) {
  const date = dateOf(iso);
  if (mode === "year") return `${iso.slice(0, 4)}-01-01`;
  if (mode === "month") return `${iso.slice(0, 7)}-01`;
  if (mode === "week") date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return localISO(date);
}
function nextBucket(iso, mode) {
  const date = dateOf(iso);
  if (mode === "year") date.setFullYear(date.getFullYear() + 1);
  else if (mode === "month") date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + (mode === "week" ? 7 : 1));
  return localISO(date);
}
export function salesSeries(sales, period) {
  if (period.from && period.from === period.to) {
    const hours = salesHours(sales), start = getDayStartHour();
    return { mode: "hour", label: "По часам рабочего дня", rows: [...hours.slice(start), ...hours.slice(0, start)] };
  }
  const days = sales.map((sale) => sale.day).filter(Boolean).sort();
  const from = period.from || days[0], to = period.to || days.at(-1);
  if (!from || !to || from > to) return { mode: "day", label: "По дням", rows: [] };
  const span = Math.round((dateOf(to) - dateOf(from)) / 86400000) + 1;
  const mode = span <= 62 ? "day" : span <= 366 ? "week" : span <= 1096 ? "month" : "year";
  const grouped = new Map();
  sales.forEach((sale) => {
    if (!sale.day || sale.day < from || sale.day > to) return;
    const key = bucketStart(sale.day, mode), row = grouped.get(key) || { revenue: 0, count: 0 };
    row.revenue += sale.total; row.count++;
    grouped.set(key, row);
  });
  const rows = [];
  const last = bucketStart(to, mode);
  for (let key = bucketStart(from, mode); key.length === 10 && key <= last && rows.length < 10000; key = nextBucket(key, mode)) {
    const row = grouped.get(key) || { revenue: 0, count: 0 };
    const start = key < from ? from : key;
    let end = to;
    if (key !== last) { const next = dateOf(nextBucket(key, mode)); next.setDate(next.getDate() - 1); end = localISO(next); }
    const label = mode === "year" ? key.slice(0, 4) : mode === "month" ? dateOf(key).toLocaleDateString("ru-RU", { month: "short", year: "numeric" }) : mode === "week" ? `${shortSalesDate(start)} — ${shortSalesDate(end)}` : shortSalesDate(key);
    rows.push({ key, label, start, end, ...row, average: row.count ? row.revenue / row.count : null });
    if (key === last) break;
  }
  return { mode, label: { day: "По дням", week: "По неделям", month: "По месяцам", year: "По годам" }[mode], rows };
}
export function salesHighlights(sales) {
  const days = new Map();
  sales.forEach((sale) => { if (sale.day) { const row = days.get(sale.day) || { day: sale.day, revenue: 0, count: 0 }; row.revenue += sale.total; row.count++; days.set(sale.day, row); } });
  const rows = [...days.values()];
  return { activeDays: rows.length, average: rows.length ? rows.reduce((sum, day) => sum + day.revenue, 0) / rows.length : 0, best: rows.reduce((best, row) => !best || row.revenue > best.revenue ? row : best, null) };
}
export const salePaymentLabel = (sale) => sale.paymentType === "cash" ? "Наличные" : sale.paymentType === "transfer" ? sale.cardName ? `Перевод · ${sale.cardName}` : "Перевод" : "Другой способ";
export function filterSales(sales, query, payment) {
  const search = query.trim().toLowerCase();
  return sales.filter((sale) => (payment === "all" || (payment === "other" ? !["cash", "transfer"].includes(sale.paymentType) : sale.paymentType === payment)) && (!search || [String(sale.id), `#${sale.id}`, sale.employeeName, sale.cardName, ...sale.items.map((item) => item.name)].some((value) => String(value || "").toLowerCase().includes(search))));
}
