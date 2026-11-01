// Isolated fixtures. These requests never leave the local design preview.
const demoNow = Date.now();
const daysAgo = (days) => new Date(demoNow - days * 86400000).toISOString();
const customerSeed = [
  { id: 1, name: 'Александр Морозов' },
  { id: 2, name: 'Мария Иванова' },
  { id: 3, name: 'Дмитрий Соколов' },
  { id: 4, name: 'Анна Петрова' },
  { id: 5, name: 'Виктория Александровна Смирнова' },
  { id: 6, name: 'Сергей Кузнецов' },
  { id: 7, name: 'Никита Орлов' },
];
const debtSeed = [
  { id: 11, customerId: 1, saleId: 101, amount: 2800, createdAt: daysAgo(41), items: [{ name: 'Капучино', price: 250, qty: 10, total: 2500 }, { name: 'Гранатовый тоник', price: 300, qty: 1, total: 300 }] },
  { id: 12, customerId: 1, saleId: 102, amount: 2000, createdAt: daysAgo(12), items: [{ name: 'Капучино', price: 250, qty: 8, total: 2000 }] },
  { id: 13, customerId: 2, saleId: 103, amount: 1800, createdAt: daysAgo(5), items: [{ name: 'Эспрессо', price: 180, qty: 10, total: 1800 }] },
  { id: 14, customerId: 3, saleId: 104, amount: 960, createdAt: daysAgo(14), items: [{ name: 'Латте с солёной карамелью', price: 320, qty: 3, total: 960 }] },
  { id: 15, customerId: 4, saleId: 105, amount: 500, createdAt: daysAgo(1), items: [{ name: 'Капучино', price: 250, qty: 2, total: 500 }] },
  { id: 16, customerId: 5, saleId: 106, amount: 12500, createdAt: daysAgo(65), items: [{ name: 'Капучино', price: 250, qty: 50, total: 12500 }] },
  { id: 17, customerId: 6, saleId: 107, amount: 750, status: 'paid', createdAt: daysAgo(100), paidAt: daysAgo(90), items: [{ name: 'Капучино', price: 250, qty: 3, total: 750 }] },
  { id: 18, customerId: 7, saleId: 108, amount: 300, createdAt: '', items: [] },
].map((debt) => ({ status: 'open', ...debt, customerName: customerSeed.find((customer) => customer.id === debt.customerId).name }));
const paymentSeed = [
  { id: 21, customerId: 1, amount: 1500, method: 'cash', createdAt: daysAgo(10), note: 'Часть долга за прошлый месяц', createdBy: 'Анна' },
  { id: 22, customerId: 2, amount: 600, method: 'transfer', createdAt: daysAgo(2), note: '', createdBy: 'Михаил' },
  { id: 23, customerId: 4, amount: 500, method: 'cash', createdAt: daysAgo(1), note: 'Полное погашение', createdBy: 'Анна' },
];
let payments = structuredClone(paymentSeed);
let archived = new Set();
let scenario = 'normal';
let failRefresh = false;
let nextId = 100;

export function setDebtsPreviewScenario(value) {
  scenario = value;
  payments = structuredClone(paymentSeed);
  archived = new Set();
  failRefresh = false;
}
const outstanding = (id) => debtSeed.filter((debt) => debt.customerId === id && debt.status === 'open').reduce((sum, debt) => sum + debt.amount, 0)
  - payments.filter((payment) => payment.customerId === id).reduce((sum, payment) => sum + payment.amount, 0);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

export function debtsPreviewResponse(url, options = {}) {
  const path = new URL(url, window.location.origin).pathname.replace(/^\/api/, '');
  if (!['/debts', '/debt-customers', '/debt-payments', '/debts/history'].includes(path) && !/^\/debt-payments\/\d+$/.test(path)) return null;
  const method = options.method || 'GET';
  if (method === 'GET') {
    if (scenario === 'load-error' || failRefresh) return json({ error: 'Демонстрационный сбой загрузки. Проверьте соединение.' }, 503);
    if (scenario === 'empty') return json([]);
    if (path === '/debt-customers') return json(customerSeed.filter((customer) => !archived.has(customer.id)).map((customer) => ({ ...customer, debtTotal: Math.max(0, outstanding(customer.id)) })));
    if (path === '/debts') return json(debtSeed.filter((debt) => !archived.has(debt.customerId)));
    if (path === '/debt-payments') return json(payments.filter((payment) => !archived.has(payment.customerId)));
  }
  if (scenario === 'payment-error') return json({ error: 'Демонстрационная ошибка. Погашение не записано.' }, 503);
  if (path === '/debt-payments' && method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    const amount = Number(body.amount);
    if (!(amount > 0) || amount > outstanding(body.customerId) + .5) return json({ error: 'Проверьте сумму погашения' }, 400);
    const payment = { ...body, amount, id: ++nextId, createdAt: body.date ? `${body.date}T12:00:00Z` : new Date().toISOString() };
    payments.push(payment);
    if (scenario === 'refresh-error') failRefresh = true;
    return json({ ok: true, id: payment.id });
  }
  if (method === 'DELETE' && path === '/debts/history') {
    customerSeed.forEach((customer) => { if (outstanding(customer.id) <= 0) archived.add(customer.id); });
    return json({ ok: true });
  }
  if (method === 'DELETE') {
    const id = Number(path.split('/').pop());
    const index = payments.findIndex((payment) => payment.id === id);
    if (index < 0) return json({ error: 'Погашение не найдено' }, 404);
    payments.splice(index, 1);
    return json({ ok: true });
  }
  return json({ error: 'Неизвестный запрос предпросмотра' }, 400);
}
