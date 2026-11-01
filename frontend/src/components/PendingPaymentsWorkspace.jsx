import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Banknote, Check, CheckCircle2,
  ChevronRight, Clock, CreditCard, Loader2, Plus, Receipt, RefreshCw, Search,
  Trash2, UserRound, X,
} from "lucide-react";
import { del, get, post } from "../api";
import { businessISO, formatMoney, num, prettyName } from "../utils/format";
import Modal from "./Modal";
import "./PendingPaymentsWorkspace.css";

const createdAt = (sale) => sale.createdAt || sale.created_at || "";
const createdTime = (sale) => {
  const timestamp = Date.parse(createdAt(sale));
  return Number.isFinite(timestamp) ? timestamp : null;
};
const waitingMs = (sale, now) => {
  const timestamp = createdTime(sale);
  return timestamp === null ? null : Math.max(0, now - timestamp);
};
const waitingLabel = (duration) => {
  if (duration === null) return "Время не указано";
  const minutes = Math.floor(duration / 60000);
  if (minutes < 1) return "Только что";
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  return `${Math.floor(minutes / 1440)} д ${Math.floor((minutes % 1440) / 60)} ч`;
};
const dateLabel = (sale) => {
  const timestamp = createdTime(sale);
  if (timestamp === null) return "Дата не указана";
  return new Date(timestamp).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const itemsOf = (sale) => Array.isArray(sale.items) ? sale.items : [];
const quantityOf = (item) => num(item.qty ?? item.quantity ?? 1);
const itemTotal = (item) => num(item.total ?? num(item.price) * quantityOf(item));
const sellerOf = (sale) => sale.employeeName || sale.sellerName || sale.seller_name || "Продавец не указан";
const parseAmount = (value) => Number(String(value).trim().replace(/\s/g, "").replace(",", "."));

function PaymentDetails({ sale, cards, cardsError, now, busy, blocked, error, onConfirm, onCancel, onBack, onClearError }) {
  const [method, setMethod] = useState("cash");
  const [cashGiven, setCashGiven] = useState("");
  const [cardId, setCardId] = useState("");
  const [validationError, setValidationError] = useState("");
  const disabled = busy || blocked;
  const total = num(sale.total);
  const received = cashGiven === "" ? total : parseAmount(cashGiven);
  const validAmount = Number.isFinite(received) && received >= 0;
  const change = received - total;
  const insufficient = validAmount && change < -0.005;
  const items = itemsOf(sale);
  const discount = num(sale.discountAmount ?? sale.discount_amount);
  const subtotal = num(sale.subtotal ?? items.reduce((sum, item) => sum + itemTotal(item), 0));

  const clearError = () => {
    setValidationError("");
    onClearError();
  };
  const confirm = () => {
    if (disabled) return;
    if (method === "cash" && (!validAmount || insufficient)) {
      setValidationError("Проверьте полученную сумму наличных");
      return;
    }
    if (method === "transfer" && !cards.some((card) => String(card.id) === cardId)) {
      setValidationError("Выберите счёт, на который поступил перевод");
      return;
    }
    onConfirm(sale, {
      paymentType: method,
      cardId: method === "transfer" ? Number(cardId) : 0,
      cashGiven: method === "cash" ? received : 0,
    });
  };

  return (
    <div className="pending-detail-panel bg-white/[0.02] shadow-sm backdrop-blur-xl">
      <div className="pending-detail-heading">
        <div><span className="pending-eyebrow">Приём оплаты</span><h2>Чек №{sale.id}</h2></div>
        <button type="button" className="pending-icon-button pending-back" onClick={onBack} disabled={disabled} aria-label="К списку чеков"><ArrowLeft size={19} /></button>
        <span className="pending-status"><Clock size={13} />Ожидает</span>
      </div>
      <div className="pending-receipt-meta"><span><UserRound size={14} />{sellerOf(sale)}</span><span>{dateLabel(sale)}</span></div>
      <div className="pending-detail-total"><span>К оплате</span><strong>{formatMoney(total)}<small>₽</small></strong><p>В ожидании · {waitingLabel(waitingMs(sale, now)).toLowerCase()}</p></div>
      <div className="pending-receipt-items" aria-label="Состав чека">
        {items.length ? items.map((item, index) => (
          <div key={`${item.productId || "custom"}-${index}`}>
            <span><strong>{prettyName(item.name || item.productName) || "Товар"}</strong><small>{formatMoney(item.price)} ₽ × {quantityOf(item)}</small></span>
            <b>{formatMoney(itemTotal(item))} ₽</b>
          </div>
        )) : <p>В этом чеке нет сохранённого списка позиций.</p>}
      </div>
      {discount > 0 && <dl className="pending-discount"><div><dt>До скидки</dt><dd>{formatMoney(subtotal)} ₽</dd></div><div><dt>Скидка{sale.discountPercent ? ` ${num(sale.discountPercent)}%` : ""}</dt><dd>−{formatMoney(discount)} ₽</dd></div></dl>}
      <div className="pending-payment-controls">
        <div className="pending-payment-methods" role="group" aria-label="Способ оплаты">
          <button type="button" aria-pressed={method === "cash"} disabled={disabled} onClick={() => { setMethod("cash"); clearError(); }}><Banknote size={18} />Наличные</button>
          <button type="button" aria-pressed={method === "transfer"} disabled={disabled} onClick={() => { setMethod("transfer"); clearError(); }}><CreditCard size={18} />Перевод</button>
        </div>
        {method === "cash" ? (
          <div className="pending-payment-fields">
            <label htmlFor={`pending-cash-${sale.id}`}>Получено от клиента</label>
            <div className="pending-cash-input"><input id={`pending-cash-${sale.id}`} value={cashGiven} onChange={(event) => { setCashGiven(event.target.value); clearError(); }} inputMode="decimal" placeholder={formatMoney(total)} disabled={disabled} /><span>₽</span></div>
            <div className="pending-cash-presets">
              <button type="button" disabled={disabled} onClick={() => { setCashGiven(String(total)); clearError(); }}>Без сдачи</button>
              {[500, 1000, 2000, 5000].filter((amount) => amount > total).slice(0, 3).map((amount) => <button type="button" key={amount} disabled={disabled} onClick={() => { setCashGiven(String(amount)); clearError(); }}>{formatMoney(amount)} ₽</button>)}
            </div>
            {cashGiven === "" ? <p className="pending-help">Оставьте поле пустым, если клиент дал точную сумму.</p> : !validAmount ? <p className="pending-invalid" role="alert">Введите корректную сумму</p> : (
              <div className={`pending-change ${insufficient ? "is-short" : ""}`} aria-live="polite"><span>{insufficient ? "Не хватает" : "Сдача клиенту"}</span><strong>{formatMoney(Math.abs(change))} ₽</strong></div>
            )}
          </div>
        ) : (
          <div className="pending-payment-fields">
            <label htmlFor={`pending-card-${sale.id}`}>Счёт для перевода</label>
            <select id={`pending-card-${sale.id}`} value={cardId} onChange={(event) => { setCardId(event.target.value); clearError(); }} disabled={disabled || !cards.length}>
              <option value="">Выберите карту или счёт</option>
              {cards.map((card) => <option key={card.id} value={card.id}>{card.name}{card.owner ? ` · ${card.owner}` : ""}</option>)}
            </select>
            {cardsError ? <p className="pending-invalid" role="alert">{cardsError}</p> : !cards.length ? <p className="pending-help">Добавьте счёт в кассе через «Счета для перевода», затем обновите список.</p> : <p className="pending-help">Убедитесь, что перевод поступил на выбранный счёт.</p>}
          </div>
        )}
        {(validationError || error) && <div className="pending-error" role="alert"><AlertTriangle size={16} /><span>{validationError || error}</span></div>}
        <button type="button" className="pending-primary" onClick={confirm} disabled={disabled || (method === "cash" && (!validAmount || insufficient)) || (method === "transfer" && !cards.length)}>
          {busy ? <><Loader2 size={17} className="animate-spin" />Сохраняем оплату…</> : <><Check size={18} />Принять {formatMoney(total)} ₽</>}
        </button>
        <p className="pending-payment-note">После подтверждения чек появится в продажах.</p>
      </div>
      <div className="pending-detail-footer"><button type="button" disabled={disabled} onClick={() => onCancel(sale)}><Trash2 size={14} />Отменить этот чек</button></div>
    </div>
  );
}

export default function PendingPaymentsWorkspace({ embedded = false, onCloseBlockedChange }) {
  const [list, setList] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const [cardsError, setCardsError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("oldest");
  const [selectedId, setSelectedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [cancelSale, setCancelSale] = useState(null);
  const [cancelError, setCancelError] = useState("");
  const [success, setSuccess] = useState("");
  const operationRef = useRef(false);
  const requestSeq = useRef(0);
  const detailRef = useRef(null);
  const queueRef = useRef(null);

  const load = useCallback(async () => {
    if (operationRef.current) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    const [pending, accounts] = await Promise.allSettled([get("/pending-sales"), get("/cards")]);
    if (seq !== requestSeq.current) return;
    if (pending.status === "fulfilled" && Array.isArray(pending.value)) {
      setList(pending.value);
      setHasLoaded(true);
      setNow(Date.now());
    } else {
      setError(pending.reason?.message || "Не удалось загрузить отложенные чеки. Попробуйте обновить список.");
    }
    if (accounts.status === "fulfilled" && Array.isArray(accounts.value)) {
      setCards(accounts.value);
      setCardsError("");
    } else {
      setCardsError("Не удалось обновить счета. Проверьте соединение и обновите список.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => setNow(Date.now()), 30000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      // This ref is a request counter, not a DOM node. Invalidate its latest value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeq.current++;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const today = businessISO(new Date(now));
  const queue = useMemo(() => [...list].sort((a, b) => (createdTime(a) ?? Infinity) - (createdTime(b) ?? Infinity) || num(a.id) - num(b.id)), [list]);
  const olderCount = queue.filter((sale) => waitingMs(sale, now) >= 30 * 60000).length;
  const todayCount = queue.filter((sale) => createdTime(sale) !== null && businessISO(new Date(createdTime(sale))) === today).length;
  const oldest = queue.find((sale) => createdTime(sale) !== null);
  const totalWaiting = queue.reduce((sum, sale) => sum + num(sale.total), 0);
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    const filtered = queue.filter((sale) => {
      if (filter === "long" && !(waitingMs(sale, now) >= 30 * 60000)) return false;
      if (filter === "today" && (createdTime(sale) === null || businessISO(new Date(createdTime(sale))) !== today)) return false;
      const terms = [String(sale.id), `#${sale.id}`, sellerOf(sale), ...itemsOf(sale).map((item) => item.name || item.productName || "")];
      return !search || terms.some((term) => term.toLowerCase().includes(search));
    });
    if (sort === "newest") return filtered.sort((a, b) => (createdTime(b) ?? -Infinity) - (createdTime(a) ?? -Infinity) || num(b.id) - num(a.id));
    if (sort === "amount") return filtered.sort((a, b) => num(b.total) - num(a.total));
    return filtered;
  }, [query, filter, queue, sort, now, today]);
  const activeSale = visible.find((sale) => sale.id === selectedId) || null;
  const busy = busyId !== null;
  const stale = !!error;

  useEffect(() => {
    onCloseBlockedChange?.(busy || cancelSale !== null);
    return () => onCloseBlockedChange?.(false);
  }, [busy, cancelSale, onCloseBlockedChange]);

  const selectSale = (sale) => {
    if (operationRef.current) return;
    setSelectedId(sale.id);
    setActionError(null);
    if (embedded && window.matchMedia("(min-width: 901px)").matches) {
      detailRef.current?.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => {
        detailRef.current?.focus({ preventScroll: true });
        detailRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      });
    }
  };
  const beginOperation = (id) => {
    if (operationRef.current) return false;
    operationRef.current = true;
    requestSeq.current++;
    setLoading(false);
    setBusyId(id);
    setSelectedId(id);
    setSuccess("");
    setActionError(null);
    onCloseBlockedChange?.(true);
    return true;
  };
  const finishOperation = () => {
    operationRef.current = false;
    setBusyId(null);
  };
  const removeFromQueue = (id) => {
    setSelectedId(null);
    setList((previous) => previous.filter((sale) => sale.id !== id));
    window.dispatchEvent(new Event("sales-pending-change"));
  };
  const confirmPayment = async (sale, payment) => {
    if (!beginOperation(sale.id)) return;
    try {
      await post(`/pending-sales/${sale.id}/confirm`, payment);
      removeFromQueue(sale.id);
      setSuccess(`Чек №${sale.id} оплачен · ${formatMoney(sale.total)} ₽ · ${payment.paymentType === "cash" ? "наличные" : "перевод"}`);
    } catch (error) {
      setActionError({ id: sale.id, message: error?.message || "Не удалось принять оплату. Обновите список и проверьте статус чека." });
    } finally {
      finishOperation();
    }
  };
  const cancel = async () => {
    if (!cancelSale || !beginOperation(cancelSale.id)) return;
    setCancelError("");
    try {
      await del(`/pending-sales/${cancelSale.id}`);
      removeFromQueue(cancelSale.id);
      setSuccess(`Чек №${cancelSale.id} отменён`);
      setCancelSale(null);
    } catch (error) {
      setCancelError(error?.message || "Не удалось отменить чек. Попробуйте снова.");
    } finally {
      finishOperation();
    }
  };
  const resetFilters = () => { setQuery(""); setFilter("all"); };

  return (
    <div className={`pending-workspace ${embedded ? "is-embedded" : "pb-nav sm:pb-10"}`}>
      <header className="pending-page-heading">
        <div>
          <p className="pending-eyebrow">{embedded ? "Отложенные заказы" : "Касса / отложенные заказы"}</p>
          {embedded ? <h2>К оплате</h2> : <h1>К оплате</h1>}
          <p className="pending-subtitle">Собранные заказы, по которым ещё нужно принять оплату.</p>
        </div>
        <div className="pending-page-actions">
          <button type="button" onClick={load} className="pending-button" disabled={loading || busy || !!cancelSale} aria-label="Обновить список"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /><span>Обновить</span></button>
          {!embedded && <NavLink to="/pos" className="pending-button pending-new-sale" onClick={(event) => { if (operationRef.current) event.preventDefault(); }} aria-disabled={busy}><Plus size={17} />Новый заказ</NavLink>}
        </div>
      </header>
      <section className="pending-metrics" aria-label="Сводка ожидания">
        <div className="bg-white/[0.02]"><span><Receipt size={16} />Ожидают оплаты</span><strong>{!hasLoaded ? "—" : queue.length}<small>шт.</small></strong><p>Все отложенные заказы</p></div>
        <div className="bg-white/[0.02]"><span><Banknote size={16} />К получению</span><strong>{!hasLoaded ? "—" : formatMoney(totalWaiting)}<small>₽</small></strong><p>Сумма с учётом скидок</p></div>
        <div className="bg-white/[0.02]"><span><Clock size={16} />Самое долгое ожидание</span><strong className="pending-waiting-value">{oldest ? waitingLabel(waitingMs(oldest, now)) : "—"}</strong><p>{oldest ? `Чек №${oldest.id} · ${dateLabel(oldest)}` : hasLoaded ? "Очередь свободна" : "Данные ещё не загружены"}</p></div>
      </section>
      {error && <div className="pending-error" role="alert"><AlertTriangle size={18} /><span>{error}{hasLoaded ? " На экране последние загруженные данные." : ""}</span></div>}
      {success && <div className="pending-success" role="status"><CheckCircle2 size={19} /><span>{success}</span><button type="button" onClick={() => setSuccess("")} aria-label="Скрыть сообщение"><X size={16} /></button></div>}
      <div className="pending-body">
        <section className="pending-queue" ref={queueRef} aria-label="Очередь чеков">
          <div className="pending-queue-toolbar">
            <label className="pending-search bg-white/[0.02]"><Search size={17} /><input aria-label="Поиск отложенного чека" placeholder="Номер чека, товар или продавец…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={busy} />{query && <button type="button" onClick={() => setQuery("")} disabled={busy} aria-label="Очистить поиск"><X size={16} /></button>}</label>
            <select aria-label="Сортировка чеков" value={sort} onChange={(event) => setSort(event.target.value)} disabled={busy}><option value="oldest">Сначала старые</option><option value="newest">Сначала новые</option><option value="amount">По сумме</option></select>
          </div>
          <div className="pending-queue-filters" role="group" aria-label="Фильтр ожидания">
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} disabled={busy}>Все<span>{queue.length}</span></button>
            <button type="button" aria-pressed={filter === "today"} onClick={() => setFilter("today")} disabled={busy}>За сегодня<span>{todayCount}</span></button>
            <button type="button" aria-pressed={filter === "long"} onClick={() => setFilter("long")} disabled={busy}><Clock size={13} />30 мин и дольше<span>{olderCount}</span></button>
          </div>
          <div className="pending-queue-heading"><h2>Очередь<span>{visible.length}</span></h2><span>Выберите чек для оплаты</span></div>
          {loading && !hasLoaded ? (
            <div className="pending-queue-list" role="status" aria-label="Загрузка чеков">{Array.from({ length: 3 }, (_, index) => <div key={index} className="pending-skeleton bg-white/[0.02] animate-pulse" />)}</div>
          ) : visible.length ? (
            <div className="pending-queue-list">
              {visible.map((sale) => {
                const age = waitingMs(sale, now);
                const items = itemsOf(sale);
                const selected = activeSale?.id === sale.id;
                return (
                  <button type="button" key={sale.id} onClick={() => selectSale(sale)} aria-pressed={selected} aria-label={`Открыть чек №${sale.id}`} disabled={busy} className="pending-queue-card bg-white/[0.02] shadow-sm">
                    <div className="pending-queue-card-top">
                      <span className="pending-ticket-number"><Receipt size={16} />Чек №{sale.id}</span>
                      <span className={`pending-age ${age >= 30 * 60000 ? "is-long" : ""}`}><Clock size={12} />{waitingLabel(age)}</span>
                    </div>
                    <div className="pending-queue-card-middle">
                      <div>
                        <strong>{formatMoney(sale.total)}<small>₽</small></strong>
                        <p>
                          {items.length ? items.slice(0, 2).map((item) => `${prettyName(item.name || item.productName)} × ${quantityOf(item)}`).join(" · ") : "Состав не сохранён"}
                          {items.length > 2 ? ` · ещё ${items.length - 2}` : ""}
                        </p>
                      </div>
                      <span className="pending-select-indicator">{selected ? <Check size={17} /> : <ChevronRight size={18} />}</span>
                    </div>
                    <div className="pending-queue-card-bottom">
                      <span><UserRound size={12} />{sellerOf(sale)}</span><span>{dateLabel(sale)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="pending-empty bg-white/[0.02]">
              {error && !hasLoaded ? (
                <>
                  <AlertTriangle size={32} />
                  <h3>Чеки пока недоступны</h3>
                  <p>Обновите список после восстановления связи.</p>
                  <button type="button" className="pending-button" onClick={load} disabled={loading}>Попробовать снова</button>
                </>
              ) : query || filter !== "all" ? (
                <>
                  <Search size={30} />
                  <h3>Подходящих чеков нет</h3>
                  <p>Попробуйте другой запрос или сбросьте фильтр.</p>
                  <button type="button" className="pending-button" onClick={resetFilters}>Показать все чеки</button>
                </>
              ) : (
                <>
                  <CheckCircle2 size={34} />
                  <h3>Очередь свободна</h3>
                  <p>Отложите заказ в кассе — он появится здесь для последующей оплаты.</p>
                  {!embedded && <NavLink to="/pos" className="pending-button">Перейти в кассу<ArrowRight size={16} /></NavLink>}
                </>
              )}
            </div>
          )}
          {visible.length > 0 && <p className="pending-queue-note">Счётчик ожидания обновляется автоматически. Список можно обновить кнопкой вверху.</p>}
        </section>
        <section className="pending-details" ref={detailRef} tabIndex={-1} aria-label="Выбранный чек">
          {activeSale ? (
            <PaymentDetails
              key={activeSale.id}
              sale={activeSale}
              cards={cards}
              cardsError={cardsError}
              now={now}
              busy={busy}
              blocked={stale || loading}
              error={actionError?.id === activeSale.id ? actionError.message : ""}
              onConfirm={confirmPayment}
              onClearError={() => setActionError(null)}
              onCancel={(sale) => { setCancelError(""); setCancelSale(sale); }}
              onBack={() => queueRef.current?.scrollIntoView({ block: "start", behavior: "auto" })}
            />
          ) : <div className="pending-detail-placeholder bg-white/[0.02]"><Receipt size={36} strokeWidth={1.3} /><h3>Заказ под рукой</h3><p>Выберите чек в очереди, чтобы увидеть состав и принять оплату.</p></div>}
        </section>
      </div>
      {cancelSale && (
        <Modal title={`Отменить чек №${cancelSale.id}?`} legacyLight={false} zIndex={70} onClose={() => { if (!operationRef.current) setCancelSale(null); }}>
          <div className="pending-cancel-summary"><Receipt size={23} /><strong>{formatMoney(cancelSale.total)} ₽</strong><span>{sellerOf(cancelSale)}</span></div>
          <p className="pending-cancel-explanation">Чек исчезнет из ожидания. Зарезервированные товары вернутся в остатки склада.</p>
          {cancelError && <div className="pending-error" role="alert"><AlertTriangle size={16} /><span>{cancelError}</span></div>}
          <div className="pending-cancel-actions"><button type="button" className="pending-button" onClick={() => setCancelSale(null)} disabled={busy}>Оставить чек</button><button type="button" className="pending-button pending-cancel-confirm" onClick={cancel} disabled={busy}>{busy ? "Отменяем…" : "Отменить чек"}</button></div>
        </Modal>
      )}
    </div>
  );
}
