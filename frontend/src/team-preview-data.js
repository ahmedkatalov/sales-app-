import { businessISO, localISO } from './utils/format.js';
export const teamPreviewWorkspace = { id: 1, dataAccountId: 900101, name: 'Noor Coffee · Центр' };
export const teamPreviewOtherWorkspace = { id: 2, dataAccountId: 900102, name: 'Noor Coffee · Парк' };
const today = businessISO(), base = new Date(`${today}T12:00:00`);
const people = [{ id: 21, name: 'Алина' }, { id: 22, name: 'Михаил' }, { id: 23, name: 'София' }, { id: 24, name: 'Тимур' }, { id: 25, name: 'Екатерина' }];
const sales = [];
for (let ago = 64; ago >= 0; ago--) {
  const date = new Date(base); date.setDate(date.getDate() - ago); const day = localISO(date);
  people.forEach((p, i) => {
    if ((ago + i) % 4 === 0) return;
    const count = i === 1 ? 2 + ago % 2 : 3 + (ago * 3 + i * 7) % 8;
    for (let n = 0; n < count; n++) {
      const discount = n % 5 === 0 ? 35.5 : 0;
      sales.push({ day, employee: p, revenue: [460, 1750, 410, 920, 590][i] + (ago % 5) * 35 + n * 20 - discount, discount, qty: 1 + n % 3 + (n % 4 === 0 ? .5 : 0), hour: (7 + i * 3 + n % 5) % 24, payment: ['cash', 'transfer', 'transfer', 'debt'][(ago + n + i) % 4] });
    }
  });
  if (ago % 6 === 0) sales.push({ day, employee: { id: 0, name: 'Без продавца' }, revenue: 740, discount: 0, qty: 2, hour: 12, payment: 'cash' });
}
let scenario = 'normal', reads = 0;
export function setTeamPreviewScenario(value) { scenario = value; reads = 0; }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function aggregate(source) {
  const totals = { revenue: 0, orders: 0, aov: 0, cash: 0, transfer: 0, debt: 0, discounts: 0, itemsSold: 0, activeEmployees: 0 };
  const employees = new Map(), trend = new Map();
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, orders: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, revenue: 0 }));
  for (const s of source) {
    const e = employees.get(s.employee.id) || { ...s.employee, revenue: 0, orders: 0, aov: 0, cash: 0, transfer: 0, debt: 0, discounts: 0, itemsSold: 0, biggestSale: null, share: 0, hireDate: '2026-04-10T08:00:00+03:00', lastSaleAt: '' };
    for (const row of [totals, e]) { row.revenue += s.revenue; row.orders++; if (s.payment in row) row[s.payment] += s.revenue; row.discounts += s.discount; row.itemsSold += s.qty; }
    e.biggestSale = e.biggestSale === null ? s.revenue : Math.max(e.biggestSale, s.revenue); const stamp = `${s.day}T${String(s.hour).padStart(2, '0')}:24:00+03:00`; if (stamp > e.lastSaleAt) e.lastSaleAt = stamp; if (e.id <= 0) e.hireDate = '';
    employees.set(e.id, e);
    const d = trend.get(s.day) || { date: s.day, revenue: 0, orders: 0 }; d.revenue += s.revenue; d.orders++; trend.set(s.day, d);
    byHour[s.hour].revenue += s.revenue; byHour[s.hour].orders++; byWeekday[new Date(`${s.day}T12:00:00`).getDay()].revenue += s.revenue;
  }
  totals.activeEmployees = employees.size; totals.aov = totals.orders ? totals.revenue / totals.orders : 0;
  const rows = [...employees.values()].map(e => ({ ...e, aov: e.revenue / e.orders, share: totals.revenue > 0 ? e.revenue / totals.revenue * 100 : 0 })).sort((a, b) => b.revenue - a.revenue);
  return { totals, employees: rows, trend: [...trend.values()].sort((a, b) => a.date.localeCompare(b.date)), byHour, byWeekday };
}
export function teamPreviewResponse(url, options = {}) {
  const location = new URL(window.location.href);
  if (location.searchParams.get('page') !== 'team' && location.pathname !== '/team') return null;
  const parsed = new URL(url, location.origin), path = parsed.pathname.replace(/^\/api/, '');
  if (path !== '/analytics/employees') return null;
  if (options.method && options.method !== 'GET') return json({ error: 'Демонстрация сотрудников доступна только для чтения.' }, 400);
  reads++;
  if (scenario === 'denied') return json({ error: 'Отчёт доступен только владельцу и администратору.' }, 403);
  if (scenario === 'load-error' || scenario === 'refresh-error' && reads > 1) return json({ error: 'Демонстрационный сбой загрузки. Попробуйте ещё раз.' }, 503);
  const from = parsed.searchParams.get('from') || '', to = parsed.searchParams.get('to') || '';
  let source = scenario === 'empty' ? [] : sales.filter(s => (!from || s.day >= from) && (!to || s.day <= to));
  if (scenario === 'zero') source = source.map(s => ({ ...s, revenue: 0 }));
  if (scenario === 'negative') source = source.map(s => ({ ...s, revenue: -s.revenue }));
  if (scenario === 'unassigned') source = source.map(s => ({ ...s, employee: { id: 0, name: 'Без продавца' } }));
  if (scenario === 'other') source = source.map((s, i) => i % 5 === 0 ? { ...s, payment: 'other' } : s);
  const dataId = Number(options.headers?.['X-Data-Account-ID'] || parsed.searchParams.get('accountId'));
  if (dataId === 900102) source = source.filter((_, i) => i % 5 === 0).map(s => ({ ...s, employee: { id: 31, name: 'Лейла · Парк' } }));
  const report = aggregate(source);
  if (scenario === 'invalid') report.byHour.pop();
  return json(report);
}
