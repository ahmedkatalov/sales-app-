import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, History, ReceiptText, Wallet, RotateCcw } from "lucide-react";
import { del, get, post } from "../api";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import DatePicker from "../components/DatePicker";
import { formatMoney } from "../utils/format";

export default function DebtsPage() {
  const [debts, setDebts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [openedCustomer, setOpenedCustomer] = useState(null);

  // Модалка «Клиент оплатил»: держит клиента + форму (сумма, дата, способ, комментарий).
  const [payModal, setPayModal] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "cash", date: "", note: "" });

  const load = async () => {
    const [debtList, customerList, paymentList] = await Promise.all([
      get("/debts").catch(() => []),
      get("/debt-customers").catch(() => []),
      get("/debt-payments").catch(() => []),
    ]);

    setDebts(debtList || []);
    setCustomers(customerList || []);
    setPayments(paymentList || []);
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
        payments: [],
        lastDate: customer.createdAt || "",
      });
    });

    (Array.isArray(debts) ? debts : []).forEach((debt) => {
      const customerId = debt.customerId || 0;
      const existing = byId.get(customerId) || {
        id: customerId,
        name: debt.customerName || "Без имени",
        records: [],
        payments: [],
        lastDate: debt.createdAt || "",
      };
      existing.records.push(debt);
      if (!existing.lastDate || new Date(debt.createdAt) > new Date(existing.lastDate)) {
        existing.lastDate = debt.createdAt;
      }
      byId.set(customerId, existing);
    });

    (Array.isArray(payments) ? payments : []).forEach((payment) => {
      const existing = byId.get(payment.customerId);
      if (!existing) return; // платёж без клиента (после чистки истории) — пропускаем
      existing.payments.push(payment);
      if (!existing.lastDate || new Date(payment.createdAt) > new Date(existing.lastDate)) {
        existing.lastDate = payment.createdAt;
      }
    });

    return Array.from(byId.values())
      .map((customer) => {
        // «Открытые» долги (строки не переводятся в paid — источник правды платежи).
        const borrowed = customer.records
          .filter((r) => r.status !== "paid")
          .reduce((s, r) => s + Number(r.amount || 0), 0);
        const paid = customer.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        const remaining = Math.max(0, borrowed - paid);
        return { ...customer, borrowed, paid, remaining };
      })
      .filter((customer) => customer.records.length > 0 || customer.payments.length > 0)
      .sort(
        (a, b) =>
          Number(b.remaining || 0) - Number(a.remaining || 0) ||
          new Date(b.lastDate) - new Date(a.lastDate)
      );
  }, [customers, debts, payments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customerGroups;
    return customerGroups.filter((customer) =>
      String(customer.name || "").toLowerCase().includes(q)
    );
  }, [customerGroups, query]);

  // Защита от двойного запроса + показ ошибки тостом.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const guarded = async (fn) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await fn();
    } catch (e) {
      window.notify?.(e?.message || "Не удалось выполнить операцию. Попробуйте снова.", "error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const openPay = (customer) => {
    setPayForm({ amount: customer.remaining ? String(customer.remaining) : "", method: "cash", date: "", note: "" });
    setPayModal(customer);
  };

  const savePayment = async () => {
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) {
      window.notify?.("Введите сумму больше нуля", "error");
      return;
    }
    await guarded(async () => {
      await post("/debt-payments", {
        customerId: payModal.id,
        amount,
        method: payForm.method,
        date: payForm.date || undefined,
        note: payForm.note,
      });
      setPayModal(null);
      await load();
      window.notify?.("Оплата записана", "success");
    });
  };

  const undoPayment = async (id) => {
    if (!window.confirm("Отменить это погашение? Долг вернётся, а касса откатится на эту сумму.")) return;
    await guarded(async () => {
      await del(`/debt-payments/${id}`);
      await load();
      window.notify?.("Погашение отменено", "success");
    });
  };

  const clearHistory = async () => {
    if (!window.confirm("Убрать из истории полностью погашенных клиентов? Открытые долги останутся.")) return;
    await guarded(async () => {
      await del("/debts/history");
      await load();
    });
  };

  const totalOpen = customerGroups.reduce((sum, c) => sum + Number(c.remaining || 0), 0);
  const totalPaid = customerGroups.reduce((sum, c) => sum + Number(c.paid || 0), 0);
  const totalRecords = customerGroups.reduce((sum, c) => sum + Number(c.records?.length || 0), 0);

  const methodLabel = (m) => (m === "transfer" ? "Перевод" : "Наличные");

  return (
    <div
      className="relative min-h-screen pb-nav text-white sm:pb-10"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-130px] top-[-130px] h-[380px] w-[380px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-150px] right-[-120px] h-[380px] w-[380px] rounded-full bg-violet-600/20 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1400px]">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-400">Клиенты</p>
            <h2 className="text-3xl font-black leading-none text-white sm:text-5xl">Долги</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400 sm:mt-3 sm:text-base">
              Отмечайте оплату долга: сумма, дата и способ. Наличные попадают в кассу. Любое погашение можно отменить.
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
              disabled={submitting}
              className="flex h-12 items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 font-black text-red-300 shadow-xl transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
              <span>Убрать погашенных</span>
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
            <p className="text-[11px] font-black uppercase tracking-wide text-red-200 sm:text-xs">Остаток долгов</p>
            <p className="mt-1.5 text-2xl font-black text-white sm:mt-3 sm:text-4xl">{formatMoney(totalOpen)}</p>
            <p className="mt-1 text-[11px] font-bold text-slate-400 sm:text-sm">нужно получить</p>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 shadow-2xl sm:rounded-[28px] sm:p-5">
            <p className="text-[11px] font-black uppercase tracking-wide text-emerald-200 sm:text-xs">Оплачено</p>
            <p className="mt-1.5 text-2xl font-black text-white sm:mt-3 sm:text-4xl">{formatMoney(totalPaid)}</p>
            <p className="mt-1 text-[11px] font-bold text-slate-400 sm:text-sm">погашено долгов</p>
          </div>

          <div className="col-span-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 shadow-2xl sm:col-span-1 sm:rounded-[28px] sm:p-5">
            <p className="text-[11px] font-black uppercase tracking-wide text-blue-200 sm:text-xs">Клиентов / записей</p>
            <p className="mt-1.5 text-2xl font-black text-white sm:mt-3 sm:text-4xl">{customerGroups.length}/{totalRecords}</p>
            <p className="mt-1 text-[11px] font-bold text-slate-400 sm:text-sm">в истории долгов</p>
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
              Остаток: <span className="text-red-300">{formatMoney(totalOpen)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {filtered.map((customer) => {
            const isOpen = openedCustomer === customer.id;

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
                        <h3 className="truncate text-2xl font-black text-white">{customer.name}</h3>
                        <p className="mt-1 text-sm font-bold text-slate-400">
                          Покупок в долг: {customer.records.length} · погашений: {customer.payments.length}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 sm:gap-3 xl:min-w-[560px]">
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
                        <p className="text-[11px] font-black uppercase text-slate-400 sm:text-xs">Взял в долг</p>
                        <p className="text-base font-black text-white sm:text-xl">{formatMoney(customer.borrowed || 0)}</p>
                      </div>

                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
                        <p className="text-[11px] font-black uppercase text-slate-400 sm:text-xs">Оплатил</p>
                        <p className="text-base font-black text-emerald-300 sm:text-xl">{formatMoney(customer.paid || 0)}</p>
                      </div>

                      <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 sm:rounded-2xl sm:px-4 sm:py-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black uppercase text-slate-400 sm:text-xs">Остаток</p>
                          <p className="text-base font-black text-red-300 sm:text-xl">{formatMoney(customer.remaining || 0)}</p>
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
                        Покупки в долг
                      </div>

                      {customer.remaining > 0 && (
                        <button
                          onClick={() => openPay(customer)}
                          disabled={submitting}
                          className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3 font-black text-white shadow-lg shadow-emerald-950/30 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Wallet size={18} strokeWidth={2.4} /> Клиент оплатил
                        </button>
                      )}
                    </div>

                    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#111827]">
                      <div className="hidden grid-cols-[180px_1fr_140px] gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-slate-400 lg:grid">
                        <span>Дата</span>
                        <span>Описание</span>
                        <span className="text-right">Сумма</span>
                      </div>

                      {customer.records.map((debt) => (
                        <div
                          key={debt.id}
                          className="border-t border-white/10 px-4 py-4 first:border-t-0 lg:grid lg:grid-cols-[180px_1fr_140px] lg:items-center lg:gap-3"
                        >
                          <div className="flex items-center justify-between gap-3 lg:block">
                            <div className="text-sm font-black text-slate-300 lg:text-base">
                              {debt.createdAt ? new Date(debt.createdAt).toLocaleDateString("ru-RU") : "—"}
                            </div>
                            <div className="text-lg font-black text-white lg:hidden">{formatMoney(debt.amount)}</div>
                          </div>

                          <div className="mt-2 lg:mt-0">
                            <div className="flex items-start gap-2 font-bold text-slate-100">
                              <ReceiptText size={18} className="mt-1 shrink-0 text-slate-500" />
                              <span>
                                {(debt.items || []).map((item) => `${item.name} × ${item.qty}`).join(", ") || "Покупка в долг"}
                              </span>
                            </div>
                          </div>

                          <div className="hidden text-right font-black text-white lg:block">{formatMoney(debt.amount)}</div>
                        </div>
                      ))}
                    </div>

                    {/* Погашения долга с возможностью отмены */}
                    {customer.payments.length > 0 && (
                      <div className="mt-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-black text-emerald-300">
                          <Wallet size={16} strokeWidth={2.4} /> Погашения
                        </div>
                        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#111827]">
                          {customer.payments.map((p) => (
                            <div
                              key={p.id}
                              className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 first:border-t-0"
                            >
                              <div className="min-w-0">
                                <p className="font-black text-emerald-300">
                                  {formatMoney(p.amount)} <span className="text-xs font-bold text-slate-400">· {methodLabel(p.method)}</span>
                                </p>
                                <p className="mt-0.5 text-xs font-bold text-slate-500">
                                  {p.createdAt ? new Date(p.createdAt).toLocaleDateString("ru-RU") : "—"}
                                  {p.note ? ` · ${p.note}` : ""}
                                </p>
                              </div>
                              <button
                                onClick={() => undoPayment(p.id)}
                                disabled={submitting}
                                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300 transition hover:bg-red-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <RotateCcw size={14} strokeWidth={2.6} /> Отменить
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!filtered.length && (
          <EmptyState
            className="mt-4"
            icon={<ReceiptText size={26} />}
            title={query.trim() ? "Клиент не найден" : "Долгов пока нет"}
            text={
              query.trim()
                ? "По вашему запросу ничего не нашлось. Измените имя клиента."
                : "Здесь появятся клиенты с открытыми и погашенными долгами."
            }
          />
        )}
      </div>

      {payModal && (
        <Modal title="Клиент оплатил" section={payModal.name} onClose={() => setPayModal(null)} legacyLight={false}>
          <div className="grid gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <span className="text-sm text-slate-400">Остаток долга</span>
              <b className="ml-2 text-lg font-black text-red-300">{formatMoney(payModal.remaining || 0)}</b>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-300">Сколько оплатил</span>
              <input
                value={payForm.amount}
                onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))}
                type="text"
                inputMode="decimal"
                autoFocus
                placeholder="Например: 5000"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/70 focus:ring-4 focus:ring-emerald-500/10"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-300">
                Дата <span className="font-bold text-slate-500">— необязательно, по умолчанию сегодня</span>
              </span>
              <DatePicker value={payForm.date} onChange={(v) => setPayForm((p) => ({ ...p, date: v }))} placeholder="Сегодня" />
            </label>

            <div>
              <span className="mb-2 block text-sm font-black text-slate-300">Способ</span>
              <div className="grid grid-cols-2 gap-2">
                {[["cash", "Наличные"], ["transfer", "Перевод"]].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPayForm((p) => ({ ...p, method: val }))}
                    className={`rounded-2xl border px-3 py-3 text-center text-sm font-black transition ${
                      payForm.method === val
                        ? "border-emerald-400/70 bg-emerald-500/15 text-white"
                        : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-bold text-slate-500">
                Наличные попадут в кассу на выбранную дату. Перевод — на счёт (банк).
              </p>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-300">Комментарий <span className="font-bold text-slate-500">— необязательно</span></span>
              <input
                value={payForm.note}
                onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))}
                type="text"
                placeholder="Например: часть долга"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/70"
              />
            </label>

            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setPayModal(null)}
                className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/15"
              >
                Отмена
              </button>
              <button
                onClick={savePayment}
                disabled={submitting}
                className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-4 font-black text-white shadow-lg shadow-emerald-950/30 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Сохраняю…" : "Записать оплату"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
