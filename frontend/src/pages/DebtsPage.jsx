import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, History, ReceiptText } from "lucide-react";
import { del, get, post } from "../api";
import { formatMoney } from "../utils/format";

export default function DebtsPage() {
  const [debts, setDebts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [openedCustomer, setOpenedCustomer] = useState(null);


  const load = async () => {
    const [debtList, customerList] = await Promise.all([
      get("/debts").catch(() => []),
      get("/debt-customers").catch(() => []),
    ]);

    setDebts(debtList || []);
    setCustomers(customerList || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const customerGroups = useMemo(() => {
    const byId = new Map();

    (Array.isArray(customers) ? customers : []).forEach((customer) => {
      byId.set(customer.id, {
        ...customer,
        records: [],
        totalDebt: Number(customer.debtTotal || 0),
        totalPaid: 0,
        totalAll: 0,
        lastDate: customer.createdAt || "",
      });
    });

    (Array.isArray(debts) ? debts : []).forEach((debt) => {
      const customerId = debt.customerId || 0;
      const existing = byId.get(customerId) || {
        id: customerId,
        name: debt.customerName || "Без имени",
        records: [],
        totalDebt: 0,
        totalPaid: 0,
        totalAll: 0,
        lastDate: debt.createdAt || "",
      };

      const amount = Number(debt.amount || 0);
      existing.records.push(debt);
      existing.totalAll += amount;

      if (debt.status === "paid") existing.totalPaid += amount;
      if (!existing.lastDate || new Date(debt.createdAt) > new Date(existing.lastDate)) {
        existing.lastDate = debt.createdAt;
      }

      byId.set(customerId, existing);
    });

    return Array.from(byId.values())
      .filter((customer) => customer.records.length > 0 || Number(customer.totalDebt || 0) > 0)
      .sort(
        (a, b) =>
          Number(b.totalDebt || 0) - Number(a.totalDebt || 0) ||
          new Date(b.lastDate) - new Date(a.lastDate)
      );
  }, [customers, debts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customerGroups;

    return customerGroups.filter((customer) =>
      String(customer.name || "").toLowerCase().includes(q)
    );
  }, [customerGroups, query]);

  const closeDebt = async (id) => {
    await post(`/debts/${id}/close`, {});
    await load();
  };

  const closeAllOpenDebts = async (customer) => {
    const openRecords = customer.records.filter((record) => record.status !== "paid");
    if (!openRecords.length) return;
    if (!window.confirm(`Погасить весь долг клиента ${customer.name}?`)) return;

    for (const record of openRecords) {
      await post(`/debts/${record.id}/close`, {});
    }

    await load();
  };

  const clearHistory = async () => {
    if (!window.confirm("Удалить закрытую историю долгов? Открытые долги останутся.")) return;

    await del("/debts/history");
    await load();
  };

  const totalOpen = customerGroups.reduce(
    (sum, customer) => sum + Number(customer.totalDebt || 0),
    0
  );

  const totalPaid = customerGroups.reduce(
    (sum, customer) => sum + Number(customer.totalPaid || 0),
    0
  );

  const totalRecords = customerGroups.reduce(
    (sum, customer) => sum + Number(customer.records?.length || 0),
    0
  );

  return (
    <div
      className="relative min-h-screen pb-nav text-white sm:pb-10"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-130px] top-[-130px] h-[380px] w-[380px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-150px] right-[-120px] h-[380px] w-[380px] rounded-full bg-violet-600/20 blur-3xl" />
      </div>

      <div className="relative z-10">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-400">Клиенты</p>

            <h2 className="text-3xl font-black leading-none text-white sm:text-5xl">
              Долги
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 sm:mt-3 sm:text-base">
              Контроль открытых долгов, закрытой истории и оплат по каждому клиенту.
            </p>
          </div>

          <div className="flex shrink-0 gap-2.5">
            <button
              onClick={load}
              aria-label="Обновить"
              className="flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 font-black text-slate-200 shadow-xl transition hover:bg-white/10"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
              <span className="hidden sm:inline">Обновить</span>
            </button>

            <button
              onClick={clearHistory}
              className="flex h-12 items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 font-black text-red-300 shadow-xl transition hover:bg-red-500/15"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
              <span>Удалить историю</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-3xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-bold text-red-300">
            {error}
          </div>
        )}

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 shadow-2xl sm:rounded-[28px] sm:p-5">
            <p className="text-[10px] font-black uppercase tracking-wide text-red-200 sm:text-xs">
              Открытый долг
            </p>
            <p className="mt-1.5 text-2xl font-black text-white sm:mt-3 sm:text-4xl">
              {formatMoney(totalOpen)}
            </p>
            <p className="mt-1 text-[11px] font-bold text-slate-400 sm:text-sm">
              нужно получить
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 shadow-2xl sm:rounded-[28px] sm:p-5">
            <p className="text-[10px] font-black uppercase tracking-wide text-emerald-200 sm:text-xs">
              Уже оплачено
            </p>
            <p className="mt-1.5 text-2xl font-black text-white sm:mt-3 sm:text-4xl">
              {formatMoney(totalPaid)}
            </p>
            <p className="mt-1 text-[11px] font-bold text-slate-400 sm:text-sm">
              закрытые долги
            </p>
          </div>

          <div className="col-span-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 shadow-2xl sm:col-span-1 sm:rounded-[28px] sm:p-5">
            <p className="text-[10px] font-black uppercase tracking-wide text-blue-200 sm:text-xs">
              Клиентов / записей
            </p>
            <p className="mt-1.5 text-2xl font-black text-white sm:mt-3 sm:text-4xl">
              {customerGroups.length}/{totalRecords}
            </p>
            <p className="mt-1 text-[11px] font-bold text-slate-400 sm:text-sm">
              в истории долгов
            </p>
          </div>
        </div>

        <div className="mb-5 rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-4 shadow-2xl backdrop-blur sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти клиента"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
            />

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 font-black text-white">
              Открыто: <span className="text-red-300">{formatMoney(totalOpen)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {filtered.map((customer) => {
            const isOpen = openedCustomer === customer.id;
            const openRecords = customer.records.filter((record) => record.status !== "paid");
            const paidRecords = customer.records.filter((record) => record.status === "paid");

            return (
              <div
                key={customer.id || customer.name}
                className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur"
              >
                <button
                  type="button"
                  onClick={() => setOpenedCustomer(isOpen ? null : customer.id)}
                  className="w-full p-4 text-left transition hover:bg-white/[0.03] sm:p-5"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl border border-blue-400/20 bg-blue-500/10 text-2xl font-black text-blue-300">
                        {String(customer.name || "?").slice(0, 1).toUpperCase()}
                      </div>

                      <div className="min-w-0">
                        <h3 className="truncate text-2xl font-black text-white">
                          {customer.name}
                        </h3>

                        <p className="mt-1 text-sm font-bold text-slate-400">
                          Записей: {customer.records.length} · открытых: {openRecords.length} · закрытых: {paidRecords.length}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 sm:gap-3 xl:min-w-[560px]">
                      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
                        <p className="text-[10px] font-black uppercase text-slate-400 sm:text-xs">
                          Текущий долг
                        </p>

                        <p className="text-base font-black text-red-300 sm:text-xl">
                          {formatMoney(customer.totalDebt || 0)}
                        </p>
                      </div>

                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
                        <p className="text-[10px] font-black uppercase text-slate-400 sm:text-xs">
                          Оплачено
                        </p>

                        <p className="text-base font-black text-emerald-300 sm:text-xl">
                          {formatMoney(customer.totalPaid || 0)}
                        </p>
                      </div>

                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase text-slate-400 sm:text-xs">
                            Всего
                          </p>

                          <p className="text-base font-black text-white sm:text-xl">
                            {formatMoney(customer.totalAll || 0)}
                          </p>
                        </div>

                        <span className="shrink-0 text-slate-400">{isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</span>
                      </div>
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/10 p-4 sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-center gap-2 font-black text-slate-200">
                        <History size={20} className="text-blue-400" />
                        История долгов клиента
                      </div>

                      {!!openRecords.length && (
                        <button
                          onClick={() => closeAllOpenDebts(customer)}
                          className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-950/30 transition hover:scale-[1.01]"
                        >
                          Погасить весь долг
                        </button>
                      )}
                    </div>

                    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#111827]">
                      <div className="hidden grid-cols-[180px_1fr_130px_130px_130px] gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-slate-400 lg:grid">
                        <span>Дата</span>
                        <span>Описание</span>
                        <span>Сумма</span>
                        <span>Статус</span>
                        <span>Действие</span>
                      </div>

                      {customer.records.map((debt) => (
                        <div
                          key={debt.id}
                          className="border-t border-white/10 px-4 py-4 first:border-t-0 lg:grid lg:grid-cols-[180px_1fr_130px_130px_130px] lg:items-center lg:gap-3"
                        >
                          <div className="flex items-center justify-between gap-3 lg:block">
                            <div className="text-sm font-black text-slate-300 lg:text-base">
                              {debt.createdAt ? new Date(debt.createdAt).toLocaleString("ru-RU") : "—"}
                            </div>
                            <div className="text-lg font-black text-white lg:hidden">
                              {formatMoney(debt.amount)}
                            </div>
                          </div>

                          <div className="mt-2 lg:mt-0">
                            <div className="flex items-start gap-2 font-bold text-slate-100">
                              <ReceiptText size={18} className="mt-1 shrink-0 text-slate-500" />
                              <span>
                                {(debt.items || [])
                                  .map((item) => `${item.name} × ${item.qty}`)
                                  .join(", ") || "Покупка в долг"}
                              </span>
                            </div>

                            {!!debt.paidAt && (
                              <p className="mt-1 text-xs font-bold text-slate-500">
                                Оплачено: {new Date(debt.paidAt).toLocaleString("ru-RU")}
                              </p>
                            )}
                          </div>

                          <div className="hidden font-black text-white lg:block">
                            {formatMoney(debt.amount)}
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3 lg:mt-0 lg:block">
                            <span
                              className={`rounded-xl px-3 py-1.5 text-sm font-black lg:rounded-2xl lg:py-2 ${
                                debt.status === "paid"
                                  ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                  : "border border-red-400/20 bg-red-400/10 text-red-300"
                              }`}
                            >
                              {debt.status === "paid" ? "Оплачен" : "В долгу"}
                            </span>

                            {debt.status !== "paid" ? (
                              <button
                                onClick={() => closeDebt(debt.id)}
                                className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition hover:scale-[1.01] lg:hidden"
                              >
                                Оплатить
                              </button>
                            ) : null}
                          </div>

                          <div className="hidden lg:block">
                            {debt.status !== "paid" ? (
                              <button
                                onClick={() => closeDebt(debt.id)}
                                className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-blue-950/30 transition hover:scale-[1.01]"
                              >
                                Оплатить
                              </button>
                            ) : (
                              <span className="text-sm font-bold text-slate-500">
                                История
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!filtered.length && (
          <div className="mt-4 rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-10 text-center text-slate-400 shadow-2xl backdrop-blur">
            Клиентов с долгами пока нет
          </div>
        )}
      </div>
    </div>
  );
}
