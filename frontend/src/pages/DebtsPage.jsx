import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, ArrowDownWideNarrow, CheckCircle2, ChevronDown, ChevronUp, Clock, Crown, Filter, HandCoins, History, ReceiptText, RotateCcw, Search, Users, Wallet } from "lucide-react";
import { del, get, post } from "../api";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import DatePicker from "../components/DatePicker";
import { formatMoney } from "../utils/format";

// ── чистые хелперы (react-hooks/purity: new Date с аргументом — ок) ──
const dayMs = 86400000;
const ageDays = (ms) => Math.floor(ms / dayMs);
const plural = (n, forms) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
};
const fmtAge = (ms) => {
  const d = ageDays(ms);
  return d < 1 ? "сегодня" : `${d} ${plural(d, ["день", "дня", "дней"])}`;
};
const tierOf = (ms) => {
  const d = ageDays(ms);
  return d >= 30 ? "urgent" : d >= 14 ? "hot" : d >= 7 ? "warm" : "fresh";
};
const TIER = {
  fresh: { bl: "border-l-slate-500/50", badge: "border-white/10 bg-white/5 text-slate-300", text: "text-slate-400" },
  warm: { bl: "border-l-amber-400/70", badge: "border-amber-400/30 bg-amber-400/10 text-amber-300", text: "text-amber-300" },
  hot: { bl: "border-l-orange-400/80", badge: "border-orange-400/30 bg-orange-500/10 text-orange-300", text: "text-orange-300" },
  urgent: { bl: "border-l-red-500/80", badge: "border-red-500/30 bg-red-500/15 text-red-300", text: "text-red-300" },
};

function Stat({ icon: Icon, label, value, sub, tone = "blue" }) {
  const tones = {
    blue: "border-blue-500/25 bg-blue-500/[0.08] text-blue-300",
    emerald: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300",
    violet: "border-violet-500/25 bg-violet-500/[0.08] text-violet-300",
    orange: "border-orange-500/25 bg-orange-500/[0.08] text-orange-300",
    red: "border-red-500/30 bg-red-500/[0.1] text-red-300",
  };
  return (
    <div className={`min-w-0 rounded-2xl border p-3 sm:p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-black uppercase tracking-wide opacity-90">{label}</p>
        <Icon size={16} className="shrink-0 opacity-70" />
      </div>
      <p className="mt-1.5 truncate text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
      {sub && <p className="truncate text-[11px] font-semibold text-slate-500">{sub}</p>}
    </div>
  );
}

function CollectionRing({ rate, colorClass }) {
  const R = 52, C = 2 * Math.PI * R;
  const off = C * (1 - Math.max(0, Math.min(100, rate)) / 100);
  return (
    <div className="relative grid h-28 w-28 shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" className="h-28 w-28 -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="12" className="text-white/10" stroke="currentColor" />
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="12" strokeLinecap="round" className={`${colorClass} transition-[stroke-dashoffset] duration-700`} stroke="currentColor" strokeDasharray={C} strokeDashoffset={off} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-black tabular-nums text-white">{Math.round(rate)}%</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">собрано</span>
      </div>
    </div>
  );
}

export default function DebtsPage() {
  const [debts, setDebts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | debtors | paid
  const [sort, setSort] = useState("remaining"); // remaining | age | name
  const [error, setError] = useState("");
  const [openedCustomer, setOpenedCustomer] = useState(null);
  const [now] = useState(() => Date.now());

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
      byId.set(customer.id, { ...customer, records: [], payments: [], lastDate: customer.createdAt || "" });
    });
    (Array.isArray(debts) ? debts : []).forEach((debt) => {
      const customerId = debt.customerId || 0;
      const existing = byId.get(customerId) || { id: customerId, name: debt.customerName || "Без имени", records: [], payments: [], lastDate: debt.createdAt || "" };
      existing.records.push(debt);
      if (!existing.lastDate || new Date(debt.createdAt) > new Date(existing.lastDate)) existing.lastDate = debt.createdAt;
      byId.set(customerId, existing);
    });
    (Array.isArray(payments) ? payments : []).forEach((payment) => {
      const existing = byId.get(payment.customerId);
      if (!existing) return;
      existing.payments.push(payment);
      if (!existing.lastDate || new Date(payment.createdAt) > new Date(existing.lastDate)) existing.lastDate = payment.createdAt;
    });
    return Array.from(byId.values())
      .map((customer) => {
        const borrowed = customer.records.filter((r) => r.status === "open").reduce((s, r) => s + Number(r.amount || 0), 0);
        const paid = customer.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        const remaining = Math.max(0, borrowed - paid);
        return { ...customer, borrowed, paid, remaining };
      })
      .filter((customer) => customer.borrowed > 0 || customer.paid > 0)
      .sort((a, b) => Number(b.remaining || 0) - Number(a.remaining || 0) || new Date(b.lastDate) - new Date(a.lastDate));
  }, [customers, debts, payments]);

  // Обогащение: % возврата, возраст долга, тир, статус.
  const enriched = useMemo(
    () =>
      customerGroups.map((g) => {
        const pct = g.borrowed > 0 ? Math.min(100, Math.round((g.paid / g.borrowed) * 100)) : (g.paid > 0 ? 100 : 0);
        const openDates = (g.records || []).filter((r) => r.status === "open").map((r) => new Date(r.createdAt).getTime()).filter((t) => t > 0);
        const ageMs = openDates.length ? now - Math.min(...openDates) : 0;
        const isPaid = g.borrowed > 0 && g.remaining === 0;
        return { ...g, pct, ageMs, tier: tierOf(ageMs), isPaid };
      }),
    [customerGroups, now]
  );

  const displayGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = enriched.filter((g) => !q || String(g.name || "").toLowerCase().includes(q));
    if (filter === "debtors") rows = rows.filter((g) => g.remaining > 0);
    else if (filter === "paid") rows = rows.filter((g) => g.isPaid);
    if (sort === "age") return [...rows].sort((a, b) => b.ageMs - a.ageMs);
    if (sort === "name") return [...rows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
    return [...rows].sort((a, b) => b.remaining - a.remaining || new Date(b.lastDate) - new Date(a.lastDate));
  }, [enriched, query, filter, sort]);

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
    if (!amount || amount <= 0) { window.notify?.("Введите сумму больше нуля", "error"); return; }
    await guarded(async () => {
      await post("/debt-payments", { customerId: payModal.id, amount, method: payForm.method, date: payForm.date || undefined, note: payForm.note });
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

  const debtorsCount = enriched.filter((g) => g.remaining > 0).length;
  const paidFullCount = enriched.filter((g) => g.isPaid).length;
  const oldest = enriched.filter((g) => g.remaining > 0).reduce((acc, g) => (acc && acc.ageMs >= g.ageMs ? acc : g), null);
  const topDebtor = enriched.find((g) => g.remaining > 0) || null;
  const collectRate = totalPaid + totalOpen > 0 ? (totalPaid / (totalPaid + totalOpen)) * 100 : 100;
  const ringColor = collectRate >= 80 ? "text-emerald-400" : collectRate >= 50 ? "text-amber-400" : "text-red-400";
  const oldestTier = oldest ? TIER[tierOf(oldest.ageMs)] : TIER.fresh;

  const methodLabel = (m) => (m === "transfer" ? "Перевод" : "Наличные");

  return (
    <div className="relative min-h-screen pb-nav text-white sm:pb-10" style={{ WebkitTapHighlightColor: "transparent" }}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-130px] top-[-130px] h-[380px] w-[380px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-150px] right-[-120px] h-[380px] w-[380px] rounded-full bg-violet-600/20 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1400px]">
        {/* ── Шапка ── */}
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-400">Клиенты</p>
            <h2 className="text-2xl font-black leading-none text-white sm:text-3xl">Долги</h2>
            {debtorsCount > 0 ? (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-400">
                <span><b className="text-white">{debtorsCount}</b> {plural(debtorsCount, ["должник", "должника", "должников"])} на <b className="tabular-nums text-red-300">{formatMoney(totalOpen)}</b></span>
                {oldest && (<><span className="text-slate-600">·</span><span className={`inline-flex items-center gap-1 ${oldestTier.text}`}><Clock size={14} /> старейший висит <b>{fmtAge(oldest.ageMs)}</b></span></>)}
              </p>
            ) : (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Отмечайте оплату долга: сумма, дата и способ. Наличные попадают в кассу. Любое погашение можно отменить.</p>
            )}
          </div>

          <div className="flex shrink-0 gap-2.5">
            <button onClick={load} aria-label="Обновить" className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 font-black text-slate-200 transition hover:bg-white/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
              <span className="hidden sm:inline">Обновить</span>
            </button>
            {paidFullCount > 0 && (
              <button onClick={clearHistory} disabled={submitting} className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 font-black text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
                <span className="hidden sm:inline">Скрыть оплаченных</span>
              </button>
            )}
          </div>
        </div>

        {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-bold text-red-300">{error}</div>}

        {customerGroups.length > 0 && (
          <>
            {/* ── Статы ── */}
            <div className="mb-3 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
              <Stat icon={Wallet} label="Остаток долгов" value={formatMoney(totalOpen)} sub="нужно получить" tone="red" />
              <Stat icon={HandCoins} label="Погашено" value={formatMoney(totalPaid)} sub={`${paidFullCount} ${plural(paidFullCount, ["оплатил", "оплатили", "оплатили"])} полностью`} tone="emerald" />
              <Stat icon={AlarmClock} label="Старейший" value={oldest ? fmtAge(oldest.ageMs) : "—"} sub={oldest ? oldest.name : "нет открытых"} tone="orange" />
              <Stat icon={Users} label="Должников" value={debtorsCount} sub={`всего ${customerGroups.length} в списке`} tone="violet" />
            </div>

            {/* ── Собираемость + крупнейший должник ── */}
            <div className="mb-4 flex flex-col items-center gap-4 rounded-[28px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur sm:flex-row sm:gap-6">
              <CollectionRing rate={collectRate} colorClass={ringColor} />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Собираемость долгов</p>
                <p className="mt-0.5 text-lg font-black text-white">Возвращено {formatMoney(totalPaid)} <span className="text-slate-500">из {formatMoney(totalPaid + totalOpen)}</span></p>
                {topDebtor && (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2 text-sm font-bold text-slate-200">
                    <Crown size={16} className="shrink-0 text-amber-300" /> Больше всех должен: <b className="text-white">{topDebtor.name}</b> — <b className="tabular-nums text-red-300">{formatMoney(topDebtor.remaining)}</b>
                  </p>
                )}
              </div>
            </div>

            {/* ── Поиск + фильтры + сортировка ── */}
            <div className="mb-5 flex flex-col gap-3 rounded-[28px] border border-white/10 bg-[#0f172a]/80 p-4 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти клиента" className="h-12 w-full rounded-2xl border border-white/10 bg-white/5 pl-11 pr-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60" />
              </div>
              <div className="flex items-center gap-2">
                <div className="no-scrollbar flex gap-2 overflow-x-auto">
                  {[["all", "Все"], ["debtors", "Должники"], ["paid", "Оплаченные"]].map(([v, l]) => (
                    <button key={v} onClick={() => setFilter(v)} className={`inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-black transition ${filter === v ? "border-emerald-400/60 bg-emerald-500/15 text-white" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>{l}</button>
                  ))}
                </div>
                <div className="relative shrink-0">
                  <ArrowDownWideNarrow size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-11 rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 text-sm font-bold text-white outline-none">
                    <option value="remaining" className="bg-slate-900">По остатку</option>
                    <option value="age" className="bg-slate-900">По давности</option>
                    <option value="name" className="bg-slate-900">По имени</option>
                  </select>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Список клиентов ── */}
        <div className="space-y-3">
          {displayGroups.map((customer) => {
            const isOpen = openedCustomer === customer.id;
            const t = TIER[customer.tier] || TIER.fresh;
            const isTop = topDebtor && customer.id === topDebtor.id;
            const barColor = customer.pct >= 100 ? "from-emerald-500 to-emerald-400" : "from-amber-500 to-amber-400";
            return (
              <div key={customer.id || customer.name} className={`overflow-hidden rounded-[28px] border border-l-4 border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur ${customer.isPaid ? "border-l-emerald-500/60" : t.bl} ${isTop ? "ring-1 ring-amber-400/40" : ""}`}>
                <div role="button" tabIndex={0} onClick={() => setOpenedCustomer(isOpen ? null : customer.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenedCustomer(isOpen ? null : customer.id); } }} className="w-full cursor-pointer p-4 text-left transition hover:bg-white/[0.03] sm:p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl border text-2xl font-black ${customer.isPaid ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : customer.tier === "urgent" ? "border-red-400/30 bg-red-500/10 text-red-300" : "border-blue-400/20 bg-blue-500/10 text-blue-300"}`}>
                        {String(customer.name || "?").slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-xl font-black text-white sm:text-2xl">{customer.name}</h3>
                          {customer.isPaid ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-black text-emerald-300"><CheckCircle2 size={12} /> Оплачен</span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${t.badge}`}><Clock size={12} /> висит {fmtAge(customer.ageMs)}</span>
                          )}
                          {isTop && <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-black text-amber-300"><Crown size={12} /> Крупнейший</span>}
                        </div>
                        <p className="mt-1 text-sm font-bold text-slate-400">Покупок в долг: {customer.records.length} · погашений: {customer.payments.length}</p>
                        {/* прогресс возврата */}
                        <div className="mt-2 max-w-[360px]">
                          <div className="flex justify-between text-[11px] font-black">
                            <span className="text-slate-400">Возврат долга</span>
                            <span className={customer.pct >= 100 ? "text-emerald-300" : "text-slate-300"}>{customer.pct}%</span>
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
                            <div className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-[width] duration-500`} style={{ width: `${customer.pct}%` }} />
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">{formatMoney(customer.paid)} из {formatMoney(customer.borrowed)}</p>
                        </div>
                      </div>
                      <span className="ml-auto shrink-0 self-start text-slate-400" aria-hidden="true">{isOpen ? <ChevronUp size={22} /> : <ChevronDown size={22} />}</span>
                    </div>

                    <div className="flex flex-col gap-2 xl:w-[420px] xl:shrink-0">
                      <div className="grid grid-cols-3 gap-2 [@media(max-width:380px)]:grid-cols-1">
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                          <p className="text-[11px] font-black uppercase text-slate-400">Взял в долг</p>
                          <p className="text-base font-black text-white sm:text-lg">{formatMoney(customer.borrowed || 0)}</p>
                        </div>
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
                          <p className="text-[11px] font-black uppercase text-slate-400">Оплатил</p>
                          <p className="text-base font-black text-emerald-300 sm:text-lg">{formatMoney(customer.paid || 0)}</p>
                        </div>
                        <div className={`rounded-xl border px-3 py-2.5 ${customer.isPaid ? "border-emerald-500/20 bg-emerald-500/10" : "border-red-500/20 bg-red-500/10"}`}>
                          <p className="text-[11px] font-black uppercase text-slate-400">Остаток</p>
                          <p className={`text-base font-black sm:text-lg ${customer.isPaid ? "text-emerald-300" : "text-red-300"}`}>{formatMoney(customer.remaining || 0)}</p>
                        </div>
                      </div>
                      {customer.remaining > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openPay(customer); }}
                          disabled={submitting}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-2.5 font-black text-white shadow-lg shadow-emerald-950/30 transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Wallet size={18} strokeWidth={2.4} /> Клиент оплатил
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-white/10 p-4 sm:p-5">
                    <div className="mb-3 flex items-center gap-2 font-black text-slate-200">
                      <History size={20} className="text-blue-400" /> Покупки в долг
                    </div>
                    <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#111827]">
                      <div className="hidden grid-cols-[180px_1fr_140px] gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-slate-400 lg:grid">
                        <span>Дата</span><span>Описание</span><span className="text-right">Сумма</span>
                      </div>
                      {customer.records.map((debt) => (
                        <div key={debt.id} className="border-t border-white/10 px-4 py-4 first:border-t-0 lg:grid lg:grid-cols-[180px_1fr_140px] lg:items-center lg:gap-3">
                          <div className="flex items-center justify-between gap-3 lg:block">
                            <div className="text-sm font-black text-slate-300 lg:text-base">{debt.createdAt ? new Date(debt.createdAt).toLocaleDateString("ru-RU") : "—"}</div>
                            <div className="text-lg font-black text-white lg:hidden">{formatMoney(debt.amount)}</div>
                          </div>
                          <div className="mt-2 lg:mt-0">
                            <div className="flex items-start gap-2 font-bold text-slate-100">
                              <ReceiptText size={18} className="mt-1 shrink-0 text-slate-500" />
                              <span>{(debt.items || []).map((item) => `${item.name} × ${item.qty}`).join(", ") || "Покупка в долг"}</span>
                            </div>
                          </div>
                          <div className="hidden text-right font-black text-white lg:block">{formatMoney(debt.amount)}</div>
                        </div>
                      ))}
                    </div>

                    {customer.payments.length > 0 && (
                      <div className="mt-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-black text-emerald-300"><Wallet size={16} strokeWidth={2.4} /> Погашения</div>
                        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#111827]">
                          {customer.payments.map((p) => (
                            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 first:border-t-0">
                              <div className="min-w-0">
                                <p className="font-black text-emerald-300">{formatMoney(p.amount)} <span className="text-xs font-bold text-slate-400">· {methodLabel(p.method)}</span></p>
                                <p className="mt-0.5 text-xs font-bold text-slate-500">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("ru-RU") : "—"}{p.note ? ` · ${p.note}` : ""}</p>
                              </div>
                              <button onClick={() => undoPayment(p.id)} disabled={submitting} className="flex shrink-0 items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-300 transition hover:bg-red-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
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

        {!displayGroups.length && (
          <EmptyState
            className="mt-4"
            icon={query.trim() || filter !== "all" ? <Filter size={26} /> : <CheckCircle2 size={26} />}
            title={query.trim() ? "Никого не нашлось" : filter !== "all" ? "В этом фильтре пусто" : "Все долги закрыты"}
            text={
              query.trim()
                ? `По запросу «${query.trim()}» клиентов нет.`
                : filter !== "all"
                  ? "Под этот фильтр клиентов нет."
                  : "Сейчас вам никто не должен. Покупки в долг и их погашения появятся здесь автоматически."
            }
            actionLabel={query.trim() || filter !== "all" ? "Сбросить" : undefined}
            onAction={query.trim() || filter !== "all" ? () => { setQuery(""); setFilter("all"); } : undefined}
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
              <input value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} type="text" inputMode="decimal" autoFocus placeholder="Например: 5000" className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/70 focus:ring-4 focus:ring-emerald-500/10" />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-300">Дата <span className="font-bold text-slate-500">— необязательно, по умолчанию сегодня</span></span>
              <DatePicker value={payForm.date} onChange={(v) => setPayForm((p) => ({ ...p, date: v }))} placeholder="Сегодня" />
            </label>

            <div>
              <span className="mb-2 block text-sm font-black text-slate-300">Способ</span>
              <div className="grid grid-cols-2 gap-2">
                {[["cash", "Наличные"], ["transfer", "Перевод"]].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setPayForm((p) => ({ ...p, method: val }))} className={`rounded-2xl border px-3 py-3 text-center text-sm font-black transition ${payForm.method === val ? "border-emerald-400/70 bg-emerald-500/15 text-white" : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"}`}>{label}</button>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-bold text-slate-500">Наличные попадут в кассу на выбранную дату. Перевод — на счёт (банк).</p>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-300">Комментарий <span className="font-bold text-slate-500">— необязательно</span></span>
              <input value={payForm.note} onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))} type="text" placeholder="Например: часть долга" className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/70" />
            </label>

            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => setPayModal(null)} className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/15">Отмена</button>
              <button onClick={savePayment} disabled={submitting} className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-4 font-black text-white shadow-lg shadow-emerald-950/30 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Сохраняю…" : "Записать оплату"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
