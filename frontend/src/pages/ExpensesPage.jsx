import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, CreditCard, User, Tag, Settings, Hash, List, Trash2 } from "lucide-react";
import { del, get, post, put } from "../api";
import Modal from "../components/Modal";
import { formatMoney, localISO, money, num } from "../utils/format";

const today = () => localISO();
const monthStart = () => {
  const d = new Date();
  return localISO(new Date(d.getFullYear(), d.getMonth(), 1));
};
const monthEnd = () => {
  const d = new Date();
  return localISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};
const formatDateRu = (dateStr) => {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
};

const HOUSEHOLD_TYPES = [
  "Уборка",
  "Коммуналка",
  "Зарплата",
  "Аренда",
  "Доставка",
  "Прочее",
];

const BASE_PRODUCT_TYPES = ["Общий продуктовый расход"];

export default function ExpensesPage({ currentProfile, workerMode }) {
  const [types, setTypes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(monthEnd());
  const [filterOpen, setFilterOpen] = useState(false);
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    category: "household",
    type: "Уборка",
    name: "",
    amount: "",
    comment: "",
    paymentSource: "cash", // cash | card | owner
  });

  // Расчёты с владельцем (леджер)
  const [ownerFin, setOwnerFin] = useState(null);
  const [ownerModal, setOwnerModal] = useState(null); // 'contribution' | 'reimbursement' | 'withdrawal'
  const [ownerForm, setOwnerForm] = useState({ amount: "", note: "" });

  // Стартовые балансы (миграция с другой системы)
  const [opening, setOpening] = useState(null);
  const [openingModal, setOpeningModal] = useState(false);
  const [openingForm, setOpeningForm] = useState({
    asOfDate: "", cash: "", bank: "", owedToOwner: "", inventoryValue: "",
    customerDebts: "", supplierDebts: "", note: "",
  });

  // Safe array guards

  const load = async () => {
    const [typeList, expenseList, owner, openingBal] = await Promise.all([
      get("/product-types"),
      get("/global-expenses"),
      // Финансы — только для владельца/админа; у сотрудника 403, тихо игнорируем.
      get("/finance/owner").catch(() => null),
      get("/finance/opening").catch(() => null),
    ]);

    setTypes(typeList || []);
    setExpenses(expenseList || []);
    if (owner) setOwnerFin(owner);
    if (openingBal) setOpening(openingBal);
  };

  const openOpeningModal = () => {
    const o = opening || {};
    const s = (v) => (v ? String(v) : "");
    setOpeningForm({
      asOfDate: o.asOfDate || "",
      cash: s(o.cash), bank: s(o.bank), owedToOwner: s(o.owedToOwner),
      inventoryValue: s(o.inventoryValue), customerDebts: s(o.customerDebts),
      supplierDebts: s(o.supplierDebts), note: o.note || "",
    });
    setError("");
    setOpeningModal(true);
  };

  const saveOpening = async () => {
    await guarded(async () => {
      const res = await put("/finance/opening", {
        asOfDate: openingForm.asOfDate,
        cash: num(openingForm.cash), bank: num(openingForm.bank),
        owedToOwner: num(openingForm.owedToOwner), inventoryValue: num(openingForm.inventoryValue),
        customerDebts: num(openingForm.customerDebts), supplierDebts: num(openingForm.supplierDebts),
        note: openingForm.note.trim(),
      });
      if (res) setOpening(res);
      setOpeningModal(false);
      await load(); // долг перед владельцем зависит от стартового баланса
    });
  };

  // Записать движение по расчётам с владельцем (вклад/возврат/изъятие).
  const submitOwnerEntry = async () => {
    if (!ownerModal) return;
    if (num(ownerForm.amount) <= 0) return setError("Укажите сумму");
    await guarded(async () => {
      const res = await post("/finance/owner", {
        kind: ownerModal,
        amount: num(ownerForm.amount),
        note: ownerForm.note.trim(),
        employeeId: currentProfile?.id || 0,
      });
      if (res) setOwnerFin(res); // эндпоинт возвращает свежий баланс
      setOwnerModal(null);
      setOwnerForm({ amount: "", note: "" });
      await load();
    });
  };

  const deleteOwnerEntry = async (id) => {
    await guarded(async () => {
      const res = await del(`/finance/owner/${id}`);
      if (res) setOwnerFin(res);
      await load();
    });
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const productTypes = useMemo(() => {
    const tps = Array.isArray(types) ? types : [];
    const menuTypes = tps.map((t) => String(t.name || "").trim()).filter(Boolean);
    return [...new Set([...BASE_PRODUCT_TYPES, ...menuTypes])];
  }, [types]);

  const currentTypeOptions =
    form.category === "household" ? HOUSEHOLD_TYPES : productTypes;

  const categoryLabel = (category) => {
    if (category === "household") return "Бытовой расход";
    if (category === "products") return "Продукты";
    return "Расход";
  };

  const visibleExpenses = useMemo(() => {
    const exps = Array.isArray(expenses) ? expenses : [];
    return exps.filter((e) => {
      const category = e.category || "household";
      const okCategory = filterCategory === "all" || category === filterCategory;
      const okType = filterType === "all" || String(e.type) === String(filterType);
      const date = String(e.createdAt || "").slice(0, 10);
      const okFrom = !fromDate || date >= fromDate;
      const okTo = !toDate || date <= toDate;
      return okCategory && okType && okFrom && okTo;
    });
  }, [expenses, filterCategory, filterType, fromDate, toDate]);

  const total = visibleExpenses.reduce((s, e) => s + money(e.amount), 0);

  // Разбивка по источнику оплаты за выбранный период.
  const bySource = useMemo(() => {
    const acc = { cash: 0, card: 0, owner: 0 };
    for (const e of visibleExpenses) {
      const k = ["cash", "card", "owner"].includes(e.paymentSource) ? e.paymentSource : "cash";
      acc[k] += num(e.amount);
    }
    return acc;
  }, [visibleExpenses]);

  // «Бизнес должен владельцу» — накопительно по всем расходам из личных денег владельца
  // (возвраты владельцу появятся в следующей фазе и будут уменьшать эту сумму).
  const owedToOwner = useMemo(
    () => (Array.isArray(expenses) ? expenses : [])
      .filter((e) => e.paymentSource === "owner")
      .reduce((s, e) => s + num(e.amount), 0),
    [expenses]
  );

  const SRC_META = {
    cash: { label: "Из кассы", cls: "border-emerald-400/20 bg-emerald-500/15 text-emerald-300" },
    card: { label: "С карты", cls: "border-blue-400/20 bg-blue-500/15 text-blue-300" },
    owner: { label: "Владелец", cls: "border-amber-400/20 bg-amber-500/15 text-amber-300" },
  };
  const srcMeta = (e) => SRC_META[e?.paymentSource] || SRC_META.cash;

  const OWNER_KIND = {
    contribution: { label: "Вклад в кассу", prefix: "+", sign: "text-emerald-300", cta: "Владелец внёс в кассу",
      hint: "Владелец кладёт личные деньги в кассу. Касса вырастет, и бизнес будет должен владельцу эту сумму." },
    reimbursement: { label: "Возврат владельцу", prefix: "−", sign: "text-blue-300", cta: "Вернуть владельцу",
      hint: "Бизнес возвращает владельцу из кассы. Касса уменьшится, и долг перед владельцем уменьшится." },
    withdrawal: { label: "Изъятие прибыли", prefix: "−", sign: "text-slate-300", cta: "Изъятие прибыли",
      hint: "Владелец забирает прибыль из кассы для себя. Касса уменьшится, долг перед владельцем НЕ меняется." },
  };
  const owedOwner = ownerFin ? ownerFin.owed : owedToOwner;
  const fieldCls = "w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3.5 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10";

  const setCategory = (category) => {
    setFilterCategory(category);
    setFilterType("all");
  };

  const changeFormCategory = (category) => {
    setForm((p) => ({
      ...p,
      category,
      type: category === "household" ? HOUSEHOLD_TYPES[0] : productTypes[0],
    }));
  };

  const resetForm = () => {
    setForm({
      category: "household",
      type: "Уборка",
      name: "",
      amount: "",
      comment: "",
      paymentSource: "cash",
    });
  };

  // Защита от двойного запроса + показ ошибки (тост поверх модалки).
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const guarded = async (fn) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await fn();
    } catch (e) {
      const msg = e?.message || "Операция не выполнена. Попробуйте снова.";
      setError(msg);
      window.notify?.(msg, "error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const createExpense = async () => {
    setError("");
    if (!form.category) return setError("Выбери категорию расхода");
    if (!form.type) return setError("Выбери тип расхода");
    if (!form.name.trim()) return setError("Напиши, за что оплатили");
    if (num(form.amount) <= 0) return setError("Укажи сумму расхода");
    await guarded(async () => {
      await post("/global-expenses", {
        employeeId: currentProfile?.id || 0,
        category: form.category,
        type: form.type,
        name: form.name.trim(),
        amount: num(form.amount),
        comment: form.comment.trim(),
        paymentSource: form.paymentSource || "cash",
      });
      resetForm();
      setExpenseModal(false);
      await load();
    });
  };

  const openDeleteExpense = (expense) => {
    if (workerMode) {
      setError("Удалять расходы может только админ или владелец");
      return;
    }

    setExpenseToDelete(expense);
  };

  const deleteExpense = async () => {
    if (!expenseToDelete?.id) return;
    setError("");
    await guarded(async () => {
      await del(`/global-expenses/${expenseToDelete.id}`);
      setExpenseToDelete(null);
      await load();
    });
  };

  return (
    <div className="pb-nav text-slate-100 sm:pb-10">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,.22),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(124,58,237,.22),transparent_30%),linear-gradient(135deg,#050914_0%,#071128_45%,#10194a_100%)]" />

      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-300 shadow-[0_0_25px_rgba(37,99,235,.22)]">
            <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_15px_rgba(96,165,250,.9)]" />
            Расходы
          </div>
          <h2 className="text-4xl font-black leading-none text-white drop-shadow sm:text-5xl">
            Расходы точки
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
            Бытовые расходы отдельно, продукты отдельно. Типы продуктов берутся из меню.
          </p>
        </div>

    
      </div>

      {error && (
        <div className="mb-4 rounded-3xl border border-red-400/30 bg-red-500/10 px-4 py-3 font-bold text-red-200 shadow-[0_12px_35px_rgba(239,68,68,.16)]">
          {error}
        </div>
      )}

      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur-xl overflow-hidden">
        {/* Компактная шапка фильтра — всегда видна */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {/* Быстрые пресеты периода */}
            {[
              ["month", "Этот месяц", () => { setFromDate(monthStart()); setToDate(monthEnd()); }],
              ["today", "Сегодня",    () => { const d = today(); setFromDate(d); setToDate(d); }],
              ["all",   "За всё время",  () => { setFromDate(""); setToDate(""); }],
            ].map(([key, label, action]) => {
              const isMonth = key === "month" && fromDate === monthStart() && toDate === monthEnd();
              const isToday = key === "today" && fromDate === today() && toDate === today();
              const isAll   = key === "all"   && !fromDate && !toDate;
              const active  = isMonth || isToday || isAll;
              return (
                <button
                  key={key}
                  onClick={action}
                  className={active
                    ? "rounded-xl bg-linear-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-black text-white shadow-lg"
                    : "rounded-xl border border-white/10 bg-white/8 px-4 py-2.5 text-sm font-black text-slate-300 transition hover:bg-white/15"}
                >
                  {label}
                </button>
              );
            })}

            {/* Показываем активный диапазон если не стандартный пресет */}
            {fromDate && toDate && fromDate !== monthStart() && toDate !== monthEnd() && fromDate !== today() && (
              <span className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm font-black text-blue-200">
                {formatDateRu(fromDate)} — {formatDateRu(toDate)}
              </span>
            )}
          </div>

          {/* Кнопка открытия расширенного фильтра */}
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-black transition ${
              filterOpen
                ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                : "border-white/10 bg-white/8 text-slate-300 hover:bg-white/15"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            Фильтр
            {(filterCategory !== "all" || filterType !== "all" || (fromDate && fromDate !== monthStart())) && (
              <span className="h-2 w-2 rounded-full bg-blue-400" />
            )}
          </button>
        </div>

        {/* Расширенный фильтр — скрыт по умолчанию */}
        {filterOpen && (
          <div className="border-t border-white/10 px-4 py-4 sm:px-5">
            {/* Даты от/до */}
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">От даты</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">До даты</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none transition focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
                />
              </label>
            </div>

            {/* Категория */}
            <div className="mb-3">
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">Категория</p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "Все"],
                  ["household", "Бытовой расход"],
                  ["products", "Продукты"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setCategory(key)}
                    className={
                      filterCategory === key
                        ? "rounded-xl bg-linear-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-black text-white shadow-lg"
                        : "rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/15"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Тип внутри категории */}
            {filterCategory !== "all" && (
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">Тип</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setFilterType("all")}
                    className={
                      filterType === "all"
                        ? "rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-black text-slate-950"
                        : "rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/15"
                    }
                  >
                    Все типы
                  </button>
                  {(filterCategory === "household" ? HOUSEHOLD_TYPES : productTypes).map((type) => (
                    <button
                      key={type}
                      onClick={() => setFilterType(type)}
                      className={
                        filterType === type
                          ? "rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-black text-slate-950"
                          : "rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/15"
                      }
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-red-400/25 bg-red-500/[0.08] p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-red-300 sm:h-9 sm:w-9 sm:rounded-xl">₽</span>
            <p className="min-w-0 text-[11px] font-black uppercase leading-[1.15] tracking-wide text-red-200/90 sm:text-[11px]">Итого расходов</p>
          </div>
          <p className="mt-2 text-xl font-black tabular-nums text-white sm:text-2xl">{formatMoney(total)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-500/15 text-slate-300 sm:h-9 sm:w-9 sm:rounded-xl"><Hash className="h-[18px] w-[18px]" strokeWidth={2.2} /></span>
            <p className="min-w-0 text-[11px] font-black uppercase leading-[1.15] tracking-wide text-slate-400 sm:text-[11px]">Записей</p>
          </div>
          <p className="mt-2 text-xl font-black text-white sm:text-2xl">{visibleExpenses.length}</p>
        </div>
        <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.08] p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-300 sm:h-9 sm:w-9 sm:rounded-xl"><Tag className="h-[18px] w-[18px]" strokeWidth={2.2} /></span>
            <p className="min-w-0 text-[11px] font-black uppercase leading-[1.15] tracking-wide text-blue-200/90 sm:text-[11px]">Категория</p>
          </div>
          <p className="mt-2 truncate text-base font-black text-white sm:text-xl">{filterCategory === "all" ? "Все" : categoryLabel(filterCategory)}</p>
        </div>
        <div className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.08] p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300 sm:h-9 sm:w-9 sm:rounded-xl"><List className="h-[18px] w-[18px]" strokeWidth={2.2} /></span>
            <p className="min-w-0 text-[11px] font-black uppercase leading-[1.15] tracking-wide text-violet-200/90 sm:text-[11px]">Тип</p>
          </div>
          <p className="mt-2 truncate text-base font-black text-white sm:text-xl">{filterType === "all" ? "Все типы" : filterType}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-sm font-bold text-blue-300">
              {filterCategory === "all" ? "Все расходы" : categoryLabel(filterCategory)}
            </p>
            <h3 className="text-2xl font-black text-white sm:text-3xl">Список расходов</h3>
            <p className="mt-1 text-sm text-slate-400">
              {workerMode
                ? "Работник может добавить расход, но не видит общую аналитику."
                : "Расходы текущей точки по выбранному периоду."}
            </p>
          </div>

          {/* На телефоне добавление — плавающей кнопкой снизу, итог — в карточке сверху */}
          <div className="hidden gap-3 sm:flex sm:items-center">
            <button
              onClick={() => setExpenseModal(true)}
              className="rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(37,99,235,.35)]"
            >
              + Добавить расход
            </button>
            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-5 py-4 text-white">
              <p className="text-sm text-red-200">Итого</p>
              <p className="text-2xl font-black">{formatMoney(total)}</p>
            </div>
          </div>
        </div>

        {/* Разбивка расходов по источнику оплаты (за период) */}
        <div className="mb-4 grid grid-cols-3 gap-2.5 sm:gap-3">
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.07] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-300/80"><Banknote size={14} strokeWidth={2.4} /> Из кассы</p>
            <p className="mt-1 text-lg font-black text-white sm:text-xl">{formatMoney(bySource.cash)}</p>
            <p className="hidden text-[11px] font-bold text-slate-500 sm:block">уменьшили наличные</p>
          </div>
          <div className="rounded-2xl border border-blue-400/15 bg-blue-500/[0.07] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-blue-300/80"><CreditCard size={14} strokeWidth={2.4} /> С карты</p>
            <p className="mt-1 text-lg font-black text-white sm:text-xl">{formatMoney(bySource.card)}</p>
            <p className="hidden text-[11px] font-bold text-slate-500 sm:block">перевод/карта</p>
          </div>
          <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.07] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-amber-300/80"><User size={14} strokeWidth={2.4} /> Личные владельца</p>
            <p className="mt-1 text-lg font-black text-white sm:text-xl">{formatMoney(bySource.owner)}</p>
            <p className="hidden text-[11px] font-bold text-slate-500 sm:block">за период · кассу не трогали</p>
          </div>
        </div>

        {/* Расчёты с владельцем — только владельцу/админу (эндпоинт вернул данные) */}
        {ownerFin && (
          <div className="mb-4 rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-amber-100">Расчёты с владельцем</p>
                <p className="mt-0.5 text-xs font-bold text-slate-400">Личные деньги владельца в бизнесе</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-black uppercase tracking-wide text-amber-200/70">Бизнес должен владельцу</p>
                <p className="text-2xl font-black text-amber-100 sm:text-3xl">{formatMoney(owedOwner)}</p>
                {ownerFin.openingOwed > 0 && (
                  <p className="text-[11px] font-bold text-amber-200/50">в т.ч. на старте {formatMoney(ownerFin.openingOwed)}</p>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-xl bg-white/[0.04] px-3 py-2"><span className="text-slate-400">Расходы владельца</span><br /><b className="text-white">{formatMoney(ownerFin.fromExpenses)}</b></div>
              <div className="rounded-xl bg-white/[0.04] px-3 py-2"><span className="text-slate-400">Вклады в кассу</span><br /><b className="text-emerald-300">+{formatMoney(ownerFin.contributions)}</b></div>
              <div className="rounded-xl bg-white/[0.04] px-3 py-2"><span className="text-slate-400">Возвраты владельцу</span><br /><b className="text-blue-300">−{formatMoney(ownerFin.reimbursements)}</b></div>
              <div className="rounded-xl bg-white/[0.04] px-3 py-2" title="Изъятие прибыли не уменьшает долг перед владельцем."><span className="text-slate-400">Изъятия прибыли</span><br /><b className="text-slate-200">{formatMoney(ownerFin.withdrawals)}</b></div>
            </div>

            {!workerMode && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(OWNER_KIND).map(([kind, m]) => (
                  <button key={kind} onClick={() => { setOwnerForm({ amount: "", note: "" }); setError(""); setOwnerModal(kind); }}
                    className="rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-xs font-black text-white transition hover:bg-white/10">
                    {m.cta}
                  </button>
                ))}
                <button onClick={openOpeningModal}
                  className="ml-auto flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs font-black text-slate-300 transition hover:bg-white/10"
                  title="Начальное финансовое состояние при переходе с другой системы">
                  <Settings size={14} strokeWidth={2.2} /> Стартовые балансы
                </button>
              </div>
            )}

            {ownerFin.entries?.length > 0 && (
              <div className="mt-3 divide-y divide-white/5 border-t border-white/5 pt-1">
                {ownerFin.entries.slice(0, 6).map((en) => {
                  const m = OWNER_KIND[en.kind] || { label: en.kind, prefix: "", sign: "text-white" };
                  return (
                    <div key={en.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-black text-white">{m.label}</span>
                        <span className="text-slate-500"> {en.note ? `· ${en.note} ` : ""}· {String(en.createdAt || "").slice(0, 10)}{en.employeeName ? ` · ${en.employeeName}` : ""}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <b className={m.sign}>{m.prefix}{formatMoney(en.amount)}</b>
                        {!workerMode && (
                          <button onClick={() => deleteOwnerEntry(en.id)} aria-label="Удалить" title="Удалить" className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-red-300"><Trash2 size={16} /></button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="border-y border-white/10 bg-slate-950/50 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-4">Дата</th>
                <th className="p-4">Категория</th>
                <th className="p-4">Тип</th>
                <th className="p-4">Назначение</th>
                <th className="p-4">Комментарий</th>
                <th className="p-4">Сумма</th>
                <th className="p-4">Кто добавил</th>
                {!workerMode && <th className="p-4"></th>}
              </tr>
            </thead>

            <tbody>
              {visibleExpenses.map((e) => (
                <tr key={e.id} className="border-b border-white/10 bg-slate-950/20 transition hover:bg-white/[0.05]">
                  <td className="p-4 font-bold text-slate-400">{String(e.createdAt || "").slice(0, 10) || "—"}</td>
                  <td className="p-4 font-black text-white">{categoryLabel(e.category)}</td>
                  <td className="p-4 text-slate-300">{e.type || "—"}</td>
                  <td className="p-4 font-bold text-white">
                    {e.name}
                    <span className={`ml-2 inline-block rounded-md border px-1.5 py-0.5 align-middle text-[10px] font-black ${srcMeta(e).cls}`}>{srcMeta(e).label}</span>
                  </td>
                  <td className="p-4 text-slate-400">{e.comment || "—"}</td>
                  <td className="p-4 font-black text-red-300">{formatMoney(e.amount)}</td>
                  <td className="p-4 text-slate-300">{e.employeeName || "—"}</td>

                  {!workerMode && (
                    <td className="p-4 text-right">
                      <button
                        onClick={() => openDeleteExpense(e)}
                        aria-label="Удалить расход"
                        title="Удалить расход"
                        className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 font-black text-red-200 transition hover:bg-red-500/20"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}

              {!visibleExpenses.length && (
                <tr>
                  <td colSpan={workerMode ? 7 : 8} className="p-10 text-center font-bold text-slate-400">
                    Расходов пока нет
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot className="bg-slate-950/70 font-black text-white">
              <tr>
                <td className="p-4" colSpan="5">ИТОГО</td>
                <td className="p-4 text-red-200">{formatMoney(total)}</td>
                <td></td>
                {!workerMode && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="divide-y divide-white/10 xl:hidden">
          {visibleExpenses.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="truncate text-base font-black text-white">{e.name}</p>
                <p className="truncate text-xs text-slate-400">{categoryLabel(e.category)} · {e.type || "—"}</p>
                <span className={`mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-black ${srcMeta(e).cls}`}>{srcMeta(e).label}</span>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {String(e.createdAt || "").slice(0, 10) || "—"}{e.employeeName ? ` · ${e.employeeName}` : ""}
                </p>
                {e.comment && <p className="mt-1 truncate text-xs text-slate-400">{e.comment}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap text-base font-black tabular-nums text-red-400">−{formatMoney(e.amount)}</span>
                {!workerMode && (
                  <button
                    onClick={() => openDeleteExpense(e)}
                    aria-label="Удалить расход"
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-300 transition hover:bg-red-500/20"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                  </button>
                )}
              </div>
            </div>
          ))}

          {!visibleExpenses.length && <div className="p-10 text-center font-bold text-slate-400">Расходов пока нет</div>}

          <div className="flex justify-between bg-slate-950/60 p-4 font-black text-white">
            <span>Итого</span>
            <span className="tabular-nums text-red-400">{formatMoney(total)}</span>
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpenseModal(true)}
        className="fixed left-4 right-4 z-30 rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-[0_18px_55px_rgba(37,99,235,.45)] transition active:scale-[0.98] sm:hidden"
        style={{ bottom: "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 10px)" }}
      >
        + Добавить расход
      </button>

      {expenseModal && (
        <Modal title="Новый расход" wide>
          <div className="grid gap-3">
            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Категория расхода</span>
              <select
                value={form.category}
                onChange={(e) => changeFormCategory(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
              >
                <option value="household">Бытовой расход</option>
                <option value="products">Продукты</option>
              </select>
            </label>

            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Тип</span>
              <select
                value={form.type}
                onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
              >
                {currentTypeOptions.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Назначение</span>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder={form.category === "household" ? "Например: уборка, свет, зарплата..." : "Например: молоко, стаканчики, продукты..."}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
                autoFocus
              />
            </label>

            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Сумма</span>
              <input
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                placeholder="Например: 1500"
                type="number"
                inputMode="decimal"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
              />
            </label>

            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Чем оплатили</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["cash", "Из кассы", Banknote],
                  ["card", "С карты", CreditCard],
                  ["owner", "Личные владельца", User],
                ].map(([val, label, Icon]) => (
                  <button key={val} type="button"
                    onClick={() => setForm((p) => ({ ...p, paymentSource: val }))}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center text-xs font-black leading-tight transition ${
                      form.paymentSource === val
                        ? "border-blue-400/70 bg-blue-500/15 text-white"
                        : "border-white/10 bg-slate-950/60 text-slate-300 hover:bg-white/5"
                    }`}>
                    <Icon size={20} strokeWidth={2.2} />{label}
                  </button>
                ))}
              </div>
              {form.paymentSource === "owner" && (
                <p className="mt-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200">
                  Касса не уменьшится. Бизнес будет <b>должен владельцу</b> эту сумму.
                </p>
              )}
              {form.paymentSource === "cash" && (
                <p className="mt-2 px-1 text-xs font-bold text-slate-500">Уменьшит наличные в кассе.</p>
              )}
              {form.paymentSource === "card" && (
                <p className="mt-2 px-1 text-xs font-bold text-slate-500">Оплата с карты/переводом — кассу не трогает.</p>
              )}
            </label>

            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Комментарий</span>
              <textarea
                value={form.comment}
                onChange={(e) => setForm((p) => ({ ...p, comment: e.target.value }))}
                placeholder="Дополнительно, если нужно"
                className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => setExpenseModal(false)}
              className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/15"
            >
              Отмена
            </button>
            <button
              onClick={createExpense}
              disabled={submitting}
              className="flex-1 rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(37,99,235,.35)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Сохраняю…" : "Добавить расход"}
            </button>
          </div>
        </Modal>
      )}

      {expenseToDelete && (
        <Modal title="Удаление расхода">
          <div className="space-y-5">
            <div className="rounded-3xl border border-red-400/20 bg-red-500/10 p-4">
              <p className="text-sm font-bold text-red-200">
                Вы действительно хотите удалить этот расход?
              </p>

              <p className="mt-3 text-lg font-black text-white">
                {expenseToDelete.name || "Расход"}
              </p>

              <p className="mt-1 text-sm font-bold text-red-200">
                {formatMoney(expenseToDelete.amount)}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setExpenseToDelete(null)}
                className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/15"
              >
                Отмена
              </button>

              <button
                onClick={deleteExpense}
                disabled={submitting}
                className="flex-1 rounded-2xl bg-linear-to-r from-red-600 to-red-500 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(239,68,68,.25)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Удаляю…" : "Удалить"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {ownerModal && (
        <Modal title={OWNER_KIND[ownerModal]?.cta || "Расчёт с владельцем"}>
          <div className="grid gap-3">
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold leading-snug text-slate-300">
              {OWNER_KIND[ownerModal]?.hint}
            </p>
            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Сумма</span>
              <input
                value={ownerForm.amount}
                onChange={(e) => setOwnerForm((p) => ({ ...p, amount: e.target.value }))}
                placeholder="Например: 5000"
                type="number"
                inputMode="decimal"
                autoFocus
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-amber-400/70 focus:ring-4 focus:ring-amber-500/10"
              />
            </label>
            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Примечание</span>
              <input
                value={ownerForm.note}
                onChange={(e) => setOwnerForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="За что / комментарий (необязательно)"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-amber-400/70 focus:ring-4 focus:ring-amber-500/10"
              />
            </label>
            <div className="mt-1 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => setOwnerModal(null)}
                className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/15">
                Отмена
              </button>
              <button onClick={submitOwnerEntry} disabled={submitting}
                className="flex-1 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(245,158,11,.25)] disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {openingModal && (
        <Modal title="Стартовые балансы" wide>
          <div className="grid gap-3">
            <p className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm font-bold leading-snug text-blue-100">
              Начальное состояние при переходе с другой системы. Это <b>не</b> транзакции — это точка отсчёта. Заполните то, что знаете на дату старта; остальное можно оставить нулём и уточнить позже.
            </p>
            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Дата старта учёта</span>
              <input type="date" value={openingForm.asOfDate}
                onChange={(e) => setOpeningForm((p) => ({ ...p, asOfDate: e.target.value }))} className={fieldCls} />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ["cash", "Наличные в кассе", "нал на старте"],
                ["bank", "На карте / счёте", "безнал на старте"],
                ["owedToOwner", "Долг перед владельцем", "бизнес уже должен владельцу"],
                ["inventoryValue", "Стоимость склада", "остатки товара по себестоимости"],
                ["customerDebts", "Клиенты должны нам", "долги клиентов на старте"],
                ["supplierDebts", "Мы должны поставщикам", "долги перед поставщиками"],
              ].map(([key, label, hint]) => (
                <label key={key}>
                  <span className="mb-2 block text-sm font-black text-slate-300">{label}</span>
                  <input type="number" inputMode="decimal" value={openingForm[key]} placeholder="0"
                    onChange={(e) => setOpeningForm((p) => ({ ...p, [key]: e.target.value }))} className={fieldCls} />
                  <span className="mt-1 block px-1 text-[11px] font-bold text-slate-500">{hint}</span>
                </label>
              ))}
            </div>
            <label>
              <span className="mb-2 block text-sm font-black text-slate-300">Примечание</span>
              <input value={openingForm.note} placeholder="Необязательно"
                onChange={(e) => setOpeningForm((p) => ({ ...p, note: e.target.value }))} className={fieldCls} />
            </label>
            <div className="mt-1 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => setOpeningModal(false)}
                className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/15">
                Отмена
              </button>
              <button onClick={saveOpening} disabled={submitting}
                className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(37,99,235,.35)] disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
