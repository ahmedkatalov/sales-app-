import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { get } from "../api";
import { formatMoney, localISO } from "../utils/format";

const num = (v) => Number(v || 0);
const money = (v) => formatMoney(num(v));
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEKDAYS_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

const monthBounds = () => {
  const d = new Date();
  return [localISO(new Date(d.getFullYear(), d.getMonth(), 1)), localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
};
const daysAgo = (n) => localISO(new Date(Date.now() - n * 86400000));

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
  const [mStart, mEnd] = useMemo(monthBounds, []);
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
    const today = localISO();
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

  const totals = data?.totals || {};
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
    if (num(peak.revenue) > 0) out.push({ icon: "⏰", text: `Пик продаж: ${String(peak.hour).padStart(2, "0")}:00–${String((peak.hour + 1) % 24).padStart(2, "0")}:00` });
    const wd = data.byWeekday || [];
    const bestWd = wd.reduce((m, w) => (num(w.revenue) > num(m.revenue) ? w : m), { revenue: 0, weekday: 0 });
    if (num(bestWd.revenue) > 0) out.push({ icon: "📅", text: `Лучший день недели — ${WEEKDAYS_FULL[bestWd.weekday]}` });
    if (employees[0] && num(employees[0].revenue) > 0) out.push({ icon: "🏆", text: `Лидер — ${employees[0].name}: ${Math.round(num(employees[0].share))}% выручки` });
    const c = num(totals.cash), tr = num(totals.transfer), tot = c + tr || 1;
    out.push({ icon: "💳", text: `Наличные ${Math.round((c / tot) * 100)}% · переводы ${Math.round((tr / tot) * 100)}%` });
    return out;
  }, [data, employees, totals]);

  const trend = (data?.trend || []).map((d) => ({ ...d, label: d.date?.slice(5) }));
  const hourData = (data?.byHour || []).filter((h) => num(h.revenue) > 0);
  const payData = [
    { name: "Наличные", value: num(totals.cash), key: "cash" },
    { name: "Переводы", value: num(totals.transfer), key: "transfer" },
    { name: "Долг", value: num(totals.debt), key: "debt" },
  ].filter((p) => p.value > 0);

  const exportCsv = () => {
    const head = ["Продавец", "Выручка", "Чеки", "Средний чек", "Наличные", "Переводы", "Долг", "Товаров", "Скидки", "Крупнейший чек", "Доля %"];
    const rows = employees.map((e) => [e.name, num(e.revenue), e.orders, Math.round(num(e.aov)), num(e.cash), num(e.transfer), num(e.debt), num(e.itemsSold), num(e.discounts), num(e.biggestSale), Math.round(num(e.share))]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sotrudniki_${from || "all"}_${to || "all"}.csv`; a.click();
    URL.revokeObjectURL(url);
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

      <div className="relative mx-auto w-full max-w-[1500px]">
        {/* Заголовок + период */}
        <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold text-blue-400 sm:text-sm">Аналитика</p>
            <h1 className="text-2xl font-black leading-tight tracking-[-0.02em] text-white sm:text-4xl">Сотрудники</h1>
            <p className="mt-1 text-sm font-medium text-slate-400">Кто сколько заработал, чеки, средний чек, наличные и переводы — в одном месте.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={exportCsv} disabled={!hasData}
              className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
              <span className="hidden sm:inline">Экспорт CSV</span>
            </button>
            <button onClick={load} aria-label="Обновить"
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
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => <Skel key={i} className="h-[92px]" />)}
          </div>
        ) : (
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiTile label="Выручка" value={money(totals.revenue)} sub="за период" tone="blue" />
            <KpiTile label="Чеки" value={num(totals.orders).toLocaleString("ru-RU")} sub={`${num(totals.activeEmployees)} продавцов`} tone="violet" />
            <KpiTile label="Средний чек" value={money(totals.aov)} sub="на один чек" tone="emerald" />
            <KpiTile label="Товаров продано" value={num(totals.itemsSold).toLocaleString("ru-RU")} sub="штук" tone="amber" />
            <KpiTile label="Скидки" value={money(totals.discounts)} sub={`нал. ${money(totals.cash)} · пер. ${money(totals.transfer)}`} tone="slate" className="col-span-2 md:col-span-1" />
          </div>
        )}

        {/* Инсайты */}
        {hasData && insights.length > 0 && (
          <div className="mb-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-base">{ins.icon}</span>
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
          <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
            {/* Лидерборд */}
            <ChartCard title="Рейтинг продавцов" subtitle="Нажмите на продавца, чтобы раскрыть детали"
              right={
                <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1">
                  {[["revenue", "Выручка"], ["orders", "Чеки"], ["aov", "Ср. чек"], ["items", "Товары"]].map(([k, l]) => (
                    <button key={k} onClick={() => setSort(k)}
                      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-black transition ${sort === k ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>{l}</button>
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
                        <button type="button" onClick={() => setOpenId(open ? null : e.id)} className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-white/[0.03]">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black ${i === 0 ? "bg-amber-500/20 text-amber-300" : i === 1 ? "bg-slate-400/20 text-slate-200" : i === 2 ? "bg-orange-700/25 text-orange-300" : "bg-white/[0.06] text-slate-400"}`}>{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="truncate font-black text-white">{e.name}</p>
                              <p className="shrink-0 font-black tabular-nums text-white">{money(e.revenue)}</p>
                            </div>
                            <div className="mt-1.5"><PaySplitBar cash={e.cash} transfer={e.transfer} debt={e.debt} /></div>
                            <div className="mt-1.5 flex items-center justify-between gap-3 text-[12px] font-semibold text-slate-400">
                              <span>{e.orders} чек. · ср. {money(e.aov)}</span>
                              <span className="text-slate-500">{Math.round(num(e.share))}%</span>
                            </div>
                          </div>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
                        </button>
                        {open && (
                          <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] p-3 sm:grid-cols-4">
                            <Detail label="Товаров" value={num(e.itemsSold).toLocaleString("ru-RU")} />
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
                      <Line type="monotone" dataKey="revenue" name="Выручка" stroke="#60a5fa" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard title="Способы оплаты" subtitle="Доля выручки">
                <div className="flex items-center gap-4">
                  <div className="h-[150px] w-[150px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={payData} dataKey="value" nameKey="name" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none">
                          {payData.map((p) => <Cell key={p.key} fill={PAY_COLORS[p.key]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, color: "#fff" }} formatter={(v) => money(v)} />
                      </PieChart>
                    </ResponsiveContainer>
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
                      <Bar dataKey="revenue" name="Выручка" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
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
