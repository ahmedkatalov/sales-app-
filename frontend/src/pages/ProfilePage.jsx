import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3, Bot, Briefcase, Clock, FileText, Lightbulb,
  Package, ShoppingCart, Trash2, TrendingUp, Wallet,
  ClipboardList, Copy, RefreshCw,
  LayoutDashboard, SlidersHorizontal, Building2, KeyRound, Users, Share2,
  ShieldCheck, CreditCard, ChevronRight, LogOut, UserRound, Settings2, Pencil, Store,
} from "lucide-react";
import {
  del,
  get,
  post,
  put,
  setCurrentProfile,
  setCurrentWorkspace,
} from "../api";
import { getSession, setSession } from "../api";
import { setDayStartHour as applyDayStartHour } from "../utils/format";
import Modal from "../components/Modal";
import ThemeToggle from "../components/ThemeToggle";
import InstallAppCard from "../components/InstallAppCard";

// Все доступные страницы для назначения прав
const ALL_PAGES = [
  { path: "/pos",            label: "Касса",              icon: ShoppingCart },
  { path: "/pending-payments", label: "К оплате",         icon: Clock },
  { path: "/debts",          label: "Долги",              icon: FileText },
  { path: "/expenses",       label: "Расходы",            icon: Wallet },
  { path: "/work",           label: "Товары",             icon: Briefcase },
  { path: "/warehouse",      label: "Склад",              icon: Package },
  { path: "/ai-warehouse",   label: "Помощник",           icon: Bot },
  { path: "/sales-analytics", label: "Продажи",           icon: BarChart3 },
  { path: "/analytics",      label: "Аналитика",          icon: TrendingUp },
];

// Логины, которым владелец настраивает доступ к страницам (владелец и администратор видят всё всегда).
const isAssignable = (u) => u.role === "worker" || u.role === "workspace";

const ownerTabs = [
  { id: "overview",     label: "Обзор",              icon: LayoutDashboard },
  { id: "settings",     label: "Настройки точки",    icon: SlidersHorizontal },
  { id: "branches",     label: "Точки",              icon: Building2 },
  { id: "accounts",     label: "Логины",             icon: KeyRound },
  { id: "employees",    label: "Продавцы",           icon: Users },
  { id: "access",       label: "Доступ к точкам",    icon: Share2 },
  { id: "permissions",  label: "Права на страницы",  icon: ShieldCheck },
  { id: "cards",        label: "Карты",              icon: CreditCard },
];

const adminTabs = [
  { id: "overview",   label: "Обзор",           icon: LayoutDashboard },
  { id: "settings",   label: "Настройки точки", icon: SlidersHorizontal },
  { id: "employees",  label: "Продавцы",        icon: Users },
  { id: "accounts",   label: "Логины",          icon: KeyRound },
  { id: "cards",      label: "Карты",           icon: CreditCard },
];

const workerTabs = [
  { id: "overview",   label: "Обзор",    icon: LayoutDashboard },
  { id: "employees",  label: "Продавцы", icon: Users },
];

export default function ProfilePage({
  session,
  workspace,
  profile,
  setProfile,
  setWorkspaceState,
  logout,
}) {
  const isOwner       = session?.role === "owner";
  const isBranchAdmin = session?.role === "branch_admin";

  const tabs = isOwner ? ownerTabs : isBranchAdmin ? adminTabs : workerTabs;

  const [activeTab, setActiveTab] = useState("overview");
  const activePillRef = useRef(null);
  // Автоцентрирование активной вкладки в мобильной ленте (косметика).
  useEffect(() => {
    try { activePillRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); } catch { /* ignore */ }
  }, [activeTab]);
  const [ownerName, setOwnerName] = useState(session?.ownerName || "");
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerSaved, setOwnerSaved] = useState(false);
  // Начало рабочего дня точки (во сколько открывается кофейня) — влияет на отчёты «за сегодня».
  const [dayStart, setDayStart] = useState(0);
  const [dayStartSaving, setDayStartSaving] = useState(false);
  // Ключ приёма заказов с сайта (для настройки сайта меню).
  const [intakeKey, setIntakeKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  // Настройки ИИ (ключ/модель/базовый URL провайдера нейросети).
  const [ai, setAi] = useState({ model: "", baseUrl: "", hasKey: false, keyMasked: "" });
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTest, setAiTest] = useState(null); // { ok, msg }
  const [workspaces,      setWorkspaces]      = useState([]);
  const [workspaceUsers,  setWorkspaceUsers]  = useState([]);
  const [workspaceAccess, setWorkspaceAccess] = useState([]);
  const [employees,       setEmployees]       = useState([]);
  const [cards,           setCards]           = useState([]);

  const [modal,         setModal]         = useState(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [employeeName,  setEmployeeName]  = useState("");
  const [cardName,      setCardName]      = useState("");
  const [cardOwner,     setCardOwner]     = useState("");
  const [accountForm,   setAccountForm]   = useState({
    workspaceId: "", username: "", password: "", role: "worker",
  });
  const [permissions, setPermissions] = useState([]);
  const [editingPerms, setEditingPerms] = useState(null); // { userId, username, workspaceId, pages }
  const safe_permissions = Array.isArray(permissions) ? permissions : [];

  const [grantForm, setGrantForm] = useState({
    userId: "", workspaceId: "", role: "branch_admin",
  });

  const [managedAccount,      setManagedAccount]      = useState(null);
  const [managedEmployees,    setManagedEmployees]    = useState([]);
  const [managedEmployeeName, setManagedEmployeeName] = useState("");
  const [employeePass, setEmployeePass] = useState("");
  const [managedEmployeePass, setManagedEmployeePass] = useState("");
  // Запрос пароля при выборе профиля продавца
  const [pwPrompt, setPwPrompt] = useState(null); // { employee }
  const [pwInput, setPwInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  // Safe array guards
  const safe_workspaces      = Array.isArray(workspaces)      ? workspaces      : [];
  const safe_workspaceUsers  = Array.isArray(workspaceUsers)  ? workspaceUsers  : [];
  const safe_workspaceAccess = Array.isArray(workspaceAccess) ? workspaceAccess : [];
  const safe_employees       = Array.isArray(employees)       ? employees       : [];
  const safe_cards           = Array.isArray(cards)           ? cards           : [];
  const safe_managedEmployees = Array.isArray(managedEmployees) ? managedEmployees : [];

  const accountTypeLabel = isOwner
    ? "Главный аккаунт"
    : isBranchAdmin ? "Администратор точки" : "Кассир";

  const currentWorker =
    profile?.name ||
    (isOwner
      ? session?.ownerName || session?.username
      : isBranchAdmin ? session?.username : "профиль не выбран");

  const roleName = (role) => {
    if (role === "branch_admin") return "Администратор";
    if (role === "worker" || role === "workspace") return "Кассир";
    return role || "Логин";
  };

  // Защита от гонки: при переключении точки старый ответ не должен затирать свежие данные.
  const reqRef = useRef(0);
  const load = async () => {
    const seq = ++reqRef.current;
    setLoading(true);
    setError("");
    try {
      const requests = [];
      requests.push(get("/employees"));
      if (isOwner || isBranchAdmin) requests.push(get("/workspace-users"));
      if (isOwner || isBranchAdmin) requests.push(get("/cards"));
      if (isOwner) requests.push(get("/workspaces"));
      if (isOwner) requests.push(get("/workspace-access"));
      if (isOwner) requests.push(get("/user-permissions"));

      const result = await Promise.all(requests);
      if (seq !== reqRef.current) return; // устаревший ответ — игнорируем
      let i = 0;

      setEmployees(result[i++] || []);
      if (isOwner || isBranchAdmin) setWorkspaceUsers(result[i++]  || []);
      if (isOwner || isBranchAdmin) setCards(result[i++]           || []);
      if (isOwner) {
        const ws = result[i++] || [];
        setWorkspaces(ws);
        if (!accountForm.workspaceId && ws.length) {
          setAccountForm((p) => ({ ...p, workspaceId: String(workspace?.id || ws[0].id) }));
        }
      }
      if (isOwner) setWorkspaceAccess(result[i++] || []);
      if (isOwner) setPermissions(result[i++] || []);
    } catch (e) {
      if (seq !== reqRef.current) return;
      setError(e.message || "Ошибка загрузки");
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  };

  // Перезагружаем при смене точки (dataAccountId), иначе показываются продавцы/карты прошлой точки.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [workspace?.dataAccountId]);
  useEffect(() => {
    if (!isOwner && workspace?.id)
      setAccountForm((p) => ({ ...p, workspaceId: String(workspace.id) }));
  }, [isOwner, workspace?.id]);

  // Час начала рабочего дня точки — читаем при смене точки (настройка поточечная).
  useEffect(() => {
    get("/settings/business-day")
      .then((r) => setDayStart(Number(r?.dayStartHour) || 0))
      .catch(() => setDayStart(0));
    get("/online-orders/key")
      .then((r) => setIntakeKey(r?.key || ""))
      .catch(() => setIntakeKey(""));
    get("/settings/ai")
      .then((r) => setAi({ model: r?.model || "", baseUrl: r?.baseUrl || "", hasKey: !!r?.hasKey, keyMasked: r?.keyMasked || "" }))
      .catch(() => {});
  }, [workspace?.dataAccountId]);

  const saveAI = async () => {
    setAiSaving(true);
    setAiTest(null);
    try {
      await put("/settings/ai", { apiKey: aiKeyInput, model: ai.model, baseUrl: ai.baseUrl });
      setAiKeyInput("");
      const r = await get("/settings/ai");
      setAi({ model: r?.model || "", baseUrl: r?.baseUrl || "", hasKey: !!r?.hasKey, keyMasked: r?.keyMasked || "" });
      window.notify?.("Настройки ИИ сохранены", "success");
    } catch (e) {
      window.notify?.(e?.message || "Не удалось сохранить", "error");
    } finally {
      setAiSaving(false);
    }
  };
  const testAI = async () => {
    setAiTesting(true);
    setAiTest(null);
    try {
      const r = await post("/settings/ai/test", {});
      setAiTest(r?.ok ? { ok: true, msg: `Работает · модель ${r.model}` } : { ok: false, msg: r?.error || "Нейросеть не ответила" });
    } catch (e) {
      setAiTest({ ok: false, msg: e?.message || "Ошибка проверки" });
    } finally {
      setAiTesting(false);
    }
  };

  const rotateIntakeKey = async () => {
    if (!window.confirm("Перевыпустить ключ? Старый перестанет работать — на сайте надо будет вписать новый.")) return;
    setKeyBusy(true);
    try {
      const k = await post("/online-orders/key/rotate", {});
      setIntakeKey(k?.key || "");
      window.notify?.("Новый ключ создан — обновите его на сайте", "success");
    } catch (e) {
      window.notify?.(e?.message || "Не удалось перевыпустить ключ", "error");
    } finally {
      setKeyBusy(false);
    }
  };

  const saveDayStart = async (hour) => {
    setDayStartSaving(true);
    try {
      await put("/settings/business-day", { dayStartHour: hour });
      setDayStart(hour);
      applyDayStartHour(hour); // сразу применяем к пресетам дат без перезагрузки
      window.notify?.("Начало рабочего дня сохранено", "success");
    } catch (e) {
      window.notify?.(e?.message || "Не удалось сохранить", "error");
    } finally {
      setDayStartSaving(false);
    }
  };

  const usersByWorkspace = useMemo(() =>
    (Array.isArray(workspaceUsers) ? workspaceUsers : []).reduce((acc, u) => {
      const key = String(u.workspaceId || "");
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {}),
  [workspaceUsers]);

  const visibleWorkspaceUsers = useMemo(() =>
    isOwner ? workspaceUsers
            : (Array.isArray(workspaceUsers) ? workspaceUsers : []).filter((u) => String(u.workspaceId) === String(workspace?.id)),
  [isOwner, workspaceUsers, workspace?.id]);

  // ── CRUD helpers ────────────────────────────────────────────────────────────

  const loadManagedEmployees = async (account) => {
    if (!account?.dataAccountId) return;
    const list = await get(`/employees?dataAccountId=${account.dataAccountId}`);
    setManagedEmployees(list || []);
  };

  const openManageProfiles = async (account) => {
    setError("");
    setManagedAccount(account);
    setManagedEmployees([]);
    setManagedEmployeeName("");
    setModal("manageProfiles");
    try { await loadManagedEmployees(account); }
    catch (e) { setError(e.message || "Ошибка загрузки профилей"); }
  };

  const createManagedEmployee = async () => {
    setError("");
    if (!managedAccount?.dataAccountId) return setError("Аккаунт не выбран");
    if (!managedEmployeeName.trim())     return setError("Введите имя профиля");
    await post("/employees", { accountId: managedAccount.dataAccountId, name: managedEmployeeName.trim(), password: managedEmployeePass.trim() });
    setManagedEmployeeName("");
    setManagedEmployeePass("");
    await loadManagedEmployees(managedAccount);
  };

  const removeManagedEmployee = async (id) => {
    if (!confirm("Удалить профиль сотрудника?")) return;
    await del(`/employees/${id}?dataAccountId=${managedAccount.dataAccountId}`);
    await loadManagedEmployees(managedAccount);
  };

  const createWorkspace = async () => {
    setError("");
    if (!isOwner) return setError("Только главный аккаунт может создавать точки");
    if (!workspaceName.trim()) return setError("Введите название точки");
    const created = await post("/workspaces", { name: workspaceName.trim() });
    setWorkspaceName("");
    setModal(null);
    await load();
    setCurrentWorkspace(created);
    setWorkspaceState(created);
  };

  const switchWorkspace = (w) => {
    if (!isOwner) return;
    setCurrentWorkspace(w);
    setWorkspaceState(w);
    setCurrentProfile(null);
    setProfile(null);
  };

  const createWorkspaceUser = async () => {
    setError("");
    const workspaceId = isOwner ? accountForm.workspaceId : workspace?.id;
    if (!workspaceId)               return setError("Выберите точку");
    if (!accountForm.username.trim()) return setError("Введите логин");
    if (!accountForm.password.trim()) return setError("Введите пароль");
    const role = accountForm.role === "branch_admin" ? "branch_admin" : "worker";
    await post("/workspace-users", {
      workspaceId: Number(workspaceId),
      username: accountForm.username.trim(),
      password: accountForm.password,
      role,
    });
    setAccountForm((p) => ({ ...p, username: "", password: "", role: "worker" }));
    setModal(null);
    await load();
  };

  const removeWorkspaceUser = async (id) => {
    if (!confirm("Удалить аккаунт?")) return;
    await del(`/workspace-users/${id}`);
    await load();
  };

  // ── Права на страницы ─────────────────────────────────────────────────────
  const openEditPerms = (user) => {
    const existing = safe_permissions.find(p => p.userId === user.id || p.userId === user.userId);
    const pages = existing?.pages
      ? (typeof existing.pages === "string" ? JSON.parse(existing.pages) : existing.pages)
      : ["/pos", "/pending-payments"];
    setEditingPerms({
      userId: user.id || user.userId,
      username: user.username,
      workspaceId: user.workspaceId || 0,
      pages,
    });
    setModal("editPerms");
  };

  const savePerms = async () => {
    if (!editingPerms) return;
    await put(`/user-permissions/${editingPerms.userId}`, {
      workspaceId: editingPerms.workspaceId,
      pages: editingPerms.pages,
    });
    setModal(null);
    await load();
  };

  const togglePage = (path) => {
    setEditingPerms(p => ({
      ...p,
      pages: p.pages.includes(path) ? p.pages.filter(x => x !== path) : [...p.pages, path],
    }));
  };

  // ── Мультидоступ ──────────────────────────────────────────────────────────
  const grantAccess = async () => {
    setError("");
    if (!grantForm.userId)      return setError("Выберите пользователя");
    if (!grantForm.workspaceId) return setError("Выберите точку");
    await post("/workspace-access", {
      userId:      Number(grantForm.userId),
      workspaceId: Number(grantForm.workspaceId),
      role:        grantForm.role,
    });
    setGrantForm({ userId: "", workspaceId: "", role: "branch_admin" });
    setModal(null);
    await load();
  };

  const revokeAccess = async (id) => {
    if (!confirm("Убрать доступ?")) return;
    await del(`/workspace-access/${id}`);
    await load();
  };

  // ── Сотрудники / карты ────────────────────────────────────────────────────
  const createEmployee = async () => {
    setError("");
    if (!employeeName.trim()) return setError("Введите имя продавца");
    const created = await post("/employees", { name: employeeName.trim(), password: employeePass.trim() });
    setEmployeeName("");
    setEmployeePass("");
    setModal(null);
    await load();
    setCurrentProfile(created);
    setProfile(created);
  };

  // Выбор продавца «за кассу». Если у продавца задан пароль — сначала спрашиваем его.
  const pickEmployee = (e) => {
    if (e?.hasPassword) {
      setPwInput("");
      setError("");
      setPwPrompt({ employee: e });
      return;
    }
    setCurrentProfile(e);
    setProfile(e);
  };

  const confirmPwPrompt = async () => {
    if (!pwPrompt?.employee) return;
    let res;
    try {
      res = await post(`/employees/${pwPrompt.employee.id}/verify`, { password: pwInput.trim() });
    } catch {
      return setError("Не удалось проверить пароль");
    }
    if (!res?.ok) return setError("Неверный пароль");
    setCurrentProfile(pwPrompt.employee);
    setProfile(pwPrompt.employee);
    setPwPrompt(null);
    setPwInput("");
    setError("");
  };
  const removeEmployee = async (id) => {
    if (!confirm("Удалить профиль сотрудника?")) return;
    try {
      await del(`/employees/${id}`);
      if (profile?.id === id) { setCurrentProfile(null); setProfile(null); }
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось удалить сотрудника");
    }
  };

  const createCard = async () => {
    setError("");
    if (!cardName.trim()) return setError("Введите название карты или банка");
    try {
      await post("/cards", { name: cardName.trim(), owner: cardOwner.trim() });
      setCardName("");
      setCardOwner("");
      setModal(null);
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось создать карту");
    }
  };

  const removeCard = async (id) => {
    if (!confirm("Удалить карту?")) return;
    try {
      await del(`/cards/${id}`);
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось удалить карту");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const saveOwnerName = async () => {
    const name = ownerName.trim();
    if (!name || ownerSaving) return;
    setOwnerSaving(true);
    try {
      await put("/account", { name });
      try { const s = getSession(); if (s) { s.ownerName = name; setSession(s); } } catch { /* ignore */ }
      setOwnerSaved(true);
      window.notify?.("Имя владельца обновлено", "success");
      setTimeout(() => setOwnerSaved(false), 2500);
    } catch (e) {
      window.notify?.(e?.message || "Не удалось сохранить имя", "error");
    } finally {
      setOwnerSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen pb-nav text-white sm:pb-10" style={{ WebkitTapHighlightColor: "transparent" }}>

      <div className="relative z-10">
        <header className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 ">
              <Settings2 size={22} strokeWidth={2.4} className="text-white" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-400">{accountTypeLabel}</p>
              <h2 className="text-2xl font-semibold leading-none text-white sm:text-3xl">Настройки</h2>
              <p className="mt-1 truncate text-sm text-slate-400">
                {isOwner ? "Точки, логины и продавцы" : "Продавцы и текущая точка"}
              </p>
            </div>
          </div>
          <div className="flex w-full gap-2 lg:w-auto">
            <ThemeToggle variant="full" className="flex-1 lg:flex-none" />
            <button type="button" onClick={logout}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-3 font-semibold text-red-300 transition hover:bg-red-500/20 lg:flex-none">
              <LogOut size={16} strokeWidth={2.4} /> Выйти
            </button>
          </div>
        </header>

        <div className="mb-4"><InstallAppCard /></div>

        {error && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 font-bold text-red-300">{error}</div>
        )}

        {/* Навигация (боковой рейл на десктопе, лента на телефоне) + контент */}
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[256px_1fr]">
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.02]">
              {/* Мобильная лента вкладок */}
              <nav role="tablist" aria-label="Разделы настроек"
                className="flex gap-2 overflow-x-auto p-2 lg:hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {tabs.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button key={tab.id} ref={active ? activePillRef : null} type="button" role="tab" aria-selected={active}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex shrink-0 snap-start items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                        active ? "bg-indigo-600 text-white shadow-lg" : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                      }`}>
                      <tab.icon size={16} strokeWidth={2.4} /> <span>{tab.label}</span>
                    </button>
                  );
                })}
              </nav>
              {/* Десктоп-рейл */}
              <nav role="tablist" aria-label="Разделы настроек" className="hidden lg:flex lg:flex-col lg:gap-1 lg:p-3">
                <p className="px-3.5 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Разделы</p>
                {tabs.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button key={tab.id} type="button" role="tab" aria-selected={active}
                      onClick={() => setActiveTab(tab.id)}
                      className={`group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                        active ? "bg-gradient-to-r from-blue-600/20 to-violet-600/15 text-white" : "text-slate-400 hover:bg-white/[0.02] hover:text-slate-100"
                      }`}>
                      {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-indigo-400" />}
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${active ? "bg-indigo-600 text-white " : "bg-white/5 text-slate-400 group-hover:text-slate-200"}`}>
                        <tab.icon size={18} strokeWidth={2.4} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left">{tab.label}</span>
                      {active && <ChevronRight size={15} className="shrink-0 text-blue-300" />}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          <div className="min-w-0 space-y-5">
            {loading && <div className="rounded-2xl border border-blue-500/25 bg-blue-500/10 px-4 py-3 font-bold text-blue-300">Загрузка…</div>}

        {/* ── Обзор ── */}
        {activeTab === "overview" && (
          <section className="grid gap-5 xl:grid-cols-3">
            {/* Идентичность + статистика */}
            <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] xl:col-span-2">
              <div className="relative bg-white/[0.02] p-5 sm:p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-semibold text-white  sm:h-20 sm:w-20 sm:text-3xl">
                    {(session?.username || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h3 className="break-all text-xl font-semibold text-white sm:text-2xl">{session?.username}</h3>
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-300">
                      <ShieldCheck size={13} strokeWidth={2.6} /> {accountTypeLabel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5"><Building2 size={16} className="text-slate-300" /></span>
                  <p className="mt-2 text-xs font-bold text-slate-400">Текущая точка</p>
                  <p className="mt-0.5 break-words text-lg font-semibold text-white sm:text-2xl">{workspace?.name || "Основная точка"}</p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5"><UserRound size={16} className="text-slate-300" /></span>
                  <p className="mt-2 text-xs font-bold text-slate-400">{isOwner ? "Владелец" : "Сейчас работает"}</p>
                  <p className="mt-0.5 break-words text-lg font-semibold text-blue-300 sm:text-2xl">{isOwner ? (ownerName || currentWorker) : currentWorker}</p>
                </div>
                {isOwner && (
                  <>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5"><Store size={16} className="text-slate-300" /></span>
                      <p className="mt-2 text-xs font-bold text-slate-400">Точек</p>
                      <p className="mt-0.5 text-lg font-semibold text-white sm:text-2xl">{safe_workspaces.length}</p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5"><KeyRound size={16} className="text-slate-300" /></span>
                      <p className="mt-2 text-xs font-bold text-slate-400">Логинов</p>
                      <p className="mt-0.5 text-lg font-semibold text-white sm:text-2xl">{safe_workspaceUsers.length}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {isOwner && (
              <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 text-blue-400"><Pencil size={15} strokeWidth={2.4} /><p className="text-sm font-bold">Владелец</p></div>
                <h3 className="mt-1 text-xl font-semibold text-white">Имя владельца</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">Показывается в приветствии и отчётах. Можно указать имя человека или название компании.</p>
                <div className="mt-4 flex flex-col gap-2.5">
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    maxLength={60}
                    placeholder="Например: Ахмед или Okvion Sales"
                    className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                  />
                  <button
                    type="button"
                    onClick={saveOwnerName}
                    disabled={ownerSaving || !ownerName.trim() || ownerName.trim() === (session?.ownerName || "")}
                    className="w-full rounded-2xl bg-indigo-600 px-5 py-3 font-semibold text-white  transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ownerSaving ? "Сохраняю…" : ownerSaved ? "Сохранено ✓" : "Сохранить имя"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "settings" && (isOwner || isBranchAdmin) && (
          <section className="grid gap-5 xl:grid-cols-2">
            {(isOwner || isBranchAdmin) && (
              <div className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 text-blue-400">
                  <Clock size={16} strokeWidth={2.4} />
                  <p className="text-sm font-bold">Рабочий день точки</p>
                </div>
                <h3 className="mt-1 text-xl font-semibold text-white">Во сколько открываетесь</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Если работаете ночью (например, с 09:00 до 01:00), продажи после полуночи будут считаться за тот же день. Влияет на «выручку за сегодня» и отчёты.
                </p>
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-slate-300">Начало дня</label>
                  <select
                    value={dayStart}
                    disabled={dayStartSaving}
                    onChange={(e) => saveDayStart(Number(e.target.value))}
                    className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none [color-scheme:dark] focus:border-blue-400/60 disabled:opacity-60"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00{h === 0 ? " — обычный день (по календарю)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[11px] font-bold text-slate-500">
                    {dayStartSaving ? "Сохраняю…" : dayStart === 0 ? "День считается с полуночи." : `День точки: с ${String(dayStart).padStart(2, "0")}:00 до ${String(dayStart).padStart(2, "0")}:00 следующего дня.`}
                  </p>
                </div>
              </div>
            )}

            {(isOwner || isBranchAdmin) && (
              <div className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 text-indigo-400">
                  <ClipboardList size={16} strokeWidth={2.4} />
                  <p className="text-sm font-bold">Заказы с сайта</p>
                </div>
                <h3 className="mt-1 text-xl font-semibold text-white">Ключ приёма заказов</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Вставьте этот ключ на сайте меню — заказы будут падать в кассу во вкладку «Заказы». Ключ секретный, не публикуйте его.
                </p>
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-semibold text-slate-300">Ключ</label>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-slate-200">{intakeKey || "…"}</code>
                    <button type="button" onClick={() => { if (intakeKey) { navigator.clipboard?.writeText(intakeKey); window.notify?.("Ключ скопирован", "success"); } }}
                      aria-label="Скопировать ключ" title="Скопировать"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/5 text-slate-300 transition hover:bg-white/10"><Copy size={17} strokeWidth={2.4} /></button>
                    <button type="button" onClick={rotateIntakeKey} disabled={keyBusy}
                      aria-label="Перевыпустить ключ" title="Перевыпустить"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/5 text-slate-300 transition hover:bg-white/10 disabled:opacity-50"><RefreshCw size={17} strokeWidth={2.4} /></button>
                  </div>
                  <p className="mt-2 text-[11px] font-bold text-slate-500">
                    Эндпоинт для сайта: <span className="text-slate-300">https://okvionsales.ru/api/public/orders</span>
                  </p>
                </div>
              </div>
            )}

            {(isOwner || isBranchAdmin) && (
              <div className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 text-violet-400">
                  <Bot size={16} strokeWidth={2.4} />
                  <p className="text-sm font-bold">Нейросеть</p>
                </div>
                <h3 className="mt-1 text-xl font-semibold text-white">Подключение нейросети</h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Ключ, модель и адрес провайдера ИИ (OpenRouter, odirouter, OpenAI…). Применяется сразу, без перезапуска сервера.
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-300">Адрес провайдера (URL)</label>
                    <input value={ai.baseUrl} onChange={(e) => setAi((p) => ({ ...p, baseUrl: e.target.value }))}
                      placeholder="https://api.odirouter.ai/v1"
                      className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-violet-400/60" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-300">Модель</label>
                    <input value={ai.model} onChange={(e) => setAi((p) => ({ ...p, model: e.target.value }))}
                      placeholder="напр. gpt-4o-mini или anthropic/claude-sonnet-4"
                      className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-violet-400/60" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-slate-300">API-ключ</label>
                    <input type="password" value={aiKeyInput} onChange={(e) => setAiKeyInput(e.target.value)}
                      autoComplete="off"
                      placeholder={ai.hasKey ? `сохранён (${ai.keyMasked}) — пусто = не менять` : "вставьте ключ провайдера"}
                      className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-violet-400/60" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={saveAI} disabled={aiSaving}
                      className="rounded-2xl bg-indigo-600 px-5 py-3 font-semibold text-white shadow-lg transition hover:scale-[1.01] disabled:opacity-60">
                      {aiSaving ? "Сохраняю…" : "Сохранить"}
                    </button>
                    <button type="button" onClick={testAI} disabled={aiTesting}
                      className="rounded-2xl border border-white/[0.08] bg-white/5 px-5 py-3 font-semibold text-slate-100 transition hover:bg-white/10 disabled:opacity-60">
                      {aiTesting ? "Проверяю…" : "Проверить"}
                    </button>
                  </div>
                  {aiTest && (
                    <p className={`text-sm font-semibold ${aiTest.ok ? "text-emerald-300" : "text-red-300"}`}>
                      {aiTest.ok ? "✓ " : "✕ "}{aiTest.msg}
                    </p>
                  )}
                  <p className="text-[11px] font-bold text-slate-500">
                    Для odirouter: адрес провайдера —<span className="text-slate-300">https://api.odirouter.ai/v1</span>, ключ из odirouter.ai, модель — как в их списке. «Проверить» делает тестовый запрос.
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Точки (owner) ── */}
        {activeTab === "branches" && isOwner && (
          <section className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600/20 to-violet-600/15 text-blue-300"><Building2 size={18} strokeWidth={2.4} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Точки</p>
                  <h3 className="text-xl font-semibold text-white sm:text-2xl">Точки и филиалы</h3>
                  <p className="mt-1 max-w-xl text-sm text-slate-400">Каждая точка — отдельный магазин со своими товарами, складом и продажами. Нажмите на точку, чтобы переключиться на неё.</p>
                </div>
              </div>
              <button type="button" onClick={() => setModal("workspace")} className="btn-blue shrink-0">+ Новая точка</button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {safe_workspaces.map((w) => {
                const active = workspace?.id === w.id;
                return (
                <button key={w.id} type="button" onClick={() => switchWorkspace(w)}
                  className={`relative rounded-3xl border p-5 text-left transition hover:-translate-y-1 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                    active
                      ? "border-transparent bg-indigo-600 text-white "
                      : "border-white/[0.08] bg-white/[0.02] text-white hover:bg-white/[0.06]"
                  }`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold uppercase tracking-wide ${active ? "text-blue-100" : "text-blue-400"}`}>{w.isMain ? "Основная точка" : "Филиал"}</p>
                    {active && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">Активна</span>}
                  </div>
                  <h4 className="mt-1.5 break-words text-2xl font-semibold">{w.name}</h4>
                  <p className={`mt-3 text-sm ${active ? "text-blue-100/80" : "text-slate-400"}`}>Логинов: {(usersByWorkspace[String(w.id)] || []).length}</p>
                </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Доступы (owner) ── */}
        {activeTab === "access" && isOwner && (
          <section className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600/20 to-violet-600/15 text-blue-300"><Share2 size={18} strokeWidth={2.4} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Доступ</p>
                  <h3 className="text-xl font-semibold text-white sm:text-2xl">Доступы к точкам</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Дайте одному пользователю доступ к нескольким точкам. Например, сделайте Ахмеда администратором и «Okvion Sales», и «Ресторана Адол».
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setModal("grantAccess")} className="btn-blue shrink-0">
                + Добавить доступ
              </button>
            </div>

            {safe_workspaceAccess.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/[0.08] p-10 text-center">
                <p className="text-lg font-semibold text-white">Мультидоступ не настроен</p>
                <p className="mt-1 text-sm text-slate-400">Нажмите «Добавить доступ», чтобы дать пользователю доступ к нескольким точкам.</p>
              </div>
            ) : (
              <>
                {/* Таблица — планшет и десктоп */}
                <div className="hidden overflow-x-auto rounded-2xl border border-white/[0.08] md:block">
                  <table className="w-full text-sm">
                    <thead className="border-b border-white/[0.08] bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-4 py-3 text-left">Пользователь</th>
                        <th className="px-4 py-3 text-left">Точка</th>
                        <th className="px-4 py-3 text-left">Роль</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {safe_workspaceAccess.map((a) => (
                        <tr key={a.id} className="border-t border-white/[0.08] hover:bg-white/[0.02]">
                          <td className="px-4 py-3 font-semibold text-white">{a.username}</td>
                          <td className="px-4 py-3 text-slate-300">{a.workspaceName}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-xl px-3 py-1 text-xs font-semibold ${
                              a.role === "branch_admin"
                                ? "bg-blue-500/20 text-blue-300"
                                : "bg-slate-500/20 text-slate-300"
                            }`}>
                              {a.role === "branch_admin" ? "Администратор" : "Кассир"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button type="button" onClick={() => revokeAccess(a.id)}
                              className="min-h-[40px] rounded-xl bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-500/20">
                              Убрать доступ
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Карточки — телефон */}
                <div className="grid gap-3 md:hidden">
                  {safe_workspaceAccess.map((a) => (
                    <div key={a.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">{a.username}</p>
                          <p className="mt-0.5 truncate text-sm text-slate-400">{a.workspaceName}</p>
                        </div>
                        <span className={`shrink-0 rounded-xl px-3 py-1 text-xs font-semibold ${
                          a.role === "branch_admin" ? "bg-blue-500/20 text-blue-300" : "bg-slate-500/20 text-slate-300"
                        }`}>
                          {a.role === "branch_admin" ? "Администратор" : "Кассир"}
                        </span>
                      </div>
                      <button type="button" onClick={() => revokeAccess(a.id)}
                        className="mt-3 w-full rounded-xl bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20">
                        Убрать доступ
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Аккаунты точек ── */}
        {activeTab === "accounts" && (isOwner || isBranchAdmin) && (
          <section className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600/20 to-violet-600/15 text-blue-300"><KeyRound size={18} strokeWidth={2.4} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Логины</p>
                  <h3 className="text-xl font-semibold text-white sm:text-2xl">Логины для входа</h3>
                  <p className="mt-1 max-w-xl text-sm text-slate-400">Логин и пароль, под которым сотрудники заходят в приложение. У каждого логина своя точка и роль — кассир или администратор.</p>
                </div>
              </div>
              <button type="button" onClick={() => setModal("workerAccount")} className="btn-blue shrink-0">+ Создать логин</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleWorkspaceUsers.map((u) => (
                <article key={u.id} className="flex flex-col rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-lg font-semibold">{u.username}</p>
                      <p className="mt-1 text-sm text-slate-400">{u.workspaceName}</p>
                    </div>
                    <span className="shrink-0 rounded-xl bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-300">{roleName(u.role)}</span>
                  </div>
                  <div className="mt-auto grid gap-2 pt-5">
                    <button type="button" onClick={() => openManageProfiles(u)}
                      className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white transition hover:brightness-110">
                      Продавцы под логином
                    </button>
                    <button type="button" onClick={() => removeWorkspaceUser(u.id)}
                      className="rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/20">
                      Удалить логин
                    </button>
                  </div>
                </article>
              ))}
              {!visibleWorkspaceUsers.length && (
                <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center md:col-span-2 xl:col-span-3">
                  <p className="text-lg font-semibold text-white">Логинов пока нет</p>
                  <p className="mt-1 text-sm text-slate-400">Создайте логин — это вход в кассу для сотрудника. Потом добавьте под ним продавцов.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Работники ── */}
        {activeTab === "employees" && (isOwner || isBranchAdmin) && (
          <section className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600/20 to-violet-600/15 text-blue-300"><Users size={18} strokeWidth={2.4} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Продавцы</p>
                  <h3 className="text-xl font-semibold text-white sm:text-2xl">Продавцы</h3>
                  <p className="mt-1 max-w-xl text-sm text-slate-400">Имена продавцов — на кого записывается продажа. Пароль можно задать по желанию (тогда продавец вводит его, вставая за кассу). Отметьте, кто сейчас за кассой.</p>
                </div>
              </div>
              <button type="button" onClick={() => setModal("employee")} className="btn-blue shrink-0">+ Добавить продавца</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {safe_employees.map((e) => {
                const active = profile?.id === e.id;
                return (
                <article key={e.id} className={`rounded-3xl border p-4 transition ${
                  active
                    ? "border-transparent bg-indigo-600 text-white "
                    : "border-white/[0.08] bg-white/[0.02]"
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xl font-semibold">{e.name}</p>
                    {active && <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold">За кассой</span>}
                  </div>
                  <p className={`mt-1 text-sm ${active ? "text-blue-100/80" : "text-slate-400"}`}>
                    {active ? "Сейчас оформляет продажи" : "Продавец"}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={() => pickEmployee(e)} disabled={active}
                      className={`flex-1 rounded-2xl px-4 py-3 font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                        active ? "bg-white/15 text-white" : "bg-indigo-600 text-white hover:brightness-110"
                      }`}>
                      {active ? "Выбран" : "За кассу"}
                    </button>
                    <button type="button" onClick={() => removeEmployee(e.id)}
                      aria-label="Удалить продавца" title="Удалить продавца"
                      className={`flex items-center justify-center rounded-2xl px-4 py-3 font-semibold transition focus:outline-none ${
                        active ? "bg-red-500/25 text-red-100 hover:bg-red-500/35" : "bg-red-500/10 text-red-300 hover:bg-red-500/20"
                      }`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
                );
              })}
              {!safe_employees.length && (
                <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center md:col-span-2 xl:col-span-3">
                  <p className="text-lg font-semibold text-white">Продавцов пока нет</p>
                  <p className="mt-1 text-sm text-slate-400">Добавьте продавца — его имя будет в чеках и отчётах по продажам.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Права на страницы ── */}
        {activeTab === "permissions" && isOwner && (
          <section className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600/20 to-violet-600/15 text-blue-300"><ShieldCheck size={18} strokeWidth={2.4} /></span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Права</p>
                <h3 className="text-xl font-semibold text-white sm:text-2xl">Права на страницы</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Выберите пользователя и настройте, какие страницы он видит. Владелец и администратор всегда имеют полный доступ.
                </p>
              </div>
            </div>

            {safe_workspaceUsers.filter(isAssignable).length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/[0.08] p-10 text-center">
                <p className="text-lg font-semibold text-white">Логинов пока нет</p>
                <p className="mt-1 text-sm text-slate-400">Создайте логин в разделе «Логины».</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {safe_workspaceUsers.filter(isAssignable).map((u) => {
                  const perms = safe_permissions.find(p => p.userId === u.id);
                  const pages = perms?.pages
                    ? (typeof perms.pages === "string" ? JSON.parse(perms.pages) : perms.pages)
                    : ["/pos", "/pending-payments"];
                  const hasFullAccess = pages.includes("*");
                  return (
                    <article key={u.id} className="rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">{u.username}</p>
                          <p className="text-xs text-slate-400">{u.workspaceName}</p>
                        </div>
                        <button type="button" onClick={() => openEditPerms(u)}
                          className="min-h-[40px] shrink-0 rounded-xl bg-blue-500/20 px-4 py-2.5 text-sm font-semibold text-blue-300 hover:bg-blue-500/30">
                          Настроить
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {hasFullAccess ? (
                          <span className="rounded-xl bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold text-emerald-300">Полный доступ</span>
                        ) : pages.map(path => {
                          const page = ALL_PAGES.find(p => p.path === path);
                          return page ? (
                            <span key={path} className="inline-flex items-center gap-1 rounded-xl bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-300">
                              <page.icon size={12} /> {page.label}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Карты ── */}
        {activeTab === "cards" && (isOwner || isBranchAdmin) && (
          <section className="rounded-[32px] border border-white/[0.08] bg-white/[0.02] p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600/20 to-violet-600/15 text-blue-300"><CreditCard size={18} strokeWidth={2.4} /></span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">Карты</p>
                  <h3 className="text-xl font-semibold text-white sm:text-2xl">Карты</h3>
                  <p className="mt-1 text-sm text-slate-400">Карты для учёта переводов и расходов.</p>
                </div>
              </div>
              <button type="button" onClick={() => { setError(""); setModal("card"); }} className="btn-blue shrink-0">+ Добавить карту</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {safe_cards.map((card) => (
                <article key={card.id} className="rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-xl font-semibold text-white">{card.name}</p>
                      <p className="mt-1 break-words text-sm font-bold text-slate-400">{card.owner || "Владелец не указан"}</p>
                    </div>
                    <button type="button" onClick={() => removeCard(card.id)}
                      className="shrink-0 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/20">
                      Удалить
                    </button>
                  </div>
                </article>
              ))}
              {!safe_cards.length && (
                <div className="rounded-3xl bg-white/[0.02] p-8 text-center md:col-span-2 xl:col-span-3">
                  <p className="text-xl font-semibold text-white">Карт пока нет</p>
                </div>
              )}
            </div>
          </section>
        )}

          </div>
        </div>

        {/* ════ Модалки ════ */}

        {modal === "editPerms" && editingPerms && (
          <Modal title={`Права: ${editingPerms.username}`} wide legacyLight={false} onClose={() => setModal(null)}>
            <p className="mb-4 text-sm text-slate-400">
              Выберите страницы, к которым у этого пользователя будет доступ.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ALL_PAGES.map((page) => {
                const checked = editingPerms.pages.includes(page.path);
                return (
                  <button key={page.path} type="button" onClick={() => togglePage(page.path)}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                      checked
                        ? "border-blue-400/40 bg-blue-500/15 text-blue-200"
                        : "border-white/[0.08] bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-semibold ${checked ? "border-blue-400 bg-blue-500 text-white" : "border-white/20"}`}>
                      {checked && "✓"}
                    </span>
                    <page.icon size={18} className="shrink-0" />
                    <span className="text-sm font-bold">{page.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3">
              <span className="text-sm font-bold text-slate-400">Выбрано страниц: {editingPerms.pages.length} из {ALL_PAGES.length}</span>
              <button type="button" onClick={() => setEditingPerms(p => ({...p, pages: ALL_PAGES.map(x => x.path)}))}
                className="ml-auto min-h-[40px] rounded-xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">Выбрать все</button>
              <button type="button" onClick={() => setEditingPerms(p => ({...p, pages: ["/pos", "/pending-payments"]}))}
                className="min-h-[40px] rounded-xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15">По умолчанию</button>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={savePerms} className="btn-blue flex-1">Сохранить</button>
            </div>
          </Modal>
        )}

        {modal === "grantAccess" && (
          <Modal title="Добавить доступ к точке" wide legacyLight={false} onClose={() => setModal(null)}>
            <div className="mb-4 flex items-start gap-2 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm text-violet-200">
              <Lightbulb size={16} className="mt-0.5 shrink-0" />
              <span>Например: Ахмед уже есть как аккаунт «Okvion Sales» — дай ему доступ ещё и к «Ресторану Адол».</span>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-300">Пользователь</span>
                <select value={grantForm.userId} onChange={(e) => setGrantForm((p) => ({ ...p, userId: e.target.value }))}
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                  <option value="">Выберите пользователя</option>
                  {safe_workspaceUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.username} — {u.workspaceName}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-300">Точка доступа</span>
                <select value={grantForm.workspaceId} onChange={(e) => setGrantForm((p) => ({ ...p, workspaceId: e.target.value }))}
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                  <option value="">Выберите точку</option>
                  {safe_workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-300">Роль</span>
                <select value={grantForm.role} onChange={(e) => setGrantForm((p) => ({ ...p, role: e.target.value }))}
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                  <option value="branch_admin">Администратор точки</option>
                  <option value="worker">Кассир</option>
                </select>
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={grantAccess} className="btn-blue flex-1">Дать доступ</button>
            </div>
          </Modal>
        )}

        {modal === "manageProfiles" && (
          <Modal title="Продавцы под логином" wide legacyLight={false} onClose={() => setModal(null)}>
            <div className="mb-4 rounded-3xl bg-indigo-600 p-4 text-white">
              <p className="text-sm text-blue-100">Логин для входа</p>
              <p className="break-words text-2xl font-semibold">{managedAccount?.username}</p>
              <p className="mt-1 text-sm text-blue-100">{managedAccount?.workspaceName}</p>
            </div>
            <p className="mb-3 text-sm text-slate-400">Добавьте продавцов — их имена попадут в чеки и отчёты. Пароль необязателен: если задать, продавец будет вводить его, когда встаёт за кассу.</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-400">Имя продавца</span>
                <input value={managedEmployeeName} onChange={(e) => setManagedEmployeeName(e.target.value)}
                  placeholder="Например: Ахмед" autoFocus
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-400">Пароль <span className="font-bold text-slate-500">(необязательно)</span></span>
                <input value={managedEmployeePass} onChange={(e) => setManagedEmployeePass(e.target.value)}
                  placeholder="без пароля" type="text"
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              </label>
              <div className="flex items-end">
                <button type="button" onClick={createManagedEmployee} className="btn-blue w-full">+ Добавить</button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {safe_managedEmployees.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-2xl bg-white/5 p-4">
                  <p className="font-semibold">{e.name}</p>
                  <button type="button" onClick={() => removeManagedEmployee(e.id)}
                    aria-label="Удалить продавца" title="Удалить продавца"
                    className="flex min-h-[40px] items-center justify-center rounded-xl bg-red-500/10 px-3 py-2 font-semibold text-red-300 transition hover:bg-red-500/20"><Trash2 size={16} /></button>
                </div>
              ))}
              {!safe_managedEmployees.length && (
                <div className="rounded-2xl bg-white/5 p-5 text-center text-slate-400 sm:col-span-2">Продавцов пока нет.</div>
              )}
            </div>
            <button type="button" onClick={() => setModal(null)} className="btn-white mt-6 w-full">Закрыть</button>
          </Modal>
        )}

        {modal === "employee" && (
          <Modal title="Новый продавец" legacyLight={false} onClose={() => setModal(null)}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-400">Имя продавца</span>
              <input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="Например: Ахмед" autoFocus
                className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            <label className="mt-3 block">
              <span className="mb-2 block text-sm font-semibold text-slate-400">Пароль <span className="font-bold text-slate-500">(необязательно)</span></span>
              <input value={employeePass} onChange={(e) => setEmployeePass(e.target.value)}
                placeholder="Продавец введёт его, когда встаёт за кассу" type="text"
                className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={createEmployee} className="btn-blue flex-1">Создать</button>
            </div>
          </Modal>
        )}

        {modal === "card" && (
          <Modal title="Новая карта" legacyLight={false} onClose={() => setModal(null)}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-400">Название карты или банка</span>
              <input value={cardName} onChange={(e) => setCardName(e.target.value)}
                placeholder="Например: Сбербанк" autoFocus
                className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            <label className="mt-3 block">
              <span className="mb-2 block text-sm font-semibold text-slate-400">Владелец <span className="font-bold text-slate-500">(необязательно)</span></span>
              <input value={cardOwner} onChange={(e) => setCardOwner(e.target.value)}
                placeholder="Например: Ахмед"
                className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            {error && <p role="alert" className="mt-3 text-sm font-bold text-red-400">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={createCard} className="btn-blue flex-1">Создать</button>
            </div>
          </Modal>
        )}

        {pwPrompt && (
          <Modal title="Пароль продавца" legacyLight={false} onClose={() => { setPwPrompt(null); setPwInput(""); setError(""); }}>
            <p className="mb-4 text-sm text-slate-400">
              Введите пароль продавца <b className="text-white">{pwPrompt.employee?.name}</b>, чтобы встать за кассу.
            </p>
            <input value={pwInput} type="password" autoFocus
              onChange={(e) => { setPwInput(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && confirmPwPrompt()}
              placeholder="Пароль"
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            {error && <p className="mt-2 text-sm font-bold text-red-400">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => { setPwPrompt(null); setPwInput(""); setError(""); }} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={confirmPwPrompt} className="btn-blue flex-1">Войти</button>
            </div>
          </Modal>
        )}

        {modal === "workspace" && (
          <Modal title="Новая точка" legacyLight={false} onClose={() => setModal(null)}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-400">Название точки</span>
              <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Например: Okvion Sales Центр" autoFocus
                className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={createWorkspace} className="btn-blue flex-1">Создать</button>
            </div>
          </Modal>
        )}

        {modal === "workerAccount" && (
          <Modal title="Новый логин для входа" wide legacyLight={false} onClose={() => setModal(null)}>
            <div className="space-y-3">
              {isOwner && (
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-400">Точка</span>
                  <select value={accountForm.workspaceId}
                    onChange={(e) => setAccountForm((p) => ({ ...p, workspaceId: e.target.value }))}
                    className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                    <option value="">Выберите точку</option>
                    {safe_workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-400">Роль</span>
                <select value={accountForm.role}
                  onChange={(e) => setAccountForm((p) => ({ ...p, role: e.target.value }))}
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                  <option value="worker">Кассир — только продажи и касса</option>
                  <option value="branch_admin">Администратор — полный доступ к точке</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-400">Логин</span>
                <input value={accountForm.username}
                  onChange={(e) => setAccountForm((p) => ({ ...p, username: e.target.value }))}
                  placeholder="Например: ahmed@okvion.ru"
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-400">Пароль</span>
                <input value={accountForm.password} type="password"
                  onChange={(e) => setAccountForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Пароль"
                  className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={createWorkspaceUser} className="btn-blue flex-1">Создать</button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
