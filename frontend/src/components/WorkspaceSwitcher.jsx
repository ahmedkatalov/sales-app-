import { useEffect, useRef, useState } from "react";
import { ShoppingCart, Store, Star, Check, ChevronDown } from "lucide-react";
import { get, getCurrentWorkspace, setCurrentWorkspace } from "../api";

// Быстрое переключение между точками прямо из шапки: клик по названию точки →
// список всех доступных точек → выбор мгновенно переключает (перезагрузка с новыми данными).
export default function WorkspaceSwitcher({ accountName, accountLabel, workspaceName, showWorkspaceChip }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const wrapRef = useRef(null);
  const current = getCurrentWorkspace() || {};

  useEffect(() => {
    if (!open || list.length) return;
    get("/my-workspaces").then((l) => setList(Array.isArray(l) ? l : [])).catch(() => {});
  }, [open, list.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const switchTo = (ws) => {
    if (String(ws.id) === String(current.id)) { setOpen(false); return; }
    setCurrentWorkspace(ws);
    window.location.assign("/"); // перезагрузка → все данные перечитаются под новую точку
  };

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Переключить точку"
        className="flex w-full min-w-[210px] items-center gap-2 rounded-xl px-1 py-1 text-left transition hover:bg-white/5"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/25">
          <ShoppingCart size={22} strokeWidth={2.6} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-white">{accountName}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
            <p className="truncate text-xs font-bold text-slate-400">{accountLabel}</p>
            {showWorkspaceChip && (
              <>
                <span className="text-slate-600">·</span>
                <span className="truncate text-xs font-black text-blue-400">{workspaceName}</span>
              </>
            )}
          </div>
        </div>
        <ChevronDown size={16} className={`shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[280px] rounded-2xl border border-white/10 bg-[#0d1424] p-2 shadow-2xl shadow-black/60">
          <p className="px-2 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500">Мои точки</p>
          <div className="max-h-[320px] space-y-1 overflow-y-auto">
            {list.length === 0 && <p className="px-2 py-3 text-sm font-bold text-slate-500">Загрузка…</p>}
            {list.map((ws) => {
              const active = String(ws.id) === String(current.id);
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => switchTo(ws)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${active ? "bg-blue-500/15" : "hover:bg-white/5"}`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow">
                    {ws.isMain ? <Star size={16} /> : <Store size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-white">{ws.name}</p>
                    <p className="truncate text-[11px] font-bold text-slate-400">
                      {ws.role === "owner" ? "Владелец" : ws.role === "branch_admin" ? "Администратор" : "Кассир"}{ws.isMain ? " · Основная" : ""}
                    </p>
                  </div>
                  {active && <Check size={16} className="shrink-0 text-blue-300" />}
                </button>
              );
            })}
          </div>
          {list.length === 1 && (
            <p className="px-2 pb-1 pt-2 text-[11px] font-bold text-slate-500">У вас одна точка. Новые точки создаются в настройках.</p>
          )}
        </div>
      )}
    </div>
  );
}
