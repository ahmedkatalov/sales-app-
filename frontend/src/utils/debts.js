import { num } from "./format.js";

export function debtTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

// The backend balance is the sum of open purchases minus the payment journal.
// Old 'paid' records remain settled and are included only in historical totals.
export function buildDebtCustomers({ customers = [], debts = [], payments = [] }, now) {
  const groups = new Map();
  const ensure = (id, name = "") => {
    const key = String(id || 0);
    if (!groups.has(key)) groups.set(key, { id: Number(id) || 0, name: name || (id ? `Клиент №${id}` : "Клиент не указан"), records: [], payments: [] });
    return groups.get(key);
  };
  customers.forEach((customer) => {
    const group = ensure(customer.id, customer.name);
    group.createdAt = customer.createdAt;
  });
  debts.forEach((debt) => ensure(debt.customerId, debt.customerName).records.push(debt));
  payments.forEach((payment) => ensure(payment.customerId).payments.push(payment));

  return [...groups.values()].filter((group) => group.records.length || group.payments.length).map((group) => {
    const open = group.records.filter((record) => record.status === "open");
    const openAmount = open.reduce((sum, record) => sum + num(record.amount), 0);
    const legacyPaid = group.records.filter((record) => record.status === "paid").reduce((sum, record) => sum + num(record.amount), 0);
    const journalPaid = group.payments.reduce((sum, payment) => sum + num(payment.amount), 0);
    const borrowed = openAmount + legacyPaid;
    const paid = journalPaid + legacyPaid;
    const remaining = Math.max(0, openAmount - journalPaid);
    const openDates = open.map((record) => debtTimestamp(record.createdAt)).filter((date) => date !== null);
    const firstOpenAt = openDates.length ? Math.min(...openDates) : null;
    const activityDates = [...group.records, ...group.payments].map((entry) => debtTimestamp(entry.createdAt)).filter((date) => date !== null);
    const lastActivity = activityDates.length ? Math.max(...activityDates) : debtTimestamp(group.createdAt);
    return {
      ...group, borrowed, paid, remaining, firstOpenAt, lastActivity,
      ageDays: firstOpenAt === null ? null : Math.floor(Math.max(0, now - firstOpenAt) / 86400000),
      isPaid: remaining === 0,
      percentPaid: borrowed > 0 ? Math.min(100, Math.max(0, (paid / borrowed) * 100)) : 0,
    };
  });
}
