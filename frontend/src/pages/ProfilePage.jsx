import { useEffect, useMemo, useState } from "react";
import {
  del,
  get,
  post,
  setCurrentProfile,
  setCurrentWorkspace,
} from "../api";
import Modal from "../components/Modal";

const ownerTabs = [
  { id: "overview", label: "Обзор" },
  { id: "branches", label: "Точки" },
  { id: "accounts", label: "Аккаунты точек" },
  { id: "employees", label: "Работники" },
  { id: "cards", label: "Карты" },
];

const adminTabs = [
  { id: "overview", label: "Обзор" },
  { id: "employees", label: "Работники" },
  { id: "accounts", label: "Аккаунты точки" },
  { id: "cards", label: "Карты" },
];

const workerTabs = [
  { id: "overview", label: "Обзор" },
  { id: "employees", label: "Профили сотрудников" },
];

export default function ProfilePage({
  session,
  workspace,
  profile,
  setProfile,
  setWorkspaceState,
  logout,
}) {
  const isOwner = session?.role === "owner";
  const isBranchAdmin = session?.role === "branch_admin";
  const isWorker = session?.role === "worker" || session?.role === "workspace";

  const tabs = isOwner ? ownerTabs : isBranchAdmin ? adminTabs : workerTabs;

  const [activeTab, setActiveTab] = useState("overview");
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceUsers, setWorkspaceUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [cards, setCards] = useState([]);

  const [modal, setModal] = useState(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardOwner, setCardOwner] = useState("");
  const [accountForm, setAccountForm] = useState({
    workspaceId: "",
    username: "",
    password: "",
    role: "worker",
  });

  const [managedAccount, setManagedAccount] = useState(null);
  const [managedEmployees, setManagedEmployees] = useState([]);
  const [managedEmployeeName, setManagedEmployeeName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const accountTypeLabel = isOwner
    ? "Главный аккаунт"
    : isBranchAdmin
      ? "Админ точки"
      : "Рабочий аккаунт";

  const currentWorker =
    profile?.name ||
    (isOwner
      ? session?.ownerName || session?.username
      : isBranchAdmin
        ? session?.username
        : "профиль не выбран");

  const roleName = (role) => {
    if (role === "branch_admin") return "Админ точки";
    if (role === "worker" || role === "workspace") return "Рабочий аккаунт";
    return role || "Аккаунт";
  };

  const load = async () => {
    setLoading(true);
    setError("");

    try {
      const requests = [];

      requests.push(get("/employees"));
      if (isOwner || isBranchAdmin) requests.push(get("/workspace-users"));
      if (isOwner || isBranchAdmin) requests.push(get("/cards"));
      if (isOwner) requests.push(get("/workspaces"));

      const result = await Promise.all(requests);
      let index = 0;

      setEmployees(result[index] || []);
      index += 1;

      if (isOwner || isBranchAdmin) {
        setWorkspaceUsers(result[index] || []);
        index += 1;
      }

      if (isOwner || isBranchAdmin) {
        setCards(result[index] || []);
        index += 1;
      }

      if (isOwner) {
        const ws = result[index] || [];
        setWorkspaces(ws);

        if (!accountForm.workspaceId && ws.length) {
          setAccountForm((p) => ({
            ...p,
            workspaceId: String(workspace?.id || ws[0].id),
          }));
        }
      }
    } catch (e) {
      setError(e.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOwner && workspace?.id) {
      setAccountForm((p) => ({ ...p, workspaceId: String(workspace.id) }));
    }
  }, [isOwner, workspace?.id]);

  const usersByWorkspace = useMemo(() => {
    return workspaceUsers.reduce((acc, u) => {
      const key = String(u.workspaceId || "");
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});
  }, [workspaceUsers]);

  const visibleWorkspaceUsers = useMemo(() => {
    if (isOwner) return workspaceUsers;
    return workspaceUsers.filter((u) => String(u.workspaceId) === String(workspace?.id));
  }, [isOwner, workspaceUsers, workspace?.id]);

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

    try {
      await loadManagedEmployees(account);
    } catch (e) {
      setError(e.message || "Ошибка загрузки профилей");
    }
  };

  const createManagedEmployee = async () => {
    setError("");

    if (!managedAccount?.dataAccountId) return setError("Аккаунт не выбран");
    if (!managedEmployeeName.trim()) return setError("Введите имя профиля");

    await post("/employees", {
      accountId: managedAccount.dataAccountId,
      name: managedEmployeeName.trim(),
    });

    setManagedEmployeeName("");
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

    if (!workspaceId) return setError("Выбери точку");
    if (!accountForm.username.trim()) return setError("Введите логин");
    if (!accountForm.password.trim()) return setError("Введите пароль");

    const role = accountForm.role === "branch_admin" ? "branch_admin" : "worker";

    await post("/workspace-users", {
      workspaceId: Number(workspaceId),
      username: accountForm.username.trim(),
      password: accountForm.password,
      role,
    });

    setAccountForm((p) => ({
      ...p,
      username: "",
      password: "",
      role: "worker",
    }));

    setModal(null);
    await load();
  };

  const removeWorkspaceUser = async (id) => {
    if (!confirm("Удалить аккаунт?")) return;
    await del(`/workspace-users/${id}`);
    await load();
  };

  const createEmployee = async () => {
    setError("");

    if (!employeeName.trim()) return setError("Введите имя сотрудника");

    const created = await post("/employees", {
      name: employeeName.trim(),
    });

    setEmployeeName("");
    setModal(null);
    await load();

    setCurrentProfile(created);
    setProfile(created);
  };

  const pickEmployee = (employee) => {
    setCurrentProfile(employee);
    setProfile(employee);
  };

  const removeEmployee = async (id) => {
    if (!confirm("Удалить профиль сотрудника?")) return;

    await del(`/employees/${id}`);

    if (profile?.id === id) {
      setCurrentProfile(null);
      setProfile(null);
    }

    await load();
  };

  const workAsAdmin = () => {
    if (isOwner) return;
    setCurrentProfile(null);
    setProfile(null);
  };

  const createCard = async () => {
    setError("");

    if (!cardName.trim()) return setError("Введите название карты или банка");

    await post("/cards", {
      name: cardName.trim(),
      owner: cardOwner.trim(),
    });

    setCardName("");
    setCardOwner("");
    await load();
  };

  const removeCard = async (id) => {
    if (!confirm("Удалить карту?")) return;
    await del(`/cards/${id}`);
    await load();
  };


  return (
    <div
      className="relative min-h-screen  pb-24 text-white sm:pb-10"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-120px] top-[-120px] h-[360px] w-[360px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-[-140px] right-[-140px] h-[360px] w-[360px] rounded-full bg-violet-600/20 blur-3xl" />
      </div>
      <div className="relative z-10">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold text-blue-400">Профиль</p>
          <h2 className="text-4xl font-black leading-none text-white sm:text-5xl">
            Аккаунт
          </h2>
          <p className="mt-2 text-slate-400">
            {isOwner
              ? "Управление точками, аккаунтами и профилями сотрудников внутри рабочих аккаунтов."
              : "Выбор профиля сотрудника и управление текущей точкой."}
          </p>
        </div>

        <button type="button" onClick={logout} className="btn-white w-full lg:w-auto">
          Выйти
        </button>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-600">
          {error}
        </div>
      )}

      <section className="mb-5 rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-2 shadow-2xl backdrop-blur">
        <div role="tablist" aria-label="Разделы профиля" className="grid gap-2 sm:flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-2xl px-5 py-3 text-left font-black transition focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                  : "bg-[#111827]/5 text-slate-700 hover:bg-[#111827]/10"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {loading && (
        <div className="mb-4 rounded-2xl bg-blue-50 px-4 py-3 font-bold text-blue-400">
          Загрузка данных...
        </div>
      )}

      {activeTab === "overview" && (
        <section id="panel-overview" role="tabpanel" className="grid gap-5 xl:grid-cols-3">
          <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur xl:col-span-2">
            <div className="bg-gradient-to-r from-blue-600 to-violet-600 p-6 text-white">
              <p className="text-sm font-bold uppercase text-slate-400">
                {accountTypeLabel}
              </p>
              <h3 className="mt-1 break-words text-3xl font-black">
                {session?.username}
              </h3>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="rounded-3xl bg-[#111827]/[0.03] p-5">
                <p className="text-sm font-bold text-slate-400">Текущая точка</p>
                <p className="mt-1 text-2xl font-black text-white">
                  {workspace?.name || "Основная точка"}
                </p>
              </div>

              <div className="rounded-3xl bg-blue-50 p-5">
                <p className="text-sm font-bold text-slate-400">
                  {isOwner ? "Владелец" : "Сейчас работает"}
                </p>
                <p className="mt-1 text-2xl font-black text-blue-400">
                  {currentWorker}
                </p>
              </div>
            </div>
          </div>

        
        </section>
      )}

      {activeTab === "branches" && isOwner && (
        <section id="panel-branches" role="tabpanel" className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-2xl font-black">Точки / филиалы</h3>
              <p className="mt-1 text-sm text-slate-400">
                Выбери точку, чтобы работать с её меню, продажами и аналитикой.
              </p>
            </div>

            <button type="button" onClick={() => setModal("workspace")} className="btn-blue">
              + Добавить точку
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => switchWorkspace(w)}
                className={`rounded-3xl border p-5 text-left transition hover:-translate-y-1 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                  workspace?.id === w.id
                    ? "border-slate-950 bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                    : "border-white/10 bg-[#111827] text-white"
                }`}
              >
                <p className="text-sm font-bold text-blue-500">
                  {w.isMain ? "Основная точка" : "Филиал"}
                </p>
                <h4 className="mt-1 text-2xl font-black">{w.name}</h4>
                <p className="mt-3 text-sm opacity-70">
                  Аккаунтов: {(usersByWorkspace[String(w.id)] || []).length}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {activeTab === "accounts" && (isOwner || isBranchAdmin) && (
        <section id="panel-accounts" role="tabpanel" className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-2xl font-black">Аккаунты точек</h3>
              <p className="mt-1 text-sm text-slate-400">
                Рабочий аккаунт — это вход для сотрудников. Внутри него создаются профили сотрудников.
              </p>
            </div>

            <button type="button" onClick={() => setModal("workerAccount")} className="btn-blue">
              + Создать аккаунт
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleWorkspaceUsers.map((u) => (
              <article key={u.id} className="rounded-3xl border border-white/10 bg-[#111827] p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="break-words text-xl font-black">{u.username}</p>
                    <p className="mt-1 text-sm text-slate-400">{u.workspaceName}</p>
                  </div>

                  <span className="rounded-2xl bg-[#111827]/5 px-3 py-2 text-xs font-black text-slate-700">
                    {roleName(u.role)}
                  </span>
                </div>

                <div className="mt-5 grid gap-2">
                  <button
                    type="button"
                    onClick={() => openManageProfiles(u)}
                    className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                  >
                    Профили сотрудников
                  </button>

                  <button
                    type="button"
                    onClick={() => removeWorkspaceUser(u.id)}
                    className="rounded-2xl bg-red-50 px-4 py-3 font-black text-red-600 transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100"
                  >
                    Удалить аккаунт
                  </button>
                </div>
              </article>
            ))}

            {!visibleWorkspaceUsers.length && (
              <div className="rounded-3xl bg-[#111827]/[0.03] p-8 text-center md:col-span-2 xl:col-span-3">
                <p className="text-xl font-black text-white">Аккаунтов пока нет</p>
                <p className="mt-1 text-slate-400">
                  Создай рабочий аккаунт, потом нажми “Профили сотрудников”.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "employees" && (isOwner || isBranchAdmin) && (
        <section id="panel-employees" role="tabpanel" className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-2xl font-black">Профили сотрудников</h3>
              <p className="mt-1 text-sm text-slate-400">
                Создавай сотрудников и выбирай, кто сейчас работает на смене.
              </p>
            </div>

            <button type="button" onClick={() => setModal("employee")} className="btn-blue">
              + Добавить профиль
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {employees.map((e) => (
              <article
                key={e.id}
                className={`rounded-3xl border p-4 ${
                  profile?.id === e.id
                    ? "border-slate-950 bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                    : "border-white/10 bg-[#111827]"
                }`}
              >
                <p className="text-xl font-black">{e.name}</p>
                <p className={`mt-1 text-sm ${profile?.id === e.id ? "text-slate-300" : "text-slate-400"}`}>
                  {profile?.id === e.id ? "Сейчас работает" : "Профиль сотрудника"}
                </p>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => pickEmployee(e)}
                    className={`flex-1 rounded-2xl px-4 py-3 font-black focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                      profile?.id === e.id
                        ? "bg-[#111827] text-white"
                        : "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                    }`}
                  >
                    Выбрать
                  </button>

                  <button
                    type="button"
                    onClick={() => removeEmployee(e.id)}
                    aria-label={`Удалить профиль ${e.name}`}
                    className="rounded-2xl bg-red-50 px-4 py-3 font-black text-red-600 focus:outline-none focus:ring-4 focus:ring-red-100"
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}

            {!employees.length && (
              <div className="rounded-3xl bg-[#111827]/[0.03] p-8 text-center md:col-span-2 xl:col-span-3">
                <p className="text-xl font-black text-white">Профилей пока нет</p>
                <p className="mt-1 text-slate-400">
                  Создай первый профиль сотрудника.
                </p>
              </div>
            )}
          </div>
        </section>
      )}



      {activeTab === "cards" && (isOwner || isBranchAdmin) && (
        <section id="panel-cards" role="tabpanel" className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-2xl font-black">Карты</h3>
              <p className="mt-1 text-sm text-slate-400">
                Карты перенесены в личный кабинет, чтобы не держать отдельную страницу в меню.
              </p>
            </div>
          </div>

          <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <input
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="Название карты / банка"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
            />

            <input
              value={cardOwner}
              onChange={(e) => setCardOwner(e.target.value)}
              placeholder="Владелец"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
            />

            <button type="button" onClick={createCard} className="btn-blue">
              + Добавить карту
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <article key={card.id} className="rounded-3xl border border-white/10 bg-[#111827] p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-black text-white">{card.name}</p>
                    <p className="mt-1 text-sm font-bold text-slate-400">
                      {card.owner || "Владелец не указан"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeCard(card.id)}
                    className="rounded-2xl bg-red-50 px-4 py-3 font-black text-red-600 transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100"
                  >
                    Удалить
                  </button>
                </div>
              </article>
            ))}

            {!cards.length && (
              <div className="rounded-3xl bg-[#111827]/[0.03] p-8 text-center md:col-span-2 xl:col-span-3">
                <p className="text-xl font-black text-white">Карт пока нет</p>
                <p className="mt-1 text-slate-400">Добавь карту для учёта переводов и расходов.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {modal === "manageProfiles" && (
        <Modal title="Профили рабочего аккаунта" wide>
          <div className="mb-4 rounded-3xl bg-gradient-to-r from-blue-600 to-violet-600 p-4 text-white">
            <p className="text-sm text-slate-400">Рабочий аккаунт</p>
            <p className="break-words text-2xl font-black">{managedAccount?.username}</p>
            <p className="mt-1 text-sm text-slate-300">{managedAccount?.workspaceName}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">
                Имя профиля сотрудника
              </span>
              <input
                value={managedEmployeeName}
                onChange={(e) => setManagedEmployeeName(e.target.value)}
                placeholder="Например: Ахмед"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
                autoFocus
              />
            </label>

            <div className="flex items-end">
              <button type="button" onClick={createManagedEmployee} className="btn-blue w-full">
                + Создать
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {managedEmployees.map((e) => (
              <div key={e.id} className="rounded-2xl bg-[#111827]/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black">{e.name}</p>

                  <button
                    type="button"
                    onClick={() => removeManagedEmployee(e.id)}
                    aria-label={`Удалить профиль ${e.name}`}
                    className="rounded-xl bg-red-50 px-3 py-2 font-black text-red-600 focus:outline-none focus:ring-4 focus:ring-red-100"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}

            {!managedEmployees.length && (
              <div className="rounded-2xl bg-[#111827]/[0.03] p-5 text-center text-slate-400 sm:col-span-2">
                Внутри этого аккаунта профилей пока нет.
              </div>
            )}
          </div>

          <button type="button" onClick={() => setModal(null)} className="btn-white mt-6 w-full">
            Готово
          </button>
        </Modal>
      )}

      {modal === "employee" && (
        <Modal title="Новый профиль сотрудника">
          <label className="block">
            <span className="mb-2 block text-sm font-black text-slate-400">
              Имя профиля
            </span>
            <input
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Например: Ахмед"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
              autoFocus
            />
          </label>

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">
              Отмена
            </button>
            <button type="button" onClick={createEmployee} className="btn-blue flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {modal === "workspace" && (
        <Modal title="Новая точка">
          <label className="block">
            <span className="mb-2 block text-sm font-black text-slate-400">
              Название точки
            </span>
            <input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Например: Филиал Дагестан"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
              autoFocus
            />
          </label>

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">
              Отмена
            </button>
            <button type="button" onClick={createWorkspace} className="btn-blue flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {modal === "workerAccount" && (
        <Modal title="Аккаунт точки" wide>
          <div className="space-y-3">
            {isOwner && (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-400">
                  Точка
                </span>
                <select
                  value={accountForm.workspaceId}
                  onChange={(e) =>
                    setAccountForm((p) => ({ ...p, workspaceId: e.target.value }))
                  }
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
                >
                  <option value="">Выбери точку</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">
                Тип аккаунта
              </span>
              <select
                value={accountForm.role}
                onChange={(e) =>
                  setAccountForm((p) => ({ ...p, role: e.target.value }))
                }
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
              >
                <option value="worker">Рабочий аккаунт</option>
                <option value="branch_admin">Админ точки</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">
                Логин
              </span>
              <input
                value={accountForm.username}
                onChange={(e) =>
                  setAccountForm((p) => ({ ...p, username: e.target.value }))
                }
                placeholder="Например: filial1@gmail.com"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">
                Пароль
              </span>
              <input
                value={accountForm.password}
                onChange={(e) =>
                  setAccountForm((p) => ({ ...p, password: e.target.value }))
                }
                placeholder="Пароль"
                type="password"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
              />
            </label>
          </div>

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setModal(null)} className="btn-white flex-1">
              Отмена
            </button>
            <button type="button" onClick={createWorkspaceUser} className="btn-blue flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}