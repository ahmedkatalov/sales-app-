import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, Building2, CalendarDays, ChevronDown, FolderOpen, Layers3, Loader2, Package, RefreshCw, SlidersHorizontal, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { get, getCurrentWorkspace, getSession } from "../api";
import { AnalyticsExpenses, AnalyticsProductCharts, AnalyticsRanking, AnalyticsResult, AnalyticsTrend } from "../components/AnalyticsCharts";
import { aggregateAnalytics, analyticsMonth, analyticsNumber, analyticsPercent, analyticsPeriodError, analyticsPeriodLabel, analyticsPresets, analyticsQuantity, fetchAnalyticsReport } from "../utils/analytics";
import { formatMoney } from "../utils/format";
import "./AnalyticsPage.css";

const EMPTY = [];
function AnalyticsEmpty({ loading, error }) {
  return <div className="anl-empty" role={loading ? "status" : undefined}>{loading ? <Loader2 size={30} className="animate-spin" /> : error ? <AlertTriangle size={30} /> : <BarChart3 size={30} />}<h2>{loading ? "Собираем аналитику" : error ? "Отчёт пока недоступен" : "В этом периоде нет записей"}</h2><p>{loading ? "Сводим товары и расходы выбранных папок и точек." : error ? "Повторите загрузку или выберите другую точку и период." : "Выберите другие месяцы или папку. Данные появятся после заполнения месячного учёта."}</p></div>;
}
function AnalyticsWorkspaces({ targets, rows, onSelect }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.revenue)));
  return <section className="anl-panel anl-workspaces bg-white/[0.02] shadow-sm" aria-label="Сравнение точек"><div className="anl-section-heading"><div><p className="anl-eyebrow">Вся сеть</p><h2>Вклад каждой точки</h2></div><Building2 size={20} /></div><div>{targets.map((target) => { const row = rows.find((row) => String(row.id) === String(target.dataAccountId)); return <button type="button" key={target.dataAccountId} onClick={() => onSelect(String(target.id))} aria-label={`Показать точку: ${target.name}`}><span><strong>{target.name}</strong><small>{row ? `${analyticsQuantity(row.qty)} шт. · итог ${formatMoney(row.net)} ₽` : "Нет записей за период"}</small><span className="anl-rank-track"><i style={{ width: `${row ? Math.abs(row.revenue) / max * 100 : 0}%` }} /></span></span><b>{row ? `${formatMoney(row.revenue)} ₽` : "—"}</b><ArrowRight size={15} /></button>; })}</div></section>;
}
function AnalyticsMonths({ rows, records }) {
  const [open, setOpen] = useState(null);
  const [order, setOrder] = useState("newest");
  const sorted = order === "newest" ? [...rows].reverse() : rows;
  return <section className="anl-panel anl-months bg-white/[0.02] shadow-sm" aria-label="Детализация по месяцам"><div className="anl-section-heading"><div><p className="anl-eyebrow">Цифры под контролем</p><h2>Отчёт по месяцам</h2><p>Откройте месяц для расчёта и разбивки по папкам.</p></div><select aria-label="Порядок месяцев" value={order} onChange={(event) => setOrder(event.target.value)}><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option></select></div><div className="anl-month-columns" aria-hidden="true"><span>Месяц</span><span>Количество</span><span>Выручка</span><span>Расходы</span><span>После расходов</span></div><div>{sorted.map((row) => <article key={row.month}><button type="button" className="anl-month-row" aria-label={`Месяц: ${analyticsMonth(row.month)}`} aria-expanded={open === row.month} aria-controls={`analytics-month-${row.month}`} disabled={!row.hasData} onClick={() => setOpen(open === row.month ? null : row.month)}><strong>{analyticsMonth(row.month)}{!row.hasData && <small>Нет записей</small>}</strong><span><small>Количество</small>{row.hasData ? `${analyticsQuantity(row.qty)} шт.` : "—"}</span><span><small>Выручка</small>{row.hasData ? `${formatMoney(row.revenue)} ₽` : "—"}</span><span><small>Расходы</small>{row.hasData ? `${formatMoney(row.expenses)} ₽` : "—"}</span><span className={row.net < 0 ? "anl-negative" : row.hasData ? "anl-positive" : ""}><small>После расходов</small>{row.hasData ? `${formatMoney(row.net)} ₽` : "—"}</span><ChevronDown size={15} /></button>{open === row.month && row.hasData && <div className="anl-month-detail" id={`analytics-month-${row.month}`}><p className="anl-note">Количество за месяц: {analyticsQuantity(row.qty)} шт.</p><dl>{[["Себестоимость проданного", row.cost], ["Прибыль до расходов", row.gross], ["Выручка − расходы", row.revenueAfterExpenses], ["Продажи по прайсу", row.revenue]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatMoney(value)} ₽</dd></div>)}<div><dt>Итог в доле выручки</dt><dd>{row.margin == null ? "—" : `${analyticsPercent(row.margin)}%`}</dd></div></dl><h3>Папки за месяц</h3>{records.filter((record) => record.month === row.month).map((record) => { const revenue = record.items.reduce((sum, item) => sum + analyticsNumber(item.price) * analyticsNumber(item.qty), 0), cost = record.items.reduce((sum, item) => sum + analyticsNumber(item.cost) * analyticsNumber(item.qty), 0), expenses = record.expenses.reduce((sum, expense) => sum + analyticsNumber(expense.amount), 0); return <div className="anl-folder-result" key={`${record.dataAccountId}:${record.monthId}`}><span><strong>{record.folderName}</strong><small>{record.workspaceName}</small></span><span>Выручка <b>{formatMoney(revenue)} ₽</b></span><span>Итог <b className={revenue - cost - expenses < 0 ? "anl-negative" : "anl-positive"}>{formatMoney(revenue - cost - expenses)} ₽</b></span></div>; })}</div>}</article>)}</div></section>;
}

export default function AnalyticsPage({ initialWorkspace, roleOverride }) {
  const session = getSession();
  const workspace = initialWorkspace || getCurrentWorkspace();
  const isOwner = (roleOverride || session?.role) === "owner";
  const dataAccountId = workspace?.dataAccountId || session?.dataAccountId;
  const workspaceId = workspace?.id || session?.workspaceId || "current";
  const workspaceName = workspace?.name || "Текущая точка";
  const current = useMemo(() => ({ id: workspaceId, dataAccountId, name: workspaceName }), [workspaceId, dataAccountId, workspaceName]);
  const [presets] = useState(() => analyticsPresets());
  const [filters, setFilters] = useState(() => ({ workspace: "current", folder: "all", from: presets[0].from, to: presets[0].to }));
  const [draft, setDraft] = useState(() => ({ from: filters.from, to: filters.to }));
  const [periodOpen, setPeriodOpen] = useState(false);
  const [view, setView] = useState("overview");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [catalog, setCatalog] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(null);
  const [, setContextVersion] = useState(0);
  const seqRef = useRef(0), viewRef = useRef(null);
  const contextKey = JSON.stringify([isOwner, workspaceId, dataAccountId]);
  const scopeKey = `${contextKey}|${filters.workspace}`;
  const key = JSON.stringify([contextKey, filters]);
  const available = snapshot?.key === key;
  const report = available ? snapshot.report : null;
  const records = available ? snapshot.records : EMPTY;
  const error = failure?.key === key ? failure.message : "";
  const workspaces = catalog?.contextKey === contextKey ? catalog.workspaces : EMPTY;
  const folders = catalog?.scopeKey === scopeKey ? catalog.folders : EMPTY;
  const product = report?.products.find((row) => row.name === selectedProduct)?.name || report?.products[0]?.name || "";
  const scopeLabel = !isOwner || filters.workspace === "current" ? workspaceName : filters.workspace === "all" ? "Все точки" : workspaces.find((row) => String(row.id) === filters.workspace)?.name || "Выбранная точка";
  const selectedFolder = folders.find((row) => row.filterKey === filters.folder);
  const folderLabel = filters.folder === "all" ? "Все папки" : selectedFolder ? `${filters.workspace === "all" ? `${selectedFolder.workspaceName} / ` : ""}${selectedFolder.name}` : "Выбранная папка";
  const draftError = analyticsPeriodError(draft);
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true); setFailure(null);
    const isStale = () => seq !== seqRef.current;
    try {
      const result = await fetchAnalyticsReport(get, { isOwner, current, workspaceFilter: filters.workspace, folderFilter: filters.folder, period: filters, isStale, onCatalog: (next) => { if (!isStale()) setCatalog({ ...next, contextKey, scopeKey }); } });
      if (!result || isStale()) return;
      setSnapshot({ key, ...result, report: aggregateAnalytics(result.records, filters) });
    } catch (error) { if (!isStale()) setFailure({ key, message: error.message || "Не удалось загрузить аналитику" }); }
    finally { if (!isStale()) setLoading(false); }
  }, [current, filters, isOwner, key, contextKey, scopeKey]);
  useEffect(() => {
    load();
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      // Invalidate manual refreshes and stop queued reads when filters change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seqRef.current++;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
  useEffect(() => {
    const onWorkspace = () => { setContextVersion((old) => old + 1); setFilters((old) => ({ ...old, workspace: "current", folder: "all" })); };
    window.addEventListener("sales-workspace-change", onWorkspace);
    return () => window.removeEventListener("sales-workspace-change", onWorkspace);
  }, []);
  const choosePeriod = (period) => { setFilters((old) => ({ ...old, from: period.from, to: period.to })); setPeriodOpen(false); };
  const chooseWorkspace = (value) => setFilters((old) => ({ ...old, workspace: value, folder: "all" }));
  const resetFilters = () => { setFilters({ workspace: "current", folder: "all", from: presets[0].from, to: presets[0].to }); setSelectedProduct(""); setPeriodOpen(false); setView("overview"); };
  const chooseProduct = (name) => { setSelectedProduct(name); setView("products"); viewRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); };
  const setDraftField = (field, value) => setDraft((old) => ({ ...old, [field]: value }));
  const totals = report?.totals;
  const cards = [
    { title: "Выручка", value: totals?.revenue, sub: "Цена × количество", Icon: Wallet, accent: true },
    { title: "До расходов", value: totals?.gross, sub: "Выручка − себестоимость", Icon: TrendingUp },
    { title: "Расходы", value: totals?.expenses, sub: "Из выбранных папок", Icon: TrendingDown },
    { title: "После расходов", value: totals?.net, sub: "Результат месячного учёта", Icon: BarChart3, tone: totals?.net < 0 ? "negative" : "positive" },
  ];
  return (
    <div className="analytics-page pb-nav sm:pb-10">
      <header className="anl-page-heading"><div><p className="anl-eyebrow">Бизнес / управленческий отчёт</p><h1>Аналитика</h1><p>Понимайте, откуда приходит прибыль и на что уходят деньги.</p><span className="anl-context"><Building2 size={13} />{scopeLabel}<i />{folderLabel}</span></div><button type="button" className="anl-button" onClick={load} disabled={loading} aria-label="Обновить аналитику"><RefreshCw size={16} className={loading ? "animate-spin" : ""} />{loading ? "Обновляем…" : "Обновить"}</button></header>
      <section className="anl-panel anl-filters bg-white/[0.02]" aria-label="Фильтры аналитики">
        <div className="anl-period-toolbar"><div role="group" aria-label="Быстрый выбор периода аналитики">{presets.map((preset) => <button type="button" key={preset.id} aria-pressed={filters.from === preset.from && filters.to === preset.to} onClick={() => choosePeriod(preset)}>{preset.label}</button>)}</div><button type="button" className="anl-date-button" aria-expanded={periodOpen} aria-controls="analytics-period-form" onClick={() => { setDraft({ from: filters.from, to: filters.to }); setPeriodOpen((old) => !old); }}><CalendarDays size={16} />Свой период<ChevronDown size={14} /></button></div>
        <div className="anl-scope-filters">{isOwner ? <label><Building2 size={16} /><span>Точка</span><select aria-label="Точка для аналитики" value={filters.workspace} onChange={(event) => chooseWorkspace(event.target.value)}><option value="current">Текущая · {workspaceName}</option><option value="all">Все точки</option>{workspaces.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : <span className="anl-locked-workspace"><Building2 size={16} />{workspaceName}</span>}<label><FolderOpen size={16} /><span>Папка</span><select aria-label="Папка для аналитики" disabled={!folders.length} value={filters.folder} onChange={(event) => setFilters((old) => ({ ...old, folder: event.target.value }))}><option value="all">Все папки</option>{folders.map((row) => <option key={row.filterKey} value={row.filterKey}>{filters.workspace === "all" ? `${row.workspaceName} / ` : ""}{row.name}</option>)}</select></label></div>
        {periodOpen && <form id="analytics-period-form" className="anl-period-form" onSubmit={(event) => { event.preventDefault(); if (!draftError) choosePeriod(draft); }}><label>С месяца<input type="month" aria-label="Начало периода аналитики" value={draft.from} onInput={(event) => setDraftField("from", event.currentTarget.value)} onChange={(event) => setDraftField("from", event.target.value)} /></label><label>По месяц<input type="month" aria-label="Конец периода аналитики" value={draft.to} onInput={(event) => setDraftField("to", event.currentTarget.value)} onChange={(event) => setDraftField("to", event.target.value)} /></label><button type="submit" className="anl-primary" disabled={!!draftError}>Применить<ArrowRight size={15} /></button>{draftError && <p role="alert">{draftError}</p>}</form>}
        <footer><span><CalendarDays size={12} />{analyticsPeriodLabel(filters)}</span><span>{loading ? "Загружаем данные…" : available ? "По данным папок и месяцев" : "Данные не загружены"}</span><button type="button" onClick={resetFilters} aria-label="Сбросить фильтры аналитики">Сбросить</button></footer>
      </section>
      {error && <div className="anl-error" role="alert"><AlertTriangle size={18} /><span>{error}{available ? " Показан последний загруженный отчёт для этих фильтров." : ""}</span><button type="button" disabled={loading} onClick={load}>Повторить<RefreshCw size={14} /></button></div>}
      <section className="anl-metrics" aria-label="Сводка аналитики">{cards.map(({ title, value, sub, Icon, accent, tone }) => <div key={title} className={`anl-panel bg-white/[0.02] shadow-sm ${accent ? "is-accent" : ""}`}><span>{title}<Icon size={17} /></span><strong className={tone ? `anl-${tone}` : ""}>{available ? formatMoney(value) : "—"}<small>₽</small></strong><p>{sub}</p></div>)}</section>
      <nav ref={viewRef} className="anl-view-tabs" aria-label="Разделы аналитики">{[["overview", "Обзор", BarChart3], ["products", "Товары", Package], ["months", "По месяцам", CalendarDays]].map(([value, label, Icon]) => <button type="button" key={value} aria-pressed={view === value} onClick={() => setView(value)}><Icon size={16} />{label}</button>)}</nav>
      {!available ? <section className="anl-panel bg-white/[0.02]"><AnalyticsEmpty loading={loading} error={error} /></section> : !records.length ? <section className="anl-panel bg-white/[0.02]"><AnalyticsEmpty /></section> : <>
        {view === "overview" && <><div className="anl-main-grid"><AnalyticsTrend key={key} rows={report.rows} /><AnalyticsResult totals={totals} /></div><div className="anl-highlights"><div><Layers3 size={17} /><span>Месяцев с записями<strong>{report.monthsWithData}<small>{report.lossMonths ? `С убытком: ${report.lossMonths}` : "Без убыточных месяцев"}</small></strong></span></div><div><Package size={17} /><span>Количество товаров<strong>{analyticsQuantity(totals.qty)}<small>Единиц по месячному учёту</small></strong></span></div><div><TrendingUp size={17} /><span>Лучший итог месяца<strong>{report.best ? analyticsMonth(report.best.month, true) : "—"}<small>{report.best ? `${formatMoney(report.best.net)} ₽ после расходов` : "Нет данных"}</small></strong></span></div></div><div className="anl-secondary-grid"><AnalyticsRanking products={report.products} selected={selectedProduct} onSelect={chooseProduct} /><AnalyticsExpenses rows={report.expenses} total={totals.expenses} /></div></>}
        {view === "products" && <AnalyticsProductCharts key={key} records={records} months={report.rows} products={report.products} selected={product} onSelect={setSelectedProduct} />}
        {view === "months" && <AnalyticsMonths key={key} rows={report.rows} records={records} />}
        {view !== "products" && filters.folder === "all" && snapshot.targets.length > 1 && <AnalyticsWorkspaces targets={snapshot.targets} rows={report.workspaces} onSelect={chooseWorkspace} />}
        <div className="anl-method-note"><SlidersHorizontal size={15} /><p>Результат считается по товарам и расходам в выбранных папках и месяцах. Итог = цена × количество − себестоимость × количество − расходы. Кассовые чеки и общие расходы из других разделов здесь не добавляются.</p></div>
      </>}
    </div>
  );
}
