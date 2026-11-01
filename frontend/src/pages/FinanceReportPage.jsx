import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDownUp, Banknote, CalendarDays, CheckCircle2, ChevronDown, Download, FileSpreadsheet, Landmark, Loader2, MapPin, Printer, RefreshCw, TrendingUp, Wallet, X } from "lucide-react";
import { get, getCurrentWorkspace, getSession } from "../api";
import FinanceOpeningDialog from "../components/FinanceOpeningDialog";
import { FinanceCash, FinanceLedger, FinanceOpening, FinanceOwner, FinancePosition, FinanceSplit, FinanceWaterfall } from "../components/FinancePanels";
import { csvCell, csvNum, downloadCsv } from "../utils/csv";
import { printHtmlDocument } from "../utils/print";
import { formatMoney } from "../utils/format";
import { financeExportRows, financeNumber, financePercent, financePeriodError, financePeriodLabel, financePresets, financePrintHtml, validateFinanceReport } from "../utils/finance";
import "./FinanceReportPage.css";

function FinanceWorkspace({ workspace }) {
  const [presets] = useState(() => financePresets());
  const [period, setPeriod] = useState(() => ({ from: presets[0].from, to: presets[0].to }));
  const [draft, setDraft] = useState(period);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [view, setView] = useState("overview");
  const [snapshot, setSnapshot] = useState(null);
  const [failure, setFailure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(() => new URLSearchParams(window.location.search).get("setup") === "1");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const seqRef = useRef(0), openingRef = useRef(opening);
  const dataAccountId = workspace.dataAccountId;
  const key = JSON.stringify([dataAccountId, period]);
  const available = snapshot?.key === key;
  const report = available ? snapshot.report : null;
  const error = failure?.key === key ? failure.message : "";
  const blocked = !available || loading || !!error;
  const draftError = financePeriodError(draft);
  useEffect(() => { openingRef.current = opening; }, [opening]);
  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true); setFailure(null);
    try {
      const data = validateFinanceReport(await get(`/finance/report?${new URLSearchParams(period)}`, { dataAccountId }));
      if (seq !== seqRef.current) return;
      if (data.period && ((data.period.from || "") !== period.from || (data.period.to || "") !== period.to)) throw new Error("Период ответа не совпадает с выбранным. Обновите отчёт.");
      setSnapshot({ key, report: data, updatedAt: new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) });
    } catch (error) { if (seq === seqRef.current) setFailure({ key, message: error.message || "Не удалось загрузить финансовый отчёт" }); }
    finally { if (seq === seqRef.current) setLoading(false); }
  }, [dataAccountId, period, key]);
  useEffect(() => {
    load();
    const visible = () => { if (!document.hidden && !openingRef.current) load(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      // Ignore responses from an older period or workspace, including manual refreshes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seqRef.current++;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);
  const choosePeriod = (next) => { setPeriod({ from: next.from, to: next.to }); setPeriodOpen(false); setActionError(""); setMessage(""); };
  const changeDraft = (field, value) => setDraft((old) => ({ ...old, [field]: value }));
  const exportCsv = () => {
    if (blocked) return;
    setActionError("");
    try {
      const rows = financeExportRows(report, period, workspace.name, snapshot.updatedAt).map((row) => row.map((value) => typeof value === "number" ? csvNum(value) : csvCell(value)));
      downloadCsv(`finance_${period.from || "all"}_${period.to || "current"}.csv`, rows);
      setMessage("Отчёт подготовлен в CSV.");
    } catch { setActionError("Не удалось подготовить CSV. Попробуйте ещё раз."); }
  };
  const print = () => {
    if (blocked) return;
    setActionError("");
    if (!printHtmlDocument(financePrintHtml(report, period, workspace.name, snapshot.updatedAt))) setActionError("Окно печати не открылось. Разрешите всплывающие окна для этого сайта и повторите.");
  };
  const p = report?.pnl, c = report?.cash, position = report?.position;
  const grossMargin = p?.revenue > 0 ? p.grossProfit / p.revenue * 100 : null;
  const netMargin = p?.revenue > 0 ? p.netProfit / p.revenue * 100 : null;
  const revenueParts = p ? [{ key: "cash", label: "Наличные", value: p.revenueCash, color: "var(--brand)" }, { key: "card", label: "Переводы", value: p.revenueCard, color: "var(--color-emerald-400)" }, { key: "debt", label: "В долг", value: p.revenueDebt, color: "var(--color-amber-400)", note: "Включены в выручку, деньги ещё не получены" }] : [];
  const expenseParts = p ? [{ key: "cash", label: "Из кассы", value: p.expenseCash, color: "var(--brand)" }, { key: "card", label: "С карты", value: p.expenseCard, color: "var(--brand-2)" }, { key: "owner", label: "Личные владельца", value: p.expenseOwner, color: "var(--color-amber-400)", note: "Уменьшают прибыль, не расходуют наличные кассы" }] : [];
  const metrics = [{ label: "Выручка", value: p?.revenue, hint: "После скидок · включая продажи в долг", Icon: Wallet, accent: true }, { label: "Чистая прибыль", value: p?.netProfit, hint: "Выручка − себестоимость − расходы", Icon: TrendingUp, tone: p?.netProfit < 0 ? "negative" : "positive" }, { label: "Движение наличных", value: c?.net, hint: "Приходы − выплаты за период", Icon: ArrowDownUp, tone: c?.net < 0 ? "negative" : undefined }, { label: "Остаток кассы", value: position?.cashNow, hint: "Расчётный · с учётом прежних периодов", Icon: Banknote }];
  return (
    <div className="finance-page pb-nav sm:pb-10">
      <header className="fin-page-heading"><div><p className="fin-eyebrow">Финансы / отчёт</p><h1>Финансовый отчёт</h1><p>Прибыль, наличные и расчётные остатки в одном месте.</p><span className="fin-workspace"><MapPin size={13} />{workspace.name}</span></div><div className="fin-heading-actions"><button type="button" className="fin-icon-button" aria-label="Обновить финансовый отчёт" disabled={loading} onClick={load}><RefreshCw size={17} className={loading ? "animate-spin" : ""} /></button><button type="button" className="fin-button" disabled={blocked} onClick={print}><Printer size={16} />Печать / PDF</button><button type="button" className="fin-primary" disabled={blocked} onClick={exportCsv}><Download size={16} />Экспорт CSV</button></div></header>
      <section className="fin-panel fin-period bg-white/[0.02]" aria-label="Период финансового отчёта"><div className="fin-period-toolbar"><div role="group" aria-label="Быстрый выбор периода отчёта">{presets.map((preset) => <button type="button" key={preset.id} aria-pressed={period.from === preset.from && period.to === preset.to} onClick={() => choosePeriod(preset)}>{preset.label}</button>)}</div><button type="button" className="fin-date-button" aria-expanded={periodOpen} aria-controls="finance-period-form" onClick={() => { setDraft(period); setPeriodOpen((old) => !old); }}><CalendarDays size={15} />Свой период<ChevronDown size={14} /></button></div>{periodOpen && <form id="finance-period-form" className="fin-period-form" onSubmit={(event) => { event.preventDefault(); if (!draftError) choosePeriod(draft); }}><label>С даты<input type="date" aria-label="Начало периода отчёта" value={draft.from} onInput={(event) => changeDraft("from", event.currentTarget.value)} onChange={(event) => changeDraft("from", event.target.value)} /></label><label>По дату<input type="date" aria-label="Конец периода отчёта" value={draft.to} onInput={(event) => changeDraft("to", event.currentTarget.value)} onChange={(event) => changeDraft("to", event.target.value)} /></label><button type="submit" className="fin-primary" disabled={!!draftError}>Применить</button>{draftError && <p className="fin-invalid" role="alert">{draftError}</p>}</form>}<footer><span><CalendarDays size={12} />{financePeriodLabel(period)}</span><span>{loading ? "Обновляем отчёт…" : available ? `Обновлено ${snapshot.updatedAt}` : "Данные не загружены"}</span></footer></section>
      {(error || actionError) && <div className="fin-error" role="alert"><AlertTriangle size={18} /><span>{error || actionError}{error && available ? " Показан последний загруженный отчёт за этот период." : ""}</span>{error && <button type="button" onClick={load} disabled={loading}>Повторить<RefreshCw size={14} /></button>}</div>}
      {message && <div className="fin-success" role="status"><CheckCircle2 size={18} /><span>{message}</span><button type="button" aria-label="Скрыть сообщение отчёта" onClick={() => setMessage("")}><X size={15} /></button></div>}
      <section className="fin-metrics" aria-label="Финансовая сводка">{metrics.map(({ label, value, hint, Icon, tone, accent }) => <div key={label} className={`fin-panel bg-white/[0.02] shadow-sm ${accent ? "is-accent" : ""}`}><span>{label}<Icon size={17} /></span><strong className={tone ? `fin-${tone}` : ""}>{available ? formatMoney(financeNumber(value)) : "—"}<small>₽</small></strong><p>{hint}</p></div>)}</section>
      <nav className="fin-view-tabs" aria-label="Разделы финансового отчёта">{[["overview", "Обзор", TrendingUp], ["cash", "Наличные", Banknote], ["position", "Позиция", Landmark], ["ledger", "Расшифровка", FileSpreadsheet]].map(([key, label, Icon]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}><Icon size={16} />{label}</button>)}</nav>
      {!available ? <section className="fin-panel fin-empty bg-white/[0.02]" role={loading ? "status" : undefined}>{loading ? <Loader2 size={29} className="animate-spin" /> : <AlertTriangle size={29} />}<h2>{loading ? "Собираем финансовый отчёт" : "Отчёт пока недоступен"}</h2><p>{loading ? "Загружаем прибыль, движение денег и расчётные остатки." : "Повторите загрузку или выберите другой период."}</p></section> : <>
        {view === "overview" && <><div className="fin-main-grid"><FinanceWaterfall pnl={p} /><FinanceSplit title="Из чего состоит выручка" eyebrow="Источники продаж" rows={revenueParts} note="Доли рассчитаны по сумме продаж, а не по числу чеков." /></div><div className="fin-secondary-grid"><FinanceSplit title="Чем оплачены расходы" eyebrow="Контроль затрат" rows={expenseParts} /><section className="fin-panel fin-ratios bg-white/[0.02] shadow-sm"><p className="fin-eyebrow">Результат периода</p><h2>Прибыль и расходы</h2><dl>{[["Валовая маржа", grossMargin == null ? "—" : `${financePercent(grossMargin)}%`], ["Чистая маржа", netMargin == null ? "—" : `${financePercent(netMargin)}%`], ["Себестоимость", `${formatMoney(p.cogs)} ₽`], ["Всего расходов", `${formatMoney(p.expenses)} ₽`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className="fin-note">Маржа — доля прибыли в выручке. При нулевой или отрицательной выручке процент не рассчитывается.</p>{p.cogs > p.revenue && p.cogs > 0 && <p className="fin-cost-note"><AlertTriangle size={15} />Себестоимость превышает выручку. Сверьте цены, рецепты и стоимость сырья.</p>}<button type="button" className="fin-position-link" onClick={() => setView("position")}><Landmark size={18} /><span>Расчётная чистая позиция<strong>{formatMoney(position.netPosition)} ₽</strong></span><ChevronDown size={15} /></button></section></div></>}
        {view === "cash" && <><FinanceCash report={report} /><FinanceOwner report={report} /></>}
        {view === "position" && <><FinancePosition position={position} /><FinanceOwner report={report} /></>}
        {view === "ledger" && <FinanceLedger report={report} />}
        <FinanceOpening opening={report.opening} blocked={blocked} onEdit={() => setOpening(true)} />
      </>}
      {opening && <FinanceOpeningDialog workspace={workspace} onClose={() => setOpening(false)} onSaved={() => { setOpening(false); setMessage("Стартовые балансы сохранены."); load(); }} />}
    </div>
  );
}

export default function FinanceReportPage({ initialWorkspace }) {
  const [, setContextVersion] = useState(0);
  useEffect(() => {
    const changed = () => setContextVersion((old) => old + 1);
    window.addEventListener("sales-workspace-change", changed);
    return () => window.removeEventListener("sales-workspace-change", changed);
  }, []);
  const session = getSession(), selected = initialWorkspace || getCurrentWorkspace();
  const dataAccountId = selected?.dataAccountId || session?.dataAccountId || selected?.id || session?.accountId;
  const workspace = { dataAccountId, name: selected?.name || "Текущая точка" };
  return <FinanceWorkspace key={dataAccountId || "current"} workspace={workspace} />;
}
