import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Package,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  Trophy,
  Wallet,
} from "lucide-react";
import { get, getCurrentWorkspace, getSession } from "../api";
import { formatMoney } from "../utils/format";

// ── helpers ──────────────────────────────────────────────────────────
const num = (v) => Number(v || 0);

// Локальная дата YYYY-MM-DD (не UTC — важно у полуночи в часовом поясе клиента)
const localISO = (d = new Date()) =>
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

// Плавный «счётчик» для KPI (easeOutCubic).
// Гарантирует итоговое значение даже если requestAnimationFrame
// приостановлен (фоновая вкладка) — иначе счётчик мог бы «застыть»
// на промежуточном (неверном) числе.
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
    // Страховка: если rAF не тикает (throttling) — снимем финал по таймеру.
    const safety = setTimeout(finish, duration + 150);
    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(safety); };
  }, [value, duration]);
  return display;
}

// ── презентационные компоненты ───────────────────────────────────────
const TONES = {
  blue: "text-blue-300 bg-blue-500/15",
  emerald: "text-emerald-300 bg-emerald-500/15",
  violet: "text-violet-300 bg-violet-500/15",
  amber: "text-amber-300 bg-amber-500/15",
};

function StatTile({ label, value, money, icon: Icon, tone = "blue", sub, delay = 0 }) {
  const animated = useCountUp(num(value));
  const shown = money ? formatMoney(Math.round(animated)) : Math.round(animated).toLocaleString("ru-RU");
  return (
    <div
      className="animate-rise group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)] backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-white/20 sm:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONES[tone]}`}>
          <Icon size={16} strokeWidth={2.6} />
        </span>
      </div>
      <p className="mt-2 truncate text-2xl font-black tabular-nums text-white sm:text-[28px]">{shown}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] font-semibold text-slate-500">{sub}</p>}
    </div>
  );
}

function AttentionRow({ to, icon: Icon, tone, title, hint, value }) {
  const tones = {
    amber: "border-amber-400/25 bg-amber-500/[0.07]",
    red: "border-red-400/25 bg-red-500/[0.07]",
    blue: "border-blue-400/25 bg-blue-500/[0.07]",
  };
  const iconTones = {
    amber: "text-amber-300",
    red: "text-red-300",
    blue: "text-blue-300",
  };
  return (
    <NavLink
      to={to}
      className={`group flex items-center gap-3.5 rounded-3xl border p-4 shadow-lg transition duration-200 hover:-translate-y-0.5 sm:gap-4 ${tones[tone]}`}
    >
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 ${iconTones[tone]}`}>
        <Icon size={20} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-white">{title}</p>
        <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-400">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-base font-black text-white sm:text-lg">{value}</span>
        <ChevronRight size={18} className="text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-white" />
      </div>
    </NavLink>
  );
}

function QuickAction({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      className="group flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-center transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]"
    >
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/8 text-slate-200 transition group-hover:bg-blue-500/20 group-hover:text-blue-300">
        <Icon size={20} strokeWidth={2.3} />
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

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }),
    []
  );

  const load = async () => {
    setLoading(true);
    setError("");
    const today = localISO();
    const [mStart, mEnd] = monthBounds();
    const [todayS, monthS, pend, debts, wh] = await Promise.all([
      get(`/sales/stats?from=${today}&to=${today}`).catch(() => null),
      get(`/sales/stats?from=${mStart}&to=${mEnd}`).catch(() => null),
      get(`/pending-sales`).catch(() => []),
      get(`/debts`).catch(() => []),
      get(`/warehouse/items`).catch(() => []),
    ]);
    if (!todayS && !monthS) setError("Не удалось загрузить сводку. Попробуйте обновить.");
    const pendingList = Array.isArray(pend) ? pend : [];
    const debtList = (Array.isArray(debts) ? debts : []).filter((d) => d.status !== "paid" && !d.paid && !d.isPaid && !d.is_paid);
    const lowStock = (Array.isArray(wh) ? wh : []).filter(
      (i) => num(i.minQuantity) > 0 && num(i.quantity) <= num(i.minQuantity) && !i.hidden && !i.deleted
    );
    setData({
      today: todayS || {},
      month: monthS || {},
      pending: { count: pendingList.length, sum: pendingList.reduce((s, x) => s + num(x.total), 0) },
      debts: { count: debtList.length, sum: debtList.reduce((s, x) => s + num(x.amount), 0) },
      lowStock: { count: lowStock.length, items: lowStock.slice(0, 4) },
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = data?.today || {};
  const m = data?.month || {};
  const topProducts = Array.isArray(m.topProducts) ? m.topProducts.slice(0, 5) : [];
  const attention = [
    data?.pending?.count > 0 && {
      key: "pending", to: "/pending-payments", icon: Clock3, tone: "blue",
      title: "Ожидают оплаты", hint: `${data.pending.count} ${plural(data.pending.count, "чек", "чека", "чеков")} в кассе`,
      value: formatMoney(data.pending.sum),
    },
    data?.debts?.count > 0 && {
      key: "debts", to: "/debts", icon: FileText, tone: "red",
      title: "Долги клиентов", hint: `${data.debts.count} ${plural(data.debts.count, "должник", "должника", "должников")}`,
      value: formatMoney(data.debts.sum),
    },
    data?.lowStock?.count > 0 && {
      key: "stock", to: "/warehouse", icon: AlertTriangle, tone: "amber",
      title: "Заканчивается на складе", hint: data.lowStock.items.map((i) => i.name).filter(Boolean).slice(0, 2).join(", ") || "Проверьте остатки",
      value: `${data.lowStock.count}`,
    },
  ].filter(Boolean);

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-16 h-80 w-80 rounded-full bg-violet-700/15 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1400px]">
        {/* ── Приветствие + основное действие ── */}
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold capitalize text-blue-400 sm:text-sm">{todayLabel}</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-[-0.02em] text-white sm:text-4xl">
              {greeting()}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
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
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 font-black text-slate-200 transition hover:bg-white/10 active:scale-[0.98]"
            >
              <BarChart3 size={18} strokeWidth={2.4} />
              <span className="hidden sm:inline">Отчёты</span>
            </NavLink>
          </div>
        </header>

        {error && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
            {error}
            <button onClick={load} className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white transition hover:bg-white/20">Обновить</button>
          </div>
        )}

        {/* ── KPI сегодня ── */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-400">Сегодня</h2>
        </div>
        {loading ? (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skel key={i} className="h-[104px] sm:h-[120px]" />)}
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Выручка" value={t.totalRevenue} money icon={Wallet} tone="blue" sub="за сегодня" delay={0} />
            <StatTile label="Продаж" value={t.salesCount} icon={ReceiptText} tone="violet" sub={t.salesCount ? `средний чек ${formatMoney(num(t.totalRevenue) / Math.max(1, num(t.salesCount)))}` : "пока нет продаж"} delay={60} />
            <StatTile label="Наличные" value={t.cashTotal} money icon={Banknote} tone="emerald" sub="в кассе" delay={120} />
            <StatTile label="Переводы" value={t.transferTotal} money icon={ArrowRightLeft} tone="amber" sub="на карты" delay={180} />
          </div>
        )}

        {/* ── Требует внимания ── */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-400">Требует внимания</h2>
        </div>
        {loading ? (
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => <Skel key={i} className="h-[76px]" />)}
          </div>
        ) : attention.length ? (
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {attention.map((a) => (
              <AttentionRow key={a.key} to={a.to} icon={a.icon} tone={a.tone} title={a.title} hint={a.hint} value={a.value} />
            ))}
          </div>
        ) : (
          <div className="animate-rise mb-6 flex items-center gap-4 rounded-3xl border border-emerald-400/25 bg-emerald-500/[0.06] p-5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-300">
              <CheckCircle2 size={24} strokeWidth={2.4} />
            </span>
            <div>
              <p className="text-base font-black text-white">Всё под контролем</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-400">Нет неоплаченных чеков, долгов и заканчивающихся товаров.</p>
            </div>
          </div>
        )}

        {/* ── Месяц + топ товаров ── */}
        <div className="mb-6 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          {/* Итоги месяца */}
          {loading ? (
            <Skel className="h-[220px]" />
          ) : (
            <section className="animate-rise overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-lg backdrop-blur">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/15 text-blue-300"><Sparkles size={16} strokeWidth={2.6} /></span>
                <h3 className="text-lg font-black text-white">Этот месяц</h3>
              </div>
              <div className="space-y-3">
                <MonthRow label="Выручка" value={formatMoney(num(m.totalRevenue))} accent="text-white" />
                <MonthRow label="Чистая прибыль" value={formatMoney(num(m.cleanProfit))} accent="text-emerald-300" />
                <MonthRow label="Продаж" value={num(m.salesCount).toLocaleString("ru-RU")} accent="text-white" />
                <MonthRow label="Скидки" value={formatMoney(num(m.totalDiscount))} accent="text-slate-300" />
              </div>
              <NavLink to="/analytics" className="mt-4 flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] py-2.5 text-sm font-black text-slate-300 transition hover:bg-white/10">
                Подробная аналитика <ArrowRight size={16} />
              </NavLink>
            </section>
          )}

          {/* Топ товаров */}
          {loading ? (
            <Skel className="h-[220px]" />
          ) : (
            <section className="animate-rise overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-lg backdrop-blur">
              <div className="mb-4 flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/15 text-amber-300"><Trophy size={16} strokeWidth={2.6} /></span>
                <h3 className="text-lg font-black text-white">Топ товаров за месяц</h3>
              </div>
              {topProducts.length ? (
                <div className="divide-y divide-white/[0.06]">
                  {topProducts.map((p, i) => (
                    <div key={`${p.name}-${i}`} className="flex items-center gap-3 py-2.5">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-black ${i === 0 ? "bg-amber-500/20 text-amber-300" : "bg-white/[0.06] text-slate-400"}`}>{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-bold text-white">{p.name}</span>
                      <span className="shrink-0 text-sm font-semibold text-slate-400">{num(p.qty).toLocaleString("ru-RU")} шт</span>
                      <span className="shrink-0 text-right text-sm font-black text-emerald-300">{formatMoney(num(p.revenue))}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 py-10 text-center">
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

function MonthRow({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0">
      <span className="text-sm font-semibold text-slate-400">{label}</span>
      <span className={`text-base font-black tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}

// плюрализация ру: (n, «чек», «чека», «чеков»)
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
