import { businessISO, formatMoney, getDayStartHour, localISO } from './format.js';
import { salesPeriodError, salesPeriodLabel, salesSeries, shortSalesDate } from './sales.js';

export { salesPeriodError as teamPeriodError, salesPeriodLabel as teamPeriodLabel };
export const TEAM_SORTS = { revenue: 'Выручка', orders: 'Чеки', aov: 'Средний чек', itemsSold: 'Товары' };
export const TEAM_WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const teamQuantity = v => Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
export const teamPercent = v => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
export const teamInitials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
export const teamUnknown = e => e.id <= 0 || e.name === 'Без продавца';
export function teamPresets(today = businessISO()) {
  const [y, m, d] = today.split('-').map(Number);
  const ago = n => localISO(new Date(y, m - 1, d - n, 12));
  return [{ id: 'today', label: 'Сегодня', from: today, to: today }, { id: 'yesterday', label: 'Вчера', from: ago(1), to: ago(1) }, { id: 'week', label: '7 дней', from: ago(6), to: today }, { id: 'month', label: 'Этот месяц', from: `${today.slice(0, 7)}-01`, to: today }, { id: 'all', label: 'Всё время', from: '', to: '' }];
}
const finite = v => v !== null && v !== undefined && (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v));
const sum = (rows, key) => rows.reduce((total, r) => total + Number(r[key]), 0);
const near = (a, b) => Math.abs(a - b) <= Math.max(.02, Math.abs(b) * 1e-8);
const numeric = (row, fields) => row && fields.every(key => finite(row[key]));
export function validateTeamReport(data, period) {
  const fail = () => { throw new Error('Сервер вернул неполный или несогласованный отчёт. Обновите данные.'); };
  const totalFields = ['revenue', 'orders', 'aov', 'cash', 'transfer', 'debt', 'discounts', 'itemsSold', 'activeEmployees'];
  const employeeFields = ['id', 'revenue', 'orders', 'aov', 'cash', 'transfer', 'debt', 'discounts', 'itemsSold', 'biggestSale', 'share'];
  if (!data || !numeric(data.totals, totalFields) || !['employees', 'trend', 'byHour', 'byWeekday'].every(key => Array.isArray(data[key]))) fail();
  const count = v => Number.isInteger(Number(v)) && Number(v) >= 0;
  if (!count(data.totals.orders) || !count(data.totals.activeEmployees)) fail();
  if (data.employees.some(e => !numeric(e, employeeFields) || !Number.isInteger(Number(e.id)) || typeof e.name !== 'string' || !e.name.trim() || !count(e.orders) || Number(e.orders) < 1)) fail();
  if (data.trend.some(r => !numeric(r, ['revenue', 'orders']) || !count(r.orders) || typeof r.date !== 'string' || !r.date || salesPeriodError({ from: r.date, to: r.date }) || period?.from && r.date < period.from || period?.to && r.date > period.to)) fail();
  if (data.byHour.length !== 24 || data.byHour.some(r => !numeric(r, ['hour', 'revenue', 'orders']) || !count(r.orders) || !Number.isInteger(Number(r.hour)) || r.hour < 0 || r.hour > 23)) fail();
  if (data.byWeekday.length !== 7 || data.byWeekday.some(r => !numeric(r, ['weekday', 'revenue']) || !Number.isInteger(Number(r.weekday)) || r.weekday < 0 || r.weekday > 6)) fail();
  for (const [rows, key] of [[data.employees, 'id'], [data.trend, 'date'], [data.byHour, 'hour'], [data.byWeekday, 'weekday']]) if (new Set(rows.map(r => String(r[key]))).size !== rows.length) fail();
  for (const key of ['revenue', 'orders', 'cash', 'transfer', 'debt', 'discounts', 'itemsSold']) if (!near(sum(data.employees, key), Number(data.totals[key]))) fail();
  for (const rows of [data.trend, data.byHour]) for (const key of ['revenue', 'orders']) if (!near(sum(rows, key), Number(data.totals[key]))) fail();
  if (!near(sum(data.byWeekday, 'revenue'), Number(data.totals.revenue)) || Number(data.totals.activeEmployees) !== data.employees.length) fail();
  const clean = (row, fields) => ({ ...row, ...Object.fromEntries(fields.map(k => [k, Number(row[k])])) });
  const totals = clean(data.totals, totalFields);
  totals.aov = totals.orders ? totals.revenue / totals.orders : null;
  return { totals, employees: data.employees.map(e => ({ ...clean(e, employeeFields), aov: e.orders > 0 ? Number(e.revenue) / Number(e.orders) : null, share: totals.revenue > 0 ? Number(e.revenue) / totals.revenue * 100 : null })), trend: data.trend.map(r => clean(r, ['revenue', 'orders'])), byHour: data.byHour.map(r => clean(r, ['hour', 'revenue', 'orders'])), byWeekday: data.byWeekday.map(r => clean(r, ['weekday', 'revenue'])) };
}
export function teamLeader(employees) { return [...employees].filter(e => !teamUnknown(e) && e.revenue > 0).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.id - b.id)[0] || null; }
export function teamEmployees(employees, sort = 'revenue', query = '') { return [...employees].filter(e => e.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity) || b.revenue - a.revenue || a.name.localeCompare(b.name, 'ru')); }
export function teamSeries(trend, period) {
  const base = salesSeries(trend.map(r => ({ day: r.date, total: r.revenue })), period.from === period.to ? { from: period.from, to: '' } : period);
  // The shared helper receives one row per day, so restore receipt counts instead of counting daily aggregates.
  const rows = base.rows.map(row => { const days = trend.filter(d => d.date >= row.start && d.date <= row.end); const orders = sum(days, 'orders'); return { ...row, orders, aov: orders ? row.revenue / orders : null }; });
  return { ...base, rows };
}
export function teamHours(data, dayStart = getDayStartHour()) { const rows = Array.from({ length: 24 }, (_, h) => data.find(r => r.hour === h)).map(r => ({ ...r, label: `${String(r.hour).padStart(2, '0')}:00` })); return [...rows.slice(dayStart), ...rows.slice(0, dayStart)]; }
export function teamWeekdays(rows) { return [1, 2, 3, 4, 5, 6, 0].map(w => ({ ...rows.find(r => r.weekday === w), label: TEAM_WEEKDAYS[w] })); }
export function teamPayments(totals) {
  const rows = [{ key: 'cash', label: 'Наличные', value: totals.cash, color: 'var(--brand)' }, { key: 'transfer', label: 'Переводы', value: totals.transfer, color: 'var(--brand-2)' }, { key: 'debt', label: 'В долг', value: totals.debt, color: 'var(--color-amber-400)' }];
  const other = totals.revenue - totals.cash - totals.transfer - totals.debt;
  if (Math.abs(other) > .005) rows.push({ key: 'other', label: 'Другие способы', value: other, color: 'var(--text-muted)' });
  return rows;
}
export function teamLastSale(value) { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Не указана'; }
export function teamCsvRows(report, period, workspace) {
  const metadata = [['Точка', workspace], ['Период', salesPeriodLabel(period)], ['Источник', 'Продажи, записанные на профили продавцов. Выручка после скидок, включая продажи в долг. Это не зарплата и не прибыль.']];
  const header = ['Продавец', 'Выручка', 'Чеки', 'Средний чек', 'Наличные', 'Переводы', 'Долг', 'Товаров', 'Скидки', 'Крупнейший чек', 'Доля %', 'Последняя продажа'];
  return { metadata, header, rows: teamEmployees(report.employees).map(e => [e.name, e.revenue, e.orders, e.aov ?? '', e.cash, e.transfer, e.debt, e.itemsSold, e.discounts, e.biggestSale, e.share ?? '', teamLastSale(e.lastSaleAt)]) };
}
export const teamChartNumber = value => Math.abs(value) >= 1e6 ? `${formatMoney(value / 1e6)}м` : Math.abs(value) >= 1000 ? `${formatMoney(value / 1000)}к` : formatMoney(value);
export { shortSalesDate as shortTeamDate };
