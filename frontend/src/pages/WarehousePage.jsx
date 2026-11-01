import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Boxes, CheckCircle2, ChevronRight, Eye, EyeOff, History, Loader2, MapPin, Package, Plus, RefreshCw, RotateCcw, Search, Trash2, Wallet, X } from "lucide-react";
import { del, get, getCurrentWorkspace, post } from "../api";
import { WarehouseDeleted, WarehouseDeleteDialog, WarehouseError, WarehouseHistoryDialog, WarehouseInventoryDialog, WarehousePurchaseDialog, WarehouseWriteOffDialog } from "../components/WarehouseDialogs";
import { formatMoney } from "../utils/format";
import { unitLabel } from "../utils/menu";
import { enrichWarehouseItem, sortWarehouse, STOCK_STATUSES, summarizeWarehouse, warehouseDate, warehouseMovement, warehouseQuantity as qty, warehouseUnitPrice } from "../utils/warehouse";
import "./WarehousePage.css";

function StockBadge({ item }) {
  return <span className={`wh-status is-${item.status}`}><i />{item.hidden ? "Скрыто" : STOCK_STATUSES[item.status]}</span>;
}

function WarehouseItemDetail({ item, blocked, onAction, onBack }) {
  const mode = item.controlMode || item.control_mode;
  return (
    <div className="wh-detail wh-panel bg-white/[0.02] shadow-sm backdrop-blur-xl">
      <header><span className="wh-item-icon"><Package size={21} /></span><div><p className="wh-eyebrow">Карточка сырья</p><h2>{item.name}</h2></div><button type="button" className="wh-icon-button wh-detail-back" onClick={onBack} aria-label="К списку сырья"><ArrowLeft size={17} /></button></header>
      <div className="wh-detail-balance"><StockBadge item={item} /><strong>{qty(item.quantity)}<small>{unitLabel(item.unit)}</small></strong><span>Текущий остаток по учёту</span>
        {item.minimum > 0 && <div className="wh-stock-level"><div><i style={{ width: `${Math.max(0, Math.min(100, item.quantity / item.minimum * 100))}%` }} /></div><span>Минимальный остаток<strong>{qty(item.minimum)} {unitLabel(item.unit)}</strong></span></div>}
      </div>
      <dl className="wh-detail-facts">
        <div><dt>Стоимость остатка</dt><dd>{formatMoney(item.value)} ₽</dd></div>
        <div><dt>Себестоимость 1 {unitLabel(item.unit)}</dt><dd>{warehouseUnitPrice(item.unitCost)} ₽</dd></div>
        <div><dt>Поставщик</dt><dd>{item.supplier || "Не указан"}</dd></div>
        <div><dt>Срок годности</dt><dd>{item.expiryDate || item.expiry_date ? warehouseDate(item.expiryDate || item.expiry_date) : "Не указан"}</dd></div>
        <div><dt>Режим учёта</dt><dd>{mode === "piece" ? "Штучный" : mode === "exact" ? "Точный" : "Приблизительный"}</dd></div>
      </dl>
      {item.note && <p className="wh-detail-note">{item.note}</p>}
      <div className="wh-detail-actions">
        <button type="button" className="wh-primary" disabled={blocked} onClick={() => onAction("purchase", item)}><Plus size={17} />Новая закупка</button>
        <div><button type="button" className="wh-button" disabled={blocked} onClick={() => onAction("inventory", item)}><RotateCcw size={15} />Пересчитать</button><button type="button" className="wh-button" disabled={blocked || item.hidden || item.quantity <= 0} onClick={() => onAction("writeoff", item)}><Ban size={15} />Списать</button></div>
        <button type="button" className="wh-button" onClick={() => onAction("history", item)}><History size={15} />Партии и закупки<ChevronRight size={14} /></button>
      </div>
      <footer><button type="button" className="wh-text-button" disabled={blocked} onClick={() => onAction("visibility", item)}>{item.hidden ? <Eye size={14} /> : <EyeOff size={14} />}{item.hidden ? "Показать сырьё" : "Скрыть сырьё"}</button><button type="button" className="wh-text-button wh-danger" disabled={blocked} onClick={() => onAction("delete", item)}><Trash2 size={14} />Удалить</button></footer>
    </div>
  );
}

function WarehouseAttention({ items, summary, available, onSelect, onFilter }) {
  const attention = sortWarehouse(items.filter((item) => !item.hidden && item.status !== "norm")).slice(0, 4);
  return (
    <div className="wh-attention">
      <section className="wh-panel bg-white/[0.02] shadow-sm backdrop-blur-xl"><p className="wh-eyebrow">Контроль остатков</p><h2>Требуют внимания</h2>
        {attention.length ? <><div className="wh-attention-list">{attention.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}><span><strong>{item.name}</strong><small>{STOCK_STATUSES[item.status]}</small></span><b className={`wh-quantity is-${item.status}`}>{qty(item.quantity)}<small>{unitLabel(item.unit)}</small></b><ChevronRight size={14} /></button>)}</div><button className="wh-text-button" type="button" onClick={() => onFilter("attention")}>Все проблемные позиции<ArrowRight size={14} /></button></> : <div className="wh-attention-empty"><CheckCircle2 size={25} /><p>{!available ? "Дождитесь загрузки данных" : summary.count ? "Остатки активных позиций в норме" : "Добавьте первую закупку, чтобы начать учёт"}</p></div>}
      </section>
      <section className="wh-panel wh-health bg-white/[0.02]"><p className="wh-eyebrow">Активные позиции</p><h2>Состояние склада</h2><div className="wh-health-track">{Object.keys(STOCK_STATUSES).map((key) => <i key={key} className={`is-${key}`} style={{ width: `${summary.count ? summary.counts[key] / summary.count * 100 : 0}%` }} />)}</div><div className="wh-health-labels">{Object.entries(STOCK_STATUSES).map(([key, label]) => <button type="button" key={key} onClick={() => onFilter(key)}><i className={`is-${key}`} /><span>{label}</span><strong>{available ? summary.counts[key] : "—"}</strong></button>)}</div></section>
      <Link to="/ai-warehouse" className="wh-assistant-link wh-panel bg-white/[0.02]"><Boxes size={20} /><span><strong>Закупка по накладной</strong><small>Прикрепите фото помощнику</small></span><ArrowRight size={16} /></Link>
    </div>
  );
}

function WarehouseMovements({ movements, loaded, loading, error }) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const types = [...new Set(movements.map((movement) => warehouseMovement(movement).type))];
  const rows = movements.filter((movement) => (type === "all" || warehouseMovement(movement).type === type) && [movement.itemName, movement.item_name, movement.reason, movement.note].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));
  return (
    <section className="wh-panel wh-movements bg-white/[0.02]" aria-label="Движения склада">
      <div className="wh-section-heading"><div><h2>Движения склада <span>{loaded ? rows.length : "—"}</span></h2><p>Последние 300 приходов, продаж, списаний и корректировок.</p></div></div>
      <div className="wh-search-toolbar"><label className="wh-search"><Search size={17} /><input aria-label="Поиск движений склада" placeholder="Сырьё, причина или комментарий…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="Вид движения" value={type} onChange={(event) => setType(event.target.value)}><option value="all">Все операции</option>{types.map((value) => <option key={value} value={value}>{warehouseMovement({ movementType: value }).label}</option>)}</select></div>
      {loading && !loaded ? <div className="wh-empty" role="status"><Loader2 size={25} className="animate-spin" /><p>Загружаем движения…</p></div> : !loaded && error ? <div className="wh-empty"><AlertTriangle size={28} /><h3>Движения пока недоступны</h3><p>Обновите данные склада.</p></div> : rows.length ? <div className="wh-movement-list">{rows.map((movement) => {
        const meta = warehouseMovement(movement);
        return <article key={movement.id}><span className={`wh-movement-icon ${meta.direction > 0 ? "is-positive" : meta.direction < 0 ? "is-negative" : ""}`}>{meta.direction > 0 ? <Plus size={16} /> : <History size={16} />}</span><div><h3>{movement.itemName || movement.item_name || "Сырьё"}</h3><p>{meta.label}{movement.reason ? ` · ${movement.reason}` : ""}</p>{movement.note && <p>{movement.note}</p>}</div><span className="wh-movement-date">{warehouseDate(movement.createdAt || movement.created_at, true)}</span><strong className={meta.direction > 0 ? "wh-positive" : meta.direction < 0 ? "wh-danger" : ""}>{meta.direction > 0 ? "+" : meta.direction < 0 ? "−" : ""}{qty(meta.quantity)}<small>{unitLabel(movement.unit)}</small></strong></article>;
      })}</div> : <div className="wh-empty"><History size={28} /><h3>{search || type !== "all" ? "Подходящих движений нет" : "Движений пока нет"}</h3><p>{search || type !== "all" ? "Измените поиск или вид операции." : "Здесь появятся закупки, продажи и изменения остатков."}</p></div>}
    </section>
  );
}

export default function WarehousePage({ workspaceName }) {
  const [data, setData] = useState({ items: [], movements: [] });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState("stock");
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState("active");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("priority");
  const [selectedId, setSelectedId] = useState(null);
  const [limit, setLimit] = useState(30);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [success, setSuccess] = useState("");
  const requestSeq = useRef(0), operationRef = useRef(false), dialogOpen = useRef(false);
  const detailRef = useRef(null), listRef = useRef(null);
  const pointName = workspaceName || getCurrentWorkspace()?.name || "Текущая точка";
  useEffect(() => { dialogOpen.current = !!dialog; }, [dialog]);

  const load = useCallback(async ({ allowBusy = false } = {}) => {
    if (operationRef.current && !allowBusy) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError("");
    try {
      const [items, movements] = await Promise.all([get("/warehouse/items"), get("/warehouse/movements")]);
      if (seq !== requestSeq.current) return;
      if (![items, movements].every(Array.isArray)) throw new Error("Сервер вернул неполные данные склада. Обновите страницу.");
      setData({ items, movements });
      setLoaded(true);
      setRefreshKey((old) => old + 1);
    } catch (failure) {
      if (seq === requestSeq.current) setLoadError(failure.message || "Не удалось загрузить склад");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const onVisible = () => { if (!document.hidden && !dialogOpen.current) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      // Invalidate all outstanding reads, including manual refreshes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeq.current++;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const items = useMemo(() => data.items.map(enrichWarehouseItem), [data.items]);
  const summary = useMemo(() => summarizeWarehouse(items), [items]);
  const filtered = useMemo(() => items.filter((item) => {
    if (visibility === "active" && item.hidden || visibility === "hidden" && !item.hidden) return false;
    const query = search.trim().toLowerCase();
    return !query || [item.name, item.supplier, item.note].some((value) => String(value || "").toLowerCase().includes(query));
  }), [items, visibility, search]);
  const counts = { all: filtered.length, neg: 0, out: 0, low: 0, norm: 0 };
  filtered.forEach((item) => counts[item.status]++);
  const visible = sortWarehouse(filtered.filter((item) => status === "all" || status === "attention" && item.status !== "norm" || item.status === status), sort);
  const selected = visible.find((item) => item.id === selectedId) || null;
  const blocked = busy || loading || !!loadError;
  const hasFilters = !!search || visibility !== "active" || status !== "all";
  const reset = () => { setSearch(""); setVisibility("active"); setStatus("all"); };
  const select = (item) => {
    setSelectedId(item.id);
    if (window.matchMedia("(max-width: 1050px)").matches) requestAnimationFrame(() => { detailRef.current?.focus({ preventScroll: true }); detailRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); });
  };
  const open = (kind, item = null) => { if (!operationRef.current) { setOperationError(""); setDialog({ kind, item }); } };
  const close = () => { if (!operationRef.current) { setDialog(null); setOperationError(""); } };
  const perform = async (request, message) => {
    if (operationRef.current) return;
    operationRef.current = true;
    requestSeq.current++;
    setLoading(false);
    setBusy(true);
    setOperationError("");
    setSuccess("");
    try {
      const result = await request();
      if (result === undefined) throw new Error("Сервер не подтвердил операцию. Проверьте историю перед повтором.");
      setDialog(null);
      setSuccess(message);
      await load({ allowBusy: true });
    } catch (failure) {
      setOperationError(failure.message || "Операция не выполнена. Проверьте историю перед повтором.");
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  };
  const checkDuplicates = async (body) => {
    if (operationRef.current) return null;
    operationRef.current = true;
    setBusy(true);
    setOperationError("");
    try {
      const rows = await get(`/warehouse/items/similar?${new URLSearchParams({ name: body.name, unit: body.unit })}`);
      if (!Array.isArray(rows)) throw new Error("Не удалось проверить похожие позиции. Попробуйте ещё раз.");
      return rows;
    } catch (failure) {
      setOperationError(failure.message || "Не удалось проверить похожие позиции");
      return null;
    } finally { operationRef.current = false; setBusy(false); }
  };
  const purchase = (body, id) => perform(async () => {
    const item = await post(id ? `/warehouse/items/${id}/purchase` : "/warehouse/items", body);
    if (!item?.id) throw new Error("Сервер не подтвердил закупку. Проверьте партии перед повтором.");
    setSelectedId(item.id);
    return item;
  }, `Закупка сохранена · ${body.name} · ${qty(body.quantity)} ${unitLabel(body.unit)}`);
  const action = (kind, item) => {
    if (kind === "visibility") perform(() => post(`/warehouse/items/${item.id}/hide`, { hidden: !item.hidden }), item.hidden ? "Сырьё снова показано в списке" : "Сырьё скрыто. Его можно найти через фильтр видимости.");
    else open(kind, item);
  };
  const focusStatus = (next) => { setView("stock"); reset(); setStatus(next); setSelectedId(null); listRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); };

  return (
    <div className="warehouse-page pb-nav sm:pb-10">
      <header className="wh-page-heading"><div><p className="wh-eyebrow">Запасы / учёт сырья</p><h1>Склад сырья</h1><p>Остатки, закупки и движение каждой позиции.</p><span className="wh-workspace"><MapPin size={13} />{pointName}</span></div><div className="wh-heading-actions"><button className="wh-icon-button" type="button" onClick={() => load()} disabled={busy || loading} aria-label="Обновить склад"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button><button className="wh-button" type="button" onClick={() => open("writeoff")} disabled={blocked || !items.some((item) => !item.hidden && item.quantity > 0)}><Ban size={16} />Списание</button><button className="wh-primary" type="button" disabled={blocked} onClick={() => open("purchase")}><Plus size={18} />Новая закупка</button></div></header>
      <WarehouseError>{loadError && `${loadError}${loaded ? " Показаны последние загруженные данные." : ""}`}</WarehouseError>
      {success && <div className="wh-success" role="status"><CheckCircle2 size={18} /><span>{success}</span><button type="button" aria-label="Скрыть сообщение" onClick={() => setSuccess("")}><X size={16} /></button></div>}
      {!dialog && <WarehouseError>{operationError}</WarehouseError>}
      <section className="wh-metrics" aria-label="Сводка склада">
        <div className="wh-panel bg-white/[0.02] shadow-sm"><span><Wallet size={16} />Стоимость остатков</span><strong>{loaded ? formatMoney(summary.value) : "—"}<small>₽</small></strong><p>По учёту · активные позиции</p></div>
        <button type="button" className="wh-panel bg-white/[0.02]" onClick={() => focusStatus("all")}><span><Package size={16} />Позиций в учёте</span><strong>{loaded ? summary.count : "—"}</strong><p>{loaded ? `Ещё ${summary.hidden} скрыто` : loading ? "Загружаем склад" : "Данные не загружены"}</p></button>
        <button type="button" className="wh-panel bg-white/[0.02]" onClick={() => focusStatus("attention")}><span><Boxes size={16} />Нужно пополнить</span><strong className={summary.attention ? "wh-caution" : ""}>{loaded ? summary.attention : "—"}</strong><p>Низкие, нулевые и отрицательные</p></button>
        <button type="button" className="wh-panel bg-white/[0.02]" onClick={() => focusStatus("neg")}><span><AlertTriangle size={16} />В минусе</span><strong className={summary.counts.neg ? "wh-danger" : ""}>{loaded ? summary.counts.neg : "—"}</strong><p>Сверьте факт или добавьте закупку</p></button>
      </section>
      <nav className="wh-view-tabs" aria-label="Разделы склада">{[["stock", "Остатки", Package], ["movements", "Движения", History], ["deleted", "История удалений", Trash2]].map(([key, label, Icon]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}><Icon size={16} />{label}</button>)}</nav>
      {view === "deleted" ? <WarehouseDeleted refreshKey={refreshKey} /> : view === "movements" ? <WarehouseMovements movements={data.movements} loaded={loaded} loading={loading} error={loadError} /> : (
        <div className="wh-stock-layout">
          <section className="wh-stock wh-panel bg-white/[0.02] shadow-sm" ref={listRef} aria-label="Остатки сырья">
            <div className="wh-section-heading"><div><h2>Остатки сырья <span>{loaded ? visible.length : "—"}</span></h2><p>Выберите позицию для просмотра и работы с остатком.</p></div></div>
            <div className="wh-search-toolbar"><label className="wh-search"><Search size={18} /><input aria-label="Найти сырьё" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, поставщик или комментарий…" />{search && <button type="button" aria-label="Очистить поиск сырья" onClick={() => setSearch("")}><X size={15} /></button>}</label><select aria-label="Видимость сырья" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="active">Активные</option><option value="all">Включая скрытые</option><option value="hidden">Только скрытые</option></select></div>
            <div className="wh-stock-filters"><div role="group" aria-label="Статус остатка">{[["all", "Все"], ...Object.entries(STOCK_STATUSES)].map(([key, label]) => <button type="button" key={key} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}<span>{counts[key]}</span></button>)}</div><select aria-label="Сортировка сырья" value={sort} onChange={(event) => setSort(event.target.value)}><option value="priority">Проблемные сверху</option><option value="deficit">По сумме пополнения</option><option value="value">По стоимости остатка</option><option value="name">По названию</option></select></div>
            {hasFilters && <div className="wh-active-filters"><span>{status === "attention" ? "Требуют пополнения" : "Применены фильтры"}</span><button type="button" onClick={reset}>Сбросить всё<X size={12} /></button></div>}
            {loading && !loaded ? <div className="wh-empty" role="status"><Loader2 size={27} className="animate-spin" /><p>Загружаем остатки…</p></div> : visible.length ? <>
              <div className="wh-stock-columns" aria-hidden="true"><span>Сырьё</span><span>Остаток</span><span>Стоимость</span><span>Приход</span></div>
              <div className="wh-stock-rows">{visible.slice(0, limit).map((item) => <article key={item.id} className={`wh-stock-row ${selected?.id === item.id ? "is-selected" : ""} ${item.hidden ? "is-hidden" : ""}`}><button type="button" className="wh-select-item" aria-label={`Открыть: ${item.name}`} aria-pressed={selected?.id === item.id} onClick={() => select(item)}><span className="wh-stock-name"><strong>{item.name}</strong><span><StockBadge item={item} />{item.supplier && <small>{item.supplier}</small>}</span></span><span className={`wh-stock-quantity is-${item.status}`}><strong>{qty(item.quantity)}<small>{unitLabel(item.unit)}</small></strong><small>Мин. {qty(item.minimum)} {unitLabel(item.unit)}</small></span><span className="wh-stock-value"><strong>{formatMoney(item.value)} ₽</strong><small>{warehouseUnitPrice(item.unitCost)} ₽ / {unitLabel(item.unit)}</small></span></button><button type="button" className="wh-row-purchase" disabled={blocked} aria-label={`Закупка: ${item.name}`} onClick={() => open("purchase", item)}><Plus size={16} /><span>Закупка</span></button></article>)}</div>
              {visible.length > limit && <button type="button" className="wh-button wh-load-more" onClick={() => setLimit((old) => old + 30)}>Показать ещё · {visible.length - limit}</button>}
            </> : <div className="wh-empty">{!loaded && loadError ? <><AlertTriangle size={30} /><h3>Склад пока недоступен</h3><p>Обновите данные после восстановления соединения.</p><button className="wh-button" onClick={() => load()}>Попробовать снова</button></> : <><Package size={30} /><h3>{hasFilters ? "Сырьё не найдено" : "Добавьте первую закупку"}</h3><p>{hasFilters ? "Измените запрос, статус или видимость." : "После закупки здесь появятся количество и стоимость остатка."}</p>{hasFilters && <button type="button" className="wh-button" onClick={reset}>Сбросить фильтры</button>}</>}</div>}
            <footer className="wh-stock-footer">{loaded ? `Показано ${Math.min(limit, visible.length)} из ${visible.length} позиций` : "Данные пока не загружены"}<span>Количество — в единицах хранения</span></footer>
          </section>
          <aside className="wh-stock-aside" ref={detailRef} tabIndex={-1} aria-label="Карточка сырья">{selected ? <WarehouseItemDetail item={selected} blocked={blocked} onAction={action} onBack={() => listRef.current?.scrollIntoView({ block: "start", behavior: "auto" })} /> : <WarehouseAttention items={items} summary={summary} available={loaded} onSelect={(item) => { reset(); select(item); }} onFilter={focusStatus} />}</aside>
        </div>
      )}
      {dialog?.kind === "purchase" && <WarehousePurchaseDialog item={dialog.item} items={data.items} workspaceName={pointName} busy={busy} error={operationError} onCheck={checkDuplicates} onSave={purchase} onClose={close} />}
      {dialog?.kind === "writeoff" && <WarehouseWriteOffDialog item={dialog.item} items={items} busy={busy} error={operationError} onSave={(id, body) => perform(() => post(`/warehouse/items/${id}/writeoff`, body), "Списание проведено. Остаток обновлён.")} onClose={close} />}
      {dialog?.kind === "inventory" && <WarehouseInventoryDialog item={dialog.item} busy={busy} error={operationError} onSave={(id, body) => perform(() => post(`/warehouse/items/${id}/inventory`, body), "Пересчёт проведён. Остаток обновлён.")} onClose={close} />}
      {dialog?.kind === "delete" && <WarehouseDeleteDialog item={dialog.item} busy={busy} error={operationError} onSave={(id, body) => perform(() => del(`/warehouse/items/${id}`, body), "Сырьё удалено из активного учёта и сохранено в истории.")} onClose={close} />}
      {dialog?.kind === "history" && <WarehouseHistoryDialog item={dialog.item} busy={busy} blocked={blocked} error={operationError} onCancel={(id, batch) => perform(() => del(`/warehouse/items/${id}/batches/${batch}`), "Закупка отменена. Остаток обновлён.")} onClose={close} />}
    </div>
  );
}
