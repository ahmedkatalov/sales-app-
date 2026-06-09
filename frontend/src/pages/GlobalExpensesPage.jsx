import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import { formatMoney } from "../utils/format";

export default function GlobalExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [employeeId, setEmployeeId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [search, setSearch] = useState("");
  const [expenseToDelete, setExpenseToDelete] = useState(null);

  // Safe array guards
  const safe_expenses = Array.isArray(expenses) ? expenses : [];
  const safe_employees = Array.isArray(employees) ? employees : [];

  const load = async () => {
    const [expenseData, employeeData] = await Promise.all([
      apiGet("/global-expenses"),
      apiGet("/employees"),
    ]);

    setExpenses(expenseData || []);
    setEmployees(employeeData || []);
  };

  useEffect(() => {
    load();
  }, []);

  const createExpense = async () => {
    if (!name.trim() || Number(amount) <= 0) return;

    await apiPost("/global-expenses", {
      employeeId: Number(employeeId),
      name: name.trim(),
      amount: Number(amount),
    });

    setName("");
    setAmount("");
    load();
  };

  const remove = async () => {
    if (!expenseToDelete) return;

    await apiDelete(`/global-expenses/${expenseToDelete.id}`);
    setExpenseToDelete(null);
    load();
  };

  const visibleExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();

    return safe_expenses.filter((e) => {
      const text = `${e.name || ""} ${e.employeeName || ""}`.toLowerCase();
      return !q || text.includes(q);
    });
  }, [expenses, search]);

  const total = useMemo(
    () => visibleExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [visibleExpenses]
  );

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6 pb-nav sm:pb-10">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-bold text-blue-400">Финансы</p>

          <h2 className="text-4xl font-black leading-none text-white sm:text-5xl">
            Общие расходы
          </h2>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Учёт расходов точки: кто добавил, за что оплатили и какая сумма ушла.
          </p>
        </div>

        <button
          onClick={load}
          className="w-full rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-black text-white shadow-xl transition hover:bg-white/15 sm:w-auto"
        >
          ⟳ Обновить
        </button>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-[28px] border border-red-500/30 bg-red-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-red-200">
            Всего расходов
          </p>

          <p className="mt-3 text-4xl font-black text-white">
            {formatMoney(total)}
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            по текущему списку
          </p>
        </div>

        <div className="rounded-[28px] border border-blue-500/30 bg-blue-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-blue-200">
            Записей
          </p>

          <p className="mt-3 text-4xl font-black text-white">
            {visibleExpenses.length}
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            найдено расходов
          </p>
        </div>

        <div className="rounded-[28px] border border-violet-500/30 bg-violet-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-violet-200">
            Сотрудников
          </p>

          <p className="mt-3 text-4xl font-black text-white">
            {safe_employees.length}
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            доступны для выбора
          </p>
        </div>
      </div>

      <div className="mb-5 rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[240px_1fr_180px_180px]">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none"
          >
            <option value="">Сотрудник</option>

            {safe_employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название расхода"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
          />

          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Сумма"
            type="number"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
          />

          <button
            onClick={createExpense}
            className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:scale-[1.01]"
          >
            + Добавить
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по расходу или сотруднику"
          className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
        />
      </div>

      <div className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:p-6">
          <p className="text-sm font-bold text-blue-400">Список</p>

          <h3 className="text-2xl font-black text-white sm:text-3xl">
            Расходы
          </h3>

          <p className="text-sm text-slate-400">
            Все добавленные расходы с суммой и сотрудником.
          </p>
        </div>

        {visibleExpenses.length ? (
          <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
            {visibleExpenses.map((e) => (
              <div
                key={e.id}
                className="rounded-[28px] border border-white/10 bg-[#111827] p-5 shadow-xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-2xl font-black text-white">
                      {e.name}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {e.employeeName || "Сотрудник не указан"}
                    </p>
                  </div>

                  <button
                    onClick={() => setExpenseToDelete(e)}
                    className="shrink-0 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-black text-red-300 transition hover:bg-red-500/15"
                  >
                    Удалить
                  </button>
                </div>

                <div className="mt-5 flex items-center justify-between rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                  <span className="text-sm font-bold text-slate-400">
                    Сумма расхода
                  </span>

                  <span className="text-xl font-black text-red-300">
                    {formatMoney(e.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10 text-3xl">
              ₽
            </div>

            <p className="text-xl font-black text-white">Расходов пока нет</p>

            <p className="mt-2 text-sm text-slate-400">
              Добавь первый расход, чтобы он появился здесь.
            </p>
          </div>
        )}
      </div>

      {expenseToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-[#0f172a] p-6 shadow-2xl">
            <p className="text-sm font-bold text-red-300">
              Подтверждение удаления
            </p>

            <h3 className="mt-2 text-2xl font-black text-white">
              Удалить расход?
            </h3>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Расход{" "}
              <span className="font-black text-white">
                «{expenseToDelete.name}»
              </span>{" "}
              на сумму{" "}
              <span className="font-black text-red-300">
                {formatMoney(expenseToDelete.amount)}
              </span>{" "}
              будет удалён без системного alert.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => setExpenseToDelete(null)}
                className="flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-white transition hover:bg-white/15"
              >
                Отмена
              </button>

              <button
                onClick={remove}
                className="flex-1 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 px-5 py-4 font-black text-white shadow-lg shadow-red-900/30 transition hover:scale-[1.01]"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}