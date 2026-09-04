import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3, Bot, Briefcase, Clock, FileText, Lightbulb,
  Package, ShoppingCart, Trash2, TrendingUp, Wallet,
} from "lucide-react";
import {
  del,
  get,
  post,
  put,
  setCurrentProfile,
  setCurrentWorkspace,
} from "../api";
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

const ownerTabs = [
  { id: "overview",     label: "Обзор" },
  { id: "branches",     label: "Точки" },
  { id: "access",       label: "Доступы" },
  { id: "permissions",  label: "Права" },
  { id: "accounts",     label: "Логины" },
  { id: "employees",    label: "Продавцы" },
  { id: "cards",        label: "Карты" },
];

const adminTabs = [
  { id: "overview",   label: "Обзор" },
  { id: "employees",  label: "Продавцы" },
  { id: "accounts",   label: "Логины" },
  { id: "cards",      label: "Карты" },
];

const workerTabs = [
  { id: "overview",   label: "Обзор" },
  { id: "employees",  label: "Продавцы" },
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
  return (
    <div className="relative min-h-screen pb-nav text-white sm:pb-10" style={{ WebkitTapHighlightColor: "transparent" }}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-120px] top-[-120px] h-[360px] w-[360px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-140px] right-[-140px] h-[360px] w-[360px] rounded-full bg-violet-600/20 blur-3xl" />
      </div>

      <div className="relative z-10">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-400">{accountTypeLabel}</p>
            <h2 className="text-3xl font-black leading-none text-white sm:text-5xl">Настройки</h2>
            <p className="mt-2 text-sm text-slate-400 sm:text-base">
              {isOwner
                ? "Точки, логины для входа и продавцы."
                : "Выбор продавца и управление текущей точкой."}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <ThemeToggle variant="full" className="w-full sm:w-auto" />
            <button type="button" onClick={logout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-3 font-black text-red-300 transition hover:bg-red-500/20 sm:w-auto lg:w-auto">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
              Выйти
            </button>
          </div>
        </header>

        <div className="mb-5"><InstallAppCard /></div>

        {error && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 font-bold text-red-300">{error}</div>
        )}

        {/* Табы */}
        <section className="mb-5 rounded-3xl border border-white/10 bg-[#0f172a]/80 p-2 shadow-2xl backdrop-blur">
          <div role="tablist" className="no-scrollbar -mx-0.5 flex gap-2 overflow-x-auto px-0.5 sm:flex-wrap">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-blue-500/30 sm:px-5 sm:py-3 ${
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg"
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {loading && <div className="mb-4 rounded-2xl border border-blue-500/25 bg-blue-500/10 px-4 py-3 font-bold text-blue-300">Загрузка…</div>}

        {/* ── Обзор ── */}
        {activeTab === "overview" && (
          <section className="grid gap-5 xl:grid-cols-3">
            <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur xl:col-span-2">
              <div className="bg-gradient-to-r from-blue-600 to-violet-600 p-5 text-white sm:p-6">
                <p className="text-sm font-bold uppercase text-blue-100">{accountTypeLabel}</p>
                <h3 className="mt-1 break-all text-xl font-black sm:text-3xl">{session?.username}</h3>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <div className="rounded-3xl bg-white/5 p-5">
                  <p className="text-sm font-bold text-slate-400">Текущая точка</p>
                  <p className="mt-1 text-2xl font-black text-white">{workspace?.name || "Основная точка"}</p>
                </div>
                <div className="rounded-3xl bg-blue-500/10 p-5">
                  <p className="text-sm font-bold text-slate-400">{isOwner ? "Владелец" : "Сейчас работает"}</p>
                  <p className="mt-1 text-2xl font-black text-blue-300">{currentWorker}</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Точки (owner) ── */}
        {activeTab === "branches" && isOwner && (
          <section className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-2xl font-black">Точки и филиалы</h3>
                <p className="mt-1 max-w-xl text-sm text-slate-400">Каждая точка — отдельный магазин со своими товарами, складом и продажами. Нажмите на точку, чтобы переключиться на неё.</p>
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
                      ? "border-transparent bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-xl shadow-blue-900/30"
                      : "border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06]"
                  }`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-black uppercase tracking-wide ${active ? "text-blue-100" : "text-blue-400"}`}>{w.isMain ? "Основная точка" : "Филиал"}</p>
                    {active && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-black">Активна</span>}
                  </div>
                  <h4 className="mt-1.5 text-2xl font-black">{w.name}</h4>
                  <p className={`mt-3 text-sm ${active ? "text-blue-100/80" : "text-slate-400"}`}>Логинов: {(usersByWorkspace[String(w.id)] || []).length}</p>
                </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Доступы (owner) ── */}
        {activeTab === "access" && isOwner && (
          <section className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-2xl font-black">Доступы к точкам</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Дайте одному пользователю доступ к нескольким точкам. Например, сделайте Ахмеда администратором и «Okvion Sales», и «Ресторана Адол».
                </p>
              </div>
              <button type="button" onClick={() => setModal("grantAccess")} className="btn-blue shrink-0">
                + Добавить доступ
              </button>
            </div>

            {safe_workspaceAccess.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
                <p className="text-lg font-black text-white">Мультидоступ не настроен</p>
                <p className="mt-1 text-sm text-slate-400">Нажмите «Добавить доступ», чтобы дать пользователю доступ к нескольким точкам.</p>
              </div>
            ) : (
              <>
                {/* Таблица — планшет и десктоп */}
                <div className="hidden overflow-x-auto rounded-2xl border border-white/10 md:block">
                  <table className="w-full text-sm">
                    <thead className="border-b border-white/10 bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-4 py-3 text-left">Пользователь</th>
                        <th className="px-4 py-3 text-left">Точка</th>
                        <th className="px-4 py-3 text-left">Роль</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {safe_workspaceAccess.map((a) => (
                        <tr key={a.id} className="border-t border-white/10 hover:bg-white/[0.03]">
                          <td className="px-4 py-3 font-black text-white">{a.username}</td>
                          <td className="px-4 py-3 text-slate-300">{a.workspaceName}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-xl px-3 py-1 text-xs font-black ${
                              a.role === "branch_admin"
                                ? "bg-blue-500/20 text-blue-300"
                                : "bg-slate-500/20 text-slate-300"
                            }`}>
                              {a.role === "branch_admin" ? "Администратор" : "Кассир"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button type="button" onClick={() => revokeAccess(a.id)}
                              className="rounded-xl bg-red-500/10 px-3 py-1.5 text-xs font-black text-red-400 hover:bg-red-500/20">
                              Убрать
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
                    <div key={a.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-black text-white">{a.username}</p>
                          <p className="mt-0.5 truncate text-sm text-slate-400">{a.workspaceName}</p>
                        </div>
                        <span className={`shrink-0 rounded-xl px-3 py-1 text-xs font-black ${
                          a.role === "branch_admin" ? "bg-blue-500/20 text-blue-300" : "bg-slate-500/20 text-slate-300"
                        }`}>
                          {a.role === "branch_admin" ? "Администратор" : "Кассир"}
                        </span>
                      </div>
                      <button type="button" onClick={() => revokeAccess(a.id)}
                        className="mt-3 w-full rounded-xl bg-red-500/10 px-3 py-2 text-sm font-black text-red-400 hover:bg-red-500/20">
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
          <section className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-2xl font-black">Логины для входа</h3>
                <p className="mt-1 max-w-xl text-sm text-slate-400">Логин и пароль, под которым сотрудники заходят в приложение. У каждого логина своя точка и роль — кассир или администратор.</p>
              </div>
              <button type="button" onClick={() => setModal("workerAccount")} className="btn-blue shrink-0">+ Создать логин</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleWorkspaceUsers.map((u) => (
                <article key={u.id} className="flex flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-lg font-black">{u.username}</p>
                      <p className="mt-1 text-sm text-slate-400">{u.workspaceName}</p>
                    </div>
                    <span className="shrink-0 rounded-xl bg-blue-500/15 px-3 py-1.5 text-xs font-black text-blue-300">{roleName(u.role)}</span>
                  </div>
                  <div className="mt-auto grid gap-2 pt-5">
                    <button type="button" onClick={() => openManageProfiles(u)}
                      className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white transition hover:brightness-110">
                      Продавцы логина
                    </button>
                    <button type="button" onClick={() => removeWorkspaceUser(u.id)}
                      className="rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm font-black text-red-300 transition hover:bg-red-500/20">
                      Удалить логин
                    </button>
                  </div>
                </article>
              ))}
              {!visibleWorkspaceUsers.length && (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center md:col-span-2 xl:col-span-3">
                  <p className="text-lg font-black text-white">Логинов пока нет</p>
                  <p className="mt-1 text-sm text-slate-400">Создайте логин — это вход в кассу для сотрудника. Потом добавьте под ним продавцов.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Работники ── */}
        {activeTab === "employees" && (isOwner || isBranchAdmin) && (
          <section className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-2xl font-black">Продавцы</h3>
                <p className="mt-1 max-w-xl text-sm text-slate-400">Имена продавцов — на кого записывается продажа. Пароль не нужен. Отметьте, кто сейчас за кассой.</p>
              </div>
              <button type="button" onClick={() => setModal("employee")} className="btn-blue shrink-0">+ Добавить продавца</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {safe_employees.map((e) => {
                const active = profile?.id === e.id;
                return (
                <article key={e.id} className={`rounded-3xl border p-4 transition ${
                  active
                    ? "border-transparent bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-xl shadow-blue-900/30"
                    : "border-white/10 bg-white/[0.03]"
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xl font-black">{e.name}</p>
                    {active && <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-black">За кассой</span>}
                  </div>
                  <p className={`mt-1 text-sm ${active ? "text-blue-100/80" : "text-slate-400"}`}>
                    {active ? "Сейчас оформляет продажи" : "Продавец"}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={() => pickEmployee(e)} disabled={active}
                      className={`flex-1 rounded-2xl px-4 py-3 font-black transition focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                        active ? "bg-white/15 text-white" : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:brightness-110"
                      }`}>
                      {active ? "Выбран" : "За кассу"}
                    </button>
                    <button type="button" onClick={() => removeEmployee(e.id)}
                      aria-label="Удалить продавца" title="Удалить продавца"
                      className={`flex items-center justify-center rounded-2xl px-4 py-3 font-black transition focus:outline-none ${
                        active ? "bg-white/15 text-white hover:bg-white/25" : "bg-red-500/10 text-red-300 hover:bg-red-500/20"
                      }`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
                );
              })}
              {!safe_employees.length && (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center md:col-span-2 xl:col-span-3">
                  <p className="text-lg font-black text-white">Продавцов пока нет</p>
                  <p className="mt-1 text-sm text-slate-400">Добавьте продавца — его имя будет в чеках и отчётах по продажам.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Права на страницы ── */}
        {activeTab === "permissions" && isOwner && (
          <section className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
            <div className="mb-5">
              <h3 className="text-2xl font-black">Права на страницы</h3>
              <p className="mt-1 text-sm text-slate-400">
                Выберите пользователя и настройте, какие страницы он видит. Владелец и администратор всегда имеют полный доступ.
              </p>
            </div>

            {safe_workspaceUsers.filter(u => u.role === "worker" || u.role === "branch_admin").length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center">
                <p className="text-lg font-black text-white">Логинов пока нет</p>
                <p className="mt-1 text-sm text-slate-400">Создайте логин в разделе «Логины».</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {safe_workspaceUsers.filter(u => u.role === "worker" || u.role === "workspace" || u.role === "branch_admin").map((u) => {
                  const perms = safe_permissions.find(p => p.userId === u.id);
                  const pages = perms?.pages
                    ? (typeof perms.pages === "string" ? JSON.parse(perms.pages) : perms.pages)
                    : ["/pos", "/pending-payments"];
                  const hasFullAccess = pages.includes("*");
                  return (
                    <article key={u.id} className="rounded-3xl border border-white/10 bg-[#111827] p-5">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-white">{u.username}</p>
                          <p className="text-xs text-slate-400">{u.workspaceName}</p>
                        </div>
                        <button type="button" onClick={() => openEditPerms(u)}
                          className="shrink-0 rounded-xl bg-blue-500/20 px-3 py-1.5 text-xs font-black text-blue-300 hover:bg-blue-500/30">
                          Настроить
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {hasFullAccess ? (
                          <span className="rounded-xl bg-emerald-500/20 px-2 py-1 text-[10px] font-black text-emerald-300">Полный доступ</span>
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
          <section className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-2xl font-black">Карты</h3>
                <p className="mt-1 text-sm text-slate-400">Карты для учёта переводов и расходов.</p>
              </div>
            </div>
            <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
              <input value={cardName} onChange={(e) => setCardName(e.target.value)}
                placeholder="Название карты / банка"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              <input value={cardOwner} onChange={(e) => setCardOwner(e.target.value)}
                placeholder="Владелец"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              <button type="button" onClick={createCard} className="btn-blue">+ Добавить карту</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {safe_cards.map((card) => (
                <article key={card.id} className="rounded-3xl border border-white/10 bg-[#111827] p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xl font-black text-white">{card.name}</p>
                      <p className="mt-1 text-sm font-bold text-slate-400">{card.owner || "Владелец не указан"}</p>
                    </div>
                    <button type="button" onClick={() => removeCard(card.id)}
                      className="shrink-0 rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm font-black text-red-300 transition hover:bg-red-500/20">
                      Удалить
                    </button>
                  </div>
                </article>
              ))}
              {!safe_cards.length && (
                <div className="rounded-3xl bg-white/[0.03] p-8 text-center md:col-span-2 xl:col-span-3">
                  <p className="text-xl font-black text-white">Карт пока нет</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ════ Модалки ════ */}

        {modal === "editPerms" && editingPerms && (
          <Modal title={`Права: ${editingPerms.username}`} wide>
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
                        : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-black ${checked ? "border-blue-400 bg-blue-500 text-white" : "border-white/20"}`}>
                      {checked && "✓"}
                    </span>
                    <page.icon size={18} className="shrink-0" />
                    <span className="text-sm font-bold">{page.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-sm font-bold text-slate-400">Выбрано страниц: {editingPerms.pages.length} из {ALL_PAGES.length}</span>
              <button type="button" onClick={() => setEditingPerms(p => ({...p, pages: ALL_PAGES.map(x => x.path)}))}
                className="ml-auto rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white hover:bg-white/15">Выбрать все</button>
              <button type="button" onClick={() => setEditingPerms(p => ({...p, pages: ["/pos"]}))}
                className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white hover:bg-white/15">Сбросить</button>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={savePerms} className="btn-blue flex-1">Сохранить</button>
            </div>
          </Modal>
        )}

        {modal === "grantAccess" && (
          <Modal title="Добавить доступ к точке" wide>
            <div className="mb-4 flex items-start gap-2 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm text-violet-200">
              <Lightbulb size={16} className="mt-0.5 shrink-0" />
              <span>Например: Ахмед уже есть как аккаунт «Okvion Sales» — дай ему доступ ещё и к «Ресторану Адол».</span>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-black text-slate-300">Пользователь</span>
                <select value={grantForm.userId} onChange={(e) => setGrantForm((p) => ({ ...p, userId: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                  <option value="">Выберите пользователя</option>
                  {safe_workspaceUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.username} — {u.workspaceName}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-black text-slate-300">Точка доступа</span>
                <select value={grantForm.workspaceId} onChange={(e) => setGrantForm((p) => ({ ...p, workspaceId: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                  <option value="">Выберите точку</option>
                  {safe_workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-black text-slate-300">Роль</span>
                <select value={grantForm.role} onChange={(e) => setGrantForm((p) => ({ ...p, role: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
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
          <Modal title="Продавцы под логином" wide>
            <div className="mb-4 rounded-3xl bg-gradient-to-r from-blue-600 to-violet-600 p-4 text-white">
              <p className="text-sm text-blue-100">Логин для входа</p>
              <p className="break-words text-2xl font-black">{managedAccount?.username}</p>
              <p className="mt-1 text-sm text-blue-100">{managedAccount?.workspaceName}</p>
            </div>
            <p className="mb-3 text-sm text-slate-400">Добавьте продавцов — их имена попадут в чеки и отчёты. Пароль необязателен: если задать, продавец будет вводить его, когда встаёт за кассу.</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-400">Имя продавца</span>
                <input value={managedEmployeeName} onChange={(e) => setManagedEmployeeName(e.target.value)}
                  placeholder="Например: Ахмед" autoFocus
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-400">Пароль <span className="font-bold text-slate-500">(необязательно)</span></span>
                <input value={managedEmployeePass} onChange={(e) => setManagedEmployeePass(e.target.value)}
                  placeholder="без пароля" type="text"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              </label>
              <div className="flex items-end">
                <button type="button" onClick={createManagedEmployee} className="btn-blue w-full">+ Добавить</button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {safe_managedEmployees.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-2xl bg-white/5 p-4">
                  <p className="font-black">{e.name}</p>
                  <button type="button" onClick={() => removeManagedEmployee(e.id)}
                    aria-label="Удалить продавца" title="Удалить продавца"
                    className="flex min-h-[40px] items-center justify-center rounded-xl bg-red-500/10 px-3 py-2 font-black text-red-300 transition hover:bg-red-500/20"><Trash2 size={16} /></button>
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
          <Modal title="Новый продавец">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">Имя продавца</span>
              <input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)}
                placeholder="Например: Ахмед" autoFocus
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            <label className="mt-3 block">
              <span className="mb-2 block text-sm font-black text-slate-400">Пароль <span className="font-bold text-slate-500">(необязательно)</span></span>
              <input value={employeePass} onChange={(e) => setEmployeePass(e.target.value)}
                placeholder="Продавец введёт его, когда встаёт за кассу" type="text"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={createEmployee} className="btn-blue flex-1">Создать</button>
            </div>
          </Modal>
        )}

        {pwPrompt && (
          <Modal title="Пароль продавца">
            <p className="mb-4 text-sm text-slate-400">
              Введите пароль продавца <b className="text-white">{pwPrompt.employee?.name}</b>, чтобы встать за кассу.
            </p>
            <input value={pwInput} type="password" autoFocus
              onChange={(e) => { setPwInput(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && confirmPwPrompt()}
              placeholder="Пароль"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            {error && <p className="mt-2 text-sm font-bold text-red-400">{error}</p>}
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => { setPwPrompt(null); setPwInput(""); setError(""); }} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={confirmPwPrompt} className="btn-blue flex-1">Войти</button>
            </div>
          </Modal>
        )}

        {modal === "workspace" && (
          <Modal title="Новая точка">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">Название точки</span>
              <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Например: Okvion Sales Центр" autoFocus
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
            </label>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
              <button type="button" onClick={createWorkspace} className="btn-blue flex-1">Создать</button>
            </div>
          </Modal>
        )}

        {modal === "workerAccount" && (
          <Modal title="Новый логин для входа" wide>
            <div className="space-y-3">
              {isOwner && (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-400">Точка</span>
                  <select value={accountForm.workspaceId}
                    onChange={(e) => setAccountForm((p) => ({ ...p, workspaceId: e.target.value }))}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                    <option value="">Выберите точку</option>
                    {safe_workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-400">Роль</span>
                <select value={accountForm.role}
                  onChange={(e) => setAccountForm((p) => ({ ...p, role: e.target.value }))}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none w-full">
                  <option value="worker">Кассир — только продажи и касса</option>
                  <option value="branch_admin">Администратор — полный доступ к точке</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-400">Логин</span>
                <input value={accountForm.username}
                  onChange={(e) => setAccountForm((p) => ({ ...p, username: e.target.value }))}
                  placeholder="Например: ahmed@okvion.ru"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-400">Пароль</span>
                <input value={accountForm.password} type="password"
                  onChange={(e) => setAccountForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Пароль"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full" />
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
