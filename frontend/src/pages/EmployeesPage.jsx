import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");

  // Safe array guards
  const safe_employees = Array.isArray(employees) ? employees : [];

  const load = async () => {
    const data = await apiGet("/employees");
    setEmployees(data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const createEmployee = async () => {
    if (!name.trim()) return;

    await apiPost("/employees", {
      name: name.trim(),
    });

    setName("");
    load();
  };

  const remove = async (id) => {
    if (!window.confirm("Удалить сотрудника?")) return;

    await apiDelete(`/employees/${id}`);
    load();
  };

  const visibleEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (Array.isArray(employees) ? employees : []).filter((e) =>
      String(e.name || "").toLowerCase().includes(q)
    );
  }, [employees, search]);

  return (
    <div className="pb-nav sm:pb-10">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-bold text-blue-400">
            Команда
          </p>

          <h2 className="text-4xl font-black leading-none text-white sm:text-5xl">
            Сотрудники
          </h2>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Управление персоналом, сотрудниками смен и рабочими аккаунтами.
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
        <div className="rounded-[28px] border border-blue-500/30 bg-blue-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-blue-200">
            Всего сотрудников
          </p>

          <p className="mt-3 text-4xl font-black text-white">
            {safe_employees.length}
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            активных пользователей
          </p>
        </div>

        <div className="rounded-[28px] border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-200">
            Найдено
          </p>

          <p className="mt-3 text-4xl font-black text-white">
            {visibleEmployees.length}
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            по текущему поиску
          </p>
        </div>

        <div className="rounded-[28px] border border-violet-500/30 bg-violet-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-violet-200">
            Система
          </p>

          <p className="mt-3 text-2xl font-black text-white">
            ONLINE
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            управление персоналом
          </p>
        </div>
      </div>

      <div className="mb-5 rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[1fr_260px_180px]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя сотрудника"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
          />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск сотрудника"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
          />

          <button
            onClick={createEmployee}
            className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:scale-[1.01]"
          >
            + Добавить
          </button>
        </div>
      </div>

      <div className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:p-6">
          <p className="text-sm font-bold text-blue-400">
            Персонал
          </p>

          <h3 className="text-2xl font-black text-white sm:text-3xl">
            Список сотрудников
          </h3>

          <p className="text-sm text-slate-400">
            Все сотрудники, имеющие доступ к системе.
          </p>
        </div>

        {visibleEmployees.length ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {visibleEmployees.map((e) => (
              <div
                key={e.id}
                className="rounded-[28px] border border-white/10 bg-[#111827] p-5 shadow-xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-2xl font-black text-white">
                      {String(e.name || "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>

                    <p className="text-2xl font-black text-white">
                      {e.name}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      ID: {e.id}
                    </p>
                  </div>

                  <button
                    onClick={() => remove(e.id)}
                    className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-black text-red-300 transition hover:bg-red-500/15"
                  >
                    Удалить
                  </button>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                    Статус
                  </p>

                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />

                    <p className="font-bold text-emerald-300">
                      Активный сотрудник
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10 text-3xl">
              👤
            </div>

            <p className="text-xl font-black text-white">
              Сотрудников пока нет
            </p>

            <p className="mt-2 text-sm text-slate-400">
              Добавь первого сотрудника для работы системы.
            </p>
          </div>
        )}
      </div>

      <button
        onClick={createEmployee}
        className="fixed bottom-4 left-4 right-4 z-30 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-2xl sm:hidden"
      >
        + Добавить сотрудника
      </button>
    </div>
  );
}