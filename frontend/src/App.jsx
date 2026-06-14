import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  BarChart3,
  Bot,
  Briefcase,
  Clock3,
  FileText,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

import WorkPage from "./pages/WorkPage";
import ExpensesPage from "./pages/ExpensesPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import POSPage from "./pages/POSPage";
import SalesAnalyticsPage from "./pages/SalesAnalyticsPage";
import ProfilePage from "./pages/ProfilePage";
import DesktopNavigation from "./components/DesktopNavigation";
import WarehousePage from "./pages/WarehousePage";
import AIWarehousePage from "./pages/AIWarehousePage";
import PendingPaymentsPage from "./pages/PendingPaymentsPage";
import DebtsPage from "./pages/DebtsPage";
import WorkspaceSelectPage from "./pages/WorkspaceSelectPage";

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

const ownerLinks = [
  ["/work", "Работа", Briefcase],
  ["/pos", "Магазин", ShoppingCart],
  ["/pending-payments", "Ожидание оплаты", Clock3, "pending"],
  ["/debts", "Долги", FileText, "debt"],
  ["/expenses", "Расходы", Wallet],
  ["/ai-warehouse", "AI-бизнес", Bot],
  ["/warehouse", "Склад", Package],
  ["/sales-analytics", "Продажи", ReceiptText],
  ["/analytics", "Аналитика", BarChart3],
  ["/profile", "Профиль", Settings],
];

const adminLinks = ownerLinks;

const workerLinks = [
  ["/pos", "Магазин", ShoppingCart],
  ["/pending-payments", "Ожидание оплаты", Clock3, "pending"],
  ["/debts", "Долги", FileText, "debt"],
  ["/expenses", "Расходы", Wallet],
];

function LoginPage({ onAuth }) {
  const [step, setStep] = useState("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otpValues, setOtpValues] = useState(Array(6).fill(""));
  const [maskedEmail, setMaskedEmail] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const otpRefs = [];

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const otpCode = otpValues.join("");
  const isOtpComplete = otpCode.length === 6 && otpValues.every(Boolean);

  const handleOtpChange = (index, rawValue) => {
    const value = rawValue.replace(/\D/g, "");
    if (!value) { const next = [...otpValues]; next[index] = ""; setOtpValues(next); return; }
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      const next = Array(6).fill("");
      digits.forEach((d, i) => { next[i] = d; });
      setOtpValues(next);
      otpRefs[Math.min(digits.length, 5)]?.focus();
      return;
    }
    const next = [...otpValues]; next[index] = value; setOtpValues(next);
    if (index < 5) otpRefs[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (otpValues[index]) { const next = [...otpValues]; next[index] = ""; setOtpValues(next); return; }
      if (index > 0) { otpRefs[index - 1]?.focus(); const next = [...otpValues]; next[index - 1] = ""; setOtpValues(next); }
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) otpRefs[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) otpRefs[index + 1]?.focus();
    if (e.key === "Enter" && isOtpComplete && !loading) submitOtp();
  };

  const submitCredentials = async (event) => {
    event?.preventDefault?.();
    if (loading) return;
    const cleanUsername = (username || "").trim();
    const cleanPassword = (password || "").trim();
    setError("");
    const errors = {};
    if (!cleanUsername) errors.username = "Введи логин";
    if (!cleanPassword) errors.password = "Введи пароль";
    if (Object.keys(errors).length) { setFieldErrors(errors); return; }
    setFieldErrors({});
    setLoading(true);
    try {
      const res = await post("/auth/login-otp/request", { username: cleanUsername, password: cleanPassword });
      setMaskedEmail(res.maskedEmail || "");
      setOtpValues(Array(6).fill(""));
      setStep("otp");
      setSecondsLeft(60);
      setTimeout(() => otpRefs[0]?.focus(), 100);
    } catch (e) {
      const msg = e?.message || "";
      if (/неверн|unauthorized|invalid|not found/i.test(msg)) { setError("Неверный логин или пароль"); setFieldErrors({ username: true, password: true }); }
      else if (/email/i.test(msg)) setError(msg);
      else if (/connect|ERR_CONNECTION|localhost:3000/i.test(msg)) setError("Не удаётся подключиться к серверу");
      else setError(msg || "Ошибка входа");
    } finally { setLoading(false); }
  };

  const submitOtp = async () => {
    if (!isOtpComplete || loading) return;
    setError("");
    setLoading(true);
    try {
      const user = await post("/auth/login-otp/confirm", { username: username.trim(), code: otpCode });
      if (!user || !user.accountId) throw new Error("Сервер ответил без данных аккаунта");
      setSession(user);
      onAuth(user);
    } catch (e) {
      const msg = e?.message || "";
      if (/истёк|expired/i.test(msg)) setError("Код истёк. Запроси новый.");
      else if (/попытки|attempts/i.test(msg)) { setError(msg); setOtpValues(Array(6).fill("")); }
      else if (/неверн|invalid|wrong/i.test(msg)) { setError(msg || "Неверный код"); setOtpValues(Array(6).fill("")); setTimeout(() => otpRefs[0]?.focus(), 50); }
      else setError(msg || "Ошибка подтверждения");
    } finally { setLoading(false); }
  };

  const resendOtp = async () => {
    if (secondsLeft > 0 || loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await post("/auth/login-otp/request", { username: username.trim(), password: password.trim() });
      setMaskedEmail(res.maskedEmail || maskedEmail);
      setOtpValues(Array(6).fill(""));
      setSecondsLeft(60);
      setTimeout(() => otpRefs[0]?.focus(), 100);
    } catch (e) { setError(e?.message || "Ошибка при повторной отправке"); }
    finally { setLoading(false); }
  };

  const fieldClass = (key) =>
    `w-full rounded-2xl border-2 px-4 py-3.5 text-sm font-bold outline-none transition-all duration-200 bg-slate-950/60 text-white placeholder:text-slate-500 ${
      fieldErrors[key] ? "border-red-500/70 focus:border-red-400" : "border-white/10 focus:border-blue-500/70 hover:border-white/20"
    }`;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur-xl">
          <div className="mb-8">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-xl shadow-blue-600/30">
              <span className="text-2xl font-black text-white">S</span>
            </div>
            <p className="mb-1 text-xs font-black uppercase tracking-widest text-blue-400">Sales App</p>
            {step === "credentials" ? (
              <><h1 className="text-3xl font-black tracking-tight text-white">Добро пожаловать</h1><p className="mt-2 text-sm font-medium text-slate-400">Войди чтобы продолжить работу</p></>
            ) : (
              <><h1 className="text-2xl font-black tracking-tight text-white">Подтверждение входа</h1><p className="mt-2 text-sm font-medium text-slate-400">Код отправлен на <span className="font-bold text-blue-400">{maskedEmail || "твой email"}</span></p></>
            )}
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[11px] font-black text-white">!</span>
              <p className="text-sm font-bold leading-5 text-red-300">{error}</p>
            </div>
          )}

          {step === "credentials" && (
            <div className="space-y-3" onKeyDown={(e) => e.key === "Enter" && !loading && submitCredentials(e)}>
              <div>
                <input value={username} onChange={(e) => { setUsername(e.target.value); setFieldErrors(p => ({ ...p, username: false })); setError(""); }}
                  placeholder="Логин или email" className={fieldClass("username")} autoComplete="username" autoFocus />
                {fieldErrors.username && typeof fieldErrors.username === "string" && <p className="mt-1.5 px-1 text-xs font-bold text-red-400">{fieldErrors.username}</p>}
              </div>
              <div className="relative">
                <input value={password} onChange={(e) => { setPassword(e.target.value); setFieldErrors(p => ({ ...p, password: false })); setError(""); }}
                  placeholder="Пароль" type={showPassword ? "text" : "password"} className={fieldClass("password") + " pr-12"}
                  autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && submitCredentials(e)} />
                <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white" tabIndex={-1}>
                  {showPassword ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
              <button type="button" onClick={submitCredentials} disabled={loading}
                className="relative mt-1 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-600/30 transition-all hover:from-blue-500 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-60">
                {loading ? <span className="flex items-center justify-center gap-2"><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Отправляю код...</span> : "Получить код"}
              </button>
            </div>
          )}

          {step === "otp" && (
            <div className="space-y-4">
              <div className="flex justify-between gap-2">
                {otpValues.map((value, index) => (
                  <input key={index} ref={el => { otpRefs[index] = el; }} value={value}
                    onChange={e => handleOtpChange(index, e.target.value)} onKeyDown={e => handleOtpKeyDown(index, e)}
                    onPaste={e => { e.preventDefault(); handleOtpChange(0, e.clipboardData.getData("text")); }}
                    inputMode="numeric" maxLength={1}
                    className="h-14 w-12 rounded-2xl border-2 border-white/10 bg-slate-950/60 text-center text-2xl font-black text-white outline-none transition focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/20" />
                ))}
              </div>
              <button type="button" onClick={submitOtp} disabled={!isOtpComplete || loading}
                className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 py-3.5 text-sm font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-60 transition">
                {loading ? <span className="flex items-center justify-center gap-2"><svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Проверяю...</span> : "Подтвердить вход"}
              </button>
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => { setStep("credentials"); setError(""); setOtpValues(Array(6).fill("")); }} className="text-sm font-bold text-slate-400 hover:text-white transition">← Изменить данные</button>
                <button type="button" onClick={resendOtp} disabled={secondsLeft > 0 || loading} className="text-sm font-bold text-blue-400 hover:text-blue-300 disabled:cursor-not-allowed disabled:text-slate-500 transition">
                  {secondsLeft > 0 ? `Повторно через ${secondsLeft} сек` : "Отправить снова"}
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="mt-5 text-center text-xs font-medium text-slate-600">Управление бизнесом · Sales App</p>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSessionState] = useState(getSession());
  const [workspace, setWorkspaceState] = useState(getCurrentWorkspace());
  const [workspaceSelected, setWorkspaceSelected] = useState(!!getCurrentWorkspace());
  const [profile, setProfile] = useState(getCurrentProfile());
  const [employees, setEmployees] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [debtCount, setDebtCount] = useState(0);
  const [userPages, setUserPages] = useState(null); // null = not loaded yet
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [desktopNavMode, setDesktopNavMode] = useState(() => localStorage.getItem("sales_app_desktop_nav_mode") || "header");
  const location = useLocation();
  const isAIWarehouseRoute = location.pathname === "/ai-warehouse";
  const isProfileRoute = location.pathname === "/profile";
  const useHeaderNav = desktopNavMode === "header";

  const toggleDesktopNavMode = () => {
    setDesktopNavMode((current) => {
      const next = current === "header" ? "sidebar" : "header";
      localStorage.setItem("sales_app_desktop_nav_mode", next);
      return next;
    });
  };

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message) => {
      const text = String(message || "Готово");
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((items) => [...items, { id, text }].slice(-4));
      window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3600);
    };
    window.showToast = (message) => window.alert(message);
    return () => { window.alert = originalAlert; delete window.showToast; };
  }, []);

  useEffect(() => {
    const syncProfile = () => setProfile(getCurrentProfile());
    const syncWorkspace = () => { setWorkspaceState(getCurrentWorkspace()); setProfile(getCurrentProfile()); };
    window.addEventListener("sales-profile-change", syncProfile);
    window.addEventListener("sales-workspace-change", syncWorkspace);
    return () => { window.removeEventListener("sales-profile-change", syncProfile); window.removeEventListener("sales-workspace-change", syncWorkspace); };
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
    if (!session || !isWorker) return;
    get("/employees").then((list) => setEmployees(list || [])).catch(() => setEmployees([]));
  }, [session, workspace, isWorker]);

  useEffect(() => {
    if (!session) return;
    if (isOwner) { setUserPages(["*"]); return; }
    // Для admin и worker грузим права с сервера
    get("/user-permissions/my")
      .then((res) => {
        if (res?.full) { setUserPages(["*"]); return; }
        const pages = Array.isArray(res?.pages) ? res.pages
          : (typeof res?.pages === "string" ? JSON.parse(res.pages) : null);
        if (pages) { setUserPages(pages); }
        else { setUserPages(isAdmin ? ["*"] : ["/pos", "/pending-payments"]); }
      })
      .catch(() => setUserPages(isAdmin ? ["*"] : ["/pos", "/pending-payments"]));
  }, [session, workspace, isOwner, isAdmin]);

  useEffect(() => {
    if (!session) return;
    const loadPendingCount = () => get("/pending-sales").then((list) => setPendingCount(Array.isArray(list) ? list.length : 0)).catch(() => setPendingCount(0));
    const loadDebtCount = () => get("/debts").then((list) => { const active = Array.isArray(list) ? list.filter((d) => !d.paid && !d.isPaid && !d.is_paid) : []; setDebtCount(active.length); }).catch(() => setDebtCount(0));
    loadPendingCount(); loadDebtCount();
    const interval = setInterval(() => { loadPendingCount(); loadDebtCount(); }, 30000);
    window.addEventListener("sales-pending-change", loadPendingCount);
    return () => { clearInterval(interval); window.removeEventListener("sales-pending-change", loadPendingCount); };
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
    return <LoginPage onAuth={(u) => { setSessionState(u); setWorkspaceSelected(false); }} />;
  }

  const needsWorkspaceSelect = !workspaceSelected && (
    session.role === "branch_admin" || session.role === "worker" || session.role === "workspace"
  );

  if (needsWorkspaceSelect) {
    return (
      <WorkspaceSelectPage session={session} onSelect={(ws) => {
        setWorkspaceState(ws);
        setWorkspaceSelected(true);
        setSessionState(prev => ({ ...prev, dataAccountId: ws.dataAccountId, workspaceId: ws.id, workspaceName: ws.name }));
      }} />
    );
  }

  const allRestrictedLinks = [
    ["/pos", "Магазин", ShoppingCart],
    ["/pending-payments", "Ожидание оплаты", Clock3, "pending"],
    ["/debts", "Долги", FileText, "debt"],
    ["/expenses", "Расходы", Wallet],
    ["/work", "Работа", Briefcase],
    ["/ai-warehouse", "AI-бизнес", Bot],
    ["/warehouse", "Склад", Package],
    ["/sales-analytics", "Продажи", ReceiptText],
    ["/analytics", "Аналитика", BarChart3],
  ];

  const filteredLinks = (isWorker || isAdmin) && userPages && !userPages.includes("*")
    ? allRestrictedLinks.filter(([to]) => userPages.includes(to))
    : null;

  const links = isOwner ? ownerLinks
    : filteredLinks ? filteredLinks
    : isAdmin ? adminLinks
    : workerLinks;
  const mobileMainPaths = isWorker ? ["/pos", "/pending-payments", "/expenses"] : ["/work", "/pos", "/pending-payments"];
  const mobileMainLinks = links.filter(([to]) => mobileMainPaths.includes(to));
  const mobileMoreLinks = links.filter(([to]) => !mobileMainPaths.includes(to));

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

  const workerName = profile?.name || (isOwner ? session.ownerName || session.username : "выберите сотрудника");
  const forbidden = <Navigate to={isWorker ? "/pos" : "/work"} replace />;

  // Проверка доступа к странице (для worker и admin если ограничен)
  const canAccess = (path) => {
    if (isOwner) return true; // owner — всегда полный доступ
    if (!userPages) return false; // ещё не загрузили
    if (userPages.includes("*")) return true;
    return userPages.includes(path);
  };
  const handleProfileChange = (value) => { const selected = employees.find((x) => String(x.id) === String(value)); setCurrentProfile(selected || null); setProfile(selected || null); };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-slate-950">
      {!useHeaderNav && (
        <aside className={`hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-slate-950 p-4 text-white transition-all duration-300 lg:flex ${sidebarOpen ? "w-80" : "w-24"}`}>
          <button type="button" onClick={() => setSidebarOpen((p) => !p)}
            className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-slate-300 transition hover:bg-blue-600 hover:text-white focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${sidebarOpen ? "self-end" : "self-center"}`}>
            <Menu size={23} strokeWidth={2.4} />
          </button>

          <div className={`mb-7 flex items-center ${sidebarOpen ? "gap-3" : "justify-center"}`}>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 shadow-xl shadow-blue-600/25">
              <ShoppingCart size={30} strokeWidth={2.6} />
            </div>
            {sidebarOpen && <div className="min-w-0"><h1 className="truncate text-2xl font-black tracking-tight">Sales App</h1><p className="truncate text-sm text-slate-400">Касса и продажи</p></div>}
          </div>

          <div className="mb-5 rounded-[1.7rem] bg-slate-900 p-4">
            {sidebarOpen ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {isOwner ? "Главный аккаунт" : isAdmin ? "Админ точки" : "Рабочий аккаунт"}
                </p>
                <p className="mt-1 truncate font-black text-white">{session.username}</p>
                {/* ── Название активной точки ── */}
                {currentWorkspace?.name && (
                  <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-blue-500/15 px-2.5 py-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    <span className="truncate text-xs font-black text-blue-300">{currentWorkspace.name}</span>
                  </div>
                )}
                {isWorker ? (
                  <div className="mt-4 rounded-3xl bg-slate-950 p-4">
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-slate-400">Профиль смены</span>
                      <select value={profile?.id || ""} onChange={(e) => handleProfileChange(e.target.value)}
                        className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 font-black text-blue-400 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20">
                        <option value="">Выберите сотрудника</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="mt-4 rounded-3xl bg-slate-950 p-4">
                    <p className="text-sm text-slate-400">Хорошей работы</p>
                    <p className="mt-1 truncate text-xl font-black text-blue-400">{workerName}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-blue-400">
                  {isWorker ? <Users size={23} /> : <Settings size={23} />}
                </div>
              </div>
            )}
          </div>

          <nav className="space-y-3" aria-label="Главное меню">
            {links.map(([to, label, Icon, badge]) => (
              <NavLink key={to} to={to} title={!sidebarOpen ? label : undefined}
                className={({ isActive }) => `group flex items-center rounded-[1.4rem] font-black transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${sidebarOpen ? "gap-4 px-4 py-4" : "justify-center px-3 py-4"} ${isActive ? "bg-blue-600 text-white shadow-xl shadow-blue-600/25" : "bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/5 transition group-hover:bg-white/10"><Icon size={23} strokeWidth={2.4} /></span>
                {sidebarOpen && <span className="min-w-0 flex-1 truncate">{label}</span>}
                {badge === "pending" && pendingCount > 0 && <span className="ml-auto rounded-full bg-blue-500 px-2 py-1 text-xs font-black text-white">{pendingCount > 99 ? "99+" : pendingCount}</span>}
                {badge === "debt" && debtCount > 0 && <span className="ml-auto rounded-full bg-red-600 px-2 py-1 text-xs font-black text-white">{debtCount > 99 ? "99+" : debtCount}</span>}
              </NavLink>
            ))}
          </nav>

          <button onClick={logout} title={!sidebarOpen ? "Выйти" : undefined}
            className={`mt-5 flex w-full items-center rounded-[1.4rem] border border-white/10 bg-slate-950 font-black text-slate-300 transition hover:border-red-500/40 hover:bg-red-600 hover:text-white focus:outline-none focus:ring-4 focus:ring-red-500/20 ${sidebarOpen ? "justify-center gap-3 px-4 py-4" : "justify-center px-3 py-4"}`}>
            <LogOut size={22} strokeWidth={2.4} />
            {sidebarOpen && <span>Выйти</span>}
          </button>
        </aside>
      )}

      <main className={`flex-1 overflow-x-hidden ${isAIWarehouseRoute ? "overflow-hidden p-0" : "p-4 pb-nav sm:p-5 lg:pb-5 min-h-screen overflow-y-auto"}`}
        style={isAIWarehouseRoute ? { height: "100dvh" } : {}}>

        {useHeaderNav && (
          <DesktopNavigation
            links={links} session={session} isOwner={isOwner} isAdmin={isAdmin} isWorker={isWorker}
            workerName={workerName} pendingCount={pendingCount} debtCount={debtCount}
            workspaceName={currentWorkspace?.name || ""}
            isProfileRoute={isProfileRoute} onToggleMode={toggleDesktopNavMode} onLogout={logout}
          />
        )}

        {!useHeaderNav && isProfileRoute && (
          <div className="mb-5 hidden justify-end lg:flex">
            <button type="button" onClick={toggleDesktopNavMode}
              className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-5 py-3 font-black text-blue-200 shadow-xl transition hover:bg-blue-500/20">
              Перенести меню наверх
            </button>
          </div>
        )}

        {/* Мобильная шапка */}
        <div className={`mb-3 flex items-center justify-between gap-2.5 rounded-[18px] border border-white/8 bg-slate-950/85 px-3 py-2.5 text-white backdrop-blur-md lg:hidden${isAIWarehouseRoute ? " hidden" : ""}`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-linear-to-br from-blue-500 to-blue-700 text-sm font-black text-white shadow-lg shadow-blue-600/25">
              {(isWorker ? workerName : session.username)?.[0]?.toUpperCase() || "U"}
            </div>
            {isWorker ? (
              <select value={profile?.id || ""} onChange={(e) => handleProfileChange(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-transparent py-1 pl-1 pr-6 text-sm font-black text-blue-300 outline-none">
                <option value="">Сотрудник...</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            ) : (
              <div className="min-w-0">
                <span className="block truncate text-sm font-black leading-tight text-white">{session.username}</span>
                {currentWorkspace?.name && (
                  <span className="flex items-center gap-1 truncate text-[11px] font-bold text-blue-400">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    {currentWorkspace.name}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {pendingCount > 0 && (
              <NavLink to="/pending-payments" className="flex items-center gap-1 rounded-xl border border-blue-500/20 bg-blue-500/12 px-2.5 py-1.5 transition active:scale-95">
                <Clock3 size={12} className="text-blue-400" strokeWidth={2.8} />
                <span className="text-[11px] font-black text-blue-300">{pendingCount > 9 ? "9+" : pendingCount}</span>
              </NavLink>
            )}
            {debtCount > 0 && (
              <NavLink to="/debts" className="flex items-center gap-1 rounded-xl border border-red-500/20 bg-red-500/12 px-2.5 py-1.5 transition active:scale-95">
                <FileText size={12} className="text-red-400" strokeWidth={2.8} />
                <span className="text-[11px] font-black text-red-300">{debtCount > 9 ? "9+" : debtCount}</span>
              </NavLink>
            )}
            {!isWorker && (
              <NavLink to="/profile"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-slate-400 transition active:scale-95 active:bg-white/15 hover:text-white">
                <Settings size={17} strokeWidth={2.5} />
              </NavLink>
            )}
          </div>
        </div>

        <Routes>
          <Route path="/" element={<Navigate to={isWorker ? "/pos" : "/work"} replace />} />
          <Route path="/pos" element={<POSPage currentProfile={profile} ownerName={isWorker ? profile?.name : session.ownerName || session.username} openProfile={() => { if (!isWorker) window.location.href = "/profile"; }} />} />
          <Route path="/expenses" element={<ExpensesPage currentProfile={profile} workerMode={isWorker} />} />
          <Route path="/pending-payments" element={<PendingPaymentsPage />} />
          <Route path="/debts" element={<DebtsPage />} />
          <Route path="/work" element={!canAccess("/work") ? forbidden : <WorkPage />} />
          <Route path="/ai-warehouse" element={!canAccess("/ai-warehouse") ? forbidden : <AIWarehousePage key={currentWorkspace?.dataAccountId || session?.dataAccountId || "default"} />} />
          <Route path="/warehouse" element={!canAccess("/warehouse") ? forbidden : <WarehousePage />} />
          <Route path="/profile" element={isWorker ? <Navigate to="/pos" replace /> : <ProfilePage session={session} workspace={currentWorkspace} profile={profile} setProfile={setProfile} setWorkspaceState={setWorkspaceState} logout={logout} />} />
          <Route path="/sales-analytics" element={!canAccess("/sales-analytics") ? forbidden : <SalesAnalyticsPage />} />
          <Route path="/analytics" element={!canAccess("/analytics") ? forbidden : <AnalyticsPage />} />
          <Route path="/employees" element={<Navigate to="/profile" replace />} />
          <Route path="/cards" element={<Navigate to="/profile" replace />} />
          <Route path="*" element={<Navigate to={isWorker ? "/pos" : "/work"} replace />} />
        </Routes>
      </main>

      {mobileMoreOpen && mobileMoreLinks.length > 0 && (
        <button type="button" aria-label="Закрыть меню" onClick={() => setMobileMoreOpen(false)}
          className="animate-overlay fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden" />
      )}

      {mobileMoreOpen && mobileMoreLinks.length > 0 && (
        <div className="animate-sheet fixed inset-x-0 bottom-0 z-50 lg:hidden"
          style={{ paddingBottom: "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 10px)" }}>
          <div className="mx-3 overflow-hidden rounded-[1.7rem] border border-white/12 bg-slate-900/98 text-white shadow-2xl backdrop-blur-xl">
            <div className="flex justify-center pb-1 pt-3">
              <div className="h-1 w-10 rounded-full bg-white/20" />
            </div>
            <div className="flex items-center justify-between px-4 pb-2 pt-1.5">
              <p className="text-sm font-black text-white">Разделы</p>
              <button type="button" onClick={() => setMobileMoreOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-slate-400 transition active:scale-95 active:bg-white/15">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {mobileMoreLinks.map(([to, label, Icon, badge]) => (
                <NavLink key={to} to={to} onClick={() => setMobileMoreOpen(false)}
                  className={({ isActive }) => `relative flex items-center gap-3 rounded-2xl px-3.5 py-3.5 transition active:scale-[0.97] ${isActive ? "bg-blue-500/18 text-blue-300" : "bg-white/6 text-slate-300 hover:bg-white/10 hover:text-white"}`}>
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8">
                    <Icon size={19} strokeWidth={2.4} />
                    {badge === "pending" && pendingCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-blue-500 px-0.5 text-[9px] font-black leading-none text-white ring-2 ring-slate-900">{pendingCount > 9 ? "9+" : pendingCount}</span>}
                    {badge === "debt" && debtCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-black leading-none text-white ring-2 ring-slate-900">{debtCount > 9 ? "9+" : debtCount}</span>}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-black">{label}</span>
                </NavLink>
              ))}
            </div>
            <div className="px-3 pb-3">
              <button type="button" onClick={() => { setMobileMoreOpen(false); logout(); }}
                className="flex w-full items-center gap-3 rounded-2xl border border-red-500/12 bg-red-500/8 px-4 py-3.5 text-sm font-black text-red-400 transition active:bg-red-500/18 hover:text-red-300">
                <LogOut size={17} strokeWidth={2.4} />
                <span>Выйти из системы</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className={`fixed inset-x-3 z-40 grid grid-flow-col auto-cols-fr rounded-[1.7rem] border border-white/12 bg-slate-950/96 p-1.5 text-white shadow-2xl shadow-slate-950/40 backdrop-blur-xl lg:hidden transition-all duration-300 ease-out ${keyboardVisible || isAIWarehouseRoute ? "translate-y-[calc(100%+20px)] opacity-0 pointer-events-none" : "translate-y-0 opacity-100"}`}
        style={{ bottom: "max(12px, env(safe-area-inset-bottom, 12px))", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Нижняя навигация">
        {mobileMainLinks.map(([to, label, Icon, badge]) => (
          <NavLink key={to} to={to} onClick={() => setMobileMoreOpen(false)}
            className="relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[1.2rem] px-1 py-2">
            {({ isActive }) => (
              <>
                <span className={`relative flex h-10 w-full items-center justify-center rounded-2xl transition-all duration-200 ${isActive ? "bg-blue-500/16 text-blue-400" : "text-slate-500"}`}>
                  <Icon size={22} strokeWidth={isActive ? 2.6 : 2} />
                  {badge === "pending" && pendingCount > 0 && <span className="absolute right-1 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-blue-500 px-0.5 text-[9px] font-black leading-none text-white ring-2 ring-slate-950">{pendingCount > 9 ? "9+" : pendingCount}</span>}
                  {badge === "debt" && debtCount > 0 && <span className="absolute right-1 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-black leading-none text-white ring-2 ring-slate-950">{debtCount > 9 ? "9+" : debtCount}</span>}
                </span>
                <span className={`w-full truncate text-center text-[10px] font-black leading-none tracking-tight transition-colors ${isActive ? "text-blue-400" : "text-slate-500"}`}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
        {mobileMoreLinks.length > 0 && (
          <button type="button" onClick={() => setMobileMoreOpen((open) => !open)}
            className="relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[1.2rem] px-1 py-2">
            <span className={`flex h-10 w-full items-center justify-center rounded-2xl transition-all duration-200 ${mobileMoreOpen ? "bg-blue-500/16 text-blue-400" : "text-slate-500"}`}>
              <Menu size={22} strokeWidth={mobileMoreOpen ? 2.6 : 2} />
            </span>
            <span className={`w-full truncate text-center text-[10px] font-black leading-none tracking-tight transition-colors ${mobileMoreOpen ? "text-blue-400" : "text-slate-500"}`}>Ещё</span>
          </button>
        )}
      </nav>

      {/* Тосты на мобиле — над навигацией */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col-reverse gap-2 px-4 lg:hidden"
        style={{ paddingBottom: "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {toasts.slice(-2).map((toast) => (
          <div key={toast.id} className="animate-toast pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/12 bg-slate-800/97 px-4 py-3.5 shadow-2xl backdrop-blur-xl">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 text-base font-black">✓</span>
            <p className="text-sm font-black text-white leading-snug">{toast.text}</p>
          </div>
        ))}
      </div>
      {/* Тосты на десктопе — правый верхний угол */}
      <div className="pointer-events-none fixed right-5 top-5 z-60 hidden w-full max-w-sm flex-col gap-2.5 lg:flex">
        {toasts.map((toast) => (
          <div key={toast.id} className="animate-toast pointer-events-auto flex items-start gap-3.5 rounded-2xl border border-white/12 bg-slate-800/97 px-5 py-4 shadow-2xl backdrop-blur-xl">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 text-sm font-black">✓</span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Уведомление</p>
              <p className="mt-0.5 text-sm font-black text-white">{toast.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
