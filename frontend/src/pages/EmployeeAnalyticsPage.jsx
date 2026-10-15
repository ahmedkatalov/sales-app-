import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Clock, CreditCard, Crown, Trophy } from "lucide-react";
import { csvCell, csvNum, downloadCsv } from "../utils/csv";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { get } from "../api";
import { formatMoney, localISO, businessISO } from "../utils/format";

const num = (v) => Number(v || 0);
const money = (v) => formatMoney(num(v));
const WEEKDAYS_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Пн-первый

const AV_TONES = [
  "bg-blue-500/20 text-blue-200", "bg-violet-500/20 text-violet-200", "bg-emerald-500/20 text-emerald-200",
  "bg-amber-500/20 text-amber-200", "bg-rose-500/20 text-rose-200", "bg-cyan-500/20 text-cyan-200",
];
const initials = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
const toneFor = (id, name) => {
  const s = String(id ?? name ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return AV_TONES[h % AV_TONES.length];
};

function Avatar({ id, name, size = 40, className = "" }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-2xl font-black ${toneFor(id, name)} ${className}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {initials(name)}
    </span>
  );
}

const monthBounds = () => {
  const d = new Date();
  return [localISO(new Date(d.getFullYear(), d.getMonth(), 1)), localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
};
const daysAgo = (n) => businessISO(new Date(Date.now() - n * 86400000));

const CHART_GRID = "rgba(148,163,184,0.14)";
const CHART_AXIS = "#94a3b8";
const PAY_COLORS = { cash: "#34d399", transfer: "#60a5fa", debt: "#f59e0b" };

// ── презентационные компоненты ───────────────────────────────────────
function KpiTile({ label, value, sub, tone = "blue", className = "" }) {
  const tones = {
    blue: "text-blue-300 bg-blue-500/15",
    emerald: "text-emerald-300 bg-emerald-500/15",
    violet: "text-violet-300 bg-violet-500/15",
    amber: "text-amber-300 bg-amber-500/15",
    slate: "text-slate-300 bg-white/10",
  };
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 shadow-lg backdrop-blur sm:p-4 ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 sm:text-[11px]">{label}</p>
      <p className="mt-1.5 truncate text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{sub}</p>}
      <span className={`sr-only ${tones[tone]}`} />
    </div>
  );
}

function PaySplitBar({ cash, transfer, debt }) {
  const total = num(cash) + num(transfer) + num(debt) || 1;
  const seg = (v, c) => (num(v) > 0 ? <span className="h-full" style={{ width: `${(num(v) / total) * 100}%`, background: c }} /> : null);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
      {seg(cash, PAY_COLORS.cash)}
      {seg(transfer, PAY_COLORS.transfer)}
      {seg(debt, PAY_COLORS.debt)}
    </div>
  );
}

const Skel = ({ className = "" }) => <div className={`animate-pulse rounded-2xl bg-white/[0.05] ${className}`} />;

function ChartCard({ title, subtitle, children, right }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-lg backdrop-blur sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-white sm:text-lg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12px] font-semibold text-slate-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── страница ─────────────────────────────────────────────────────────
export default function EmployeeAnalyticsPage() {
  const [mStart, mEnd] = useMemo(() => monthBounds(), []);
  const [from, setFrom] = useState(mStart);
  const [to, setTo] = useState(mEnd);
  const [preset, setPreset] = useState("month");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState("revenue");
  const [openId, setOpenId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqRef = useRef(0);
  const loadingRef = useRef(false);

  const applyPreset = (key) => {
    setPreset(key);
    const today = businessISO();
    if (key === "today") { setFrom(today); setTo(today); }
    else if (key === "yesterday") { const y = daysAgo(1); setFrom(y); setTo(y); }
    else if (key === "week") { setFrom(daysAgo(6)); setTo(today); }
    else if (key === "month") { const [s, e] = monthBounds(); setFrom(s); setTo(e); }
    else if (key === "all") { setFrom(""); setTo(""); }
  };

  const load = async () => {
    const seq = ++reqRef.current;
    loadingRef.current = true;
    setError("");
    try {
      const r = await get(`/analytics/employees?from=${from}&to=${to}`);
      if (seq !== reqRef.current) return;
      setData(r || null);
    } catch (e) {
      if (seq === reqRef.current) setError(e?.message || "Не удалось загрузить аналитику");
    } finally {
      if (seq === reqRef.current) setLoading(false);
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // авто-обновление (без наложения запросов) — как только появляются новые продажи
    const t = setInterval(() => { if (!loadingRef.current) load(); }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const totals = useMemo(() => data?.totals || {}, [data]);
  const employees = useMemo(() => {
    const list = Array.isArray(data?.employees) ? [...data.employees] : [];
    const key = sort === "orders" ? "orders" : sort === "aov" ? "aov" : sort === "items" ? "itemsSold" : "revenue";
    return list.sort((a, b) => num(b[key]) - num(a[key]));
  }, [data, sort]);

  const insights = useMemo(() => {
    if (!data) return [];
    const out = [];
    const hours = data.byHour || [];
    const peak = hours.reduce((m, h) => (num(h.revenue) > num(m.revenue) ? h : m), { revenue: 0, hour: 0 });
    if (num(peak.revenue) > 0) out.push({ icon: Clock, text: `Пик продаж: ${String(peak.hour).padStart(2, "0")}:00–${String((peak.hour + 1) % 24).padStart(2, "0")}:00` });
    const wd = data.byWeekday || [];
    const bestWd = wd.reduce((m, w) => (num(w.revenue) > num(m.revenue) ? w : m), { revenue: 0, weekday: 0 });
    if (num(bestWd.revenue) > 0) out.push({ icon: Calendar, text: `Лучший день недели — ${WEEKDAYS_FULL[bestWd.weekday]}` });
    if (employees[0] && num(employees[0].revenue) > 0) out.push({ icon: Trophy, text: `Лидер — ${employees[0].name}: ${Math.round(num(employees[0].share))}% выручки` });
    const c = num(totals.cash), tr = num(totals.transfer), tot = c + tr || 1;
    out.push({ icon: CreditCard, text: `Наличные ${Math.round((c / tot) * 100)}% · переводы ${Math.round((tr / tot) * 100)}%` });
    return out;
  }, [data, employees, totals]);

  const trend = (data?.trend || []).map((d) => ({ ...d, label: d.date?.slice(5) }));
  const hourData = (data?.byHour || []).filter((h) => num(h.revenue) > 0);
  const payData = [
    { name: "Наличные", value: num(totals.cash), key: "cash" },
    { name: "Переводы", value: num(totals.transfer), key: "transfer" },
    { name: "Долг", value: num(totals.debt), key: "debt" },
  ].filter((p) => p.value > 0);
  const payTotal = num(totals.cash) + num(totals.transfer) + num(totals.debt);
  const leader = employees[0] && num(employees[0].revenue) > 0 ? employees[0] : null;
  const maxRevenue = employees.reduce((mx, e) => Math.max(mx, num(e.revenue)), 0) || 1;
  const itemsPerOrder = num(totals.orders) > 0 ? num(totals.itemsSold) / num(totals.orders) : 0;
  const peakHourRevenue = hourData.reduce((mx, h) => Math.max(mx, num(h.revenue)), 0);
  const weekdayData = useMemo(() => {
    const byW = new Map((data?.byWeekday || []).map((w) => [Number(w.weekday), num(w.revenue)]));
    const rows = WD_ORDER.map((w) => ({ weekday: w, label: WEEKDAYS_SHORT[w], revenue: byW.get(w) || 0 }));
    return { rows, max: rows.reduce((mx, r) => Math.max(mx, r.revenue), 0) };
  }, [data]);
  const ipo = (e) => (num(e.orders) > 0 ? num(e.itemsSold) / num(e.orders) : 0);

  const exportCsv = () => {
    // Текст: экранируем кавычки + гасим формульную инъекцию (=,+,-,@); числа: запятая-десятичная (русский Excel).
    const head = ["Продавец", "Выручка", "Чеки", "Средний чек", "Наличные", "Переводы", "Долг", "Товаров", "Скидки", "Крупнейший чек", "Доля %"].map(csvCell);
    const rows = employees.map((e) => [
      csvCell(e.name),
      csvNum(e.revenue), csvNum(e.orders), csvNum(Math.round(num(e.aov))),
      csvNum(e.cash), csvNum(e.transfer), csvNum(e.debt),
      csvNum(e.itemsSold), csvNum(e.discounts), csvNum(e.biggestSale), csvNum(Math.round(num(e.share))),
    ]);
    downloadCsv(`sotrudniki_${from || "all"}_${to || "all"}.csv`, [head, ...rows]);
    window.notify?.("Отчёт выгружен в CSV", "success");
  };

  const PRESETS = [
    ["today", "Сегодня"], ["yesterday", "Вчера"], ["week", "7 дней"], ["month", "Месяц"], ["all", "Всё время"],
  ];
  const hasData = num(totals.orders) > 0;

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-16 h-80 w-80 rounded-full bg-violet-700/15 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1500px] px-3 sm:px-6 lg:px-8">
        {/* Заголовок + период */}
        <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold text-blue-400 sm:text-sm">Аналитика</p>
            <h1 className="text-2xl font-black leading-tight tracking-[-0.02em] text-white sm:text-3xl">Сотрудники</h1>
            <p className="mt-1 text-sm font-medium text-slate-400">Кто сколько заработал, чеки, средний чек, наличные и переводы — в одном месте.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={exportCsv} disabled={!hasData} aria-label="Экспорт CSV" title="Экспорт CSV"
              className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
              <span className="hidden sm:inline">Экспорт CSV</span>
            </button>
            <button onClick={load} aria-label="Обновить" title="Обновить"
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
            </button>
          </div>
        </header>

        {/* Период */}
        <div className="mb-5 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
            <div className="no-scrollbar flex flex-1 items-center gap-2 overflow-x-auto">
              {PRESETS.map(([key, label]) => (
                <button key={key} onClick={() => applyPreset(key)}
                  className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-black transition ${preset === key ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setFilterOpen((v) => !v)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition ${filterOpen ? "border-blue-400/40 bg-blue-500/15 text-blue-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              Свой период
            </button>
          </div>
          {filterOpen && (
            <div className="grid gap-3 border-t border-white/10 px-3 py-4 sm:grid-cols-2 sm:px-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">От даты</span>
                <input type="date" value={from} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 font-bold text-white outline-none [color-scheme:dark] focus:border-blue-400/70" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">До даты</span>
                <input type="date" value={to} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 font-bold text-white outline-none [color-scheme:dark] focus:border-blue-400/70" />
              </label>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
            {error}
            <button onClick={load} className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white hover:bg-white/20">Обновить</button>
          </div>
        )}

        {/* KPI */}
        {loading && !data ? (
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => <Skel key={i} className="h-[92px]" />)}
          </div>
        ) : (
          <>
            {/* Герой: выручка + лидер */}
            <div className="mb-4 grid gap-4 rounded-[2rem] border border-blue-400/20 app-aurora bg-white/[0.04] bg-gradient-to-br from-blue-500/[0.10] to-violet-600/[0.05] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wide text-blue-300/80">Выручка за период</p>
                <p className="mt-1 text-3xl font-black leading-none tabular-nums text-white sm:text-4xl xl:text-5xl">{money(totals.revenue)}</p>
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-400">
                  <span><b className="text-white">{num(totals.orders).toLocaleString("ru-RU")}</b> чеков</span>
                  <span className="text-slate-600">·</span>
                  <span>ср. чек <b className="text-white">{money(totals.aov)}</b></span>
                  <span className="text-slate-600">·</span>
                  <span><b className="text-white">{num(totals.activeEmployees)}</b> продавцов</span>
                </p>
                {trend.length >= 2 && (
                  <div className="mt-3 h-10 opacity-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                        <Line type="monotone" dataKey="revenue" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              {leader && (
                <button
                  type="button"
                  onClick={() => { setOpenId(leader.id); if (typeof document !== "undefined") document.getElementById("emp-leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                  className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-4 text-left transition hover:bg-amber-500/[0.1]"
                >
                  <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-amber-300"><Crown size={12} /> Лидер по выручке</p>
                  <div className="mt-2.5 flex items-center gap-3">
                    <Avatar id={leader.id} name={leader.name} size={48} />
                    <div className="min-w-0">
                      <p className="truncate font-black text-white">{leader.name}</p>
                      <p className="text-xs font-bold text-slate-400">{Math.round(num(leader.share))}% выручки команды</p>
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-black tabular-nums text-amber-200">{money(leader.revenue)}</p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-[width] duration-500" style={{ width: `${Math.min(100, num(leader.share))}%` }} /></div>
                </button>
              )}
            </div>

            {/* Вторичные KPI */}
            <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <KpiTile label="Средний чек" value={money(totals.aov)} sub="на чек" tone="emerald" />
              <KpiTile label="Товаров / чек" value={itemsPerOrder.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} sub={`${num(totals.itemsSold).toLocaleString("ru-RU")} шт всего`} tone="blue" />
              <KpiTile label="Чеки" value={num(totals.orders).toLocaleString("ru-RU")} sub="за период" tone="violet" />
              <KpiTile label="Скидки" value={money(totals.discounts)} sub="за период" tone="slate" />
            </div>
          </>
        )}

        {/* Инсайты */}
        {hasData && insights.length > 0 && (
          <div className="mb-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-300"><ins.icon size={18} /></span>
                <span className="text-[13px] font-bold leading-tight text-slate-200">{ins.text}</span>
              </div>
            ))}
          </div>
        )}

        {!hasData && !loading ? (
          <div className="grid place-items-center rounded-3xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-16 text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.06] text-slate-300">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 14l4-4 3 3 5-6" /></svg>
            </span>
            <h3 className="text-lg font-black text-white">За этот период продаж нет</h3>
            <p className="mt-1.5 max-w-sm text-sm text-slate-400">Выберите другой период или проведите первую продажу в кассе — статистика появится здесь.</p>
          </div>
        ) : (
          <div id="emp-leaderboard" className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
            {/* Лидерборд */}
            <ChartCard title="Рейтинг продавцов" subtitle="Нажмите на продавца, чтобы раскрыть детали"
              right={
                <div className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1">
                  {[["revenue", "Выручка"], ["orders", "Чеки"], ["aov", "Средний чек"], ["items", "Товары"]].map(([k, l]) => (
                    <button key={k} onClick={() => setSort(k)}
                      className={`flex min-h-[40px] shrink-0 items-center rounded-lg px-2.5 py-2 text-xs font-black transition ${sort === k ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>{l}</button>
                  ))}
                </div>
              }>
              {loading && !data ? (
                <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-14" />)}</div>
              ) : (
                <div className="space-y-2">
                  {employees.map((e, i) => {
                    const open = openId === e.id;
                    return (
                      <div key={e.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                        <button type="button" onClick={() => setOpenId(open ? null : e.id)} className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-white/[0.03]">
                          <span className="relative shrink-0">
                            <Avatar id={e.id} name={e.name} size={40} />
                            <span className={`absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-[10px] font-black ring-2 ring-[#0b1120] ${i === 0 ? "bg-amber-500 text-slate-950" : i === 1 ? "bg-slate-300 text-slate-950" : i === 2 ? "bg-orange-600 text-white" : "bg-white/15 text-slate-300"}`}>{i + 1}</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="truncate font-black text-white">{e.name}</p>
                              <p className="shrink-0 font-black tabular-nums text-white">{money(e.revenue)}</p>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-400">
                              <span>{e.orders} чек.</span><span className="text-slate-600">·</span>
                              <span>ср. {money(e.aov)}</span><span className="text-slate-600">·</span>
                              <span>{ipo(e).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} тов/чек</span><span className="text-slate-600">·</span>
                              <span className="text-slate-300">{Math.round(num(e.share))}% команды</span>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                              <div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ${i === 0 ? "from-amber-400 to-amber-500" : "from-blue-500 to-violet-500"}`} style={{ width: `${Math.max(3, (num(e.revenue) / maxRevenue) * 100)}%` }} />
                            </div>
                            <div className="mt-1.5"><PaySplitBar cash={e.cash} transfer={e.transfer} debt={e.debt} /></div>
                          </div>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`mt-1 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
                        </button>
                        {open && (
                          <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] p-3 sm:grid-cols-4">
                            <Detail label="Товаров" value={num(e.itemsSold).toLocaleString("ru-RU")} />
                            <Detail label="Товаров / чек" value={ipo(e).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} />
                            <Detail label="Доля выручки" value={`${Math.round(num(e.share))}%`} tone="text-violet-300" />
                            <Detail label="Наличные" value={money(e.cash)} tone="text-emerald-300" />
                            <Detail label="Переводы" value={money(e.transfer)} tone="text-blue-300" />
                            <Detail label="Долг" value={money(e.debt)} tone="text-amber-300" />
                            <Detail label="Скидки" value={money(e.discounts)} />
                            <Detail label="Крупнейший чек" value={money(e.biggestSale)} />
                            <Detail label="Последняя продажа" value={e.lastSaleAt ? new Date(e.lastSaleAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"} className="col-span-2" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ChartCard>

            {/* Графики */}
            <div className="grid gap-5">
              <ChartCard title="Выручка по дням" subtitle="Динамика за период">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                      <XAxis dataKey="label" tick={{ fill: CHART_AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                      <YAxis tick={{ fill: CHART_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, color: "#fff" }} formatter={(v) => money(v)} />
                      <Line type="monotone" dataKey="revenue" name="Выручка" stroke="#60a5fa" strokeWidth={3} dot={trend.length < 2 ? { r: 4, fill: "#60a5fa", stroke: "none" } : false} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="По дням недели" subtitle="Когда выручка выше">
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weekdayData.rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: CHART_AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                      <YAxis tick={{ fill: CHART_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, color: "#fff" }} formatter={(v) => money(v)} />
                      <Bar dataKey="revenue" name="Выручка" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                        {weekdayData.rows.map((r) => <Cell key={r.weekday} fill={weekdayData.max > 0 && r.revenue === weekdayData.max ? "#f59e0b" : "#60a5fa"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="Способы оплаты" subtitle="Доля выручки">
                <div className="flex items-center gap-4">
                  <div className="relative h-[150px] w-[150px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={payData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none" isAnimationActive={false}>
                          {payData.map((p) => <Cell key={p.key} fill={PAY_COLORS[p.key]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, color: "#fff" }} formatter={(v) => money(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    {payTotal > 0 && (
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-sm font-black tabular-nums text-white">{money(payTotal)}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">всего</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {payData.length ? payData.map((p) => (
                      <div key={p.key} className="flex items-center gap-2.5">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: PAY_COLORS[p.key] }} />
                        <span className="flex-1 truncate text-sm font-bold text-slate-300">{p.name}</span>
                        <span className="shrink-0 text-sm font-black tabular-nums text-white">{money(p.value)}</span>
                      </div>
                    )) : <p className="text-sm text-slate-500">Нет данных</p>}
                  </div>
                </div>
              </ChartCard>

              <ChartCard title="Продажи по часам" subtitle="Когда покупают чаще">
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                      <XAxis dataKey="hour" tick={{ fill: CHART_AXIS, fontSize: 10 }} tickLine={false} axisLine={{ stroke: CHART_GRID }} tickFormatter={(h) => `${h}`} />
                      <YAxis tick={{ fill: CHART_AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, color: "#fff" }} formatter={(v) => money(v)} labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`} />
                      <Bar dataKey="revenue" name="Выручка" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                        {hourData.map((h, i) => <Cell key={i} fill="#8b5cf6" fillOpacity={peakHourRevenue > 0 && num(h.revenue) === peakHourRevenue ? 1 : 0.55} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value, tone = "text-white", className = "" }) {
  return (
    <div className={`rounded-xl bg-slate-950/40 px-2.5 py-2 ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-black tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
