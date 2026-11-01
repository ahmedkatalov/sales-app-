import "./HomePage.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Clock3,
  FileText,
  Minus,
  Package,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold tabular-nums ${cls} ${size === "sm" ? "text-[12px]" : "text-sm"}`}>
      <Icon size={size === "sm" ? 14 : 16} strokeWidth={2.8} />
      {text}
      <span className="font-bold opacity-70">{suffix}</span>
    </span>
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
  // Умное здоровье: показываем ТОЛЬКО реальные проблемы, отсортированные по тяжести.
  const sevOrder = { act: 0, watch: 1 };
  const problems = health.filter((h) => h.level !== "ok").sort((a, b) => (sevOrder[a.level] ?? 2) - (sevOrder[b.level] ?? 2));

  return (
    <main className="home-dashboard pb-nav">
      <header className="home-heading">
        <div><p className="home-eyebrow">{workspace?.name || "Ваша точка"} / Обзор</p><h1>Обзор точки</h1><p>{hello}{firstName ? `, ${firstName}` : ""}. Сводка работы вашей точки.</p></div>
        <div className="home-heading-right"><span>{todayLabel}</span><NavLink className="home-primary" to="/pos"><ShoppingCart size={18} /> Новая продажа <ArrowRight size={18} /></NavLink></div>
      </header>
      {showOnboarding && <div className="home-notice"><Sparkles size={20}/><p>Начните с точных цифр — укажите стартовые балансы.</p><NavLink to="/finance?setup=1">Настроить</NavLink><button onClick={() => { try { localStorage.setItem("okvion_opening_onboarding_dismissed", "1"); } catch { /* Storage unavailable */ } setShowOnboarding(false); }}>Позже</button></div>}
      {error && <div className="home-notice" role="alert"><p>{error}</p><button onClick={load}>Повторить</button></div>}
      {loading ? <div className="home-loading" role="status">Собираем показатели вашей точки…</div> : <>
        <div className="home-overview">
          <section className="home-revenue bg-white/[0.02] shadow-sm backdrop-blur-sm"><div className="home-section-label"><span>Продажи сегодня</span><span className="home-live">Текущий день</span></div><p className="home-metric-label">Выручка</p><div className="home-big-number"><AnimatedMoney value={todayRev}/></div><DeltaPill percent={revDelta}/><div className="home-payment"><SplitBar cash={t.cashTotal} transfer={t.transferTotal}/></div><div className="home-revenue-bottom"><span>Маржа сегодня</span><strong>{margin === null ? "—" : `${Math.round(margin)}%`}</strong></div></section>
          <section className="home-week bg-white/[0.02] shadow-sm backdrop-blur-sm"><div className="home-section-label"><span>Динамика выручки</span><NavLink to="/sales-analytics" aria-label="Открыть аналитику продаж"><ArrowRight size={20}/></NavLink></div><div className="home-week-total">{formatMoney(data.weekTotal)}<span>за последние 7 дней</span></div><div className="home-chart">{data.spark.map((day, index) => <div className="home-chart-column" key={index}><span className="home-chart-value">{formatMoney(day.revenue)}</span><div className="home-chart-track"><div className={day.isToday ? "is-today" : ""} style={{height: `${Math.max(2, pct(day.revenue, Math.max(1, ...data.spark.map(d => d.revenue))))}%`}}/></div><span>{day.label}</span></div>)}</div><p className="home-chart-caption">В среднем {formatMoney(data.weekAvg)} в день</p></section>
        </div>
        <div className="home-stat-strip bg-white/[0.02]">{[{label:"Чистая прибыль сегодня",value:formatMoney(todayProfit)},{label:"Средний чек сегодня",value:avgCheck === null ? "—" : formatMoney(avgCheck)},{label:"Продаж сегодня",value:num(t.salesCount).toLocaleString("ru-RU")},{label:"Выручка за месяц",value:formatMoney(mRev)}].map(stat => <div key={stat.label}><p>{stat.label}</p><strong>{stat.value}</strong></div>)}</div>
        <div className="home-section-title"><h2>Контроль операций</h2><span>{allClear ? "Всё в порядке" : `${problems.length} показателя требуют внимания`}</span></div>
        <div className="home-attention bg-white/[0.02]">{health.map(({key,to,icon:Icon,label,value,level}) => <NavLink key={key} to={to} className={`home-alert home-alert-${level}`}><Icon size={20}/><span>{label}<strong>{value}</strong></span><ArrowRight size={17}/></NavLink>)}</div>
        <div className="home-bottom-grid">
          <section className="home-panel bg-white/[0.02] shadow-sm backdrop-blur-sm"><div className="home-section-title"><div><p className="home-eyebrow">Товары</p><h2>Лидеры месяца</h2></div><NavLink to="/sales-analytics"><ArrowRight size={20}/></NavLink></div>{topProducts.length ? <div className="home-products">{topProducts.map((product,index) => <div className="home-product" key={`${product.name}-${index}`}><span className="home-rank">{String(index+1).padStart(2,"0")}</span><div className="home-product-name"><strong>{product.name}</strong><div className="home-product-track"><span style={{width:`${pct(product.revenue,maxTopRev)}%`}}/></div></div><div className="home-product-value"><strong>{formatMoney(product.revenue)}</strong><span>{num(product.qty)} шт.</span></div></div>)}</div> : <div className="home-empty"><Package size={32}/><p>Здесь появятся ваши бестселлеры</p><span>Оформите первую продажу, чтобы начать.</span><NavLink to="/pos">Перейти в кассу <ArrowRight size={16}/></NavLink></div>}</section>
          <section className="home-panel home-month bg-white/[0.02] shadow-sm backdrop-blur-sm"><p className="home-eyebrow">Финансы</p><h2>Итоги месяца</h2><div className="home-month-profit"><span>Чистая прибыль</span><strong>{formatMoney(mProfit)}</strong></div><dl><div><dt>Маржа</dt><dd>{mRev > 0 ? `${roundPct(mProfit,mRev)}%` : "—"}</dd></div><div><dt>Средний чек</dt><dd>{num(m.salesCount) > 0 ? formatMoney(mRev/num(m.salesCount)) : "—"}</dd></div><div><dt>Скидки</dt><dd>{formatMoney(num(m.totalDiscount))}</dd></div></dl>{showForecast && <p className="home-forecast">При текущем темпе выручка к концу месяца составит около <strong>{formatMoney(data.forecast)}</strong>.</p>}<NavLink className="home-report-link" to="/analytics">Смотреть отчёт <ArrowRight size={18}/></NavLink></section>
        </div>
        <div className="home-section-title"><h2>Рабочие инструменты</h2><span>Быстрый переход</span></div><nav className="home-tools" aria-label="Рабочие инструменты">{[{to:"/pos",icon:ShoppingCart,label:"Касса"},{to:"/expenses",icon:Wallet,label:"Расходы"},{to:"/work",icon:Boxes,label:"Товары"},{to:"/warehouse",icon:Package,label:"Склад"},{to:"/sales-analytics",icon:ReceiptText,label:"Продажи"},{to:"/analytics",icon:BarChart3,label:"Аналитика"}].map(({to,icon:Icon,label}) => <NavLink to={to} key={to}><Icon size={20}/><span>{label}</span><ArrowRight size={16}/></NavLink>)}</nav>
      </>}
    </main>
  );
}
