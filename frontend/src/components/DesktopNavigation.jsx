import { NavLink } from "react-router-dom";
import { LogOut, Menu, ShoppingCart } from "lucide-react";

export default function DesktopNavigation({
  links = [],
  session,
  isOwner,
  isAdmin,
  isWorker,
  workerName,
  pendingCount = 0,
  isProfileRoute,
  onToggleMode,
  onLogout,
}) {
  const accountLabel = isOwner
    ? "Главный аккаунт"
    : isAdmin
      ? "Админ точки"
      : "Рабочий аккаунт";

  const accountName = isWorker ? workerName : session?.username;

  return (
    <header className="sticky top-0 z-30 mb-5 hidden rounded-[1.4rem] border border-white/10 bg-slate-950/80 p-2 text-white shadow-xl shadow-slate-950/25 backdrop-blur-xl lg:block">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-[210px] items-center gap-2 px-1">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/25">
            <ShoppingCart size={22} strokeWidth={2.6} />
          </div>

          <div className="min-w-0">
            <p className="truncate text-xs font-black text-white">Sales App</p>
            <p className="truncate text-xs font-bold text-slate-400">
              {accountLabel} · {accountName}
            </p>
          </div>
        </div>

        <nav
          className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-1"
          aria-label="Верхнее меню"
        >
          {links.map(([to, label, Icon, badge]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group relative flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-black transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                    : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                <Icon size={18} strokeWidth={2.4} />

                {badge === "pending" && pendingCount > 0 && (
                  <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black leading-none text-white ring-2 ring-slate-950">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
              </span>

              <span className="whitespace-nowrap">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          {isProfileRoute && (
            <button
              type="button"
              onClick={onToggleMode}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 text-xs font-black text-blue-200 transition hover:bg-blue-500/20"
              title="Переключить меню сбоку / сверху"
            >
              <Menu size={18} strokeWidth={2.4} />
              Сбоку
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-black text-slate-300 transition hover:border-red-500/40 hover:bg-red-600 hover:text-white"
          >
            <LogOut size={18} strokeWidth={2.4} />
            Выйти
          </button>
        </div>
      </div>

      <style>{`
        .no-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </header>
  );
}
