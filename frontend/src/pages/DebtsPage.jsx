import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  AlertTriangle, Archive, ArrowDownLeft, ArrowLeft, ArrowRight, Banknote, Check,
  CheckCircle2, ChevronRight, Clock, CreditCard, History, Loader2, Plus,
  ReceiptText, RefreshCw, RotateCcw, Search, Users, Wallet, X,
} from "lucide-react";
import { del, get, post } from "../api";
import Modal from "../components/Modal";
import { formatMoney, num } from "../utils/format";
import { buildDebtCustomers, debtTimestamp } from "../utils/debts";
import "./DebtsPage.css";

const formatDate = (value) => {
  const timestamp = typeof value === "number" ? value : debtTimestamp(value);
  return timestamp === null ? "Дата не указана" : new Date(timestamp).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
};
const ageLabel = (days) => {
  if (days === null) return "Дата не указана";
  if (days === 0) return "Сегодня";
  const last = days % 10;
  const lastTwo = days % 100;
  const unit = last === 1 && lastTwo !== 11 ? "день" : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "дня" : "дней";
  return `${days} ${unit}`;
};
const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const parseAmount = (value) => Number(String(value).trim().replace(/\s/g, "").replace(",", "."));

function CustomerLedger({ customer, blocked, onPay, onReverse, onBack }) {
  const [tab, setTab] = useState("all");
  const events = [
    ...customer.records.map((record) => ({ ...record, kind: "purchase", key: `debt-${record.id}` })),
    ...customer.payments.map((payment) => ({ ...payment, kind: "payment", key: `payment-${payment.id}` })),
  ].filter((event) => tab === "all" || event.kind === tab)
    .sort((a, b) => (debtTimestamp(b.createdAt) ?? -Infinity) - (debtTimestamp(a.createdAt) ?? -Infinity) || num(b.id) - num(a.id));

  return (
    <div className="debt-ledger bg-white/[0.02] shadow-sm backdrop-blur-xl">
      <div className="debt-ledger-heading">
        <span className="debt-avatar" aria-hidden="true">{initials(customer.name)}</span>
        <div><p className="debt-eyebrow">Карточка клиента</p><h2>{customer.name}</h2></div>
        <button type="button" className="debt-icon-button debt-back" onClick={onBack} disabled={blocked} aria-label="К списку клиентов"><ArrowLeft size={18} /></button>
      </div>
      <div className="debt-balance">
        <span>{customer.isPaid ? "Все долги погашены" : "Остаток долга"}</span>
        <strong className={customer.isPaid ? "is-settled" : ""}>{formatMoney(customer.remaining)}<small>₽</small></strong>
        <div className="debt-progress" role="progressbar" aria-label="Погашенная часть долга" aria-valuenow={Math.round(customer.percentPaid)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${customer.percentPaid}%` }} /></div>
        <div className="debt-balance-breakdown"><span>Покупки в долг<strong>{formatMoney(customer.borrowed)} ₽</strong></span><span>Погашено<strong>{formatMoney(customer.paid)} ₽</strong></span></div>
        {!customer.isPaid && <p className="debt-first-purchase"><Clock size={13} />Первая открытая покупка · {customer.firstOpenAt === null ? "дата не указана" : formatDate(customer.firstOpenAt)}</p>}
        {customer.remaining > 0 ? (
          <button type="button" className="debt-primary" onClick={() => onPay(customer)} disabled={blocked || customer.id <= 0}><Plus size={17} />Записать погашение</button>
        ) : <p className="debt-settled-message"><CheckCircle2 size={16} />Клиент полностью рассчитался</p>}
        {customer.id <= 0 && <p className="debt-help">В старой записи не указан клиент. Проверьте исходный чек.</p>}
      </div>
      <div className="debt-history-heading"><h3><History size={16} />История операций</h3><span>{customer.records.length + customer.payments.length}</span></div>
      <div className="debt-history-tabs" role="group" aria-label="История клиента">
        <button type="button" aria-pressed={tab === "all"} onClick={() => setTab("all")}>Все</button>
        <button type="button" aria-pressed={tab === "purchase"} onClick={() => setTab("purchase")}>Покупки<span>{customer.records.length}</span></button>
        <button type="button" aria-pressed={tab === "payment"} onClick={() => setTab("payment")}>Погашения<span>{customer.payments.length}</span></button>
      </div>
      <div className="debt-history-list">
        {events.length ? events.map((event) => (
          <article className={`debt-event is-${event.kind}`} key={event.key}>
            <div className="debt-event-heading">
              <span className="debt-event-icon">{event.kind === "payment" ? <ArrowDownLeft size={17} /> : <ReceiptText size={17} />}</span>
              <div><h4>{event.kind === "payment" ? "Погашение долга" : "Покупка в долг"}</h4><p>{formatDate(event.createdAt)}{event.kind === "purchase" && event.saleId ? ` · чек №${event.saleId}` : ""}</p></div>
              <strong>{event.kind === "payment" ? "−" : "+"}{formatMoney(event.amount)} ₽</strong>
            </div>
            {event.kind === "payment" ? (
              <div className="debt-event-payment">
                <span>{event.method === "transfer" ? <CreditCard size={13} /> : <Banknote size={13} />}{event.method === "transfer" ? "Перевод" : "Наличные"}{event.createdBy ? ` · ${event.createdBy}` : ""}</span>
                {event.note && <p>{event.note}</p>}
                <button type="button" onClick={() => onReverse(event, customer)} disabled={blocked} aria-label={`Отменить погашение №${event.id}`}><RotateCcw size={13} />Отменить погашение</button>
              </div>
            ) : (
              <div className="debt-event-purchase">
                {Array.isArray(event.items) && event.items.length > 0 ? (
                  <details><summary>Состав покупки · {event.items.length} поз.</summary><ul>{event.items.map((item, index) => <li key={index}><span>{item.name || "Товар"} × {num(item.qty ?? 1)}</span><span>{formatMoney(item.total ?? num(item.price) * num(item.qty ?? 1))} ₽</span></li>)}</ul></details>
                ) : <p>Состав покупки не сохранён</p>}
                {event.status === "paid" && <span className="debt-legacy-settled"><Check size={12} />Закрыт ранее</span>}
              </div>
            )}
          </article>
        )) : <div className="debt-history-empty"><History size={24} /><p>В этой вкладке пока нет операций.</p></div>}
      </div>
    </div>
  );
}

function RepaymentForm({ customer, busy, error, onSave, onClose }) {
  const [amount, setAmount] = useState(String(customer.remaining));
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState("");
  const value = parseAmount(amount);
  const valid = amount.trim() !== "" && Number.isFinite(value) && value > 0;
  const excessive = valid && value > customer.remaining + 0.005;
  const remaining = valid && !excessive ? Math.max(0, Number((customer.remaining - value).toFixed(2))) : customer.remaining;

  const save = () => {
    if (!valid || excessive) {
      setValidationError(excessive ? "Сумма больше остатка долга" : "Введите сумму больше нуля");
      return;
    }
    onSave(customer, { customerId: customer.id, amount: value, method, date: date || undefined, note: note.trim() });
  };

  return (
    <Modal title="Записать погашение" section={customer.name} legacyLight={false} onClose={onClose}>
      <div className="debt-repayment-summary"><span>Остаток долга</span><strong>{formatMoney(customer.remaining)} ₽</strong></div>
      <div className="debt-form-field">
        <label htmlFor="debt-payment-amount">Сколько вернул клиент</label>
        <div className="debt-amount-input"><input id="debt-payment-amount" value={amount} onChange={(event) => { setAmount(event.target.value); setValidationError(""); }} inputMode="decimal" disabled={busy} /><span>₽</span></div>
        <div className="debt-amount-presets"><button type="button" disabled={busy} onClick={() => { setAmount(String(customer.remaining)); setValidationError(""); }}>Весь остаток</button>{customer.remaining > .01 && <button type="button" disabled={busy} onClick={() => { setAmount(String(Number((customer.remaining / 2).toFixed(2)))); setValidationError(""); }}>Половина</button>}</div>
        {(!valid || excessive) && amount.trim() !== "" && <p className="debt-invalid" role="alert">{excessive ? "Сумма больше остатка долга" : "Введите сумму больше нуля"}</p>}
      </div>
      <div className="debt-methods" role="group" aria-label="Способ погашения">
        <button type="button" aria-pressed={method === "cash"} disabled={busy} onClick={() => setMethod("cash")}><Banknote size={18} />Наличные</button>
        <button type="button" aria-pressed={method === "transfer"} disabled={busy} onClick={() => setMethod("transfer")}><CreditCard size={18} />Перевод</button>
      </div>
      <p className="debt-help">{method === "cash" ? "Наличные учитываются в кассе на дату погашения." : "Перевод учитывается как безналичное погашение."}</p>
      <div className="debt-form-field">
        <label htmlFor="debt-payment-date">Дата погашения<span>Необязательно</span></label>
        <input
          id="debt-payment-date"
          type="date"
          value={date}
          onInput={(event) => setDate(event.currentTarget.value)}
          onChange={(event) => setDate(event.target.value)}
          disabled={busy}
        />
        <p className="debt-help">Пустая дата — текущий момент. При выборе даты платёж будет записан за этот день.</p>
      </div>
      <div className="debt-form-field"><label htmlFor="debt-payment-note">Комментарий<span>Необязательно</span></label><input id="debt-payment-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например, часть долга за прошлую неделю" disabled={busy} /></div>
      <div className="debt-after-payment"><span>Останется после оплаты</span><strong>{formatMoney(remaining)} ₽</strong></div>
      {(error || validationError) && <div className="debt-error" role="alert"><AlertTriangle size={16} /><span>{error || validationError}</span></div>}
      <div className="debt-modal-actions"><button type="button" className="debt-button" onClick={onClose} disabled={busy}>Отмена</button><button type="button" className="debt-primary" onClick={save} disabled={busy || !valid || excessive}>{busy ? <><Loader2 size={17} className="animate-spin" />Сохраняем…</> : "Записать оплату"}</button></div>
    </Modal>
  );
}

export default function DebtsPage() {
  const [data, setData] = useState({ customers: [], debts: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("remaining");
  const [olderOnly, setOlderOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [payCustomerId, setPayCustomerId] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [success, setSuccess] = useState("");
  const operationRef = useRef(false);
  const requestSeq = useRef(0);
  const ledgerRef = useRef(null);
  const listRef = useRef(null);
  const openDialogRef = useRef(false);
  useEffect(() => { openDialogRef.current = payCustomerId !== null || review !== null; }, [payCustomerId, review]);

  const load = useCallback(async ({ allowBusy = false } = {}) => {
    if (operationRef.current && !allowBusy) return false;
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError("");
    try {
      const [customers, debts, payments] = await Promise.all([get("/debt-customers"), get("/debts"), get("/debt-payments")]);
      if (seq !== requestSeq.current) return false;
      if (![customers, debts, payments].every(Array.isArray)) throw new Error("Сервер вернул неполные данные. Обновите список.");
      setData({ customers, debts, payments });
      setHasLoaded(true);
      setNow(Date.now());
      return true;
    } catch (error) {
      if (seq === requestSeq.current) setLoadError(error?.message || "Не удалось загрузить долги. Проверьте соединение.");
      return false;
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => setNow(Date.now()), 60000);
    const onVisible = () => { if (!document.hidden && !openDialogRef.current) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      // This ref is a counter. Invalidate the latest request, not a captured value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeq.current++;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const customers = useMemo(() => buildDebtCustomers(data, now), [data, now]);
  const debtors = customers.filter((customer) => customer.remaining > 0);
  const settled = customers.filter((customer) => customer.isPaid);
  const total = debtors.reduce((sum, customer) => sum + customer.remaining, 0);
  const repaid = customers.reduce((sum, customer) => sum + customer.paid, 0);
  const oldest = debtors.filter((customer) => customer.ageDays !== null).sort((a, b) => b.ageDays - a.ageDays)[0];
  const oldestCaption = !hasLoaded
    ? (loadError ? "Нет данных" : "Загружаем данные")
    : oldest?.name || (debtors.length ? "Дата покупки не указана" : "Открытых долгов нет");
  const olderCount = debtors.filter((customer) => customer.ageDays >= 30).length;
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = customers.filter((customer) => {
      if (search && !customer.name.toLowerCase().includes(search)) return false;
      if (filter === "debtors" && customer.isPaid) return false;
      if (filter === "paid" && !customer.isPaid) return false;
      if (olderOnly && !(customer.remaining > 0 && customer.ageDays >= 30)) return false;
      return true;
    });
    if (sort === "name") return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (sort === "age") return rows.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
    return rows.sort((a, b) => b.remaining - a.remaining || (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  }, [customers, query, filter, olderOnly, sort]);
  const selectedCustomer = visible.find((customer) => customer.id === selectedId) || null;
  const payCustomer = customers.find((customer) => customer.id === payCustomerId) || null;
  const blocked = busy || loading || !!loadError;
  const hasFilters = !!query || filter !== "all" || olderOnly;

  const selectCustomer = (customer) => {
    if (operationRef.current) return;
    setSelectedId(customer.id);
    if (window.matchMedia("(max-width: 1000px)").matches) {
      requestAnimationFrame(() => {
        ledgerRef.current?.focus({ preventScroll: true });
        ledgerRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      });
    }
  };
  const openPay = (customer) => {
    if (blocked || customer.remaining <= 0 || customer.id <= 0) return;
    setOperationError("");
    setSuccess("");
    setPayCustomerId(customer.id);
  };
  const closeDialog = () => {
    if (operationRef.current) return;
    setPayCustomerId(null);
    setReview(null);
    setOperationError("");
  };
  const perform = async (request, afterSuccess) => {
    if (operationRef.current) return;
    operationRef.current = true;
    requestSeq.current++;
    setLoading(false);
    setBusy(true);
    setOperationError("");
    setSuccess("");
    try {
      await request();
      afterSuccess();
      setPayCustomerId(null);
      setReview(null);
      await load({ allowBusy: true });
    } catch (error) {
      setOperationError(error?.message || "Не удалось выполнить операцию. Проверьте историю перед повтором.");
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  };
  const savePayment = (customer, payment) => perform(
    () => post("/debt-payments", payment),
    () => setSuccess(`Погашение записано · ${customer.name} · ${formatMoney(payment.amount)} ₽`)
  );
  const confirmReview = () => {
    if (!review) return;
    if (review.kind === "archive") {
      perform(() => del("/debts/history"), () => { setSuccess("Полностью погашенные клиенты скрыты из списка"); setSelectedId(null); });
    } else {
      perform(() => del(`/debt-payments/${review.payment.id}`), () => setSuccess(`Погашение отменено · ${review.customer.name} · ${formatMoney(review.payment.amount)} ₽`));
    }
  };
  const resetFilters = () => { setQuery(""); setFilter("all"); setOlderOnly(false); };

  return (
    <div className="debts-page pb-nav sm:pb-10">
      <header className="debts-page-heading">
        <div><p className="debt-eyebrow">Клиенты / взаиморасчёты</p><h1>Долги клиентов</h1><p className="debt-subtitle">Остатки, покупки и возвраты — вся история по каждому клиенту.</p></div>
        <div className="debt-page-actions">
          <button type="button" className="debt-button" onClick={() => load()} disabled={busy || loading} aria-label="Обновить долги"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /><span>Обновить</span></button>
          <button type="button" className="debt-button" disabled={blocked || !settled.length} onClick={() => { setOperationError(""); setReview({ kind: "archive" }); }}><Archive size={16} /><span>Скрыть погашенных</span></button>
        </div>
      </header>
      <section className="debt-metrics" aria-label="Сводка долгов">
        <div className="bg-white/[0.02]">
          <span><Wallet size={16} />Вам должны</span>
          <strong>{hasLoaded ? formatMoney(total) : "—"}<small>₽</small></strong>
          <p>Текущий остаток по клиентам</p>
        </div>
        <div className="bg-white/[0.02]">
          <span><Users size={16} />Клиентов с долгом</span>
          <strong>{hasLoaded ? debtors.length : "—"}</strong>
          <p>{hasLoaded ? `Из ${customers.length} в списке` : "Количество пока неизвестно"}</p>
        </div>
        <div className="bg-white/[0.02]">
          <span><ArrowDownLeft size={16} />Погашено</span>
          <strong className="debt-positive">{hasLoaded ? formatMoney(repaid) : "—"}<small>₽</small></strong>
          <p>По клиентам в текущем списке</p>
        </div>
        <div className="bg-white/[0.02]">
          <span><Clock size={16} />Первая открытая покупка</span>
          <strong className="debt-age-value">{oldest ? ageLabel(oldest.ageDays) : "—"}</strong>
          <p>{oldestCaption}</p>
        </div>
      </section>
      {loadError && <div className="debt-error" role="alert"><AlertTriangle size={18} /><span>{loadError}{hasLoaded ? " Показаны последние загруженные данные." : ""}</span></div>}
      {success && <div className="debt-success" role="status"><CheckCircle2 size={18} /><span>{success}</span><button type="button" onClick={() => setSuccess("")} aria-label="Скрыть сообщение"><X size={16} /></button></div>}
      <div className="debts-body">
        <section className="debt-customers" ref={listRef} aria-label="Список клиентов">
          <div className="debt-toolbar">
            <label className="debt-search bg-white/[0.02]"><Search size={18} /><input aria-label="Найти клиента" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти клиента по имени…" disabled={busy} />{query && <button type="button" onClick={() => setQuery("")} disabled={busy} aria-label="Очистить поиск"><X size={16} /></button>}</label>
            <select aria-label="Сортировка клиентов" value={sort} onChange={(event) => setSort(event.target.value)} disabled={busy}><option value="remaining">По остатку долга</option><option value="age">По давности покупки</option><option value="name">По имени</option></select>
          </div>
          <div className="debt-list-filters" role="group" aria-label="Фильтр клиентов">
            {[{ key: "all", label: "Все", count: customers.length }, { key: "debtors", label: "С долгом", count: debtors.length }, { key: "paid", label: "Погашены", count: settled.length }].map(({ key, label, count }) => <button type="button" key={key} aria-pressed={filter === key} disabled={busy} onClick={() => { setFilter(key); setOlderOnly(false); }}>{label}<span>{count}</span></button>)}
          </div>
          <button type="button" className="debt-age-filter" aria-pressed={olderOnly} disabled={busy} onClick={() => { setOlderOnly((value) => !value); setFilter("all"); }}><Clock size={14} /><span>Первая покупка 30+ дней назад</span><b>{olderCount}</b>{olderOnly && <X size={13} />}</button>
          <div className="debt-list-heading"><h2>Клиенты<span>{visible.length}</span></h2><span>Выберите клиента для работы с долгом</span></div>
          {loading && !hasLoaded ? (
            <div className="debt-customer-list" role="status" aria-label="Загрузка клиентов">{Array.from({ length: 4 }, (_, index) => <div key={index} className="debt-skeleton bg-white/[0.02] animate-pulse" />)}</div>
          ) : visible.length ? (
            <div className="debt-customer-list">
              {visible.map((customer) => <button type="button" key={customer.id} className="debt-customer-row bg-white/[0.02] shadow-sm" aria-pressed={selectedCustomer?.id === customer.id} aria-label={`Открыть клиента ${customer.name}`} disabled={busy} onClick={() => selectCustomer(customer)}>
                <span className="debt-avatar" aria-hidden="true">{initials(customer.name)}</span>
                <span className="debt-customer-name"><strong>{customer.name}</strong><span>{customer.isPaid ? <><CheckCircle2 size={12} />Долг погашен</> : <><Clock size={12} />Первая покупка · {ageLabel(customer.ageDays).toLowerCase()}</>}</span><small>Покупок · {customer.records.length} / погашений · {customer.payments.length}</small></span>
                <span className="debt-customer-balance"><strong className={customer.isPaid ? "debt-positive" : ""}>{formatMoney(customer.remaining)}<small>₽</small></strong><span>Погашено {formatMoney(customer.paid)} ₽</span></span>
                <span className="debt-row-indicator"><ChevronRight size={18} /></span>
              </button>)}
            </div>
          ) : (
            <div className="debt-empty bg-white/[0.02]">
              {loadError && !hasLoaded ? (
                <>
                  <AlertTriangle size={32} />
                  <h3>Данные пока недоступны</h3>
                  <p>Обновите список после восстановления соединения.</p>
                  <button type="button" className="debt-button" disabled={loading} onClick={() => load()}>Попробовать снова</button>
                </>
              ) : hasFilters ? (
                <>
                  <Search size={30} />
                  <h3>Клиенты не найдены</h3>
                  <p>Измените запрос или сбросьте фильтры.</p>
                  <button type="button" className="debt-button" onClick={resetFilters}>Показать всех</button>
                </>
              ) : (
                <>
                  <CheckCircle2 size={34} />
                  <h3>Здесь пока нет долгов</h3>
                  <p>Покупки с оплатой в долг появятся здесь после оформления в кассе.</p>
                  <NavLink to="/pos" className="debt-button">Перейти в кассу<ArrowRight size={16} /></NavLink>
                </>
              )}
            </div>
          )}
          <p className="debt-list-note">Давность считается от первой открытой покупки клиента. Погашения уменьшают его общий остаток.</p>
        </section>
        <section className="debt-customer-detail" ref={ledgerRef} tabIndex={-1} aria-label="Карточка выбранного клиента">
          {selectedCustomer ? (
            <CustomerLedger
              key={selectedCustomer.id}
              customer={selectedCustomer}
              blocked={blocked}
              onPay={openPay}
              onReverse={(payment, customer) => {
                setOperationError("");
                setReview({ kind: "reverse", payment, customer });
              }}
              onBack={() => listRef.current?.scrollIntoView({ block: "start", behavior: "auto" })}
            />
          ) : (
            <div className="debt-detail-placeholder bg-white/[0.02]">
              <Users size={38} strokeWidth={1.3} />
              <h3>Вся история клиента</h3>
              <p>Выберите клиента, чтобы посмотреть покупки, проверить остаток и записать погашение.</p>
            </div>
          )}
        </section>
      </div>
      {payCustomer && <RepaymentForm key={payCustomer.id} customer={payCustomer} busy={busy} error={operationError} onSave={savePayment} onClose={closeDialog} />}
      {review && (
        <Modal title={review.kind === "archive" ? "Скрыть погашенных клиентов?" : "Отменить погашение?"} section={review.kind === "reverse" ? review.customer.name : "История долгов"} legacyLight={false} onClose={closeDialog}>
          {review.kind === "archive" ? (
            <div className="debt-review-content">
              <Archive size={30} />
              <h3>Клиентов · {settled.length}</h3>
              <p>Полностью погашенные клиенты будут скрыты. Их платежи сохранятся в кассе и финансовых отчётах. Новая покупка в долг вернёт клиента в список.</p>
            </div>
          ) : (
            <div className="debt-review-content">
              <RotateCcw size={28} />
              <strong>{formatMoney(review.payment.amount)} ₽</strong>
              <p>Погашение от {formatDate(review.payment.createdAt)} будет отменено. Остаток долга увеличится на эту сумму.{review.payment.method !== "transfer" ? " Наличные в кассе также пересчитаются." : ""}</p>
            </div>
          )}
          {operationError && <div className="debt-error" role="alert"><AlertTriangle size={16} /><span>{operationError}</span></div>}
          <div className="debt-modal-actions"><button type="button" className="debt-button" onClick={closeDialog} disabled={busy}>Назад</button><button type="button" className="debt-button debt-destructive" onClick={confirmReview} disabled={busy}>{busy ? "Сохраняем…" : review.kind === "archive" ? "Скрыть погашенных" : "Отменить погашение"}</button></div>
        </Modal>
      )}
    </div>
  );
}
