import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, ArrowDownWideNarrow, CheckCircle2, ChevronDown, ChevronUp, Clock, Crown, Filter, History, ReceiptText, RotateCcw, Search, Users, Wallet } from "lucide-react";
import { del, get, post } from "../api";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import DatePicker from "../components/DatePicker";
import { HeroStat } from "../components/Metrics";
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
  fresh: { bl: "border-l-slate-500/50", badge: "border-white/[0.08] bg-white/5 text-slate-300", text: "text-slate-400" },
  warm: { bl: "border-l-amber-400/70", badge: "border-amber-400/30 bg-amber-400/10 text-amber-300", text: "text-amber-300" },
  hot: { bl: "border-l-orange-400/80", badge: "border-orange-400/30 bg-orange-500/10 text-orange-300", text: "text-orange-300" },
  urgent: { bl: "border-l-red-500/80", badge: "border-red-500/30 bg-red-500/15 text-red-300", text: "text-red-300" },
};

// Мини-тайл сводки (мобильная сетка 2×2).
function MiniTile({ label, value, sub, valueClass = "text-white" }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/[0.02] px-3 py-2">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`truncate text-base font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="truncate text-[10px] font-semibold text-slate-500">{sub}</p>}
    </div>
  );
}

// Возраст долга: какая часть остатка «свежая», а какая зависла надолго.
const AGING_TIERS = [
  { key: "fresh", label: "до 7 дней", bar: "bg-slate-400", dot: "bg-slate-400" },
  { key: "warm", label: "7–14 дней", bar: "bg-amber-400", dot: "bg-amber-400" },
  { key: "hot", label: "14–30 дней", bar: "bg-orange-400", dot: "bg-orange-400" },
  { key: "urgent", label: "30+ дней", bar: "bg-red-500", dot: "bg-red-500" },
];

function AgingBar({ aging, total }) {
  const active = total > 0 ? AGING_TIERS.filter((t) => aging[t.key] > 0) : [];
  return (
    <div className="w-full">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Возраст долга</p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        {active.length
          ? active.map((t) => <div key={t.key} className={t.bar} style={{ width: `${(aging[t.key] / total) * 100}%` }} />)
          : <div className="h-full w-full rounded-full bg-emerald-400/60" />}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {active.length
          ? active.map((t) => (
              <span key={t.key} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold">
                <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                <span className="text-slate-400">{t.label}</span>
                <span className="tabular-nums text-white">{formatMoney(aging[t.key])}</span>
              </span>
            ))
          : <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Всё собрано</span>}
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
  const rateText = collectRate >= 80 ? "text-emerald-300" : collectRate >= 50 ? "text-amber-300" : "text-red-300";
  const oldestTier = oldest ? TIER[tierOf(oldest.ageMs)] : TIER.fresh;

  // Остаток долга по возрасту (для шкалы «возраст долга» в герое).
  const aging = useMemo(() => {
    const b = { fresh: 0, warm: 0, hot: 0, urgent: 0 };
    enriched.forEach((g) => { if (g.remaining > 0) b[tierOf(g.ageMs)] += g.remaining; });
    return b;
  }, [enriched]);

  const methodLabel = (m) => (m === "transfer" ? "Перевод" : "Наличные");

  return (
    <div className="relative min-h-screen pb-nav text-white sm:pb-10" style={{ WebkitTapHighlightColor: "transparent" }}>
      <div className="relative z-10 mx-auto w-full max-w-[1400px]">
        {/* ── Шапка ── */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-blue-400">Клиенты</p>
            <h2 className="text-2xl font-semibold leading-none text-white sm:text-3xl">Долги</h2>
            {debtorsCount > 0 ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-slate-400">
                <span><b className="text-white">{debtorsCount}</b> {plural(debtorsCount, ["должник", "должника", "должников"])} на <b className="tabular-nums text-red-300">{formatMoney(totalOpen)}</b></span>
                {oldest && (<><span className="text-slate-600">·</span><span className={`inline-flex items-center gap-1 ${oldestTier.text}`}><Clock size={13} /> старейший {fmtAge(oldest.ageMs)}</span></>)}
              </p>
            ) : (
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">Отмечайте оплату долга: сумма, дата и способ. Наличные попадают в кассу. Любое погашение можно отменить.</p>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            <button onClick={load} aria-label="Обновить" className="flex h-9 min-w-9 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/5 px-0 text-sm font-semibold text-slate-200 transition hover:bg-white/10 sm:px-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
              <span className="hidden sm:inline">Обновить</span>
            </button>
            {paidFullCount > 0 && (
              <button onClick={clearHistory} disabled={submitting} aria-label="Скрыть оплаченных" className="flex h-9 min-w-9 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/5 px-0 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/></svg>
                <span className="hidden sm:inline">Скрыть оплаченных</span>
              </button>
            )}
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-bold text-red-300">{error}</div>}

        {customerGroups.length > 0 && (
          <>
            {/* ── Герой-сводка: «вам должны» + возраст долга + факты ── */}
            <div className="mb-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                {/* Главное число + собираемость */}
                <div className="min-w-0 shrink-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Вам должны · остаток</p>
                  <p className="mt-1 whitespace-nowrap text-4xl font-semibold leading-none tabular-nums text-rose-400 xl:text-5xl">{formatMoney(totalOpen)}</p>
                  <p className={`mt-2.5 inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold ${rateText}`}>
                    <CheckCircle2 size={15} />
                    <span className="tabular-nums">{Math.round(collectRate)}%</span>
                    <span className="font-medium text-slate-500">собрано · {formatMoney(totalPaid)} из {formatMoney(totalPaid + totalOpen)}</span>
                  </p>
                </div>

                {/* Возраст долга — инлайн на широком экране */}
                <div className="hidden min-w-0 flex-1 xl:block">
                  <AgingBar aging={aging} total={totalOpen} />
                </div>

                {/* Факты: иконки + значения с разделителями */}
                <div className="hidden min-w-0 lg:flex lg:divide-x lg:divide-white/10 lg:border-l lg:border-white/10 lg:pl-4 xl:pl-5">
                  <HeroStat icon={Users} label="Должников" value={debtorsCount} sub={`из ${customerGroups.length}`} />
                  <HeroStat icon={Wallet} label="Погашено" tone="text-emerald-300" value={formatMoney(totalPaid)} />
                  <HeroStat icon={AlarmClock} label="Старейший" tone={oldestTier.text} value={oldest ? fmtAge(oldest.ageMs) : "—"} sub={oldest ? oldest.name : null} />
                  <HeroStat icon={Crown} label="Крупнейший" tone="text-amber-300" value={topDebtor ? topDebtor.name : "—"} sub={topDebtor ? formatMoney(topDebtor.remaining) : null} />
                </div>
              </div>

              {/* Возраст долга во всю ширину — планшет/ноут */}
              <div className="mt-4 hidden lg:block xl:hidden">
                <AgingBar aging={aging} total={totalOpen} />
              </div>

              {/* Мобайл: возраст долга + 2×2 факты */}
              <div className="mt-4 lg:hidden">
                <div className="mb-3"><AgingBar aging={aging} total={totalOpen} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <MiniTile label="Погашено" value={formatMoney(totalPaid)} valueClass="text-emerald-300" />
                  <MiniTile label="Должников" value={debtorsCount} sub={`всего ${customerGroups.length}`} />
                  <MiniTile label="Старейший" value={oldest ? fmtAge(oldest.ageMs) : "—"} sub={oldest ? oldest.name : "нет открытых"} valueClass={oldestTier.text} />
                  <MiniTile label="Крупнейший" value={topDebtor ? formatMoney(topDebtor.remaining) : "—"} sub={topDebtor ? topDebtor.name : "никто"} valueClass="text-amber-300" />
                </div>
              </div>
            </div>

            {/* ── Поиск + фильтры + сортировка ── */}
            <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти клиента" className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/5 pl-10 pr-3 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60" />
              </div>
              <div className="flex items-center gap-2">
                <div className="no-scrollbar flex gap-2 overflow-x-auto">
                  {[["all", "Все"], ["debtors", "Должники"], ["paid", "Оплаченные"]].map(([v, l]) => (
                    <button key={v} onClick={() => setFilter(v)} className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-semibold transition ${filter === v ? "border-emerald-400/60 bg-emerald-500/15 text-white" : "border-white/[0.08] bg-white/5 text-slate-300 hover:bg-white/10"}`}>{l}</button>
                  ))}
                </div>
                <div className="relative shrink-0">
                  <ArrowDownWideNarrow size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-8 rounded-lg border border-white/[0.08] bg-white/5 pl-8 pr-2.5 text-xs font-bold text-white outline-none">
                    <option value="remaining" className="bg-slate-900">По остатку</option>
                    <option value="age" className="bg-slate-900">По давности</option>
                    <option value="name" className="bg-slate-900">По имени</option>
                  </select>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Реестр должников ── */}
        <div className="space-y-1.5">
          {displayGroups.map((customer) => {
            const isOpen = openedCustomer === customer.id;
            const t = TIER[customer.tier] || TIER.fresh;
            const isTop = topDebtor && customer.id === topDebtor.id;
            return (
              <div key={customer.id || customer.name} className={`overflow-hidden rounded-xl border border-l-2 border-white/[0.08] bg-white/[0.02] ${customer.isPaid ? "border-l-emerald-500/60" : t.bl} ${isTop ? "ring-1 ring-amber-400/30" : ""}`}>
                <div role="button" tabIndex={0} onClick={() => setOpenedCustomer(isOpen ? null : customer.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenedCustomer(isOpen ? null : customer.id); } }} className="flex min-h-[60px] cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/[0.02] sm:px-4">
                  {/* Аватар */}
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-sm font-semibold ${customer.isPaid ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : customer.tier === "urgent" ? "border-red-400/30 bg-red-500/10 text-red-300" : "border-blue-400/20 bg-blue-500/10 text-blue-300"}`}>
                    {String(customer.name || "?").slice(0, 1).toUpperCase()}
                  </div>

                  {/* Центр: имя (своя строка) + бейдж давности + мини-прогресс */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white sm:text-base">{customer.name}</span>
                      {isTop && <Crown size={13} className="shrink-0 text-amber-300" aria-label="Крупнейший должник" />}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {customer.isPaid ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"><CheckCircle2 size={11} /> Оплачен</span>
                      ) : (
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${t.badge}`}><Clock size={11} /> {fmtAge(customer.ageMs)}</span>
                      )}
                      <div className="h-1 w-full min-w-0 max-w-[160px] overflow-hidden rounded-full bg-white/10">
                        <div className={`h-full rounded-full transition-[width] duration-500 ${customer.pct >= 100 ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${customer.pct}%` }} />
                      </div>
                      <span className="hidden shrink-0 text-[10px] font-semibold text-slate-500 lg:inline">{customer.records.length} {plural(customer.records.length, ["покупка", "покупки", "покупок"])} · {customer.payments.length} {plural(customer.payments.length, ["погашение", "погашения", "погашений"])}</span>
                    </div>
                  </div>

                  {/* Остаток */}
                  <div className="shrink-0 text-right">
                    <p className={`text-lg font-semibold leading-none tabular-nums sm:text-xl ${customer.isPaid ? "text-emerald-300" : "text-red-300"}`}>{formatMoney(customer.remaining || 0)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">из {formatMoney(customer.borrowed || 0)}</p>
                  </div>

                  {/* Действие */}
                  {customer.remaining > 0 && (
                    <button
                      type="button"
                      aria-label="Клиент оплатил"
                      onClick={(e) => { e.stopPropagation(); openPay(customer); }}
                      disabled={submitting}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-0 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-3"
                    >
                      <Wallet size={15} strokeWidth={2.4} /> <span className="hidden sm:inline">Оплатил</span>
                    </button>
                  )}

                  <span className="shrink-0 text-slate-400" aria-hidden="true">{isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                </div>

                {isOpen && (
                  <div className="space-y-3 border-t border-white/[0.08] px-3 py-3 sm:px-4">
                    {/* мини-сводка */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold">
                      <span className="text-slate-400">Взял в долг <b className="tabular-nums text-white">{formatMoney(customer.borrowed)}</b></span>
                      <span className="text-slate-400">Оплатил <b className="tabular-nums text-emerald-300">{formatMoney(customer.paid)}</b></span>
                      <span className="text-slate-500">{customer.records.length} {plural(customer.records.length, ["покупка", "покупки", "покупок"])} · {customer.payments.length} {plural(customer.payments.length, ["погашение", "погашения", "погашений"])}</span>
                    </div>

                    {/* покупки в долг */}
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300"><History size={14} className="text-blue-400" /> Покупки в долг</div>
                      <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02]">
                        {customer.records.map((debt) => (
                          <div key={debt.id} className="flex items-start justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <div className="flex items-start gap-1.5 text-sm font-bold text-slate-100">
                                <ReceiptText size={15} className="mt-0.5 shrink-0 text-slate-500" />
                                <span className="min-w-0">{(debt.items || []).map((item) => `${item.name} × ${item.qty}`).join(", ") || "Покупка в долг"}</span>
                              </div>
                              <p className="mt-0.5 pl-[22px] text-[11px] font-semibold text-slate-500">{debt.createdAt ? new Date(debt.createdAt).toLocaleDateString("ru-RU") : "—"}</p>
                            </div>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-white">{formatMoney(debt.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* погашения */}
                    {customer.payments.length > 0 && (
                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-300"><Wallet size={14} strokeWidth={2.4} /> Погашения</div>
                        <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02]">
                          {customer.payments.map((p) => (
                            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold tabular-nums text-emerald-300">{formatMoney(p.amount)} <span className="text-[11px] font-bold text-slate-400">· {methodLabel(p.method)}</span></p>
                                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{p.createdAt ? new Date(p.createdAt).toLocaleDateString("ru-RU") : "—"}{p.note ? ` · ${p.note}` : ""}</p>
                              </div>
                              <button onClick={() => undoPayment(p.id)} disabled={submitting} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 text-[11px] font-semibold text-red-300 transition hover:bg-red-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
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
            className="mt-3"
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
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <span className="text-sm text-slate-400">Остаток долга</span>
              <b className="ml-2 text-lg font-semibold text-red-300">{formatMoney(payModal.remaining || 0)}</b>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Сколько оплатил</span>
              <input value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} type="text" inputMode="decimal" autoFocus placeholder="Например: 5000" className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/70 focus:ring-4 focus:ring-emerald-500/10" />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Дата <span className="font-bold text-slate-500">— необязательно, по умолчанию сегодня</span></span>
              <DatePicker value={payForm.date} onChange={(v) => setPayForm((p) => ({ ...p, date: v }))} placeholder="Сегодня" />
            </label>

            <div>
              <span className="mb-2 block text-sm font-semibold text-slate-300">Способ</span>
              <div className="grid grid-cols-2 gap-2">
                {[["cash", "Наличные"], ["transfer", "Перевод"]].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setPayForm((p) => ({ ...p, method: val }))} className={`rounded-2xl border px-3 py-3 text-center text-sm font-semibold transition ${payForm.method === val ? "border-emerald-400/70 bg-emerald-500/15 text-white" : "border-white/[0.08] bg-slate-950/60 text-slate-300 hover:bg-white/5"}`}>{label}</button>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-bold text-slate-500">Наличные попадут в кассу на выбранную дату. Перевод — на счёт (банк).</p>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Комментарий <span className="font-bold text-slate-500">— необязательно</span></span>
              <input value={payForm.note} onChange={(e) => setPayForm((p) => ({ ...p, note: e.target.value }))} type="text" placeholder="Например: часть долга" className="w-full rounded-2xl border border-white/[0.08] bg-slate-950/60 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/70" />
            </label>

            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => setPayModal(null)} className="flex-1 rounded-2xl border border-white/[0.08] bg-white/10 px-5 py-4 font-semibold text-white transition hover:bg-white/15">Отмена</button>
              <button onClick={savePayment} disabled={submitting} className="flex-1 rounded-2xl bg-emerald-600 px-5 py-4 font-semibold text-white shadow-lg shadow-emerald-950/30 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Сохраняю…" : "Записать оплату"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
