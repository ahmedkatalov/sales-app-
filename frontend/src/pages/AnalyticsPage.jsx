import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { get, getCurrentWorkspace, getSession } from "../api";
import { formatMoney, money } from "../utils/format";

const currentMonth = () => new Date().toISOString().slice(0, 7);

const monthLabel = (value) => {
  if (!value) return "";
  const [year, month] = String(value).split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
};

function withDataAccount(url, dataAccountId) {
  const divider = url.includes("?") ? "&" : "?";
  return `${url}${divider}dataAccountId=${encodeURIComponent(dataAccountId)}`;
}

export default function AnalyticsPage() {
  const session = getSession();
  const currentWorkspace = getCurrentWorkspace();
  const isOwner = session?.role === "owner";
  const defaultMonth = currentMonth();

  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceFilter, setWorkspaceFilter] = useState(isOwner ? "current" : "locked");
  const [folders, setFolders] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [folderFilter, setFolderFilter] = useState("all");
  const [periodMode, setPeriodMode] = useState("month");
  const [from, setFrom] = useState(defaultMonth);
  const [to, setTo] = useState(defaultMonth);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Safe array guards
  const safe_workspaces = Array.isArray(workspaces) ? workspaces : [];
  const safe_folders = Array.isArray(folders) ? folders : [];
  const safe_analytics = Array.isArray(analytics) ? analytics : [];

  const isMonthAllowed = (month) => {
    if (periodMode === "all") return true;
    if (periodMode === "month") return month === from;
    if (from && month < from) return false;
    if (to && month > to) return false;
    return true;
  };

  const workspaceTargets = useMemo(() => {
    if (!isOwner) {
      return currentWorkspace?.dataAccountId ? [currentWorkspace] : [];
    }

    if (workspaceFilter === "all") return workspaces;

    if (workspaceFilter === "current") {
      return currentWorkspace?.dataAccountId ? [currentWorkspace] : [];
    }

    const found = safe_workspaces.find((w) => String(w.id) === String(workspaceFilter));
    return found ? [found] : [];
  }, [isOwner, workspaceFilter, workspaces, currentWorkspace]);

  const loadWorkspaces = async () => {
    if (!isOwner) return;

    const ws = await get("/workspaces");
    setWorkspaces(ws || []);
  };

  const loadAnalytics = async () => {
    setLoading(true);
    setError("");

    try {
      if (isOwner && !safe_workspaces.length) {
        const ws = await get("/workspaces");
        setWorkspaces(ws || []);
      }

      const targets =
        isOwner && !safe_workspaces.length
          ? workspaceFilter === "all"
            ? await get("/workspaces")
            : workspaceTargets
          : workspaceTargets;

      const safeTargets = targets || [];

      const allFoldersForSelect = [];
      const monthMap = {};

      for (const ws of safeTargets) {
        const dataAccountId = ws.dataAccountId;
        if (!dataAccountId) continue;

        const folderList = await get(withDataAccount("/folders", dataAccountId));
        const safeFolders = (Array.isArray(folderList) ? folderList : []).map((f) => ({
          ...f,
          workspaceId: ws.id,
          workspaceName: ws.name,
          dataAccountId,
          filterKey: `${dataAccountId}:${f.id}`,
        }));

        allFoldersForSelect.push(...safeFolders);

        const filteredFolders =
          folderFilter === "all"
            ? safeFolders
            : safeFolders.filter((f) => f.filterKey === folderFilter);

        for (const folder of filteredFolders) {
          const months = await get(withDataAccount(`/months/${folder.id}`, dataAccountId));

          for (const month of months || []) {
            if (!isMonthAllowed(month.month)) continue;

            const [items, expenses] = await Promise.all([
              get(withDataAccount(`/items/${month.id}`, dataAccountId)),
              get(withDataAccount(`/expenses/${folder.id}/${month.id}`, dataAccountId)),
            ]);

            const safeItems = items || [];
            const safeExpenses = expenses || [];

            const qty = safeItems.reduce((s, i) => s + money(i.qty), 0);
            const revenue = safeItems.reduce((s, i) => s + money(i.price) * money(i.qty), 0);
            const cleanProfit = safeItems.reduce(
              (s, i) => s + (money(i.price) - money(i.cost)) * money(i.qty),
              0
            );
            const totalExpenses = safeExpenses.reduce((s, e) => s + money(e.amount), 0);
            const purchaseTotal = safeItems.reduce((s, i) => s + money(i.cost) * money(i.qty), 0);
            const salePriceTotal = safeItems.reduce((s, i) => s + money(i.price) * money(i.qty), 0);

            const key = `${month.month}`;

            if (!monthMap[key]) {
              monthMap[key] = {
                month: month.month,
                label: monthLabel(month.month),
                qty: 0,
                revenue: 0,
                cleanProfit: 0,
                totalExpenses: 0,
                revenueAfterExpenses: 0,
                afterExpenses: 0,
                purchaseTotal: 0,
                salePriceTotal: 0,
                salePriceChange: 0,
                marginChange: 0,
                items: [],
                expenses: [],
              };
            }

            monthMap[key].qty += qty;
            monthMap[key].revenue += revenue;
            monthMap[key].cleanProfit += cleanProfit;
            monthMap[key].totalExpenses += totalExpenses;
            monthMap[key].revenueAfterExpenses += revenue - totalExpenses;
            monthMap[key].afterExpenses += cleanProfit - totalExpenses;
            monthMap[key].purchaseTotal += purchaseTotal;
            monthMap[key].salePriceTotal += salePriceTotal;
            monthMap[key].items.push(
              ...safeItems.map((i) => ({
                ...i,
                folderId: folder.id,
                folderName: folder.name,
                workspaceName: ws.name,
                month: month.month,
              }))
            );
            monthMap[key].expenses.push(
              ...safeExpenses.map((e) => ({
                ...e,
                folderId: folder.id,
                folderName: folder.name,
                workspaceName: ws.name,
                month: month.month,
              }))
            );
          }
        }
      }

      setFolders(allFoldersForSelect);

      const sorted = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
      setAnalytics(sorted);
    } catch (e) {
      setError(e.message || "Ошибка загрузки аналитики");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaces().catch((e) => setError(e.message)); // eslint-disable-line react-hooks/set-state-in-effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceFilter, folderFilter, periodMode, from, to, safe_workspaces.length]);

  const totals = useMemo(
    () =>
      safe_analytics.reduce(
        (a, m) => ({
          qty: a.qty + money(m.qty),
          revenue: a.revenue + money(m.revenue),
          cleanProfit: a.cleanProfit + money(m.cleanProfit),
          totalExpenses: a.totalExpenses + money(m.totalExpenses),
          revenueAfterExpenses: a.revenueAfterExpenses + money(m.revenueAfterExpenses),
          afterExpenses: a.afterExpenses + money(m.afterExpenses),
          purchaseTotal: a.purchaseTotal + money(m.purchaseTotal),
          salePriceTotal: a.salePriceTotal + money(m.salePriceTotal),
          salePriceChange: a.salePriceChange + money(m.salePriceChange),
          marginChange: a.marginChange + money(m.marginChange),
        }),
        {
          qty: 0,
          revenue: 0,
          cleanProfit: 0,
          totalExpenses: 0,
          revenueAfterExpenses: 0,
          afterExpenses: 0,
          purchaseTotal: 0,
          salePriceTotal: 0,
          salePriceChange: 0,
          marginChange: 0,
        }
      ),
    [analytics]
  );

  const periodLabel = useMemo(() => {
    if (periodMode === "all") return "За всё время";
    if (periodMode === "month") return monthLabel(from);
    if (from && to) return `${monthLabel(from)} — ${monthLabel(to)}`;
    if (from) return `С ${monthLabel(from)}`;
    if (to) return `До ${monthLabel(to)}`;
    return "Выбранный период";
  }, [periodMode, from, to]);

  const workspaceLabel = useMemo(() => {
    if (!isOwner) return currentWorkspace?.name || "Текущая точка";
    if (workspaceFilter === "all") return "Все точки";
    if (workspaceFilter === "current") return currentWorkspace?.name || "Текущая точка";
    return safe_workspaces.find((w) => String(w.id) === String(workspaceFilter))?.name || "Точка";
  }, [isOwner, workspaceFilter, workspaces, currentWorkspace]);

  const productNames = useMemo(
    () =>
      [...new Set(analytics.flatMap((m) => m.items || []).map((i) => i.name).filter(Boolean))].sort(),
    [analytics]
  );

  const productAnalytics = useMemo(() => {
    if (!selectedProduct) return [];

    return safe_analytics.map((m) => {
      const list = (m.items || []).filter((i) => i.name === selectedProduct);
      const last = list[list.length - 1];

      return {
        month: m.month,
        cost: last ? money(last.cost) : 0,
        price: last ? money(last.price) : 0,
        qty: list.reduce((s, i) => s + money(i.qty), 0),
        profit: list.reduce((s, i) => s + (money(i.price) - money(i.cost)) * money(i.qty), 0),
      };
    });
  }, [analytics, selectedProduct]);

  const topProducts = useMemo(() => {
    const map = {};

    safe_analytics.forEach((m) => {
      (m.items || []).forEach((item) => {
        const name = item.name || "Без названия";
        if (!map[name]) {
          map[name] = { name, qty: 0, revenue: 0, profit: 0 };
        }
        map[name].qty += money(item.qty);
        map[name].revenue += money(item.price) * money(item.qty);
        map[name].profit += (money(item.price) - money(item.cost)) * money(item.qty);
      });
    });

    return Object.values(map)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [analytics]);

  const statCards = [
    { title: "Общая выручка", value: formatMoney(totals.revenue), icon: "₽", tone: "from-blue-600/25 to-blue-950/10", text: "text-blue-200" },
    { title: "Чистая прибыль", value: formatMoney(totals.cleanProfit), icon: "↗", tone: "from-emerald-500/25 to-emerald-950/10", text: "text-emerald-200" },
    { title: "Все расходы", value: formatMoney(totals.totalExpenses), icon: "↘", tone: "from-red-500/25 to-red-950/10", text: "text-red-200" },
    { title: "Выручка после расходов", value: formatMoney(totals.revenueAfterExpenses), icon: "◆", tone: "from-violet-500/25 to-violet-950/10", text: "text-violet-200" },
    { title: "Прибыль после расходов", value: formatMoney(totals.afterExpenses), icon: "✓", tone: "from-cyan-500/25 to-cyan-950/10", text: "text-cyan-200" },
  ];

  const extraCards = [
    { title: "Кол-во продаж", value: totals.qty, icon: "#", tone: "from-slate-500/20 to-slate-950/10", text: "text-slate-200" },
    { title: "Сумма закупа", value: formatMoney(totals.purchaseTotal), icon: "⌁", tone: "from-orange-500/25 to-orange-950/10", text: "text-orange-200" },
    { title: "Сумма продажных цен", value: formatMoney(totals.salePriceTotal), icon: "◈", tone: "from-blue-500/25 to-blue-950/10", text: "text-blue-200" },
    { title: "Изменение цены продажи", value: formatMoney(totals.salePriceChange), icon: "⇄", tone: "from-indigo-500/25 to-indigo-950/10", text: "text-indigo-200" },
    { title: "Изменение маржи", value: formatMoney(totals.marginChange), icon: "%", tone: "from-emerald-500/25 to-emerald-950/10", text: "text-emerald-200" },
  ];

  const StatBox = ({ card }) => (
    <div className={`relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-gradient-to-br ${card.tone} p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] sm:p-5`}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{card.title}</p>
          <p className="mt-3 text-2xl font-black text-white sm:text-3xl">{card.value}</p>
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-xl font-black ${card.text}`}>{card.icon}</div>
      </div>
    </div>
  );

  const DarkChartCard = ({ title, subtitle, children }) => (
    <div className="rounded-[1.7rem] border border-white/10 bg-slate-950/55 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur sm:p-5">
      <div className="mb-4">
        <h3 className="text-xl font-black text-white sm:text-2xl">{title}</h3>
        {subtitle && <p className="mt-1 text-sm font-bold text-slate-400">{subtitle}</p>}
      </div>
      <div className="h-[280px] min-w-0 sm:h-[320px]">{children}</div>
    </div>
  );

  const chartGridColor = "rgba(148, 163, 184, 0.16)";
  const chartAxisColor = "#94a3b8";

  return (
    <div className="relative -m-4 bg-[#050b1f] px-4 py-5 text-white sm:-m-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute left-1/4 top-0 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-20 h-96 w-96 rounded-full bg-violet-700/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1500px] pb-nav sm:pb-16">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.9)]" />
              Глобальный отчёт
            </div>
            <h2 className="mt-4 text-4xl font-black leading-none text-white sm:text-6xl">Аналитика</h2>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-400 sm:text-base">
              Смотри текущую точку, все филиалы или конкретный филиал. Графики, прибыль, расходы и детализация в одном месте.
            </p>
          </div>

          <button
            onClick={loadAnalytics}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white shadow-[0_16px_40px_rgba(0,0,0,0.25)] transition hover:bg-white/15 sm:w-auto"
          >
            <span className={loading ? "animate-spin" : "transition group-hover:rotate-180"}>⟳</span>
            {loading ? "Загрузка..." : "Обновить"}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-3xl border border-red-400/20 bg-red-500/10 px-4 py-3 font-bold text-red-200">
            {error}
          </div>
        )}

        <div className="mb-5 rounded-[1.8rem] border border-white/10 bg-white/[0.06] shadow-[0_18px_60px_rgba(0,0,0,0.25)] backdrop-blur overflow-hidden">
          {/* Компактная шапка — всегда видна */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {[
                ["month", "Этот месяц", () => { const m = currentMonth(); setPeriodMode("month"); setFrom(m); setTo(m); }],
                ["all",   "Всё время",  () => { setPeriodMode("all"); }],
              ].map(([key, label, action]) => {
                const active = key === "month" ? periodMode === "month" && from === defaultMonth : periodMode === "all";
                return (
                  <button key={key} type="button" onClick={action}
                    className={active
                      ? "rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-lg"
                      : "rounded-xl border border-white/10 bg-white/8 px-4 py-2 text-sm font-black text-slate-300 transition hover:bg-white/15"}>
                    {label}
                  </button>
                );
              })}
              <span className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm font-black text-blue-200">
                {workspaceLabel} · {periodLabel}
              </span>
            </div>
            <button type="button" onClick={() => setFilterOpen((v) => !v)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-black transition ${
                filterOpen ? "border-blue-400/40 bg-blue-500/15 text-blue-200" : "border-white/10 bg-white/8 text-slate-300 hover:bg-white/15"
              }`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              Фильтр
              {(folderFilter !== "all" || workspaceFilter !== "current" || periodMode !== "month") && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-black text-white">!</span>
              )}
            </button>
          </div>

          {/* Расширенный фильтр */}
          {filterOpen && (
            <div className="border-t border-white/10 px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {isOwner && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Точка / филиал</span>
                    <select value={workspaceFilter} onChange={(e) => { setWorkspaceFilter(e.target.value); setFolderFilter("all"); }}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400">
                      <option value="current">Текущая точка</option>
                      <option value="all">Все точки</option>
                      {safe_workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Папка</span>
                  <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400">
                    <option value="all">Все папки</option>
                    {safe_folders.map((f) => (
                      <option key={f.filterKey} value={f.filterKey}>
                        {isOwner && workspaceFilter === "all" ? `${f.workspaceName} / ${f.name}` : f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Период</span>
                  <select value={periodMode} onChange={(e) => setPeriodMode(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400">
                    <option value="month">Месяц</option>
                    <option value="range">Диапазон</option>
                    <option value="all">Всё время</option>
                  </select>
                </label>
                {periodMode !== "all" && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">
                      {periodMode === "month" ? "Месяц" : "От месяца"}
                    </span>
                    <input type="month" value={from} onChange={(e) => setFrom(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400"/>
                  </label>
                )}
                {periodMode === "range" && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">До месяца</span>
                    <input type="month" value={to} onChange={(e) => setTo(e.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400"/>
                  </label>
                )}
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button"
                  onClick={() => { const m = currentMonth(); setFolderFilter("all"); setPeriodMode("month"); setFrom(m); setTo(m); setSelectedProduct(""); setFilterOpen(false); }}
                  className="rounded-xl bg-white px-5 py-2.5 text-sm font-black text-slate-950 transition hover:bg-blue-50">
                  Сбросить
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {statCards.map((card) => <StatBox key={card.title} card={card} />)}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {extraCards.map((card) => <StatBox key={card.title} card={card} />)}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
          <DarkChartCard title="Динамика по месяцам" subtitle="Выручка, прибыль и расходы по выбранному периоду">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="month" tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                <YAxis tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, color: "#fff" }} />
                <Legend wrapperStyle={{ color: chartAxisColor }} />
                <Line type="monotone" dataKey="revenue" name="Выручка" stroke="#3b82f6" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="cleanProfit" name="Чистая прибыль" stroke="#10b981" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="totalExpenses" name="Расходы" stroke="#ef4444" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="afterExpenses" name="После расходов" stroke="#8b5cf6" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </DarkChartCard>

          <DarkChartCard title="ТОП товаров по выручке" subtitle="Самые сильные позиции по продажам">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="name" tick={{ fill: chartAxisColor, fontSize: 11 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                <YAxis tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, color: "#fff" }} />
                <Legend wrapperStyle={{ color: chartAxisColor }} />
                <Bar dataKey="revenue" name="Выручка" fill="#3b82f6" radius={[10, 10, 0, 0]} />
                <Bar dataKey="profit" name="Прибыль" fill="#10b981" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </DarkChartCard>
        </div>

        <div className="mb-5 rounded-[1.8rem] border border-white/10 bg-white/[0.06] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.25)] backdrop-blur sm:p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-2xl font-black text-white">Аналитика конкретного товара</h3>
              <p className="mt-1 text-sm font-bold text-slate-400">Цена, себестоимость, продажи и прибыль товара</p>
            </div>

            <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400 lg:w-80">
              <option value="">Выбери товар</option>
              {productNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {selectedProduct ? (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <DarkChartCard title="Цена и себестоимость">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={productAnalytics} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis dataKey="month" tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                    <YAxis tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, color: "#fff" }} />
                    <Legend wrapperStyle={{ color: chartAxisColor }} />
                    <Line type="monotone" dataKey="price" name="Цена" stroke="#3b82f6" strokeWidth={3} dot={false} />
                    <Line type="monotone" dataKey="cost" name="Себестоимость" stroke="#f59e0b" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </DarkChartCard>

              <DarkChartCard title="Продажи и прибыль">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={productAnalytics} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis dataKey="month" tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                    <YAxis tick={{ fill: chartAxisColor, fontSize: 12 }} axisLine={{ stroke: chartGridColor }} tickLine={false} />
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, color: "#fff" }} />
                    <Legend wrapperStyle={{ color: chartAxisColor }} />
                    <Bar dataKey="qty" name="Кол-во" fill="#8b5cf6" radius={[10, 10, 0, 0]} />
                    <Bar dataKey="profit" name="Прибыль" fill="#10b981" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </DarkChartCard>
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-slate-950/50 p-10 text-center font-bold text-slate-400">
              Выбери товар для графика.
            </div>
          )}
        </div>

        <div className="mb-2 overflow-hidden rounded-[1.8rem] border border-white/10 bg-white/[0.06] shadow-[0_18px_60px_rgba(0,0,0,0.25)] backdrop-blur">
          <div className="border-b border-white/10 px-5 py-4 sm:px-6">
            <h3 className="text-2xl font-black text-white">Детализация по месяцам</h3>
            <p className="mt-1 text-sm font-bold text-slate-400">Подробная таблица отчёта</p>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1150px] text-sm">
              <thead className="sticky top-0 bg-slate-950/95 text-slate-300 backdrop-blur">
                <tr>
                  {[
                    "Месяц",
                    "Кол-во",
                    "Выручка",
                    "Чистая прибыль",
                    "Расходы",
                    "Выручка после расходов",
                    "Чистая прибыль после расходов",
                    "Сумма закупа",
                    "Сумма продажных цен",
                  ].map((h) => (
                    <th key={h} className="border-b border-white/10 p-4 text-center text-xs font-black uppercase tracking-wide first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {safe_analytics.map((m) => (
                  <tr key={m.month} className="border-t border-white/10 transition hover:bg-white/[0.04]">
                    <td className="p-4 font-black text-white">{m.month}</td>
                    <td className="p-4 text-center font-bold text-slate-200">{m.qty}</td>
                    {[m.revenue, m.cleanProfit, m.totalExpenses, m.revenueAfterExpenses, m.afterExpenses, m.purchaseTotal, m.salePriceTotal].map((v, i) => (
                      <td key={i} className="p-4 text-center font-bold text-slate-200">{formatMoney(v)}</td>
                    ))}
                  </tr>
                ))}

                {safe_analytics.length === 0 && (
                  <tr>
                    <td colSpan="9" className="p-10 text-center font-bold text-slate-400">Данных пока нет.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-white/10 md:hidden">
            {safe_analytics.map((m) => (
              <div key={m.month} className="p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-white">{m.label || m.month}</p>
                    <p className="text-sm font-bold text-slate-400">Кол-во: {m.qty}</p>
                  </div>
                  <p className="text-lg font-black text-emerald-300">{formatMoney(m.afterExpenses)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3"><p className="text-slate-400">Выручка</p><b className="text-white">{formatMoney(m.revenue)}</b></div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3"><p className="text-slate-400">Расходы</p><b className="text-red-200">{formatMoney(m.totalExpenses)}</b></div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3"><p className="text-slate-400">Закуп</p><b className="text-white">{formatMoney(m.purchaseTotal)}</b></div>
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3"><p className="text-slate-400">Чистая прибыль</p><b className="text-emerald-300">{formatMoney(m.cleanProfit)}</b></div>
                </div>
              </div>
            ))}

            {safe_analytics.length === 0 && <div className="p-10 text-center font-bold text-slate-400">Данных пока нет.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
