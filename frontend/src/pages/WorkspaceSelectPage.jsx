import { useEffect, useState } from "react";
import { get, setCurrentWorkspace } from "../api";

export default function WorkspaceSelectPage({ session, onSelect }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get("/my-workspaces")
      .then((list) => {
        const safe = Array.isArray(list) ? list : [];
        setWorkspaces(safe);
        // Если только одна точка — сразу выбираем
        if (safe.length === 1) onSelect(safe[0]);
      })
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (ws) => {
    setCurrentWorkspace(ws);
    onSelect(ws);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4">
      <div className="w-full max-w-lg">
        {/* Шапка */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-600 text-3xl shadow-2xl shadow-blue-600/30">
            🏪
          </div>
          <h1 className="text-3xl font-black text-white">Выбери заведение</h1>
          <p className="mt-2 text-slate-400">
            Привет, <span className="font-black text-white">{session?.username}</span>! Выбери точку для работы.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-400/30 border-t-blue-400" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-3xl border border-red-400/20 bg-red-500/10 p-6 text-center text-red-300">
            У тебя нет доступа ни к одной точке. Обратись к владельцу.
          </div>
        ) : (
          <div className="grid gap-3">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => handleSelect(ws)}
                className="group flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.06] p-5 text-left shadow-xl transition hover:border-blue-400/40 hover:bg-blue-500/10"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-xl shadow-lg">
                  {ws.isMain ? "⭐" : "🏪"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-black text-white">{ws.name}</p>
                  <p className="text-sm text-slate-400">
                    {ws.role === "owner" ? "Владелец" : ws.role === "branch_admin" ? "Администратор" : "Сотрудник"}
                    {ws.isMain ? " · Основная" : ""}
                  </p>
                </div>
                <span className="shrink-0 text-slate-500 transition group-hover:translate-x-1 group-hover:text-white">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
