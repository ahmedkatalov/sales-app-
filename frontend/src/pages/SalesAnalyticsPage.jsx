import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight, Banknote, Calculator, CalendarDays, Coins, Crown, Package,
  Percent, PiggyBank, Receipt, Scissors, TrendingUp, Trophy, Wallet,
} from "lucide-react";
import { get } from "../api";
import { formatMoney, localISO, businessISO } from "../utils/format";

/* ── чистые хелперы (вне компонента: без побочных эффектов, стабильные ссылки) ── */

const money = (value) => formatMoney(Number(value || 0));
const clampPct = (n) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

function saleDateParts(createdAt) {
  if (!createdAt) return { date: "", time: "" };
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return { date: String(createdAt).slice(0, 10), time: "" };
  return {
    date: d.toLocaleDateString("ru-RU"),
    time: d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  };
}

const RU_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function dayLabel(iso) {
  const [, m, d] = (iso || "").split("-");
  if (!d) return iso || "";
  return { d: String(Number(d)), m: RU_MONTHS_SHORT[Number(m) - 1] || "" };
}
function dayLabelFull(iso) {
  const [y, m, d] = (iso || "").split("-");
  if (!d) return iso || "";
  return `${Number(d)} ${RU_MONTHS_SHORT[Number(m) - 1] || ""} ${y}`;
}

// Все календарные даты диапазона from..to включительно (чисто: без Date.now).
function eachDay(fromStr, toStr) {
  const out = [];
  if (!fromStr || !toStr) return out;
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  if (!fy || !ty) return out;
  let cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push(localISO(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    guard += 1;
  }
  return out;
}

/* ── презентационные компоненты ── */

// Кольцо маржи на чистом CSS (conic-gradient), без библиотек.
function MarginRing({ pct, size = 112, label = "маржа" }) {
  const p = clampPct(pct);
  const deg = (p / 100) * 360;
  const thickness = size >= 100 ? 11 : 9;
  return (
    <div
      className="relative shrink-0 rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(#34d399 ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)` }}
    >
      <div
        className="absolute grid place-items-center rounded-full bg-slate-950"
        style={{ inset: thickness }}
      >
        <span className="text-xl font-black tabular-nums text-emerald-300 sm:text-2xl">{Math.round(p)}%</span>
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function KpiTile({ icon: Icon, label, value, sub, tone = "slate", className = "" }) {
  const tones = {
    emerald: "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-300",
    blue: "border-blue-400/25 bg-blue-500/[0.08] text-blue-300",
    violet: "border-violet-400/25 bg-violet-500/[0.08] text-violet-300",
    amber: "border-amber-400/25 bg-amber-500/[0.08] text-amber-300",
    red: "border-red-400/25 bg-red-500/[0.08] text-red-300",
    slate: "border-white/10 bg-white/[0.05] text-slate-300",
  };
  return (
    <div className={`min-w-0 rounded-2xl border p-3.5 sm:p-4 ${tones[tone] || tones.slate} ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] font-black uppercase tracking-wide opacity-90">{label}</p>
        <Icon size={16} className="shrink-0 opacity-70" />
      </div>
      <p className="mt-2 truncate text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
      {sub && <p className="truncate text-[11px] font-semibold text-slate-500">{sub}</p>}
    </div>
  );
}

export default function SalesAnalyticsPage() {
  // Пресеты периода — лениво один раз (чистота рендера: new Date() не в теле).
  const [todayStr] = useState(() => businessISO());
  const [monthStartStr] = useState(() => { const d = new Date(); return localISO(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [monthEndStr] = useState(() => { const d = new Date(); return localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); });
  const formatDateRu = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${d}.${m}.${y}`; };

  const [from, setFrom] = useState(monthStartStr);
  const [to, setTo] = useState(monthEndStr);
  const [filterOpen, setFilterOpen] = useState(false);
  const [stats, setStats] = useState({ topProducts: [] });
  const [sales, setSales] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Защита от гонки: при быстром переключении периода устаревший ответ не затирает свежий.
  const reqRef = useRef(0);
  const load = async () => {
    const seq = ++reqRef.current;
    setError("");
    setLoading(true);
    const query = `from=${from}&to=${to}`;
    try {
      const [s, list] = await Promise.all([
        get(`/sales/stats?${query}`),
        get(`/sales?${query}`),
      ]);
      if (seq !== reqRef.current) return;
      setStats(s || { topProducts: [] });
      setSales(list || []);
    } catch (e) {
      if (seq !== reqRef.current) return;
      setError(e.message || "Не удалось загрузить продажи");
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [from, to]);

  const salesArr = useMemo(() => (Array.isArray(sales) ? sales : []), [sales]);
  const normalizedSales = useMemo(
    () => salesArr.map((sale) => ({ ...sale, ...saleDateParts(sale.createdAt) })),
    [salesArr],
  );

  /* ── производные показатели (на фронте, из stats + sales) ── */
  const m = useMemo(() => {
    const revenue = Number(stats.totalRevenue || 0);
    const cost = Number(stats.totalCost || 0);
    const profit = stats.cleanProfit != null ? Number(stats.cleanProfit) : revenue - cost;
    const count = Number(stats.salesCount || 0);
    const cash = Number(stats.cashTotal || 0);
    const transfer = Number(stats.transferTotal || 0);
    const discount = Number(stats.totalDiscount || 0);
    const hasCost = cost > 0;
    const avg = count > 0 ? revenue / count : 0;
    const marginPct = revenue > 0 && hasCost ? (profit / revenue) * 100 : 0;
    const costPct = revenue > 0 && hasCost ? (cost / revenue) * 100 : 0;
    const paid = cash + transfer;
    const cashPct = paid > 0 ? (cash / paid) * 100 : 0;
    const transferPct = paid > 0 ? (transfer / paid) * 100 : 0;
    // Доля скидок: сколько «ушло» относительно потенциальной выручки до скидок.
    const discountPct = (revenue + discount) > 0 ? (discount / (revenue + discount)) * 100 : 0;
    return { revenue, cost, profit, count, cash, transfer, discount, hasCost, avg, marginPct, costPct, cashPct, transferPct, discountPct, paid };
  }, [stats]);

  // Доля прибыли в выручке (для оценки дневной прибыли на графике).
  const marginRatio = m.revenue > 0 && m.hasCost ? m.profit / m.revenue : null;

  // Дневной ряд: агрегируем ВСЕ чеки по рабочей дате. Закрывает обещание «по датам».
  const daily = useMemo(() => {
    const map = new Map();
    for (const s of salesArr) {
      const key = businessISO(new Date(s.createdAt));
      const e = map.get(key) || { date: key, revenue: 0, count: 0 };
      e.revenue += Number(s.total || 0);
      e.count += 1;
      map.set(key, e);
    }
    let keys;
    const bounded = Boolean(from && to);
    const span = bounded ? eachDay(from, to) : [];
    if (bounded && span.length && span.length <= 45) {
      keys = span; // заполняем пустые дни нулями — видна непрерывность
    } else {
      keys = [...map.keys()].sort();
    }
    let rows = keys.map((k) => map.get(k) || { date: k, revenue: 0, count: 0 });
    let truncated = false;
    if (rows.length > 45) { rows = rows.slice(rows.length - 45); truncated = true; }
    const maxRevenue = rows.reduce((mx, r) => Math.max(mx, r.revenue), 0);
    const best = rows.reduce((b, r) => (r.revenue > (b?.revenue || 0) ? r : b), null);
    const activeDays = rows.filter((r) => r.revenue > 0).length;
    const avgPerActiveDay = activeDays > 0 ? rows.reduce((s, r) => s + r.revenue, 0) / activeDays : 0;
    return { rows, maxRevenue, best, truncated, activeDays, avgPerActiveDay };
  }, [salesArr, from, to]);

  // Топ-товары с долей в выручке (бары).
  const topProducts = useMemo(() => {
    const list = Array.isArray(stats.topProducts) ? stats.topProducts : [];
    const maxRev = list.reduce((mx, p) => Math.max(mx, Number(p.revenue || 0)), 0);
    return list.map((p) => ({
      ...p,
      revenueNum: Number(p.revenue || 0),
      sharePct: m.revenue > 0 ? (Number(p.revenue || 0) / m.revenue) * 100 : 0,
      barPct: maxRev > 0 ? (Number(p.revenue || 0) / maxRev) * 100 : 0,
    }));
  }, [stats.topProducts, m.revenue]);

  const extraItems = Array.isArray(stats.extraItems) ? stats.extraItems : [];
  const hasSales = m.count > 0;
  const periodLabel =
    (!from && !to) ? "за всё время"
      : (from === monthStartStr && to === monthEndStr) ? "за этот месяц"
        : (from === todayStr && to === todayStr) ? "за сегодня"
          : `${formatDateRu(from)} — ${formatDateRu(to)}`;

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="relative mx-auto w-full max-w-[1500px]">
        {/* ── Шапка ── */}
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="text-xs font-bold text-emerald-400">Отчёт о прибыли</p>
            <h2 className="text-2xl font-black leading-none text-white sm:text-3xl">Продажи</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">
              Сколько заработали, как шли продажи по дням, чем платили и что покупают.
            </p>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-label="Обновить"
            title="Обновить"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
            <span className="hidden sm:inline">{loading ? "Обновление" : "Обновить"}</span>
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-400/25 bg-red-500/10 px-5 py-4 text-sm font-black text-red-200">
            {error}
          </div>
        )}

        {/* ── Период ── */}
        <div className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:gap-3 sm:px-5">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {[
                ["month", "Этот месяц", () => { setFrom(monthStartStr); setTo(monthEndStr); }],
                ["today", "Сегодня", () => { setFrom(todayStr); setTo(todayStr); }],
                ["all", "Всё время", () => { setFrom(""); setTo(""); }],
              ].map(([key, label, action]) => {
                const active =
                  (key === "month" && from === monthStartStr && to === monthEndStr) ||
                  (key === "today" && from === todayStr && to === todayStr) ||
                  (key === "all" && !from && !to);
                return (
                  <button key={key} type="button" onClick={action}
                    className={active
                      ? "min-h-[44px] rounded-xl border border-emerald-400/50 bg-emerald-500/15 px-4 py-2.5 text-sm font-black text-white"
                      : "min-h-[44px] rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-slate-300 transition hover:bg-white/10"}>
                    {label}
                  </button>
                );
              })}
              {from && to && !(from === monthStartStr && to === monthEndStr) && !(from === todayStr && to === todayStr) && (
                <span className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm font-black text-emerald-200">
                  {formatDateRu(from)} — {formatDateRu(to)}
                </span>
              )}
            </div>
            <button type="button" onClick={() => setFilterOpen((v) => !v)}
              className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition ${
                filterOpen ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              Период
            </button>
          </div>

          {filterOpen && (
            <div className="border-t border-white/10 px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">От даты</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 font-bold text-white outline-none transition [color-scheme:dark] focus:border-emerald-400/70 focus:ring-4 focus:ring-emerald-500/10" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">До даты</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 font-bold text-white outline-none transition [color-scheme:dark] focus:border-emerald-400/70 focus:ring-4 focus:ring-emerald-500/10" />
                </label>
              </div>
            </div>
          )}
        </div>

        {!hasSales ? (
          /* ── Спокойное пустое состояние ── */
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-16 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/5 text-slate-500">
              <Receipt size={30} strokeWidth={2} />
            </div>
            <p className="mt-5 text-lg font-black text-white">Продаж {periodLabel} не было</p>
            <p className="mx-auto mt-2 max-w-sm text-sm font-medium leading-6 text-slate-400">
              Выберите другой период выше или нажмите «Обновить» — здесь появится прибыль, график по дням и популярные товары.
            </p>
          </div>
        ) : (
          <>
            {/* ── P&L-герой: Выручка → Себестоимость → Чистая прибыль ── */}
            <div className="mb-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
              <div className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-white/[0.04] p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-200/70">Чистая прибыль {periodLabel}</p>
                    <p className="mt-1.5 text-3xl font-black leading-none tabular-nums text-white sm:text-4xl xl:text-5xl">{money(m.profit)}</p>
                    <p className="mt-3 text-sm font-semibold text-slate-400">
                      из выручки <span className="font-black text-white">{money(m.revenue)}</span>
                      {m.hasCost
                        ? <> · себестоимость <span className="font-black text-slate-300">{money(m.cost)}</span></>
                        : <> · <span className="font-black text-amber-300">себестоимость не указана</span></>}
                    </p>
                  </div>
                  {m.hasCost
                    ? <MarginRing pct={m.marginPct} size={112} />
                    : <div className="hidden shrink-0 sm:block"><PiggyBank size={56} className="text-emerald-400/40" strokeWidth={1.6} /></div>}
                </div>

                {/* Сплит-бар: доля себестоимости и прибыли внутри выручки */}
                {m.hasCost && (
                  <div className="mt-5">
                    <div className="flex h-4 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="bg-gradient-to-r from-emerald-400 to-teal-400" style={{ width: `${clampPct(m.marginPct)}%` }} title={`Чистая прибыль · ${Math.round(m.marginPct)}%`} />
                      <div className="bg-slate-500/50" style={{ width: `${clampPct(m.costPct)}%` }} title={`Себестоимость · ${Math.round(m.costPct)}%`} />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-semibold">
                      <span className="flex items-center gap-1.5 text-emerald-300"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Прибыль · {Math.round(m.marginPct)}%</span>
                      <span className="flex items-center gap-1.5 text-slate-400"><span className="h-2.5 w-2.5 rounded-full bg-slate-500/70" /> Себестоимость · {Math.round(m.costPct)}%</span>
                    </div>
                  </div>
                )}

                {/* Мини-отчёт (income statement) */}
                <div className="mt-5 space-y-2.5 border-t border-white/10 pt-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-semibold text-slate-300"><TrendingUp size={15} className="text-emerald-300" /> Выручка</span>
                    <span className="tabular-nums font-black text-white">{money(m.revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-semibold text-slate-300"><Package size={15} className="text-slate-400" /> Себестоимость проданного</span>
                    <span className="tabular-nums font-black text-slate-300">{m.hasCost ? `− ${money(m.cost)}` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2.5">
                    <span className="flex items-center gap-2 font-black text-emerald-200"><PiggyBank size={15} className="text-emerald-300" /> Чистая прибыль</span>
                    <span className={`tabular-nums text-base font-black ${m.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>{money(m.profit)}</span>
                  </div>
                </div>
              </div>

              {/* KPI-плитки: 2×2 на мобильном */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                <KpiTile icon={Receipt} label="Чеки" value={m.count} sub="продаж за период" tone="violet" />
                <KpiTile icon={Calculator} label="Средний чек" value={money(m.avg)} sub="на одну продажу" tone="blue" />
                <KpiTile icon={Coins} label="Себестоимость" value={m.hasCost ? money(m.cost) : "—"} sub={m.hasCost ? `${Math.round(m.costPct)}% от выручки` : "не указана"} tone="slate" />
                <KpiTile icon={Scissors} label="Скидки" value={money(m.discount)} sub={m.discount > 0 ? `${Math.round(m.discountPct)}% от суммы до скидок` : "скидок не было"} tone={m.discount > 0 ? "red" : "slate"} />
              </div>
            </div>

            {/* ── График по дням ── */}
            <section className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-black text-white sm:text-xl">
                    <CalendarDays size={20} className="text-emerald-300" /> Продажи по дням
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-400">
                    Высота столбца — выручка дня{marginRatio != null ? ", зелёным — оценка прибыли" : ""}.
                  </p>
                </div>
                {daily.best && daily.best.revenue > 0 && (
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.08] px-3.5 py-2 text-right">
                    <p className="flex items-center justify-end gap-1.5 text-[10px] font-black uppercase tracking-wide text-amber-300"><Crown size={12} /> Лучший день</p>
                    <p className="mt-0.5 text-sm font-black tabular-nums text-white">{money(daily.best.revenue)}</p>
                    <p className="text-[11px] font-bold text-slate-400">{dayLabelFull(daily.best.date)}</p>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto no-scrollbar">
                <div className="flex h-44 min-w-full items-stretch gap-1.5 sm:h-56 sm:gap-2" style={{ minWidth: daily.rows.length > 16 ? `${daily.rows.length * 26}px` : undefined }}>
                  {daily.rows.map((r) => {
                    const barPct = daily.maxRevenue > 0 ? (r.revenue / daily.maxRevenue) * 100 : 0;
                    const isBest = daily.best && r.date === daily.best.date && r.revenue > 0;
                    const profitPart = marginRatio != null ? clampPct(barPct * marginRatio) : 0;
                    const costPart = marginRatio != null ? Math.max(0, barPct - profitPart) : 0;
                    const lbl = dayLabel(r.date);
                    return (
                      <div key={r.date} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${dayLabelFull(r.date)}\n${money(r.revenue)} · ${r.count} ${r.count === 1 ? "чек" : "чек(ов)"}`}>
                        <div className="relative flex w-full flex-1 flex-col justify-end">
                          {r.revenue > 0 ? (
                            marginRatio != null ? (
                              <div className="flex w-full flex-col justify-end overflow-hidden rounded-md" style={{ height: `${Math.max(3, barPct)}%` }}>
                                <div className="w-full bg-slate-500/35" style={{ height: `${(costPart / Math.max(barPct, 0.01)) * 100}%` }} />
                                <div className={`w-full ${isBest ? "bg-gradient-to-t from-amber-400 to-amber-300" : "bg-gradient-to-t from-emerald-500 to-emerald-400"}`} style={{ height: `${(profitPart / Math.max(barPct, 0.01)) * 100}%` }} />
                              </div>
                            ) : (
                              <div className={`w-full rounded-md ${isBest ? "bg-gradient-to-t from-amber-400 to-amber-300" : "bg-gradient-to-t from-emerald-500 to-emerald-400"}`} style={{ height: `${Math.max(3, barPct)}%` }} />
                            )
                          ) : (
                            <div className="w-full rounded-md bg-white/5" style={{ height: "3%" }} />
                          )}
                        </div>
                        {daily.rows.length <= 31 && (
                          <span className={`text-[9px] font-bold leading-none ${isBest ? "text-amber-300" : "text-slate-500"}`}>{lbl.d}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-3 text-xs font-semibold">
                {marginRatio != null && (
                  <>
                    <span className="flex items-center gap-1.5 text-emerald-300"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Прибыль (оценка)</span>
                    <span className="flex items-center gap-1.5 text-slate-400"><span className="h-2.5 w-2.5 rounded-sm bg-slate-500/50" /> Себестоимость</span>
                  </>
                )}
                <span className="text-slate-500">Активных дней: <span className="font-black text-slate-300">{daily.activeDays}</span></span>
                <span className="text-slate-500">В среднем в день: <span className="font-black text-slate-300">{money(daily.avgPerActiveDay)}</span></span>
                {daily.truncated && <span className="text-slate-500">показаны последние 45 дней</span>}
              </div>
            </section>

            {/* ── Чем платят + популярные товары ── */}
            <div className="mb-5 grid gap-5 lg:grid-cols-2">
              {/* Способы оплаты */}
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-black text-white sm:text-xl"><Wallet size={20} className="text-blue-300" /> Чем платят</h3>
                    <p className="mt-1 text-sm font-medium text-slate-400">Наличные и переводы по сумме.</p>
                  </div>
                </div>

                {m.paid > 0 ? (
                  <>
                    <div className="flex h-4 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="bg-gradient-to-r from-emerald-400 to-teal-400" style={{ width: `${clampPct(m.cashPct)}%` }} title={`Наличные · ${Math.round(m.cashPct)}%`} />
                      <div className="bg-gradient-to-r from-blue-400 to-indigo-400" style={{ width: `${clampPct(m.transferPct)}%` }} title={`Переводы · ${Math.round(m.transferPct)}%`} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3.5">
                        <p className="flex items-center gap-1.5 text-xs font-black text-emerald-300"><Banknote size={15} /> Наличные</p>
                        <p className="mt-1.5 tabular-nums text-lg font-black text-white sm:text-xl">{money(m.cash)}</p>
                        <p className="text-[11px] font-bold text-slate-500">{Math.round(m.cashPct)}% оплат</p>
                      </div>
                      <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.06] p-3.5">
                        <p className="flex items-center gap-1.5 text-xs font-black text-blue-300"><ArrowLeftRight size={15} /> Переводы</p>
                        <p className="mt-1.5 tabular-nums text-lg font-black text-white sm:text-xl">{money(m.transfer)}</p>
                        <p className="text-[11px] font-bold text-slate-500">{Math.round(m.transferPct)}% оплат</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="rounded-2xl bg-white/5 px-4 py-6 text-center text-sm font-bold text-slate-500">Нет данных об оплатах</p>
                )}

                {/* Скидки как доля */}
                <div className="mt-5 border-t border-white/10 pt-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 font-semibold text-slate-300"><Percent size={15} className="text-red-300" /> Скидки покупателям</span>
                    <span className="tabular-nums font-black text-white">{money(m.discount)} <span className="font-bold text-slate-500">· {Math.round(m.discountPct)}%</span></span>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-red-400 to-rose-400" style={{ width: `${clampPct(m.discountPct)}%` }} />
                  </div>
                </div>
              </section>

              {/* Популярные товары */}
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-lg font-black text-white sm:text-xl"><Trophy size={20} className="text-amber-300" /> Популярные товары</h3>
                    <p className="mt-1 text-sm font-medium text-slate-400">Доля в выручке за период.</p>
                  </div>
                </div>

                {topProducts.length ? (
                  <div className="space-y-3">
                    {topProducts.map((p, i) => (
                      <div key={`${p.name}-${i}`}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-black ${i === 0 ? "bg-amber-500/20 text-amber-300" : "bg-white/10 text-slate-300"}`}>{i + 1}</span>
                            <span className="truncate font-black text-white">{p.name}</span>
                            <span className="hidden shrink-0 text-xs font-bold text-slate-500 sm:inline">× {p.qty}</span>
                          </span>
                          <span className="shrink-0 tabular-nums font-black text-white">{money(p.revenueNum)} <span className="font-bold text-slate-500">· {Math.round(p.sharePct)}%</span></span>
                        </div>
                        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ${i === 0 ? "from-amber-400 to-amber-500" : "from-emerald-500/80 to-teal-500/80"}`} style={{ width: `${Math.max(3, p.barPct)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-white/5 px-4 py-6 text-center text-sm font-bold text-slate-500">Нет данных по товарам</p>
                )}

                {extraItems.length > 0 && (
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-400"><Package size={14} /> Доп. товары</p>
                      <p className="tabular-nums text-sm font-black text-amber-300">{money(stats.extraRevenue)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {extraItems.map((p, i) => (
                        <span key={`extra-${p.name}-${i}`} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-300">
                          {p.name} <span className="text-slate-500">× {p.qty}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* ── Последние чеки ── */}
            <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 p-5 sm:p-6">
                <div>
                  <h3 className="text-lg font-black text-white sm:text-xl">Последние чеки</h3>
                  <p className="mt-1 text-sm font-medium text-slate-400">Недавние продажи и способ оплаты.</p>
                </div>
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/15 text-violet-200"><Receipt size={22} strokeWidth={2.4} /></div>
              </div>

              <div className="divide-y divide-white/10 sm:max-h-[560px] sm:overflow-auto">
                {normalizedSales.map((s) => {
                  const isCash = s.paymentType === "cash";
                  return (
                    <div key={s.id} className={`border-l-[3px] p-4 transition hover:bg-white/[0.04] sm:p-5 ${isCash ? "border-l-emerald-400/60" : "border-l-blue-400/60"}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-black text-white">Чек #{s.id}</p>
                          <p className="mt-1 text-sm font-bold text-slate-400">{s.date} {s.time}</p>
                        </div>
                        <p className="shrink-0 rounded-2xl bg-white/5 px-3 py-2 text-sm font-black tabular-nums text-white">{money(s.total)}</p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${isCash ? "border border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border border-blue-400/20 bg-blue-500/10 text-blue-300"}`}>
                          {isCash ? <Banknote size={13} /> : <ArrowLeftRight size={13} />}
                          {isCash ? "Наличные" : (s.cardName ? `Перевод · ${s.cardName}` : "Перевод")}
                        </span>
                        {Number(s.discountPercent) > 0 && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-red-300">
                            <Scissors size={13} /> скидка {s.discountPercent}%
                          </span>
                        )}
                      </div>

                      <p className="mt-3 text-sm leading-6 text-slate-300">
                        {(s.items || []).map((i) => `${i.name} × ${i.qty}`).join(", ") || "Товары не указаны"}
                      </p>
                    </div>
                  );
                })}

                {!normalizedSales.length && (
                  <div className="p-10 text-center font-bold text-slate-500">Чеков за этот период пока нет</div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
