// Cash-register transactions in the preview exist only in this module's memory.
const receipts = [];
const clientRefs = new Map();
const previewNow = Date.now();
const pendingSeed = [
  { id: 401, employeeName: 'Анна', minutes: 72, subtotal: 790, discountPercent: 10, discountAmount: 79, total: 711, items: [{ name: 'Капучино', price: 250, qty: 2, total: 500 }, { name: 'Круассан с миндалём', price: 290, qty: 1, total: 290 }] },
  { id: 402, employeeName: 'Михаил', minutes: 38, total: 620, items: [{ name: 'Латте с солёной карамелью', price: 320, qty: 1, total: 320 }, { name: 'Гранатовый тоник', price: 300, qty: 1, total: 300 }] },
  { id: 403, employeeName: 'Анна', minutes: 18, total: 360, items: [{ name: 'Эспрессо', price: 180, qty: 2, total: 360 }] },
  { id: 404, employeeName: 'Мария', minutes: 6, total: 510, items: [{ name: 'Флэт уайт', price: 260, qty: 1, total: 260 }, { name: 'Капучино', price: 250, qty: 1, total: 250 }] },
  { id: 405, employeeName: 'Михаил', minutes: 2, subtotal: 70, discountPercent: 100, discountAmount: 70, total: 0, items: [{ name: 'Дополнительный шот эспрессо', price: 70, qty: 1, total: 70 }] },
  { id: 406, employeeName: 'Мария', minutes: 1560, total: 450, items: [{ name: 'Круассан с лососем и сливочным сыром', price: 450, qty: 1, total: 450 }] },
].map(({ minutes, ...sale }) => ({ ...sale, createdAt: new Date(previewNow - minutes * 60000).toISOString() }));
const pending = structuredClone(pendingSeed);
let pendingScenario = 'normal';

export function setPendingPreviewScenario(scenario) {
  pendingScenario = scenario;
  pending.splice(0, pending.length, ...structuredClone(pendingSeed));
}
let receiptId = 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export function posPreviewResponse(url, options = {}) {
  const path = new URL(url, window.location.origin).pathname.replace(/^\/api/, '');
  const method = options.method || 'GET';
  if (method === 'GET') {
    if (path === '/cards' && pendingScenario === 'cards-error') return json({ error: 'Демонстрационный сбой загрузки счетов' }, 503);
    if (path === '/cards') return json([{ id: 1, name: 'Основной счёт', owner: 'Демонстрационная точка' }]);
    if (path === '/debt-customers') return json([{ id: 1, name: 'Александр', debtTotal: 1200 }, { id: 2, name: 'Мария', debtTotal: 450 }]);
    if (path === '/cash/shift/current') return json({ open: true, shift: { id: 1, openedBy: 'Анна', openingCash: 3000, cashSales: 19250, cashIn: 0, cashOut: 500, expectedCash: 21750, status: 'open' } });
    if (path === '/online-orders') return json([]);
    if (path === '/pending-sales' && pendingScenario === 'load-error') return json({ error: 'Демонстрационный сбой связи с сервером' }, 503);
    if (path === '/pending-sales') return json(pendingScenario === 'empty' ? [] : pending);
    if (path === '/sales' && receipts.length) return json(receipts);
  }
  const pendingMatch = path.match(/^\/pending-sales\/(\d+)(\/confirm)?$/);
  if (pendingMatch && (method === 'POST' || method === 'DELETE')) {
    const index = pending.findIndex(sale => sale.id === Number(pendingMatch[1]));
    if (index < 0) return json({ error: 'Этот чек уже обработан' }, 404);
    if (method === 'POST') {
      if (pendingScenario === 'payment-error') return json({ error: 'Демонстрационный сбой оплаты. Чек остаётся в ожидании.' }, 503);
      const payment = JSON.parse(options.body || '{}');
      const sale = pending[index];
      receipts.unshift({ ...sale, ...payment, changeAmount: payment.paymentType === 'cash' ? payment.cashGiven - sale.total : 0 });
    }
    pending.splice(index, 1);
    return json({ ok: true });
  }
  if (method === 'POST' && (path === '/sales' || path === '/pending-sales')) {
    const body = JSON.parse(options.body || '{}');
    if (path === '/sales' && clientRefs.has(body.clientRef)) return json(clientRefs.get(body.clientRef));
    const subtotal = (body.items || []).reduce((sum, item) => sum + item.price * item.qty, 0);
    const total = subtotal * (1 - Number(body.discountPercent || 0) / 100);
    const receipt = { ...body, id: ++receiptId, subtotal, total, changeAmount: body.paymentType === 'cash' ? body.cashGiven - total : 0, createdAt: new Date().toISOString() };
    if (path === '/pending-sales') pending.unshift(receipt);
    else {
      receipts.unshift(receipt);
      clientRefs.set(body.clientRef, receipt);
    }
    return json(receipt);
  }
  return null;
}
