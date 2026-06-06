import { useEffect, useMemo, useState } from "react";
import { del, get, post } from "../api";
import Modal from "../components/Modal";
import { formatMoney, money, num } from "../utils/format";

const today = () => new Date().toISOString().slice(0, 10);

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
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    category: "household",
    type: "Уборка",
    name: "",
    amount: "",
    comment: "",
  });

  const load = async () => {
    const [typeList, expenseList] = await Promise.all([
      get("/product-types"),
      get("/global-expenses"),
    ]);

    setTypes(typeList || []);
    setExpenses(expenseList || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const productTypes = useMemo(() => {
    const menuTypes = (types || [])
      .map((t) => String(t.name || "").trim())
      .filter(Boolean);

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
    return expenses.filter((e) => {
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
    });
  };

  const createExpense = async () => {
    setError("");

    if (!form.category) return setError("Выбери категорию расхода");
    if (!form.type) return setError("Выбери тип расхода");
    if (!form.name.trim()) return setError("Напиши, за что оплатили");
    if (num(form.amount) <= 0) return setError("Укажи сумму расхода");

    await post("/global-expenses", {
      employeeId: currentProfile?.id || 0,
      category: form.category,
      type: form.type,
      name: form.name.trim(),
      amount: num(form.amount),
      comment: form.comment.trim(),
    });

    resetForm();
    setExpenseModal(false);
    await load();
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
    await del(`/global-expenses/${expenseToDelete.id}`);
    setExpenseToDelete(null);
    await load();
  };

  return (
    <div className="pb-28 text-slate-100 sm:pb-10">
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

        <button
          onClick={() => setExpenseModal(true)}
          className="hidden rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-6 py-4 font-black text-white shadow-[0_18px_45px_rgba(37,99,235,.35)] transition hover:scale-[1.01] sm:inline-flex"
        >
          + Добавить расход
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-3xl border border-red-400/30 bg-red-500/10 px-4 py-3 font-bold text-red-200 shadow-[0_12px_35px_rgba(239,68,68,.16)]">
          {error}
        </div>
      )}

      <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl backdrop-blur-xl sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
          <label>
            <span className="mb-2 block text-sm font-black text-slate-300">От даты</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
            />
          </label>

          <label>
            <span className="mb-2 block text-sm font-black text-slate-300">До даты</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
            />
          </label>

          <button
            onClick={() => {
              const d = today();
              setFromDate(d);
              setToDate(d);
            }}
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white shadow-lg transition hover:bg-white/15"
          >
            Сегодня
          </button>

          <button
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white shadow-lg transition hover:bg-white/15"
          >
            Всё время
          </button>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-sm font-black text-slate-300">Категория</p>
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
                    ? "rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-[0_12px_35px_rgba(37,99,235,.35)]"
                    : "rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-black text-slate-200 transition hover:bg-white/15"
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filterCategory !== "all" && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-black text-slate-300">Тип внутри категории</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilterType("all")}
                className={
                  filterType === "all"
                    ? "rounded-2xl bg-slate-100 px-5 py-3 font-black text-slate-950"
                    : "rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-black text-slate-200 transition hover:bg-white/15"
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
                      ? "rounded-2xl bg-slate-100 px-5 py-3 font-black text-slate-950"
                      : "rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-black text-slate-200 transition hover:bg-white/15"
                  }
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[2rem] border border-red-400/20 bg-gradient-to-br from-red-500/15 to-white/[0.04] p-5 shadow-2xl backdrop-blur-xl">
          <p className="text-xs font-black uppercase tracking-wide text-red-200">Итого расходов</p>
          <p className="mt-3 text-3xl font-black text-white">{formatMoney(total)}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">по выбранному периоду</p>
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-xl">
          <p className="text-xs font-black uppercase tracking-wide text-slate-400">Записей</p>
          <p className="mt-3 text-3xl font-black text-white">{visibleExpenses.length}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">отфильтровано</p>
        </div>
        <div className="rounded-[2rem] border border-blue-400/20 bg-blue-500/10 p-5 shadow-2xl backdrop-blur-xl">
          <p className="text-xs font-black uppercase tracking-wide text-blue-200">Категория</p>
          <p className="mt-3 text-2xl font-black text-white">{filterCategory === "all" ? "Все" : categoryLabel(filterCategory)}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">активный фильтр</p>
        </div>
        <div className="rounded-[2rem] border border-violet-400/20 bg-violet-500/10 p-5 shadow-2xl backdrop-blur-xl">
          <p className="text-xs font-black uppercase tracking-wide text-violet-200">Тип</p>
          <p className="mt-3 truncate text-2xl font-black text-white">{filterType === "all" ? "Все типы" : filterType}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">внутри категории</p>
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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              onClick={() => setExpenseModal(true)}
              className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(37,99,235,.35)] sm:w-auto"
            >
              + Добавить расход
            </button>
            <div className="rounded-3xl border border-red-400/20 bg-red-500/10 px-5 py-4 text-white">
              <p className="text-sm text-red-200">Итого</p>
              <p className="text-2xl font-black">{formatMoney(total)}</p>
            </div>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="border-y border-white/10 bg-slate-950/50 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-4">Дата</th>
                <th className="p-4">Категория</th>
                <th className="p-4">Тип</th>
                <th className="p-4">За что</th>
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
                  <td className="p-4 font-bold text-white">{e.name}</td>
                  <td className="p-4 text-slate-400">{e.comment || "—"}</td>
                  <td className="p-4 font-black text-red-300">{formatMoney(e.amount)}</td>
                  <td className="p-4 text-slate-300">{e.employeeName || "—"}</td>

                  {!workerMode && (
                    <td className="p-4 text-right">
                      <button
                        onClick={() => openDeleteExpense(e)}
                        className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 font-black text-red-200 transition hover:bg-red-500/20"
                      >
                        ×
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

        <div className="divide-y divide-white/10 md:hidden">
          {visibleExpenses.map((e) => (
            <div key={e.id} className="p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-black text-white">{e.name}</p>
                  <p className="text-sm text-slate-400">{categoryLabel(e.category)} · {e.type || "—"}</p>
                  <p className="text-sm text-slate-500">{String(e.createdAt || "").slice(0, 10) || "—"}</p>
                  {e.comment && <p className="mt-1 text-sm text-slate-400">{e.comment}</p>}
                  <p className="mt-1 text-sm text-slate-500">Кто добавил: {e.employeeName || "—"}</p>
                </div>

                {!workerMode && (
                  <button
                    onClick={() => openDeleteExpense(e)}
                    className="shrink-0 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 font-black text-red-200"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-3">
                <p className="text-sm text-red-200">Сумма расхода</p>
                <p className="text-xl font-black text-red-200">{formatMoney(e.amount)}</p>
              </div>
            </div>
          ))}

          {!visibleExpenses.length && <div className="p-10 text-center font-bold text-slate-400">Расходов пока нет</div>}

          <div className="bg-slate-950/70 p-4 font-black text-white">
            <div className="flex justify-between">
              <span>Итого</span>
              <span className="text-red-200">{formatMoney(total)}</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => setExpenseModal(true)}
        className="fixed bottom-4 left-4 right-4 z-30 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-[0_18px_55px_rgba(37,99,235,.45)] sm:hidden"
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
              <span className="mb-2 block text-sm font-black text-slate-300">За что оплатили</span>
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
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"
              />
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
              className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(37,99,235,.35)]"
            >
              Создать
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
                className="flex-1 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 px-5 py-4 font-black text-white shadow-[0_18px_45px_rgba(239,68,68,.25)] transition hover:scale-[1.01]"
              >
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
