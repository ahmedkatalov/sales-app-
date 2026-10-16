import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  Clock3,
  FileText,
  Minus,
  Package,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import { get, getCurrentWorkspace, getSession } from "../api";
import { formatMoney, businessISO } from "../utils/format";

// ── helpers (module-level: new Date() здесь безопасен для react-hooks/purity) ──
const num = (v) => Number(v || 0);

const localISO = (d) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const monthBounds = () => {
  const d = new Date();
  return [localISO(new Date(d.getFullYear(), d.getMonth(), 1)), localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 6) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// безопасные вычисления (без NaN/Infinity на нулях)
const pct = (part, whole) => (num(whole) > 0 ? (num(part) / num(whole)) * 100 : 0);
const roundPct = (part, whole) => Math.round(pct(part, whole));

// Плавный «счётчик» для крупных чисел (easeOutCubic), устойчив к throttling вкладки.
function useCountUp(value, duration = 900) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(0);
  const rafRef = useRef(0);
  useEffect(() => {
    const to = num(value);
    if (prefersReducedMotion()) { setDisplay(to); fromRef.current = to; return; }
    cancelAnimationFrame(rafRef.current);
    const from = fromRef.current;
    let start = 0;
    const finish = () => { fromRef.current = to; setDisplay(to); };
    const step = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else finish();
    };
    rafRef.current = requestAnimationFrame(step);
    const safety = setTimeout(finish, duration + 150);
    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(safety); };
  }, [value, duration]);
  return display;
}

function AnimatedMoney({ value }) {
  const a = useCountUp(num(value));
  return <>{formatMoney(Math.round(a))}</>;
}
function AnimatedInt({ value }) {
  const a = useCountUp(num(value));
  return <>{Math.round(a).toLocaleString("ru-RU")}</>;
}

// ── мелкие презентационные блоки ─────────────────────────────────────
function DeltaPill({ percent, suffix = "против вчера", size = "sm" }) {
  if (percent === null || percent === undefined) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] font-bold text-slate-400">
        <Minus size={13} /> нет данных за вчера
      </span>
    );
  }
  const up = percent >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const cls = up ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300";
  const text = `${up ? "+" : "−"}${Math.abs(Math.round(percent))}%`;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-black tabular-nums ${cls} ${size === "sm" ? "text-[12px]" : "text-sm"}`}>
      <Icon size={size === "sm" ? 14 : 16} strokeWidth={2.8} />
      {text}
      <span className="font-bold opacity-70">{suffix}</span>
    </span>
  );
}

function MarginRing({ value }) {
  const has = value !== null && value !== undefined;
  const v = has ? Math.max(0, Math.min(100, value)) : 0;
  const color = !has ? "rgba(148,163,184,0.45)" : v >= 60 ? "#34d399" : v >= 30 ? "#fbbf24" : "#fb7185";
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div
        className="grid h-[72px] w-[72px] place-items-center rounded-full sm:h-[104px] sm:w-[104px]"
        style={{ background: `conic-gradient(${color} ${v * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
      >
        <div className="grid h-[58px] w-[58px] place-items-center rounded-full bg-[#0a1122] sm:h-[84px] sm:w-[84px]">
          <span className="text-base font-black tabular-nums text-white sm:text-2xl">{has ? `${Math.round(v)}%` : "—"}</span>
        </div>
      </div>
      <span className="mt-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">Маржа</span>
    </div>
  );
}

function Sparkline({ data }) {
  const max = Math.max(1, ...data.map((d) => num(d.revenue)));
  return (
    <div className="flex items-end gap-1.5" style={{ height: 56 }}>
      {data.map((d, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <div
            className={`w-full rounded-t-[4px] transition-all ${d.isToday ? "bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.5)]" : "bg-white/15"}`}
            style={{ height: `${num(d.revenue) > 0 ? Math.max(8, (num(d.revenue) / max) * 100) : 4}%` }}
            title={`${d.label}: ${formatMoney(num(d.revenue))}`}
          />
          <span className={`text-[9px] font-bold ${d.isToday ? "text-blue-300" : "text-slate-600"}`}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function SplitBar({ cash, transfer }) {
  const total = num(cash) + num(transfer);
  const cashPct = pct(cash, total);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div className="bg-emerald-400/80" style={{ width: `${cashPct}%` }} />
        <div className="bg-blue-400/80" style={{ width: `${total > 0 ? 100 - cashPct : 0}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] font-bold">
        <span className="truncate text-emerald-300">Наличные {total > 0 ? Math.round(cashPct) : 0}% · {formatMoney(cash)}</span>
        <span className="truncate text-right text-blue-300">Переводы {total > 0 ? 100 - Math.round(cashPct) : 0}% · {formatMoney(transfer)}</span>
      </div>
    </div>
  );
}

function HealthChip({ to, icon: Icon, label, value, level }) {
  const dot = level === "act" ? "bg-red-400" : level === "watch" ? "bg-amber-400" : "bg-emerald-400";
  const border = level === "act" ? "border-red-400/25" : level === "watch" ? "border-amber-400/20" : "border-white/10";
  return (
    <NavLink to={to} className={`flex min-h-[62px] items-center gap-2.5 rounded-2xl border ${border} bg-white/[0.04] px-3 py-2.5 transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.07]`}>
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-slate-200">
        <Icon size={16} strokeWidth={2.5} />
        <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ${dot} ring-2 ring-[#070d1c]`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase leading-tight tracking-wide text-slate-400">{label}</p>
        <p className="mt-0.5 truncate text-sm font-black text-white">{value}</p>
      </div>
    </NavLink>
  );
}

function MiniStat({ label, value, accent = "text-white" }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-lg font-black tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      className="group flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]"
    >
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/[0.08] text-slate-200 transition group-hover:bg-blue-500/20 group-hover:text-blue-300">
        <Icon size={19} strokeWidth={2.3} />
      </span>
      <span className="text-[13px] font-bold text-slate-300">{label}</span>
    </NavLink>
  );
}

const Skel = ({ className = "" }) => <div className={`animate-pulse rounded-3xl bg-white/[0.05] ${className}`} />;

// ── страница ─────────────────────────────────────────────────────────
export default function HomePage() {
  const session = getSession();
  const workspace = getCurrentWorkspace();
  const rawName = session?.ownerName || session?.username || "";
  const firstName = String(rawName).split(/[\s@]/)[0] || "";

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }),
    []
  );
  const hello = useMemo(() => greeting(), []);

  const load = async () => {
    setLoading(true);
    setError("");
    const today = businessISO(); // рабочий день точки (учёт ночной работы)
    const [mStart, mEnd] = monthBounds();

    // Границы прошлого месяца + окно 7 дней — считаем из рабочей даты (не в теле рендера).
    const [yy, mm, dd] = String(today).split("-").map(Number);
    const pmStart = localISO(new Date(yy, mm - 2, 1));
    const pmEnd = localISO(new Date(yy, mm - 1, 0));
    const daysInMonth = new Date(yy, mm, 0).getDate();
    const dayOfMonth = dd;
    const weekDates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(yy, mm - 1, dd - i);
      weekDates.push({ iso: localISO(d), label: d.toLocaleDateString("ru-RU", { weekday: "short" }) });
    }

    const [todayS, monthS, lastMonthS, daily, pend, debts, wh, opening] = await Promise.all([
      get(`/sales/stats?from=${today}&to=${today}`).catch(() => null),
      get(`/sales/stats?from=${mStart}&to=${mEnd}`).catch(() => null),
      get(`/sales/stats?from=${pmStart}&to=${pmEnd}`).catch(() => null),
      get(`/sales/daily?days=7`).catch(() => null),
      get(`/pending-sales`).catch(() => []),
      get(`/debts`).catch(() => []),
      get(`/warehouse/items`).catch(() => []),
      get(`/finance/opening`).catch(() => null),
    ]);

    try {
      const dismissed = localStorage.getItem("okvion_opening_onboarding_dismissed");
      setShowOnboarding(!dismissed && !!opening && opening.isSet === false);
    } catch { /* ignore */ }
    if (!todayS && !monthS) setError("Не удалось загрузить сводку. Попробуйте обновить.");

    const dailyMap = {};
    (Array.isArray(daily?.days) ? daily.days : []).forEach((d) => { dailyMap[d.date] = d; });
    const spark = weekDates.map((w) => ({
      label: w.label,
      revenue: num(dailyMap[w.iso]?.revenue),
      isToday: w.iso === today,
    }));
    const weekTotal = spark.reduce((s, x) => s + num(x.revenue), 0);
    const yestRev = num(dailyMap[weekDates[5]?.iso]?.revenue);

    const pendingList = Array.isArray(pend) ? pend : [];
    const debtList = (Array.isArray(debts) ? debts : []).filter((d) => d.status !== "paid" && !d.paid && !d.isPaid && !d.is_paid);
    const lowStock = (Array.isArray(wh) ? wh : []).filter(
      (i) => num(i.minQuantity) > 0 && num(i.quantity) <= num(i.minQuantity) && !i.hidden && !i.deleted
    );
    const negStock = (Array.isArray(wh) ? wh : []).filter(
      (i) => num(i.quantity) < -0.000001 && !i.hidden && !i.deleted
    );

    const mRev = num(monthS?.totalRevenue);
    const forecast = dayOfMonth > 0 ? (mRev / dayOfMonth) * daysInMonth : mRev;

    setData({
      today: todayS || {},
      month: monthS || {},
      lastMonthRev: num(lastMonthS?.totalRevenue),
      spark,
      weekTotal,
      weekAvg: weekTotal / 7,
      yestRev,
      dayOfMonth,
      daysInMonth,
      forecast,
      pending: { count: pendingList.length, sum: pendingList.reduce((s, x) => s + num(x.total), 0) },
      debts: { count: debtList.length, sum: debtList.reduce((s, x) => s + num(x.amount), 0) },
      lowStock: { count: lowStock.length, items: lowStock.slice(0, 4) },
      negStock: { count: negStock.length, items: negStock.slice(0, 4) },
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const t = data?.today || {};
  const m = data?.month || {};
  const topProducts = Array.isArray(m.topProducts) ? m.topProducts.slice(0, 5) : [];
  const maxTopRev = Math.max(1, ...topProducts.map((p) => num(p.revenue)));

  const todayRev = num(t.totalRevenue);
  const todayProfit = num(t.cleanProfit);
  const margin = todayRev > 0 ? pct(todayProfit, todayRev) : null;
  const avgCheck = num(t.salesCount) > 0 ? todayRev / num(t.salesCount) : null;
  const revDelta = data && data.yestRev > 0 ? ((todayRev - data.yestRev) / data.yestRev) * 100 : null;

  // темп месяца
  const mRev = num(m.totalRevenue);
  const mProfit = num(m.cleanProfit);
  const lastMonthRev = num(data?.lastMonthRev);
  const paceFill = lastMonthRev > 0 ? Math.min(100, (mRev / lastMonthRev) * 100) : (mRev > 0 ? 100 : 0);
  const timeMarker = data ? Math.min(100, (data.dayOfMonth / data.daysInMonth) * 100) : 0;
  const forecastDelta = lastMonthRev > 0 ? ((num(data?.forecast) / lastMonthRev) - 1) * 100 : null;
  const showForecast = data && data.dayOfMonth > 2;

  const health = [
    { key: "pending", to: "/pending-payments", icon: Clock3, label: "Ожидают оплаты",
      value: data?.pending?.count > 0 ? formatMoney(data.pending.sum) : "0 ₽",
      level: data?.pending?.count > 0 ? "watch" : "ok" },
    { key: "debts", to: "/debts", icon: FileText, label: "Долги клиентов",
      value: data?.debts?.count > 0 ? formatMoney(data.debts.sum) : "0 ₽",
      level: data?.debts?.count > 0 ? "act" : "ok" },
    { key: "neg", to: "/warehouse", icon: AlertTriangle, label: "Товары в минусе",
      value: `${data?.negStock?.count || 0}`,
      level: data?.negStock?.count > 0 ? "act" : "ok" },
    { key: "low", to: "/warehouse", icon: Package, label: "Низкий остаток",
      value: `${data?.lowStock?.count || 0}`,
      level: data?.lowStock?.count > 0 ? "watch" : "ok" },
  ];
  const allClear = health.every((h) => h.level === "ok");

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="relative mx-auto w-full max-w-[1400px]">
        {/* ── Шапка ── */}
        <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold capitalize text-blue-400 sm:text-sm">{todayLabel}</p>
            <h1 className="mt-1 text-2xl font-black leading-tight tracking-[-0.02em] text-white sm:text-3xl">
              {hello}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {workspace?.name || "Ваша точка"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2.5">
            <NavLink
              to="/pos"
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3.5 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 active:scale-[0.98] lg:flex-none"
            >
              <ShoppingCart size={18} strokeWidth={2.6} />
              Новая продажа
            </NavLink>
            <NavLink
              to="/sales-analytics"
              aria-label="Продажи"
              title="Продажи"
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 font-black text-slate-200 transition hover:bg-white/10 active:scale-[0.98]"
            >
              <BarChart3 size={18} strokeWidth={2.4} />
              <span className="hidden sm:inline">Продажи</span>
            </NavLink>
          </div>
        </header>

        {showOnboarding && (
          <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-emerald-400/25 bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300"><Sparkles size={18} strokeWidth={2.4} /></span>
              <div className="min-w-0">
                <p className="text-sm font-black text-white">Начинаете вести учёт не с нуля?</p>
                <p className="mt-0.5 text-xs font-bold leading-snug text-slate-300">
                  Задайте стартовые балансы (касса, банк, склад, долги) — и отчёты сразу будут точными.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <NavLink to="/finance?setup=1" className="rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2.5 text-sm font-black text-white shadow-lg transition hover:brightness-110">Настроить</NavLink>
              <button onClick={() => { try { localStorage.setItem("okvion_opening_onboarding_dismissed", "1"); } catch { /* ignore */ } setShowOnboarding(false); }}
                className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-slate-300 transition hover:bg-white/10">Позже</button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
            {error}
            <button onClick={load} className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white transition hover:bg-white/20">Обновить</button>
          </div>
        )}

        {/* ── ГЕРОЙ: Пульс дня ── */}
        {loading ? (
          <Skel className="mb-5 h-[340px]" />
        ) : (
          <section className="animate-rise relative mb-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
            <div className="relative">
              {/* верх: число + дельта + кольцо маржи */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Выручка сегодня</p>
                  <p className="mt-1 text-4xl font-black leading-none tabular-nums text-white sm:text-5xl">
                    <AnimatedMoney value={todayRev} />
                  </p>
                  <div className="mt-2.5">
                    <DeltaPill percent={revDelta} />
                  </div>
                </div>
                <MarginRing value={margin} />
              </div>

              {/* мини-показатели */}
              <div className="mt-5 grid grid-cols-3 gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 sm:gap-4 sm:p-4">
                <div className="min-w-0 border-r border-white/10 pr-3">
                  <p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-400">Прибыль</p>
                  <p className="mt-0.5 truncate text-lg font-black tabular-nums text-emerald-300 sm:text-xl"><AnimatedMoney value={todayProfit} /></p>
                </div>
                <MiniStat label="Ср. чек" value={avgCheck === null ? "—" : formatMoney(avgCheck)} />
                <div className="min-w-0 border-l border-white/10 pl-3">
                  <p className="truncate text-[11px] font-bold uppercase tracking-wider text-slate-400">Продаж</p>
                  <p className="mt-0.5 truncate text-lg font-black tabular-nums text-white sm:text-xl"><AnimatedInt value={t.salesCount} /></p>
                </div>
              </div>

              {/* спарклайн 7 дней */}
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-[11px] font-bold">
                  <span className="uppercase tracking-wider text-slate-400">Выручка за 7 дней</span>
                  <span className="tabular-nums text-slate-400">{formatMoney(data.weekTotal)} · в среднем {formatMoney(data.weekAvg)}/день</span>
                </div>
                <Sparkline data={data.spark} />
              </div>

              {/* нал / перевод */}
              <div className="mt-5">
                <SplitBar cash={t.cashTotal} transfer={t.transferTotal} />
              </div>
            </div>
          </section>
        )}

        {/* ── Здоровье бизнеса ── */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-400">Здоровье бизнеса</h2>
        </div>
        {loading ? (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skel key={i} className="h-[58px]" />)}
          </div>
        ) : allClear ? (
          <div className="animate-rise mb-6 flex items-center gap-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] p-5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300"><CheckCircle2 size={24} strokeWidth={2.4} /></span>
            <div>
              <p className="text-base font-black text-white">Всё под контролем</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-400">Нет неоплаченных чеков, долгов и проблем со складом.</p>
            </div>
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {health.map((h) => (
              <HealthChip key={h.key} to={h.to} icon={h.icon} label={h.label} value={h.value} level={h.level} />
            ))}
          </div>
        )}

        {/* ── Темп месяца + Топ товаров ── */}
        <div className="mb-6 grid gap-3 lg:grid-cols-[1fr_1.15fr]">
          {/* Темп месяца */}
          {loading ? (
            <Skel className="h-[260px]" />
          ) : (
            <section className="animate-rise overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/15 text-blue-300"><Sparkles size={16} strokeWidth={2.6} /></span>
                <h3 className="text-lg font-black text-white">Этот месяц</h3>
              </div>

              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Выручка</p>
              <p className="text-3xl font-black tabular-nums text-white"><AnimatedMoney value={mRev} /></p>

              {/* прогресс к прошлому месяцу */}
              <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${paceFill}%` }} />
                {lastMonthRev > 0 && (
                  <div className="absolute top-[-3px] h-[16px] w-[2px] rounded bg-white/70" style={{ left: `${timeMarker}%` }} title="Темп на сегодня" />
                )}
              </div>
              <p className="mt-2 text-[12px] font-semibold leading-snug text-slate-400">
                {lastMonthRev > 0 ? (
                  showForecast ? (
                    <>Прогноз до конца месяца ~<span className="font-black text-white">{formatMoney(num(data.forecast))}</span>{" "}
                      {forecastDelta !== null && (
                        <span className={forecastDelta >= 0 ? "text-emerald-300" : "text-rose-300"}>
                          ({forecastDelta >= 0 ? "+" : "−"}{Math.abs(Math.round(forecastDelta))}% к прошлому месяцу)
                        </span>
                      )}
                    </>
                  ) : (
                    <>Прошлый месяц — <span className="font-black text-white">{formatMoney(lastMonthRev)}</span>. Прогноз появится через пару дней.</>
                  )
                ) : (
                  <>Первый месяц учёта — сравнение появится в следующем.</>
                )}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <MonthChip label="Чистая прибыль" value={formatMoney(mProfit)} accent="text-emerald-300" />
                <MonthChip label="Маржа" value={mRev > 0 ? `${roundPct(mProfit, mRev)}%` : "—"} />
                <MonthChip label="Средний чек" value={num(m.salesCount) > 0 ? formatMoney(mRev / num(m.salesCount)) : "—"} />
                <MonthChip label="Скидки" value={formatMoney(num(m.totalDiscount))} />
              </div>

              <NavLink to="/analytics" className="mt-4 flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] py-2.5 text-sm font-black text-slate-300 transition hover:bg-white/10">
                Аналитика <ArrowRight size={16} />
              </NavLink>
            </section>
          )}

          {/* Топ товаров */}
          {loading ? (
            <Skel className="h-[260px]" />
          ) : (
            <section className="animate-rise overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/15 text-amber-300"><Trophy size={16} strokeWidth={2.6} /></span>
                <h3 className="text-lg font-black text-white">Топ товаров за месяц</h3>
              </div>
              {topProducts.length ? (
                <div className="space-y-3">
                  {topProducts.map((p, i) => (
                    <div key={`${p.name}-${i}`}>
                      <div className="flex items-center gap-3">
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black ${i === 0 ? "bg-amber-500/20 text-amber-300" : "bg-white/[0.06] text-slate-400"}`}>{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-bold text-white">{p.name}</span>
                        <span className="shrink-0 text-right text-[13px] font-semibold tabular-nums text-slate-400">{num(p.qty).toLocaleString("ru-RU")} шт</span>
                        <span className="w-24 shrink-0 text-right text-sm font-black tabular-nums text-emerald-300">{formatMoney(num(p.revenue))}</span>
                      </div>
                      <div className="mt-1.5 ml-10 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className={`h-full rounded-full ${i === 0 ? "bg-gradient-to-r from-amber-400 to-amber-500" : "bg-gradient-to-r from-blue-500/70 to-violet-500/70"}`} style={{ width: `${Math.max(4, pct(p.revenue, maxTopRev))}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 py-12 text-center">
                  <Package size={26} className="mb-2 text-slate-500" />
                  <p className="text-sm font-bold text-slate-400">Продаж в этом месяце ещё не было</p>
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── Быстрые действия ── */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-400">Быстрые действия</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <QuickAction to="/pos" icon={ShoppingCart} label="Касса" />
          <QuickAction to="/expenses" icon={Wallet} label="Расход" />
          <QuickAction to="/work" icon={Boxes} label="Товары" />
          <QuickAction to="/warehouse" icon={Package} label="Склад" />
          <QuickAction to="/sales-analytics" icon={ReceiptText} label="Продажи" />
          <QuickAction to="/analytics" icon={BarChart3} label="Аналитика" />
        </div>
      </div>
    </div>
  );
}

function MonthChip({ label, value, accent = "text-white" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <p className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-base font-black tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}
