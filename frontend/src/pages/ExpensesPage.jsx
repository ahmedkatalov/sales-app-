import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowDownLeft, ArrowRight, Banknote, CalendarDays, CheckCircle2,
  ChevronDown, CreditCard, FileText, Loader2, Paperclip, Plus, ReceiptText,
  RefreshCw, Search, Settings2, SlidersHorizontal, Trash2, User, Wallet, X,
} from "lucide-react";
import { del, get, post, put } from "../api";
import Modal from "../components/Modal";
import { ExpenseError, ExpenseForm, ExpensePhotoViewer, OpeningBalancesForm, OwnerEntryForm } from "../components/ExpenseDialogs";
import { formatMoney, num } from "../utils/format";
import {
  BASE_PRODUCT_TYPE, expenseDay, expensePeriod, expenseSource, filterExpenses,
  HOUSEHOLD_TYPES, OWNER_KINDS, SOURCE_LABELS, summarizeExpenses,
} from "../utils/expenses";
import "./ExpensesPage.css";

const SOURCE_ICONS = { cash: Banknote, card: CreditCard, owner: User };
const categoryLabel = (category) => category === "products" ? "Продукты" : category === "household" || !category ? "Бытовые" : "Другое";
const dateLabel = (value, short = false) => {
  if (!value) return "Дата не указана";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("ru-RU", { day: "numeric", month: short ? "short" : "long", year: "numeric" }) : "Дата не указана";
};
const periodLabel = ({ from, to }) => from && to ? `${dateLabel(from, true)} — ${dateLabel(to, true)}` : from ? `С ${dateLabel(from)}` : to ? `По ${dateLabel(to)}` : "За всё время";
const recordCount = (count) => {
  const last = count % 10, lastTwo = count % 100;
  const unit = last === 1 && lastTwo !== 11 ? "запись" : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "записи" : "записей";
  return `${count} ${unit}`;
};

function ExpensePeriodPicker({ period, customDates, busy, onChange, onCustomDates }) {
  const changeDate = (key, value) => onChange({ ...period, [key]: value });
  return (
    <section className="expense-period" aria-label="Период расходов">
      <div className="expense-period-presets">
        {[["month", "Этот месяц"], ["today", "Сегодня"], ["previous", "Прошлый месяц"], ["all", "Всё время"]].map(([key, label]) => {
          const dates = expensePeriod(key);
          return (
            <button
              type="button" key={key} disabled={busy}
              aria-pressed={period.from === dates.from && period.to === dates.to}
              onClick={() => { onChange(dates); onCustomDates(false); }}
            >{label}</button>
          );
        })}
      </div>
      <button type="button" className="expense-button expense-period-custom" disabled={busy} aria-expanded={customDates} onClick={() => onCustomDates(!customDates)}>
        <CalendarDays size={16} />{periodLabel(period)}<ChevronDown size={14} />
      </button>
      {customDates && (
        <div className="expense-date-range">
          {[["from", "С даты"], ["to", "По дату"]].map(([key, label]) => (
            <label key={key}>{label}
              <input
                type="date" value={period[key]} disabled={busy}
                onInput={(event) => changeDate(key, event.currentTarget.value)}
                onChange={(event) => changeDate(key, event.target.value)}
                aria-label={label}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function ExpenseOverview({ summary, available, source, busy, onSource }) {
  return (
    <section className="expense-overview" aria-label="Расходы за период">
      <div className="expense-total expense-panel bg-white/[0.02] shadow-sm">
        <span className="expense-eyebrow">Потрачено за период</span>
        <strong>{available ? formatMoney(summary.total) : "—"}<small>₽</small></strong>
        <p>{available ? `${recordCount(summary.count)} · все категории и источники` : "Данные за период недоступны"}</p>
      </div>
      {Object.entries(SOURCE_LABELS).map(([key, label]) => {
        const Icon = SOURCE_ICONS[key];
        const share = summary.total > 0 ? summary.sources[key] / summary.total * 100 : 0;
        return (
          <button
            type="button" key={key} className={`expense-source-card expense-panel bg-white/[0.02] is-${key}`}
            aria-pressed={source === key} disabled={busy}
            onClick={() => onSource(source === key ? "all" : key)}
          >
            <span><Icon size={18} />{label}</span>
            <strong>{available ? formatMoney(summary.sources[key]) : "—"}<small>₽</small></strong>
            <span className="expense-source-track"><i style={{ width: `${available ? share : 0}%` }} /></span>
            <small>{available ? `${Math.round(share)}% от расходов за период` : "Нет данных"}</small>
          </button>
        );
      })}
    </section>
  );
}

function ExpenseRow({ expense, workerMode, blocked, onPhoto, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const source = expenseSource(expense);
  const Icon = SOURCE_ICONS[source];
  return (
    <article className={`expense-row ${expanded ? "is-expanded" : ""}`}>
      <button className="expense-row-toggle" type="button" aria-label={`Подробнее: ${expense.name || "Расход"}`} aria-expanded={expanded} aria-controls={`expense-detail-${expense.id}`} onClick={() => setExpanded((old) => !old)}>
        <span className="expense-row-icon" aria-hidden="true">{expense.category === "products" ? <ReceiptText size={19} /> : <Wallet size={19} />}</span>
        <span className="expense-row-name"><strong>{expense.name || "Расход"}</strong><span>{categoryLabel(expense.category)}<i />{expense.type || "Без статьи"}{expense.hasPhoto && <Paperclip size={12} aria-label="Есть фото чека" />}</span></span>
        <span className={`expense-source is-${source}`}><Icon size={13} /><span>{SOURCE_LABELS[source]}</span></span>
        <strong className="expense-row-amount">{formatMoney(expense.amount)}<small>₽</small></strong>
        <ChevronDown className="expense-row-chevron" size={16} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="expense-row-detail" id={`expense-detail-${expense.id}`}>
          <dl><div><dt>Источник оплаты</dt><dd>{SOURCE_LABELS[source]}</dd></div><div><dt>Кто добавил</dt><dd>{expense.employeeName || "Не указан"}</dd></div><div><dt>Дата</dt><dd>{dateLabel(expenseDay(expense))}</dd></div></dl>
          {expense.comment && <p>{expense.comment}</p>}
          <div className="expense-row-actions">
            {expense.hasPhoto ? <button type="button" className="expense-button" onClick={() => onPhoto(expense)}><Paperclip size={15} />Посмотреть чек</button> : <span className="expense-help">Чек не прикреплён</span>}
            {!workerMode && <button type="button" className="expense-text-button expense-danger" disabled={blocked} onClick={() => onDelete(expense)}><Trash2 size={14} />Удалить расход</button>}
          </div>
        </div>
      )}
    </article>
  );
}

function ExpenseBreakdown({ summary, onType, onPhotos, onOwner, owner, financeError }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <aside className="expense-sidebar">
      <section className="expense-panel bg-white/[0.02] shadow-sm">
        <p className="expense-eyebrow">За выбранный период</p><h2>Структура расходов</h2>
        {summary.types.length ? (
          <div className="expense-breakdown">
            {(showAll ? summary.types : summary.types.slice(0, 5)).map((row) => (
              <button type="button" key={row.key} onClick={() => onType(row)} aria-label={`Показать статью ${row.type}: ${categoryLabel(row.category)}`}>
                <span><strong>{row.type}</strong><b>{formatMoney(row.amount)} ₽</b></span>
                <span className="expense-breakdown-track"><i style={{ width: `${summary.total > 0 ? row.amount / summary.total * 100 : 0}%` }} /></span>
                <small>{categoryLabel(row.category)} · {row.count} зап.<em>{Math.round(summary.total > 0 ? row.amount / summary.total * 100 : 0)}%</em></small>
              </button>
            ))}
            {summary.types.length > 5 && <button type="button" className="expense-text-button" onClick={() => setShowAll((old) => !old)}>{showAll ? "Свернуть" : `Все статьи · ${summary.types.length}`}</button>}
          </div>
        ) : <p className="expense-help">Добавьте расходы, чтобы увидеть распределение по статьям.</p>}
      </section>
      <section className="expense-panel expense-receipts bg-white/[0.02]">
        <span className="expense-sidebar-icon"><FileText size={20} /></span>
        <h2>Чеки и накладные</h2>
        <p>{summary.photos} из {summary.count} записей за период с фото. Чек можно открыть в деталях расхода.</p>
        <button type="button" className="expense-text-button" disabled={!summary.photos} onClick={onPhotos}>Показать с фото<ArrowRight size={15} /></button>
      </section>
      <button type="button" className="expense-panel expense-owner-shortcut bg-white/[0.02]" onClick={onOwner}>
        <span className="expense-eyebrow">Расчёты с владельцем</span>
        <strong>{owner ? `${formatMoney(Math.abs(num(owner.owed)))} ₽` : "—"}</strong>
        <span>{financeError ? "Расчёты временно недоступны" : owner && owner.owed < 0 ? "Переплата владельцу · за всё время" : "Долг бизнеса · за всё время"}<ArrowRight size={16} /></span>
      </button>
    </aside>
  );
}

function OwnerWorkspace({ owner, opening, loading, error, blocked, onEntry, onOpening, onDelete, onRefresh }) {
  const [showAll, setShowAll] = useState(false);
  if (error || !owner) return (
    <div className="expense-empty expense-panel bg-white/[0.02]">
      {loading ? <Loader2 size={30} className="animate-spin" /> : <AlertTriangle size={30} />}
      <h2>{loading ? "Загружаем расчёты" : "Расчёты пока недоступны"}</h2>
      <p>{error || "Дождитесь загрузки данных."}</p>
      {!loading && <button className="expense-button" onClick={onRefresh}>Попробовать снова</button>}
    </div>
  );
  const entries = Array.isArray(owner.entries) ? owner.entries : [];
  return (
    <div className="expense-owner-workspace">
      <section className="expense-panel expense-owner-balance bg-white/[0.02] shadow-sm">
        <div><p className="expense-eyebrow">За всё время · независимо от периода журнала</p><h2>{owner.owed < 0 ? "Переплата владельцу" : "Бизнес должен владельцу"}</h2><strong>{formatMoney(Math.abs(num(owner.owed)))}<small>₽</small></strong><p>На старте: {formatMoney(owner.openingOwed)} ₽ · расходы из личных денег + вклады − возвраты.</p></div>
        <div className="expense-owner-controls">
          {Object.entries(OWNER_KINDS).map(([kind, meta]) => <button type="button" className="expense-button" key={kind} disabled={blocked || kind === "reimbursement" && owner.owed <= 0} onClick={() => onEntry(kind)}>{kind === "contribution" ? <Plus size={16} /> : <ArrowDownLeft size={16} />}{meta.action}</button>)}
          <button type="button" className="expense-text-button" disabled={blocked} onClick={onOpening}><Settings2 size={15} />Остатки на начало учёта</button>
        </div>
      </section>
      <div className="expense-owner-metrics">
        {[["Из личных на расходы", owner.fromExpenses], ["Внесено в кассу", owner.contributions], ["Возвращено владельцу", owner.reimbursements], ["Изъято прибыли", owner.withdrawals]].map(([label, amount]) => <div key={label} className="expense-panel bg-white/[0.02]"><span>{label}</span><strong>{formatMoney(amount)} ₽</strong></div>)}
      </div>
      <section className="expense-panel expense-owner-history bg-white/[0.02]">
        <div className="expense-section-heading"><div><h2>История расчётов</h2><p>Последние 100 операций. Личные расходы учитываются в журнале расходов.</p></div><span>{entries.length}</span></div>
        {entries.length ? (showAll ? entries : entries.slice(0, 6)).map((entry) => {
          const meta = OWNER_KINDS[entry.kind] || { label: entry.kind, sign: "" };
          return <article key={entry.id} className="expense-owner-entry"><span className="expense-row-icon"><User size={17} /></span><div><h3>{meta.label}</h3><p>{dateLabel(entry.createdAt, true)}{entry.employeeName ? ` · ${entry.employeeName}` : ""}</p>{entry.note && <p>{entry.note}</p>}</div><strong>{meta.sign}{formatMoney(entry.amount)} ₽</strong><button type="button" className="expense-icon-button expense-danger" disabled={blocked} aria-label={`Удалить операцию владельца №${entry.id}`} onClick={() => onDelete(entry)}><Trash2 size={16} /></button></article>;
        }) : <p className="expense-help">Вкладов, возвратов и изъятий пока нет.</p>}
        {entries.length > 6 && <button type="button" className="expense-button expense-full" onClick={() => setShowAll((old) => !old)}>{showAll ? "Свернуть историю" : `Показать все · ${entries.length}`}</button>}
      </section>
      <p className="expense-help">{opening?.isSet ? `Начало учёта · ${dateLabel(opening.asOfDate)}` : "Начальные остатки ещё не заданы."} Изъятие прибыли не уменьшает долг перед владельцем.</p>
    </div>
  );
}

export default function ExpensesPage({ currentProfile, workerMode = false }) {
  const [data, setData] = useState({ types: [], expenses: [], owner: null, opening: null });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [financeError, setFinanceError] = useState("");
  const [tab, setTab] = useState("journal");
  const [period, setPeriod] = useState(() => expensePeriod("month"));
  const [customDates, setCustomDates] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");
  const [source, setSource] = useState("all");
  const [withPhoto, setWithPhoto] = useState(false);
  const [sort, setSort] = useState("date");
  const [limit, setLimit] = useState(25);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [success, setSuccess] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [photoWarning, setPhotoWarning] = useState("");
  const operationRef = useRef(false);
  const requestSeq = useRef(0);
  const dialogOpen = useRef(false);
  const journalRef = useRef(null);
  useEffect(() => { dialogOpen.current = !!dialog; }, [dialog]);

  const load = useCallback(async ({ allowBusy = false } = {}) => {
    if (operationRef.current && !allowBusy) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError("");
    try {
      const results = await Promise.allSettled([
        get("/product-types"), get("/global-expenses"),
        ...(workerMode ? [] : [get("/finance/owner"), get("/finance/opening")]),
      ]);
      if (seq !== requestSeq.current) return;
      for (const result of results.slice(0, 2)) {
        if (result.status === "rejected") throw result.reason;
        if (!Array.isArray(result.value)) throw new Error("Сервер вернул неполный журнал. Обновите данные.");
      }
      let owner = null, opening = null, finError = "";
      if (!workerMode) {
        const ownerResult = results[2], openingResult = results[3];
        if (ownerResult.status === "fulfilled" && ownerResult.value && Number.isFinite(ownerResult.value.owed) && Array.isArray(ownerResult.value.entries)) owner = ownerResult.value;
        else finError = ownerResult.reason?.message || "Не удалось загрузить расчёты с владельцем.";
        if (openingResult.status === "fulfilled" && typeof openingResult.value?.isSet === "boolean") opening = openingResult.value;
        else finError ||= openingResult.reason?.message || "Не удалось загрузить начальные остатки.";
      }
      setData((old) => ({ types: results[0].value, expenses: results[1].value, owner: owner || old.owner, opening: opening || old.opening }));
      setFinanceError(finError);
      setLoaded(true);
    } catch (failure) {
      if (seq === requestSeq.current) setLoadError(failure.message || "Не удалось загрузить расходы");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [workerMode]);
  useEffect(() => {
    load();
    const onVisible = () => { if (!document.hidden && !dialogOpen.current) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      // Invalidate the latest request, including reads started after mounting.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestSeq.current++;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const productTypes = useMemo(() => [...new Set([BASE_PRODUCT_TYPE, ...data.types.map((item) => item.name).filter(Boolean)])], [data.types]);
  const periodRows = useMemo(() => filterExpenses(data.expenses, period), [data.expenses, period]);
  const summary = useMemo(() => summarizeExpenses(periodRows), [periodRows]);
  const visible = useMemo(() => {
    const rows = filterExpenses(periodRows, { query, category, type, source, withPhoto });
    return rows.sort((a, b) => sort === "amount" ? num(b.amount) - num(a.amount) || num(b.id) - num(a.id) : String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || num(b.id) - num(a.id));
  }, [periodRows, query, category, type, source, withPhoto, sort]);
  const filterTypes = [...new Set([
    ...(category === "products" ? productTypes : category === "household" ? HOUSEHOLD_TYPES : [...HOUSEHOLD_TYPES, ...productTypes]),
    ...data.expenses.filter((expense) => category === "all" || (expense.category || "household") === category).map((expense) => expense.type).filter(Boolean),
  ])];
  const rangeInvalid = !!(period.from && period.to && period.from > period.to);
  const blocked = busy || loading || !!loadError;
  const financeBlocked = blocked || !!financeError;
  const hasFilters = !!query || category !== "all" || type !== "all" || source !== "all" || withPhoto;
  const shownTotal = visible.reduce((sum, expense) => sum + num(expense.amount), 0);
  const resetFilters = () => { setQuery(""); setCategory("all"); setType("all"); setSource("all"); setWithPhoto(false); };
  const open = (next) => { if (!operationRef.current) { setOperationError(""); setDialog(next); } };
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
      await request();
      setSuccess(message);
      setDialog(null);
      await load({ allowBusy: true });
    } catch (failure) {
      setOperationError(failure.message || "Операция не выполнена. Проверьте журнал перед повтором.");
    } finally {
      operationRef.current = false;
      setBusy(false);
    }
  };
  const createExpense = (expense, photo) => perform(async () => {
    const created = await post("/global-expenses", { ...expense, employeeId: currentProfile?.id || 0 });
    if (!created?.id) throw new Error("Сервер не подтвердил сохранение. Проверьте журнал перед повтором.");
    if (photo) {
      try { await post(`/global-expenses/${created.id}/photo`, { photo }); }
      catch (failure) {
        setPendingPhoto({ id: created.id, name: expense.name, photo });
        setPhotoWarning(`Расход «${expense.name}» сохранён, но фото не прикреплено: ${failure.message}`);
      }
    }
  }, `Расход добавлен · ${expense.name} · ${formatMoney(expense.amount)} ₽`);
  const retryPhoto = () => perform(async () => {
    await post(`/global-expenses/${pendingPhoto.id}/photo`, { photo: pendingPhoto.photo });
    setPendingPhoto(null);
    setPhotoWarning("");
  }, "Фото прикреплено к сохранённому расходу");
  const deleteRecord = () => {
    if (workerMode || !dialog) return;
    if (dialog.kind === "delete-expense") perform(() => del(`/global-expenses/${dialog.expense.id}`), "Расход удалён. Остатки пересчитаны.");
    else if (dialog.kind === "delete-owner") perform(() => del(`/finance/owner/${dialog.entry.id}`), "Операция владельца удалена. Остатки пересчитаны.");
  };
  const focusJournal = () => journalRef.current?.scrollIntoView({ block: "start", behavior: "auto" });

  return (
    <div className="expenses-page pb-nav sm:pb-10">
      <header className="expense-page-heading">
        <div><p className="expense-eyebrow">Финансы / ежедневный учёт</p><h1>Расходы точки</h1><p>Каждая трата на своём месте. Понятно, за что заплатили и откуда взяли деньги.</p></div>
        <div className="expense-heading-actions">
          <button type="button" className="expense-button" onClick={() => load()} disabled={busy || loading} aria-label="Обновить расходы"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /><span>Обновить</span></button>
          <button type="button" className="expense-primary" disabled={blocked} onClick={() => open({ kind: "create" })}><Plus size={18} />Новый расход</button>
        </div>
      </header>
      <ExpenseError>{loadError && `${loadError}${loaded ? " Показаны последние загруженные данные." : ""}`}</ExpenseError>
      {success && <div className="expense-success" role="status"><CheckCircle2 size={18} /><span>{success}</span><button type="button" aria-label="Скрыть сообщение" onClick={() => setSuccess("")}><X size={16} /></button></div>}
      {photoWarning && <div className="expense-warning" role="alert"><Paperclip size={18} /><span>{photoWarning}</span><button type="button" className="expense-button" disabled={busy} onClick={retryPhoto}>Повторить загрузку фото</button></div>}
      {!dialog && <ExpenseError>{operationError}</ExpenseError>}
      <nav className="expense-view-tabs" aria-label="Раздел расходов">
        <button type="button" aria-pressed={tab === "journal" || workerMode} onClick={() => setTab("journal")}><ReceiptText size={17} />Журнал расходов</button>
        {!workerMode && <button type="button" aria-pressed={tab === "owner"} onClick={() => setTab("owner")}><User size={17} />Расчёты с владельцем</button>}
      </nav>
      {tab === "owner" && !workerMode ? (
        <OwnerWorkspace owner={data.owner} opening={data.opening} loading={loading} error={financeError || loadError} blocked={financeBlocked} onEntry={(kind) => open({ kind: "owner", entryKind: kind })} onOpening={() => open({ kind: "opening" })} onDelete={(entry) => open({ kind: "delete-owner", entry })} onRefresh={() => load()} />
      ) : (
        <>
          <ExpensePeriodPicker period={period} customDates={customDates} busy={busy} onChange={setPeriod} onCustomDates={setCustomDates} />
          <ExpenseError>{rangeInvalid && "Дата начала позже даты окончания. Исправьте диапазон."}</ExpenseError>
          <ExpenseOverview summary={summary} available={loaded && !rangeInvalid} source={source} busy={busy} onSource={setSource} />
          <div className={`expense-journal-layout ${workerMode ? "is-worker" : ""}`}>
            <section className="expense-journal expense-panel bg-white/[0.02] shadow-sm" ref={journalRef} aria-label="Журнал расходов">
              <div className="expense-section-heading">
                <div>
                  <h2>Все записи {loaded && !rangeInvalid && <span>{visible.length}</span>}</h2>
                  <p>{hasFilters ? "Результаты поиска и выбранных фильтров" : "Расходы за выбранный период"}</p>
                </div>
                <strong>{loaded && !rangeInvalid ? formatMoney(shownTotal) : "—"} ₽</strong>
              </div>
              <div className="expense-search-toolbar">
                <label className="expense-search"><Search size={17} /><input aria-label="Найти расход" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, статья, комментарий…" disabled={busy} />{query && <button type="button" aria-label="Очистить поиск расходов" onClick={() => setQuery("")}><X size={15} /></button>}</label>
                <select aria-label="Сортировка расходов" value={sort} disabled={busy} onChange={(event) => setSort(event.target.value)}><option value="date">Сначала новые</option><option value="amount">По сумме</option></select>
              </div>
              <div className="expense-journal-filters">
                <div className="expense-segments" role="group" aria-label="Категории расходов">{[["all", "Все"], ["household", "Бытовые"], ["products", "Продукты"]].map(([key, label]) => <button type="button" key={key} aria-pressed={category === key} disabled={busy} onClick={() => { setCategory(key); setType("all"); }}>{label}</button>)}</div>
                <select aria-label="Статья расхода в журнале" value={type} disabled={busy} onChange={(event) => setType(event.target.value)}><option value="all">Все статьи</option>{filterTypes.map((value) => <option key={value}>{value}</option>)}</select>
                <button type="button" className="expense-photo-filter" aria-pressed={withPhoto} disabled={busy} onClick={() => setWithPhoto((old) => !old)}><Paperclip size={14} />С фото</button>
              </div>
              {hasFilters && <div className="expense-active-filters"><SlidersHorizontal size={13} /><span>{source !== "all" ? `Источник: ${SOURCE_LABELS[source]}` : "Фильтры включены"}</span><button type="button" disabled={busy} onClick={resetFilters}>Сбросить всё<X size={12} /></button></div>}
              {loading && !loaded ? <div className="expense-empty" role="status"><Loader2 size={28} className="animate-spin" /><p>Загружаем журнал расходов…</p></div> : visible.length ? (
                <div className="expense-records">
                  {visible.slice(0, limit).map((expense, index) => (
                    <div key={expense.id}>
                      {sort === "date" && (index === 0 || expenseDay(visible[index - 1]) !== expenseDay(expense)) && <h3 className="expense-day-heading">{dateLabel(expenseDay(expense))}</h3>}
                      <ExpenseRow expense={expense} workerMode={workerMode} blocked={blocked} onPhoto={(record) => open({ kind: "photo", expense: record })} onDelete={(record) => open({ kind: "delete-expense", expense: record })} />
                    </div>
                  ))}
                  {visible.length > limit && <button type="button" className="expense-button expense-load-more" onClick={() => setLimit((old) => old + 25)}>Показать ещё · {visible.length - limit}</button>}
                </div>
              ) : (
                <div className="expense-empty">
                  {loadError && !loaded ? (
                    <>
                      <AlertTriangle size={30} /><h3>Журнал пока недоступен</h3>
                      <p>Обновите данные после восстановления соединения.</p>
                      <button className="expense-button" onClick={() => load()}>Попробовать снова</button>
                    </>
                  ) : rangeInvalid ? (
                    <>
                      <CalendarDays size={30} /><h3>Проверьте период</h3>
                      <p>Дата начала должна быть раньше даты окончания.</p>
                    </>
                  ) : (
                    <>
                      <Search size={30} />
                      <h3>{hasFilters ? "Подходящих расходов нет" : "За этот период расходов нет"}</h3>
                      <p>{hasFilters ? "Измените запрос или сбросьте фильтры." : "Добавьте расход или выберите другой период."}</p>
                      {hasFilters && <button className="expense-button" onClick={resetFilters}>Сбросить фильтры</button>}
                    </>
                  )}
                </div>
              )}
              <footer className="expense-journal-footer">
                {loaded ? `Показано ${Math.min(limit, visible.length)} из ${visible.length} записей` : "Журнал ещё не загружен"}
                {workerMode && <span>Удаление доступно владельцу и администратору.</span>}
              </footer>
            </section>
            {!workerMode && loaded && !rangeInvalid && <ExpenseBreakdown summary={summary} onType={(row) => { setCategory(row.category); setType(row.type); setQuery(""); setSource("all"); setWithPhoto(false); focusJournal(); }} onPhotos={() => { resetFilters(); setWithPhoto(true); focusJournal(); }} onOwner={() => setTab("owner")} owner={data.owner} financeError={financeError} />}
          </div>
        </>
      )}
      {dialog?.kind === "create" && <ExpenseForm productTypes={productTypes} busy={busy} error={operationError} onSave={createExpense} onClose={close} />}
      {dialog?.kind === "owner" && !workerMode && <OwnerEntryForm kind={dialog.entryKind} owed={num(data.owner?.owed)} busy={busy} error={operationError} onSave={(body) => perform(() => post("/finance/owner", { ...body, employeeId: currentProfile?.id || 0 }), "Операция владельца сохранена")} onClose={close} />}
      {dialog?.kind === "opening" && !workerMode && <OpeningBalancesForm opening={data.opening} busy={busy} error={operationError} onSave={(body) => perform(() => put("/finance/opening", body), "Начальные остатки сохранены")} onClose={close} />}
      {dialog?.kind === "photo" && <ExpensePhotoViewer expense={dialog.expense} onClose={close} />}
      {["delete-expense", "delete-owner"].includes(dialog?.kind) && !workerMode && (
        <Modal title={dialog.kind === "delete-expense" ? "Удалить расход?" : "Удалить операцию владельца?"} section="Проверка операции" legacyLight={false} onClose={close}>
          <div className="expense-delete-summary"><Trash2 size={28} /><h3>{dialog.expense?.name || OWNER_KINDS[dialog.entry?.kind]?.label || "Операция"}</h3><strong>{formatMoney(dialog.expense?.amount ?? dialog.entry?.amount)} ₽</strong><p>Запись будет удалена, связанные финансовые остатки пересчитаются. Восстановить запись из корзины нельзя.</p></div>
          <ExpenseError>{operationError}</ExpenseError>
          <div className="expense-form-actions"><button className="expense-button" disabled={busy} onClick={close}>Назад</button><button className="expense-button expense-danger" disabled={busy} onClick={deleteRecord}>{busy ? "Удаляем…" : "Удалить запись"}</button></div>
        </Modal>
      )}
    </div>
  );
}
