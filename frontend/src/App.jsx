import { useEffect, useState, lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";


import { hydrateAppearance } from "./theme/engine";
import AppShell from "./components/AppShell";
import { OWNER_LINKS as ownerLinks, WORKER_LINKS as workerLinks, RESTRICTED_LINKS as allRestrictedLinks, navigationDebtCount } from "./utils/navigation";
import LoginPage from "./pages/LoginPage";
import NavigationDialog from "./components/NavigationDialog";
import InstallPrompt from "./components/InstallPrompt";
import WorkspaceSelectPage from "./pages/WorkspaceSelectPage";

// Ленивая загрузка страниц: каждая грузится только при переходе на неё.
// Начальная загрузка (вход/касса) намного легче, а тяжёлый recharts (страницы
// аналитики) не тянется, пока их не откроют — критично для планшетов/медленной сети.
const HomePage = lazy(() => import("./pages/HomePage"));
const EmployeeAnalyticsPage = lazy(() => import("./pages/EmployeeAnalyticsPage"));
const FinanceReportPage = lazy(() => import("./pages/FinanceReportPage"));
const AppearancePage = lazy(() => import("./pages/AppearancePage"));
const WorkPage = lazy(() => import("./pages/WorkPage"));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage"));
const POSPage = lazy(() => import("./pages/POSPage"));
const SalesAnalyticsPage = lazy(() => import("./pages/SalesAnalyticsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const WarehousePage = lazy(() => import("./pages/WarehousePage"));
const AIWarehousePage = lazy(() => import("./pages/AIWarehousePage"));
const PendingPaymentsPage = lazy(() => import("./pages/PendingPaymentsPage"));
const DebtsPage = lazy(() => import("./pages/DebtsPage"));

import {
  clearSession,
  get,
  getCurrentProfile,
  getCurrentWorkspace,
  getSession,
  post,
  setCurrentProfile,
  setCurrentWorkspace,
  setSession,
} from "./api";
import { setDayStartHour } from "./utils/format";

const adminLinks = ownerLinks;

// ── Уведомления (тосты) ──────────────────────────────────────────────
// Тип определяется по тексту, чтобы старые вызовы alert() автоматически
// получали правильный цвет: ошибки — красные, успех — зелёные и т.д.
function inferToastType(text) {
  const t = String(text || "").toLowerCase();
  if (/(ошибк|неверн|не удал|не удаётся|не удается|нельзя|пуст|выбери|выберите|заполни|обязательн|не найден|недостаточно|нет доступа|запрещ|провал|fail|error)/.test(t)) return "error";
  if (/(сохран|заверш|готов|добавл|создан|удал|отправл|оплач|принят|успешн|импортирован|обновл|применен|применён)/.test(t)) return "success";
  if (/(внимани|предупрежд|проверьте|уже существ|учтите)/.test(t)) return "warning";
  return "info";
}

const TOAST_META = {
  success: { ring: "bg-emerald-500/20 text-emerald-400", label: "Готово" },
  error:   { ring: "bg-red-500/20 text-red-400",         label: "Ошибка" },
  warning: { ring: "bg-amber-500/20 text-amber-300",     label: "Внимание" },
  info:    { ring: "bg-blue-500/20 text-blue-300",       label: "Уведомление" },
};

function ToastIcon({ type }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" };
  if (type === "success") return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
  if (type === "error")   return <svg {...p}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></svg>;
  if (type === "warning") return <svg {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>;
}

export default function App() {
  const [session, setSessionState] = useState(getSession());
  const [workspace, setWorkspaceState] = useState(getCurrentWorkspace());
  const [workspaceSelected, setWorkspaceSelected] = useState(!!getCurrentWorkspace());
  const [profile, setProfile] = useState(getCurrentProfile());
  const [employees, setEmployees] = useState([]);
  const [employeeState, setEmployeeState] = useState({ loading: false, error: "" });
  const [employeeRevision, setEmployeeRevision] = useState(0);
  // Запрос пароля при выборе продавца за кассой (на общем устройстве)
  const [pwPrompt, setPwPrompt] = useState(null); // выбранный employee
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(null);
  const [debtCount, setDebtCount] = useState(null);
  const [userPages, setUserPages] = useState(null); // null = not loaded yet
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [desktopNavMode, setDesktopNavMode] = useState(() => localStorage.getItem("sales_app_desktop_nav_mode") || "sidebar");
  const location = useLocation();
  const navigate = useNavigate();
  const isAIWarehouseRoute = location.pathname === "/ai-warehouse";
  const isPosRoute = location.pathname === "/pos";
  // Полноэкранные («иммерсивные») экраны без общей навигации — как чат с ИИ.
  // Касса работает в режиме киоска: своя шапка с выходом, вся навигация скрыта.
  const isImmersive = isAIWarehouseRoute || isPosRoute;

  const toggleDesktopNavMode = () => {
    setDesktopNavMode((current) => {
      const next = current === "header" ? "sidebar" : "header";
      localStorage.setItem("sales_app_desktop_nav_mode", next);
      return next;
    });
  };

  useEffect(() => {
    const originalAlert = window.alert;
    const pushToast = (message, type) => {
      const text = String(message ?? "").trim() || "Готово";
      const kind = type || inferToastType(text);
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((items) => [...items, { id, text, type: kind }].slice(-4));
      const ttl = kind === "error" ? 6000 : kind === "warning" ? 4800 : 3600;
      window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), ttl);
    };
    window.alert = (message) => pushToast(message);
    // Явный типизированный вызов: window.notify("Сохранено", "success")
    window.notify = (message, type) => pushToast(message, type);
    window.showToast = (message, type) => pushToast(message, type);
    return () => { window.alert = originalAlert; delete window.showToast; delete window.notify; };
  }, []);

  useEffect(() => {
    const syncProfile = () => setProfile(getCurrentProfile());
    const syncWorkspace = () => { setWorkspaceState(getCurrentWorkspace()); setProfile(getCurrentProfile()); };
    // Сессия истекла (401 на любом запросе, в т.ч. фоновом): мягко возвращаемся на вход,
    // без перезагрузки страницы. api.js уже очистил localStorage.
    const onSessionExpired = () => {
      setSessionState(null); setWorkspaceState(null); setProfile(null);
      window.notify?.("Сессия истекла. Войдите снова.", "warning");
    };
    window.addEventListener("sales-profile-change", syncProfile);
    window.addEventListener("sales-workspace-change", syncWorkspace);
    window.addEventListener("sales-session-expired", onSessionExpired);
    return () => {
      window.removeEventListener("sales-profile-change", syncProfile);
      window.removeEventListener("sales-workspace-change", syncWorkspace);
      window.removeEventListener("sales-session-expired", onSessionExpired);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const currentWorkspace = workspace || session.workspace || {
      id: session.defaultWorkspaceId || session.workspaceId,
      accountId: session.ownerAccountId || session.accountId,
      dataAccountId: session.dataAccountId,
      name: session.workspaceName || "Основная точка",
      isMain: session.role !== "worker" && session.role !== "workspace",
    };
    if (!workspace && currentWorkspace?.dataAccountId) setCurrentWorkspace(currentWorkspace);
  }, [session, workspace]);

  const isOwner = session?.role === "owner";
  const isAdmin = session?.role === "branch_admin" || session?.role === "admin";
  const isWorker = session?.role === "worker" || session?.role === "workspace";

  useEffect(() => {
    if (!session || !isWorker) { setEmployees([]); setEmployeeState({ loading: false, error: "" }); return; }
    let alive = true;
    const dataAccountId = workspace?.dataAccountId || session.dataAccountId || session.accountId;
    setEmployees([]); setEmployeeState({ loading: true, error: "" });
    get("/employees", { dataAccountId }).then(list => {
      if (!Array.isArray(list)) throw new Error("Получен неполный список продавцов.");
      if (alive) { setEmployees(list); setEmployeeState({ loading: false, error: "" }); }
    }).catch(e => { if (alive) setEmployeeState({ loading: false, error: e.message || "Не удалось загрузить продавцов." }); });
    return () => { alive = false; };
  }, [session, workspace, isWorker, employeeRevision]);

  useEffect(() => {
    setPwPrompt(null); setPwInput(""); setPwError("");
  }, [session?.accountId, session?.token, workspace?.dataAccountId]);

  // Общее оформление аккаунта: владелец задаёт — применяется у всех.
  // Тянем с сервера при входе; применяем только если владелец что-то задал
  // (иначе не трогаем локальный/дефолтный вид).
  useEffect(() => {
    if (!session) return;
    get("/settings/appearance")
      .then((r) => { if (r && r.appearance) hydrateAppearance(r.appearance); })
      .catch(() => {});
  }, [session]);

  // Начало рабочего дня точки (во сколько открывается кофейня): держим в модульной
  // переменной, чтобы все пресеты «сегодня/этот месяц» считали день как бэкенд.
  // Поточечно — перечитываем при смене точки.
  useEffect(() => {
    if (!session) { setDayStartHour(0); return; }
    get("/settings/business-day")
      .then((r) => setDayStartHour(r?.dayStartHour || 0))
      .catch(() => setDayStartHour(0));
  }, [session, workspace]);

  useEffect(() => {
    if (!session) return;
    if (isOwner) { setUserPages(["*"]); return; }
    let alive = true;
    const dataAccountId = workspace?.dataAccountId || session.dataAccountId || session.accountId;
    setUserPages(null);
    const fallback = isAdmin ? ["*"] : ["/pos", "/pending-payments"];
    get("/user-permissions/my", { dataAccountId }).then(res => {
      if (!alive) return;
      if (res?.full) { setUserPages(["*"]); return; }
      const pages = typeof res?.pages === "string" ? JSON.parse(res.pages) : res?.pages;
      setUserPages(Array.isArray(pages) && pages.every(p => typeof p === "string") ? pages : fallback);
    }).catch(() => { if (alive) setUserPages(fallback); });
    return () => { alive = false; };
  }, [session, workspace, isOwner, isAdmin]);

  useEffect(() => {
    if (!session) return;
    let alive = true, pendingSequence = 0, debtSequence = 0;
    const dataAccountId = workspace?.dataAccountId || session.dataAccountId || session.accountId;
    setPendingCount(null); setDebtCount(null);
    const loadPendingCount = () => {
      const seq = ++pendingSequence;
      get("/pending-sales", { dataAccountId }).then(list => { if (alive && seq === pendingSequence) setPendingCount(Array.isArray(list) ? list.length : null); }).catch(() => { if (alive && seq === pendingSequence) setPendingCount(null); });
    };
    const loadDebtCount = () => {
      const seq = ++debtSequence;
      get("/debt-customers", { dataAccountId }).then(list => { const count = navigationDebtCount(list); if (alive && seq === debtSequence) setDebtCount(count); }).catch(() => { if (alive && seq === debtSequence) setDebtCount(null); });
    };
    loadPendingCount(); loadDebtCount();
    const interval = setInterval(() => { if (!document.hidden) { loadPendingCount(); loadDebtCount(); } }, 30000);
    window.addEventListener("sales-pending-change", loadPendingCount);
    return () => { alive = false; clearInterval(interval); window.removeEventListener("sales-pending-change", loadPendingCount); };
  }, [session, workspace]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTextInput = (el) => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === "textarea") return true;
      if (tag === "input") { const type = (el.type || "text").toLowerCase(); return !["button","submit","reset","checkbox","radio","file","image","range","color"].includes(type); }
      return false;
    };
    const vvp = window.visualViewport;
    if (vvp) {
      const onResize = () => setKeyboardVisible(vvp.height < window.innerHeight * 0.75);
      vvp.addEventListener("resize", onResize);
      return () => vvp.removeEventListener("resize", onResize);
    }
    const onFocus = (e) => { if (isTextInput(e.target)) setKeyboardVisible(true); };
    const onBlur = (e) => { if (isTextInput(e.target)) setTimeout(() => setKeyboardVisible(false), 150); };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => { document.removeEventListener("focusin", onFocus); document.removeEventListener("focusout", onBlur); };
  }, []);

  if (!session) {
    return <LoginPage onAuth={(u) => { setSession(u); setSessionState(u); setWorkspaceSelected(false); }} />;
  }

  const needsWorkspaceSelect = !workspaceSelected && (
    session.role === "branch_admin" || session.role === "worker" || session.role === "workspace"
  );

  if (needsWorkspaceSelect) {
    return (
      <WorkspaceSelectPage session={session} onLogout={() => { clearSession(); setSessionState(null); setWorkspaceState(null); setProfile(null); setWorkspaceSelected(false); }} onSelect={(ws) => {
        setWorkspaceState(ws);
        setWorkspaceSelected(true);
        setSessionState(prev => ({ ...prev, dataAccountId: ws.dataAccountId, workspaceId: ws.id, workspaceName: ws.name }));
      }} />
    );
  }

  const filteredLinks = (isWorker || isAdmin) && userPages && !userPages.includes("*")
    ? allRestrictedLinks.filter(([to]) => userPages.includes(to))
    : null;

  const links = !isOwner && userPages === null ? [] : isOwner ? ownerLinks
    : filteredLinks ? filteredLinks
    : isAdmin ? adminLinks
    : workerLinks;
  const currentWorkspace = workspace || session.workspace || {
    id: session.defaultWorkspaceId || session.workspaceId,
    accountId: session.ownerAccountId || session.accountId,
    dataAccountId: session.dataAccountId,
    name: session.workspaceName || "Основная точка",
    isMain: !isWorker,
  };

  const logout = () => {
    try {
      const ws = getCurrentWorkspace(); const sess = getSession();
      const accId = ws?.dataAccountId || sess?.dataAccountId || ws?.id || sess?.accountId || sess?.ownerAccountId;
      if (accId && accId !== 0) localStorage.removeItem(`sales_app_ai_operator_chat_${accId}`);
    } catch { /* ignore */ }
    clearSession(); setSessionState(null); setWorkspaceState(null); setProfile(null);
  };

  const allowedFallback = links.find(([path]) => path !== location.pathname)?.[0] || (isWorker ? "/pos" : "/home");
  const forbidden = !isOwner && userPages === null
    ? <div className="sh-access-loading" role="status"><span />Загружаю доступы…</div>
    : <Navigate to={allowedFallback} replace />;

  // Проверка доступа к странице (для worker и admin если ограничен)
  const canAccess = (path) => {
    if (isOwner) return true; // owner — всегда полный доступ
    if (!userPages) return false; // ещё не загрузили
    if (userPages.includes("*")) return true;
    return userPages.includes(path);
  };
  const handleProfileChange = (value) => {
    const selected = employees.find((x) => String(x.id) === String(value));
    if (selected?.hasPassword) {
      // У продавца задан пароль — спрашиваем его перед тем как встать за кассу
      setPwInput("");
      setPwError("");
      setPwPrompt(selected);
      return;
    }
    setCurrentProfile(selected || null);
    setProfile(selected || null);
  };

  const confirmProfilePw = async () => {
    if (!pwPrompt || pwBusy) return;
    setPwBusy(true); setPwError("");
    const selected = pwPrompt, dataAccountId = currentWorkspace?.dataAccountId || session.dataAccountId, token = session.token;
    try {
      const res = await post(`/employees/${selected.id}/verify`, { password: pwInput.trim() }, { dataAccountId });
      if (String(getCurrentWorkspace()?.dataAccountId) !== String(dataAccountId) || getSession()?.token !== token) return;
      if (!res?.ok) { setPwError("Неверный пароль"); return; }
      setCurrentProfile(selected); setProfile(selected); setPwPrompt(null); setPwInput("");
    } catch (e) { setPwError(e.message || "Не удалось проверить пароль"); }
    finally { setPwBusy(false); }
  };

  return (
    <>
      <AppShell links={links} session={session} workspace={currentWorkspace} profile={profile}
        employees={employees} employeeLoading={employeeState.loading} employeeError={employeeState.error}
        onRetryEmployees={() => setEmployeeRevision(v => v + 1)} onProfileChange={handleProfileChange} onLogout={logout}
        mode={desktopNavMode} onToggleMode={toggleDesktopNavMode} sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(v => !v)} immersive={isImmersive}
        keyboardVisible={keyboardVisible} pendingCount={pendingCount} debtCount={debtCount}
        accessLoading={!isOwner && !userPages}>
        <Suspense fallback={
          <div className="grid min-h-[60vh] place-items-center">
            <div className="flex items-center gap-3 text-slate-400">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-blue-400" />
              <span className="text-sm font-bold">Загрузка…</span>
            </div>
          </div>
        }>
        <Routes>
          <Route path="/" element={<Navigate to={isWorker ? "/pos" : "/home"} replace />} />
          <Route path="/home" element={isWorker ? <Navigate to="/pos" replace /> : <HomePage />} />
          <Route path="/appearance" element={isWorker ? <Navigate to="/pos" replace /> : <AppearancePage />} />
          <Route path="/pos" element={<POSPage currentProfile={profile} ownerName={isWorker ? profile?.name : session.ownerName || session.username} openProfile={() => { if (!isWorker) navigate("/profile"); }} isWorker={isWorker} employees={employees} onProfileChange={handleProfileChange} onExit={() => navigate(isWorker ? "/pending-payments" : "/home")} />} />
          <Route path="/expenses" element={<ExpensesPage currentProfile={profile} workerMode={isWorker} />} />
          <Route path="/pending-payments" element={<PendingPaymentsPage />} />
          <Route path="/debts" element={<DebtsPage />} />
          <Route path="/work" element={!canAccess("/work") ? forbidden : <WorkPage />} />
          <Route path="/ai-warehouse" element={!canAccess("/ai-warehouse") ? forbidden : <AIWarehousePage key={currentWorkspace?.dataAccountId || session?.dataAccountId || "default"} />} />
          <Route path="/warehouse" element={!canAccess("/warehouse") ? forbidden : <WarehousePage />} />
          <Route path="/profile" element={isWorker ? <Navigate to="/pos" replace /> : <ProfilePage session={session} workspace={currentWorkspace} profile={profile} setProfile={setProfile} setWorkspaceState={setWorkspaceState} logout={logout} />} />
          <Route path="/sales-analytics" element={!canAccess("/sales-analytics") ? forbidden : <SalesAnalyticsPage />} />
          <Route path="/analytics" element={!canAccess("/analytics") ? forbidden : <AnalyticsPage />} />
          <Route path="/team" element={isWorker ? <Navigate to="/pos" replace /> : <EmployeeAnalyticsPage />} />
          <Route path="/finance" element={isWorker ? <Navigate to="/pos" replace /> : <FinanceReportPage />} />
          <Route path="/shifts" element={<Navigate to={isWorker ? "/pos" : "/home"} replace />} />
          <Route path="/employees" element={<Navigate to="/profile" replace />} />
          <Route path="/cards" element={<Navigate to="/profile" replace />} />
          <Route path="*" element={<Navigate to={isWorker ? "/pos" : "/home"} replace />} />
        </Routes>
        </Suspense>
      </AppShell>

      {pwPrompt && (
        <NavigationDialog title="Пароль продавца" busy={pwBusy} onClose={() => { setPwPrompt(null); setPwInput(""); setPwError(""); }}>
          <p className="mb-4 text-sm text-slate-400">
            Введите пароль продавца <b className="text-white">{pwPrompt.name}</b>, чтобы встать за кассу.
          </p>
          <input value={pwInput} type="password" aria-label="Пароль продавца" disabled={pwBusy}
            onChange={(e) => { setPwInput(e.target.value); setPwError(""); }}
            onKeyDown={(e) => e.key === "Enter" && confirmProfilePw()}
            placeholder="Пароль"
            className="sh-password-input" />
          {pwError && <p role="alert" className="sh-profile-error">{pwError}</p>}
          <div className="sh-dialog-actions">
            <button type="button" disabled={pwBusy} onClick={() => { setPwPrompt(null); setPwInput(""); setPwError(""); }} className="sh-button">Отмена</button>
            <button type="button" disabled={pwBusy} onClick={confirmProfilePw} className="sh-button">{pwBusy ? "Проверяю…" : "Выбрать продавца"}</button>
          </div>
        </NavigationDialog>
      )}

      {/* Тосты на мобиле — над навигацией */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col-reverse gap-2 px-4 lg:hidden"
        style={{ paddingBottom: "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {toasts.slice(-2).map((toast) => {
          const meta = TOAST_META[toast.type] || TOAST_META.info;
          return (
            <div key={toast.id} className="animate-toast pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/12 bg-slate-800/97 px-4 py-3.5 shadow-2xl backdrop-blur-xl">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.ring}`}><ToastIcon type={toast.type} /></span>
              <p className="text-sm font-black text-white leading-snug">{toast.text}</p>
            </div>
          );
        })}
      </div>
      {/* Тосты на десктопе — правый верхний угол */}
      <div className="pointer-events-none fixed right-5 top-5 z-60 hidden w-full max-w-sm flex-col gap-2.5 lg:flex">
        {toasts.map((toast) => {
          const meta = TOAST_META[toast.type] || TOAST_META.info;
          return (
            <div key={toast.id} className="animate-toast pointer-events-auto flex items-start gap-3.5 rounded-2xl border border-white/12 bg-slate-800/97 px-5 py-4 shadow-2xl backdrop-blur-xl">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.ring}`}><ToastIcon type={toast.type} /></span>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{meta.label}</p>
                <p className="mt-0.5 text-sm font-black text-white">{toast.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Плашка «Установить приложение» (Android/десктоп — системная установка, iOS — подсказка) */}
      <InstallPrompt />
    </>
  );
}
