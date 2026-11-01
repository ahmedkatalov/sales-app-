import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, History, Loader2, MapPin, Package, Sparkles } from "lucide-react";
import { get } from "../api";
import Modal from "./Modal";
import { useIngredientSuggest } from "../hooks/useIngredientSuggest";
import useDialogFocus from "../utils/useDialogFocus";
import { formatMoney, num } from "../utils/format";
import { CONTAINER_UNITS, unitLabel } from "../utils/menu";
import { computeWarehousePurchase, STOCK_EPSILON, warehouseDate, warehouseNumber, warehouseQuantity as qty, warehouseUnitPrice } from "../utils/warehouse";

export function WarehouseError({ children }) {
  return children ? <div className="wh-error" role="alert"><AlertTriangle size={17} /><span>{children}</span></div> : null;
}
function WarehouseDialog({ title, section, wide, busy, error, onClose, children }) {
  const ref = useRef(null);
  useDialogFocus(ref, true, ".smart-modal-panel");
  return <div ref={ref}><Modal title={title} section={section} wide={wide} legacyLight={false} onClose={() => { if (!busy) onClose(); }}><div className="wh-modal-message"><WarehouseError>{error}</WarehouseError></div><fieldset className="wh-dialog-fields" disabled={busy}>{children}</fieldset></Modal></div>;
}
function Actions({ onClose, busy, invalid, label = "Сохранить", danger = false }) {
  return <div className="wh-form-actions"><button type="button" className="wh-button" disabled={busy} onClick={onClose}>Назад</button><button type="submit" className={danger ? "wh-button wh-danger" : "wh-primary"} disabled={busy || invalid}>{busy ? <><Loader2 size={16} className="animate-spin" />Сохраняем…</> : label}</button></div>;
}
const units = [["g", "Граммы"], ["kg", "Килограммы"], ["ml", "Миллилитры"], ["l", "Литры"], ["pcs", "Штуки"], ["pack", "Упаковки"], ["box", "Коробки"], ["bottle", "Бутылки"]];

export function WarehousePurchaseDialog({ item, items, workspaceName, busy, error, onCheck, onSave, onClose }) {
  const [form, setForm] = useState(() => ({ name: item?.name || "", quantity: "", price: "", minimum: String(item?.minimum ?? ""), purchaseUnit: item?.unit || "g", unit: item?.unit || "g", unitsPerPackage: "1", basePerUnit: String(item?.packagingQuantity ?? item?.packaging_quantity ?? 1), supplier: item?.supplier || "", expiryDate: "", note: "" }));
  const [allowZero, setAllowZero] = useState(false);
  const [duplicates, setDuplicates] = useState(null);
  const [localError, setLocalError] = useState("");
  const computed = computeWarehousePurchase(form);
  const { suggestions, loading: suggesting } = useIngredientSuggest(!item && !duplicates ? form.name : "", items, { minLen: 3, debounce: 600 });
  const availableUnits = item ? units.filter(([unit]) => CONTAINER_UNITS.includes(unit) || unit === item.unit || item.unit === "g" && unit === "kg" || item.unit === "ml" && unit === "l") : units;
  const change = (key, value) => { setLocalError(""); setForm((old) => ({ ...old, [key]: value })); };
  const payload = (target = item || items.find((entry) => entry.unit === computed.unit && entry.name.trim().toLowerCase() === form.name.trim().toLowerCase())) => ({
    name: form.name.trim().replace(/\s+/g, " "), quantity: computed.quantity, unit: computed.unit, price: computed.price,
    minQuantity: computed.minimum, min_quantity: computed.minimum, supplier: form.supplier.trim(), expiryDate: form.expiryDate,
    expiry_date: form.expiryDate,
    note: [form.note.trim(), computed.packaged ? `Пересчёт закупки: ${form.quantity} ${unitLabel(form.purchaseUnit)} × ${form.unitsPerPackage} шт × ${form.basePerUnit} ${unitLabel(computed.unit)}` : computed.multiplier === 1000 ? `Пересчёт закупки: ${form.quantity} ${unitLabel(form.purchaseUnit)} × 1000` : ""].filter(Boolean).join(" · "),
    controlMode: target?.controlMode || target?.control_mode || (["g", "ml"].includes(computed.unit) ? "approximate" : "piece"),
    lossPercent: num(target?.lossPercent ?? target?.loss_percent ?? (computed.unit === "ml" ? 5 : computed.unit === "g" ? 3 : 0)),
    inventoryMethod: target?.inventoryMethod || target?.inventory_method || (["g", "ml"].includes(computed.unit) ? "average" : "fifo"),
    packagingQuantity: computed.packaged ? warehouseNumber(form.basePerUnit) : num(target?.packagingQuantity ?? target?.packaging_quantity ?? 1),
  });
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (computed.error) { setLocalError(computed.error); return; }
    if (!computed.price && !allowZero) { setLocalError("Подтвердите закупку без стоимости или укажите цену"); return; }
    if (item) { onSave(payload(), item.id); return; }
    const list = await onCheck(payload());
    if (list === null) return;
    if (list.length) setDuplicates(list);
    else onSave(payload());
  };
  return (
    <WarehouseDialog title={duplicates ? "Похожее сырьё уже есть" : item ? `Закупка: ${item.name}` : "Новая закупка"} section={workspaceName} wide busy={busy} error={error || localError} onClose={onClose}>
      {duplicates ? (
        <div className="wh-duplicates">
          <p className="wh-help">Для «{form.name}» найдены похожие позиции. Выберите сырьё для пополнения или продолжите с введённым названием. Если название и единица совпадут, закупка дополнит существующий остаток.</p>
          {duplicates.map((candidate) => <article key={candidate.id}><span className="wh-item-icon"><Package size={19} /></span><div><strong>{candidate.name}</strong><p>{qty(candidate.quantity)} {unitLabel(candidate.unit)} на складе</p></div><button type="button" className="wh-primary" disabled={busy || candidate.unit !== computed.unit} onClick={() => onSave(payload(candidate), candidate.id)}>Пополнить<ArrowRight size={14} /></button></article>)}
          <div className="wh-form-actions"><button type="button" className="wh-button" onClick={() => setDuplicates(null)}>К форме</button><button type="button" className="wh-button" onClick={() => onSave(payload())}>Сохранить с этим названием</button></div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p className="wh-form-intro"><MapPin size={15} />Партия будет записана на склад точки «{workspaceName}».</p>
          <div className="wh-purchase-layout">
            <div>
              <label className="wh-field">Название сырья<input value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="Например, молоко 3,2%" disabled={!!item} autoFocus={!item} required /></label>
              {!item && (suggesting || suggestions.length > 0) && <div className="wh-name-suggestions"><span><Sparkles size={13} />{suggesting ? "Подбираем название…" : "Возможно, вы имели в виду"}</span>{suggestions.filter((entry) => entry.name?.trim().toLowerCase() !== form.name.trim().toLowerCase()).slice(0, 3).map((entry) => <button key={entry.warehouseId || entry.name} type="button" onClick={() => change("name", entry.name)}>{entry.name}{entry.warehouseId ? " · есть на складе" : ""}</button>)}</div>}
              <div className="wh-field-grid">
                <label className="wh-field">Сколько купили<input value={form.quantity} onChange={(event) => change("quantity", event.target.value)} inputMode="decimal" placeholder="0" autoFocus={!!item} required /></label>
                <label className="wh-field">Единица закупки<select value={form.purchaseUnit} onChange={(event) => { const purchaseUnit = event.target.value; setForm((old) => ({ ...old, purchaseUnit, unit: item?.unit || (purchaseUnit === "kg" ? "g" : purchaseUnit === "l" ? "ml" : ["g", "ml", "pcs"].includes(purchaseUnit) ? purchaseUnit : old.unit) })); }}>{availableUnits.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              </div>
              {CONTAINER_UNITS.includes(form.purchaseUnit) && form.purchaseUnit !== form.unit && <div className="wh-packaging-fields"><p>Пересчёт упаковок</p><div className="wh-field-grid"><label className="wh-field">Штук в упаковке<input inputMode="decimal" value={form.unitsPerPackage} onChange={(event) => change("unitsPerPackage", event.target.value)} /></label><label className="wh-field">В одной штуке, {unitLabel(form.unit)}<input inputMode="decimal" value={form.basePerUnit} onChange={(event) => change("basePerUnit", event.target.value)} /></label></div>{!item && <label className="wh-field">Хранить и списывать в<select value={form.unit} onChange={(event) => change("unit", event.target.value)}><option value="g">Граммах</option><option value="ml">Миллилитрах</option><option value="pcs">Штуках</option></select></label>}</div>}
              <label className="wh-field">Общая стоимость закупки, ₽<input value={form.price} onChange={(event) => { change("price", event.target.value); setAllowZero(false); }} inputMode="decimal" placeholder="0" /></label>
              {computed.price === 0 && <label className="wh-checkbox"><input type="checkbox" checked={allowZero} onChange={(event) => setAllowZero(event.target.checked)} /><span>Закупка без стоимости. Себестоимость этой партии будет 0 ₽.</span></label>}
            </div>
            <aside className="wh-purchase-preview">
              <p className="wh-eyebrow">Перед сохранением</p><span>На склад поступит</span><strong>{Number.isFinite(computed.quantity) && computed.quantity > 0 ? qty(computed.quantity) : "—"}<small>{unitLabel(computed.unit)}</small></strong>
              <p>{computed.packaged ? `${form.quantity || 0} × ${form.unitsPerPackage} × ${form.basePerUnit} ${unitLabel(computed.unit)}` : computed.multiplier === 1000 ? `${form.quantity || 0} ${unitLabel(form.purchaseUnit)} × 1000` : "Количество в единицах хранения"}</p>
              <div><span>Себестоимость 1 {unitLabel(computed.unit)}</span><b>{Number.isFinite(computed.unitCost) && computed.quantity > 0 ? warehouseUnitPrice(computed.unitCost) : "—"} ₽</b></div>
              {item && <div><span>Остаток после закупки</span><b>{Number.isFinite(computed.quantity) && computed.quantity > 0 ? qty(item.quantity + computed.quantity) : qty(item.quantity)} {unitLabel(item.unit)}</b></div>}
            </aside>
          </div>
          <details className="wh-additional-fields">
            <summary>Поставщик, минимальный остаток и срок годности</summary>
            <div className="wh-field-grid">
              <label className="wh-field">Минимальный остаток, {unitLabel(computed.unit)}<input inputMode="decimal" value={form.minimum} onChange={(event) => change("minimum", event.target.value)} placeholder="0" /></label>
              <label className="wh-field">Поставщик<input value={form.supplier} onChange={(event) => change("supplier", event.target.value)} placeholder="Необязательно" /></label>
              <label className="wh-field">Срок годности<input type="date" value={form.expiryDate} onInput={(event) => change("expiryDate", event.currentTarget.value)} onChange={(event) => change("expiryDate", event.target.value)} /></label>
              <label className="wh-field">Комментарий / партия<input value={form.note} onChange={(event) => change("note", event.target.value)} placeholder="Необязательно" /></label>
            </div>
            <p className="wh-help">Минимум задаётся в единицах хранения.{item ? " При пополнении ноль или пустое поле сохраняют прежний минимум." : " При пополнении существующей позиции ноль сохраняет её прежний минимум."}</p>
          </details>
          <WarehouseError>{form.name.trim() && form.quantity.trim() ? computed.error : ""}</WarehouseError>
          <Actions busy={busy} invalid={!!computed.error || computed.price === 0 && !allowZero} onClose={onClose} label="Сохранить закупку" />
        </form>
      )}
    </WarehouseDialog>
  );
}

export function WarehouseWriteOffDialog({ item, items, busy, error, onSave, onClose }) {
  const [id, setId] = useState(String(item?.id || ""));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("Негодно / утиль");
  const [note, setNote] = useState("");
  const selected = items.find((entry) => String(entry.id) === id);
  const quantity = warehouseNumber(amount);
  const invalid = !selected || !Number.isFinite(quantity) || quantity <= 0 || quantity > selected.quantity;
  return (
    <WarehouseDialog title="Списание сырья" section="Уменьшение остатка" busy={busy} error={error} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && !invalid) onSave(selected.id, { quantity, reason, note: note.trim() }); }}>
        <label className="wh-field">Сырьё<select value={id} onChange={(event) => setId(event.target.value)} required><option value="">Выберите сырьё</option>{items.filter((entry) => !entry.hidden).map((entry) => <option value={entry.id} key={entry.id}>{entry.name} · {qty(entry.quantity)} {unitLabel(entry.unit)}</option>)}</select></label>
        <label className="wh-field">Количество списания{selected ? `, ${unitLabel(selected.unit)}` : ""}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" autoFocus={!!item} required /></label>
        {selected && amount.trim() && <p className={invalid ? "wh-invalid" : "wh-calculation"}>{!Number.isFinite(quantity) || quantity <= 0 ? "Введите количество больше нуля" : quantity > selected.quantity ? `Доступно только ${qty(Math.max(0, selected.quantity))} ${unitLabel(selected.unit)}` : `Останется ${qty(selected.quantity - quantity)} ${unitLabel(selected.unit)}`}</p>}
        <label className="wh-field">Причина<select value={reason} onChange={(event) => setReason(event.target.value)}>{["Негодно / утиль", "Просрочилось", "Брак", "Потеря", "Другое"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="wh-field">Комментарий <small>Необязательно</small><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <Actions busy={busy} invalid={invalid} onClose={onClose} label="Списать" danger />
      </form>
    </WarehouseDialog>
  );
}

export function WarehouseInventoryDialog({ item, busy, error, onSave, onClose }) {
  const [actual, setActual] = useState(String(item.quantity));
  const [note, setNote] = useState("");
  const value = warehouseNumber(actual), difference = value - item.quantity;
  const invalid = !actual.trim() || !Number.isFinite(value) || value < 0;
  return (
    <WarehouseDialog title="Пересчёт остатка" section={item.name} busy={busy} error={error} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && !invalid) onSave(item.id, { actualQuantity: value, note: note.trim() }); }}>
        <div className="wh-form-summary"><span>Сейчас по учёту</span><strong>{qty(item.quantity)} {unitLabel(item.unit)}</strong></div>
        <label className="wh-field">Фактический остаток, {unitLabel(item.unit)}<input inputMode="decimal" value={actual} onChange={(event) => setActual(event.target.value)} autoFocus required /></label>
        {!invalid && <p className="wh-calculation">{Math.abs(difference) < STOCK_EPSILON ? "Совпадает с учётом" : difference < 0 ? `Недостача: ${qty(-difference)} ${unitLabel(item.unit)} будет списано` : `Излишек: ${qty(difference)} ${unitLabel(item.unit)} будет добавлено`}</p>}
        {invalid && <p className="wh-invalid">Введите неотрицательный фактический остаток</p>}
        <label className="wh-field">Комментарий <small>Необязательно</small><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например, пересчёт после смены" /></label>
        <Actions busy={busy} invalid={invalid} onClose={onClose} label="Провести пересчёт" />
      </form>
    </WarehouseDialog>
  );
}

export function WarehouseDeleteDialog({ item, busy, error, onSave, onClose }) {
  const [reason, setReason] = useState("Дубль / ошибочно добавили");
  const [note, setNote] = useState("");
  return (
    <WarehouseDialog title="Удалить сырьё со склада?" section={item.name} busy={busy} error={error} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy) onSave(item.id, { reason, note: note.trim() }); }}>
        <p className="wh-help">Позиция уйдёт из активного учёта. Название, остаток и причина сохранятся в истории удалений.</p>
        <div className="wh-form-summary"><span>Остаток на момент удаления</span><strong>{qty(item.quantity)} {unitLabel(item.unit)}</strong></div>
        <label className="wh-field">Причина удаления<select value={reason} onChange={(event) => setReason(event.target.value)}>{["Дубль / ошибочно добавили", "Больше не используем", "Испорчено / списано полностью", "Перенесли в другой товар", "Другая причина"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="wh-field">Объяснение для истории <small>Необязательно</small><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></label>
        <Actions busy={busy} onClose={onClose} label="Удалить и сохранить в истории" danger />
      </form>
    </WarehouseDialog>
  );
}

function useWarehouseList(url, refreshKey = 0) {
  const [state, setState] = useState({ rows: [], loading: true, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState((old) => ({ ...old, loading: true, error: "" }));
    get(url).then((rows) => {
      if (!Array.isArray(rows)) throw new Error("Сервер вернул неполную историю");
      if (active) setState({ rows, loading: false, error: "" });
    }).catch((failure) => { if (active) setState((old) => ({ ...old, loading: false, error: failure.message || "Не удалось загрузить историю" })); });
    return () => { active = false; };
  }, [url, refreshKey, attempt]);
  return { ...state, reload: () => setAttempt((old) => old + 1) };
}

export function WarehouseHistoryDialog({ item, busy, blocked, error, onCancel, onClose }) {
  const state = useWarehouseList(`/warehouse/items/${item.id}/batches`);
  const [review, setReview] = useState(null);
  return (
    <WarehouseDialog title={review ? "Отменить закупку?" : "Партии и закупки"} section={item.name} wide busy={busy} error={error || state.error} onClose={onClose}>
      {review ? <div className="wh-batch-review"><History size={28} /><strong>{qty(review.quantity)} {unitLabel(item.unit)}</strong><p>Партия от {warehouseDate(review.createdAt)} будет снята со склада. Связанный расход, если он есть, пересчитается.</p><div className="wh-form-actions"><button className="wh-button" type="button" onClick={() => setReview(null)}>К партиям</button><button className="wh-button wh-danger" type="button" disabled={busy || blocked} onClick={() => onCancel(item.id, review.id)}>Отменить закупку</button></div></div> : <>
        <div className="wh-form-summary"><span>Текущий остаток</span><strong>{qty(item.quantity)} {unitLabel(item.unit)}</strong></div>
        {state.loading ? <div className="wh-empty" role="status"><Loader2 size={25} className="animate-spin" /><p>Загружаем партии…</p></div> : state.error ? <button className="wh-button" type="button" onClick={state.reload}>Попробовать снова</button> : state.rows.length ? <div className="wh-batch-list">{state.rows.map((batch) => {
          const used = num(batch.remainingQuantity) < num(batch.quantity) - STOCK_EPSILON;
          const inventory = String(batch.note || "").includes("Инвентаризация");
          return <article key={batch.id}><header><span>{warehouseDate(batch.createdAt)}</span><strong>{formatMoney(batch.purchasePrice)} ₽</strong></header><div className="wh-batch-amounts"><span>Купили<strong>{qty(batch.quantity)} {unitLabel(item.unit)}</strong></span><span>Осталось<strong>{qty(batch.remainingQuantity)} {unitLabel(item.unit)}</strong></span><span>Цена 1 {unitLabel(item.unit)}<strong>{warehouseUnitPrice(batch.unitCost)} ₽</strong></span></div><p>{batch.supplier || "Поставщик не указан"}{batch.expiryDate ? ` · срок до ${warehouseDate(batch.expiryDate)}` : ""}</p>{batch.note && <p>{batch.note}</p>}<button type="button" className="wh-text-button wh-danger" disabled={busy || blocked || used || inventory} onClick={() => setReview(batch)}>Отменить закупку</button>{(used || inventory) && <p className="wh-help">{inventory ? "Корректировка инвентаризации. Изменить остаток можно через пересчёт." : "Партия частично израсходована. Для корректировки используйте пересчёт."}</p>}</article>;
        })}</div> : <div className="wh-empty"><History size={26} /><p>У этой позиции пока нет партий.</p></div>}
        <button type="button" className="wh-button wh-full" onClick={onClose}>Закрыть историю</button>
      </>}
    </WarehouseDialog>
  );
}

export function WarehouseDeleted({ refreshKey }) {
  const state = useWarehouseList("/warehouse/deleted-items", refreshKey);
  const [search, setSearch] = useState("");
  const rows = state.rows.filter((item) => [item.name, item.deleteReason, item.deleteNote].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));
  return <section className="wh-panel wh-deleted bg-white/[0.02]" aria-label="История удалений"><div className="wh-section-heading"><div><h2>История удалений</h2><p>Последние 300 записей с остатком и причиной удаления.</p></div><input className="wh-search-input" aria-label="Найти удалённое сырьё" placeholder="Найти в истории…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><WarehouseError>{state.error}</WarehouseError>{state.loading ? <div className="wh-empty" role="status"><Loader2 size={25} className="animate-spin" /><p>Загружаем историю…</p></div> : state.error ? <button className="wh-button" onClick={state.reload}>Попробовать снова</button> : rows.length ? <div className="wh-deleted-list">{rows.map((item) => <article key={item.id}><div><h3>{item.name}</h3><p>{warehouseDate(item.deletedAt, true)}</p></div><strong>{qty(item.quantity)} {unitLabel(item.unit)}<small>{formatMoney(item.totalValue ?? num(item.quantity) * num(item.unitCost))} ₽ по учёту</small></strong><div><span>{item.deleteReason || "Причина не указана"}</span><p>{item.deleteNote || item.note || "Без комментария"}</p></div></article>)}</div> : <div className="wh-empty"><Check size={28} /><h3>{search ? "Записи не найдены" : "Удалённых позиций пока нет"}</h3><p>{search ? "Попробуйте другое название или причину." : "При удалении сырья его данные сохранятся здесь."}</p></div>}</section>;
}
