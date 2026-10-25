import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, Menu } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

export default function DesktopNavigation({
  links = [],
  isOwner,
  isAdmin,
  isWorker,
  workerName,
  pendingCount = 0,
  debtCount = 0,
  workspaceName = "",
  isProfileRoute,
  onToggleMode,
  onLogout,
}) {
  const navRef = useRef(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const el = navRef.current?.querySelector('[aria-current="page"]');
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pathname]);

  const accountLabel = isOwner
    ? "Главный аккаунт"
    : isAdmin
      ? "Админ точки"
      : "Рабочий аккаунт";

  // В шапке показываем имя бизнеса/точки, а не email
  const businessName = workspaceName || "Мой бизнес";
  const accountName = isWorker ? workerName || "Сотрудник" : businessName;
  const showWorkspaceChip = workspaceName && accountName !== workspaceName;

  return (
    <header className="sticky top-0 z-30 mb-5 hidden rounded-[1.4rem] border border-white/[0.08] bg-slate-950/80 p-2 text-white shadow-xl shadow-slate-950/25 backdrop-blur-xl md:block">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <WorkspaceSwitcher
          accountName={accountName}
          accountLabel={accountLabel}
          workspaceName={workspaceName}
          showWorkspaceChip={showWorkspaceChip}
        />

        <div className="relative min-w-0">
        <nav
          ref={navRef}
          className="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-1"
          aria-label="Верхнее меню"
        >
          {links.map(([to, label, Icon, badge]) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                `group relative flex h-11 shrink-0 items-center gap-2 rounded-xl px-2 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-500/20 lg:px-3 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm shadow-blue-950/40"
                    : "bg-white/[0.04] text-slate-300 hover:bg-white/[0.09] hover:text-white"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${isActive ? "bg-white/20" : "bg-white/5"}`}>
                    <Icon size={18} strokeWidth={2.4} />

                    {badge === "pending" && pendingCount > 0 && (
                      <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-400 px-1 text-[10px] font-bold leading-none text-sky-950 ring-2 ring-slate-950">
                        {pendingCount > 99 ? "99+" : pendingCount}
                      </span>
                    )}
                    {badge === "debt" && debtCount > 0 && (
                      <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-slate-950">
                        {debtCount > 99 ? "99+" : debtCount}
                      </span>
                    )}
                  </span>

                  <span className={`whitespace-nowrap ${isActive ? "inline" : "hidden 2xl:inline"}`}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
          <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-950/80 to-transparent lg:hidden" />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          {isProfileRoute && (
            <button
              type="button"
              onClick={onToggleMode}
              className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/10 px-2.5 text-xs font-semibold text-blue-200 transition hover:bg-blue-500/20 lg:px-3"
              title="Переключить меню сбоку / сверху"
              aria-label="Переключить расположение меню"
            >
              <Menu size={18} strokeWidth={2.4} />
              <span className="hidden lg:inline">Сбоку</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            title="Выйти"
            aria-label="Выйти"
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/5 px-2.5 text-xs font-semibold text-slate-300 transition hover:border-red-500/40 hover:bg-red-600 hover:text-white lg:px-3"
          >
            <LogOut size={18} strokeWidth={2.4} />
            <span className="hidden lg:inline">Выйти</span>
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
