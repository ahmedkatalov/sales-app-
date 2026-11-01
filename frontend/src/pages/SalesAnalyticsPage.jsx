import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, ChevronDown, ChevronRight, Clock3, Loader2, MapPin, Package, ReceiptText, RefreshCw, Search, SlidersHorizontal, TrendingUp, Wallet, X } from "lucide-react";
import { get, getCurrentWorkspace } from "../api";
import { SalesHours, SalesPayments, SalesProducts, SalesTrend } from "../components/SalesCharts";
import { formatMoney } from "../utils/format";
import { filterSales, fullSalesDate, normalizeSale, salePaymentLabel, salesHighlights, salesHours, salesMetrics, salesNumber, salesPercent, salesPeriodError, salesPeriodKey, salesPeriodLabel, salesPresets, salesQuantity, salesSeries, shortSalesDate } from "../utils/sales";
import "./SalesAnalyticsPage.css";

const EMPTY = [];
const money = (value) => formatMoney(salesNumber(value));

function SalesEmpty({ title, children, loading = false }) {
  return <div className="sls-empty" role={loading ? "status" : undefined}>{loading ? <Loader2 size={30} className="animate-spin" /> : <ReceiptText size={30} />}<h2>{title}</h2><p>{children}</p></div>;
}

function SaleReceipt({ sale }) {
  return (
    <div className="sls-receipt-detail" id={`sales-receipt-${sale.id}`}>
      {sale.items.length ? <div className="sls-receipt-items">{sale.items.map((item, index) => <div key={`${item.productId}-${index}`}><span><strong>{item.name || "Товар"}</strong><small>{salesQuantity(item.qty)} × {money(item.price)} ₽{item.isExtra ? " · дополнительный товар" : ""}</small></span><strong>{money(item.total)} ₽</strong></div>)}</div> : <p className="sls-note">В этом чеке нет сведений о составе.</p>}
      <dl className="sls-receipt-totals">
        <div><dt>До скидки</dt><dd>{money(sale.subtotal)} ₽</dd></div>
        {salesNumber(sale.discountAmount) > 0 && <div><dt>Скидка{salesNumber(sale.discountPercent) > 0 ? ` ${salesPercent(salesNumber(sale.discountPercent))}%` : ""}</dt><dd>−{money(sale.discountAmount)} ₽</dd></div>}
        <div className="is-total"><dt>Оплачено</dt><dd>{money(sale.total)} ₽</dd></div>
        {sale.paymentType === "cash" && <>
          <div><dt>Внесено наличными</dt><dd>{money(sale.cashGiven)} ₽</dd></div>
          <div><dt>Сдача</dt><dd>{money(sale.changeAmount)} ₽</dd></div>
        </>}
      </dl>
      <footer><span>{salePaymentLabel(sale)}</span><span>Продавец: {sale.employeeName || "Не указан"}</span><span>Рабочая дата: {sale.day ? fullSalesDate(sale.day) : "Не указана"}</span></footer>
    </div>
  );
}

function SalesHistory({ sales }) {
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState("all");
  const [limit, setLimit] = useState(20);
  const [openId, setOpenId] = useState(null);
  const filtered = useMemo(() => filterSales(sales, query, payment), [sales, query, payment]);
  const total = filtered.reduce((sum, sale) => sum + sale.total, 0);
  const reset = () => { setQuery(""); setPayment("all"); setLimit(20); };
  return (
    <section className="sls-panel sls-history bg-white/[0.02] shadow-sm" aria-label="История чеков">
      <div className="sls-section-heading"><div><p className="sls-eyebrow">Каждая продажа под рукой</p><h2>История чеков <span>{sales.length}</span></h2><p>Откройте чек, чтобы увидеть товары, скидку и оплату.</p></div><ReceiptText size={22} /></div>
      <div className="sls-history-toolbar"><label className="sls-search"><Search size={17} /><input aria-label="Поиск чеков" placeholder="Номер чека, товар, продавец или карта…" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(20); }} />{query && <button type="button" aria-label="Очистить поиск чеков" onClick={() => { setQuery(""); setLimit(20); }}><X size={15} /></button>}</label><select aria-label="Способ оплаты чека" value={payment} onChange={(event) => { setPayment(event.target.value); setLimit(20); }}><option value="all">Любая оплата</option><option value="cash">Наличные</option><option value="transfer">Перевод</option>{sales.some((sale) => !["cash", "transfer"].includes(sale.paymentType)) && <option value="other">Другой способ</option>}</select></div>
      <div className="sls-history-result"><span>{query || payment !== "all" ? "Найдено" : "За период"}: {filtered.length} чеков · {money(total)} ₽</span>{(query || payment !== "all") && <button type="button" onClick={reset}>Сбросить фильтры<X size={12} /></button>}</div>
      {filtered.length ? <><div className="sls-receipt-columns" aria-hidden="true"><span>Чек / дата</span><span>Товары</span><span>Оплата</span><span>Сумма</span></div><div className="sls-receipts">{filtered.slice(0, limit).map((sale) => {
        const expanded = openId === sale.id;
        const summary = sale.items.map((item) => `${item.name} × ${salesQuantity(item.qty)}`).join(", ");
        return <article key={sale.id} className={expanded ? "is-open" : ""}><button type="button" className="sls-receipt-row" aria-label={`Чек №${sale.id}, ${money(sale.total)} ₽`} aria-expanded={expanded} aria-controls={`sales-receipt-${sale.id}`} onClick={() => setOpenId(expanded ? null : sale.id)}><span className="sls-receipt-number"><span><ReceiptText size={15} /><strong>#{sale.id}</strong></span><small>{sale.dateLabel} · {sale.timeLabel}</small></span><span className="sls-receipt-summary"><strong title={summary}>{summary || "Состав не указан"}</strong><small>{sale.employeeName || "Продавец не указан"}</small></span><span className={`sls-pay-badge is-${sale.paymentType === "cash" ? "cash" : sale.paymentType === "transfer" ? "transfer" : "other"}`}><i />{salePaymentLabel(sale)}</span><span className="sls-receipt-amount"><strong>{money(sale.total)} ₽</strong>{salesNumber(sale.discountAmount) > 0 && <small>Скидка {money(sale.discountAmount)} ₽</small>}</span><ChevronDown size={15} className="sls-receipt-chevron" /></button>{expanded && <SaleReceipt sale={sale} />}</article>;
      })}</div>{filtered.length > limit && <button type="button" className="sls-button sls-load-more" onClick={() => setLimit((old) => old + 20)}>Показать ещё · {Math.min(20, filtered.length - limit)}<ChevronDown size={15} /></button>}<footer className="sls-history-footer">Показано {Math.min(limit, filtered.length)} из {filtered.length} чеков<span>Новые продажи сверху</span></footer></> : <SalesEmpty title="Чеки не найдены">Измените запрос или способ оплаты.</SalesEmpty>}
    </section>
  );
}

export default function SalesAnalyticsPage({ workspaceName }) {
  const [presets] = useState(() => salesPresets());
  const [period, setPeriod] = useState(() => ({ from: presets[3].from, to: presets[3].to }));
  const [draft, setDraft] = useState(period);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(null);
  const seqRef = useRef(0);
  const key = salesPeriodKey(period);
  const available = snapshot?.key === key;
  const error = failure?.key === key ? failure.message : "";
  const rawSales = available ? snapshot.sales : EMPTY;
  const stats = available ? snapshot.stats : null;
  const sales = useMemo(() => rawSales.map(normalizeSale).sort((a, b) => b.timestamp - a.timestamp || b.id - a.id), [rawSales]);
  const m = useMemo(() => salesMetrics(stats || {}), [stats]);
  const series = useMemo(() => salesSeries(sales, period), [sales, period]);
  const hours = useMemo(() => salesHours(sales), [sales]);
  const highlights = useMemo(() => salesHighlights(sales), [sales]);
  const pointName = workspaceName || getCurrentWorkspace()?.name || "Текущая точка";
  const draftError = salesPeriodError(draft);
  const load = useCallback(async () => {
    const requestKey = salesPeriodKey(period), seq = ++seqRef.current;
    setLoading(true); setFailure(null);
    try {
      const query = new URLSearchParams(period);
      const [stats, sales] = await Promise.all([get(`/sales/stats?${query}`), get(`/sales?${query}`)]);
      if (seq !== seqRef.current) return;
      if (!stats || Array.isArray(stats) || typeof stats !== "object" || !Array.isArray(sales) || !Number.isFinite(Number(stats.totalRevenue)) || !Number.isFinite(Number(stats.salesCount))) throw new Error("Сервер вернул неполный отчёт. Попробуйте обновить данные.");
      setSnapshot({ key: requestKey, stats, sales });
    } catch (failure) {
      if (seq === seqRef.current) setFailure({ key: requestKey, message: failure.message || "Не удалось загрузить продажи" });
    } finally { if (seq === seqRef.current) setLoading(false); }
  }, [period]);
  useEffect(() => {
    load();
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      // Invalidate both automatic and manually started reads after a period change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seqRef.current++;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
  const choosePeriod = (next) => { setPeriod({ from: next.from, to: next.to }); setPeriodOpen(false); };
  const changeDraft = (field, value) => setDraft((old) => ({ ...old, [field]: value }));
  const products = Array.isArray(stats?.topProducts) ? stats.topProducts : EMPTY;
  const extras = Array.isArray(stats?.extraItems) ? stats.extraItems : EMPTY;

  return (
    <div className="sales-page pb-nav sm:pb-10">
      <header className="sls-page-heading"><div><p className="sls-eyebrow">Результаты / аналитика</p><h1>Продажи</h1><p>От общей картины — к каждой продаже.</p><span className="sls-workspace"><MapPin size={13} />{pointName}</span></div><button type="button" className="sls-button" disabled={loading} onClick={load} aria-label="Обновить продажи"><RefreshCw size={16} className={loading ? "animate-spin" : ""} />{loading ? "Обновляем…" : "Обновить"}</button></header>
      <section className="sls-period sls-panel bg-white/[0.02]" aria-label="Период продаж">
        <div className="sls-period-toolbar"><div role="group" aria-label="Быстрый выбор периода">{presets.map((preset) => <button type="button" key={preset.id} aria-pressed={salesPeriodKey(preset) === key} onClick={() => choosePeriod(preset)}>{preset.label}</button>)}</div><button type="button" className="sls-date-button" aria-expanded={periodOpen} aria-controls="sales-custom-period" onClick={() => { setDraft(period); setPeriodOpen((old) => !old); }}><CalendarDays size={16} />Свой период<ChevronDown size={14} /></button></div>
        {periodOpen && (
          <form id="sales-custom-period" className="sls-custom-period" onSubmit={(event) => { event.preventDefault(); if (!draftError) choosePeriod(draft); }}>
            <label>С даты<input type="date" aria-label="Начало периода продаж" value={draft.from} onInput={(event) => changeDraft("from", event.currentTarget.value)} onChange={(event) => changeDraft("from", event.target.value)} /></label>
            <label>По дату<input type="date" aria-label="Конец периода продаж" value={draft.to} onInput={(event) => changeDraft("to", event.currentTarget.value)} onChange={(event) => changeDraft("to", event.target.value)} /></label>
            <button type="submit" className="sls-primary" disabled={!!draftError}>Применить<ChevronRight size={16} /></button>
            {draftError && <p role="alert">{draftError}</p>}
          </form>
        )}
        <div className="sls-period-caption"><span><Clock3 size={12} />{salesPeriodLabel(period)}</span><span>{loading ? "Загружаем отчёт…" : available ? "По рабочей дате точки" : "Данные не загружены"}</span></div>
      </section>
      {error && <div className="sls-error" role="alert"><AlertTriangle size={18} /><span>{error}{available ? " Показан последний загруженный отчёт за этот период." : ""}</span><button type="button" disabled={loading} onClick={load}>Повторить<RefreshCw size={14} /></button></div>}
      <section className="sls-metrics" aria-label="Сводка продаж">
        {[{ label: "Выручка", value: m.revenue, unit: "₽", Icon: Wallet, sub: "После скидок", accent: true }, { label: "Прибыль от продаж", value: m.profit, unit: "₽", Icon: m.profit < 0 ? ArrowDownRight : TrendingUp, sub: m.margin == null ? "Выручка минус себестоимость" : `${salesPercent(m.margin)}% от выручки · без расходов`, tone: m.profit < 0 ? "negative" : "positive" }, { label: "Продано чеков", value: m.count, Icon: ReceiptText, sub: "Завершённые продажи" }, { label: "Средний чек", value: m.average, unit: "₽", Icon: ArrowUpRight, sub: "Выручка ÷ количество чеков" }].map(({ label, value, unit, Icon, sub, accent, tone }) => <div key={label} className={`sls-panel bg-white/[0.02] shadow-sm ${accent ? "sls-metric-accent" : ""}`}><span>{label}<Icon size={17} /></span><strong className={tone ? `sls-${tone}` : ""}>{available && value != null ? money(value) : "—"}{unit && <small>{unit}</small>}</strong><p>{sub}</p></div>)}
      </section>
      {!available ? <section className="sls-panel bg-white/[0.02]"><SalesEmpty loading={loading} title={loading ? "Собираем отчёт о продажах" : "Отчёт пока недоступен"}>{loading ? "Загружаем выручку, товары и чеки за выбранный период." : "Нажмите «Повторить» или выберите другой период."}</SalesEmpty></section> : !m.count && !sales.length ? <section className="sls-panel bg-white/[0.02]"><SalesEmpty title="За этот период продаж не было">Выберите другие даты. Здесь появятся графики, популярные товары и история чеков.</SalesEmpty></section> : <>
        {m.count !== sales.length && <p className="sls-data-notice"><AlertTriangle size={15} />Сводка и список чеков различаются. Обновите отчёт: графики построены по {sales.length} загруженным чекам.</p>}
        <div className="sls-main-grid"><SalesTrend series={series} revenue={m.revenue} count={m.count} average={m.average} /><SalesPayments metrics={m} /></div>
        <div className="sls-highlights"><div><span className="sls-highlight-icon"><TrendingUp size={17} /></span><span>Лучший день<strong>{highlights.best ? shortSalesDate(highlights.best.day) : "—"}<small>{highlights.best ? `${money(highlights.best.revenue)} ₽ выручки` : "Нет дат в чеках"}</small></strong></span></div><div><span className="sls-highlight-icon"><CalendarDays size={17} /></span><span>В среднем за день с продажами<strong>{money(highlights.average)} ₽<small>Дней с чеками: {highlights.activeDays}</small></strong></span></div><div><span className="sls-highlight-icon"><Package size={17} /></span><span>Себестоимость продаж<strong>{m.cost == null ? "—" : `${money(m.cost)} ₽`}<small>{m.cost === 0 ? "Себестоимость по учёту равна нулю" : "Учтена в прибыли от продаж"}</small></strong></span></div></div>
        <div className="sls-secondary-grid"><SalesProducts products={products} extras={extras} /><SalesHours rows={hours} /></div>
        <div className="sls-method-note"><SlidersHorizontal size={15} /><p>Прибыль от продаж = выручка − себестоимость проданных товаров. Расходы кофейни здесь не вычитаются. Для точной себестоимости проверьте состав товаров.</p></div>
        <SalesHistory key={key} sales={sales} />
      </>}
    </div>
  );
}
